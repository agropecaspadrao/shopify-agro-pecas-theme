# Carol — Atendente Virtual (IA)

Chatbot generativo da APP Agro Peças Padrão, construído sobre a API do Claude (Anthropic).

**Divisão de atendimento:** de segunda a sexta, das 8h às 18h (Brasília), quem atende o WhatsApp é a **Dai** (humana, pelo aplicativo WhatsApp Business). Fora desse horário, noites, fins de semana e feriados, quem responde é a **Carol** (IA). No chat do site, a Carol atende 24h.

**Modo 24h (`CAROL_24H=1`):** a partir do lançamento do SDR comercial (repositório `app-agente-sdr`), a Carol responde o WhatsApp em qualquer horário e a Dai passa a acompanhar, pelo painel do SDR, somente os atendimentos quentes. Nesse modo o webhook da Meta aponta para o messenger do SDR, que encaminha à Carol tudo o que não for conversa iniciada pelo SDR.

## O que a Carol sabe

- Catálogo completo da loja, carregado ao vivo de `https://agropecaspadrao.com.br/products.json` (título, SKU, preço, estoque, descrição, tags) e recarregado 3 vezes ao dia (6h, 12h e 18h de Brasília); se a carga falhar, a Carol responde sem catálogo e tenta de novo no máximo 1 vez por minuto.
- Specs técnicas enriquecidas (função, medidas, compatibilidade de máquinas, códigos equivalentes) vindas de `util/master-produtos/pesquisa/specs_*.json`, consolidadas em `knowledge/specs.json` pelo script `npm run conhecimento`.
- Regras de conformidade de marca do CLAUDE.md (padrão original/OEM, marcas só como compatibilidade, "Sob Consulta", ISO dos fornecedores).
- Tom: formal leve, linguagem do agro brasileiro, sem travessão, sem emoji (garantido também por pós-processamento).

## Estrutura

```
util/carol/
├── src/
│   ├── server.js      Ponto de entrada (npm start): chama boot.js
│   ├── boot.js        listen PRIMEIRO; catálogo, memória e agenda em segundo plano
│   ├── app.js         Express sem listen (testável): /health, /webhook, /api, /admin
│   ├── rotas/         webhook.js (fila por telefone, contingência), chat.js, admin.js
│   ├── claude.js      Claude API (tool runner, prompt caching, sanitização); gera e só registra depois de entregar
│   ├── ia/anthropic.js Cliente único da Anthropic (timeout 60 s, 1 retry)
│   ├── persona.js     System prompt da Carol
│   ├── catalogo.js    Índice do catálogo + busca + ficha de produto + link de carrinho
│   ├── whatsapp.js    Cloud API: assinatura, parse do webhook (inclui ecos da equipe), envio
│   ├── horario.js / horarioConfig.js  Regra de horário (painel ou variáveis)
│   ├── memoria/       Memória de conversa (Postgres com fallback local)
│   ├── registro.js    Registro JSONL dos atendimentos + espelho no SDR
│   ├── gasto.js       Contador persistente do gasto com a API (saldo estimado)
│   ├── lgpd.js        Exclusão de todos os dados de um cliente
│   └── config.js      Variáveis de ambiente (não lê .env em teste)
├── scripts/
│   ├── conversar.js           Chat de teste no terminal
│   ├── deploy_railway.sh      Deploy (nunca sobrescreve segredos)
│   └── gerar_conhecimento.js  Consolida specs em knowledge/specs.json
├── railway.json               healthcheck /health (ver Deploy)
└── knowledge/specs.json       Base técnica (gerada, versionada)
```

Detalhes técnicos em `ARQUITETURA.md`; uso no dia a dia em `MANUAL_SOCIOS.md`.

No tema: `snippets/carol-widget.liquid` + `assets/carol-chat.js`, ativados em **Theme Settings → Carol (Atendente Virtual)**.

## Rodar localmente

```bash
cd util/carol
npm install
npm run conhecimento   # gera knowledge/specs.json
npm run conversar      # chat de teste no terminal (só precisa de ANTHROPIC_API_KEY)
npm start              # sobe o servidor na porta 3333
```

A `ANTHROPIC_API_KEY` pode estar no `.env` da raiz do repositório ou em `util/carol/.env`.

## Deploy no Railway (ou Render)

