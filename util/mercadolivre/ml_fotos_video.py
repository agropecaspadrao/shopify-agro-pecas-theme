"""Vídeo da peça → fotos de e-commerce → Mercado Livre.

Fluxo:
  1. ffmpeg extrai 2 quadros/s do vídeo; escolhe os N mais nítidos (variância do Laplaciano),
     espaçados no tempo e visualmente diferentes (ângulos distintos)
  2. recorte de fundo pelo segmentador do macOS (Vision) — mesmo módulo do 08_fotos_estudio
  3. monta cada quadro em canvas 1200×1200 branco (regra do ML: capa em fundo branco, sem texto)
  4. gera também a capa APP (fundo verde + código + descrição) com o compose do 06_capas_ecommerce
     → vai como 2ª foto (o ML penaliza texto/logo na 1ª)
  5. --upload MLBxxxx: sobe via POST /pictures/items/upload e grava no anúncio (PUT pictures)

Uso:
    python3 ml_fotos_video.py video.mp4 --sku CQ65827                  # gera fotos_ml/CQ65827/
    python3 ml_fotos_video.py video.mp4 --sku CQ65827 --n 4 --desc "Condutor de Adubo John Deere"
    python3 ml_fotos_video.py video.mp4 --sku CQ65827 --upload MLB7006197032          # substitui as fotos
    python3 ml_fotos_video.py video.mp4 --sku CQ65827 --upload MLB7006197032 --manter # acrescenta às atuais
    python3 ml_fotos_video.py --so-upload --sku CQ65827 --upload MLB7006197032        # reenvia a pasta pronta
"""
from __future__ import annotations
import argparse, importlib.util, json, shutil, subprocess, sys, tempfile, time
from pathlib import Path
import numpy as np
import requests
from PIL import Image, ImageFilter, ImageOps

HERE = Path(__file__).resolve().parent
MP = HERE.parent / "master-produtos"
SWIFT = MP / "recorte_vision.swift"
OUT_ROOT = HERE / "fotos_ml"
API = "https://api.mercadolibre.com"
CANVAS = 1200
MARGEM = 0.08


def sharpness(im: Image.Image) -> float:
    g = np.asarray(im.convert("L").resize((480, int(480 * im.height / im.width))), dtype=np.float32)
    lap = (np.abs(np.diff(g, 2, axis=0))[:, :-2] + np.abs(np.diff(g, 2, axis=1))[:-2, :])
    return float(lap.var())


def fingerprint(im: Image.Image) -> np.ndarray:
    return np.asarray(im.convert("L").resize((16, 16)), dtype=np.float32).ravel()


def extrair_quadros(video: Path, n: int, fps: float = 2.0) -> list[Path]:
    tmp = Path(tempfile.mkdtemp(prefix="quadros_"))
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(video), "-vf", f"fps={fps}", "-q:v", "2",
                    str(tmp / "q_%04d.jpg")], check=True)
    frames = sorted(tmp.glob("q_*.jpg"))
    if not frames:
        raise SystemExit("ffmpeg não extraiu quadros")
    scored = []
    for f in frames:
        im = Image.open(f); im = ImageOps.exif_transpose(im)
        scored.append((sharpness(im), f, fingerprint(im)))
    scored.sort(key=lambda x: -x[0])
    escolhidos, fps_ = [], []
    for s, f, fp in scored:
        if any(np.abs(fp - o).mean() < 12 for o in fps_):   # quadro quase igual a um já escolhido
            continue
        escolhidos.append(f); fps_.append(fp)
        if len(escolhidos) >= n: break
    escolhidos.sort()          # ordem cronológica
    print(f"quadros extraídos: {len(frames)} | escolhidos: {[e.name for e in escolhidos]}")
    return escolhidos


def recortar(src: Path, dst: Path) -> bool:
    r = subprocess.run(["swift", str(SWIFT), str(src), str(dst)], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  recorte falhou em {src.name}: {r.stderr.strip()[:120]}")
        return False
    return True


def limpar_alpha(im: Image.Image) -> Image.Image:
    """Tira ruído do alpha (pontos soltos) e suaviza a borda."""
    a = im.split()[3]
    a = a.point(lambda v: 255 if v > 90 else 0).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    a = a.filter(ImageFilter.GaussianBlur(0.8))
    im.putalpha(a)
    return im


def em_canvas_branco(rgba: Image.Image) -> Image.Image:
    rgba = limpar_alpha(rgba)
    bbox = rgba.getbbox()
    if not bbox:
        raise ValueError("recorte vazio")
    part = rgba.crop(bbox)
    lim = int(CANVAS * (1 - 2 * MARGEM))
    s = min(lim / part.width, lim / part.height)
    part = part.resize((max(1, int(part.width * s)), max(1, int(part.height * s))), Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 255))
    sombra = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    a = part.split()[3].point(lambda v: int(v * 0.18))
    tint = Image.new("RGBA", part.size, (30, 30, 30, 255)); tint.putalpha(a)
    x, y = (CANVAS - part.width) // 2, (CANVAS - part.height) // 2
    sombra.paste(tint, (x + 6, y + 14), tint)
    canvas = Image.alpha_composite(canvas, sombra.filter(ImageFilter.GaussianBlur(14)))
    canvas.paste(part, (x, y), part)
    return canvas.convert("RGB")


