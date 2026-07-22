#!/usr/bin/env python3
"""
04 — Sincronização planilha master → Olist Tiny ERP.

  --audit    só relatório (match, divergências pai/variação, custos zerados)
  --push     executa:
             • preco = Preço final da planilha, IGUAL no pai e em todas as variações
             • preco_custo = Custo unitário (kits: custo × N)
             • NCM, peso bruto/líquido e dimensões de embalagem da planilha
             • cria produtos que faltam (kits novos etc.) como produto simples
               (padrão já usado no Tiny: "6237989M1 KIT 10 PÇ")
  --limit N  teste com N alterações/criações

API: Tiny v2 (token no .env raiz). produto.alterar.php exige o formato JSON
{"produtos":[{"produto":{...}}]} no campo `produto`.
"""
import csv, datetime, json, sys, time
import openpyxl
from common import (XLSX, REL_DIR, load_env, load_master, norm_sku, sku_match_keys,
                    preco_final, tiny_call)

AUDIT = "--audit" in sys.argv
PUSH  = "--push" in sys.argv
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
TS = datetime.datetime.now().strftime("%Y%m%d_%H%M")

def fetch_tiny(env):
    """Baixa todos os produtos (pesquisa paginada) + detalhe dos que têm variação."""
    prods, page = [], 1
    while True:
        r = tiny_call(env, "produtos.pesquisa.php", pesquisa="", pagina=page)
        ret = r.get("retorno", {})
        if ret.get("status") != "OK":
            break
        prods += [p["produto"] for p in ret.get("produtos", [])]
        if page >= int(ret.get("numero_paginas", 1)):
            break
        page += 1
        time.sleep(0.4)
    return prods

def ncm_fmt(v):
    if not v:
        return None
    s = str(v).replace(".0", "").replace(".", "").strip()
    return f"{s[:4]}.{s[4:6]}.{s[6:8]}" if len(s) == 8 else str(v)

