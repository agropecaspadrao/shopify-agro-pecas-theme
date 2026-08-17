# -*- coding: utf-8 -*-
"""06 — Gera capas de e-commerce (fundo institucional + peça sem fundo + código/categoria)
e as sobe como 1ª imagem de cada produto no Shopify (a foto atual vira 2ª).

Layout aprovado 08/08/2026: fundo assets/fundo_ecom_v2.png (logo APP embutido),
código em JetBrains Mono dourado com filetes, categoria em Barlow Condensed
ExtraBold verde, peça central (~35% da área) com sombra suave.

Uso:
    python3 06_capas_ecommerce.py            # só gera as artes em capas/ + relatório
    python3 06_capas_ecommerce.py --subir    # gera (cache) e sobe no Shopify
    python3 06_capas_ecommerce.py --sku X    # limita a um SKU (teste)

Fonte da peça: 1ª imagem do produto que passe no teste de fundo branco
(borda ≥90% quase branca). Fotos de celular (rn-image_picker/Screenshot)
são ignoradas — produtos só com essas fotos ficam no relatório como pendentes.
"""
import io, json, re, sys, time, unicodedata, urllib.request
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import load_env, shopify_token, shopify_graphql

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = Path(__file__).parent
REPO = BASE.parent.parent
BG_PATH = REPO / "assets" / "fundo_ecom_v2.png"
CAPAS = BASE / "capas"
CACHE = CAPAS / "_fontes_originais"
FONTS = CAPAS / "_fonts"
REL = BASE / "relatorios"

GOLD = (184, 148, 43, 255)
GREEN = (22, 51, 40, 255)
ALT_TAG = "capa-app-v2"          # v2 (08/08): descrição curta no lugar da categoria
OLD_ALT_PREFIX = "capa-app-"     # qualquer versão anterior é substituída

FONT_URLS = {
    "BarlowCondensed-ExtraBold.ttf": "https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-ExtraBold.ttf",
    "JetBrainsMono.ttf": "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
}

# bombas que ficam só com bomba_generica.png (script 07) — sem capa padrão
SKIP_SKUS = {"5.1305.0565032.0", "5.0220.0547207", "5.0220.0548817", "5.0209.0547219"}

# fonte manual: SKU -> arquivo em assets (quando o matching automático não serve)
SOURCE_OVERRIDES = {
    "GR140990-20M": "greco_GR140990-30M_ecommerce.png",  # asset branco do 20M foi apagado; peça é a mesma
    # sensores de fluxo: a foto do site tem sombra de chão, que a remoção de fundo
    # deixaria como manchas claras sobre o creme — a capa usa a versão sem sombra
    "APP142226": "app_sensor_fluxo_capa_src.png",
    "APP142227": "app_sensor_fluxo_capa_src.png",
    "APP142228": "app_sensor_fluxo_capa_src.png",
}

MARCAS = ["Ford New Holland", "Case/New Holland", "Massey Ferguson", "Valtra-Valmet",
          "John Deere", "New Holland", "Valtra", "Case", "AGCO", "Stara", "GTS", "APP"]
BOMBA_KINDS = ["Bomba Hidráulica", "Bomba de Aplicação", "Bomba de Direção",
               "Motor Hidráulico", "Motor de Aplicação", "Bomba", "Motor"]

DESC_OVERRIDES = {
    "5.1305.0565115.0": "Bomba de Aplicação John Deere",  # título usa "JD"
}

def descricao_curta(title, sku):
    """Descrição básica curta p/ a capa: 'Peça - Marca' ou 'Bomba Hidráulica Marca'."""
    if sku in DESC_OVERRIDES:
        return DESC_OVERRIDES[sku]
    t = title.split("|")[0].strip()
    t = re.sub(r"\s*-\s*Kit\s+\d+\s+Unidades\s*", " ", t, flags=re.I).strip()
    t = re.sub(r"\s{2,}", " ", t)
    low = t.lower()
    if low.startswith(("bomba", "motor")):
        kind = next((k for k in BOMBA_KINDS if low.startswith(k.lower())), "Bomba Hidráulica")
        marca = next((m for m in MARCAS if m.lower() in low), None)
        return f"{kind} {marca}" if marca else kind
    left = t.split(" - ")[0].strip()
    resto = t[len(left):]
    marca = next((m for m in MARCAS if m.lower() in resto.lower()), None)
    return f"{left} - {marca}" if marca else left

