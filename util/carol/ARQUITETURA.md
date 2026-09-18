# Carol — Arquitetura do agente de operação

Documento técnico. Para o uso no dia a dia, ver `MANUAL_SOCIOS.md`.

## 1. Decisões e por quê

### Monólito modular, não microserviços

A Carol roda em **um** serviço Railway (plano Hobby), atende ~400 mensagens por
mês e tem um desenvolvedor. Nesse tamanho, microserviços adicionam rede,
deploy, observabilidade e custo sem devolver nada — é o cenário clássico do
*MonolithFirst* (Fowler). O que importa e foi feito: **fronteiras de módulo
explícitas** com injeção de dependência, para que qualquer módulo possa ser
extraído em serviço próprio quando (e se) fizer sentido:

```
src/
  email/transporte.js       cadeia de provedores (Gmail API → Resend → Brevo → SMTP)
  email/contingencia.js     e-mail falhou → mesmo conteúdo no WhatsApp dos admins
  google/auth.js            JWT de conta de serviço (com sub para delegação)
  alertas/anomalias.js      central de anomalias: classificação, dedup, multicanal, histórico
  saude/verificadores.js    workers: cada um examina uma dependência
  saude/recuperacao.js      ações seguras de auto-recovery
  saude/supervisor.js       orquestrador: roda, consolida, recupera, reporta, persiste
  comandos/chave.js         palavra-chave semanal (scrypt + sal, transição 24h)
  comandos/comandos.js      máquina de estados dos comandos /carol
  comandos/pausa.js         pausa manual da Carol no WhatsApp (/carol pausar, estado em disco)
  relatorios/atendimentos.js resumo estruturado das conversas (JSON da IA → e-mail da Dai, linhas do executivo, /carol e /carol detalhe)
  relatorios/campanhas.js   Meta Ads insights
  relatorios/socios.js      relatório executivo
  agenda.js                 scheduler persistente com catch-up
```

Cada módulo expõe funções puras ou com `deps` injetáveis (`fetchFn`, `agora`,
`enviarEmail`, `enviarWhatsApp`…). O `server.js` é a única camada que conhece
todos — é a "API layer": HTTP, autenticação, rate limit e wiring.

### Zero dependências novas

E-mail via `fetch` HTTPS, JWT da conta de serviço do Google assinado com
`node:crypto`, testes com `node --test`. Cada dependência npm é superfície de
supply chain; em Node isso é hoje o vetor de ataque mais comum.

### Determinístico onde dá, LLM só onde agrega

Verificações, alertas, comandos e agenda são código testado. A IA (Claude) é
usada em exatamente um ponto: resumir as transcrições dos clientes em texto
legível. Isso segue a recomendação da Anthropic em *Building effective agents*:
prefira **workflows** previsíveis a agentes autônomos quando a tarefa é
bem definida, e use o padrão **orquestrador-workers** para paralelizar
subtarefas independentes — que é o supervisor de saúde.

## 2. Fluxos

### 2.1 Anomalia (qualquer erro)

```
erro em qualquer ponto
  → classificarErro(e)            Graph 401 → whatsapp_token_invalido; SDK Anthropic 400 credit → anthropic_credito; …
  → reportarAnomalia({tipo})
      ├─ deduplicação por tipo     janela por severidade: crítica 1h · alta 6h · média 24h (persistida em disco)
      ├─ canais por severidade     crítica → e-mail + WhatsApp admins · alta → e-mail · média → só histórico/relatório · "Resolvido:" → e-mail (canaisPara)
      ├─ histórico (300 últimos)   inclusive suprimidas — alimenta /admin/anomalias e o relatório dos sócios
      ├─ e-mail                    "Urgente Carol: …" (crítica/alta) · "Carol: atenção: …" (média)
      └─ WhatsApp dos admins       exceto quando a falha É o WhatsApp
```

Pontos de captura: `webhook` (processamento de mensagem), `/api/chat`,
`graphPost` (401), carga do catálogo, envio de e-mail, agenda, supervisor.

### 2.2 Supervisor de saúde (a cada 30 min)

```
Promise.allSettled(verificadores)                 paralelo; verificador que lança vira 'falha'
  para cada resultado:
    falha + existe recuperação?  → tenta (token reserva, recarregar catálogo)
        recuperou → anomalia 'recuperacao_automatica' + reexamina
    falha/aviso com tipoAnomalia → reportarAnomalia
    era falha e agora ok         → anomalia 'Resolvido: …' (uma vez)
persistir saude.json (usado por /health, /admin/saude, relatório, comandos)
```

