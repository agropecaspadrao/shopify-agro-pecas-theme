#!/usr/bin/env python3
"""
14 — Auditoria completa: planilha master × site (Shopify).

Só leitura. Cruza cada linha ativa da master com o produto correspondente no site
e emite achados classificados por severidade.

  --drive        baixa a master fresca do Google Drive antes de auditar
                 (token em /tmp/gdrive_token.txt ou $GDRIVE_TOKEN)
  --xlsx PATH    audita um .xlsx específico (default: util/APP_Master_Produtos_Shopify.xlsx)
  --only CHECK   roda só um grupo de checagens (preco, estoque, conteudo, marca, cobertura)
  --json         grava também o dump completo em JSON

Saída: relatorios/auditoria_completa_<TS>.csv + resumo no terminal.

Grupos de checagem
  cobertura  FALTA_NO_SITE · ORFAO_NO_SITE · CONFLITO_MATCH · DRAFT · NAO_PUBLICADO · SEM_SKU
  preco      PRECO_DIVERGENTE · PRECO_ZERO · PLANILHA_INCONSISTENTE · CUSTO_DIVERGENTE ·
             KIT_MAIS_CARO · KIT_PRECO_SUSPEITO
  estoque    ESTOQUE_ZERO · ESTOQUE_FORA_POLITICA
  conteudo   SEM_IMAGEM · IMAGEM_PROVISORIA · DESCRICAO_CURTA · METAFIELD_FALTANDO ·
             PESO_DIVERGENTE · PESO_AUSENTE · SEM_SEO
  marca      CONFORMIDADE (regras do CLAUDE.md: nunca "distribuidor oficial"/OEM de marca,
             ISO é dos fornecedores, resíduo do rebrand Greco→APP)
"""
import csv, datetime, json, os, pathlib, re, shutil, sys, time
from collections import Counter, defaultdict
from urllib.request import urlopen, Request

import openpyxl
from openpyxl.utils import get_column_letter as L

from common import (XLSX, REL_DIR, load_env, load_master, colmap, norm_sku,
                    sku_match_keys, preco_final, shopify_token, shopify_graphql,
                    _resolve, PRODUCT_SHEETS)

TS = datetime.datetime.now().strftime("%Y%m%d_%H%M")
DRIVE_FILE_ID = "1FoyfpY5E4Z4dYcEk7hiP2Jrg_dts6teu"   # master .xlsx (drive compartilhado)
TOKEN_FILE = pathlib.Path("/tmp/gdrive_token.txt")

TOL_PRECO = 0.01      # 1% de tolerância (arredondamento da cadeia de preço)
TOL_CUSTO = 0.02
TOL_PESO  = 0.05
DESC_MIN  = 200       # chars de descriptionHtml abaixo disso = descrição pobre

SEV = {"ALTA": 0, "MEDIA": 1, "BAIXA": 2}

# ── 1. obter a master ────────────────────────────────────────────────────────
def baixar_master(dest: pathlib.Path) -> pathlib.Path:
    """Download da master do Drive. Drive compartilhado exige supportsAllDrives."""
    tok = os.environ.get("GDRIVE_TOKEN") or (
        TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else "")
    if not tok:
        sys.exit("!! sem token do Drive. Rode no terminal:\n"
                 "   gcloud auth print-access-token --account=admin@agropecaspadrao.com.br "
                 "> /tmp/gdrive_token.txt")
    url = (f"https://www.googleapis.com/drive/v3/files/{DRIVE_FILE_ID}"
           f"?alt=media&supportsAllDrives=true")
    req = Request(url, headers={"Authorization": f"Bearer {tok}"})
    try:
        with urlopen(req, timeout=180) as r:
            dest.write_bytes(r.read())
    except Exception as e:
        sys.exit(f"!! download da master falhou ({e}). Token expirado? Rode:\n"
                 "   gcloud auth login admin@agropecaspadrao.com.br --enable-gdrive-access --force")
    print(f"Master do Drive → {dest} ({dest.stat().st_size/1024:.0f} KB)")
    return dest

# ── 2. catálogo do site ──────────────────────────────────────────────────────
Q_FULL = """query($after:String){
  products(first:40, after:$after){
    edges{ node{
      id title handle status vendor productType tags descriptionHtml totalInventory
      seo{ title description }
      media(first:10){ edges{ node{ ... on MediaImage { image{ url altText } } } } }
      metafields(namespace:"agro", first:25){ edges{ node{ key value } } }
      resourcePublications(first:10){ edges{ node{ isPublished publication{ name } } } }
      variants(first:20){ edges{ node{ id sku title price compareAtPrice inventoryQuantity
        inventoryItem{ unitCost{ amount } measurement{ weight{ value unit } } } } } }
    } }
    pageInfo{ hasNextPage endCursor } } }"""

