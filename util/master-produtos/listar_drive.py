#!/usr/bin/env python3
"""
Lista uma pasta do Drive (recursivo, 1 nível de subpasta) usando o mesmo token
de usuário que o 08_fotos_estudio.py usa.

    python3 listar_drive.py <FOLDER_ID>
"""
import json, subprocess, sys, urllib.parse, urllib.request

ADMIN = "admin@agropecaspadrao.com.br"


def gtoken():
    r = subprocess.run(["gcloud", "auth", "print-access-token", f"--account={ADMIN}"],
                       capture_output=True, text=True)
    tk = r.stdout.strip()
    if not tk:
        sys.exit("token do Drive indisponível — rode: "
                 f"gcloud auth login {ADMIN} --enable-gdrive-access --force\n"
                 + r.stderr.strip())
    return tk


def listar(folder_id, token):
    q = urllib.parse.quote(f"'{folder_id}' in parents and trashed = false")
    url = ("https://www.googleapis.com/drive/v3/files"
           f"?q={q}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true"
           "&fields=files(id,name,mimeType,size,imageMediaMetadata(width,height))")
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read()).get("files", [])


def main():
    folder = sys.argv[1]
    token = gtoken()
    itens = sorted(listar(folder, token), key=lambda f: f["name"].lower())
    for f in itens:
        pasta = f["mimeType"].endswith("folder")
        if pasta:
            filhos = sorted(listar(f["id"], token), key=lambda x: x["name"].lower())
            print(f"\n[PASTA] {f['name']}  ({len(filhos)} arquivos)")
            for c in filhos:
                md = c.get("imageMediaMetadata") or {}
                dim = f"{md.get('width')}x{md.get('height')}" if md.get("width") else ""
                kb = int(c.get("size", 0)) // 1024
                print(f"     - {c['name']:52} {dim:12} {kb:>6} KB   id={c['id']}")
        else:
            kb = int(f.get("size", 0)) // 1024
            print(f"[ARQ]   {f['name']:56} {kb:>6} KB   id={f['id']}")


if __name__ == "__main__":
    main()
