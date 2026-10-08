#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""09 — Refaz a capa de e-commerce dos 11 produtos ex-Greco.

As capas de 08/08/2026 gravaram o código antigo na arte ("CÓD. GR142226").
Depois do 08_limpar_codigos_gr.py o site já usa APPxxxxxx, então a arte
precisa ser recomposta. Reaproveita compose()/remove_white_bg() do script 06
e força a substituição (o 06 é idempotente e pularia esses produtos).

Uso:
    python3 09_recapa_gr.py            # só gera em capas/
    python3 09_recapa_gr.py --subir    # gera e substitui no Shopify
"""
import importlib.util, sys, time
from pathlib import Path
from PIL import Image

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from common import load_env, shopify_token, shopify_graphql, REL_DIR

spec = importlib.util.spec_from_file_location("capas06", BASE / "06_capas_ecommerce.py")
c6 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c6)

# SKU novo -> arquivo de origem em assets/ (nomes antigos: os arquivos não foram renomeados)
FONTES = {
    "APP141207":     "greco_GR141207_ecommerce.png",
    "APP141165":     "greco_GR141165_ecommerce.png",
    "APP140990-30M": "greco_GR140990-30M_ecommerce.png",
    "APP140990-20M": "greco_GR140990-30M_ecommerce.png",  # asset do 20M foi apagado; peça é a mesma
    "APP140682":     "greco_GR140682_ecommerce.png",
    "APP140012":     "greco_GR140012_ecommerce.png",
    "APP142398":     "greco_GR142398_ecommerce.png",
    "APP142229":     "greco_GR142229_ecommerce.png",
    # sensores de fluxo: versão sem sombra de chão (a remoção de fundo deixaria manchas)
    "APP142226":     "app_sensor_fluxo_capa_src.png",
    "APP142227":     "app_sensor_fluxo_capa_src.png",
    "APP142228":     "app_sensor_fluxo_capa_src.png",
}


def main():
    subir = "--subir" in sys.argv
    c6.ensure_fonts()
    env = load_env()
    token = shopify_token(env)
    prods = {}
    for p in c6.fetch_products(env, token):
        sku = (p["variants"]["nodes"][0]["sku"] or "").strip() if p["variants"]["nodes"] else ""
        if sku in FONTES:
            prods[sku] = p
    faltando = set(FONTES) - set(prods)
    if faltando:
        print("! SKU não encontrado no site:", faltando)

    rows = []
    for sku, fonte in FONTES.items():
        p = prods.get(sku)
        if not p:
            continue
        title = p["title"].strip()
        codigo = ((p["skuOem"] or {}).get("value") or sku).strip()
        descricao = c6.descricao_curta(title, sku)
        if "GR" in codigo.upper().replace("AGRO", "") and codigo.upper().startswith("GR"):
            print(f"  ! {sku}: código ainda legado ({codigo}) — rode o 08 antes")
            continue

        src = BASE.parent.parent / "assets" / fonte
        im = Image.open(src)
        im.load()
        out = c6.CAPAS / f"capa_{c6.sanitize(sku)}.png"
        c6.compose(im, codigo, descricao, out)
        print(f"  ✔ {sku} → {out.name}  [CÓD. {codigo} · {descricao}]")

        if not subir:
            rows.append((sku, codigo, descricao, "gerado", out.name))
            continue

        try:
            imgs = [m for m in p["media"]["nodes"]
                    if m["mediaContentType"] == "IMAGE" and m.get("image")]
            old = [m["id"] for m in imgs if (m.get("alt") or "").startswith(c6.OLD_ALT_PREFIX)]
            if old:
                d = shopify_graphql(env, token, c6.M_DEL_MEDIA,
                                    {"productId": p["id"], "mediaIds": old})
                if d["productDeleteMedia"]["mediaUserErrors"]:
                    raise RuntimeError(d["productDeleteMedia"]["mediaUserErrors"])
            alt = f"{c6.ALT_TAG} | {descricao} – Cód. {codigo} | APP Agro Peças Padrão"
            res = c6.staged_upload(env, token, out.name, out.read_bytes())
            d = shopify_graphql(env, token, c6.M_CREATE_MEDIA, {
                "productId": p["id"],
                "media": [{"mediaContentType": "IMAGE", "originalSource": res, "alt": alt}]})
            r = d["productCreateMedia"]
            if r["mediaUserErrors"]:
                raise RuntimeError(r["mediaUserErrors"])
            mid = r["media"][0]["id"]
            if not c6.wait_media_ready(env, token, p["id"], mid):
                raise RuntimeError("mídia não ficou READY")
            d = shopify_graphql(env, token, c6.M_REORDER,
                                {"id": p["id"], "moves": [{"id": mid, "newPosition": "0"}]})
            if d["productReorderMedia"]["mediaUserErrors"]:
                raise RuntimeError(d["productReorderMedia"]["mediaUserErrors"])
            rows.append((sku, codigo, descricao, "subido", out.name))
            print(f"  ✔⇧ {sku}: capa nova em 1ª posição")
        except Exception as e:
            rows.append((sku, codigo, descricao, f"erro: {e}", out.name))
            print(f"  ✖ {sku}: {e}")
        time.sleep(0.5)

    stamp = time.strftime("%Y%m%d_%H%M")
    rel = REL_DIR / f"recapa_gr_{stamp}.csv"
    with open(rel, "w", encoding="utf-8") as f:
        f.write("SKU,Código,Descrição,Status,Arquivo\n")
        for r in rows:
            f.write(",".join('"' + str(c).replace('"', "'") + '"' for c in r) + "\n")
    print(f"\n{len(rows)} capas · relatório: {rel}")


if __name__ == "__main__":
    main()
