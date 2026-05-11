#!/usr/bin/env python3
"""
Sincroniza a loja Shopify com master_products_import.csv:
  - Atualiza título, descrição HTML, tags, tipo, vendor de produtos existentes
  - Zera inventário de todas as variantes
  - Cria produtos novos (não encontrados por SKU)
  - Lê credenciais do .env na mesma pasta
"""

import csv, json, time, pathlib, sys
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import HTTPError

BASE_DIR    = pathlib.Path(__file__).parent
ENV_FILE    = BASE_DIR / ".env"
CSV_FILE    = BASE_DIR.parent.parent / "master_products_import.csv"
API_VERSION = "2025-01"


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
    req = Request(url, headers={"X-Shopify-Access-Token": token,
                                "Content-Type": "application/json"})
    with urlopen(req) as r:
        return json.loads(r.read())


def api_post(base_url, token, path, body):
    data = json.dumps(body).encode()
    req  = Request(f"{base_url}{path}", data=data, method="POST",
                   headers={"X-Shopify-Access-Token": token,
                             "Content-Type": "application/json"})
    try:
        with urlopen(req) as r:
            return json.loads(r.read())
    except HTTPError as e:
        print(f"    ✗ POST {path} → HTTP {e.code}: {e.read().decode()[:300]}")
        return None


def api_put(base_url, token, path, body):
    data = json.dumps(body).encode()
    req  = Request(f"{base_url}{path}", data=data, method="PUT",
                   headers={"X-Shopify-Access-Token": token,
                             "Content-Type": "application/json"})
    try:
        with urlopen(req) as r:
            return json.loads(r.read())
    except HTTPError as e:
        print(f"    ✗ PUT {path} → HTTP {e.code}: {e.read().decode()[:300]}")
        return None


# ── fetch all products ────────────────────────────────────────────────────────

def fetch_all_products(base_url, token):
    """Retorna todos os produtos da loja (paginação automática)."""
    products = []
    url = f"{base_url}/products.json"
    params = {"limit": 250}
    while url:
        req = Request(url + ("?" + urlencode(params) if params else ""),
                      headers={"X-Shopify-Access-Token": token,
                               "Content-Type": "application/json"})
        params = None  # only first request needs params
        with urlopen(req) as r:
            data = json.loads(r.read())
            products.extend(data.get("products", []))
            # check Link header for next page
            link = r.headers.get("Link", "")
            url = None
            for part in link.split(","):
                if 'rel="next"' in part:
                    url = part.split(";")[0].strip().strip("<>")
                    break
    return products


def build_sku_index(products):
    """Dict: sku_substring → product"""
    idx = {}
    for p in products:
        for v in p.get("variants", []):
            sku = v.get("sku") or ""
            if sku:
                idx[sku] = p
    return idx


# ── read CSV ──────────────────────────────────────────────────────────────────

def read_csv(path):
    """
    Returns list of dicts.
    Variant-only rows (empty handle) are merged into the previous product's variants list.
    """
    products = []
    current  = None
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            handle = row.get("Handle", "").strip()
            title  = row.get("Title", "").strip()
            if handle and title:
                # linha de produto principal
                current = {
                    "handle":    handle,
                    "title":     title,
                    "body_html": row["Body (HTML)"],
                    "vendor":    row["Vendor"],
                    "type":      row["Type"],
                    "tags":      row["Tags"],
                    "published": row["Published"] == "true",
                    "status":    row["Status"],
                    "variants":  [],
                }
                products.append(current)
            # linha de variante (sem handle) ou linha extra de imagem (sem título):
            # apenas adiciona variante se houver SKU e produto ativo
            if current and row.get("Variant SKU", "").strip():
                current["variants"].append({
                    "sku":           row["Variant SKU"].strip(),
                    "option1":       row.get("Option1 Value", "Padrão"),
                    "option1_name":  row.get("Option1 Name", "Título"),
                })
    return products


# ── zero inventory ────────────────────────────────────────────────────────────

def zero_inventory(base_url, token, product):
    """Define inventory_quantity=0 para todas as variantes do produto."""
    pid = product["id"]
    for v in product.get("variants", []):
        vid  = v["id"]
        iloc = v.get("inventory_item_id")
        if not iloc:
            continue
        # get location
        locs = api_get(base_url, token, f"/inventory_levels.json",
                       {"inventory_item_ids": iloc})
        for lv in locs.get("inventory_levels", []):
            if lv.get("available", 0) != 0:
                api_post(base_url, token, "/inventory_levels/set.json", {
                    "inventory_item_id": iloc,
                    "location_id":       lv["location_id"],
                    "available":         0,
                })
        time.sleep(0.2)


