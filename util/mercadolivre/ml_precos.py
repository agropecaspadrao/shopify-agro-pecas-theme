"""Preço de venda no Mercado Livre a partir do LÍQUIDO da planilha master.

Regra (Guilherme, 27/09/2026): o valor que cai na conta depois das tarifas do ML
tem que ser igual ao valor da planilha. O script resolve o preço de anúncio P tal que

    P - comissão(P) - custo_fixo(P) - frete_vendedor(P) = líquido_alvo

Tarifas medidas na API em 27/09/2026 (categorias Agro, anúncio Clássico):
  - comissão varia POR CATEGORIA (9% Plataforma, 12% Implementos/Bombas, 14% Sementes...)
    e por tipo (Premium/gold_pro é +5 p.p.) — lida da API por categoria. Recategorizar
    um anúncio muda a comissão: rode este script DEPOIS do ml_melhorar.py.
  - abaixo de R$12,50 entra custo fixo de ~50% do preço (item barato)
  - acima de R$79 o frete grátis é obrigatório e o custo cai no vendedor
    (GET /users/{uid}/shipping_options/free?item_id= devolve o custo real por anúncio)

CORREÇÃO (01/10/2026): o frete entra SEMPRE no preço (pior caso). Pedido com várias unidades
passa de R$79 e o ML cobra o frete por unidade (venda de 30/09: 10 dedos = 10 × R$5,95); antes
o frete só entrava se 1 unidade já passasse de R$79 e o vendedor ficou com R$5,43 em vez de R$9,98.

DECISÃO (Guilherme, 27/09/2026): o líquido a receber no ML = coluna "Preço final site"
(o mesmo valor que o cliente paga no site). Logo o preço do ML fica ACIMA do site.

Uso:
    python3 ml_precos.py                      # dry-run, base = "final" (padrão)
    python3 ml_precos.py --base pcm           # alternativa: "Preço c/ margem"
    python3 ml_precos.py --apply              # grava os preços no ML (PUT /items/{id})
    python3 ml_precos.py --apply --only A56254,KK31823
Saída: relatorios/ml_precos_<data>.csv
"""
from __future__ import annotations
import argparse, csv, json, sys, time, datetime
from pathlib import Path
import requests
import config, ml_auth
from ml_melhorar import CAT_MAP

HERE = Path(__file__).resolve().parent
MP = HERE.parent / "master-produtos"
sys.path.insert(0, str(MP))
import common  # noqa: E402  (planilha master)

API = "https://api.mercadolibre.com"
UID = 3364375105
PCT = {"gold_special": 0.12, "gold_pro": 0.17, "bronze": 0.0, "free": 0.0}
PISO_BARATO = 12.51      # até R$12,50 (inclusive) o ML cobra custo fixo ~50% do preço
FRETE_GRATIS = 79.0      # a partir daqui o frete é obrigatório e pago pelo vendedor


def H():
    return {"Authorization": f"Bearer {ml_auth.get_access_token()}"}


def fee_api(P: float, cat: str, lt: str) -> float:
    for _ in range(4):
        r = requests.get(f"{API}/sites/MLB/listing_prices",
                         params={"price": f"{P:.2f}", "category_id": cat, "listing_type_id": lt},
                         headers=H(), timeout=30)
        if r.status_code == 429:
            time.sleep(2); continue
        j = r.json(); j = j[0] if isinstance(j, list) else j
        return float(j["sale_fee_amount"])
    raise RuntimeError("listing_prices: rate limit")


_PCT_CACHE: dict = {}

def pct_categoria(cat: str, lt: str) -> float:
    """Comissão real da categoria (varia: 9% Plataforma, 12% Implementos, 14% Sementes...)."""
    key = (cat, lt)
    if key not in _PCT_CACHE:
        _PCT_CACHE[key] = round(fee_api(1000.0, cat, lt) / 1000.0, 4)
        time.sleep(0.3)
    return _PCT_CACHE[key]


def frete_vendedor(item_id: str) -> float | None:
    """Custo do frete grátis que o ML cobra do vendedor para este anúncio (todo o país)."""
    for _ in range(4):
        r = requests.get(f"{API}/users/{UID}/shipping_options/free", params={"item_id": item_id},
                         headers=H(), timeout=30)
        if r.status_code == 429:
            time.sleep(4); continue
        if not r.ok:
            return None
        return ((r.json().get("coverage") or {}).get("all_country") or {}).get("list_cost")
    return None


def resolver(liquido: float, frete: float, pct: float) -> float:
    """Menor preço P que garante o líquido NO PIOR CASO: pedido grande, em que o frete grátis
    (obrigatório a partir de R$79 no pedido) é cobrado por unidade (ex.: 10 un. = 10 × R$5,95).
    Pedido pequeno só deixa MAIS para o vendedor (o comprador paga o frete)."""
    k = 1 - pct
    cands = []
    pA = (liquido + frete) / k
    if pA >= PISO_BARATO: cands.append(pA)
    pC = (liquido + frete) / (k - 0.5)
    if k - 0.5 > 0 and pC < PISO_BARATO: cands.append(pC)
    if not cands:
        cands.append(max(PISO_BARATO, pA))
    return round(min(cands) + 0.004, 2)


