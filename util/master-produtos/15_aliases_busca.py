#!/usr/bin/env python3
"""
15 — Aliases de busca (tags) para códigos OEM.

A busca nativa do Shopify indexa título, descrição, vendor, tipo, TAGS e SKU da
variante — nunca metafield. E o tokenizador quebra em pontos/hífens, então:

    5.1305.0565094.0  ->  acha
    565094            ->  acha  (tag já existente)
    0565094           ->  NÃO acha  (zero à esquerda mata o match)
    6424-4026         ->  acha
    64244026          ->  NÃO acha  (sem hífen)

Este script gera as variações que faltam e grava como tag. Tags não aparecem em
lugar nenhum do tema (só as com prefixo `compat:` são renderizadas na PDP), então
é seguro.

Uso:
    python3 15_aliases_busca.py            # dry-run, só relatório
    python3 15_aliases_busca.py --apply    # grava as tags na loja
"""
import json, re, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from common import load_env, shopify_token, shopify_graphql, REL_DIR

MIN_SEG = 6      # segmento só vira alias se tiver 6+ chars (evita "1305", "0220")
MIN_JOIN = 6     # idem para a versão colada (sem pontos/hífens)

Q_PRODUTOS = """
query($after: String) {
  products(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title status tags
      variants(first: 10) { nodes { sku } }
      skuOem: metafield(namespace: "agro", key: "sku_oem") { value }
      partNumber: metafield(namespace: "agro", key: "part_number") { value }
    }
  }
}
"""

M_TAGS_ADD = """
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    userErrors { field message }
  }
}
"""


def variacoes(code):
    """Gera as variações de escrita de um código que a busca não acha sozinha."""
    out = set()
    c = (code or "").strip()
    if not c:
        return out

    # versão colada: sem pontos, hífens, barras e espaços
    colado = re.sub(r"[.\-/\s]", "", c)
    if colado and colado != c and len(colado) >= MIN_JOIN:
        out.add(colado)

    # cada segmento, com e sem os zeros à esquerda
    for seg in re.split(r"[.\-/\s]", c):
        seg = seg.strip()
        if len(seg) < MIN_SEG or not seg.strip("0"):
            continue
        if re.fullmatch(r"(?i)kit\d+", seg):
            continue  # "KIT60" sozinho não é código de peça, só ruído
        out.add(seg)
        sem_zero = seg.lstrip("0")
        if sem_zero and sem_zero != seg and len(sem_zero) >= 4:
            out.add(sem_zero)

    return out


def main():
    aplicar = "--apply" in sys.argv
    env = load_env()
    token = shopify_token(env)

    produtos, after = [], None
    while True:
        d = shopify_graphql(env, token, Q_PRODUTOS, {"after": after})["products"]
        produtos.extend(d["nodes"])
        if not d["pageInfo"]["hasNextPage"]:
            break
        after = d["pageInfo"]["endCursor"]

    print(f"{len(produtos)} produtos lidos da loja\n")

    planos = []
    for p in produtos:
        codigos = set()
        for v in p["variants"]["nodes"]:
            if v.get("sku"):
                codigos.add(v["sku"])
        for campo in ("skuOem", "partNumber"):
            if p.get(campo) and p[campo].get("value"):
                codigos.add(p[campo]["value"])

        alvo = set()
        for c in codigos:
            alvo |= variacoes(c)

        existentes = {t.lower() for t in p["tags"]}
        faltando = sorted(t for t in alvo if t.lower() not in existentes)
        if faltando:
            planos.append({"id": p["id"], "title": p["title"],
                           "status": p["status"], "tags": faltando})

    total = sum(len(x["tags"]) for x in planos)
    print(f"{len(planos)} produtos receberão {total} tags novas\n")
    for x in planos[:15]:
        print(f"  {x['title'][:58]:60} + {', '.join(x['tags'])}")
    if len(planos) > 15:
        print(f"  ... e mais {len(planos) - 15} produtos")

    REL_DIR.mkdir(exist_ok=True)
    destino = REL_DIR / "15_aliases_busca.json"
    destino.write_text(json.dumps(planos, ensure_ascii=False, indent=2))
    print(f"\nPlano completo: {destino}")

    if not aplicar:
        print("\n(dry-run — rode com --apply para gravar)")
        return

    print("\nAplicando...")
    ok = erros = 0
    for x in planos:
        r = shopify_graphql(env, token, M_TAGS_ADD, {"id": x["id"], "tags": x["tags"]})
        ue = r["tagsAdd"]["userErrors"]
        if ue:
            erros += 1
            print(f"  ERRO {x['title'][:50]}: {ue}")
        else:
            ok += 1
    print(f"\n{ok} produtos atualizados, {erros} erros")


if __name__ == "__main__":
    main()
