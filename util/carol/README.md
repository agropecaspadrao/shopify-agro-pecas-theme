# Carol — Atendente Virtual (IA)

Chatbot generativo da APP Agro Peças Padrão, construído sobre a API do Claude (Anthropic).

**Divisão de atendimento:** de segunda a sexta, das 8h às 18h (Brasília), quem atende o WhatsApp é a **Dai** (humana, pelo aplicativo WhatsApp Business). Fora desse horário, noites, fins de semana e feriados, quem responde é a **Carol** (IA). No chat do site, a Carol atende 24h.

## O que a Carol sabe

- Catálogo completo da loja, carregado ao vivo de `https://agropecaspadrao.com.br/products.json` (título, SKU, preço, estoque, descrição, tags) e atualizado a cada 30 minutos.
- Specs técnicas enriquecidas (função, medidas, compatibilidade de máquinas, códigos equivalentes) vindas de `util/master-produtos/pesquisa/specs_*.json`, consolidadas em `knowledge/specs.json` pelo script `npm run conhecimento`.
- Regras de conformidade de marca do CLAUDE.md (padrão original/OEM, marcas só como compatibilidade, "Sob Consulta", ISO dos fornecedores).
- Tom: formal leve, linguagem do agro brasileiro, sem travessão, sem emoji (garantido também por pós-processamento).

## Estrutura

```
util/carol/
├── src/
│   ├── server.js      Express: webhook WhatsApp + API do widget + /health
│   ├── claude.js      Claude API (tool runner, prompt caching, sanitização)
│   ├── persona.js     System prompt da Carol
│   ├── catalogo.js    Índice do catálogo + busca + ficha de produto
│   ├── whatsapp.js    Cloud API: assinatura, parse do webhook, envio
│   ├── horario.js     Horário comercial (America/Sao_Paulo)
│   ├── sessions.js    Histórico de conversas em memória (TTL 12h)
│   └── config.js      Variáveis de ambiente
├── scripts/
│   ├── conversar.js           Chat de teste no terminal
│   └── gerar_conhecimento.js  Consolida specs em knowledge/specs.json
└── knowledge/specs.json       Base técnica (gerada, versionada)
```

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
2. Configure as variáveis do `.env.example` no painel (no mínimo `ANTHROPIC_API_KEY`; as `WA_*` quando o WhatsApp estiver conectado).
3. Anote a URL pública (ex.: `https://carol-agropecas.up.railway.app`). Teste `GET /health`.

## Conectar o WhatsApp (modo coexistência)

O número (41) 98415-1085 continua no aplicativo da Dai **e** ganha acesso à Cloud API para a Carol:

1. No app do Meta for Developers (o mesmo do pixel/`META_APP_ID`), adicione o produto **WhatsApp**.
2. Faça o onboarding do número pelo fluxo de **coexistência** (WhatsApp Business App + Cloud API): em WhatsApp Manager → adicionar número → conectar número existente do aplicativo. O celular da Dai escaneia um QR code e o app permanece funcionando. Requisitos: app WhatsApp Business atualizado e número não registrado previamente na API. Se o fluxo de coexistência não aparecer disponível para a conta, me avise que ajustamos a rota (número dedicado ou migração).
3. Anote o **Phone Number ID** → variável `WA_PHONE_NUMBER_ID`.
4. Gere um token de sistema (System User) com `whatsapp_business_messaging` e `whatsapp_business_management` → `WA_ACCESS_TOKEN`.
5. Em **WhatsApp → Configuration → Webhook**: URL `https://SUA-URL/webhook`, verify token = o valor que você definir em `WA_VERIFY_TOKEN`, e assine o campo **messages**.
6. Reinicie o serviço e teste mandando mensagem fora do horário comercial.

Comportamento: dentro do horário comercial a Carol ignora as mensagens (a Dai atende pelo app). Fora do horário, a Carol marca como lida e responde. Mensagens de áudio/foto fora do horário recebem um pedido educado de texto.

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

- `GET /admin/dashboard?key=CAROL_ADMIN_KEY&dias=7` → página com custo total, custo por dia, custo médio por mensagem, ranking de conversas que mais gastaram e mensagens mais caras (`dias` = 1, 7 ou 30).
- `GET /admin/custos?key=CAROL_ADMIN_KEY&dias=7` → os mesmos dados em JSON.
- `CAROL_USD_BRL` (padrão 5.60) ajusta a cotação usada só para exibir o valor estimado em reais.
