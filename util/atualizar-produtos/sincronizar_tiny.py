#!/usr/bin/env python3
"""
Sincronização Shopify ↔ Olist Tiny ERP
  1. Lê produtos do Shopify via API REST
  2. Lê produtos do Tiny via API
  3. Faz match por SKU (codigo no Tiny)
  4. Sincroniza preços do Shopify → Tiny
  5. Atualiza SKU no Tiny para produtos sem código
  6. Gera relatório de match/mismatch

Uso:
  python3 sincronizar_tiny.py          # sincroniza preços
  python3 sincronizar_tiny.py --dry    # só mostra o que faria, sem salvar
"""

import json, time, sys, unicodedata, re, pathlib
from urllib.request import urlopen, Request
from urllib.parse import urlencode

BASE_DIR    = pathlib.Path(__file__).parent
ENV_FILE    = BASE_DIR / ".env"
DRY_RUN     = "--dry" in sys.argv
API_VERSION = "2025-01"
TINY_BASE   = "https://api.tiny.com.br/api2"


# ── helpers ───────────────────────────────────────────────────────────────────

def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_shopify_token(env):
    shop   = env["SHOPIFY_SHOP"]
    url    = f"https://{shop}.myshopify.com/admin/oauth/access_token"
    data   = urlencode({"grant_type": "client_credentials",
                        "client_id": env["SHOPIFY_CLIENT_ID"],
                        "client_secret": env["SHOPIFY_CLIENT_SECRET"]}).encode()
    with urlopen(Request(url, data=data, method="POST")) as r:
        return json.loads(r.read())["access_token"]