def capa_app(rgba: Image.Image, sku: str, desc: str, out: Path) -> bool:
    """Reaproveita o compose() do 06_capas_ecommerce (fundo verde + código + descrição)."""
    spec = importlib.util.spec_from_file_location("capas06", MP / "06_capas_ecommerce.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    try:
        m.ensure_fonts()
    except Exception as e:
        print(f"  fontes da capa indisponíveis ({e}); capa APP pulada"); return False
    flat = Image.new("RGB", rgba.size, (255, 255, 255)); flat.paste(rgba, mask=limpar_alpha(rgba).split()[3])
    m.compose(flat, sku, desc or m.descricao_curta(desc or sku, sku), out)
    return True


def gerar(video: Path, sku: str, n: int, desc: str | None) -> list[Path]:
    out = OUT_ROOT / sku; out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.png"): old.unlink()
    quadros = extrair_quadros(video, n)
    fotos = []
    for i, q in enumerate(quadros, 1):
        rec = out / f"_recorte_{i}.png"
        if not recortar(q, rec): continue
        rgba = Image.open(rec).convert("RGBA")
        try:
            foto = em_canvas_branco(rgba)
        except ValueError:
            print(f"  quadro {i}: recorte vazio, pulado"); continue
        p = out / f"{sku}_ml_{i}.png"; foto.save(p, "PNG", optimize=True); fotos.append(p)
        if i == 1:
            capa = out / f"{sku}_capa_app.png"
            if capa_app(rgba, sku, desc, capa): fotos.insert(1, capa)
        rec.unlink(missing_ok=True)
    print(f"fotos geradas em {out}: {[f.name for f in fotos]}")
    return fotos


def H():
    import ml_auth
    return {"Authorization": f"Bearer {ml_auth.get_access_token()}"}


def upload(fotos: list[Path], item_id: str, manter: bool) -> None:
    ids = []
    for f in fotos:
        with open(f, "rb") as fh:
            r = requests.post(f"{API}/pictures/items/upload", headers=H(), files={"file": (f.name, fh, "image/png")}, timeout=120)
        if not r.ok:
            print(f"  upload {f.name}: {r.status_code} {r.text[:160]}"); continue
        ids.append(r.json()["id"]); print(f"  upload {f.name} → {ids[-1]}"); time.sleep(0.8)
    if not ids:
        raise SystemExit("nenhuma foto subiu")
    pics = [{"id": i} for i in ids]
    if manter:
        atual = requests.get(f"{API}/items/{item_id}", params={"attributes": "pictures"}, headers=H(), timeout=30).json()
        pics += [{"id": p["id"]} for p in atual.get("pictures", [])]
    r = requests.put(f"{API}/items/{item_id}", headers=H(), json={"pictures": pics[:10]}, timeout=60)
    print(f"PUT pictures em {item_id}: {r.status_code} {'' if r.ok else r.text[:200]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video", nargs="?")
    ap.add_argument("--sku", required=True)
    ap.add_argument("--n", type=int, default=5, help="quantos quadros/fotos (máx. 9 + capa)")
    ap.add_argument("--desc", default=None, help="descrição curta para a capa APP (ex.: 'Condutor de Adubo John Deere')")
    ap.add_argument("--upload", default=None, metavar="MLB_ID")
    ap.add_argument("--manter", action="store_true", help="acrescenta às fotos atuais em vez de substituir")
    ap.add_argument("--so-upload", action="store_true", help="não gera; sobe a pasta fotos_ml/<sku> já pronta")
    a = ap.parse_args()
    if a.so_upload:
        fotos = sorted((OUT_ROOT / a.sku).glob(f"{a.sku}_*.png"))
        fotos.sort(key=lambda p: (0 if p.name.endswith("_ml_1.png") else 1 if "capa" in p.name else 2, p.name))
    else:
        if not a.video: raise SystemExit("informe o vídeo (ou --so-upload)")
        fotos = gerar(Path(a.video), a.sku, min(a.n, 9), a.desc)
    if a.upload:
        upload(fotos, a.upload, a.manter)


if __name__ == "__main__":
    main()
