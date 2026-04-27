"""
Cadastra 8 novos produtos no Shopify usando dados extraídos das tabelas técnicas.
Usa as mesmas credenciais de atualizar_produtos.py (.env na mesma pasta).
"""

import os, sys, json, time, pathlib
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import HTTPError

BASE_DIR   = pathlib.Path(__file__).parent
ENV_FILE   = BASE_DIR / ".env"
API_VERSION = "2025-01"

# ── Dados dos 8 produtos ──────────────────────────────────────────────────────
PRODUTOS = [
    {
        "sku":        "5.0203.0540803",
        "cod_reduzido": "540803",
        "title":      "Bomba Hidráulica Massey Ferguson MF85X/185/275/285/290 – BOI 5,5 C10.C10.C6.T10",
        "vendor":     "LIVENZA",
        "product_type": "Bomba Hidráulica",
        "montadora":  "MASSEY FERGUSON",
        "equipamento": "Trator MF85X / MF185 / 275 / 285 / 290",
        "funcao":     "Direção",
        "oem":        "3148762M91 / 2802612M91",
        "refs":       "9 540 082 513 / 11111006002 / VH 90619051",
        "descricao_tec": "BOI 5,5 C10.C10.C6.T10 -90+10 BAR (DEPOSITO)",
        "tags":       ["bomba-hidraulica", "massey-ferguson", "direcao", "livenza"],
    },
    {
        "sku":        "5.0220.0547202",
        "cod_reduzido": "547202",
        "title":      "Bomba Hidráulica Valtra-Valmet 62/65/68/85/86/88/78EL – BOI 11 E5.P.B4/11 B4.L",
        "vendor":     "LIVENZA",
        "product_type": "Bomba Hidráulica",
        "montadora":  "VALTRA-VALMET",
        "equipamento": "Trator 62 / 65 / 68 / 85 / 86 / 88 / 78EL / 78DH / 880DHES",
        "funcao":     "Bomba Principal",
        "oem":        "159400-1",
        "refs":       "",
        "descricao_tec": "BOI 11 E5.P.B4/11 B4.L",
        "tags":       ["bomba-hidraulica", "valtra", "valmet", "principal", "livenza"],
    },
    {
        "sku":        "5.0220.0547205",
        "cod_reduzido": "547205",
        "title":      "Bomba Hidráulica Valtra-Valmet 880/980 EI/1780 – BOI 22,5 E5.P.A2/11 A42.L1",
        "vendor":     "LIVENZA",
        "product_type": "Bomba Hidráulica",
        "montadora":  "VALTRA-VALMET",
        "equipamento": "Trator 880 (4x4 EI) / 980 EI / 880 (4x2 148) / 1780",
        "funcao":     "Bomba Principal",
        "oem":        "80166110",
        "refs":       "",
        "descricao_tec": "BOI 22,5 E5.P.A2/11 A42.L1 (CPO TRASERO INVERTIDO)",
        "tags":       ["bomba-hidraulica", "valtra", "valmet", "principal", "livenza"],
    },
    {
        "sku":        "5.0220.0547207",
        "cod_reduzido": "547207",
        "title":      "Bomba Hidráulica Massey Ferguson MF290/292 4x2/4x4 – BOI 7 B11.C11.A15/11 A42.L1",
        "vendor":     "LIVENZA",
        "product_type": "Bomba Hidráulica",
        "montadora":  "MASSEY FERGUSON",
        "equipamento": "Trator MF290 4x4 / MF292 4x2 / 4x4",
        "funcao":     "Principal e Direção",
        "oem":        "3411929M91",
        "refs":       "9 510 080 522 / 11112007001 / 41109203",
        "descricao_tec": "BOI 7 B11.C11.A15./11 A42.L1",
        "tags":       ["bomba-hidraulica", "massey-ferguson", "principal", "direcao", "livenza"],
    },
    {
        "sku":        "5.0220.0547216",
        "cod_reduzido": "547216",
        "title":      "Bomba Hidráulica Massey Ferguson 296-4/297-4/299-4 – BOI 16 B9.P5.A42/19 A42.L1",
        "vendor":     "LIVENZA",
        "product_type": "Bomba Hidráulica",
        "montadora":  "MASSEY FERGUSON",
        "equipamento": "Trator 296-4 / 297-4 / 299-4",
        "funcao":     "Bomba Principal",
        "oem":        "3412012 M91",
        "refs":       "",
        "descricao_tec": "BOI 16 B9.P5.A42/19 A42.L1 (DEPOSITO)",
        "tags":       ["bomba-hidraulica", "massey-ferguson", "principal", "livenza"],
    },
    {
        "sku":        "5.0220.0548817",
        "cod_reduzido": "548817",
        "title":      "Bomba Hidráulica Massey Ferguson 283/290/292/L5000 – BOI 7 B11.C12.A/11 A.L",
        "vendor":     "LIVENZA",
        "product_type": "Bomba Hidráulica",
        "montadora":  "MASSEY FERGUSON",
        "equipamento": "Trator 283 / 290 / 292 / L5000",
        "funcao":     "Direção e Levante",
        "oem":        "052107T1",
        "refs":       "R 979 106 432 / F 000 510 502",
        "descricao_tec": "BOI 7 B11.C12.A/11 A.L",
        "tags":       ["bomba-hidraulica", "massey-ferguson", "direcao", "levante", "livenza"],
    },
    {
        "sku":        "5.1301.0565029",
        "cod_reduzido": "565029",
        "title":      "Bomba Hidráulica New Holland TC57 – Bomba Aplicação CNH A-020",
        "vendor":     "LIVENZA",
        "product_type": "Bomba Hidráulica",
        "montadora":  "CNH – NEW HOLLAND",
        "equipamento": "Colhedeira TC57",
        "funcao":     "Bomba Principal",
        "oem":        "87605496",
        "refs":       "",
        "descricao_tec": "BOMBA APLICACION CNH A-020 GIRO I",
        "tags":       ["bomba-hidraulica", "new-holland", "cnh", "colhedeira", "principal", "livenza"],
    },
    {
        "sku":        "5.0209.0547219",
        "cod_reduzido": "565032",
        "title":      "Bomba Hidráulica John Deere Colhedeira 1150/1165/1185/7300/7500/8500 – BOI 11 B9.P4.A42",
        "vendor":     "LIVENZA",
        "product_type": "Bomba Hidráulica",
        "montadora":  "JOHN DEERE",
        "equipamento": "Cosechadora / Combine Harvester 1450 / 1150 / 1165 / 1185 / 7300 / 7500 / 8500",
        "funcao":     "Bomba de Direção e Acc. Molinete",
        "oem":        "DQ.12014",
        "refs":       "",
        "descricao_tec": "BOI 11 B9.P4.A42/11 A42/4 A2.L1",
        "tags":       ["bomba-hidraulica", "john-deere", "colhedeira", "direcao", "livenza"],
    },
    {
        "sku":        "5.1305.0565077",
        "cod_reduzido": "565077",
        "title":      "Bomba Hidráulica John Deere Série 5000/5003/5010/5020/6000 – Bomba Aplicação JD A-005",
        "vendor":     "LIVENZA",
        "product_type": "Bomba Hidráulica",
        "montadora":  "JOHN DEERE",
        "equipamento": "Série 5000 / 5003 / 5005 / 5010 / 5015 / 5020 / 5025 / 6000",
        "funcao":     "Bomba Principal",
        "oem":        "RE73947 / DQ61690 / DQ42290",
        "refs":       "",
        "descricao_tec": "Bomba Aplicação JD A-005",
        "tags":       ["bomba-hidraulica", "john-deere", "principal", "livenza"],
    },
]

