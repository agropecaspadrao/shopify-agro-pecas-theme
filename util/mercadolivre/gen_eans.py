"""Gera EAN-13 válidos a partir do seu prefixo GS1 e (opcional) grava no Shopify.

Sem GS1_PREFIX no .env os códigos seriam apenas internos (não globais), então
o script EXIGE o prefixo. O mapeamento sku->ean fica em data/ean_map.csv e é
estável (não muda em re-execuções), desde que você não reordene o arquivo.

Modos:
    python3 gen_eans.py                # gera/atualiza ean_map.csv
    python3 gen_eans.py --push         # grava os EAN como barcode no Shopify
"""
from __future__ import annotations

import argparse
import csv
import json

import config
from shopify_client import gql

UPDATE_BARCODE = """
mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id barcode }
    userErrors { field message }
  }
}
"""


def ean13_check_digit(d12: str) -> str:
    s = sum(int(n) * (1 if i % 2 == 0 else 3) for i, n in enumerate(d12))
    return str((10 - s % 10) % 10)


def make_ean(prefix: str, seq: int) -> str:
    base = prefix + str(seq).zfill(12 - len(prefix))
    if len(base) != 12:
        raise SystemExit(f"GS1_PREFIX inválido: '{prefix}' (use 7 a 11 dígitos)")
    return base + ean13_check_digit(base)


def load_map() -> dict[str, str]:
    if not config.EAN_MAP.exists():
        return {}
    with config.EAN_MAP.open(encoding="utf-8") as f:
        return {r["sku"]: r["ean"] for r in csv.DictReader(f)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true", help="grava barcode no Shopify")
    args = ap.parse_args()

    prefix = config.ACTIVE_BARCODE_PREFIX
    if config.HAS_REAL_GTIN:
        print(f"Usando prefixo GS1 GLOBAL: {prefix} (códigos válidos como GTIN no ML)")
    else:
        print(f"GS1_PREFIX vazio -> usando prefixo INTERNO '{prefix}' (faixa restrita '2').\n"
              "  Estes códigos servem para Shopify/Tiny/logística, mas NÃO são GTIN global\n"
              "  e NÃO serão publicados como GTIN no Mercado Livre.")

    products = json.loads(config.PRODUCTS_JSON.read_text(encoding="utf-8"))
    existing = load_map()
    next_seq = len(existing)
    rows = []
    for p in products:
        sku = p["sku"]
        if not sku:
            continue
        ean = existing.get(sku) or p.get("barcode") or make_ean(prefix, next_seq)
        if sku not in existing and not p.get("barcode"):
            next_seq += 1
        rows.append({"sku": sku, "ean": ean, "product_gid": p["product_gid"], "variant_gid": p["variant_gid"]})

    with config.EAN_MAP.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["sku", "ean", "product_gid", "variant_gid"])
        w.writeheader()
        w.writerows(rows)
    print(f"OK: {len(rows)} EAN -> {config.EAN_MAP}")

    if not args.push:
        print("Use --push para gravar como barcode no Shopify.")
        return

    for r in rows:
        res = gql(UPDATE_BARCODE, {
            "productId": r["product_gid"],
            "variants": [{"id": r["variant_gid"], "barcode": r["ean"]}],
        })
        errs = res["productVariantsBulkUpdate"]["userErrors"]
        if errs:
            print(f"  ERRO {r['sku']}: {errs}")
    print("Barcodes gravados no Shopify.")


if __name__ == "__main__":
    main()