# ── infra ────────────────────────────────────────────────────────────────────

def ensure_fonts():
    FONTS.mkdir(parents=True, exist_ok=True)
    for name, url in FONT_URLS.items():
        p = FONTS / name
        if not p.exists() or p.stat().st_size < 10000:
            urllib.request.urlretrieve(url, p)

def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "app-capas/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

# ── remoção de fundo / composição (layout aprovado) ─────────────────────────

def white_border_ratio(im, thresh=235):
    rgb = np.asarray(im.convert("RGB"), dtype=np.int16)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return float((border.min(axis=1) >= thresh).mean())

def remove_white_bg(im, thresh=238):
    rgb = np.asarray(im.convert("RGB"), dtype=np.int16)
    h, w, _ = rgb.shape
    near_white = rgb.min(axis=2) >= thresh
    bg = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True; dq.append((ny, nx))
    a = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8))
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert("RGBA")
    out.putalpha(a)
    return out

def fit_font(path, text, max_w, start_size, draw):
    size = start_size
    while size > 10:
        f = ImageFont.truetype(str(path), size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 2
    return ImageFont.truetype(str(path), 10)

def split_lines(text):
    """Divide em 1–3 linhas equilibradas conforme o comprimento."""
    words = text.upper().split()
    if len(words) == 1:
        return words
    n = 1 if len(text) <= 13 else 2 if len(text) <= 26 else 3
    n = min(n, len(words))
    if n == 1:
        return [" ".join(words)]
    best, bestscore = None, 1e9
    if n == 2:
        for i in range(1, len(words)):
            l1, l2 = " ".join(words[:i]), " ".join(words[i:])
            d = abs(len(l1) - len(l2))
            if d < bestscore:
                best, bestscore = [l1, l2], d
    else:
        for i in range(1, len(words) - 1):
            for j in range(i + 1, len(words)):
                ls = [" ".join(words[:i]), " ".join(words[i:j]), " ".join(words[j:])]
                d = max(len(x) for x in ls) - min(len(x) for x in ls)
                if d < bestscore:
                    best, bestscore = ls, d
    return best

def compose(part_im, codigo, descricao, out_path):
    bg = Image.open(BG_PATH).convert("RGBA")
    W, H = bg.size
    canvas = bg.copy()
    draw = ImageDraw.Draw(canvas)
    tcx = int(W * 0.60)
    max_tw = int(W * 0.52)

    # ── 1. métricas do bloco de texto (sem desenhar ainda) ──
    y = int(H * 0.048)
    cod_txt = f"CÓD. {codigo}"
    f_cod = fit_font(FONTS / "JetBrainsMono.ttf", cod_txt, int(max_tw * 0.95), 38, draw)
    try:
        f_cod.set_variation_by_name("Bold")
    except Exception:
        pass
    asc, desc = f_cod.getmetrics()
    ch = asc + desc
    cod_y = y
    y += ch + int(H * 0.012)

    lines = split_lines(descricao)
    fpath = FONTS / "BarlowCondensed-ExtraBold.ttf"
    start = {1: 190, 2: 150, 3: 118}[len(lines)]
    fonts = [fit_font(fpath, ln, max_tw, start, draw) for ln in lines]
    size = min(f.size for f in fonts)
    f_cat = ImageFont.truetype(str(fpath), size)
    a2, d2 = f_cat.getmetrics()
    lh = int((a2 + d2) * 0.80)
    cat_y = y
    y += lh * len(lines) + int(H * 0.014)
    rule_y = y

    # ── 2. peça na faixa livre entre o texto e o logo ──
    part = remove_white_bg(part_im)
    bbox = part.getbbox()
    if not bbox:
        raise ValueError("imagem vazia após remoção de fundo")
    part = part.crop(bbox)
    bw, bh = part.size
    band_top = rule_y + int(H * 0.015)
    band_bot = int(H * 0.875)
    s = (0.32 * W * H / (bw * bh)) ** 0.5
    s = min(s, 0.80 * W / bw, (band_bot - band_top) * 0.96 / bh)
    part = part.resize((max(1, int(bw * s)), max(1, int(bh * s))), Image.LANCZOS)
    pw, ph = part.size
    cx, cy = int(W * 0.585), (band_top + band_bot) // 2
    px, py = cx - pw // 2, cy - ph // 2

    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    a = part.split()[3].point(lambda v: int(v * 0.30))
    tint = Image.new("RGBA", part.size, (20, 35, 28, 255))
    tint.putalpha(a)
    sh.paste(tint, (px + 10, py + 22), tint)
    sh = sh.filter(ImageFilter.GaussianBlur(18))
    canvas = Image.alpha_composite(canvas, sh)
    canvas.paste(part, (px, py), part)
    draw = ImageDraw.Draw(canvas)

    # ── 3. textos por cima ──
    tw = draw.textlength(cod_txt, font=f_cod)
    draw.text((tcx - tw / 2, cod_y), cod_txt, font=f_cod, fill=GOLD)
    ly = cod_y + ch // 2 - 4
    gap, lw_ = 28, 90
    draw.line([(tcx - tw / 2 - gap - lw_, ly), (tcx - tw / 2 - gap, ly)], fill=GOLD, width=3)
    draw.line([(tcx + tw / 2 + gap, ly), (tcx + tw / 2 + gap + lw_, ly)], fill=GOLD, width=3)
    yy = cat_y
    for ln in lines:
        tw = draw.textlength(ln, font=f_cat)
        draw.text((tcx - tw / 2, yy), ln, font=f_cat, fill=GREEN)
        yy += lh
    rw = int(max_tw * 0.55)
    draw.line([(tcx - rw / 2, rule_y), (tcx + rw / 2, rule_y)], fill=GOLD, width=3)

    canvas.convert("RGB").save(out_path, "PNG")

# ── Shopify ──────────────────────────────────────────────────────────────────

Q_PRODUCTS = """
query($after: String) {
  products(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title productType status
      skuOem: metafield(namespace: "agro", key: "sku_oem") { value }
      variants(first: 1) { nodes { sku } }
      media(first: 12) {
        nodes { id mediaContentType ... on MediaImage { alt status image { url width height } } }
      }
    }
  }
}"""

M_STAGED = """
mutation($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}"""

M_CREATE_MEDIA = """
mutation($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { id status }
    mediaUserErrors { field message }
  }
}"""

M_REORDER = """
mutation($id: ID!, $moves: [MoveInput!]!) {
  productReorderMedia(id: $id, moves: $moves) {
    job { id }
    mediaUserErrors { field message }
  }
}"""

M_DEL_MEDIA = """
mutation($productId: ID!, $mediaIds: [ID!]!) {
  productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
    deletedMediaIds
    mediaUserErrors { field message }
  }
}"""

Q_MEDIA_STATUS = """
query($id: ID!) {
  product(id: $id) { media(first: 20) { nodes { id status } } }
}"""

def fetch_products(env, token):
    out, cursor = [], None
    while True:
        d = shopify_graphql(env, token, Q_PRODUCTS, {"after": cursor})
        p = d["products"]
        out.extend(p["nodes"])
        if not p["pageInfo"]["hasNextPage"]:
            return out
        cursor = p["pageInfo"]["endCursor"]

def staged_upload(env, token, filename, data):
    d = shopify_graphql(env, token, M_STAGED, {"input": [{
        "resource": "IMAGE", "filename": filename,
        "mimeType": "image/png", "httpMethod": "POST"}]})
    t = d["stagedUploadsCreate"]
    if t["userErrors"]:
        raise RuntimeError(t["userErrors"])
    tgt = t["stagedTargets"][0]
    boundary = "----appcapas%d" % int(time.time() * 1000)
    parts = []
    for p in tgt["parameters"]:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{p["name"]}"\r\n\r\n{p["value"]}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n'.encode())
    body = b"".join(parts) + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(tgt["url"], data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        r.read()
    return tgt["resourceUrl"]

def wait_media_ready(env, token, product_id, media_id, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = shopify_graphql(env, token, Q_MEDIA_STATUS, {"id": product_id})
        st = {m["id"]: m["status"] for m in d["product"]["media"]["nodes"]}
        if st.get(media_id) == "READY":
            return True
        if st.get(media_id) == "FAILED":
            return False
        time.sleep(2)
    return False

# ── pipeline ─────────────────────────────────────────────────────────────────

def sanitize(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9.\-]+", "-", s).strip("-")

def norm_key(s):
    return re.sub(r"[^A-Z0-9]", "", s.upper())

# fotos placeholder "Imagen no disponible" do catálogo do fornecedor (subidas 08/08)
PLACEHOLDER_RE = re.compile(r"^5_\d{4}_.*\.jpe?g$", re.I)

def build_asset_index():
    """SKU normalizado -> arquivo local *_ecommerce* (prioridade sobre a imagem do site,
    pois os assets têm versões em fundo branco mais novas que o CDN)."""
    idx = {}
    for f in sorted((REPO / "assets").iterdir()):
        m = re.match(r"^(.*?)_ecommerce(?:_(\d+))?\.(png|jpe?g)$", f.name, re.I)
        if not m or "foto_3d" in f.name:
            continue
        left, seq = m.group(1), int(m.group(2) or 0)
        key = norm_key(left)
        cur = idx.get(key)
        if cur is None or seq < cur[0]:
            idx[key] = (seq, f)
    return {k: v[1] for k, v in idx.items()}

def local_asset_for(idx, skus):
    for sku in skus:
        n = norm_key(sku)
        if not n:
            continue
        for key, f in idx.items():
            if key.endswith(n):
                return f
    return None

def cache_key(url):
    name = url.split("/")[-1].split("?")[0]
    return re.sub(r"_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "", name)

def main():
    subir = "--subir" in sys.argv
    only_sku = None
    if "--sku" in sys.argv:
        only_sku = sys.argv[sys.argv.index("--sku") + 1]

    ensure_fonts()
    CAPAS.mkdir(exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    REL.mkdir(exist_ok=True)

    env = load_env()
    token = shopify_token(env)
    prods = fetch_products(env, token)
    print(f"{len(prods)} produtos no site")
    asset_idx = build_asset_index()
    print(f"{len(asset_idx)} imagens *_ecommerce nos assets locais")

    art_cache = {}   # (src_key, codigo, categoria) -> Path
    rows = []
    for p in prods:
        sku = (p["variants"]["nodes"][0]["sku"] or "").strip() if p["variants"]["nodes"] else ""
        if only_sku and sku != only_sku:
            continue
        title = p["title"].strip()
        if p["status"] != "ACTIVE":
            rows.append((sku, title, "pulado", "produto não ativo", ""))
            continue
        if sku in SKIP_SKUS:
            rows.append((sku, title, "pulado", "usa bomba_generica.png (script 07)", ""))
            continue
        images = [m for m in p["media"]["nodes"]
                  if m["mediaContentType"] == "IMAGE" and m.get("image")]
        if not images:
            rows.append((sku, title, "pendente", "sem imagem no produto", ""))
            continue
        if any((m.get("alt") or "").startswith(ALT_TAG) for m in images):
            rows.append((sku, title, "ok", "capa já existente (idempotente)", ""))
            continue
        categoria = descricao_curta(title, sku)
        if not categoria:
            rows.append((sku, title, "pendente", "descrição curta vazia", ""))
            continue
        codigo = ((p["skuOem"] or {}).get("value") or sku).strip()

        src_im, src_key = None, None
        # 0) override manual de fonte
        if sku in SOURCE_OVERRIDES:
            f = REPO / "assets" / SOURCE_OVERRIDES[sku]
            im = Image.open(f)
            im.load()
            src_im, src_key = im, f.name
        # 1) asset local *_ecommerce* do SKU (versões em fundo branco mais novas que o site)
        sku_base = re.sub(r"-KIT\d+$", "", sku, flags=re.I)
        local = local_asset_for(asset_idx, [codigo, sku_base, sku])
        if src_im is None and local is not None:
            im = Image.open(local)
            im.load()
            if white_border_ratio(im) >= 0.90:
                src_im, src_key = im, local.name
        # 2) senão, imagens atuais do produto no CDN
        if src_im is None:
            for m in images:
                url = m["image"]["url"]
                key = cache_key(url)
                if re.search(r"rn-image_picker|Screenshot", key, re.I) or PLACEHOLDER_RE.match(key):
                    continue
                cache_f = CACHE / key
                try:
                    if not cache_f.exists():
                        cache_f.write_bytes(http_get(url))
                    im = Image.open(io.BytesIO(cache_f.read_bytes()))
                    im.load()
                except Exception as e:
                    print(f"  ! {sku}: erro baixando {key}: {e}")
                    continue
                if white_border_ratio(im) >= 0.90:
                    src_im, src_key = im, key
                    break
        if src_im is None:
            rows.append((sku, title, "pendente", "nenhuma imagem com fundo branco (foto de celular?)", ""))
            continue

        out_name = f"capa_{sanitize(sku)}.png"
        out_path = CAPAS / out_name
        ck = (src_key, codigo, categoria)
        try:
            if ck in art_cache:
                if art_cache[ck] != out_path:
                    out_path.write_bytes(art_cache[ck].read_bytes())
            elif not out_path.exists():
                compose(src_im, codigo, categoria, out_path)
            art_cache[ck] = out_path
        except Exception as e:
            rows.append((sku, title, "erro", f"composição falhou: {e}", ""))
            continue

        if not subir:
            rows.append((sku, title, "gerado", f"fonte: {src_key}", out_name))
            print(f"  ✔ {sku} → {out_name}")
            continue

        try:
            # remove capa de versão anterior (v1) antes de subir a nova
            old = [m["id"] for m in images
                   if (m.get("alt") or "").startswith(OLD_ALT_PREFIX)
                   and not (m.get("alt") or "").startswith(ALT_TAG)]
            if old:
                d = shopify_graphql(env, token, M_DEL_MEDIA,
                                    {"productId": p["id"], "mediaIds": old})
                if d["productDeleteMedia"]["mediaUserErrors"]:
                    raise RuntimeError(d["productDeleteMedia"]["mediaUserErrors"])
            alt = f"{ALT_TAG} | {categoria} – Cód. {codigo} | APP Agro Peças Padrão"
            res_url = staged_upload(env, token, out_name, out_path.read_bytes())
            d = shopify_graphql(env, token, M_CREATE_MEDIA, {
                "productId": p["id"],
                "media": [{"mediaContentType": "IMAGE", "originalSource": res_url, "alt": alt}]})
            r = d["productCreateMedia"]
            if r["mediaUserErrors"]:
                raise RuntimeError(r["mediaUserErrors"])
            mid = r["media"][0]["id"]
            if not wait_media_ready(env, token, p["id"], mid):
                raise RuntimeError("mídia não ficou READY")
            d = shopify_graphql(env, token, M_REORDER, {
                "id": p["id"], "moves": [{"id": mid, "newPosition": "0"}]})
            if d["productReorderMedia"]["mediaUserErrors"]:
                raise RuntimeError(d["productReorderMedia"]["mediaUserErrors"])
            rows.append((sku, title, "subido", f"capa em 1ª posição (fonte: {src_key})", out_name))
            print(f"  ✔⇧ {sku} → capa no site")
        except Exception as e:
            rows.append((sku, title, "erro", f"upload falhou: {e}", out_name))
            print(f"  ✖ {sku}: {e}")

    stamp = time.strftime("%Y%m%d")
    rel = REL / f"capas_site_{stamp}.csv"
    with open(rel, "w", encoding="utf-8") as f:
        f.write("SKU,Título,Status,Detalhe,Arquivo capa\n")
        for r in rows:
            f.write(",".join('"' + str(c).replace('"', "'") + '"' for c in r) + "\n")
    from collections import Counter
    print("\nResumo:", dict(Counter(r[2] for r in rows)))
    print("Relatório:", rel)

if __name__ == "__main__":
    main()
