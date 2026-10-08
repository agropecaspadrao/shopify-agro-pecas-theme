"""Exporta TODOS os produtos do Shopify para data/produtos_shopify.json.

Cada registro é normalizado num formato neutro usado pelos demais scripts
(gen_eans, build_csv, ml_publish, fix_categories).

Uso:
    python3 export_shopify.py
"""
from __future__ import annotations

import json
import re

import config
from shopify_client import gql

QUERY = """
query($after: String) {
  products(first: 50, after: $after, sortKey: PRODUCT_TYPE) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle title productType vendor status
      descriptionHtml
      category { id name }
      images(first: 12) { nodes { url } }
      variants(first: 1) {
        nodes {
          id sku barcode price inventoryQuantity
          inventoryItem { id measurement { weight { value unit } } }
        }
      }
      metafields(first: 30, namespace: "agro") { nodes { key value } }
    }
  }
}
"""

DIM_RE = re.compile(r"([\d.,]+)\s*[×x]\s*([\d.,]+)\s*[×x]\s*([\d.,]+)")


def _num(s: str) -> float | None:
    try:
        return float(str(s).replace(",", "."))
    except (ValueError, TypeError):
        return None


def parse_dimensoes(value: str | None) -> dict:
    """'30 × 12.5 × 12.5 cm' -> {comprimento, largura, altura} em cm."""
    if not value:
        return {}
    m = DIM_RE.search(value)
    if not m:
        return {}
    return {
        "comprimento_cm": _num(m.group(1)),
        "largura_cm": _num(m.group(2)),
        "altura_cm": _num(m.group(3)),
    }


def normalize(node: dict) -> dict:
    var = (node.get("variants", {}).get("nodes") or [{}])[0]
    mf = {m["key"]: m["value"] for m in node.get("metafields", {}).get("nodes", [])}
    weight = (((var.get("inventoryItem") or {}).get("measurement") or {}).get("weight") or {})
    images = [i["url"] for i in node.get("images", {}).get("nodes", [])]

    rec = {
        "product_gid": node["id"],
        "variant_gid": var.get("id"),
        "inventory_item_gid": (var.get("inventoryItem") or {}).get("id"),
        "handle": node.get("handle"),
        "title": node.get("title"),
        "description_html": node.get("descriptionHtml") or "",
        "product_type": node.get("productType"),
        "vendor": node.get("vendor"),
        "status": node.get("status"),
        "category_gid": (node.get("category") or {}).get("id"),
        "category_name": (node.get("category") or {}).get("name"),
        "sku": var.get("sku"),
        "barcode": (var.get("barcode") or "").strip(),
        "price": var.get("price"),
        "quantity": var.get("inventoryQuantity") or 0,
        "weight_kg": weight.get("value"),
        # metafields agro (podem ou não existir)
        "oem": mf.get("oem") or mf.get("sku_oem") or mf.get("part_number"),
        "codigo_livenza": mf.get("codigo_livenza"),
        "montadora": mf.get("montadora"),
        "equipamento": mf.get("equipamento") or mf.get("compatibility"),
        "aplicacao": mf.get("application") or mf.get("aplicacao"),
        "ficha_tecnica": mf.get("ficha_tecnica"),
        "images": images,
        "n_images": len(images),
    }
    rec.update(parse_dimensoes(mf.get("dimensoes_cm")))
    return rec


def fetch_all() -> list[dict]:
    out: list[dict] = []
    after = None
    while True:
        data = gql(QUERY, {"after": after})
        conn = data["products"]
        out.extend(normalize(n) for n in conn["nodes"])
        print(f"  ...{len(out)} produtos")
        if not conn["pageInfo"]["hasNextPage"]:
            break
        after = conn["pageInfo"]["endCursor"]
    return out


def main() -> None:
    print("Exportando produtos do Shopify...")
    products = fetch_all()
    config.PRODUCTS_JSON.write_text(json.dumps(products, ensure_ascii=False, indent=2), encoding="utf-8")

    sem_foto = [p["sku"] for p in products if p["n_images"] == 0]
    sem_dim = [p["sku"] for p in products if not p.get("comprimento_cm")]
    print(f"\nOK: {len(products)} produtos -> {config.PRODUCTS_JSON}")
    print(f"  Sem imagem (ML exige >=1): {len(sem_foto)}")
    print(f"  Sem dimensão real (placeholder): {len(sem_dim)}")


if __name__ == "__main__":
    main()
