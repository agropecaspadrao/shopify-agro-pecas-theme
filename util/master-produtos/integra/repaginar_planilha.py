"""Repagina a planilha central (Google Drive .xlsx) e sincroniza títulos com o ecom.

- Faz backup da planilha no Drive antes de qualquer coisa.
- Título (col D) <- título atual do Shopify (o do site é melhor). Onde não há
  produto no site, normaliza BOI->Bomba Hidráulica e Aplicacion->Aplicação.
- Preenche colunas "Cadastrado Shopify?", "SKU/Título Shopify (derivado)".
- Repagina com a identidade da marca: cabeçalho verde, fonte branca, freeze,
  autofiltro, larguras, zebra e realces (sem custo = vermelho; fora do site = amarelo).

Uso:
  python3 repaginar_planilha.py           # dry-run local (gera central_novo.xlsx)
  python3 repaginar_planilha.py --upload  # backup no Drive + sobe a nova versão
"""
import sys, os, json, re, subprocess, datetime, urllib.request, urllib.parse

SHEET_ID = '1FoyfpY5E4Z4dYcEk7hiP2Jrg_dts6teu'
ADMIN = 'admin@agropecaspadrao.com.br'
HERE = os.path.dirname(os.path.abspath(__file__))
SUP = ['02_SOHIPREN', '04_GRECO', '03_AGCO', '05_JOHN_DEERE', '06_STARA', '07_GTS', '08_FERTISYSTEM']

# cores da marca
VERDE = '1B4332'; VERDE_MID = '2F6B4F'; DOURADO = 'D4AF37'
BRANCO = 'FFFFFF'; ZEBRA = 'F3F6F4'; VERM = 'FDE2E1'; AMAR = 'FFF4D6'

def token():
    return subprocess.run(['gcloud', 'auth', 'print-access-token', '--account=' + ADMIN],
                          capture_output=True, text=True).stdout.strip()

def drive_download(dest):
    tk = token()
    url = f'https://www.googleapis.com/drive/v3/files/{SHEET_ID}?alt=media&supportsAllDrives=true'
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tk})
    with urllib.request.urlopen(req) as r, open(dest, 'wb') as f:
        f.write(r.read())

def drive_backup():
    tk = token()
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M')
    body = json.dumps({'name': f'BACKUP_{ts}_APP_Master_Produtos_Shopify.xlsx'}).encode()
    url = f'https://www.googleapis.com/drive/v3/files/{SHEET_ID}/copy?supportsAllDrives=true'
    req = urllib.request.Request(url, data=body, method='POST',
        headers={'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json'})
    d = json.load(urllib.request.urlopen(req))
    return d.get('name'), d.get('id')

