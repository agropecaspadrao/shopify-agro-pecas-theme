"""
Atualiza produtos Shopify:
  1. Imagem principal  → fotos_ecommerce_removebg (fundo removido)
  2. Imagem 2          → desenho técnico (desenho_tec.png)
  3. Metafield PDF     → ficha técnica (catalogo_sohipren)

Lê credenciais do .env na mesma pasta.
"""

import os, sys, re, json, time, mimetypes, pathlib
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import HTTPError
import urllib.request

# ── config ────────────────────────────────────────────────────────────────────
BASE_DIR   = pathlib.Path(__file__).parent
ENV_FILE   = BASE_DIR / ".env"
PHOTOS_DIR = pathlib.Path("/Users/guilhermeferreira/Documents/DEV/app_uteis/output/fotos_ecommerce_removebg")
RECORTES_DIR = pathlib.Path("/Users/guilhermeferreira/Documents/DEV/app_uteis/output/recortes")
CATALOG_DIR  = pathlib.Path("/Users/guilhermeferreira/Documents/DEV/app_uteis/catalogo_sohipren")
API_VERSION  = "2025-01"

# ── helpers ───────────────────────────────────────────────────────────────────

def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

def get_token(shop, client_id, client_secret):
    url  = f"https://{shop}.myshopify.com/admin/oauth/access_token"
    data = urlencode({
        "grant_type":    "client_credentials",
        "client_id":     client_id,
        "client_secret": client_secret,
    }).encode()
    req = Request(url, data=data, method="POST")
    with urlopen(req) as r:
        return json.loads(r.read())["access_token"]

def api_get(base_url, token, path, params=None):
    url = f"{base_url}{path}"
    if params:
        url += "?" + urlencode(params)
    req = Request(url, headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    with urlopen(req) as r:
        return json.loads(r.read())

def api_post(base_url, token, path, body):
    url  = f"{base_url}{path}"
    data = json.dumps(body).encode()
    req  = Request(url, data=data, method="POST",
                   headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    try:
        with urlopen(req) as r:
            return json.loads(r.read())
    except HTTPError as e:
        print(f"    ✗ HTTP {e.code}: {e.read().decode()[:200]}")
        return None

def api_delete(base_url, token, path):
    url = f"{base_url}{path}"
    req = Request(url, method="DELETE", headers={"X-Shopify-Access-Token": token})
    try:
        with urlopen(req) as r:
            return True
    except HTTPError as e:
        print(f"    ✗ DELETE HTTP {e.code}")
        return False

def graphql(shop, token, query, variables=None):
    url  = f"https://{shop}.myshopify.com/admin/api/{API_VERSION}/graphql.json"
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req  = Request(url, data=body, method="POST",
                   headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    with urlopen(req) as r:
        return json.loads(r.read())

def upload_file_staged(shop, token, filepath: pathlib.Path):
    """Upload file via Shopify staged uploads (GraphQL) — returns publicUrl."""
    mime = mimetypes.guess_type(str(filepath))[0] or "application/octet-stream"
    size = filepath.stat().st_size

    # 1. Create staged upload target
    q_create = """
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
    """
    res = graphql(shop, token, q_create, {"input": [{
        "filename":   filepath.name,
        "mimeType":   mime,
        "httpMethod": "POST",
        "resource":   "FILE",
        "fileSize":   str(size),
    }]})
    targets = res["data"]["stagedUploadsCreate"]["stagedTargets"]
    if not targets:
        print(f"    ✗ stagedUploadsCreate failed: {res}")
        return None

    target = targets[0]
    upload_url = target["url"]
    params     = {p["name"]: p["value"] for p in target["parameters"]}
    resource_url = target["resourceUrl"]

    # 2. POST file to S3/GCS
    import http.client, urllib.parse
    boundary = "----ShopifyBoundary7MA4YWxkTrZu0gW"
    body_parts = []
    for k, v in params.items():
        body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}")
    body_parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filepath.name}\"\r\nContent-Type: {mime}\r\n"
    )
    prefix = ("\r\n".join(body_parts) + "\r\n").encode()
    suffix = f"\r\n--{boundary}--\r\n".encode()
    file_data = filepath.read_bytes()
    full_body = prefix + file_data + suffix

    parsed = urllib.parse.urlparse(upload_url)
    conn = http.client.HTTPSConnection(parsed.netloc)
    conn.request("POST", parsed.path + ("?" + parsed.query if parsed.query else ""),
                 body=full_body,
                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                          "Content-Length": str(len(full_body))})
    resp = conn.getresponse()
    if resp.status not in (200, 201, 204):
        print(f"    ✗ S3 upload failed: {resp.status} {resp.read()[:200]}")
        return None
    conn.close()

    # 3. Create File in Shopify Files
    q_file = """
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id ... on MediaImage { image { url } } ... on GenericFile { url } }
        userErrors { field message }
      }
    }
    """
    res2 = graphql(shop, token, q_file, {"files": [{
        "originalSource": resource_url,
        "contentType": "IMAGE" if mime.startswith("image") else "FILE",
    }]})
    files = res2["data"]["fileCreate"]["files"]
    if not files:
        print(f"    ✗ fileCreate failed: {res2}")
        return None

    # Wait for file to be ready (poll up to 15s)
    file_id = files[0]["id"]
    for _ in range(10):
        time.sleep(1.5)
        q_poll = """
        query getFile($id: ID!) {
          node(id: $id) {
            ... on MediaImage { image { url } }
            ... on GenericFile { url }
          }
        }
        """
        pr = graphql(shop, token, q_poll, {"id": file_id})
        node = pr.get("data", {}).get("node", {})
        url  = node.get("image", {}).get("url") or node.get("url")
        if url:
            return url

    return resource_url  # fallback