def main():
    env = load_env()
    wb = openpyxl.load_workbook(XLSX, data_only=False)
    master = [d for d in load_master(wb) if d["status"] == "active" and not d["skip"]]
    for d in master:
        d["preco_novo"] = preco_final(d["custo"], d["frete"], d["marg"])
    master = [d for d in master if d["preco_novo"]]

    tiny = fetch_tiny(env)
    print(f"Tiny: {len(tiny)} produtos | planilha: {len(master)} linhas ativas")

    # índices: por código normalizado; árvore pai→filhos
    by_code = {}
    children = {}
    for p in tiny:
        if p.get("codigo"):
            by_code.setdefault(norm_sku(p["codigo"]), []).append(p)
    # variações: mapear filho→pai via produto.obter só se necessário (o pesquisa já traz tipo)
    pais_sem_codigo = [p for p in tiny if p.get("tipoVariacao") == "P" and not p.get("codigo")]

    def find_tiny(sku_shopify):
        hits = []
        for k in sku_match_keys(sku_shopify):
            if k in by_code:
                hits += by_code[k]
        if not hits:
            # sufixo curto (GR140990 → GR140990-20M / -30M)
            for k in sku_match_keys(sku_shopify):
                for code, ps in by_code.items():
                    if code.startswith(k) and 0 < len(code) - len(k) <= 3:
                        hits += ps
        return hits

    plan, criar = [], []
    matched_ids = set()
    for d in master:
        hits = find_tiny(d["sku_shopify"])
        if hits:
            for p in hits:
                matched_ids.add(str(p["id"]))
                plan.append((d, p))
        else:
            criar.append(d)

    # pais sem código cujo(s) filho(s) casaram: também recebem o preço (unificação P/V)
    extra_pais = []
    for d, p in list(plan):
        if p.get("tipoVariacao") == "V":
            pid = None
            det = tiny_call(env, "produto.obter.php", id=p["id"]).get("retorno", {}).get("produto", {})
            pid = det.get("idProdutoPai")
            time.sleep(2.2 if PUSH else 0.4)   # no push, respeita o rate-limit desde o início
            if pid and str(pid) not in matched_ids:
                pai = next((x for x in tiny if str(x["id"]) == str(pid)), None)
                if pai:
                    matched_ids.add(str(pid))
                    extra_pais.append((d, pai))
    plan += extra_pais

    REL_DIR.mkdir(exist_ok=True)
    out = REL_DIR / f"tiny_{'audit' if not PUSH else 'push'}_{TS}.csv"
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["acao", "tiny_id", "tiny_codigo", "tiny_nome", "tipo", "preco_tiny",
                    "preco_novo", "custo_novo", "sku_planilha", "aba"])
        for d, p in plan:
            w.writerow(["alterar", p["id"], p.get("codigo"), str(p.get("nome"))[:60],
                        p.get("tipoVariacao"), p.get("preco"), d["preco_novo"], d["custo"],
                        d["sku_shopify"], d["sheet"]])
        for d in criar:
            w.writerow(["criar", "", d["sku_shopify"], d["titulo_shopify"][:60], "N", "",
                        d["preco_novo"], d["custo"], d["sku_shopify"], d["sheet"]])
    div = sum(1 for d, p in plan if p.get("preco") not in (None, "") and
              abs(float(p["preco"]) - d["preco_novo"]) > 0.01)
    print(f"Match: {len(plan)} registros Tiny a alterar ({len(extra_pais)} pais s/ código) | "
          f"criar: {len(criar)} | preços divergentes: {div} → {out}")
    if not PUSH:
        return

    alter = plan[:LIMIT] if LIMIT else plan
    creates = criar[:LIMIT] if LIMIT else criar
    log, errors = [], 0
    print(f"\nPUSH Tiny: {len(alter)} alterações, {len(creates)} criações")

    # corpo HTML p/ kits (mesmo gerador do Shopify), via importlib (nome começa com dígito)
    import importlib.util, pathlib
    spec = importlib.util.spec_from_file_location(
        "sync_shopify", pathlib.Path(__file__).parent / "03_sync_shopify.py")
    m03 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m03)
    research = m03.load_research()

    PACE = 2.2   # Tiny v2: ~30 req/min por token

    def tiny_safe(endpoint, **params):
        """Chamada com retry em rate-limit ('API Bloqueada')."""
        for attempt in range(4):
            r = tiny_call(env, endpoint, method="POST", **params)
            ret = r.get("retorno", {})
            blob = json.dumps(ret, ensure_ascii=False)
            if "API Bloqueada" in blob:
                wait = 65 if attempt < 3 else 0
                print(f"    rate-limit — aguardando {wait}s ...")
                time.sleep(wait)
                continue
            return ret
        return ret

    def full_record(d, p):
        """produto.obter + merge dos campos novos (alterar exige registro completo)."""
        det = tiny_safe("produto.obter.php", id=p["id"]).get("produto", {}) or {}
        time.sleep(PACE)
        prod = {
            "sequencia": 1,
            "id": p["id"],
            "nome": det.get("nome") or p.get("nome"),
            "unidade": det.get("unidade") or "UN",
            "origem": det.get("origem") or "0",
            "situacao": det.get("situacao") or "A",
            "preco": round(d["preco_novo"], 2),
            "preco_custo": round(d["custo"], 2),
        }
        if det.get("gtin"):
            prod["gtin"] = det["gtin"]
        ncm = ncm_fmt(d["ncm"]) if d["ncm"] else det.get("ncm")
        if ncm:
            prod["ncm"] = ncm
        if d["peso"]:
            prod["peso_bruto"] = round(d["peso"], 3)
            prod["peso_liquido"] = round(d["peso"], 3)
        elif det.get("peso_bruto"):
            prod["peso_bruto"] = det["peso_bruto"]; prod["peso_liquido"] = det.get("peso_liquido")
        if d["comp"] and d["larg"] and d["alt"]:
            prod["comprimentoEmbalagem"] = d["comp"]
            prod["larguraEmbalagem"] = d["larg"]
            prod["alturaEmbalagem"] = d["alt"]
            prod["tipoEmbalagem"] = 2
        if d["is_kit"] and not det.get("descricao_complementar"):
            prod["descricao_complementar"] = m03.build_body(d, research)
        return prod

    for i, (d, p) in enumerate(alter):
        try:
            prod = full_record(d, p)
            ret = tiny_safe("produto.alterar.php",
                            produto=json.dumps({"produtos": [{"produto": prod}]}))
            if ret.get("status") == "OK":
                log.append(("alterar-ok", p["id"], p.get("codigo") or d["sku_shopify"],
                            f"R${d['preco_novo']:.2f} custo R${d['custo']:.2f}"))
            else:
                errors += 1
                log.append(("alterar-ERRO", p["id"], p.get("codigo"), json.dumps(ret.get("registros") or ret.get("erros"), ensure_ascii=False)[:300]))
        except Exception as e:
            errors += 1
            log.append(("alterar-EXC", p["id"], p.get("codigo"), str(e)[:200]))
        if i % 20 == 19:
            print(f"  ... {i+1}/{len(alter)}")
        time.sleep(PACE)

    for i, d in enumerate(creates):
        prod = {
            "sequencia": 1,
            "codigo": d["sku_shopify"],
            "nome": d["titulo_shopify"][:120],
            "unidade": "UN",
            "preco": round(d["preco_novo"], 2),
            "preco_custo": round(d["custo"], 2),
            "origem": "0",
            "situacao": "A",
        }
        if d["ncm"]:
            prod["ncm"] = ncm_fmt(d["ncm"])
        if d["peso"]:
            prod["peso_bruto"] = round(d["peso"], 3)
            prod["peso_liquido"] = round(d["peso"], 3)
        if d["comp"] and d["larg"] and d["alt"]:
            prod["comprimentoEmbalagem"] = d["comp"]
            prod["larguraEmbalagem"] = d["larg"]
            prod["alturaEmbalagem"] = d["alt"]
            prod["tipoEmbalagem"] = 2
        if d["is_kit"]:
            prod["descricao_complementar"] = m03.build_body(d, research)
        try:
            ret = tiny_safe("produto.incluir.php",
                            produto=json.dumps({"produtos": [{"produto": prod}]}))
            if ret.get("status") == "OK":
                log.append(("criar-ok", "", d["sku_shopify"], d["titulo_shopify"][:60]))
            else:
                errors += 1
                log.append(("criar-ERRO", "", d["sku_shopify"], json.dumps(ret.get("registros") or ret.get("erros"), ensure_ascii=False)[:300]))
        except Exception as e:
            errors += 1
            log.append(("criar-EXC", "", d["sku_shopify"], str(e)[:200]))
        if i % 20 == 19:
            print(f"  ... {i+1}/{len(creates)} criações")
        time.sleep(PACE)

    logf = REL_DIR / f"tiny_push_log_{TS}.csv"
    with open(logf, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["resultado", "tiny_id", "codigo", "detalhe"]); w.writerows(log)
    ok = sum(1 for r in log if r[0].endswith("ok"))
    print(f"\nTiny push: {ok} ok, {errors} erros → {logf}")

if __name__ == "__main__":
    main()
