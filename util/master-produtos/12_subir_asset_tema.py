#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""12 — Sobe arquivo de assets/ para o TEMA ativo via themeFilesUpsert.

O tema guarda a própria cópia do arquivo (as seções usam `| asset_url`), que é
diferente da imagem do produto. Trocar a foto do produto NÃO atualiza essa
cópia — e o sync GitHub→Shopify não pode ser assumido como funcionando
(ver docs/ e a nota de 17/08). Este script fecha esse buraco.

Uso:
    python3 12_subir_asset_tema.py arquivo1.png arquivo2.png ...
    python3 12_subir_asset_tema.py --check arquivo.png   # só compara o md5
"""
import base64
import hashlib
import sys
from pathlib import Path

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from common import load_env, shopify_token, shopify_graphql  # noqa: E402

ASSETS = BASE.parent.parent / "assets"

Q_THEME = """
query { themes(first: 1, roles: [MAIN]) { nodes { id name } } }"""

Q_FILES = """
query($id: ID!, $names: [String!]) {
  theme(id: $id) { files(first: 20, filenames: $names) {
      nodes { filename size checksumMd5 updatedAt } } } }"""

M_UPSERT = """
mutation($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $id, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { filename code message }
  } }"""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv
    if not args:
        print(__doc__)
        return
    env = load_env()
    token = shopify_token(env)
    tid = shopify_graphql(env, token, Q_THEME)["themes"]["nodes"][0]["id"]

    nomes = [f"assets/{Path(a).name}" for a in args]
    atual = {f["filename"]: f for f in
             shopify_graphql(env, token, Q_FILES, {"id": tid, "names": nomes})["theme"]["files"]["nodes"]}

    pend = []
    for nome in nomes:
        p = ASSETS / Path(nome).name
        if not p.exists():
            print(f"  ! {nome}: não existe em assets/")
            continue
        local = hashlib.md5(p.read_bytes()).hexdigest()
        remoto = (atual.get(nome) or {}).get("checksumMd5")
        if local == remoto:
            print(f"  = {nome}: já idêntico no tema")
        else:
            print(f"  ≠ {nome}: tema={str(remoto)[:10]} local={local[:10]}")
            pend.append((nome, p))

    if check or not pend:
        return
    files = [{"filename": n, "body": {"type": "BASE64",
                                      "value": base64.b64encode(p.read_bytes()).decode()}}
             for n, p in pend]
    d = shopify_graphql(env, token, M_UPSERT, {"id": tid, "files": files})
    r = d["themeFilesUpsert"]
    for e in r["userErrors"]:
        print(f"  ✖ {e['filename']}: {e['code']} {e['message']}")
    for f in r["upsertedThemeFiles"]:
        print(f"  ✔ {f['filename']} no tema")

    # confirma pelo md5 do que o tema devolve
    dep = {f["filename"]: f["checksumMd5"] for f in
           shopify_graphql(env, token, Q_FILES, {"id": tid, "names": [n for n, _ in pend]})["theme"]["files"]["nodes"]}
    print("\nconferência pós-upload:")
    for n, p in pend:
        ok = dep.get(n) == hashlib.md5(p.read_bytes()).hexdigest()
        print(f"  {'✔' if ok else '✖'} {n}  md5 {'bate' if ok else 'NÃO bate'}")


if __name__ == "__main__":
    main()
