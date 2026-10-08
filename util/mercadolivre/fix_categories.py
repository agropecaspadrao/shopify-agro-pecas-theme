"""Backfill da categoria padrão (Shopify Standard Taxonomy) nos produtos.

Os 144 produtos hoje estão com category=null. Este script:
  1. resolve, via API de taxonomia, o GID da categoria para cada product_type;
  2. aplica em todos os produtos daquele tipo (productUpdate).

Modos:
    python3 fix_categories.py --discover   # só mostra opções de categoria, não grava
    python3 fix_categories.py --dry-run    # mostra o que faria
    python3 fix_categories.py --apply      # grava no Shopify

Edite TYPE_SEARCH para refinar o termo de busca por tipo de produto.
"""
from __future__ import annotations

import argparse
import json

import config
from shopify_client import gql

# A taxonomia do Shopify é localizada em pt-BR e NÃO tem um nó exato de
# "bomba hidráulica". Use --discover para ver as opções e, de preferência,
# fixe o GID escolhido em MANUAL_GID (vence a busca automática).
#
# Opções relevantes vistas na loja (jun/2026):
#   gid://shopify/TaxonomyCategory/bi-2        Comercial e industrial > Agricultura
#   gid://shopify/TaxonomyCategory/vp-1-4-5-8  Veículos e peças > ... > Bombas de óleo
MANUAL_GID: dict[str, str] = {
    # "Bombas Hidráulicas": "gid://shopify/TaxonomyCategory/bi-2",
}

# product_type (Shopify) -> termo de busca na taxonomia (em PORTUGUÊS)
TYPE_SEARCH = {
    "Bombas Hidráulicas": "agricultura",
    "Sensores": "sensor",
    "Peças Plásticas": "agricultura",
}
DEFAULT_SEARCH = "agricultura"

TAXO_QUERY = """
query($search: String!) {
  taxonomy {
    categories(first: 8, search: $search) {
      nodes { id name fullName isLeaf }
    }
  }
}
"""

UPDATE = """
mutation($id: ID!, $category: ID!) {
  productUpdate(product: {id: $id, category: $category}) {
    product { id category { fullName } }
    userErrors { field message }
  }
}
"""


def resolve_category(search: str) -> dict | None:
    nodes = gql(TAXO_QUERY, {"search": search})["taxonomy"]["categories"]["nodes"]
    # prioriza categorias folha (mais específicas)
    leafs = [n for n in nodes if n.get("isLeaf")]
    return (leafs or nodes or [None])[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--discover", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    products = json.loads(config.PRODUCTS_JSON.read_text(encoding="utf-8"))
    types = sorted({p["product_type"] for p in products if p["product_type"]})

    # Resolve uma categoria por tipo (override manual vence a busca)
    resolved: dict[str, dict] = {}
    for t in types:
        if t in MANUAL_GID:
            resolved[t] = {"id": MANUAL_GID[t], "fullName": "(override manual)"}
            print(f"[{t}]  override -> {MANUAL_GID[t]}")
            continue
        search = TYPE_SEARCH.get(t, DEFAULT_SEARCH)
        cat = resolve_category(search)
        resolved[t] = cat
        print(f"[{t}]  busca='{search}'  ->  {cat['fullName'] if cat else 'NENHUMA'}  ({cat['id'] if cat else '-'})")

    if args.discover:
        print("\n--discover: nada gravado. Copie o GID desejado para MANUAL_GID no topo do arquivo.")
        return

    apply = args.apply and not args.dry_run
    n_ok = 0
    for p in products:
        if p["category_gid"]:
            continue  # já tem categoria
        cat = resolved.get(p["product_type"])
        if not cat:
            continue
        if not apply:
            print(f"  [dry] {p['sku']:<22} -> {cat['fullName']}")
            continue
        res = gql(UPDATE, {"id": p["product_gid"], "category": cat["id"]})
        errs = res["productUpdate"]["userErrors"]
        if errs:
            print(f"  ERRO {p['sku']}: {errs}")
        else:
            n_ok += 1
    print(f"\n{'APLICADO' if apply else 'DRY-RUN'} — {n_ok if apply else 'simulação'} categorias gravadas.")


if __name__ == "__main__":
    main()
