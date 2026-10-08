#!/usr/bin/env python3
"""
13 — Foto padrão para produtos ATIVOS sem nenhuma imagem no site.

  python3 13_foto_padrao.py            → dry-run (lista o plano, nada escrito)
  python3 13_foto_padrao.py --apply    → executa os uploads
  python3 13_foto_padrao.py --refazer-kits
       → também refaz o kit que ficou com a capa provisória ("foto-padrao") mas cujo
         unitário JÁ ganhou foto de verdade depois: apaga a provisória e espelha o
         unitário. Sem esse flag o kit é pulado, porque tem mídia.

Regras (pedido de 25/08/2026 — "o que não tem foto sobe com a foto padrão"):
  • Kit X-KITn cujo unitário X tem fotos → espelha as fotos do unitário (alt "espelho-unitario").
  • Bombas/Motores hidráulicos → assets/bomba_generica.png ("imagem meramente ilustrativa").
  • Demais peças sem foto fonte → capa padrão: fundo_ecom_v2 + CÓD + descrição curta,
    mesma arte da capa v2 porém sem a peça. Alt "foto-padrao" (idempotência — produto
    que já tem qualquer mídia é ignorado).
"""
import csv, datetime, importlib.util, pathlib, re, sys, time

from PIL import Image, ImageDraw, ImageFont

BASE = pathlib.Path(__file__).parent
sys.path.insert(0, str(BASE))
from common import REL_DIR, load_env, norm_sku, shopify_graphql, shopify_token

_spec = importlib.util.spec_from_file_location("capas06", BASE / "06_capas_ecommerce.py")
m06 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m06)

REPO = BASE.parent.parent
GENERICA = REPO / "assets" / "bomba_generica.png"
OUT_DIR = BASE / "capas"
APPLY = "--apply" in sys.argv
REFAZER_KITS = "--refazer-kits" in sys.argv
TS = datetime.datetime.now().strftime("%Y%m%d_%H%M")

HIDRAULICA = re.compile(r"(?i)\b(bomba|motor)\b")
KIT_RE = re.compile(r"(?i)^(.+?)-KIT\d+$")


def compose_padrao(codigo, descricao, out_path):
    """Capa v2 sem a peça: fundo + CÓD dourado + descrição verde, bloco centralizado."""
    bg = Image.open(m06.BG_PATH).convert("RGBA")
    W, H = bg.size
    canvas = bg.copy()
    draw = ImageDraw.Draw(canvas)
    tcx = int(W * 0.60)
    max_tw = int(W * 0.52)

    cod_txt = f"CÓD. {codigo}"
    f_cod = m06.fit_font(m06.FONTS / "JetBrainsMono.ttf", cod_txt, int(max_tw * 0.95), 38, draw)
    try:
        f_cod.set_variation_by_name("Bold")
    except Exception:
        pass
    asc, dsc = f_cod.getmetrics()
    ch = asc + dsc

    lines = m06.split_lines(descricao)
    fpath = m06.FONTS / "BarlowCondensed-ExtraBold.ttf"
    start = {1: 190, 2: 150, 3: 118}[len(lines)]
    fonts = [m06.fit_font(fpath, ln, max_tw, start, draw) for ln in lines]
    size = min(f.size for f in fonts)
    f_cat = ImageFont.truetype(str(fpath), size)
    a2, d2 = f_cat.getmetrics()
    lh = int((a2 + d2) * 0.80)

    gap1, gap2 = int(H * 0.012), int(H * 0.014)
    th = ch + gap1 + lh * len(lines) + gap2
    y = int(H * 0.42 - th / 2)

    tw = draw.textlength(cod_txt, font=f_cod)
    draw.text((tcx - tw / 2, y), cod_txt, font=f_cod, fill=m06.GOLD)
    ly = y + ch // 2 - 4
    gap, lw_ = 28, 90
    draw.line([(tcx - tw / 2 - gap - lw_, ly), (tcx - tw / 2 - gap, ly)], fill=m06.GOLD, width=3)
    draw.line([(tcx + tw / 2 + gap, ly), (tcx + tw / 2 + gap + lw_, ly)], fill=m06.GOLD, width=3)
    y += ch + gap1
    for ln in lines:
        tw = draw.textlength(ln, font=f_cat)
        draw.text((tcx - tw / 2, y), ln, font=f_cat, fill=m06.GREEN)
        y += lh
    rw = int(max_tw * 0.55)
    draw.line([(tcx - rw / 2, y + gap2), (tcx + rw / 2, y + gap2)], fill=m06.GOLD, width=3)
    canvas.convert("RGB").save(out_path, "PNG")


def create_media(env, token, pid, source_url, alt):
    d = shopify_graphql(env, token, m06.M_CREATE_MEDIA, {
        "productId": pid,
        "media": [{"originalSource": source_url, "mediaContentType": "IMAGE", "alt": alt}]})
    errs = d["productCreateMedia"]["mediaUserErrors"]
    if errs:
        raise RuntimeError(errs)
    return d["productCreateMedia"]["media"][0]["id"]


