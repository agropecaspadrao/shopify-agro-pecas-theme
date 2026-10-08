"""Pipeline de auditoria de integrações — APP Agro Peças.

Cruza Planilha central (Google Drive .xlsx) x Loja (Shopify) x ERP (Olist/Tiny),
calcula estatísticas de foto/descrição, score de qualidade, itens importantes
faltando, lista de inativos do Olist e cenários de teste. Alimenta o dashboard.

Modos:
  python3 pipeline.py compute   # só leitura -> grava dashboard_data.json (local)
  python3 pipeline.py push      # sobe o JSON para a planilha nativa do dashboard
  python3 pipeline.py all       # compute + push  (usado pelo cron)
"""
import sys, os, re, json, time, subprocess, datetime, urllib.request, urllib.parse, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = '/Users/guilhermeferreira/Documents/DEV/shopify-agro-pecas-theme/.env'
SHEET_ID = '1FoyfpY5E4Z4dYcEk7hiP2Jrg_dts6teu'          # planilha central (master, .xlsx)
ADMIN = 'admin@agropecaspadrao.com.br'
DASH_NAME = 'APP_Dashboard_Data'                          # planilha nativa de dados do dash
SUP = ['02_SOHIPREN', '04_GRECO', '03_AGCO', '05_JOHN_DEERE', '06_STARA', '07_GTS', '08_FERTISYSTEM']

def load_env():
    env = {}
    for line in open(ENV_PATH):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, _, v = line.partition('='); env[k.strip()] = v.strip()
    return env
ENV = load_env()

# ----------------- auth -----------------
def gtoken():
    return subprocess.run(['gcloud', 'auth', 'print-access-token', '--account=' + ADMIN],
                          capture_output=True, text=True).stdout.strip()

_shop_tok = None
def shop_token():
    global _shop_tok
    if _shop_tok: return _shop_tok
    req = urllib.request.Request(
        f"https://{ENV['SHOPIFY_SHOP']}.myshopify.com/admin/oauth/access_token",
        data=json.dumps({"grant_type": "client_credentials",
                         "client_id": ENV['SHOPIFY_CLIENT_ID'],
                         "client_secret": ENV['SHOPIFY_CLIENT_SECRET']}).encode(),
        headers={"Content-Type": "application/json"})
    _shop_tok = json.load(urllib.request.urlopen(req))['access_token']
    return _shop_tok

def gql(query, variables=None, retries=4):
    for a in range(retries):
        req = urllib.request.Request(
            f"https://{ENV['SHOPIFY_SHOP']}.myshopify.com/admin/api/2025-01/graphql.json",
            data=json.dumps({"query": query, "variables": variables or {}}).encode(),
            headers={"Content-Type": "application/json", "X-Shopify-Access-Token": shop_token()})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=60))
        except (urllib.error.URLError, TimeoutError, OSError):
            if a < retries - 1: time.sleep(3 * (a + 1)); continue
            raise
        if 'errors' in d and any(e.get('extensions', {}).get('code') == 'THROTTLED' for e in d['errors']):
            time.sleep(2 ** a); continue
        if 'errors' in d: raise RuntimeError(json.dumps(d['errors'], ensure_ascii=False))
        return d['data']

def tiny(endpoint, retries=4, **params):
    params.setdefault('token', ENV['TINY_API_KEY']); params.setdefault('formato', 'json')
    data = urllib.parse.urlencode(params).encode()
    for a in range(retries):
        try:
            d = json.load(urllib.request.urlopen(
                urllib.request.Request(f"https://api.tiny.com.br/api2/{endpoint}.php", data=data), timeout=60))
        except (urllib.error.URLError, TimeoutError, OSError):
            if a < retries - 1: time.sleep(8 * (a + 1)); continue
            raise
        r = d.get('retorno', {})
        if a < retries - 1 and 'API Bloqueada' in json.dumps(r, ensure_ascii=False):
            time.sleep(35); continue
        return r
    raise RuntimeError('tiny esgotou retries')