# ── helpers ───────────────────────────────────────────────────────────────────

def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

def get_token(shop, client_id, client_secret):
    url  = f"https://{shop}.myshopify.com/admin/oauth/access_token"
    data = urlencode({
        "grant_type":    "client_credentials",
        "client_id":     client_id,
        "client_secret": client_secret,
    }).encode()
    req = Request(url, data=data, method="POST")
    with urlopen(req) as r:
        return json.loads(r.read())["access_token"]

def api_post(base_url, token, path, body):
    url  = f"{base_url}{path}"
    data = json.dumps(body).encode()
    req  = Request(url, data=data, method="POST",
                   headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    try:
        with urlopen(req) as r:
            return json.loads(r.read())
    except HTTPError as e:
        print(f"    ✗ HTTP {e.code}: {e.read().decode()[:300]}")
        return None

def api_get(base_url, token, path, params=None):
    from urllib.parse import urlencode as ue
    url = f"{base_url}{path}"
    if params:
        url += "?" + ue(params)
    req = Request(url, headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    with urlopen(req) as r:
        return json.loads(r.read())

def build_body(p):
    refs_line = f"\nReferências cruzadas: {p['refs']}" if p['refs'] else ""
    html = (
        f"<p><strong>Código Livenza:</strong> {p['sku']}</p>"
        f"<p><strong>Código O.E.M.:</strong> {p['oem']}</p>"
        f"<p><strong>Montadora / Aplicação:</strong> {p['montadora']} — {p['equipamento']}</p>"
        f"<p><strong>Função:</strong> {p['funcao']}</p>"
        f"<p><strong>Descrição técnica:</strong> {p['descricao_tec']}</p>"
        + (f"<p><strong>Referências:</strong> {p['refs']}</p>" if p['refs'] else "")
        + "<p>Peça original LIVENZA com certificação ISO 9001/14001/18001. "
          "Estoque disponível em Curitiba–PR, envio para todo o Brasil.</p>"
        "<p>Para cotação e disponibilidade, entre em contato via WhatsApp.</p>"
    )
    return {
        "product": {
            "title":        p["title"],
            "vendor":       p["vendor"],
            "product_type": p["product_type"],
            "body_html":    html,
            "tags":         ", ".join(p["tags"]),
            "status":       "active",
            "variants": [{
                "sku":                    p["sku"],
                "price":                  "0.00",
                "inventory_management":   "shopify",
                "inventory_policy":       "deny",
                "fulfillment_service":    "manual",
                "requires_shipping":      True,
            }],
            "metafields": [
                {
                    "namespace": "agro",
                    "key":       "codigo_livenza",
                    "type":      "single_line_text_field",
                    "value":     p["sku"],
                },
                {
                    "namespace": "agro",
                    "key":       "oem",
                    "type":      "single_line_text_field",
                    "value":     p["oem"],
                },
                {
                    "namespace": "agro",
                    "key":       "montadora",
                    "type":      "single_line_text_field",
                    "value":     p["montadora"],
                },
                {
                    "namespace": "agro",
                    "key":       "equipamento",
                    "type":      "single_line_text_field",
                    "value":     p["equipamento"],
                },
            ],
        }
    }

def sku_exists(base_url, token, sku):
    res = api_get(base_url, token, "/products.json", {"limit": 250})
    for prod in res.get("products", []):
        for v in prod.get("variants", []):
            if v.get("sku") == sku:
                return prod["id"]
    return None

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    env           = load_env()
    shop          = env.get("SHOPIFY_SHOP", "agro-pecas-padrao-2")
    client_id     = env.get("SHOPIFY_CLIENT_ID")
    client_secret = env.get("SHOPIFY_CLIENT_SECRET")

    print("🔑 Obtendo token...")
    token    = get_token(shop, client_id, client_secret)
    base_url = f"https://{shop}.myshopify.com/admin/api/{API_VERSION}"
    print(f"✅ Token obtido. Loja: {shop}\n")

    criados  = []
    existiam = []
    erros    = []

    for p in PRODUTOS:
        print(f"── {p['cod_reduzido']} — {p['sku']} ──────────────────")
        existing = sku_exists(base_url, token, p["sku"])
        if existing:
            print(f"  ⚠  Já existe (id {existing}), pulando.")
            existiam.append(p["sku"])
            continue

        body = build_body(p)
        res  = api_post(base_url, token, "/products.json", body)
        if res and res.get("product"):
            pid = res["product"]["id"]
            print(f"  ✓ Criado: id={pid}")
            criados.append({"sku": p["sku"], "id": pid, "cod": p["cod_reduzido"]})
        else:
            print(f"  ✗ Falhou ao criar")
            erros.append(p["sku"])

        time.sleep(0.5)

    print("\n" + "="*50)
    print(f"✅ Criados:   {len(criados)}")
    for c in criados:
        print(f"   {c['sku']} → id {c['id']}")
    print(f"⚠  Existiam: {len(existiam)} → {existiam}")
    print(f"✗  Erros:    {len(erros)} → {erros}")

    log = BASE_DIR / "cadastro_resultado.json"
    log.write_text(json.dumps({"criados": criados, "existiam": existiam, "erros": erros}, indent=2, ensure_ascii=False))
    print(f"\n📋 Log salvo em {log}")

if __name__ == "__main__":
    main()
