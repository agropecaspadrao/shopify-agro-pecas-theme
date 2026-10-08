"""Melhora os anúncios existentes no Mercado Livre a partir do site (Shopify) + planilha.

O que faz por anúncio (dry-run gera relatório para revisão; --apply grava):
  1. categoria   — tira das categorias erradas (mamadeira, tatuagem, Bluetooth...) e
                   põe no ramo "Agro > Peças Maquinaria Agrícola" (CAT_MAP), reativando o ME2
  2. atributos   — BRAND=Genérica, MODEL, PART_NUMBER, VEHICLE_TYPE=Agrícola (obrigatórios)
  3. descrição   — TODOS os 37 estavam SEM descrição; monta texto a partir do site
                   (aplicação, compatibilidade, specs, códigos) — sem contato, sem marca como afiliação
  4. fotos       — reordena: foto branca do produto primeiro (regra do ML), capa APP depois
  5. título      — só onde a API permite (anúncio sem family_name); os outros ficam no relatório

Uso:
    python3 ml_melhorar.py                                  # dry-run → relatorios/ml_melhorias_<data>.md
    python3 ml_melhorar.py --apply                          # tudo, todos
    python3 ml_melhorar.py --apply --only CQ65827,A56254    # só esses SKUs
    python3 ml_melhorar.py --apply --step descricao,fotos   # só essas etapas
Depois de recategorizar, rode ml_precos.py (a comissão muda por categoria).
"""
from __future__ import annotations
import argparse, datetime, html, json, re, time
from pathlib import Path
import requests
import ml_auth

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
REL = HERE / "relatorios"; REL.mkdir(exist_ok=True)
API = "https://api.mercadolibre.com"

# SKU → categoria correta (ramo Agro > Peças Maquinaria Agrícola). Os demais mantêm a atual.
CAT_MAP = {
    "A56254": "MLB456879",      # Aro tampa reservatório (era Sementes de mercearia)
    "CQ59313": "MLB456879",     # Caixa de sementes (era Caixa Bluetooth)
    "A72758": "MLB456879",      # Peneira mini hopper (era Peneira de cozinha)
    "A74430": "MLB456879",      # Engate hidráulico rápido (era Ferramentas)
    "ACX310603A": "MLB456879",  # Manípulo pneumático (era Válvulas de construção)
    "ACX283890A": "MLB456879",  # Vedação tubo de ar (era Junta de compressor AC)
    "6117-4142": "MLB456879",   # Bucha do mancal pantográfico (era Motor > Buchas)
    "8031-4009": "MLB456878",   # Bico central plataforma milho (era Bico de mamadeira)
    "8031-4008": "MLB456878",   # Ponteira bico (era Biqueira de tatuagem)
    "IPCX03007010": "MLB456878",# Dedo do molinete (era Indústria > Outros)
    "KK31825": "MLB456878",     # Dedo recolhedor pequeno (era Indústria > Outros; irmãos já em Plataforma)
    "N276747": "MLB456878",     # Tampa algodão colhedora (era Tampa de cárter de moto)
    "4383934M4": "MLB457094",   # Dobradiça cabine (era Dobradiça de móvel)
    "4383927M4": "MLB457094",
}
VEHICLE_TYPE = "Agrícola"
BRAND = "Genérica"
RODAPE = ("Peça no padrão original (OEM), de fornecedores com certificação ISO 9001. "
          "Marcas de máquinas citadas apenas como referência de compatibilidade. "
          "Emissão de nota fiscal. Envio para todo o Brasil.\n\n"
          "Dúvida se serve na sua máquina? Pergunte antes de comprar informando marca e modelo.")


def H():
    return {"Authorization": f"Bearer {ml_auth.get_access_token()}"}


def strip_html(s: str) -> str:
    s = re.sub(r"<(br|/p|/li|/h\d)[^>]*>", "\n", s or "")
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", s)).strip()


def limpar_marca(txt: str) -> str:
    """Conformidade: nunca 'original'/'distribuidor' solto; nunca marca de fornecedor."""
    txt = re.sub(r"\bLIVENZA\b", "fornecedor", txt, flags=re.I)
    txt = re.sub(r"\bGreco( Agro Tech)?\b", "APP", txt)
    txt = re.sub(r"\bpeça original\b", "peça no padrão original", txt, flags=re.I)
    return txt


def split_title(t: str):
    """'Peça - Marca CÓD | Aplicação' → (peça, marca+cód, aplicação)."""
    peca, resto = (t.split(" - ", 1) + [""])[:2]
    marca_cod, apl = (resto.split(" | ", 1) + [""])[:2]
    return peca.strip(), marca_cod.strip(), apl.strip()


