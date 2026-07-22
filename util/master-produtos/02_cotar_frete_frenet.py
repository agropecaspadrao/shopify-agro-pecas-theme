#!/usr/bin/env python3
"""
02 — Cotação de frete inbound via Frenet e preenchimento da coluna
"Frete fábrica → eCom" na planilha master.

Regras (decisão 21/07/2026):
  • 02_SOHIPREN não é cotada (frete real já preenchido).
  • 04_GRECO: origem 99025-000 (sede Greco, Passo Fundo/RS).
  • Demais abas: origem 99051-380 (ADG Plásticos, Passo Fundo/RS).
  • Destino: 81220-310 (estoque APP, Curitiba/PR).
  • Linha kit  → cota a caixa do kit (menor preço entre serviços válidos).
  • Linha unit com kit irmão → frete = cotação do MAIOR kit ÷ N (rateio caixa master).
  • Linha unit sem kit → cota pacote unitário.
  • Sem peso e sem dims → default R$ 25,00 (pendência já sinalizada em Observações).

Uso:  python3 02_cotar_frete_frenet.py [--dry]
"""
import csv, json, sys, time, datetime
import openpyxl
from urllib.request import urlopen, Request
from common import (XLSX, REL_DIR, CEP_ORIGEM, CEP_DESTINO, FRENET_URL, FRENET_TOKEN,
                    FRETE_DEFAULT, colmap, load_master)

DRY = "--dry" in sys.argv
TS  = datetime.datetime.now().strftime("%Y%m%d_%H%M")
CACHE = {}
API_CALLS = 0

def frenet_quote(origem, c, l, a, peso, invoice):
    """Retorna (lista de cotações válidas [(carrier, service, price, days)], raw_count)."""
    global API_CALLS
    key = (origem, round(c, 1), round(l, 1), round(a, 1), round(peso, 3), round(invoice, -1))
    if key in CACHE:
        return CACHE[key]
    body = {
        "SellerCEP": origem, "RecipientCEP": CEP_DESTINO,
        "ShipmentInvoiceValue": round(max(invoice, 10.0), 2),
        "RecipientCountry": "BR",
        "ShippingItemArray": [{
            "Height": max(a, 2.0), "Length": max(c, 16.0), "Width": max(l, 11.0),
            "Weight": max(peso, 0.05), "Quantity": 1,
        }],
    }
    for attempt in range(3):
        try:
            req = Request(FRENET_URL, data=json.dumps(body).encode(),
                          headers={"Content-Type": "application/json", "token": FRENET_TOKEN})
            with urlopen(req, timeout=30) as r:
                out = json.loads(r.read())
            API_CALLS += 1
            services = out.get("ShippingSevicesArray", [])
            valid = []
            for s in services:
                if not s.get("Error") and s.get("ShippingPrice"):
                    try:
                        valid.append((s.get("Carrier", "?"), s.get("ServiceDescription", "?"),
                                      float(s["ShippingPrice"]), s.get("DeliveryTime", "")))
                    except ValueError:
                        pass
            valid.sort(key=lambda x: x[2])
            CACHE[key] = valid
            time.sleep(0.25)
            return valid
        except Exception as e:
            if attempt == 2:
                print(f"    !! Frenet falhou 3x ({e}) — caixa {c}x{l}x{a} {peso}kg")
                CACHE[key] = []
                return []
            time.sleep(1.5)