def main():
    env = load_env()
    token = shopify_token(env)
    prods = m06.fetch_products(env, token)
    by_sku = {}
    for p in prods:
        sku = (p["variants"]["nodes"] or [{}])[0].get("sku")
        if sku:
            by_sku.setdefault(norm_sku(sku), p)

    def so_provisoria(p):
        """Produto cuja única imagem é a capa provisória do próprio script."""
        imgs = [m for m in p["media"]["nodes"] if m["mediaContentType"] == "IMAGE"]
        return bool(imgs) and all((m.get("alt") or "").startswith("foto-padrao") for m in imgs)

    plan = []
    for p in prods:
        if p["status"] != "ACTIVE":
            continue
        sku = (p["variants"]["nodes"] or [{}])[0].get("sku") or ""
        imgs = [m for m in p["media"]["nodes"] if m["mediaContentType"] == "IMAGE"]
        refazer = False
        if imgs:
            # kit com capa provisória cujo unitário já tem foto real: vale trocar
            if not (REFAZER_KITS and KIT_RE.match(sku) and so_provisoria(p)):
                continue
            refazer = True
        mkit = KIT_RE.match(sku)
        unit = by_sku.get(norm_sku(mkit.group(1))) if mkit else None
        unit_imgs = [m for m in (unit["media"]["nodes"] if unit else [])
                     if m["mediaContentType"] == "IMAGE" and m.get("image")]
        if refazer:
            # trocar a provisória do kit pela provisória do unitário não melhora nada
            unit_imgs = [m for m in unit_imgs
                         if not (m.get("alt") or "").startswith("foto-padrao")]
        unit_urls = [m["image"]["url"] for m in unit_imgs]
        if refazer and not unit_urls:
            continue                      # unitário também não tem foto: deixa como está
        if unit_urls:
            plan.append((p, sku, "espelho", unit_urls))
        elif HIDRAULICA.search(f"{p['title']} {p['productType']}"):
            plan.append((p, sku, "generica", None))
        else:
            plan.append((p, sku, "capa_padrao", None))

    print(f"Site: {len(prods)} produtos | ativos sem imagem: {len(plan)}")
    for p, sku, acao, extra in plan:
        det = f" ({len(extra)} fotos do unitário)" if extra else ""
        print(f"  [{acao:11}] {sku:22} {p['title'][:70]}{det}")
    if not APPLY:
        print("\nDry-run — rode com --apply para subir.")
        return

    m06.ensure_fonts()
    OUT_DIR.mkdir(exist_ok=True)
    log = []
    for p, sku, acao, extra in plan:
        try:
            if acao == "espelho":
                velhas = [m["id"] for m in p["media"]["nodes"]
                          if m["mediaContentType"] == "IMAGE"
                          and (m.get("alt") or "").startswith("foto-padrao")]
                if velhas:
                    d = shopify_graphql(env, token, m06.M_DEL_MEDIA,
                                        {"productId": p["id"], "mediaIds": velhas})
                    if d["productDeleteMedia"]["mediaUserErrors"]:
                        raise RuntimeError(d["productDeleteMedia"]["mediaUserErrors"])
                    print(f"    – {len(velhas)} capa(s) provisória(s) removida(s)")
                mids = [create_media(env, token, p["id"], u, f"espelho-unitario {i+1}")
                        for i, u in enumerate(extra)]
                ok = all(m06.wait_media_ready(env, token, p["id"], m) for m in mids)
            elif acao == "generica":
                url = m06.staged_upload(env, token, "bomba_generica.png", GENERICA.read_bytes())
                mid = create_media(env, token, p["id"], url, "foto-padrao")
                ok = m06.wait_media_ready(env, token, p["id"], mid)
            else:
                codigo = KIT_RE.sub(r"\1", sku)
                desc = m06.descricao_curta(p["title"], codigo)
                out = OUT_DIR / f"foto_padrao_{m06.sanitize(sku)}.png"
                compose_padrao(codigo, desc, out)
                url = m06.staged_upload(env, token, out.name, out.read_bytes())
                mid = create_media(env, token, p["id"], url, "foto-padrao")
                ok = m06.wait_media_ready(env, token, p["id"], mid)
            log.append((sku, acao, "ok" if ok else "TIMEOUT"))
            print(f"  ✔ {sku} ({acao})" if ok else f"  ?? {sku} ({acao}) — mídia não ficou READY")
        except Exception as e:
            log.append((sku, acao, f"ERRO {e}"))
            print(f"  !! {sku} ({acao}): {e}")
        time.sleep(0.4)

    REL_DIR.mkdir(exist_ok=True)
    out = REL_DIR / f"foto_padrao_{TS}.csv"
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sku", "acao", "resultado"])
        w.writerows(log)
    nok = sum(1 for r in log if r[2] == "ok")
    print(f"\nConcluído: {nok}/{len(log)} ok → {out}")


if __name__ == "__main__":
    main()
