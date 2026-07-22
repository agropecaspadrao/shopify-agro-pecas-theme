#!/usr/bin/env python3
"""
03 — Sincronização planilha master → Shopify.

  --audit          só relatório (match, preço novo vs site, ações) — nenhuma escrita
  --push           executa: atualiza existentes (preço/custo/peso/metafields/descrição
                   curta) e cria novos (units JD/STARA/GTS + kits como produto separado)
  --limit N        no push: processa só N updates e N creates (teste)

Regras:
  • Match por SKU normalizado (exato → sem pontuação → sem sufixo '.0'). SKU do site nunca muda.
  • Preço = (custo+frete)/(1−margem)/(1−0,2082) — espelho da planilha.
  • Descrições: produtos novos ganham body completo; existentes só se body < 200 chars.
    Metafields agro.* sempre atualizados. Conformidade: "padrão original (OEM)",
    marcas apenas como compatibilidade.
  • Estoque não é tocado (novos ficam 0 = "Sob Consulta").
"""
import csv, datetime, html, json, pathlib, re, sys, time
import openpyxl
from common import (XLSX, REL_DIR, TAXA_MP, load_env, load_master, norm_sku,
                    sku_match_keys, preco_final, shopify_token, shopify_graphql)

AUDIT = "--audit" in sys.argv
PUSH  = "--push" in sys.argv
REBODY_KITS = "--rebody-kits" in sys.argv   # força regravar descrição dos produtos kit
LIMIT = None
if "--limit" in sys.argv:
    LIMIT = int(sys.argv[sys.argv.index("--limit") + 1])
TS = datetime.datetime.now().strftime("%Y%m%d_%H%M")
PESQ_DIR = pathlib.Path(__file__).parent / "pesquisa"

# ── pesquisa de specs (agentes) ──────────────────────────────────────────────
def load_research():
    out = {}
    for f in PESQ_DIR.glob("specs_*.json"):
        try:
            for item in json.load(open(f)):
                out[norm_sku(item["sku"])] = item
        except Exception as e:
            print(f"  aviso: {f.name} ilegível ({e})")
    return out

# ── helpers de texto ─────────────────────────────────────────────────────────
SMALL = {"de", "do", "da", "dos", "das", "para", "p/", "com", "e", "em", "no", "na"}
ACRON = re.compile(r"^(JD|SRM|GR\d+|CJ|TDF|GTS|ABS|ECU|PP|BH\d+|MF|1POL)$", re.I)

def title_case_pt(s):
    words = str(s).strip().split()
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if ACRON.match(w) or any(ch.isdigit() for ch in w):
            out.append(w.upper() if ACRON.match(w) else w)  # códigos com dígito: preserva
        elif lw in SMALL and i > 0:
            out.append(lw)
        else:
            out.append(w.capitalize())
    return " ".join(out)

BRAND_TOKENS = {"JD", "JOHN", "DEERE", "GTS", "STARA", "AGCO", "MASSEY", "FERGUSON"}

def clean_name(title, montadora):
    """Remove tokens de marca soltos do nome (a marca entra depois, como compatibilidade)."""
    if not montadora:
        return title
    words = [w for w in str(title).split() if w.upper().strip(".,") not in BRAND_TOKENS]
    return " ".join(words) if words else title

def build_title(d):
    base = title_case_pt(clean_name(d["title"], d["montadora"]))
    mont = str(d["montadora"] or "").split(",")[0].strip().title() or None
    mont = {"Agco": "AGCO", "John Deere": "John Deere", "Stara": "Stara", "Gts": "GTS"}.get(mont, mont)
    if mont and mont.upper() in ("TODAS AS MARCAS", "TODAS", "UNIVERSAL"):
        mont = None
    if d["is_kit"]:
        core = f"{base} — Kit {d['kit']} Unidades"
    else:
        core = base
    if mont:
        return f"{core} — {mont} {d['sku']}"
    return f"{core} — {d['sku']}"

def esc(s):
    return html.escape(str(s), quote=False)

