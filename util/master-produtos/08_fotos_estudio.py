# -*- coding: utf-8 -*-
"""08 — Trata fotos de estúdio do fornecedor e organiza a galeria da PDP.

Fluxo (por SKU, ver CONFIG):
  1. lê as fotos originais (colagem em grade e/ou fotos avulsas) de --dir —
     elas ficam SÓ na pasta de origem/Drive, não entram no assets/ do tema;
  2. recorta o fundo com o segmentador do macOS (recorte_vision.swift) e
     centraliza a peça em canvas quadrado branco -> assets/<prefixo>_ecommerce*.png;
  3. com --subir: publica esses quadros no produto e reordena a galeria para o
     layout padrão da loja — capa v2 primeiro, fotos de estúdio depois, fotos
     de bancada no fim;
  4. com --limpar: apaga do produto as fotos cruas do fornecedor (tudo que não
     é capa v2 nem foto de estúdio);
  5. com --planilha: grava os arquivos na coluna "Imagens site (assets)" da
     master no Drive (baixa fresca, edita, sobe e repara o cache de fórmulas)
     e atualiza a cópia local util/APP_Master_Produtos_Shopify.xlsx.

A capa v2 em si continua sendo gerada pelo 06 (que consome o *_ecommerce
recém-criado): python3 06_capas_ecommerce.py --sku <SKU> --subir

Uso:
    python3 08_fotos_estudio.py --sku 5.1305.0565094.0 [--dir ~/Downloads/...]
    python3 08_fotos_estudio.py --sku 5.1305.0565094.0 --subir [--limpar] [--planilha]
"""
import datetime
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

import openpyxl
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import load_env, shopify_graphql, shopify_token
from recorte_limpeza import remover_furo, tirar_franja

BASE = Path(__file__).parent
REPO = BASE.parent.parent
ASSETS = REPO / "assets"
SWIFT = BASE / "recorte_vision.swift"

LADO = 1400          # canvas quadrado final
MAX_VISION = 2000    # foto do fornecedor vem em 6144x8192; o Vision não precisa disso
MARGEM = 0.06        # respiro ao redor da peça
ALT_TAG = "foto-estudio"
ALT_APLIC = "aplicacao"   # foto real no campo/máquina — fica no fim da galeria

# planilha master (.xlsx no Drive — ver integra/README.md)
SHEET_ID = "1FoyfpY5E4Z4dYcEk7hiP2Jrg_dts6teu"
ADMIN = "admin@agropecaspadrao.com.br"
MASTER_LOCAL = REPO / "util" / "APP_Master_Produtos_Shopify.xlsx"
COL_IMG = "Imagens site (assets)"
LINHA_CABECALHO = 5
ABAS = ["02_SOHIPREN", "03_AGCO", "04_GRECO", "05_JOHN_DEERE",
        "06_STARA", "07_GTS", "08_FERTISYSTEM"]
MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# ── catálogo de tratamentos ──────────────────────────────────────────────────
# colagem: arquivo com vários quadros numa grade; "linhas"/"colunas" são os
#          limites em px de cada quadro (evita pegar o filete branco separador).
# quadros: ordem de publicação — o 1º vira o *_ecommerce (fonte da capa no 06).
CONFIG = {
    "5.1305.0565094.0": {
        "prefixo": "app_5.1305.0565094.0",
        "originais": "5.1305.0565094.0_sohipern_Fot_*.jpeg",
        "colagem": "5.1305.0565094.0_sohipern_Fot_1.jpeg",
        "linhas": [(4, 375), (391, 789), (806, 1200), (1220, 1594)],
        "colunas": [(4, 428), (443, 849)],
        "quadros": [5, 7, 1, 4],
        "legendas": ["vista das saídas hidráulicas", "vista lateral completa",
                     "flange de montagem e eixo estriado", "face de montagem"],
    },
    # modo "avulsas": fotos soltas (uma peça por arquivo), sem colagem.
    # "aplicacao" = fotos reais na máquina que ficam no ar (fim da galeria).
    "APP00001": {
        "prefixo": "app_APP00001",
        "avulsas": ["APP00001.jpg"],
        "legendas": ["vista frontal da roda compactadora"],
        "aplicacao": [("APP00001_2", "roda compactadora montada na linha da plantadeira"),
                      ("APP00001_3", "plantadeira em operação com as rodas compactadoras")],
    },
    # ── AGCO (fotos de estúdio do fornecedor, Drive AGCO/ACX2865730 —
    #    id da subpasta 1tg84puRw73oM4OjtEQuIAONPRb1oSt_G). Peça preta fechada,
    #    sem vazado: o Vision resolve sozinho contra o fundo claro.
    "ACX2865730": {
        "prefixo": "agco_ACX2865730",
        "avulsas": ["07a46b90-6345-41c2-87fa-b907acd976e7.png",
                    "e66ab16a-2695-499b-a529-ed2be4974e77.png",
                    "5eaec69f-dbb2-4128-90b6-fa81b4627a8f.png"],
        "legendas": ["vista em perspectiva com as travas de encaixe",
                     "vista lateral", "vista do lado oposto"],
    },
    # ── FertiSystem (fotos do fornecedor, Drive 1oAhHYrzql7kKGNTCiUMWTUI8d3UDX33c,
    #    uma subpasta por peça; passe --dir apontando para a subpasta baixada) ──
    # "vazados" declara o furo passante por foto (índice 1-based em "avulsas"), porque
    # o Vision trata vazado como parte do assunto — ver recorte_limpeza.py.
    "200201007": {
        "prefixo": "app_200201007",
        "avulsas": ["IMG_20260628_122146.jpg", "IMG_20260628_122156.jpg"],
        "legendas": ["vista superior do anel trava", "vista lateral"],
        "vazados": {1: {"caixas": [(0.20, 0.24, 0.85, 0.80)], "tol": 1.4}},
    },
    "6006010001": {
        "prefixo": "app_6006010001",
        "avulsas": ["IMG_20260628_122807.jpg", "IMG_20260628_122737.jpg",
                    "IMG_20260628_122743.jpg"],
        "legendas": ["vista frontal com a janela quadrada", "vista superior",
                     "vista em perspectiva"],
        "vazados": {
            1: {"caixas": [(0.31, 0.26, 0.69, 0.70)], "tol": 1.4, "forma": "retangulo"},
            2: {"caixas": [(0.31, 0.24, 0.68, 0.66)], "tol": 1.4, "forma": "retangulo"},
            3: {"caixas": [(0.33, 0.25, 0.69, 0.68)], "tol": 1.4, "forma": "retangulo"},
        },
    },
    "200201014": {
        "prefixo": "app_200201014",
        "avulsas": ["IMG_20260628_121358.jpg", "IMG_20260628_121418.jpg",
                    "IMG_20260628_121406.jpg"],
        "legendas": ["vista frontal do bocal", "vista do encaixe superior", "vista lateral"],
    },
    "200201038": {
        "prefixo": "app_200201038",
        "avulsas": ["IMG_20260628_122409.jpg", "IMG_20260628_122444.jpg",
                    "IMG_20260628_122437.jpg"],
        "legendas": ["eixo completo", "vista em perspectiva", "detalhe da cabeça"],
    },
    "200201012": {
        "prefixo": "app_200201012",
        "avulsas": ["WhatsApp Image 2026-08-19 at 22.01.38.jpeg",
                    "WhatsApp Image 2026-08-19 at 22.01.39.jpeg",
                    "WhatsApp Image 2026-08-19 at 22.01.39 (1).jpeg"],
        "legendas": ["vista lateral do pinhão", "vista frontal dos dentes",
                     "vista em perspectiva"],
    },
    "200201008": {
        "prefixo": "app_200201008",
        "avulsas": ["IMG_20260628_121645.jpg", "IMG_20260628_121656.jpg",
                    "IMG_20260628_121722.jpg"],
        "legendas": ["vista frontal da tampa", "vista interna", "vista lateral"],
    },
    "25075701": {
        "prefixo": "app_25075701",
        "avulsas": ["TEL_3.jpg", "TEL_4.jpg", "TEL_1.jpg"],
        "legendas": ["tubo telescópico estendido", "tubo telescópico recolhido",
                     "vista do encaixe superior"],
    },
}


def quadros_da_colagem(path, linhas, colunas):
    src = Image.open(path).convert("RGB")
    out = {}
    n = 0
    for y0, y1 in linhas:
        for x0, x1 in colunas:
            n += 1
            out[n] = src.crop((x0, y0, x1, y1))
    return out


def recorta_fundo(im):
    """Peça sem fundo, via Vision. Devolve RGBA."""
    with tempfile.TemporaryDirectory() as td:
        src, dst = Path(td) / "in.png", Path(td) / "out.png"
        im.save(src)
        r = subprocess.run(["swift", str(SWIFT), str(src), str(dst)],
                           capture_output=True, text=True)
        if r.returncode != 0 or not dst.exists():
            raise RuntimeError(f"recorte falhou: {r.stderr.strip() or r.stdout.strip()}")
        out = Image.open(dst)
        out.load()
        return out.convert("RGBA")