def main():
    wb = openpyxl.load_workbook(XLSX, data_only=False)
    master = load_master(wb)
    rows = [d for d in master if d["sheet"] in CEP_ORIGEM and d["status"] == "active" and not d["skip"]]
    # inclui também duplicatas skip=DUP p/ preencher frete igual (mesma célula de outra linha não ajuda)
    dups = [d for d in master if d["sheet"] in CEP_ORIGEM and d["status"] == "active"
            and d["skip"] and "DUP(sku_shopify)" in d["obs"]]
    rows += dups

    kit_quotes = {}   # (sheet, sku) -> list[(N, frete)]
    results = []
    print(f"Cotando {len(rows)} linhas (origens: Greco 99025-000, ADG 99051-380 → destino {CEP_DESTINO})")

    # 1ª passada: kits e units sem kit
    for d in rows:
        origem = CEP_ORIGEM[d["sheet"]]
        c, l, a, peso = d["comp"], d["larg"], d["alt"], d["peso"]
        cubado = (c * l * a / 6000) if all(x is not None and x > 0 for x in (c, l, a)) else None
        peso_eff = max([x for x in (peso, cubado) if x is not None], default=None)
        has_box = all(x is not None and x > 0 for x in (c, l, a)) and peso_eff is not None
        rec = {"aba": d["sheet"], "linha": d["row"], "sku": d["sku"], "sku_shopify": d["sku_shopify"],
               "tipo": "", "kit_n": d["kit"] or 1, "caixa": f"{c}x{l}x{a}", "peso_kg": peso,
               "invoice": d["custo"], "cotacoes": "", "escolhida": "", "frete_antigo": d["frete"],
               "frete_novo": None, "obs": ""}
        if d["is_kit"]:
            if has_box:
                q = frenet_quote(origem, c, l, a, peso_eff, d["custo"] or 10)
                rec["cotacoes"] = " | ".join(f"{x[0]} {x[1]}: R${x[2]:.2f} ({x[3]}d)" for x in q)
                if q:
                    rec["tipo"] = "kit"
                    rec["frete_novo"] = q[0][2]
                    rec["escolhida"] = f"{q[0][0]} {q[0][1]}"
                    kit_quotes.setdefault((d["sheet"], d["sku"]), []).append((d["kit"], q[0][2]))
                else:
                    rec["tipo"] = "kit SEM COTAÇÃO"; rec["frete_novo"] = None
            else:
                rec["tipo"] = "kit sem dados"; rec["frete_novo"] = FRETE_DEFAULT; rec["obs"] = "default"
        elif not d["is_kit"]:
            rec["tipo"] = "unit"  # pode virar rateio na 2ª passada
            if has_box:
                q = frenet_quote(origem, c, l, a, peso_eff, d["custo"] or 10)
                rec["cotacoes"] = " | ".join(f"{x[0]} {x[1]}: R${x[2]:.2f} ({x[3]}d)" for x in q)
                if q:
                    rec["frete_novo"] = q[0][2]
                    rec["escolhida"] = f"{q[0][0]} {q[0][1]}"
                else:
                    rec["frete_novo"] = FRETE_DEFAULT; rec["obs"] = "sem cotação → default"
            else:
                rec["frete_novo"] = FRETE_DEFAULT
                rec["obs"] = "sem peso/dims → default"
        results.append(rec)

    # 2ª passada: rateio p/ units com kit irmão
    for rec in results:
        if rec["tipo"] != "unit":
            continue
        kq = kit_quotes.get((rec["aba"], rec["sku"]))
        if kq:
            n, frete_kit = max(kq)          # maior caixa = melhor rateio
            rec["frete_novo"] = round(frete_kit / n, 2)
            rec["tipo"] = f"rateio caixa {n}"
            rec["escolhida"] += f" → R${frete_kit:.2f}/{n}"

    # grava na planilha
    changed = 0
    for rec in results:
        if rec["frete_novo"] is None:
            continue
        ws = wb[rec["aba"]]
        cm = colmap(ws)
        cell = ws.cell(row=rec["linha"], column=cm["frete"])
        if cell.value != rec["frete_novo"]:
            cell.value = round(rec["frete_novo"], 2)
            changed += 1

    wb.calculation.fullCalcOnLoad = True
    if not DRY:
        wb.save(XLSX)
    REL_DIR.mkdir(exist_ok=True)
    out = REL_DIR / f"frete_frenet_{TS}{'_dry' if DRY else ''}.csv"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        w.writeheader(); w.writerows(results)

    fretes = [r["frete_novo"] for r in results if r["frete_novo"]]
    print(f"\n{'[DRY] ' if DRY else ''}Linhas processadas: {len(results)} | células alteradas: {changed}")
    print(f"Chamadas Frenet: {API_CALLS} (cache hits: {len(rows) - API_CALLS if API_CALLS <= len(rows) else 0})")
    print(f"Frete min/méd/max: R${min(fretes):.2f} / R${sum(fretes)/len(fretes):.2f} / R${max(fretes):.2f}")
    from collections import Counter
    for t, n in Counter(r["tipo"] for r in results).most_common():
        print(f"  {n:3d} × {t}")
    print(f"Relatório: {out}")

if __name__ == "__main__":
    main()