def shopify_get(env, path, token):
    shop = env["SHOPIFY_SHOP"]
    url  = f"https://{shop}.myshopify.com/admin/api/{API_VERSION}{path}"
    req  = Request(url, headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    with urlopen(req) as r:
        return json.loads(r.read()), dict(r.headers)


def tiny_get(token, endpoint, **params):
    params["token"]   = token
    params["formato"] = "json"
    url = f"{TINY_BASE}/{endpoint}?" + urlencode(params)
    with urlopen(url, timeout=15) as r:
        return json.loads(r.read())


def tiny_post(token, endpoint, data: dict):
    data["token"]   = token
    data["formato"] = "json"
    body = urlencode(data).encode()
    req  = Request(f"{TINY_BASE}/{endpoint}", data=body, method="POST")
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def normalize(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


# ── fetch all products ─────────────────────────────────────────────────────────

def fetch_shopify_products(env, token):
    products = []
    path = "/products.json?limit=250&fields=id,title,variants,product_type,vendor"
    while path:
        data, headers = shopify_get(env, path, token)
        products.extend(data.get("products", []))
        link = headers.get("Link", "")
        if 'rel="next"' in link:
            path = "/products.json?" + link.split("<")[1].split("?")[1].split(">")[0]
        else:
            path = None
    return products


def fetch_tiny_products(token):
    """Busca todos os produtos do Tiny em lotes de 100."""
    all_products = []
    for letra in list("abcdefghijklmnopqrstuvwxyz") + [""]:
        try:
            data = tiny_get(token, "produtos.pesquisa.php", pesquisa=letra if letra else " ")
            prods = data.get("retorno", {}).get("produtos", [])
            for p in prods:
                prod = p.get("produto", {})
                all_products.append(prod)
            time.sleep(0.3)
        except Exception:
            pass
        if letra == "":
            break
    # Deduplication by id
    seen = set()
    unique = []
    for p in all_products:
        if p["id"] not in seen:
            seen.add(p["id"])
            unique.append(p)
    return unique


def fetch_tiny_all(token):
    """Busca todos os produtos do Tiny paginando por letra inicial."""
    seen, result = set(), []
    # Tiny retorna até 100 por chamada — varremos letra a letra para cobrir tudo
    for term in list("abcdefghijklmnopqrstuvwxyz0123456789"):
        try:
            data  = tiny_get(token, "produtos.pesquisa.php", pesquisa=term)
            prods = data.get("retorno", {}).get("produtos", [])
            for p in prods:
                prod = p.get("produto", {})
                if prod.get("id") not in seen:
                    seen.add(prod["id"])
                    result.append(prod)
            time.sleep(0.15)
        except Exception:
            pass
    return result


# ── match logic ────────────────────────────────────────────────────────────────

def build_match(shopify_products, tiny_products):
    """Retorna lista de (shopify_variant, tiny_product, match_type)."""
    tiny_by_sku  = {p["codigo"].strip(): p for p in tiny_products if p.get("codigo", "").strip()}
    tiny_by_name = {normalize(p["nome"]): p for p in tiny_products}

    matches   = []
    unmatched = []

    for prod in shopify_products:
        for variant in prod.get("variants", []):
            sku = (variant.get("sku") or "").strip()
            price_shopify = float(variant.get("price") or 0)

            tiny_prod = None
            match_type = None

            if sku and sku in tiny_by_sku:
                tiny_prod  = tiny_by_sku[sku]
                match_type = "SKU"
            else:
                norm_title = normalize(prod["title"])
                if norm_title in tiny_by_name:
                    tiny_prod  = tiny_by_name[norm_title]
                    match_type = "NOME"

            if tiny_prod:
                matches.append({
                    "shopify_id":    prod["id"],
                    "shopify_title": prod["title"],
                    "sku":           sku,
                    "price_shopify": price_shopify,
                    "tiny_id":       tiny_prod["id"],
                    "tiny_sku":      tiny_prod.get("codigo", "").strip(),
                    "price_tiny":    float(tiny_prod.get("preco") or 0),
                    "match_type":    match_type,
                    "tiny_prod":     tiny_prod,
                })
            else:
                unmatched.append({
                    "shopify_id":    prod["id"],
                    "shopify_title": prod["title"],
                    "sku":           sku,
                    "price_shopify": price_shopify,
                })

    return matches, unmatched


# ── sync ───────────────────────────────────────────────────────────────────────

def sync_price_to_tiny(token, match, dry=False):
    """Atualiza preço no Tiny com o preço do Shopify."""
    if match["price_shopify"] <= 0:
        return "SKIP_ZERO_PRICE"

    if abs(match["price_shopify"] - match["price_tiny"]) < 0.01:
        return "ALREADY_IN_SYNC"

    if dry:
        return f"DRY: seria atualizado de R${match['price_tiny']:.2f} → R${match['price_shopify']:.2f}"

    produto = {
        "id":    match["tiny_id"],
        "nome":  match["shopify_title"],
        "preco": str(match["price_shopify"]),
    }
    if match["sku"] and not match["tiny_sku"]:
        produto["codigo"] = match["sku"]

    data  = tiny_post(token, "produto.alterar.php", {"produto": json.dumps({"produto": produto})})
    retorno = data.get("retorno", {})
    return retorno.get("status", "UNKNOWN")


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    env = load_env()
    tiny_token = env.get("TINY_API_KEY", "")
    if not tiny_token:
        print("❌ TINY_API_KEY não encontrada no .env")
        sys.exit(1)

    print("🔄 Autenticando no Shopify...")
    shopify_token = get_shopify_token(env)
    print("🔄 Buscando produtos do Shopify...")
    shopify_products = fetch_shopify_products(env, shopify_token)
    print(f"   → {len(shopify_products)} produtos encontrados")

    print("🔄 Buscando produtos do Tiny ERP...")
    tiny_products = fetch_tiny_all(tiny_token)
    print(f"   → {len(tiny_products)} produtos encontrados (antes de deduplicar)")
    tiny_seen = {}
    for p in tiny_products:
        tiny_seen[p["id"]] = p
    tiny_products = list(tiny_seen.values())
    print(f"   → {len(tiny_products)} produtos únicos")

    print("\n🔗 Fazendo match...")
    matches, unmatched = build_match(shopify_products, tiny_products)
    by_sku  = [m for m in matches if m["match_type"] == "SKU"]
    by_name = [m for m in matches if m["match_type"] == "NOME"]
    print(f"   ✅ {len(matches)} matches ({len(by_sku)} por SKU, {len(by_name)} por nome)")
    print(f"   ⚠️  {len(unmatched)} sem match")

    print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}💰 Sincronizando preços Shopify → Tiny...")
    results = {"updated": 0, "skipped": 0, "already_sync": 0, "error": 0}
    for m in matches:
        r = sync_price_to_tiny(tiny_token, m, dry=DRY_RUN)
        if "SYNC" in str(r).upper():
            results["already_sync"] += 1
        elif "SKIP" in str(r).upper() or "DRY" not in str(r).upper() and "ZERO" in str(r).upper():
            results["skipped"] += 1
        elif "Ok" in str(r) or "DRY" in str(r):
            results["updated"] += 1
            print(f"   ✅ {m['sku'] or m['shopify_title'][:40]} → R${m['price_shopify']:.2f}")
        else:
            results["error"] += 1
        time.sleep(0.2)

    print(f"\n📊 Resultado:")
    print(f"   Atualizados  : {results['updated']}")
    print(f"   Já em sync   : {results['already_sync']}")
    print(f"   Sem preço    : {results['skipped']}")
    print(f"   Erros        : {results['error']}")

    if unmatched:
        print(f"\n⚠️  Produtos sem match no Tiny ({len(unmatched)}):")
        for u in unmatched:
            print(f"   SKU: {u['sku'] or 'N/A'} | {u['shopify_title'][:60]}")

    print("\n✅ Sincronização concluída!")


if __name__ == "__main__":
    main()
