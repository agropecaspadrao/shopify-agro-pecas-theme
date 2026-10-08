#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""11 — Publica no Shopify as fotos ex-Greco já sem a marca (ver 10_apagar_marca.py).

Para cada SKU afetado:
  1. sobe a foto limpa de assets/ (mantendo o alt da antiga);
  2. recompõe a capa v2 a partir da foto limpa e sobe;
  3. só então apaga a foto antiga, a capa antiga e a duplicata órfã do 20M;
  4. reordena: capa (1ª) → foto (2ª) → resto.

Sobe antes de apagar de propósito: se algo falhar no meio, o produto nunca
fica sem imagem.

Uso:
    python3 11_publicar_limpas.py            # dry-run: só mostra o plano
    python3 11_publicar_limpas.py --apply    # executa
"""
import importlib.util
import sys
import time
from pathlib import Path

from PIL import Image

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from common import load_env, shopify_token, shopify_graphql, REL_DIR  # noqa: E402

spec = importlib.util.spec_from_file_location("capas06", BASE / "06_capas_ecommerce.py")
c6 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c6)

ASSETS = BASE.parent.parent / "assets"

# SKU -> arquivo (limpo) em assets/
FOTOS = {
    "APP141207":     "greco_GR141207_ecommerce.png",
    "APP142398":     "greco_GR142398_ecommerce.png",
    "APP140012":     "greco_GR140012_ecommerce.png",
    "APP140682":     "greco_GR140682_ecommerce.png",
    "APP140990-30M": "greco_GR140990-30M_ecommerce.png",
    "APP140990-20M": "greco_GR140990-30M_ecommerce.png",   # mesma peça
}
# duplicata de baixa resolução que só existe no CDN — sai do ar
ORFA = "greco_GR140990-20M_ecommerce"


def media_imgs(p):
    return [m for m in p["media"]["nodes"]
            if m["mediaContentType"] == "IMAGE" and m.get("image")]


def classifica(p, arquivo):
    """Separa a mídia do produto em capa / foto da peça / órfã / resto."""
    capa = foto = None
    orfas = []
    alvo = arquivo.rsplit(".", 1)[0]
    for m in media_imgs(p):
        alt = m.get("alt") or ""
        url = m["image"]["url"]
        if alt.startswith(c6.OLD_ALT_PREFIX):
            capa = m
        elif ORFA in url:
            orfas.append(m)
        elif alvo in url or "greco_GR" in url:
            foto = foto or m
    return capa, foto, orfas


def sobe(env, token, prod_id, nome, data, alt):
    res = c6.staged_upload(env, token, nome, data)
    d = shopify_graphql(env, token, c6.M_CREATE_MEDIA, {
        "productId": prod_id,
        "media": [{"mediaContentType": "IMAGE", "originalSource": res, "alt": alt}]})
    r = d["productCreateMedia"]
    if r["mediaUserErrors"]:
        raise RuntimeError(r["mediaUserErrors"])
    mid = r["media"][0]["id"]
    if not c6.wait_media_ready(env, token, prod_id, mid):
        raise RuntimeError(f"mídia {nome} não ficou READY")
    return mid


def main():
    aplicar = "--apply" in sys.argv
    c6.ensure_fonts()
    env = load_env()
    token = shopify_token(env)

    prods = {}
    for p in c6.fetch_products(env, token):
        v = p["variants"]["nodes"]
        sku = (v[0]["sku"] or "").strip() if v else ""
        if sku in FOTOS:
            prods[sku] = p
    faltando = set(FOTOS) - set(prods)
    if faltando:
        print("! SKU não encontrado no site:", faltando)

    rows = []
    for sku, arquivo in FOTOS.items():
        p = prods.get(sku)
        if not p:
            continue
        titulo = p["title"].strip()
        codigo = ((p["skuOem"] or {}).get("value") or sku).strip()
        descricao = c6.descricao_curta(titulo, sku)
        capa, foto, orfas = classifica(p, arquivo)
        src = ASSETS / arquivo

        print(f"\n{sku} — {titulo}")
        print(f"   foto limpa : {arquivo}")
        print(f"   capa antiga: {'sim' if capa else 'NÃO ACHOU'}"
              f" · foto antiga: {'sim' if foto else 'NÃO ACHOU'}"
              f" · órfã 20M: {len(orfas)}")
        if not aplicar:
            rows.append((sku, codigo, "dry-run", ""))
            continue

        try:
            alt_foto = (foto.get("alt") if foto else None) or titulo
            # 1) foto limpa
            mid_foto = sobe(env, token, p["id"], arquivo, src.read_bytes(), alt_foto)
            # 2) capa recomposta a partir da foto limpa
            im = Image.open(src); im.load()
            out = c6.CAPAS / f"capa_{c6.sanitize(sku)}.png"
            c6.compose(im, codigo, descricao, out)
            alt_capa = f"{c6.ALT_TAG} | {descricao} – Cód. {codigo} | APP Agro Peças Padrão"
            mid_capa = sobe(env, token, p["id"], out.name, out.read_bytes(), alt_capa)
            # 3) agora sim, apaga o que ficou velho
            velhos = [m["id"] for m in ([capa] if capa else []) + ([foto] if foto else []) + orfas]
            if velhos:
                d = shopify_graphql(env, token, c6.M_DEL_MEDIA,
                                    {"productId": p["id"], "mediaIds": velhos})
                if d["productDeleteMedia"]["mediaUserErrors"]:
                    raise RuntimeError(d["productDeleteMedia"]["mediaUserErrors"])
            # 4) ordem final
            d = shopify_graphql(env, token, c6.M_REORDER, {
                "id": p["id"],
                "moves": [{"id": mid_capa, "newPosition": "0"},
                          {"id": mid_foto, "newPosition": "1"}]})
            if d["productReorderMedia"]["mediaUserErrors"]:
                raise RuntimeError(d["productReorderMedia"]["mediaUserErrors"])
            print(f"   ✔ capa + foto limpas no ar; {len(velhos)} mídia(s) antiga(s) removida(s)")
            rows.append((sku, codigo, "ok", f"{len(velhos)} removidas"))
        except Exception as e:
            print(f"   ✖ {e}")
            rows.append((sku, codigo, "erro", str(e)))
        time.sleep(0.6)

    if aplicar:
        stamp = time.strftime("%Y%m%d_%H%M")
        rel = REL_DIR / f"publicar_limpas_{stamp}.csv"
        with open(rel, "w", encoding="utf-8") as f:
            f.write("SKU,Código,Status,Detalhe\n")
            for r in rows:
                f.write(",".join('"' + str(c).replace('"', "'") + '"' for c in r) + "\n")
        print(f"\nrelatório: {rel}")
    else:
        print("\n(dry-run — rode com --apply para executar)")


if __name__ == "__main__":
    main()