def drive_upload(src):
    tk = token()
    data = open(src, 'rb').read()
    url = f'https://www.googleapis.com/upload/drive/v3/files/{SHEET_ID}?uploadType=media&supportsAllDrives=true'
    req = urllib.request.Request(url, data=data, method='PATCH', headers={
        'Authorization': 'Bearer ' + tk,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
    return json.load(urllib.request.urlopen(req))

# ---- normalização de título (BOI / Aplicacion) para linhas fora do site ----
RAW_RE = re.compile(r'^\s*(BOI\b|BOMBA\s+(DE\s+)?APLICACI[OÓ]N|MOTOR\s+APLICACI[OÓ]N)', re.I)
def canon_title(t):
    if not t or not RAW_RE.match(t): return t
    x = t
    x = re.sub(r'^\s*BOI\b', 'Bomba Hidráulica', x)
    x = re.sub(r'^\s*BOMBA\s+DE\s+APLICACI[OÓ]N', 'Bomba de Aplicação', x, flags=re.I)
    x = re.sub(r'^\s*BOMBA\s+APLICACI[OÓ]N', 'Bomba de Aplicação', x, flags=re.I)
    x = re.sub(r'^\s*MOTOR\s+APLICACI[OÓ]N', 'Motor de Aplicação', x, flags=re.I)
    x = re.sub(r'APLICACI[OÓ]N|APLICATION', 'Aplicação', x, flags=re.I)
    x = re.sub(r'\bMF\s+A-', 'Massey Ferguson A-', x)
    x = re.sub(r'\bCNH\s+A-', 'New Holland A-', x)
    x = re.sub(r'\bJD\s+A-', 'John Deere A-', x)
    x = re.sub(r'\bGIRO\s+([ID])\b', r'Giro \1', x, flags=re.I)
    x = re.sub(r'\s*\(PROT[OÓ]TIPO\)', '', x, flags=re.I)
    return re.sub(r'\s{2,}', ' ', x).strip()

def sku_variants(s):
    s = (s or '').strip()
    out = {s}
    if s.endswith('.0'): out.add(s[:-2])
    out.add(s + '.0')
    return {x for x in out if x}

def main():
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.formatting.rule import FormulaRule
    from openpyxl.utils import get_column_letter, column_index_from_string

    drive_download(os.path.join(HERE, 'central.xlsx'))
    sku_title = json.load(open(os.path.join(HERE, 'sku_title_atual.json')))
    # index shopify por variações de sku
    shop_idx = {}
    for sku, t in sku_title.items():
        for v in sku_variants(sku): shop_idx[v] = (sku, t)

    wb = openpyxl.load_workbook(os.path.join(HERE, 'central.xlsx'))
    head_fill = PatternFill('solid', fgColor=VERDE)
    sec_fill = PatternFill('solid', fgColor=VERDE_MID)
    zebra_fill = PatternFill('solid', fgColor=ZEBRA)
    verm_fill = PatternFill('solid', fgColor=VERM)
    amar_fill = PatternFill('solid', fgColor=AMAR)
    head_font = Font(name='Calibri', bold=True, color=BRANCO, size=11)
    sec_font = Font(name='Calibri', bold=True, color=DOURADO, size=11)
    thin = Side(style='thin', color='D9D9D9')
    border = Border(bottom=thin, right=thin)

    stats = {'titulos_sync': 0, 'titulos_norm': 0}
    for name in SUP:
        ws = wb[name]
        # acha header row (linha com 'Title')
        hr = next((r for r in range(1, 9)
                   if any('Title' in str(ws.cell(r, c).value or '')
                          for c in range(1, ws.max_column + 1))), 5)
        cols = {str(ws.cell(hr, c).value).strip(): c
                for c in range(1, ws.max_column + 1) if ws.cell(hr, c).value}
        cA = 1
        cTitle = cols.get('Title (PT-BR)', 4)
        cCad = next((c for k, c in cols.items() if 'Cadastrado Shopify' in k), None)
        cSkuDer = next((c for k, c in cols.items() if 'SKU Shopify' in k), None)
        cTitDer = next((c for k, c in cols.items() if 'Título Shopify' in k or 'Titulo Shopify' in k), None)
        cCusto = next((c for k, c in cols.items() if 'Custo unit' in k), None)
        last_col = ws.max_column

        # --- sincroniza títulos / colunas derivadas ---
        last_data = hr
        for r in range(hr + 1, ws.max_row + 1):
            sku = ws.cell(r, cA).value
            if sku is None or str(sku).strip() == '': continue
            last_data = r
            sku = str(sku).strip()
            hit = next((shop_idx[v] for v in sku_variants(sku) if v in shop_idx), None)
            if hit:
                real_sku, real_t = hit
                if ws.cell(r, cTitle).value != real_t:
                    ws.cell(r, cTitle).value = real_t; stats['titulos_sync'] += 1
                if cCad: ws.cell(r, cCad).value = 'sim'
                # AO/AP são fórmulas =A/=D (espelham SKU/Título) — não sobrescrever
            else:
                cur = ws.cell(r, cTitle).value
                nt = canon_title(cur if isinstance(cur, str) else '')
                if nt and nt != cur:
                    ws.cell(r, cTitle).value = nt; stats['titulos_norm'] += 1
                if cCad and not ws.cell(r, cCad).value: ws.cell(r, cCad).value = 'não'

        # --- estilo do cabeçalho e seção ---
        if hr - 1 >= 1:
            for c in range(1, last_col + 1):
                cell = ws.cell(hr - 1, c)
                if cell.value: cell.fill = sec_fill; cell.font = sec_font
        for c in range(1, last_col + 1):
            cell = ws.cell(hr, c)
            cell.fill = head_fill; cell.font = head_font
            cell.alignment = Alignment(vertical='center', horizontal='left', wrap_text=True)
            cell.border = border
        ws.row_dimensions[hr].height = 34

        # freeze: mantém colunas identidade (A..D) + cabeçalho
        ws.freeze_panes = ws.cell(hr + 1, min(cTitle + 1, 5)).coordinate
        # autofiltro sobre o cabeçalho
        ws.auto_filter.ref = f"{get_column_letter(1)}{hr}:{get_column_letter(last_col)}{max(last_data, hr+1)}"
        # larguras
        for c, w in {1: 20, 2: 14, 3: 22, cTitle: 50, cTitle + 1: 22}.items():
            ws.column_dimensions[get_column_letter(c)].width = w

        # --- formatação condicional na área de dados ---
        rng = f"A{hr+1}:{get_column_letter(last_col)}{max(last_data, hr+1)}"
        colA = get_column_letter(1)
        # zebra (linhas pares)
        ws.conditional_formatting.add(rng, FormulaRule(
            formula=[f'AND($A{hr+1}<>"",ISEVEN(ROW()))'], fill=zebra_fill, stopIfTrue=False))
        # custo vazio -> vermelho (linha com SKU mas sem custo)
        if cCusto:
            colC = get_column_letter(cCusto)
            ws.conditional_formatting.add(rng, FormulaRule(
                formula=[f'AND($A{hr+1}<>"",${colC}{hr+1}="")'], fill=verm_fill, stopIfTrue=False))
        # fora do site -> amarelo
        if cCad:
            colCad = get_column_letter(cCad)
            ws.conditional_formatting.add(rng, FormulaRule(
                formula=[f'AND($A{hr+1}<>"",${colCad}{hr+1}="não")'], fill=amar_fill, stopIfTrue=False))

    # --- LEIA-ME: nota de fonte da verdade ---
    if '00_LEIA-ME' in wb.sheetnames:
        ws = wb['00_LEIA-ME']
        nota = [
            'FONTE DA VERDADE — esta planilha é a origem do catálogo que sobe para o ecom.',
            'Fluxo: as áreas de negócio cadastram/atualizam aqui (SKU, título, custo, preço) e',
            'o robô sincroniza com a loja (Shopify) e o ERP (Olist/Tiny) na madrugada ou sob demanda.',
            'Coluna D (Title) reflete o título publicado no site. Vermelho = sem custo. Amarelo = fora do site.',
            'Dashboard executivo de integrações: acompanhe fotos, descrições e divergências (link enviado à parte).',
        ]
        base = ws.max_row + 2
        for i, linha in enumerate(nota):
            ws.cell(base + i, 2).value = linha
            ws.cell(base + i, 2).font = Font(bold=(i == 0), color=VERDE if i == 0 else '333333')

    out = os.path.join(HERE, 'central_novo.xlsx')
    wb.save(out)
    print('titulos sincronizados (site):', stats['titulos_sync'],
          '| normalizados (fora do site):', stats['titulos_norm'])
    print('salvo:', out)

    if '--upload' in sys.argv:
        nome, bid = drive_backup()
        print('backup criado no Drive:', nome, bid)
        r = drive_upload(out)
        print('planilha central atualizada:', r.get('name'), '| id', r.get('id'))

if __name__ == '__main__':
    main()
