"""Comparativo ML x site: preço, tarifas e quanto sobra em cada canal (somente leitura).

Preços AO VIVO (ML via API, site via products.json). Tarifas do ML no preço atual
(comissão por categoria + frete grátis do vendedor, pior caso como no ml_precos.py);
tarifa do site = TAXA_MP da planilha (20,82%: cartão + 12x).
Saída: relatorios/ml_comparativo_<data>.csv
"""
from __future__ import annotations
import csv, datetime, json, time
from pathlib import Path
import requests
import ml_auth, ml_precos as mp
from ml_melhorar import CAT_MAP
import common

HERE = Path(__file__).resolve().parent
TAXA_SITE = common.TAXA_MP


def itens_vivos():
    ids = [i["id"] for i in json.load(open(HERE / "data" / "ml_itens_2026-09-27.json"))]
    out = []
    for k in range(0, len(ids), 20):
        r = requests.get("https://api.mercadolibre.com/items", params={"ids": ",".join(ids[k:k + 20])}, headers=mp.H(), timeout=30)
        out += [x["body"] for x in r.json() if x.get("code") == 200]
    return out


def site_precos():
    d, p = {}, 1
    while True:
        j = requests.get(f"https://agropecaspadrao.com.br/products.json?limit=250&page={p}", timeout=30).json()["products"]
        for pr in j:
            for v in pr["variants"]:
                if v.get("sku"): d[common.norm_sku(v["sku"])] = float(v["price"])
        if len(j) < 250: break
        p += 1
    return d


def main():
    unit, kits = mp.carregar_master()
    site = site_precos()
    rows = []
    for it in sorted(itens_vivos(), key=lambda x: x["title"]):
        sku = next((a.get("value_name") for a in it["attributes"] if a["id"] == "SELLER_SKU"), "") or ""
        alvo, m, obs = mp.alvo_planilha(sku, unit, kits, "final")
        cat = CAT_MAP.get(sku, it["category_id"])
        P = float(it["price"])
        com = mp.fee_api(P, it["category_id"], it["listing_type_id"]); time.sleep(0.3)
        frete = mp.frete_vendedor(it["id"]) or 0.0; time.sleep(1.5)
        liq_ml = P - com - frete
        p_site = next((site[k] for k in common.sku_match_keys(sku) if k in site), None)
        if p_site is None and m and m.get("is_kit") is False:
            pass
        r = dict(sku=sku, titulo=it["title"], status=it["status"], categoria_ml=it["category_id"],
                 preco_ml=round(P, 2), comissao_ml=round(com, 2), pct_comissao_ml=round(100 * com / P, 1),
                 frete_vendedor_ml=round(frete, 2), recebido_ml=round(liq_ml, 2),
                 preco_site=p_site, taxa_site_pct=round(100 * TAXA_SITE, 2),
                 taxa_site_rs=round(p_site * TAXA_SITE, 2) if p_site else "",
                 recebido_site=round(p_site * (1 - TAXA_SITE), 2) if p_site else "",
                 custo_planilha=m["custo"] if m else "", frete_inbound_planilha=m["frete"] if m else "",
                 margem_planilha_pct=round(100 * m["marg"], 1) if m and m["marg"] is not None else "",
                 preco_final_planilha=alvo if alvo else "", obs=obs)
        if p_site: r["dif_recebido_ml_menos_site"] = round(liq_ml - p_site * (1 - TAXA_SITE), 2)
        rows.append(r)
    out = HERE / "relatorios" / f"ml_comparativo_{datetime.date.today().isoformat()}.csv"
    keys = list(rows[0].keys()) + ["dif_recebido_ml_menos_site"]
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(dict.fromkeys(keys)), extrasaction="ignore"); w.writeheader(); w.writerows(rows)
    print(out)


if __name__ == "__main__":
    main()