def build_specs_pairs(d, research):
    """Lista (label, valor) para metafield specs e bloco <ul> da descrição."""
    pairs = []
    part = str(d["part"] or "")
    if part and part != str(d["sku"]) and not re.match(r"(?i)^\s*kit\s*\d+", part):
        pairs.append(("Part Number", d["part"]))
    if d["cruzados"]:
        pairs.append(("Códigos cruzados", str(d["cruzados"]).replace("/", " / ")))
    r = research.get(norm_sku(d["sku"])) or {}
    for k, v in (r.get("especificacoes") or {}).items():
        if d["is_kit"] and ("quantidade" in k.lower() or "kit" in k.lower()):
            continue   # a quantidade do kit vem da linha da planilha, não da pesquisa
        label = k.replace("_", " ").capitalize().replace("Diametro", "Diâmetro").replace(" mm", " (mm)")
        pairs.append((label, v))
    if d["peso"]:
        peso = d["peso"] if not d["is_kit"] else d["peso"]
        pairs.append(("Peso", f"{round(peso, 3)} kg" + (" (kit)" if d["is_kit"] else "")))
    if d["comp"] and d["larg"] and d["alt"]:
        sufixo = " (caixa do kit)" if d["is_kit"] else " (embalagem)"
        pairs.append(("Dimensões", f"{d['comp']} × {d['larg']} × {d['alt']} cm{sufixo}"))
    if d["ncm"]:
        ncm = str(d["ncm"]).replace(".0", "")
        if len(ncm) == 8:
            ncm = f"{ncm[:4]}.{ncm[4:6]}.{ncm[6:]}"
        pairs.append(("NCM", ncm))
    if d["lead"]:
        pairs.append(("Prazo de preparação", f"{int(d['lead'])} dias úteis"))
    return pairs

def build_compat(d, research):
    r = research.get(norm_sku(d["sku"])) or {}
    items = []
    if r.get("compatibilidade"):
        items += [str(x) for x in r["compatibilidade"]]
    elif d["montadora"] or d["equip"]:
        mont = str(d["montadora"] or "").strip()
        eq = title_case_pt(str(d["equip"] or "").strip()) if d["equip"] else ""
        items.append(f"{eq} {mont}".strip() if eq else mont)
    return [x for x in items if x]

def build_body(d, research, unit_final=None):
    r = research.get(norm_sku(d["sku"])) or {}
    nome = title_case_pt(clean_name(d["title"], d["montadora"]))
    desc_pesq = r.get("descricao_tecnica")
    if desc_pesq and d["is_kit"]:
        # remove frases que citam outro tamanho de kit (pesquisa foi feita p/ um lote específico)
        frases = [s for s in re.split(r"(?<=\.)\s+", desc_pesq)
                  if not re.search(r"(?i)kit\s+(com\s+)?\d+", s)]
        desc_pesq = " ".join(frases).strip() or None
    intro = desc_pesq or (
        f"{nome} no padrão original (OEM), fornecida por fabricante com certificação ISO. "
        f"Peça de reposição para {title_case_pt(str(d['equip'] or 'equipamentos agrícolas'))}"
        + (f" — função: {str(d['funcao']).strip().lower()}." if d["funcao"] else "."))
    parts = []
    if d["is_kit"]:
        parts.append(f"<p><strong>Kit com {d['kit']} unidades</strong> — {esc(intro)}</p>")
        parts.append("<h2>Conteúdo do kit</h2>")
        econ = ""
        if unit_final:
            total_avulso = unit_final * d["kit"]
            kit_price = preco_final(d["custo"], d["frete"], d["marg"])
            if kit_price and total_avulso > kit_price:
                pct = (1 - kit_price / total_avulso) * 100
                if pct >= 1:
                    econ = f" — economia de {pct:.0f}% em relação à compra avulsa"
        parts.append(f"<p>{d['kit']} × {esc(nome)} (código {esc(d['sku'])}){econ}.</p>")
    else:
        parts.append(f"<p>{esc(intro)}</p>")
    if r.get("funcao") or d["funcao"]:
        parts.append("<h2>Aplicação</h2>")
        parts.append(f"<p>{esc(r.get('funcao') or title_case_pt(str(d['funcao'])))}</p>")
    compat = build_compat(d, research)
    if compat:
        parts.append("<h2>Compatibilidade</h2>")
        parts.append("<ul>" + "".join(f"<li>{esc(c)}</li>" for c in compat) + "</ul>")
        parts.append("<p><em>Marcas citadas apenas como referência de compatibilidade.</em></p>")
    specs = build_specs_pairs(d, research)
    specs_full = [("Código", d["sku"])] + specs
    parts.append("<h2>Especificações</h2>")
    parts.append("<ul>" + "".join(f"<li><strong>{esc(a)}:</strong> {esc(b)}</li>" for a, b in specs_full) + "</ul>")
    parts.append("<h2>Por que comprar na APP Agro Peças?</h2>")
    parts.append("<ul><li>Peças no padrão original (OEM), de fornecedores com certificação ISO</li>"
                 "<li>Emissão de nota fiscal</li>"
                 "<li>Envio para todo o Brasil via transportadora ou Correios</li>"
                 "<li>Suporte técnico via WhatsApp</li></ul>")
    return "\n".join(parts)