# ── update product ────────────────────────────────────────────────────────────

def update_product(base_url, token, product_id, csv_row, shop_product):
    """Atualiza título, body_html, tags, vendor, product_type, status."""
    body = {"product": {
        "id":           product_id,
        "title":        csv_row["title"],
        "body_html":    csv_row["body_html"],
        "vendor":       csv_row["vendor"],
        "product_type": csv_row["type"],
        "tags":         csv_row["tags"],
        "status":       csv_row["status"],
    }}
    return api_put(base_url, token, f"/products/{product_id}.json", body)


# ── create product ────────────────────────────────────────────────────────────

def create_product(base_url, token, csv_row):
    """Cria produto novo com todas as variantes do CSV."""
    option_name = csv_row["variants"][0]["option1_name"] if csv_row["variants"] else "Título"
    has_variants = len(csv_row["variants"]) > 1

    variants = []
    for v in csv_row["variants"]:
        variants.append({
            "sku":                  v["sku"],
            "option1":              v["option1"],
            "price":                "0.00",
            "inventory_management": "shopify",
            "inventory_policy":     "deny",
            "fulfillment_service":  "manual",
            "requires_shipping":    True,
        })

    options = [{"name": option_name}] if has_variants else []

    body = {"product": {
        "title":        csv_row["title"],
        "body_html":    csv_row["body_html"],
        "vendor":       csv_row["vendor"],
        "product_type": csv_row["type"],
        "tags":         csv_row["tags"],
        "status":       csv_row["status"],
        "variants":     variants,
    }}
    if options:
        body["product"]["options"] = options

    return api_post(base_url, token, "/products.json", body)


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    env           = load_env()
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

    print("📦 Buscando todos os produtos da loja...")
    shop_products = fetch_all_products(base_url, token)
    sku_index     = build_sku_index(shop_products)
    print(f"   {len(shop_products)} produtos encontrados na loja\n")

    print(f"📄 Lendo {CSV_FILE.name}...")
    csv_products = read_csv(CSV_FILE)
    print(f"   {len(csv_products)} produtos no CSV\n")

    stats = {"atualizados": [], "criados": [], "erros": []}

    for cp in csv_products:
        first_sku = cp["variants"][0]["sku"] if cp["variants"] else ""
        print(f"── {first_sku} — {cp['title'][:60]}")

        # find in Shopify by SKU (exact match or substring)
        shop_prod = sku_index.get(first_sku)
        if not shop_prod:
            # try substring search
            for sku_key, prod in sku_index.items():
                if first_sku in sku_key or sku_key in first_sku:
                    shop_prod = prod
                    break

        if shop_prod:
            pid = shop_prod["id"]
            print(f"  ✓ Encontrado na loja (id {pid})")

            # Update product metadata
            r = update_product(base_url, token, pid, cp, shop_prod)
            if r and r.get("product"):
                print(f"  ✓ Atualizado: título, descrição, tags, tipo")
            else:
                print(f"  ✗ Falhou ao atualizar")
                stats["erros"].append(first_sku)
                time.sleep(0.5)
                continue

            # Zero inventory
            zero_inventory(base_url, token, shop_prod)
            print(f"  ✓ Estoque zerado")
            stats["atualizados"].append(first_sku)

        else:
            print(f"  ⚠  Não encontrado na loja → criando...")
            r = create_product(base_url, token, cp)
            if r and r.get("product"):
                new_id = r["product"]["id"]
                print(f"  ✓ Criado (id {new_id})")
                stats["criados"].append(first_sku)
                # Also zero inventory on new product
                zero_inventory(base_url, token, r["product"])
                print(f"  ✓ Estoque zerado")
            else:
                print(f"  ✗ Falhou ao criar")
                stats["erros"].append(first_sku)

        time.sleep(0.5)

    # Summary
    print("\n" + "=" * 60)
    print(f"✅ Atualizados: {len(stats['atualizados'])}")
    print(f"🆕 Criados:     {len(stats['criados'])}")
    print(f"✗  Erros:       {len(stats['erros'])} → {stats['erros']}")

    log_path = BASE_DIR / "sincronizar_resultado.json"
    log_path.write_text(json.dumps(stats, indent=2, ensure_ascii=False))
    print(f"\n📋 Log salvo em {log_path}")


if __name__ == "__main__":
    main()