# ----------------- coleta -----------------
def pull_shopify():
    Q = '''query($after: String) { products(first: 60, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id title handle status productType vendor tags publishedAt descriptionHtml
        featuredImage { url } media(first: 1) { nodes { __typename } }
        variants(first: 3) { nodes { sku price inventoryQuantity inventoryItem { unitCost { amount } } } } } } }'''
    out, after = [], None
    while True:
        d = gql(Q, {'after': after}); out += d['products']['nodes']
        if not d['products']['pageInfo']['hasNextPage']: break
        after = d['products']['pageInfo']['endCursor']
    return out

def pull_tiny():
    out, pagina = [], 1
    while True:
        r = tiny('produtos.pesquisa', pagina=pagina)
        if r.get('status') != 'OK':
            time.sleep(20); continue
        out += [x['produto'] for x in r.get('produtos', [])]
        if pagina >= int(r.get('numero_paginas', 1)): break
        pagina += 1; time.sleep(3)
    return out

def read_master():
    import openpyxl
    tk = gtoken()
    url = f'https://www.googleapis.com/drive/v3/files/{SHEET_ID}?alt=media&supportsAllDrives=true'
    dest = os.path.join(HERE, 'central.xlsx')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tk})) as r, open(dest, 'wb') as f:
        f.write(r.read())
    wb = openpyxl.load_workbook(dest, data_only=True)
    rows = {}
    for name in SUP:
        if name not in wb.sheetnames: continue
        ws = wb[name]
        hr = next((r for r in range(1, 9)
                   if any('Title' in str(ws.cell(r, c).value or '') for c in range(1, ws.max_column + 1))), 5)
        cols = {str(ws.cell(hr, c).value).strip(): c for c in range(1, ws.max_column + 1) if ws.cell(hr, c).value}
        def col(*frags):
            for f in frags:
                for k, c in cols.items():
                    if f.lower() in k.lower(): return c
            return None
        cA, cPN, cTit = 1, col('Part Number'), col('Title')
        cCusto, cPreco = col('Custo unit'), col('Preço c/')
        cStatus = next((c for k, c in cols.items() if k.strip() == 'Status'), None)
        for r in range(hr + 1, ws.max_row + 1):
            sku = ws.cell(r, cA).value
            if sku in (None, ''): continue
            sku = str(sku).strip()
            rows[sku] = {'sheet': name, 'part': (str(ws.cell(r, cPN).value).strip() if cPN and ws.cell(r, cPN).value else ''),
                         'title': ws.cell(r, cTit).value if cTit else None,
                         'custo': ws.cell(r, cCusto).value if cCusto else None,
                         'preco': ws.cell(r, cPreco).value if cPreco else None,
                         'status': (str(ws.cell(r, cStatus).value).strip().lower() if cStatus and ws.cell(r, cStatus).value else '')}
    return rows

# ----------------- score de descrição -----------------
def desc_score(p, tem_foto):
    body = re.sub(r'<[^>]+>', ' ', p['descriptionHtml'] or '')
    body = re.sub(r'\s+', ' ', body).strip()
    t = p['title'] or ''
    score, motivos = 100, []
    if not tem_foto: score -= 30; motivos.append('sem foto')
    if len(body) < 200: score -= 20; motivos.append('descrição curta')
    if re.search(r'\bBOI\b|APLICACI[OÓ]N|APLICATION|PROT[OÓ]TIPO', t): score -= 15; motivos.append('título cru')
    if '<h2>Compatibilidade</h2>' not in (p['descriptionHtml'] or ''): score -= 10; motivos.append('sem compatibilidade')
    if '<h2>Especificações</h2>' not in (p['descriptionHtml'] or '') and 'Especifica' not in (p['descriptionHtml'] or ''):
        score -= 10; motivos.append('sem especificações')
    if re.search(r'aplicaci[oó]n|direcci[oó]n|\bgiro\s+[id]\b.*prot', body, re.I): score -= 15; motivos.append('espanhol/resíduo')
    return max(0, score), motivos

# ----------------- compute -----------------
def norm_sku(s):
    s = (s or '').strip(); return s
def sku_variants(s):
    s = (s or '').strip(); out = {s}
    if s.endswith('.0'): out.add(s[:-2])
    out.add(s + '.0'); return {x for x in out if x}