Verificadores: WhatsApp (401 + `debug_token.expires_at` < 7 dias), Anthropic
(`count_tokens` — gratuito — + saldo estimado), e-mail (provedor + último
envio), catálogo (idade), inventário (`products.json` público: `updated_at`
máximo, sem estoque), planilha master (Drive API via conta de serviço:
`modifiedTime`, `lastModifyingUser`), Meta (`debug_token`), Google Ads
(refresh do token), disco.

### 2.3 Auto-recovery

| Falha | Ação | Onde |
|---|---|---|
| WhatsApp 401 | troca `config.waAccessToken` pelo `WA_ACCESS_TOKEN_FALLBACK` e repete a chamada uma vez | `whatsapp.js` (imediato) e `recuperacao.js` (supervisor) |
| Catálogo não carrega | 3 tentativas com espera 2s/4s/6s; mantém última cópia boa | `recuperacao.js` |
| E-mail falha | próximo provedor da cadeia; se todos, WhatsApp dos admins (alertas, relatórios e palavra-chave) | `transporte.js`, `contingencia.js`, `anomalias.js` |
| Serviço fora no horário da tarefa | catch-up no boot se atraso < 6h + anomalia informativa | `agenda.js` |

Regra: só recuperar o que é **seguro e reversível**. Trocar por um token já
validado é; "reiniciar" às cegas não é.

### 2.4 Comandos `/carol`

```
mensagem de texto no webhook
  → tratarMensagemAdmin (ANTES da regra de horário comercial e da IA)
      não-admin + "/carol"      → auditoria + silêncio (não revela o recurso)
      admin + "/carol <sub>"    → autenticado? executa : pede palavra (pendente 5 min)
      admin + texto pendente    → validar (scrypt, tempo constante)
                                   ok   → autenticado 15 min, executa
                                   erro → 3 em 1h → bloqueio 1h + anomalia seguranca_tentativas
```

Subcomandos: `relatorio` (padrão), `detalhe`, `saude`, `socios`, `chave`, `status`,
`pausar`, `voltar`, `ajuda`. Respostas > 3500 chars são fatiadas em partes numeradas.

Números são comparados por `mesmoNumero()`: celular brasileiro com 13 dígitos
(55+DDD+9+8) e o mesmo com 12 (sem o nono dígito, como o WhatsApp entrega para
contas antigas) contam como o mesmo administrador. Sem isso, `/carol` de um
sócio com número antigo era ignorado e a mensagem caía na IA.

### 2.4.1 Pausa manual (`pausa.js`)

`/carol pausar [horas]` grava `pausa.json` (`desde`, `ate`, `horas`, `por`) em
`DATA_DIR`; `processarWhatsApp` consulta `estadoPausa()` **depois** dos comandos
de administrador e **antes** da regra de horário comercial, então durante a
pausa a Carol ignora clientes no WhatsApp mas continua aceitando `/carol`. O
site (`/api/chat`) não é afetado. Padrão 2 h, mínimo 30 min, máximo 12 h;
repetir o comando renova a partir de agora; `/carol voltar` apaga o arquivo.
Exposto em `/health` (`pausada`, `pausaAte`) e em `/admin/pausa` (GET/POST/DELETE).

### 2.4.2 Rajadas no WhatsApp (`whatsapp.js`)

A Meta recusa muitas mensagens seguidas para o mesmo telefone (erro **131056**,
"pair rate limit hit"; visto com clientes que mandam dezenas de mensagens e com
relatórios fatiados). `enviarTexto` reserva uma "vez" por destinatário com
intervalo mínimo `WA_ESPACO_MS` (2 s) e, se ainda assim receber 131056, espera
`WA_ESPERA_LIMITE_MS` (6 s) e repete uma única vez. A palavra nova sai por
e-mail; só cai para o WhatsApp dos administradores em **contingência** (todos os
provedores de e-mail falharam), com cabeçalho dizendo isso — senão os comandos
ficariam mortos até o e-mail voltar.

### 2.5 Palavra-chave

`agro-<palavra do vocabulário da loja>-<NN>`. Em disco: `scrypt(N=16384)` com
sal aleatório de 16 bytes, arquivo `0600`. Rotação automática segunda 7h55
(Brasília) ou no boot se não existir/expirou. Transição de 24h. Comparação com
`crypto.timingSafeEqual`.

### 2.6 Agenda

Horários em Brasília (UTC-3 fixo). `agenda.json` guarda última execução,
motivo, resultado e duração. No boot: para cada tarefa, calcula a ocorrência
anterior; se não rodou e atrasou menos que `AGENDA_JANELA_RECUPERACAO_H`,
executa agora. Tarefas: `relatorio_dai` 8h00, `relatorio_socios` 8h05,
`chave_semanal` seg 7h55.

## 3. Segurança

- **Segredos** só em variáveis de ambiente; nunca em log (a palavra-chave nunca
  é logada; tokens não aparecem em mensagens de erro além do status HTTP).