def carregar_master():
    from openpyxl import load_workbook
    wb = load_workbook(HERE.parent / "APP_Master_Produtos_Shopify.xlsx", data_only=True)
    rows = common.load_master(wb)
    unit, kits = {}, {}
    for r in rows:
        for k in common.sku_match_keys(r["sku"]):
            (kits if r["is_kit"] else unit).setdefault(k, []).append(r)
    return unit, kits


def alvo_planilha(sku: str, unit, kits, base: str):
    """Devolve (líquido alvo, linha, observação). Unitário derivado do menor kit se não houver linha unitária."""
    m, obs = None, ""
    for k in common.sku_match_keys(sku):
        if k in unit:
            ativos = [r for r in unit[k] if not r["skip"]] or unit[k]
            m = ativos[0]; break
    if not m:
        for k in common.sku_match_keys(sku):
            if k in kits:
                kr = min(kits[k], key=lambda r: r["kit"]); n = kr["kit"]
                m = dict(kr); m["custo"] = (kr["custo"] or 0) / n; m["frete"] = (kr["frete"] or 0) / n
                obs = f"unitário derivado do KIT{n}"; break
    if not m:
        return None, None, "sem linha na planilha"
    if m.get("skip") and not obs:
        obs = f"linha {m['status']}/incompleta na planilha"
    custo, fi, marg = m["custo"] or 0, m["frete"] or 0, m["marg"] or 0
    pcm = round((custo + fi) / (1 - marg), 2)
    final = common.preco_final(custo, fi, marg)
    return (pcm if base == "pcm" else final), m, obs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", choices=["pcm", "final"], default="final",
                    help="final (DECISÃO 27/09/2026) = 'Preço final site' é o líquido a receber; pcm = 'Preço c/ margem'")
    ap.add_argument("--cat-atual", action="store_true",
                    help="usa a categoria atual do anúncio para a comissão (padrão: usa o CAT_MAP do ml_melhorar, categoria de destino)")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default="", help="SKUs separados por vírgula")
    ap.add_argument("--itens", default=str(HERE / "data" / "ml_itens_2026-09-27.json"))
    a = ap.parse_args()

    items = json.load(open(a.itens))
    only = {s.strip() for s in a.only.split(",") if s.strip()}
    unit, kits = carregar_master()
    hoje = datetime.date.today().isoformat()
    out = HERE / "relatorios" / f"ml_precos_{hoje}_{a.base}.csv"
    rows = []
    print(f"{'sku':16} {'ML hoje':>9} {'alvo':>9} {'→ preço':>9} {'com.%':>5} {'comissão':>8} {'frete':>6} {'líquido':>9}  obs")
    for it in sorted(items, key=lambda x: x["title"]):
        sku = next((x.get("value_name") for x in it["attributes"] if x["id"] == "SELLER_SKU"), "")
        if only and sku not in only: continue
        alvo, m, obs = alvo_planilha(sku, unit, kits, a.base)
        if alvo is None:
            print(f"{sku:16} {it['price']:>9.2f} {'—':>9}  {obs}")
            rows.append(dict(id=it["id"], sku=sku, ml_hoje=it["price"], alvo="", preco="", obs=obs)); continue
        cat = it["category_id"] if a.cat_atual else CAT_MAP.get(sku, it["category_id"])
        pct = pct_categoria(cat, it["listing_type_id"])
        frete = frete_vendedor(it["id"]) or 0.0; time.sleep(2.5)   # sempre: pior caso = pedido grande (frete por unidade)
        P = resolver(alvo, frete, pct)
        f = fee_api(P, cat, it["listing_type_id"]); time.sleep(0.3)
        fs = frete
        liq = round(P - f - fs, 2)
        if liq < alvo - 0.02:
            obs = (obs + "; " if obs else "") + f"NÃO fecha: líquido {liq:.2f} < alvo (faixa de item barato)"
        if it["status"] != "active":
            obs = (obs + "; " if obs else "") + f"status {it['status']} (preço pode ser bloqueado)"
        print(f"{sku:16} {it['price']:>9.2f} {alvo:>9.2f} {P:>9.2f} {100*pct:>5.1f} {f:>8.2f} {fs:>6.2f} {liq:>9.2f}  {obs}")
        rows.append(dict(id=it["id"], sku=sku, titulo=it["title"], categoria=cat, pct=pct,
                         ml_hoje=it["price"], alvo=alvo, preco=P, comissao=round(f, 2), frete_vendedor=fs, liquido=liq, base=a.base, obs=obs))
        if a.apply and abs(P - float(it["price"])) >= 0.01:
            r = requests.put(f"{API}/items/{it['id']}", headers=H(), json={"price": P}, timeout=30)
            rows[-1]["apply"] = f"{r.status_code}" + ("" if r.ok else " " + r.text[:160])
            print(f"   PUT price -> {rows[-1]['apply']}")
            time.sleep(0.5)
    with open(out, "w", newline="", encoding="utf-8") as f:
        keys = sorted({k for r in rows for k in r})
        w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(rows)
    print(f"\nrelatório: {out}" + ("" if a.apply else "\n(dry-run — use --apply para gravar)"))


if __name__ == "__main__":
    main()