def em_branco(part, lado=LADO, margem=MARGEM):
    bbox = part.getbbox()
    if not bbox:
        raise ValueError("recorte vazio")
    part = part.crop(bbox)
    caixa = lado - 2 * int(lado * margem)
    s = min(caixa / part.width, caixa / part.height)
    part = part.resize((max(1, round(part.width * s)), max(1, round(part.height * s))),
                       Image.LANCZOS)
    canvas = Image.new("RGBA", (lado, lado), (255, 255, 255, 255))
    canvas.paste(part, ((lado - part.width) // 2, (lado - part.height) // 2), part)
    return canvas.convert("RGB")


def preparar(sku, origem):
    cfg = CONFIG[sku]
    origem = Path(origem).expanduser()
    if not origem.is_dir():
        sys.exit(f"pasta de origem não encontrada: {origem}")

    if "avulsas" in cfg:
        fontes = [(f, origem / f) for f in cfg["avulsas"]]
    else:
        quadros = quadros_da_colagem(origem / cfg["colagem"], cfg["linhas"], cfg["colunas"])
        fontes = [(f"quadro {n}", quadros[n]) for n in cfg["quadros"]]

    saidas = []
    vazados = cfg.get("vazados") or {}
    for i, (rotulo, fonte) in enumerate(fontes, start=1):
        nome = f"{cfg['prefixo']}_ecommerce{'' if i == 1 else f'_{i}'}.png"
        destino = ASSETS / nome
        im = Image.open(fonte).convert("RGB") if isinstance(fonte, Path) else fonte
        im.thumbnail((MAX_VISION, MAX_VISION), Image.LANCZOS)
        peca = tirar_franja(recorta_fundo(im))
        rec = vazados.get(i)
        if rec:
            peca = remover_furo(peca, im, rec["caixas"], tol=rec.get("tol", 3.2),
                                forma=rec.get("forma", "auto"))
        em_branco(peca).save(destino, "PNG")
        saidas.append(destino)
        print(f"  ✔ {rotulo} → assets/{nome}")
    return saidas


# ── Shopify ──────────────────────────────────────────────────────────────────
Q_PROD = """
query($q: String!) {
  products(first: 1, query: $q) {
    nodes {
      id title
      media(first: 30) { nodes { id mediaContentType ... on MediaImage { alt image { url } } } }
    }
  }
}"""


M_ALT = """
mutation($productId: ID!, $media: [UpdateMediaInput!]!) {
  productUpdateMedia(productId: $productId, media: $media) {
    media { id }
    mediaUserErrors { field message }
  }
}"""


def marca_aplicacao(env, token, prod, cfg):
    """Rotula as fotos reais na máquina (alt 'aplicacao N') p/ sobreviverem ao --limpar."""
    pares = cfg.get("aplicacao") or []
    if not pares:
        return
    midias = [x for x in prod["media"]["nodes"] if x["mediaContentType"] == "IMAGE"]
    updates = []
    for i, (frag, legenda) in enumerate(pares, start=1):
        alvo = next((x for x in midias if frag in (x.get("image") or {}).get("url", "")), None)
        if not alvo:
            print(f"  ! foto de aplicação não encontrada no produto: {frag}")
            continue
        alt = f"{ALT_APLIC} {i} | {prod['title']} — {legenda}"
        if (alvo.get("alt") or "") == alt:
            continue
        updates.append({"id": alvo["id"], "alt": alt})
    if not updates:
        return
    r = shopify_graphql(env, token, M_ALT,
                        {"productId": prod["id"], "media": updates})["productUpdateMedia"]
    if r["mediaUserErrors"]:
        sys.exit(r["mediaUserErrors"])
    print(f"  ✔ {len(updates)} foto(s) de aplicação rotulada(s)")


def _mod06():
    """Reaproveita staged_upload/mutations do 06 (nome de módulo começa com dígito)."""
    spec = importlib.util.spec_from_file_location("capas06", BASE / "06_capas_ecommerce.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def subir(sku, arquivos, limpar=False):
    cfg = CONFIG[sku]
    m06 = _mod06()
    env = load_env()
    token = shopify_token(env)

    d = shopify_graphql(env, token, Q_PROD, {"q": f"sku:{sku}"})
    nodes = d["products"]["nodes"]
    if not nodes:
        sys.exit(f"produto não encontrado para o SKU {sku}")
    prod = nodes[0]
    print(f"produto: {prod['title']}")

    marca_aplicacao(env, token, prod, cfg)

    midias = [x for x in prod["media"]["nodes"] if x["mediaContentType"] == "IMAGE"]
    ja_no_ar = {(x.get("alt") or "").split("|")[0].strip() for x in midias}

    novos = []
    for i, f in enumerate(arquivos):
        legenda = cfg["legendas"][i] if i < len(cfg["legendas"]) else ""
        alt = f"{ALT_TAG} {i + 1} | {prod['title']} — {legenda}".rstrip(" —")
        if any(a.startswith(f"{ALT_TAG} {i + 1}") for a in ja_no_ar):
            print(f"  = {f.name} já publicada (idempotente)")
            continue
        res_url = m06.staged_upload(env, token, f.name, f.read_bytes())
        r = shopify_graphql(env, token, m06.M_CREATE_MEDIA, {
            "productId": prod["id"],
            "media": [{"mediaContentType": "IMAGE", "originalSource": res_url, "alt": alt}],
        })["productCreateMedia"]
        if r["mediaUserErrors"]:
            sys.exit(r["mediaUserErrors"])
        mid = r["media"][0]["id"]
        if not m06.wait_media_ready(env, token, prod["id"], mid):
            sys.exit(f"mídia {f.name} não ficou READY")
        novos.append(mid)
        print(f"  ✔ {f.name} publicada")

    if limpar:
        cruas = [x["id"] for x in shopify_graphql(env, token, Q_PROD, {"q": f"sku:{sku}"})
                 ["products"]["nodes"][0]["media"]["nodes"]
                 if x["mediaContentType"] == "IMAGE"
                 and not (x.get("alt") or "").startswith(("capa-app", ALT_TAG, ALT_APLIC))]
        if cruas:
            r = shopify_graphql(env, token, m06.M_DEL_MEDIA,
                                {"productId": prod["id"], "mediaIds": cruas})["productDeleteMedia"]
            if r["mediaUserErrors"]:
                sys.exit(r["mediaUserErrors"])
            print(f"  ✔ {len(cruas)} foto(s) crua(s) removida(s) do produto")

    ordenar(env, token, prod["id"])


def ordenar(env, token, product_id):
    """Capa v2 → fotos de estúdio → fotos de aplicação → demais (bancada)."""
    m06 = _mod06()
    d = shopify_graphql(env, token, """
      query($id: ID!) { product(id: $id) {
        media(first: 30) { nodes { id mediaContentType ... on MediaImage { alt } } } } }""",
                        {"id": product_id})
    midias = [x for x in d["product"]["media"]["nodes"] if x["mediaContentType"] == "IMAGE"]

    def peso(x):
        alt = (x.get("alt") or "")
        if alt.startswith("capa-app"):
            return (0, 0)
        for nivel, tag in ((1, ALT_TAG), (2, ALT_APLIC)):
            if alt.startswith(tag):
                try:
                    return (nivel, int(alt.split("|")[0].split()[-1]))
                except ValueError:
                    return (nivel, 99)
        return (3, 0)

    ordem = sorted(midias, key=peso)
    moves = [{"id": x["id"], "newPosition": str(i)} for i, x in enumerate(ordem)]
    r = shopify_graphql(env, token, m06.M_REORDER, {"id": product_id, "moves": moves})
    if r["productReorderMedia"]["mediaUserErrors"]:
        sys.exit(r["productReorderMedia"]["mediaUserErrors"])
    print("galeria reordenada: capa → estúdio → aplicação → bancada")


# ── planilha master ──────────────────────────────────────────────────────────
def _gtoken():
    r = subprocess.run(["gcloud", "auth", "print-access-token", f"--account={ADMIN}"],
                       capture_output=True, text=True)
    tk = r.stdout.strip()
    if not tk:
        sys.exit("token do Drive indisponível — rode: "
                 f"gcloud auth login {ADMIN} --enable-gdrive-access --force")
    return tk


def _drive(url, data=None, method="GET", headers=None, raw=False):
    h = {"Authorization": "Bearer " + _gtoken()}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=180) as r:
        b = r.read()
    return b if raw else (json.loads(b) if b else {})


def _grava_coluna(caminho, sku, valor):
    """Escreve `valor` na coluna 'Imagens site (assets)' das linhas do SKU."""
    wb = openpyxl.load_workbook(caminho)  # data_only=False: preserva fórmulas
    tocadas = []
    for aba in ABAS:
        if aba not in wb.sheetnames:
            continue
        ws = wb[aba]
        hdrs = {c: str(ws.cell(LINHA_CABECALHO, c).value)
                for c in range(1, ws.max_column + 1) if ws.cell(LINHA_CABECALHO, c).value}
        col = next((c for c, h in hdrs.items() if h == COL_IMG), None)
        if col is None:
            col = max(hdrs) + 1
            ws.cell(LINHA_CABECALHO, col, COL_IMG)
        for r in range(LINHA_CABECALHO + 1, ws.max_row + 1):
            if str(ws.cell(r, 1).value or "").strip() == sku:
                ws.cell(r, col, valor)
                tocadas.append(f"{aba}!linha {r}")
    if not tocadas:
        sys.exit(f"SKU {sku} não encontrado na planilha")
    wb.save(caminho)
    return tocadas


def atualizar_planilha(sku, arquivos):
    valor = " | ".join(f.name for f in arquivos)
    with tempfile.TemporaryDirectory() as td:
        fresh = Path(td) / "master.xlsx"
        fresh.write_bytes(_drive(
            f"https://www.googleapis.com/drive/v3/files/{SHEET_ID}?alt=media&supportsAllDrives=true",
            raw=True))
        print(f"master baixada do Drive ({fresh.stat().st_size} bytes)")

        for onde in _grava_coluna(fresh, sku, valor):
            print(f"  ✔ {onde} → {COL_IMG}")

        _drive(f"https://www.googleapis.com/upload/drive/v3/files/{SHEET_ID}"
               "?uploadType=media&supportsAllDrives=true",
               data=fresh.read_bytes(), method="PATCH", headers={"Content-Type": MIME_XLSX})

        # openpyxl apaga o cache de valores das fórmulas (toda leitura data_only=True
        # passaria a ver None): copy -> Google Sheets recalcula -> export -> PATCH -> delete.
        cp = _drive(f"https://www.googleapis.com/drive/v3/files/{SHEET_ID}/copy?supportsAllDrives=true",
                    data=json.dumps({"mimeType": "application/vnd.google-apps.spreadsheet",
                                     "name": "tmp_recalc_master"}).encode(),
                    method="POST", headers={"Content-Type": "application/json"})
        xb = _drive(f"https://www.googleapis.com/drive/v3/files/{cp['id']}/export"
                    f"?mimeType={urllib.parse.quote(MIME_XLSX)}", raw=True)
        _drive(f"https://www.googleapis.com/upload/drive/v3/files/{SHEET_ID}"
               "?uploadType=media&supportsAllDrives=true",
               data=xb, method="PATCH", headers={"Content-Type": MIME_XLSX})
        _drive(f"https://www.googleapis.com/drive/v3/files/{cp['id']}?supportsAllDrives=true",
               method="DELETE")
        print("master do Drive atualizada (cache de fórmulas reparado)")

        # cópia local = espelho do Drive já recalculado
        if MASTER_LOCAL.exists():
            carimbo = datetime.datetime.now().strftime("%Y%m%d_%H%M")
            bkp = BASE / "backup" / f"APP_Master_Produtos_Shopify_{carimbo}_pre_fotos.xlsx"
            bkp.parent.mkdir(exist_ok=True)
            shutil.copyfile(MASTER_LOCAL, bkp)
            print(f"backup da cópia local: {bkp.relative_to(REPO)}")
        MASTER_LOCAL.write_bytes(xb)
        print(f"cópia local atualizada: {MASTER_LOCAL.relative_to(REPO)}")


def main():
    if "--sku" not in sys.argv:
        sys.exit(__doc__)
    sku = sys.argv[sys.argv.index("--sku") + 1]
    if sku not in CONFIG:
        sys.exit(f"SKU sem receita em CONFIG: {sku}")
    origem = (sys.argv[sys.argv.index("--dir") + 1] if "--dir" in sys.argv
              else "~/Downloads/drive-download-20260817T224425Z-1-001")
    arquivos = preparar(sku, origem)
    if "--subir" in sys.argv:
        subir(sku, arquivos, limpar="--limpar" in sys.argv)
    if "--planilha" in sys.argv:
        atualizar_planilha(sku, arquivos)


if __name__ == "__main__":
    main()
