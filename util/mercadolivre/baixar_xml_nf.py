#!/usr/bin/env python3
"""
Baixa o XML da NF-e direto da API do Tiny/Olist — sem depender do botão do painel.

Uso (no diretório do repositório):
    python3 util/mercadolivre/baixar_xml_nf.py                 # notas dos pedidos faturados nos últimos 30 dias
    python3 util/mercadolivre/baixar_xml_nf.py --dias 90
    python3 util/mercadolivre/baixar_xml_nf.py --pedido 11     # número do pedido no Tiny
    python3 util/mercadolivre/baixar_xml_nf.py --nf 364614440  # id da nota fiscal
    python3 util/mercadolivre/baixar_xml_nf.py --out ~/Downloads/xml

Salva um arquivo por nota, nomeado pela chave de acesso (formato que o
Mercado Livre aceita no upload da nota fiscal).
"""
import argparse, json, pathlib, re, sys, time, html
import urllib.request, urllib.parse
from datetime import date, timedelta

REPO = pathlib.Path(__file__).resolve().parents[2]
BASE = "https://api.tiny.com.br/api2/"
PAUSA = 2.0                      # a API bloqueia acima de ~50 req/min


def token():
    env = REPO / ".env"
    m = dict(re.findall(r"^([A-Za-z0-9_]+)=(.*)$", env.read_text(), re.M))
    t = (m.get("TINY_API_KEY") or "").strip()
    if not t:
        sys.exit(f"TINY_API_KEY não encontrado em {env}")
    return t


def call(ep, tok, **kw):
    kw.update(token=tok, formato="json")
    req = urllib.request.Request(BASE + ep, data=urllib.parse.urlencode(kw).encode())
    return urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")


def json_call(ep, tok, **kw):
    return json.loads(call(ep, tok, **kw))["retorno"]


def xml_da_nota(tok, id_nota):
    """Devolve (xml, chave) ou (None, motivo)."""
    resp = call("nota.fiscal.obter.xml.php", tok, id=id_nota)
    if resp.lstrip().startswith("{"):                      # erro vem em JSON
        r = json.loads(resp)["retorno"]
        return None, str(r.get("erros") or r.get("status"))
    m = re.search(r"<xml_nfe>(.*)</xml_nfe>", resp, re.S)
    if not m:
        return None, "resposta sem <xml_nfe> (nota não autorizada?)"
    xml = m.group(1)
    if "&lt;" in xml[:200]:
        xml = html.unescape(xml)
    chave = re.search(r'Id="NFe(\d{44})"', xml)
    return xml.strip(), (chave.group(1) if chave else str(id_nota))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=30)
    ap.add_argument("--pedido", help="número do pedido no Tiny")
    ap.add_argument("--nf", help="id da nota fiscal no Tiny")
    ap.add_argument("--out", default=str(pathlib.Path.home() / "Downloads" / "nfe-xml"))
    a = ap.parse_args()

    tok = token()
    out = pathlib.Path(a.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)

    notas = []   # (id_nota, rotulo)
    if a.nf:
        notas.append((a.nf, f"NF {a.nf}"))
    else:
        fim = date.today()
        ini = fim - timedelta(days=a.dias)
        kw = dict(dataInicial=ini.strftime("%d/%m/%Y"), dataFinal=fim.strftime("%d/%m/%Y"))
        if a.pedido:
            kw["numero"] = a.pedido
        r = json_call("pedidos.pesquisa.php", tok, **kw)
        for p in r.get("pedidos", []):
            p = p["pedido"]
            time.sleep(PAUSA)
            det = json_call("pedido.obter.php", tok, id=p["id"]).get("pedido", {})
            idnf = det.get("id_nota_fiscal")
            if idnf:
                notas.append((idnf, f'pedido {det.get("numero")} de {det.get("data_pedido")}'))
            else:
                print(f'  – pedido {p.get("numero")}: sem nota fiscal vinculada')

    if not notas:
        print("Nenhuma nota encontrada no período/filtro.")
        return

    for idnf, rotulo in notas:
        time.sleep(PAUSA)
        xml, info = xml_da_nota(tok, idnf)
        if not xml:
            print(f"✗ {rotulo}: {info}")
            continue
        destino = out / f"NFe_{info}.xml"
        destino.write_text(xml, encoding="utf-8")
        print(f"✓ {rotulo} → {destino}")

    print(f"\nPasta: {out}")


if __name__ == "__main__":
    main()
