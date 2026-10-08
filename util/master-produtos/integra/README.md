# Central de Integrações + Dashboard Executivo — APP Agro Peças

Sistema que cruza **Planilha central (Google Drive .xlsx) × Loja (Shopify) × ERP (Olist/Tiny)**,
audita fotos/descrições/divergências e alimenta um **dashboard executivo** com login Google.

## Arquitetura

```
  Shopify ─┐
  Tiny ────┼─►  pipeline.py (compute)  ─►  dashboard_data.json  ─►  push_sheet.py  ─►  APP_Dashboard_Data (Google Sheet nativa)
  Master ──┘                                                                                     │
                                                                                                 ▼
                                                            Dashboard (Google Apps Script Web App)  ◄── login Google + allowlist
```

- **`pipeline.py compute`** — só leitura: puxa Shopify + Tiny, lê a planilha master (Drive),
  calcula KPIs, score de descrição, fotos, divergências, cenários de teste. Gera `dashboard_data.json`.
- **`push_sheet.py`** — grava o JSON na planilha nativa `APP_Dashboard_Data` (que o dashboard lê).
- **`pipeline.py all`** — compute + push (usado pelo cron).
- **`repaginar_planilha.py [--upload]`** — repagina a master (marca/filtros) e sincroniza títulos do ecom.
- **`dashboard_appsscript/`** — o dashboard (Apps Script): `Code.gs`, `Index.html`, `appsscript.json`.

## Credenciais / acesso

- **Google (Sheets/Drive):** token do `admin@agropecaspadrao.com.br` via `gcloud auth print-access-token`.
  Re-login quando expirar: `gcloud auth login admin@agropecaspadrao.com.br --enable-gdrive-access`.
- **Shopify / Tiny:** lidos do `.env` na raiz do projeto (client_credentials / TINY_API_KEY).
- Planilha central (master): `1FoyfpY5E4Z4dYcEk7hiP2Jrg_dts6teu`
- Planilha de dados do dash: `1LFrTMRh3fiARn0c2eGGWnJfG4kJcVKuJvvfvAlCQQ-k` (`APP_Dashboard_Data`)

## Rodar

```bash
cd util/master-produtos/integra
python3 pipeline.py compute     # audita (só leitura)
python3 pipeline.py all         # audita + atualiza a planilha do dashboard
./atualizar.sh                  # idem (usado pelo cron e sob demanda)
```

## Cron (madrugada)

Instalado no crontab do usuário: `5 3 * * * .../atualizar.sh`. Roda 03h05 todo dia.
⚠️ cron não acorda o Mac dormindo — se o Mac estiver em sleep às 3h, rode `./atualizar.sh`
sob demanda, ou mantenha o Mac ligado. (Alternativa mais robusta: trigger de tempo no
próprio Apps Script — ver abaixo.)

## Deploy do dashboard (Apps Script)

### Opção A — clasp (automatizado)
```bash
cd dashboard_appsscript
clasp login                                   # navegador: escolher admin@agropecaspadrao.com.br
clasp create --type webapp --title "APP Central de Integracoes"
clasp push
clasp deploy
```
Requer **Apps Script API habilitada**: https://script.google.com/home/usersettings (ligar).

### Opção B — manual (5 min, à prova de falhas)
1. Acesse https://script.google.com → **Novo projeto**.
2. Cole o conteúdo de `Code.gs` no arquivo `Código.gs`.
3. **+ → HTML**, nomeie `Index`, cole o conteúdo de `Index.html`.
4. ⚙️ **Configurações do projeto → editar appsscript.json** (mostrar manifesto) e cole `appsscript.json`.
5. **Implantar → Nova implantação → Tipo: App da Web**.
   - Executar como: **Eu (admin@agropecaspadrao.com.br)**
   - Quem pode acessar: **Qualquer pessoa em agropecaspadrao.com.br** (domínio).
6. Autorize os escopos. Copie a **URL do app da Web** → é o link do dashboard.

O `DATA_SHEET_ID` já está fixado no `Code.gs` (fallback). Para trocar, defina a
Script Property `DATA_SHEET_ID`.

## Segurança

- **Login Google** obrigatório; acesso restrito ao domínio `agropecaspadrao.com.br` (deploy)
  **e** à allowlist de e-mails no `Code.gs`: `comercial@`, `admin@`, `socios@`.
- **Rate limiting** (40 req/min por usuário) + **lockout** (bloqueio temporário após abusos).
- **Segredos** (tokens Shopify/Tiny) ficam no `.env` local / servidor, nunca no cliente.
- Dados sensíveis são renderizados só para usuários autorizados; o script lê a planilha
  em nome do usuário (executeAs owner), sem expor a planilha diretamente.

## Score de qualidade de descrição (0–100)

Penalidades: sem foto (-30), descrição < 200 caracteres (-20), título cru BOI/APLICACION/PROTÓTIPO (-15),
sem seção Compatibilidade (-10), sem Especificações (-10), resíduo de espanhol (-15).
Faixas: **Boa ≥ 80 · Média 50–79 · Ruim < 50**.
