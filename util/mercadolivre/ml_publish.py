"""Publica os produtos no Mercado Livre a partir de data/ml_produtos.csv.

Para cada linha: prevê a categoria (domain_discovery), monta o anúncio com
fotos por URL (reaproveita o CDN do Shopify, sem re-upload), atributos básicos
e EAN, e cria via POST /items.

SEMPRE comece em dry-run (padrão). Só com --publish ele grava de verdade.

    python3 ml_publish.py                 # dry-run: mostra payloads e gera relatório
    python3 ml_publish.py --limit 3       # testa só os 3 primeiros
    python3 ml_publish.py --publish       # cria os anúncios de verdade
    python3 ml_publish.py --publish --status active   # já deixa ativos

Regra de marca: marca = 'Genérica'. Montadora/equipamento entram só como
compatibilidade/atributo, nunca como afiliação. (Ver CLAUDE.md.)
"""
from __future__ import annotations

import argparse
import csv

import requests

import config
from ml_auth import get_access_token

API = "https://api.mercadolibre.com"
LISTING_TYPE = "bronze"   # grátis. Use "gold_special" para anúncio premium (com tarifa).
MIN_PRICE_BRL = 8.0       # piso observado do ML; abaixo disso a categoria rejeita.

# Categoria ML manual por SKU (preencha com o id correto quando o preditor falhar).
# Pegue o id em: https://www.mercadolivre.com.br -> categoria do anúncio -> ou
# GET /sites/MLB/category_predictor/predict?title=...
CATEGORY_OVERRIDE: dict[str, str] = {
    # "ACX363311B": "MLB123456",
}


def _clean_query(title: str) -> str:
    """Remove o código após '—' e tokens com dígitos, deixando só palavras descritivas."""
    base = title.split("—")[0]
    words = [w for w in base.split() if not any(c.isdigit() for c in w)]
    return " ".join(words[:4]).strip() or base.strip()


def predict_category(token: str, title: str) -> str | None:
    """Tenta o título cheio; se falhar, tenta uma query 'limpa' (sem códigos)."""
    headers = {"Authorization": f"Bearer {token}"}
    for q in dict.fromkeys([title, _clean_query(title)]):  # remove duplicata mantendo ordem
        if not q:
            continue
        r = requests.get(
            f"{API}/sites/{config.ML_SITE}/domain_discovery/search",
            params={"q": q, "limit": 1}, headers=headers, timeout=30,
        )
        if r.status_code == 200 and r.json():
            return r.json()[0].get("category_id")
    return None


def build_attributes(row: dict) -> list[dict]:
    attrs = [
        {"id": "BRAND", "value_name": row.get("marca") or "APP — Agro Peças Padrão"},
        {"id": "MODEL", "value_name": (row.get("modelo") or row["sku"])[:60]},
        {"id": "SELLER_SKU", "value_name": row["sku"]},
    ]
    # PART_NUMBER é obrigatório em muitas categorias de autopeças. Sem OEM,
    # usa o próprio SKU como referência (recupera os anúncios que falhavam).
    part_number = row.get("oem") or row.get("sku")
    if part_number:
        attrs.append({"id": "PART_NUMBER", "value_name": part_number[:60]})
    # GTIN só quando há prefixo GS1 GLOBAL real. Códigos internos (faixa "2")
    # NÃO podem ser publicados como GTIN.
    if config.HAS_REAL_GTIN and row.get("ean"):
        attrs.append({"id": "GTIN", "value_name": row["ean"]})
    return attrs


def build_item(row: dict, category_id: str) -> dict:
    pics = [{"source": row[c]} for c in row if c.startswith("image_") and row[c]]
    item = {
        "title": row["ml_title"][:60],
        "category_id": category_id,
        "price": float(row["price"]),
        "currency_id": row.get("currency") or "BRL",
        "available_quantity": int(float(row.get("quantity") or 0)),
        "buying_mode": "buy_it_now",
        "condition": row.get("condition") or "new",
        "listing_type_id": LISTING_TYPE,
        "pictures": pics,
        "attributes": build_attributes(row),
        "description": {"plain_text": row.get("description") or ""},
        "shipping": {"mode": "me2", "local_pick_up": False, "free_shipping": False},
    }
    return item


def publishable(row: dict) -> tuple[bool, str]:
    pend = row.get("pendencias") or ""
    if "SEM_FOTO" in pend:
        return False, "sem foto (ML exige >=1)"
    if "SEM_PRECO" in pend:
        return False, "sem preço"
    try:
        if float(row.get("price") or 0) < MIN_PRICE_BRL:
            return False, f"preço < R${MIN_PRICE_BRL:.0f} (mínimo do ML para a categoria)"
    except ValueError:
        return False, "preço inválido"
    return True, ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true", help="cria de verdade (sem isto = dry-run)")
    ap.add_argument("--limit", type=int, default=0, help="processa apenas N linhas")
    ap.add_argument("--status", choices=["active", "paused"], default="paused",
                    help="status inicial do anúncio (default: paused)")
    args = ap.parse_args()

    token = get_access_token()
    rows = list(csv.DictReader(config.ML_CSV.open(encoding="utf-8")))
    if args.limit:
        rows = rows[: args.limit]

    report = []
    for i, row in enumerate(rows, 1):
        ok, motivo = publishable(row)
        if not ok:
            print(f"[{i}/{len(rows)}] PULADO {row['sku']}: {motivo}")
            report.append({"sku": row["sku"], "status": "skip", "motivo": motivo, "ml_id": ""})
            continue

        cat = row.get("ml_category_id") or CATEGORY_OVERRIDE.get(row["sku"]) or predict_category(token, row["ml_title"])
        if not cat:
            print(f"[{i}/{len(rows)}] SEM CATEGORIA {row['sku']} — revise o título")
            report.append({"sku": row["sku"], "status": "erro", "motivo": "categoria não prevista", "ml_id": ""})
            continue

        item = build_item(row, cat)
        item["status"] = args.status

        if not args.publish:
            print(f"[{i}/{len(rows)}] DRY {row['sku']} cat={cat} fotos={len(item['pictures'])}")
            report.append({"sku": row["sku"], "status": "dry", "motivo": f"cat={cat}", "ml_id": ""})
            continue

        r = requests.post(f"{API}/items", headers={"Authorization": f"Bearer {token}"}, json=item, timeout=60)
        if r.status_code in (200, 201):
            ml_id = r.json().get("id")
            print(f"[{i}/{len(rows)}] OK {row['sku']} -> {ml_id}")
            report.append({"sku": row["sku"], "status": "ok", "motivo": f"cat={cat}", "ml_id": ml_id})
        else:
            msg = r.text[:300]
            print(f"[{i}/{len(rows)}] ERRO {row['sku']}: {r.status_code} {msg}")
            report.append({"sku": row["sku"], "status": "erro", "motivo": msg, "ml_id": ""})

    with config.PUBLISH_REPORT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["sku", "status", "motivo", "ml_id"])
        w.writeheader()
        w.writerows(report)

    resumo = {}
    for r in report:
        resumo[r["status"]] = resumo.get(r["status"], 0) + 1
    print(f"\nResumo: {resumo}\nRelatório -> {config.PUBLISH_REPORT}")


if __name__ == "__main__":
    main()
