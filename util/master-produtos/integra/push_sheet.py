"""Grava o dashboard_data.json em uma planilha NATIVA do Google (APP_Dashboard_Data),
que o dashboard (Apps Script) lê. Roda no cron. Usa o token do admin@ (escopo Drive).
"""
import os, json, subprocess, urllib.request, urllib.error, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ADMIN = 'admin@agropecaspadrao.com.br'
DASH_NAME = 'APP_Dashboard_Data'
ID_FILE = os.path.join(HERE, 'dash_sheet_id.txt')

def tok():
    return subprocess.run(['gcloud', 'auth', 'print-access-token', '--account=' + ADMIN],
                          capture_output=True, text=True).stdout.strip()

def api(url, method='GET', body=None, token=None, base='https://sheets.googleapis.com'):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + url, data=data, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))

def find_sheet(token):
    if os.path.exists(ID_FILE):
        return open(ID_FILE).read().strip()
    q = urllib.parse.quote(f"name='{DASH_NAME}' and trashed=false")
    r = api(f'/drive/v3/files?q={q}&fields=files(id,name)&supportsAllDrives=true',
            token=token, base='https://www.googleapis.com')
    files = r.get('files', [])
    if files:
        open(ID_FILE, 'w').write(files[0]['id']); return files[0]['id']
    return None

TABS = ['Meta', 'KPIs', 'SemFoto', 'DescRuins', 'Importantes', 'DivPreco', 'DivCusto', 'Inativos', 'Cenarios', 'Regras']

def create_sheet(token):
    body = {'properties': {'title': DASH_NAME},
            'sheets': [{'properties': {'title': t}} for t in TABS]}
    r = api('/v4/spreadsheets', 'POST', body, token)
    sid = r['spreadsheetId']
    open(ID_FILE, 'w').write(sid)
    return sid

def to_rows(data):
    d = data
    rows = {}
    rows['Meta'] = [['gerado_em', d['gerado_em']]]
    rows['KPIs'] = [['indicador', 'valor']] + [[k, v] for k, v in d['kpis'].items()]
    rows['SemFoto'] = [['sku', 'titulo', 'tipo', 'handle']] + [[x['sku'], x['titulo'], x['tipo'], x['handle']] for x in d['sem_foto']]
    rows['DescRuins'] = [['sku', 'titulo', 'tipo', 'score', 'faixa', 'motivos']] + \
        [[x['sku'], x['titulo'], x.get('tipo', ''), x['score'], x.get('faixa', ''), x['motivos']] for x in d['desc_ruins']]
    rows['Importantes'] = [['sku', 'titulo', 'falta']] + [[x['sku'], x['titulo'], x['falta']] for x in d['importantes']]
    rows['DivPreco'] = [['sku', 'titulo', 'site', 'olist', 'motivo']] + \
        [[x['sku'], x.get('titulo', ''), x['site'], x['olist'], x.get('motivo', 'Olist com preço defasado da última sincronização')] for x in d['div_preco']]
    rows['DivCusto'] = [['sku', 'titulo', 'tipo', 'site', 'planilha', 'motivo']] + \
        [[x['sku'], x.get('titulo', ''), x.get('tipo', ''), x['site'], x['planilha'], x.get('motivo', '')] for x in d['div_custo']]
    rows['Inativos'] = [['id', 'codigo', 'nome', 'criado']] + [[x['id'], x['codigo'], x['nome'], x['criado']] for x in d['inativos']]
    rows['Cenarios'] = [['cenario', 'status', 'passou', 'total', 'descricao', 'excecoes']] + \
        [[c['cenario'], c['status'], c['passou'], c['total'], c.get('descricao', ''), json.dumps(c['excecoes'], ensure_ascii=False)] for c in d['cenarios']]
    rows['Regras'] = [['campo', 'regra']] + [[r['campo'], r['regra']] for r in d.get('regras', [])]
    return rows

def ensure_tabs(sid, token):
    meta = api(f'/v4/spreadsheets/{sid}?fields=sheets.properties.title', token=token)
    existentes = {s['properties']['title'] for s in meta.get('sheets', [])}
    faltando = [t for t in TABS if t not in existentes]
    if faltando:
        api(f'/v4/spreadsheets/{sid}:batchUpdate', 'POST',
            {'requests': [{'addSheet': {'properties': {'title': t}}} for t in faltando]}, token)

def push(data):
    token = tok()
    sid = find_sheet(token) or create_sheet(token)
    ensure_tabs(sid, token)
    rows = to_rows(data)
    # limpa e escreve cada aba
    for tab, values in rows.items():
        api(f'/v4/spreadsheets/{sid}/values/{tab}!A1:Z100000:clear', 'POST', {}, token)
        api(f"/v4/spreadsheets/{sid}/values/{tab}!A1?valueInputOption=RAW", 'PUT',
            {'values': values}, token)
    print('dashboard atualizado. spreadsheetId:', sid)
    print('URL:', f'https://docs.google.com/spreadsheets/d/{sid}/edit')
    return sid

if __name__ == '__main__':
    import urllib.parse
    push(json.load(open(os.path.join(HERE, 'dashboard_data.json'))))
