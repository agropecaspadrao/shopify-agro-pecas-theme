"""Gera o CSV-mestre ML-ready (data/ml_produtos.csv) a partir do JSON exportado.

Esse CSV é a fonte que o ml_publish.py consome e também serve para revisão
manual antes de subir. A coluna `pendencias` aponta o que falta para o ML
aceitar o anúncio (foto, EAN, dimensão).

Regra de marca: NUNCA usar marca de fabricante como marca do produto. Marca =
'Genérica'; montadora/equipamento entram apenas como COMPATIBILIDADE.

Uso:
    python3 build_csv.py
"""
from __future__ import annotations

import csv
import json

import config

MAX_IMG = 8
COND = "new"
CURRENCY = "BRL"


def load_ean_map() -> dict[str, str]:
    if not config.EAN_MAP.exists():
        return {}
    with config.EAN_MAP.open(encoding="utf-8") as f:
        return {r["sku"]: r["ean"] for r in csv.DictReader(f)}


def ml_title(p: dict) -> str:
    """Título <= 60 chars. Mantém compatibilidade como 'compatível', sem afiliação."""
    base = (p["title"] or "").split(" — ")[0].strip()
    return base[:60]


def description(p: dict) -> str:
    linhas = []
    if p.get("oem"):
        linhas.append(f"Referência OEM (compatível): {p['oem']}")
    if p.get("montadora"):
        linhas.append(f"Compatível com: {p['montadora']}")
    if p.get("equipamento"):
        linhas.append(f"Modelos/equipamentos: {p['equipamento']}")
    linhas.append("Peça no padrão original (OEM). Compatibilidade indicada para referência; "
                  "não implica afiliação ou origem do fabricante citado.")
    if p.get("ficha_tecnica"):
        linhas.append(f"Ficha técnica: {p['ficha_tecnica']}")
    return "\n".join(linhas)


def pendencias(p: dict, ean: str) -> str:
    out = []
    if p["n_images"] == 0:
        out.append("SEM_FOTO")
    if not ean:
        out.append("SEM_EAN")
    if not p.get("comprimento_cm"):
        out.append("SEM_DIMENSAO")
    if not p.get("price") or float(p["price"]) <= 0:
        out.append("SEM_PRECO")
    return "|".join(out)


def main() -> None:
    products = json.loads(config.PRODUCTS_JSON.read_text(encoding="utf-8"))
    eans = load_ean_map()

    img_cols = [f"image_{i+1}" for i in range(MAX_IMG)]
    fields = [
        "sku", "ean", "title", "ml_title", "price", "currency", "quantity", "condition",
        "weight_kg", "comprimento_cm", "largura_cm", "altura_cm",
        "marca", "modelo", "montadora_compativel", "equipamento_compativel", "oem",
        "ficha_tecnica", "ml_category_id", "n_images", *img_cols, "description", "pendencias",
    ]

    with config.ML_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for p in products:
            ean = eans.get(p["sku"], "") or p.get("barcode", "")
            row = {
                "sku": p["sku"],
                "ean": ean,
                "title": p["title"],
                "ml_title": ml_title(p),
                "price": p["price"],
                "currency": CURRENCY,
                "quantity": p["quantity"],
                "condition": COND,
                "weight_kg": p.get("weight_kg"),
                "comprimento_cm": p.get("comprimento_cm"),
                "largura_cm": p.get("largura_cm"),
                "altura_cm": p.get("altura_cm"),
                "marca": "APP — Agro Peças Padrão",  # regra APP: marca sempre esta
                "modelo": p.get("oem") or p.get("sku"),
                "montadora_compativel": p.get("montadora") or "",
                "equipamento_compativel": p.get("equipamento") or "",
                "oem": p.get("oem") or "",
                "ficha_tecnica": p.get("ficha_tecnica") or "",
                "ml_category_id": "",  # preenchido pelo ml_publish (predictor)
                "n_images": p["n_images"],
                "description": description(p),
                "pendencias": pendencias(p, ean),
            }
            for i, col in enumerate(img_cols):
                row[col] = p["images"][i] if i < len(p["images"]) else ""
            w.writerow(row)

    total = len(products)
    com_pend = sum(1 for p in products if p["n_images"] == 0)
    print(f"OK: {total} linhas -> {config.ML_CSV}")
    print(f"  Prontos p/ ML (com foto): {total - com_pend}")
    print(f"  Com pendência de foto: {com_pend}  (veja coluna 'pendencias')")


if __name__ == "__main__":
    main()