def fetch_catalog(env, token):
    prods, cursor = [], None
    while True:
        data = shopify_graphql(env, token, Q_FULL, {"after": cursor})
        prods += [e["node"] for e in data["products"]["edges"]]
        pi = data["products"]["pageInfo"]
        if not pi["hasNextPage"]:
            break
        cursor = pi["endCursor"]
        time.sleep(0.25)
    return prods

def flatten(p):
    """Achata o produto do GraphQL nos campos que a auditoria usa."""
    imgs = [e["node"]["image"] for e in p["media"]["edges"] if e["node"].get("image")]
    mf = {e["node"]["key"]: e["node"]["value"] for e in p["metafields"]["edges"]}
    pubs = {e["node"]["publication"]["name"]: e["node"]["isPublished"]
            for e in p["resourcePublications"]["edges"]}
    vs = [e["node"] for e in p["variants"]["edges"]]
    v0 = vs[0] if vs else {}
    ii = (v0.get("inventoryItem") or {})
    peso = ((ii.get("measurement") or {}).get("weight") or {})
    return {
        "id": p["id"], "title": p["title"], "handle": p["handle"], "status": p["status"],
        "vendor": p["vendor"], "type": p["productType"], "tags": p["tags"],
        "body": p["descriptionHtml"] or "", "estoque": p["totalInventory"],
        "seo_title": (p["seo"] or {}).get("title") or "",
        "seo_desc": (p["seo"] or {}).get("description") or "",
        "imgs": imgs, "mf": mf, "pubs": pubs, "variants": vs,
        "sku": v0.get("sku") or "", "preco": float(v0.get("price") or 0),
        "custo": float((ii.get("unitCost") or {}).get("amount") or 0) or None,
        "peso_kg": (peso.get("value") if peso.get("unit") == "KILOGRAMS" else
                    (peso.get("value") or 0) / 1000 if peso.get("unit") == "GRAMS" else None),
    }

# ── 3. regras de conformidade de marca (CLAUDE.md) ───────────────────────────
PROIBIDO = [
    (re.compile(r"distribuidor\s+(oficial|autorizad)", re.I), "afirma distribuidor oficial/autorizado"),
    (re.compile(r"revend[ae]\s+autorizad", re.I),             "afirma revenda autorizada"),
    (re.compile(r"\b(somos|nossa)\b[^.]{0,40}\bOEM\b", re.I),  "afirma ser OEM"),
    (re.compile(r"\bOEM\s+(da|de)\s+(livenza|agco|valtra|john\s*deere)", re.I), "OEM atrelado a marca"),
    (re.compile(r"\bpe(ç|c)a\s+original\b(?!\s*\(?oem)", re.I), "'peça original' sem 'padrão'"),
    (re.compile(r"nossa[s]?\s+certifica(ç|c)", re.I),          "ISO atribuída à empresa"),
    (re.compile(r"empresa\s+certificada\s+ISO", re.I),         "ISO atribuída à empresa"),
    (re.compile(r"greco", re.I),                               "resíduo do rebrand Greco→APP"),
    (re.compile(r"\bGR\d{5,6}\b"),                             "código GR remanescente (rebrand)"),
]

def checar_marca(texto):
    return [motivo for rx, motivo in PROIBIDO if rx.search(texto or "")]

# ── 4. política de estoque (decisão 21/07/2026) ──────────────────────────────
def estoque_esperado(d, site):
    tipo = f"{d.get('type') or ''} {site.get('type') if site else ''} {d.get('title') or ''}".lower()
    if "bomba" in tipo or "motor" in tipo or d["sheet"].startswith("02_"):
        return 10
    if d["sheet"].startswith("04_"):     # APPTECH: GPS/monitores/sensores/iluminação
        return 10
    return 50