1. Crie um serviço novo apontando para este repositório com **root directory `util/carol`** (start command: `npm start`).
2. Em Settings → Config-as-code, informe o caminho **`/util/carol/railway.json`** (o Railway não procura o arquivo dentro do root directory). Ele liga o healthcheck em `/health` (timeout 60 s).
3. Configure as variáveis do `.env.example` no painel (no mínimo `ANTHROPIC_API_KEY`; as `WA_*` quando o WhatsApp estiver conectado). O `scripts/deploy_railway.sh` só cria variáveis ausentes; segredos existentes (inclusive `WA_ACCESS_TOKEN`) se trocam pelo painel do Railway.
4. Anote a URL pública (ex.: `https://carol-agropecas.up.railway.app`). Teste `GET /health` (público, só `{ ok, status }`; detalhes com `Authorization: Bearer <CAROL_ADMIN_KEY>`).

## Conectar o WhatsApp (modo coexistência)

O número (41) 98415-1085 continua no aplicativo da Dai **e** ganha acesso à Cloud API para a Carol:

1. No app do Meta for Developers (o mesmo do pixel/`META_APP_ID`), adicione o produto **WhatsApp**.
2. Faça o onboarding do número pelo fluxo de **coexistência** (WhatsApp Business App + Cloud API): em WhatsApp Manager → adicionar número → conectar número existente do aplicativo. O celular da Dai escaneia um QR code e o app permanece funcionando. Requisitos: app WhatsApp Business atualizado e número não registrado previamente na API. Se o fluxo de coexistência não aparecer disponível para a conta, me avise que ajustamos a rota (número dedicado ou migração).
3. Anote o **Phone Number ID** → variável `WA_PHONE_NUMBER_ID`.
4. Gere um token de sistema (System User) com `whatsapp_business_messaging` e `whatsapp_business_management` → `WA_ACCESS_TOKEN`.
5. Em **WhatsApp → Configuration → Webhook**: URL `https://SUA-URL/webhook`, verify token = o valor que você definir em `WA_VERIFY_TOKEN`, e assine os campos **messages** e **smb_message_echoes** (este último entrega as respostas que a Dai digita no app; a Carol registra e usa como contexto, nunca responde a elas).
6. Reinicie o serviço e teste mandando mensagem fora do horário comercial.

Comportamento: no horário da equipe a Carol não responde (a Dai atende pelo app), mas registra cada mensagem como pendente (aparece no relatório da Dai, no painel e no SDR). No horário dela, a Carol agrupa mensagens seguidas (4 s), marca como lida e responde uma vez. Se a IA estiver fora (ex.: crédito zerado), o cliente recebe "Recebi sua mensagem. Nossa equipe vai te responder..." (no máximo 1 vez a cada 30 min) e o turno fica registrado como falha. Áudio é transcrito; foto/documento recebem um pedido educado de texto.

## Ativar o widget no site

1. Shopify Admin → Online Store → Themes → Customize → **Theme Settings → Carol (Atendente Virtual)**.
2. Cole a URL do serviço em "URL do servidor da Carol" e marque "Ativar chat da Carol no site".

## Fase 2 — Instagram Direct

Requer App Review da Meta para a permissão `instagram_manage_messages` e conta IG conectada à página. O backend já está preparado para ganhar um segundo webhook (`/webhook` compartilhado, campo `messages` do objeto `instagram`); implementar quando a permissão for aprovada.

## Custos e modelo

Modelo padrão: `claude-opus-4-8` com prompt caching (o catálogo inteiro fica em cache de 1h, ~90% de desconto nos tokens repetidos). Para reduzir custo, é possível trocar por `claude-sonnet-5` via variável `CAROL_MODEL`, com alguma perda de qualidade.

## Áudio no WhatsApp (transcrição via Groq)

Mensagens de voz são baixadas da Cloud API e transcritas pelo Whisper large-v3-turbo da **Groq**, que tem camada gratuita:

1. Crie uma conta gratuita em https://console.groq.com (não pede cartão).
2. Gere uma API key e defina `GROQ_API_KEY` no Railway (e no `.env` local).
3. Sem a chave, a Carol responde ao áudio pedindo educadamente uma mensagem de texto.

## Dashboard de custos

Cada resposta grava no registro os tokens reais de todas as chamadas (entrada, saída, cache) e o custo em US$:

- `GET /admin/dashboard?dias=7` → página com custo total, custo por dia, custo médio por mensagem, ranking de conversas que mais gastaram e mensagens mais caras (`dias` = 1, 7, 30 ou 90). Exige a sessão do painel: sem ela, vai para `/admin/painel/entrar` e volta. Telefones aparecem mascarados.
- `GET /admin/custos?dias=7` com `Authorization: Bearer <CAROL_ADMIN_KEY>` → os mesmos dados em JSON.
- O antigo `?key=` na URL foi removido (vazava em log e histórico do navegador).
- `CAROL_USD_BRL` (padrão 5.60) ajusta a cotação usada só para exibir o valor estimado em reais.