def build_metafields(d, research):
    pairs = build_specs_pairs(d, research)
    compat = build_compat(d, research)
    r = research.get(norm_sku(d["sku"])) or {}
    mf = [
        ("sku_oem", "single_line_text_field", str(d["sku"])),
        ("specs", "multi_line_text_field", "|".join(f"{a}: {b}" for a, b in pairs) or None),
        ("compatibility", "multi_line_text_field", "|".join(compat) or None),
        ("application", "multi_line_text_field",
         str(r.get("funcao") or (title_case_pt(str(d["funcao"])) if d["funcao"] else "")) or None),
    ]
    if d["part"]:
        mf.append(("part_number", "single_line_text_field", str(d["part"])))
    if d["comp"] and d["larg"] and d["alt"]:
        mf.append(("dimensoes_cm", "single_line_text_field", f"{d['comp']} × {d['larg']} × {d['alt']} cm"))
    return [{"namespace": "agro", "key": k, "type": t, "value": str(v)} for k, t, v in mf if v]

def build_tags(d):
    tags = set()
    if d["tags"]:
        tags |= {t.strip() for t in str(d["tags"]).split(",") if t.strip() and not t.strip().startswith("=")}
    if d["montadora"]:
        tags |= {m.strip().lower() for m in str(d["montadora"]).split(",") if m.strip()}
    if d["equip"]:
        tags.add(str(d["equip"]).strip().lower())
    if d["is_kit"]:
        tags.add("kit")
    return sorted(tags)

# ── Shopify fetch ────────────────────────────────────────────────────────────
def fetch_catalog(env, token):
    prods, cursor = [], None
    q = """query($after:String){ products(first:50, after:$after){
      edges{ node{ id title handle status vendor productType tags
        descriptionHtml
        variants(first:10){ edges{ node{ id sku title price
          inventoryItem{ id unitCost{ amount } measurement{ weight{ value unit } } } } } } } }
      pageInfo{ hasNextPage endCursor } } }"""
    while True:
        data = shopify_graphql(env, token, q, {"after": cursor})
        for e in data["products"]["edges"]:
            prods.append(e["node"])
        pi = data["products"]["pageInfo"]
        if not pi["hasNextPage"]:
            break
        cursor = pi["endCursor"]
        time.sleep(0.2)
    return prods