# ── 5. auditoria ─────────────────────────────────────────────────────────────
def main():
    argv = sys.argv[1:]
    grupos = {"cobertura", "preco", "estoque", "conteudo", "marca"}
    if "--only" in argv:
        grupos = {argv[argv.index("--only") + 1]}

    # master
    if "--xlsx" in argv:
        xlsx = pathlib.Path(argv[argv.index("--xlsx") + 1])
    elif "--drive" in argv:
        xlsx = baixar_master(REL_DIR.parent / "master_drive.xlsx")
    else:
        xlsx = XLSX
        print(f"Master local: {xlsx.name} "
              f"(mod. {datetime.datetime.fromtimestamp(xlsx.stat().st_mtime):%d/%m/%Y %H:%M}) "
              f"— use --drive para a versão do Drive")

    wb = openpyxl.load_workbook(xlsx, data_only=False)
    todas = load_master(wb)
    master = [d for d in todas if d["status"] == "active" and not d["skip"]]
    puladas = [d for d in todas if d["skip"] and d["status"] == "active"]
    print(f"Planilha: {len(master)} linhas ativas ({len(puladas)} ativas puladas por dado incompleto)")

    # coluna "Preço final" da própria planilha, p/ conferir a cadeia de cálculo
    final_col = {}
    for name in {d["sheet"] for d in master}:
        ws = wb[name]
        cm = colmap(ws)
        if "final" in cm:
            final_col[name] = (ws, L(cm["final"]))

    env = load_env()
    token = shopify_token(env)
    catalog = [flatten(p) for p in fetch_catalog(env, token)]
    print(f"Shopify: {len(catalog)} produtos "
          f"({sum(1 for p in catalog if p['status'] == 'ACTIVE')} ativos)")

    site_by_sku = {}
    for p in catalog:
        for v in p["variants"]:
            if v["sku"]:
                site_by_sku.setdefault(norm_sku(v["sku"]), (p, v))

    def find_site(sku_shopify):
        keys = sku_match_keys(sku_shopify)
        for k in keys:
            if k in site_by_sku:
                return site_by_sku[k]
        for k in keys:                      # sufixo curto: GR140990 ⊂ GR14099030M
            for sk, pv in site_by_sku.items():
                if sk.startswith(k) and 0 < len(sk) - len(k) <= 3:
                    return pv
        return None

    achados = []
    def add(sev, check, d, site, detalhe, esperado="", atual=""):
        achados.append({
            "severidade": sev, "check": check,
            "aba": d["sheet"] if d else "", "linha": d["row"] if d else "",
            "sku": (d["sku_shopify"] if d else (site or {}).get("sku", "")),
            "produto": (site or {}).get("title") or (d or {}).get("titulo_shopify") or "",
            "handle": (site or {}).get("handle", ""),
            "detalhe": detalhe, "esperado": esperado, "atual": atual,
        })

    # preço unitário por (aba, sku) p/ avaliar economia dos kits
    unit_final = {}
    for d in master:
        if not d["is_kit"]:
            p = preco_final(d["custo"], d["frete"], d["marg"])
            if p:
                unit_final[(d["sheet"], d["sku"])] = p

    vistos = {}
    for d in master:
        hit = find_site(d["sku_shopify"])
        site = hit[0] if hit else None
        var = hit[1] if hit else None
        calc = preco_final(d["custo"], d["frete"], d["marg"])

        # ── cobertura ────────────────────────────────────────────────────────
        if "cobertura" in grupos:
            if not site:
                add("ALTA", "FALTA_NO_SITE", d, None,
                    "linha ativa na planilha sem produto correspondente no site",
                    esperado=f"criar {d['sku_shopify']}")
                continue
            if site["id"] in vistos and vistos[site["id"]] != d["sku_shopify"]:
                add("ALTA", "CONFLITO_MATCH", d, site,
                    f"casou no mesmo produto que {vistos[site['id']]}")
            vistos[site["id"]] = d["sku_shopify"]
            if site["status"] != "ACTIVE":
                add("ALTA", "DRAFT", d, site, "ativo na planilha, não-ativo no site",
                    esperado="ACTIVE", atual=site["status"])
            if site["status"] == "ACTIVE" and not any(v["sku"] for v in site["variants"]):
                add("ALTA", "SEM_SKU", d, site,
                    "variante sem SKU — não casa com planilha/Tiny/ML nem com o feed do Google")
            if site["status"] == "ACTIVE" and not site["pubs"].get("Online Store", False):
                add("ALTA", "NAO_PUBLICADO", d, site,
                    "produto ativo mas fora do canal Online Store")
        elif not site:
            continue

        # ── preço ────────────────────────────────────────────────────────────
        if "preco" in grupos:
            ps = float(var["price"] or 0) if var else 0
            if calc is None:
                add("ALTA", "SEM_PRECO_PLANILHA", d, site,
                    "custo/margem ausentes — planilha não calcula preço")
            elif ps == 0:
                add("ALTA", "PRECO_ZERO", d, site, "produto no site com preço 0",
                    esperado=f"{calc:.2f}", atual="0.00")
            elif abs(calc / ps - 1) > TOL_PRECO:
                delta = (calc / ps - 1) * 100
                add("ALTA" if abs(delta) > 5 else "MEDIA", "PRECO_DIVERGENTE", d, site,
                    f"site diverge da planilha em {delta:+.1f}%",
                    esperado=f"{calc:.2f}", atual=f"{ps:.2f}")
            # a própria planilha bate com a cadeia de cálculo?
            if calc and d["sheet"] in final_col:
                ws, col = final_col[d["sheet"]]
                declarado = _resolve(ws, col, d["row"])
                if declarado and abs(calc / declarado - 1) > TOL_PRECO:
                    add("MEDIA", "PLANILHA_INCONSISTENTE", d, site,
                        "'Preço final' da planilha ≠ (custo+frete)/(1−margem)/(1−taxa)",
                        esperado=f"{calc:.2f}", atual=f"{declarado:.2f}")
            # custo (unitCost do site = custo do kit inteiro, por convenção do pipeline)
            if d["custo"] and site["custo"]:
                if abs(site["custo"] / d["custo"] - 1) > TOL_CUSTO:
                    add("MEDIA", "CUSTO_DIVERGENTE", d, site,
                        "custo unitário do site ≠ planilha (afeta margem nos relatórios)",
                        esperado=f"{d['custo']:.2f}", atual=f"{site['custo']:.2f}")
            elif d["custo"] and not site["custo"]:
                add("BAIXA", "CUSTO_AUSENTE", d, site, "site sem custo cadastrado",
                    esperado=f"{d['custo']:.2f}")
            # kit tem que sair mais barato que N avulsos
            if d["is_kit"] and calc:
                u = unit_final.get((d["sheet"], d["sku"]))
                if u:
                    avulso = u * d["kit"]
                    if calc > avulso * 1.005:
                        add("MEDIA", "KIT_MAIS_CARO", d, site,
                            f"kit de {d['kit']} sai mais caro que {d['kit']} avulsos "
                            f"({(calc/avulso-1)*100:+.1f}%)",
                            esperado=f"≤ {avulso:.2f}", atual=f"{calc:.2f}")
                    ps_ratio = (ps / avulso) if avulso and ps else None
                    if ps_ratio and ps_ratio < 0.5:
                        add("ALTA", "KIT_PRECO_SUSPEITO", d, site,
                            f"preço do kit no site é {ps_ratio*100:.0f}% do valor de "
                            f"{d['kit']} avulsos — provável célula/colagem errada",
                            esperado=f"~{calc:.2f}", atual=f"{ps:.2f}")

        # ── estoque ──────────────────────────────────────────────────────────
        if "estoque" in grupos and site["status"] == "ACTIVE":
            esperado = estoque_esperado(d, site)
            atual = site["estoque"] or 0
            if atual <= 0:
                add("ALTA", "ESTOQUE_ZERO", d, site,
                    "estoque 0 → o tema esconde preço e carrinho ('Sob Consulta')",
                    esperado=str(esperado), atual=str(atual))
            elif atual != esperado:
                add("BAIXA", "ESTOQUE_FORA_POLITICA", d, site,
                    "fora da política de vitrine (50 peças/kits · 10 bombas e APPTECH)",
                    esperado=str(esperado), atual=str(atual))

        # ── conteúdo ─────────────────────────────────────────────────────────
        if "conteudo" in grupos:
            if not site["imgs"]:
                add("ALTA", "SEM_IMAGEM", d, site, "produto sem nenhuma imagem")
            else:
                urls = " ".join((i.get("url") or "") for i in site["imgs"])
                alts = " ".join((i.get("altText") or "") for i in site["imgs"])
                if "bomba_generica" in urls:
                    add("MEDIA", "IMAGEM_PROVISORIA", d, site,
                        "usando a imagem genérica de bomba ('meramente ilustrativa')")
                elif "foto-padrao" in alts:
                    add("MEDIA", "IMAGEM_PROVISORIA", d, site,
                        "usando a capa padrão sem foto da peça")
                elif "rn-image_picker" in urls or "Screenshot" in urls:
                    add("MEDIA", "IMAGEM_PROVISORIA", d, site,
                        "foto de celular / screenshot como imagem de catálogo")
            body_txt = re.sub(r"<[^>]+>", "", site["body"]).strip()
            if len(body_txt) < DESC_MIN:
                add("MEDIA", "DESCRICAO_CURTA", d, site,
                    f"descrição com {len(body_txt)} chars", esperado=f"≥ {DESC_MIN}")
            faltando = [k for k in ("sku_oem", "specs", "compatibility", "application")
                        if not site["mf"].get(k)]
            if faltando:
                add("BAIXA", "METAFIELD_FALTANDO", d, site,
                    "metafields agro.* vazios: " + ", ".join(faltando))
            if d["peso"] and site["peso_kg"]:
                if abs(site["peso_kg"] / d["peso"] - 1) > TOL_PESO:
                    add("MEDIA", "PESO_DIVERGENTE", d, site,
                        "peso do site ≠ planilha (erra o frete cobrado do cliente)",
                        esperado=f"{d['peso']:.3f} kg", atual=f"{site['peso_kg']:.3f} kg")
            elif not site["peso_kg"] and site["status"] == "ACTIVE":
                add("ALTA", "PESO_AUSENTE", d, site,
                    "produto ativo sem peso → frete de saída não calcula no checkout",
                    esperado=f"{d['peso']:.3f} kg" if d["peso"] else "peso na planilha também vazio")
            if not site["seo_desc"]:
                add("BAIXA", "SEM_SEO", d, site, "sem meta description")

        # ── conformidade de marca ────────────────────────────────────────────
        if "marca" in grupos:
            alvo = f"{site['title']} {site['body']} {' '.join(site['tags'])} " \
                   f"{site['seo_title']} {site['seo_desc']} {site['handle']}"
            for motivo in set(checar_marca(alvo)):
                add("ALTA", "CONFORMIDADE", d, site, motivo)

    # órfãos: produto ativo no site sem linha ativa na planilha
    if "cobertura" in grupos:
        for p in catalog:
            if p["status"] == "ACTIVE" and p["id"] not in vistos:
                add("MEDIA", "ORFAO_NO_SITE", None, p,
                    "produto ativo no site sem linha ativa correspondente na planilha")
                if not any(v["sku"] for v in p["variants"]):
                    add("ALTA", "SEM_SKU", None, p,
                        "variante sem SKU — não casa com planilha/Tiny/ML nem com o feed do Google")
                if not p["peso_kg"]:
                    add("ALTA", "PESO_AUSENTE", None, p,
                        "produto ativo sem peso → frete de saída não calcula no checkout")
        for d in puladas:
            add("BAIXA", "LINHA_INCOMPLETA", d, None,
                f"linha ativa ignorada pelo pipeline: {d['obs'][:90] or 'sem título/custo'}")

    # conformidade também nos produtos órfãos
    if "marca" in grupos:
        for p in catalog:
            if p["status"] == "ACTIVE" and p["id"] not in vistos:
                alvo = f"{p['title']} {p['body']} {' '.join(p['tags'])} {p['handle']}"
                for motivo in set(checar_marca(alvo)):
                    add("ALTA", "CONFORMIDADE", None, p, motivo)

    # ── relatório ────────────────────────────────────────────────────────────
    REL_DIR.mkdir(exist_ok=True)
    achados.sort(key=lambda a: (SEV[a["severidade"]], a["check"], a["sku"]))
    out = REL_DIR / f"auditoria_completa_{TS}.csv"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(achados[0].keys()) if achados else
                           ["severidade", "check", "aba", "linha", "sku", "produto",
                            "handle", "detalhe", "esperado", "atual"])
        w.writeheader()
        w.writerows(achados)

    if "--json" in argv:
        (REL_DIR / f"auditoria_completa_{TS}.json").write_text(
            json.dumps({"gerado": TS, "master": str(xlsx), "linhas_ativas": len(master),
                        "produtos_site": len(catalog), "achados": achados}, ensure_ascii=False, indent=2))

    por_check = Counter((a["severidade"], a["check"]) for a in achados)
    print(f"\n{'='*72}\nAUDITORIA COMPLETA — {len(achados)} achados\n{'='*72}")
    for sev in ("ALTA", "MEDIA", "BAIXA"):
        linhas = [(c, n) for (s, c), n in por_check.items() if s == sev]
        if not linhas:
            continue
        print(f"\n[{sev}]")
        for c, n in sorted(linhas, key=lambda x: -x[1]):
            print(f"  {n:4}  {c}")
            for a in [a for a in achados if a["check"] == c][:3]:
                extra = f" (esperado {a['esperado']} · atual {a['atual']})" if a["esperado"] else ""
                print(f"          · {a['sku'] or a['produto'][:34]}: {a['detalhe']}{extra}")
            if n > 3:
                print(f"          … +{n-3} no CSV")
    print(f"\n→ {out}")

if __name__ == "__main__":
    main()