def compute():
    print('coletando Shopify...', flush=True); shop = pull_shopify()
    print('coletando Tiny...', flush=True); tny = pull_tiny()
    print('lendo planilha master...', flush=True); master = read_master()

    # índices
    shop_var = []  # (sku, produto, variante)
    for p in shop:
        for v in p['variants']['nodes']:
            shop_var.append(((v['sku'] or '').strip(), p, v))
    shop_by_sku = {s: (p, v) for s, p, v in shop_var if s}
    ativos = [p for p in shop if p['status'] == 'ACTIVE']
    tiny_ativos = [t for t in tny if t['situacao'] == 'A']
    tiny_inativos = [t for t in tny if t['situacao'] != 'A']
    tiny_cod = {(t['codigo'] or '').strip(): t for t in tiny_ativos if (t['codigo'] or '').strip()}

    # ---- fotos ----
    sem_foto = []
    for p in ativos:
        if not p['featuredImage']:
            sku = (p['variants']['nodes'][0]['sku'] or '') if p['variants']['nodes'] else ''
            sem_foto.append({'sku': sku, 'titulo': p['title'], 'tipo': p['productType'], 'handle': p['handle']})
    com_foto = len(ativos) - len(sem_foto)

    # ---- score de descrição ----
    scores, faixas = [], {'boa': 0, 'media': 0, 'ruim': 0}
    desc_ruins = []
    for p in ativos:
        tem_foto = bool(p['featuredImage'])
        sc, motivos = desc_score(p, tem_foto)
        scores.append(sc)
        faixa = 'boa' if sc >= 80 else ('media' if sc >= 50 else 'ruim')
        faixas[faixa] += 1
        if sc < 80:  # tudo que dá pra melhorar (média + ruim), com o porquê
            sku = (p['variants']['nodes'][0]['sku'] or '') if p['variants']['nodes'] else ''
            desc_ruins.append({'sku': sku, 'titulo': p['title'], 'tipo': p['productType'],
                               'score': sc, 'faixa': faixa, 'motivos': ', '.join(motivos) or '—'})
    desc_ruins.sort(key=lambda x: x['score'])
    score_medio = round(sum(scores) / len(scores), 1) if scores else 0

    # ---- reconciliação Site x Olist ----
    shop_skus = {s for s, _, _ in shop_var if s}
    tiny_skus = set(tiny_cod)
    falta_no_tiny = sorted(shop_skus - {v for s in tiny_skus for v in [s]} - {x for s in tiny_skus for x in sku_variants(s)})
    # cobertura via variações de sku
    tiny_norm = {v for s in tiny_skus for v in sku_variants(s)}
    shop_norm = {v for s in shop_skus for v in sku_variants(s)}
    falta_tiny = sorted({s for s in shop_skus if not (sku_variants(s) & tiny_norm)})
    sobra_tiny = sorted({s for s in tiny_skus if not (sku_variants(s) & shop_norm)})

    # divergência de preço site x olist
    div_preco = []
    for s, p, v in shop_var:
        if not s: continue
        t = tiny_cod.get(s) or next((tiny_cod[x] for x in sku_variants(s) if x in tiny_cod), None)
        if t and abs(float(v['price']) - float(t['preco'] or 0)) > 0.01:
            div_preco.append({'sku': s, 'titulo': p['title'][:60], 'site': float(v['price']), 'olist': float(t['preco'] or 0)})

    # ---- reconciliação Site x Planilha (só itens ATIVOS da planilha; drafts ignorados) ----
    master_ativo = {s: m for s, m in master.items() if m.get('status') != 'draft'}
    master_norm = {v for s in master_ativo for v in sku_variants(s)}
    falta_master = sorted({s for s in shop_skus if not (sku_variants(s) & master_norm)})

    def master_hit(s):
        return master_ativo.get(s) or next((master_ativo[x] for x in sku_variants(s) if x in master_ativo), None)
    def to_float(x):
        try: return float(x) if x not in (None, '', 0) else None
        except (ValueError, TypeError): return None

    # divergência de custo site x planilha — comparação por PRODUTO-BASE, normalizada
    # ao unitário. A planilha às vezes guarda o custo do PACOTE no "unitário"; por isso
    # aceitamos master == unitário OU master == unitário × qtd_kit (kit). Só sinaliza
    # quando o custo não bate em NENHUMA das interpretações.
    from collections import defaultdict
    base_map = defaultdict(dict)
    for s, p, v in shop_var:
        if not s: continue
        uc = v['inventoryItem']['unitCost']
        c = float(uc['amount']) if uc else None
        if c is None: continue
        mkit = re.search(r'-KIT(\d+)$', s, re.I)
        if mkit:
            base_map[s[:mkit.start()]]['kit'] = (s, c, int(mkit.group(1)), p['title'])
        else:
            base_map[s]['unit'] = (s, c, p['title'])

    div_custo = []
    for base, info in base_map.items():
        m = master_hit(base)
        mc = to_float(m['custo']) if m else None
        if mc is None: continue
        if 'unit' in info:
            su, titulo = info['unit'][1], info['unit'][2]
        else:
            su, titulo = info['kit'][1] / info['kit'][2], info['kit'][3]
        Q = info['kit'][2] if 'kit' in info else 1
        def close(a, b):  # tolera arredondamento (1% ou 2 centavos)
            return abs(a - b) <= max(0.02, 0.01 * max(abs(a), abs(b)))
        if close(mc, su) or (Q > 1 and close(mc, su * Q)):
            continue  # consistente como unitário ou como pacote
        motivo = f'unitário do site R$ {su:.2f}'
        if Q > 1: motivo += f' (kit {Q}× = R$ {su * Q:.2f})'
        motivo += f' não corresponde a R$ {mc:.2f} da planilha'
        div_custo.append({'sku': base, 'titulo': titulo[:60],
                          'tipo': f'kit {Q}×' if Q > 1 else 'unitário',
                          'site': round(su, 2), 'planilha': round(mc, 2), 'motivo': motivo})
    div_custo.sort(key=lambda x: x['sku'])

    # ---- itens importantes faltando (bombas ativas sem foto/custo) ----
    importantes = []
    for p in ativos:
        if p['productType'] != 'Bombas Hidráulicas': continue
        v = p['variants']['nodes'][0] if p['variants']['nodes'] else {}
        uc = v.get('inventoryItem', {}).get('unitCost') if v else None
        faltas = []
        if not p['featuredImage']: faltas.append('foto')
        if not uc: faltas.append('custo')
        sc, _ = desc_score(p, bool(p['featuredImage']))
        if sc < 80: faltas.append('descrição')
        if faltas:
            importantes.append({'sku': (v.get('sku') or ''), 'titulo': p['title'][:60], 'falta': ', '.join(faltas)})

    # ---- inativos Olist (para exclusão manual) ----
    inativos = [{'id': t['id'], 'codigo': t['codigo'], 'nome': t['nome'][:70],
                 'criado': t.get('data_criacao', '')} for t in tiny_inativos]

    # ---- cenários de teste ----
    def cen(nome, ok, total, exc, desc):
        return {'cenario': nome, 'passou': ok, 'total': total, 'descricao': desc,
                'status': 'OK' if ok == total else 'FALHA', 'excecoes': exc[:80]}
    cenarios = [
        cen('Todo SKU do site existe no Olist', len(shop_skus) - len(falta_tiny), len(shop_skus),
            [{'sku': s} for s in falta_tiny],
            'Garante que todo produto vendido no site tem cadastro no ERP (Olist/Tiny) para emitir NF e baixar estoque. Falha = venda sem item no ERP.'),
        cen('Preço bate Site x Olist', len([1 for s, _, _ in shop_var if s]) - len(div_preco),
            len([1 for s, _, _ in shop_var if s]), div_preco,
            'Preço do site igual ao do Olist. Divergência significa Olist com preço defasado (o site foi reajustado depois da última sincronização).'),
        cen('Todo SKU do site existe na Planilha (ativos)', len(shop_skus) - len(falta_master), len(shop_skus),
            [{'sku': s} for s in falta_master],
            'Todo produto do site deve ter linha ATIVA na planilha central (drafts são ignorados). Falha = produto no ar sem ficha na fonte da verdade.'),
        cen('Custo bate Site x Planilha', len(shop_var) - len(div_custo), len(shop_var), div_custo,
            'Custo do site igual ao da planilha. Para kits, compara o custo do kit com quantidade × custo unitário. Divergência = revisar custo/margem.'),
        cen('Produto ativo tem foto', com_foto, len(ativos), [{'sku': x['sku'], 'titulo': x['titulo'], 'tipo': x['tipo']} for x in sem_foto],
            'Todo produto ativo deve ter imagem. Sem foto reduz conversão e prejudica busca/coleção. Falha = subir a foto do produto.'),
        cen('Olist sem itens inativos (limpeza)', 0 if inativos else 1, 1,
            [{'id': x['id'], 'codigo': x['codigo'], 'nome': x['nome']} for x in inativos],
            'ERP não deve ter itens inativos poluindo a operação. São resíduos da conversão pai→simples; excluir em massa no painel do Tiny.'),
    ]

    # ---- descrição das regras (metodologia) ----
    regras = [
        {'campo': 'Score de descrição (0-100)', 'regra': 'Começa em 100 e desconta: sem foto -30; descrição < 200 caracteres -20; título cru (BOI/APLICACION/PROTÓTIPO) -15; sem seção Compatibilidade -10; sem Especificações -10; resíduo de espanhol -15. Faixas: Boa ≥80, Média 50-79, Ruim <50.'},
        {'campo': 'Custo Site × Planilha (kits)', 'regra': 'Item comum: compara custo unitário do site com o da planilha. KIT (sufixo -KITn): compara o custo do kit no site com n × custo unitário da planilha (a planilha guarda o unitário; o kit vale a quantidade).'},
        {'campo': 'Itens da planilha considerados', 'regra': 'Só linhas com Status ATIVO. Rascunhos (draft) são ignorados em contagens, cobertura e divergências.'},
        {'campo': 'Cobertura de SKU', 'regra': 'Casamento tolera variações do código (ex.: com e sem ".0" no fim), evitando falso-negativo entre Site, Olist e Planilha.'},
        {'campo': 'Fonte de cada número', 'regra': 'Site = Shopify (Admin API). Olist = Tiny (API v2, itens ativos). Planilha = master no Google Drive (.xlsx), apenas linhas ativas.'},
    ]

    data = {
        'gerado_em': datetime.datetime.now().strftime('%d/%m/%Y %H:%M'),
        'kpis': {
            'produtos_site': len(ativos), 'itens_olist_ativos': len(tiny_ativos),
            'skus_planilha': len(master_ativo), 'com_foto': com_foto, 'sem_foto': len(sem_foto),
            'pct_com_foto': round(100 * com_foto / len(ativos), 1) if ativos else 0,
            'score_medio': score_medio, 'desc_boa': faixas['boa'], 'desc_media': faixas['media'],
            'desc_ruim': faixas['ruim'], 'div_preco_olist': len(div_preco),
            'div_custo_planilha': len(div_custo), 'falta_no_olist': len(falta_tiny),
            'inativos_olist': len(inativos),
        },
        'sem_foto': sem_foto, 'desc_ruins': desc_ruins, 'importantes': importantes,
        'div_preco': div_preco, 'div_custo': div_custo, 'inativos': inativos,
        'cenarios': cenarios, 'regras': regras,
    }
    json.dump(data, open(os.path.join(HERE, 'dashboard_data.json'), 'w'), ensure_ascii=False, indent=1)
    print('OK compute. KPIs:', json.dumps(data['kpis'], ensure_ascii=False))
    return data

if __name__ == '__main__':
    modo = sys.argv[1] if len(sys.argv) > 1 else 'compute'
    if modo in ('compute', 'all'):
        d = compute()
    if modo in ('push', 'all'):
        import push_sheet  # separado: escreve no Google (roda no cron)
        push_sheet.push(json.load(open(os.path.join(HERE, 'dashboard_data.json'))))