def extract_sku_code(filename: str) -> str | None:
    """Extract the numeric code (e.g. 548836) from a filename."""
    # Pattern: 4+ digits after underscore, before next underscore
    m = re.search(r'_(\d{5,7})[_\-]', filename)
    return m.group(1) if m else None

def find_product_by_sku(base_url, token, sku_code):
    """Search products by SKU variant."""
    res = api_get(base_url, token, "/products.json", {"limit": 250})
    for p in res.get("products", []):
        for v in p.get("variants", []):
            if sku_code in (v.get("sku") or ""):
                return p
    return None

def set_product_image(base_url, token, product_id, image_path: pathlib.Path, position=1, alt=""):
    """Upload and set product image at given position."""
    import base64
    img_b64 = base64.b64encode(image_path.read_bytes()).decode()
    body = {"image": {
        "attachment": img_b64,
        "filename":   image_path.name,
        "position":   position,
        "alt":        alt,
    }}
    return api_post(base_url, token, f"/products/{product_id}/images.json", body)

def set_product_pdf_metafield(base_url, token, product_id, pdf_url, pdf_name):
    """Set metafield agro.ficha_tecnica with PDF URL."""
    body = {"metafield": {
        "namespace": "agro",
        "key":       "ficha_tecnica",
        "type":      "url",
        "value":     pdf_url,
    }}
    return api_post(base_url, token, f"/products/{product_id}/metafields.json", body)

# ── build index ───────────────────────────────────────────────────────────────