def main():
    env = load_env()
    wb = openpyxl.load_workbook(XLSX, data_only=False)
    master = [d for d in load_master(wb) if d["status"] == "active" and not d["skip"]]
    research = load_research()
    print(f"Planilha: {len(master)} linhas ativas | pesquisa: {len(research)} SKUs com specs")

    token = shopify_token(env)
    catalog = fetch_catalog(env, token)
    print(f"Shopify: {len(catalog)} produtos")

    # índice site por SKU normalizado
    site_by_sku = {}
    for p in catalog:
        for ve in p["variants"]["edges"]:
            v = ve["node"]
            if v["sku"]:
                site_by_sku.setdefault(norm_sku(v["sku"]), (p, v))

    # match + plano de ações
    def find_site(d):
        keys = sku_match_keys(d["sku_shopify"])
        for k in keys:
            if k in site_by_sku:
                return site_by_sku[k]
        # sufixo curto no site: '502200548824' ⊂ '5022005488242' (-2), 'GR140990' ⊂ 'GR14099030M'
        for k in keys:
            for sk, pv in site_by_sku.items():
                if sk.startswith(k) and 0 < len(sk) - len(k) <= 3:
                    return pv
        return None

    plan = []
    unit_finals = {}
    for d in master:
        d["preco_novo"] = preco_final(d["custo"], d["frete"], d["marg"])
        if not d["is_kit"] and d["preco_novo"]:
            unit_finals[(d["sheet"], d["sku"])] = d["preco_novo"]
    used_products = {}
    for d in master:
        hit = find_site(d)
        if d["preco_novo"] is None:
            plan.append({**d, "acao": "SEM_PRECO", "site_p": None, "site_v": None}); continue
        if hit:
            pid = hit[0]["id"]
            if pid in used_products:
                plan.append({**d, "acao": "CONFLITO_MATCH", "site_p": hit[0], "site_v": hit[1]})
                continue
            used_products[pid] = d["sku_shopify"]
            plan.append({**d, "acao": "update", "site_p": hit[0], "site_v": hit[1]})
        elif d["sheet"] == "02_SOHIPREN":
            # bomba sem match nunca vira produto novo — pode ser revisão de código (-2 vs .0)
            plan.append({**d, "acao": "REVISAR_MANUAL", "site_p": None, "site_v": None})
        else:
            plan.append({**d, "acao": "create", "site_p": None, "site_v": None})

    # relatório
    REL_DIR.mkdir(exist_ok=True)
    out = REL_DIR / f"shopify_{'audit' if not PUSH else 'push'}_{TS}.csv"
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["acao", "aba", "linha", "sku_shopify", "titulo_novo", "custo", "frete", "marg",
                    "preco_novo", "preco_site", "delta_pct", "body_site_len"])
        for d in plan:
            ps = float(d["site_v"]["price"]) if d["site_v"] else None
            delta = round((d["preco_novo"] / ps - 1) * 100, 1) if ps and d["preco_novo"] else None
            w.writerow([d["acao"], d["sheet"], d["row"], d["sku_shopify"],
                        build_title(d) if d["acao"] == "create" else (d["site_p"]["title"] if d["site_p"] else ""),
                        d["custo"], d["frete"], d["marg"], d["preco_novo"], ps, delta,
                        len(d["site_p"]["descriptionHtml"] or "") if d["site_p"] else ""])
    from collections import Counter
    cnt = Counter(d["acao"] for d in plan)
    print(f"Ações: {dict(cnt)} → {out}")
    if not PUSH:
        ups = [d for d in plan if d["acao"] == "update" and d["site_v"] and d["preco_novo"]]
        big = sorted(ups, key=lambda d: abs(d["preco_novo"] / float(d["site_v"]["price"]) - 1), reverse=True)[:8]
        print("\nMaiores variações de preço (update):")
        for d in big:
            ps = float(d["site_v"]["price"])
            print(f"  {d['sku_shopify']:24} site R${ps:9.2f} → novo R${d['preco_novo']:9.2f} ({(d['preco_novo']/ps-1)*100:+.1f}%)")
        return

    # ── PUSH ────────────────────────────────────────────────────────────────
    # publicação Online Store
    pubs = shopify_graphql(env, token, "{ publications(first:10){ edges{ node{ id name } } } }")
    online = [e["node"]["id"] for e in pubs["publications"]["edges"]
              if "online" in e["node"]["name"].lower()]

    MUT_VARS = """mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){
      productVariantsBulkUpdate(productId:$productId, variants:$variants){
        userErrors{ field message } } }"""
    MUT_MF = """mutation($metafields:[MetafieldsSetInput!]!){
      metafieldsSet(metafields:$metafields){ userErrors{ field message } } }"""
    MUT_BODY = """mutation($input:ProductInput!){
      productUpdate(input:$input){ userErrors{ field message } } }"""
    MUT_SET = """mutation($input:ProductSetInput!){
      productSet(synchronous:true, input:$input){
        product{ id variants(first:1){ edges{ node{ id } } } }
        userErrors{ field message } } }"""
    MUT_PUB = """mutation($id:ID!,$input:[PublicationInput!]!){
      publishablePublish(id:$id, input:$input){ userErrors{ field message } } }"""

    updates = [d for d in plan if d["acao"] == "update"]
    creates = [d for d in plan if d["acao"] == "create"]
    if "--only-updates" in sys.argv:
        creates = []
    if "--only-creates" in sys.argv:
        updates = []
    if "--sheets" in sys.argv:
        allow = set(sys.argv[sys.argv.index("--sheets") + 1].split(","))
        updates = [d for d in updates if d["sheet"] in allow]
        creates = [d for d in creates if d["sheet"] in allow]
    if LIMIT:
        updates, creates = updates[:LIMIT], creates[:LIMIT]
    log_rows, errors = [], 0

    print(f"\nPUSH: {len(updates)} updates, {len(creates)} creates")
    for i, d in enumerate(updates):
        p, v = d["site_p"], d["site_v"]
        try:
            # todas as variantes do produto recebem o MESMO preço/custo/peso (unificação)
            vars_input = [{"id": ve["node"]["id"], "price": f"{d['preco_novo']:.2f}",
                           "inventoryItem": {"cost": f"{d['custo']:.2f}",
                                             "measurement": {"weight": {"value": float(round(d["peso"], 3)) if d["peso"] else 0.1,
                                                                        "unit": "KILOGRAMS"}}}}
                          for ve in p["variants"]["edges"]]
            r1 = shopify_graphql(env, token, MUT_VARS, {"productId": p["id"], "variants": vars_input})
            errs = r1["productVariantsBulkUpdate"]["userErrors"]
            mfs = [{**m, "ownerId": p["id"]} for m in build_metafields(d, research)]
            if mfs:
                r2 = shopify_graphql(env, token, MUT_MF, {"metafields": mfs})
                errs += r2["metafieldsSet"]["userErrors"]
            if len(p["descriptionHtml"] or "") < 200 or (REBODY_KITS and d["is_kit"]):
                body = build_body(d, research, unit_finals.get((d["sheet"], d["sku"])))
                r3 = shopify_graphql(env, token, MUT_BODY, {"input": {"id": p["id"], "descriptionHtml": body}})
                errs += r3["productUpdate"]["userErrors"]
            if errs:
                errors += 1
                log_rows.append(("update-ERRO", d["sku_shopify"], str(errs)))
                print(f"  !! update {d['sku_shopify']}: {errs}")
            else:
                log_rows.append(("update-ok", d["sku_shopify"], f"R${d['preco_novo']:.2f}"))
        except Exception as e:
            errors += 1
            log_rows.append(("update-EXC", d["sku_shopify"], str(e)[:200]))
            print(f"  !! update {d['sku_shopify']}: {e}")
        if i % 20 == 19:
            print(f"  ... {i+1}/{len(updates)} updates")
        time.sleep(0.35)

    for i, d in enumerate(creates):
        try:
            body = build_body(d, research, unit_finals.get((d["sheet"], d["sku"])))
            inp = {
                "title": build_title(d),
                "descriptionHtml": body,
                "vendor": "APP Agro Peças Padrão",
                "productType": str(d["type"] or "Peças Agrícolas"),
                "tags": build_tags(d),
                "status": "ACTIVE",
                "metafields": build_metafields(d, research),
                "productOptions": [{"name": "Title", "values": [{"name": "Default Title"}]}],
                "variants": [{
                    "optionValues": [{"optionName": "Title", "name": "Default Title"}],
                    "price": f"{d['preco_novo']:.2f}",
                    "sku": d["sku_shopify"],
                    "inventoryItem": {"cost": f"{d['custo']:.2f}", "tracked": True,
                                      "measurement": {"weight": {"value": float(round(d["peso"], 3)) if d["peso"] else 0.1,
                                                                 "unit": "KILOGRAMS"}}},
                }],
            }
            r1 = shopify_graphql(env, token, MUT_SET, {"input": inp})
            errs = r1["productSet"]["userErrors"]
            pid = (r1["productSet"]["product"] or {}).get("id")
            if pid and online:
                r2 = shopify_graphql(env, token, MUT_PUB,
                                     {"id": pid, "input": [{"publicationId": x} for x in online]})
                errs += r2["publishablePublish"]["userErrors"]
            if errs:
                errors += 1
                log_rows.append(("create-ERRO", d["sku_shopify"], str(errs)))
                print(f"  !! create {d['sku_shopify']}: {errs}")
            else:
                log_rows.append(("create-ok", d["sku_shopify"], f"R${d['preco_novo']:.2f} {build_title(d)[:50]}"))
        except Exception as e:
            errors += 1
            log_rows.append(("create-EXC", d["sku_shopify"], str(e)[:200]))
            print(f"  !! create {d['sku_shopify']}: {e}")
        if i % 20 == 19:
            print(f"  ... {i+1}/{len(creates)} creates")
        time.sleep(0.4)

    logf = REL_DIR / f"shopify_push_log_{TS}.csv"
    with open(logf, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["resultado", "sku", "detalhe"]); w.writerows(log_rows)
    ok = sum(1 for r in log_rows if r[0].endswith("ok"))
    print(f"\nPush concluído: {ok} ok, {errors} erros → {logf}")

if __name__ == "__main__":
    main()
