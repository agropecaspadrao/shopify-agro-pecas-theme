#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""08 — Limpeza dos códigos legados GR* no catálogo (rebrand Greco → APP).

A virada de 13/08/2026 renomeou os SKUs (GR140990 → APP140990) mas deixou o
código antigo em título, tags, descrição, handle, metafield e alt das imagens.
Este script fecha essa ponta nos 11 produtos afetados:

    GR141207 → APP141207   (código de peça, 6 dígitos)
    GR200/GR500 → APP200/APP500   (nome de modelo)
    "Greco Agro Tech" → "APP"
    handle …-greco-agro-tech-… → …-app-…  (+ redirect 301 do handle antigo)

A arte da capa (código gravado no PNG) é refeita pelo 09_recapa_gr.py.

Uso:
    python3 08_limpar_codigos_gr.py            # dry-run: mostra o diff
    python3 08_limpar_codigos_gr.py --apply    # grava no Shopify
"""
import json, re, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import load_env, shopify_token, shopify_graphql, REL_DIR

# handle novo por handle antigo — explícito para não gerar "app-app" no meio da URL
HANDLES = {
    "gps-agricola-gr200-greco-agro-tech-navegacao-de-precisao":
        "gps-agricola-app200-navegacao-de-precisao",
    "kit-de-iluminacao-noturna-pulverizacao-greco-agro-tech":
        "kit-de-iluminacao-noturna-pulverizacao-app",
    "kit-ponta-de-cerca-greco-agro-tech":
        "kit-ponta-de-cerca-30-metros-app",
    "kit-ponta-de-cerca-20-metros-greco-agro-tech":
        "kit-ponta-de-cerca-20-metros-app",
    "sensor-de-levante-haste-greco-agro-tech-precision-planting-pm400":
        "sensor-de-levante-haste-app-precision-planting-pm400",
    "sensor-de-levante-corrente-greco-agro-tech-precision-planting-pm400":
        "sensor-de-levante-corrente-app-precision-planting-pm400",
    "monitor-de-fluxo-de-sementes-gr500-greco-agro-tech":
        "monitor-de-fluxo-de-sementes-app500",
    "sensor-de-fluxo-25-4mm-greco-agro-tech-precision-planting-pm400":
        "sensor-de-fluxo-25-4mm-app-precision-planting-pm400",
    "sensor-de-fluxo-32mm-greco-agro-tech-precision-planting-pm400":
        "sensor-de-fluxo-32mm-app-precision-planting-pm400",
    "sensor-de-fluxo-50-8mm-greco-agro-tech-precision-planting-pm400":
        "sensor-de-fluxo-50-8mm-app-precision-planting-pm400",
    "sensor-de-semente-greco-agro-tech-precision-planting-pm400":
        "sensor-de-semente-app-precision-planting-pm400",
}

Q_PRODUCTS = """
query($after: String) {
  products(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle title tags descriptionHtml
      variants(first: 10) { nodes { sku } }
      metafields(first: 30, namespace: "agro") { nodes { key value type } }
      media(first: 20) { nodes { ... on MediaImage { id alt } } }
    }
  }
}"""

M_PRODUCT = """
mutation($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id handle title }
    userErrors { field message }
  }
}"""

M_METAFIELDS = """
mutation($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { key value }
    userErrors { field message }
  }
}"""

M_FILE_ALT = """
mutation($files: [FileUpdateInput!]!) {
  fileUpdate(files: $files) {
    files { id }
    userErrors { field message }
  }
}"""

M_REDIRECT = """
mutation($redirect: UrlRedirectInput!) {
  urlRedirectCreate(urlRedirect: $redirect) {
    urlRedirect { id path target }
    userErrors { field message }
  }
}"""

PAT_ANY = re.compile(r"\bGR[\s\-]?\d|Greco", re.IGNORECASE)


def fix_text(s):
    """GR141207→APP141207, GR200→APP200, Greco Agro Tech→APP."""
    if not s:
        return s
    s = re.sub(r"\bGR(\d{6})", r"APP\1", s)          # código de peça
    s = re.sub(r"\bGR(200|500)\b", r"APP\1", s)      # modelo (título/descrição)
    s = re.sub(r"\bgr(200|500)\b", r"app\1", s)      # modelo (tag lowercase)
    s = re.sub(r"Greco Agro Tech", "APP", s, flags=re.I)
    s = re.sub(r"\bGreco\b", "APP", s)
    return s


def main():
    apply = "--apply" in sys.argv
    env = load_env()
    token = shopify_token(env)

    after, prods = None, []
    while True:
        d = shopify_graphql(env, token, Q_PRODUCTS, {"after": after})
        p = d["products"]
        prods += p["nodes"]
        if not p["pageInfo"]["hasNextPage"]:
            break
        after = p["pageInfo"]["endCursor"]
    print(f"{len(prods)} produtos no site\n")

    rows = []
    for pr in prods:
        sku = (pr["variants"]["nodes"][0]["sku"] or "") if pr["variants"]["nodes"] else ""
        alvos = []

        new_title = fix_text(pr["title"])
        if new_title != pr["title"]:
            alvos.append(("titulo", pr["title"], new_title))

        new_handle = HANDLES.get(pr["handle"])
        if new_handle and new_handle != pr["handle"]:
            alvos.append(("handle", pr["handle"], new_handle))

        new_desc = fix_text(pr["descriptionHtml"])
        if new_desc != pr["descriptionHtml"]:
            antes = [m.group(0) for m in re.finditer(r"\bGR[\w\-]*", pr["descriptionHtml"])]
            alvos.append(("descricao", ", ".join(antes), "→ APP…"))

        new_tags = [fix_text(t) for t in pr["tags"]]
        if new_tags != pr["tags"]:
            diff = [f"{a}→{b}" for a, b in zip(pr["tags"], new_tags) if a != b]
            alvos.append(("tags", ", ".join(diff), ""))

        mfs = []
        for m in pr["metafields"]["nodes"]:
            nv = fix_text(m["value"])
            if nv != m["value"]:
                mfs.append((m["key"], m["type"], nv))
                alvos.append((f"metafield:{m['key']}", m["value"], nv))

        alts = []
        for md in pr["media"]["nodes"]:
            if not md or not md.get("alt"):
                continue
            na = fix_text(md["alt"])
            if na != md["alt"]:
                alts.append((md["id"], na))
                alvos.append(("alt", md["alt"], na))

        if not alvos:
            continue

        print("=" * 88)
        print(f"{sku}  {pr['title']}")
        for campo, antes, depois in alvos:
            print(f"   {campo:22} {antes}" + (f"\n   {'':22} → {depois}" if depois else ""))

        rows += [(sku, pr["handle"], c, a, d_) for c, a, d_ in alvos]

        if not apply:
            continue

        inp = {"id": pr["id"]}
        if new_title != pr["title"]:
            inp["title"] = new_title
        if new_handle:
            inp["handle"] = new_handle
        if new_desc != pr["descriptionHtml"]:
            inp["descriptionHtml"] = new_desc
        if new_tags != pr["tags"]:
            inp["tags"] = new_tags
        if len(inp) > 1:
            r = shopify_graphql(env, token, M_PRODUCT, {"input": inp})["productUpdate"]
            if r["userErrors"]:
                print("   ✖ produto:", r["userErrors"])
            else:
                print("   ✔ produto atualizado")

        if mfs:
            payload = [{"ownerId": pr["id"], "namespace": "agro", "key": k,
                        "type": t, "value": v} for k, t, v in mfs]
            r = shopify_graphql(env, token, M_METAFIELDS, {"metafields": payload})["metafieldsSet"]
            print("   ✖ metafield:" if r["userErrors"] else "   ✔ metafields", r["userErrors"] or "")

        if alts:
            r = shopify_graphql(env, token, M_FILE_ALT,
                                {"files": [{"id": i, "alt": a} for i, a in alts]})["fileUpdate"]
            print("   ✖ alt:" if r["userErrors"] else "   ✔ alt das imagens", r["userErrors"] or "")

        if new_handle:
            r = shopify_graphql(env, token, M_REDIRECT, {
                "redirect": {"path": f"/products/{pr['handle']}",
                             "target": f"/products/{new_handle}"}})["urlRedirectCreate"]
            print("   ✖ redirect:" if r["userErrors"] else "   ✔ redirect 301", r["userErrors"] or "")

        time.sleep(0.4)

    stamp = time.strftime("%Y%m%d_%H%M")
    rel = REL_DIR / f"limpeza_gr_{stamp}.csv"
    with open(rel, "w", encoding="utf-8") as f:
        f.write("SKU,Handle,Campo,Antes,Depois\n")
        for r in rows:
            f.write(",".join('"' + str(c).replace('"', "'") + '"' for c in r) + "\n")
    print("\n" + ("APLICADO" if apply else "DRY-RUN — rode com --apply para gravar"))
    print(f"{len(rows)} alterações · relatório: {rel}")


if __name__ == "__main__":
    main()