def build_index():
    """
    Returns dict: sku_code -> {
        'photo': Path or None,
        'desenho_tec': [Path],
        'pdfs': [Path],
        'metadata': dict
    }
    """
    index = {}

    # Index photos
    for f in PHOTOS_DIR.glob("*_foto_3d_ecommerce.png"):
        code = extract_sku_code(f.name)
        if code:
            index.setdefault(code, {"photo": None, "desenho_tec": [], "pdfs": [], "metadata": {}})
            index[code]["photo"] = f

    # Index desenho_tec
    for f in RECORTES_DIR.rglob("*_desenho_tec.png"):
        code = extract_sku_code(f.name)
        if code:
            index.setdefault(code, {"photo": None, "desenho_tec": [], "pdfs": [], "metadata": {}})
            index[code]["desenho_tec"].append(f)

    # Index PDFs + metadata
    for folder in CATALOG_DIR.iterdir():
        if not folder.is_dir():
            continue
        code = re.search(r'_(\d{5,7})$', folder.name)
        if not code:
            continue
        code = code.group(1)
        index.setdefault(code, {"photo": None, "desenho_tec": [], "pdfs": [], "metadata": {}})
        for f in folder.glob("*.pdf"):
            index[code]["pdfs"].append(f)
        meta_f = folder / "metadata.json"
        if meta_f.exists():
            index[code]["metadata"] = json.loads(meta_f.read_text())

    return index

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    env = load_env()
    shop          = env.get("SHOPIFY_SHOP", "agro-pecas-padrao-2")
    client_id     = env.get("SHOPIFY_CLIENT_ID")
    client_secret = env.get("SHOPIFY_CLIENT_SECRET")

    if not client_id or not client_secret:
        print("❌ Configure SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET no .env")
        sys.exit(1)

    print("🔑 Obtendo token de acesso...")
    token    = get_token(shop, client_id, client_secret)
    base_url = f"https://{shop}.myshopify.com/admin/api/{API_VERSION}"
    print(f"✅ Token obtido. Loja: {shop}\n")

    index = build_index()
    print(f"📦 {len(index)} códigos de peça indexados\n")

    results = {"ok": [], "sem_produto": [], "sem_foto": [], "erros": []}

    for code, assets in sorted(index.items()):
        print(f"── SKU {code} ──────────────────────────────")

        # Find product
        product = find_product_by_sku(base_url, token, code)
        if not product:
            print(f"  ⚠  Produto não encontrado na loja (SKU contendo {code})")
            results["sem_produto"].append(code)
            continue

        pid   = product["id"]
        title = product["title"]
        print(f"  ✓ Produto: [{pid}] {title}")

        # 1. Main photo
        if assets["photo"]:
            print(f"  📷 Imagem principal: {assets['photo'].name}")
            r = set_product_image(base_url, token, pid, assets["photo"], position=1,
                                  alt=f"{title} — foto 3D")
            if r and r.get("image"):
                print(f"     ✓ Upload ok (id {r['image']['id']})")
            else:
                print(f"     ✗ Falhou")
                results["erros"].append(f"{code} imagem")
        else:
            print(f"  ⚠  Sem foto 3D")
            results["sem_foto"].append(code)

        # 2. Desenho técnico
        for i, dt in enumerate(assets["desenho_tec"], start=2):
            print(f"  📐 Desenho técnico ({i}): {dt.name}")
            r = set_product_image(base_url, token, pid, dt, position=i,
                                  alt=f"{title} — desenho técnico")
            if r and r.get("image"):
                print(f"     ✓ Upload ok (id {r['image']['id']})")
            else:
                print(f"     ✗ Falhou")
            time.sleep(0.5)

        # 3. PDFs via staged upload → metafield
        for pdf in assets["pdfs"]:
            print(f"  📄 PDF: {pdf.name}")
            pdf_url = upload_file_staged(shop, token, pdf)
            if pdf_url:
                r = set_product_pdf_metafield(base_url, token, pid, pdf_url, pdf.name)
                if r and r.get("metafield"):
                    print(f"     ✓ Metafield agro.ficha_tecnica definido")
                else:
                    print(f"     ✗ Metafield falhou")
            else:
                print(f"     ✗ Upload do PDF falhou")
            time.sleep(0.5)

        results["ok"].append(code)
        time.sleep(0.3)  # rate limit

    # Summary
    print("\n" + "="*50)
    print(f"✅ Atualizados:         {len(results['ok'])}")
    print(f"⚠  Sem produto na loja: {len(results['sem_produto'])} → {results['sem_produto']}")
    print(f"⚠  Sem foto 3D:        {len(results['sem_foto'])} → {results['sem_foto']}")
    print(f"✗  Erros:              {len(results['erros'])} → {results['erros']}")

    # Save log
    log_path = BASE_DIR / "resultado.json"
    log_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\n📋 Log salvo em {log_path}")

if __name__ == "__main__":
    main()