def titulo_ml(shop_title: str, sku: str, part: str | None) -> str:
    peca, marca_cod, apl = split_title(shop_title)
    marca = re.sub(r"\b" + re.escape(sku) + r"\b", "", marca_cod).strip(" -")
    if part and part != sku: marca = re.sub(r"\b" + re.escape(part) + r"\b", "", marca).strip(" -")
    if marca and sku.upper().startswith(marca.upper()): marca = ""   # "APP APP141207" → "APP141207"
    apl_curta = re.split(r"[/,(]", apl)[0].strip()
    apl_curta = re.sub(r"\b(Séries?|Linha)\b.*$", "", apl_curta).strip()
    cands = [f"{peca} {apl_curta} {marca} {sku}", f"{peca} {marca} {sku}", f"{peca} {sku}", peca]
    for c in cands:
        c = re.sub(r"\s+", " ", c).strip()
        if len(c) <= 60: return c
    return peca[:60]


def descricao(shop: dict, sku: str) -> str:
    mf = {m["key"]: m["value"] for m in shop["metafields"]["nodes"]}
    peca, marca_cod, apl = split_title(shop["title"])
    L = [shop["title"].replace(" - ", " – ", 1)]
    L.append(f"Código: {sku}" + (f" | Referência: {mf['part_number']}" if mf.get("part_number") and mf["part_number"] != sku else ""))
    if mf.get("oem") and mf["oem"] not in (sku, mf.get("part_number")): L.append(f"Códigos cruzados: {mf['oem']}")
    L.append("")
    if mf.get("application"):
        L += ["APLICAÇÃO"] + [f"• {x.strip()}" for x in mf["application"].split("|") if x.strip()] + [""]
    comp = mf.get("compatibility") or mf.get("equipamento")
    if comp:
        if mf.get("montadora") and mf["montadora"].lower() not in comp.lower(): comp = f"{mf['montadora']}: {comp}"
        L += ["COMPATIBILIDADE"] + [f"• {x.strip()}" for x in comp.split("|") if x.strip()] + [""]
    if mf.get("specs"):
        sp = [x.strip() for x in mf["specs"].split("|") if x.strip() and not x.lower().startswith("prazo")]
        if sp: L += ["ESPECIFICAÇÕES"] + [f"• {x}" for x in sp] + [""]
    if not mf.get("application"):        # sem metafield: 1ª frase útil do corpo
        body = strip_html(shop["descriptionHtml"]).split("\n")[0]
        if body: L += [body, ""]
    L.append(RODAPE)
    txt = limpar_marca("\n".join(L))
    return txt[:49000]


def fotos(shop: dict) -> list[dict]:
    """Foto branca primeiro (regra ML: capa em fundo branco, sem texto), capa APP depois."""
    imgs = shop["images"]["nodes"]
    capa = [i for i in imgs if (i.get("altText") or "").startswith("capa-app")]
    resto = [i for i in imgs if i not in capa and "desenho técnico" not in (i.get("altText") or "")]
    tec = [i for i in imgs if "desenho técnico" in (i.get("altText") or "")]
    ordem = resto + capa + tec
    return [{"source": i["url"].split("?")[0] + "?" + i["url"].split("?")[1]} for i in ordem][:10]


def atributos(it: dict, cat: str, shop: dict, sku: str, req_ids: set[str]) -> list[dict]:
    mf = {m["key"]: m["value"] for m in shop["metafields"]["nodes"]}
    part = mf.get("part_number") or mf.get("oem") or sku
    at = [{"id": "BRAND", "value_name": BRAND},
          {"id": "MODEL", "value_name": (part if part != sku else sku)[:60]},
          {"id": "SELLER_SKU", "value_name": sku}]
    if "PART_NUMBER" in req_ids or cat in ("MLB457278", "MLB457094"):
        at.append({"id": "PART_NUMBER", "value_name": part[:60]})
    if "VEHICLE_TYPE" in req_ids:
        at.append({"id": "VEHICLE_TYPE", "value_name": VEHICLE_TYPE})
    return at


_REQ = {}
def required_attrs(cat: str) -> set[str]:
    if cat not in _REQ:
        a = requests.get(f"{API}/categories/{cat}/attributes", headers=H(), timeout=30).json()
        _REQ[cat] = {x["id"] for x in a if "required" in x.get("tags", {})}
        time.sleep(0.2)
    return _REQ[cat]


def put(item_id: str, body: dict) -> tuple[int, str]:
    r = requests.put(f"{API}/items/{item_id}", headers=H(), json=body, timeout=60)
    return r.status_code, ("" if r.ok else r.text[:220])