- **`/admin`**: chave em header `Authorization: Bearer` (query string aceita
  por compatibilidade, mas migrada para cookie HttpOnly no dashboard),
  comparação em tempo constante, rate limit 60 req/10 min por IP.
- **Webhook**: assinatura HMAC-SHA256 do app secret, fail-closed.
- **Comandos**: allowlist de números + palavra semanal + lockout + auditoria em
  `auditoria.jsonl`. Defesa em profundidade: ter o número não basta, ter a
  palavra não basta.
- **Entrada do usuário**: marcadores de contexto (`[Cliente: …]`) removidos
  antes de chegar aos relatórios (anti-spoofing) — já existia e foi mantido.
- **Anti alert-fatigue** é segurança também: alerta que ninguém lê é alerta que
  não existe (Google SRE, cap. 6).

## 4. Testes

`npm test` — 48 testes, `node --test`, sem dependências, sem rede: `fetch`
falso, relógio controlável, diretório de dados temporário por processo.

| Arquivo | Cobre |
|---|---|
| `chave.test.js` | formato, validação, transição 24h, expiração 7d, normalização, e-mail |
| `anomalias.test.js` | canais por severidade (canaisPara), dedup/janela, forcar, fallback e-mail→WhatsApp, classificação de erros |
| `atendimentos.test.js` | agrupamento/numeração das conversas, parse do JSON da IA (com fallback), textos compacto/e-mail/detalhe, busca por número ou telefone |
| `comandos.test.js` | parse, não-admin silencioso, fluxo pendente→palavra→execução, autenticação 15 min, lockout, expiração da pendência, subcomandos, fatiar |
| `transporte.test.js` | ordem de provedores, erros claros, Gmail (JWT com sub, MIME), fallback Gmail→Resend→Brevo, agregação de falhas |
| `contingencia.test.js` | e-mail ok, queda para WhatsApp fatiado com anomalia, sem admins, desligada |
| `agenda.test.js` | cálculo de ocorrências (diária e semanal, BRT), catch-up dentro/fora da janela, idempotência no mesmo dia, falha registrada |
| `saude.test.js` | cada verificador com respostas reais simuladas, recuperações, supervisor (consolidação, recuperação, "resolvido") |

## 5. Operação

- **Deploy**: `railway up --detach --service shopify-agro-pecas-theme` da raiz
  do repositório (auto-deploy GitHub→Railway não dispara).
- **Variáveis novas**: ver `.env.example`, bloco "Monitoramento".
- **Primeiro boot** gera e envia a palavra-chave por e-mail; sem e-mail
  funcionando ela vai pelo WhatsApp dos `CAROL_ADMINS` (contingência). Depois
  de ligar o e-mail, `POST /admin/chave/rotacionar` manda uma nova pelo canal certo.
- **Testar os alertas**: `POST /admin/anomalias/teste`.
- **Logs**: prefixos `[anomalias]`, `[saude]`, `[recuperacao]`, `[comandos]`,
  `[agenda]`, `[email]`, `[chave]`.

## 6. Limites conhecidos e próximos passos

- Estado de autenticação dos comandos e lockout ficam em memória: um redeploy
  zera (a palavra-chave e a auditoria, não). Aceitável para o volume; se virar
  problema, mover para `DATA_DIR`.
- O relatório de campanhas cobre Meta Ads. Google Ads exige a API com
  developer token aprovado e GAQL — fica para uma segunda fase.
- `verificarInventario` usa o `products.json` público (sem token). Para
  níveis de estoque por depósito, precisaria do Admin API do Shopify.
- Se a Carol inteira cair, ela não avisa. Um *dead man's switch* externo
  (ex.: healthchecks.io batendo em `/health` a cada 5 min) fecha esse buraco
  por zero custo — recomendado como próximo passo.

## 7. Referências

- Fowler, *MonolithFirst* e *Modular monolith* — martinfowler.com/bliki/MonolithFirst.html
- Anthropic, *Building effective agents* — anthropic.com/engineering/building-effective-agents
- Beyer et al., *Site Reliability Engineering* (Google), cap. 6 *Monitoring Distributed Systems* e cap. 10 *Practical Alerting* — sre.google/sre-book
- OWASP *Cheat Sheet Series*: Authentication, Secrets Management, Logging — cheatsheetseries.owasp.org
- *The Twelve-Factor App*, III Config e XI Logs — 12factor.net
- Node.js, *Test runner* (`node:test`) e `crypto.scrypt` / `timingSafeEqual` — nodejs.org/api
- Meta, *WhatsApp Cloud API* e *Marketing API Insights* — developers.facebook.com/docs
- Google, *Using OAuth 2.0 for Server to Server Applications* — developers.google.com/identity/protocols/oauth2/service-account