def set_descricao(item_id: str, txt: str) -> tuple[int, str]:
    r = requests.get(f"{API}/items/{item_id}/description", headers=H(), timeout=30)
    metodo = requests.put if r.ok and r.json().get("plain_text") else requests.post
    r = metodo(f"{API}/items/{item_id}/description", headers=H(), json={"plain_text": txt}, timeout=60)
    return r.status_code, ("" if r.ok else r.text[:220])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--step", default="categoria,atributos,descricao,fotos,titulo")
    a = ap.parse_args()
    steps = set(a.step.split(","))
    only = {s.strip() for s in a.only.split(",") if s.strip()}

    items = json.load(open(DATA / "ml_itens_2026-09-27.json"))
    fam = json.load(open(DATA / "ml_family_2026-09-27.json"))
    shop_all = json.load(open(DATA / "shopify_37_2026-09-27.json"))
    hoje = datetime.date.today().isoformat()
    md = [f"# Melhorias Mercado Livre — {hoje} ({'APLICADO' if a.apply else 'dry-run'})\n"]
    plano = []

    for it in sorted(items, key=lambda x: x["title"]):
        sku = next((x.get("value_name") for x in it["attributes"] if x["id"] == "SELLER_SKU"), "")
        if only and sku not in only: continue
        shop = shop_all.get(sku)
        if not shop:
            md.append(f"## {sku} — {it['title']}\n- SEM produto no site, pulado\n"); continue
        cat_alvo = CAT_MAP.get(sku, it["category_id"])
        req = required_attrs(cat_alvo)
        p = dict(id=it["id"], sku=sku, titulo_atual=it["title"], cat_atual=it["category_id"], cat_alvo=cat_alvo,
                 titulo_novo=titulo_ml(shop["title"], sku, next((m["value"] for m in shop["metafields"]["nodes"] if m["key"] == "part_number"), None)),
                 titulo_editavel=fam.get(it["id"], {}).get("family_name") is None,
                 atributos=atributos(it, cat_alvo, shop, sku, req), descricao=descricao(shop, sku), fotos=fotos(shop),
                 fotos_atuais=len(it.get("pictures", [])), log=[])
        plano.append(p)

        if a.apply:
            if "categoria" in steps and cat_alvo != it["category_id"]:
                p["log"].append(("categoria", put(it["id"], {"category_id": cat_alvo, "attributes": p["atributos"]})))
                time.sleep(1.0)
                p["log"].append(("me2", put(it["id"], {"shipping": {"mode": "me2"}})))
            if "atributos" in steps:
                p["log"].append(("atributos", put(it["id"], {"attributes": p["atributos"]})))
            if "descricao" in steps:
                p["log"].append(("descricao", set_descricao(it["id"], p["descricao"])))
            if "fotos" in steps and p["fotos"]:
                p["log"].append(("fotos", put(it["id"], {"pictures": p["fotos"]})))
            if "titulo" in steps and p["titulo_editavel"] and p["titulo_novo"] != it["title"]:
                p["log"].append(("titulo", put(it["id"], {"title": p["titulo_novo"]})))
            time.sleep(0.6)
            print(sku, [(k, v[0]) for k, v in p["log"]])

        md.append(f"## {sku} — {it['id']}\n")
        md.append(f"- **Título atual:** {it['title']}")
        md.append(f"- **Título proposto:** {p['titulo_novo']}  ({len(p['titulo_novo'])} c.) — "
                  + ("editável pela API" if p["titulo_editavel"] else "**tem family_name → só pelo painel/relistar**"))
        md.append(f"- **Categoria:** {it['category_id']} → {cat_alvo}" + ("  ← MUDA" if cat_alvo != it["category_id"] else ""))
        md.append(f"- **Atributos:** " + ", ".join(f"{x['id']}={x['value_name']}" for x in p["atributos"]))
        md.append(f"- **Fotos:** {p['fotos_atuais']} no ML → {len(p['fotos'])} do site (branca primeiro)")
        md.append(f"- **Descrição proposta:**\n\n```\n{p['descricao']}\n```\n")
        if p["log"]:
            md.append("- **Resultado:** " + "; ".join(f"{k} {v[0]}{(' ' + v[1]) if v[1] else ''}" for k, v in p["log"]) + "\n")

    out = REL / f"ml_melhorias_{hoje}{'_APLICADO' if a.apply else ''}.md"
    out.write_text("\n".join(md), encoding="utf-8")
    json.dump(plano, open(DATA / f"ml_plano_melhorias_{hoje}.json", "w"), ensure_ascii=False, indent=1)
    n_cat = sum(1 for p in plano if p["cat_alvo"] != p["cat_atual"]); n_tit = sum(1 for p in plano if p["titulo_editavel"])
    print(f"\n{len(plano)} anúncios | {n_cat} mudam de categoria | {n_tit} títulos editáveis pela API | relatório: {out}")


if __name__ == "__main__":
    main()
