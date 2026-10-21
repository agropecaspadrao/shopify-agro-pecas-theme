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
  server.js                 ponto de entrada: só chama boot.iniciarServico()
  boot.js                   listen PRIMEIRO; catálogo, memória, palavra-chave e agenda em segundo plano
  app.js                    Express sem listen (testável): /health, wiring de todas as rotas, erro sem stack
  rotas/webhook.js          WhatsApp: ecos da equipe, comandos, silêncio, fila por telefone, contingência
  rotas/chat.js             widget do site: limites, tetos diários, reserva de 20% para sessões ativas
  rotas/admin.js            /admin/* antigo: Bearer ou sessão do painel; chave do SDR só na exportação
  ia/anthropic.js           cliente único da Anthropic (timeout 60 s, 1 retry)
  gasto.js                  contador persistente de gasto + estado do crédito visto pela API
  lgpd.js                   exclusão de todos os dados de um cliente
  util/dados.js, util/telefone.js, util/marcadores.js, util/uso.js, util/auditoria.js,
  util/ip.js, util/tetoDiario.js   peças compartilhadas (uma cópia só de cada regra)
  email/transporte.js       cadeia de provedores HTTP (Gmail API → Resend → Brevo; SMTP removido)
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
  memoria/index.js          memória de conversa: fachada com fallback Postgres → local
  memoria/postgres.js       adaptador Postgres (DATABASE_URL), migrações idempotentes
  memoria/local.js          adaptador local (mapas + reidratação do registro JSONL de 7 dias)
  memoria/regras.js         regras puras: anti-lixo, episódio, merge da ficha, bloco de contexto
  memoria/ia.js             chamadas ao Haiku (episódio + fatos; compactação de conversa longa)
  origem.js                 origem do lead (anúncio/catálogo/site/orgânico) para o SDR
  agenda.js                 scheduler persistente com catch-up
  horarioConfig.js          regra de horário da Carol no WhatsApp (presets/janelas, DATA_DIR/horario.json)
  horario.js                horarioComercial()/contextoHorario() a partir da regra acima
  admin/rotas.js            painel do administrador (/admin/painel): login, API, ações
  admin/sessao.js           cookie de sessão assinado (HMAC), CSRF, headers de segurança
  admin/painel.js           agregados do painel (estado 5 s, detalhes 60 s) com cache
  admin/atendimento.js      leitura incremental do registro JSONL, contadores, picos, mascaramento
  admin/maquina.js          CPU/memória/event loop do processo + tempo de resposta da Carol
  admin/railway.js          métricas 24h do Railway (GraphQL), cache 60 s, falha silenciosa
  admin/pagina.js, admin/publico/  HTML, CSS e JS do painel (sem build, sem libs)
  util/arquivo.js           gravação atômica de JSON (tmp + rename)
  util/limite.js            limites por chave (rate limit) com consulta de uso
```

Cada módulo expõe funções puras ou com `deps` injetáveis (`fetchFn`, `agora`,
`enviarEmail`, `enviarWhatsApp`…). O `app.js` é a única camada que conhece
todos — é a "API layer": HTTP, autenticação, rate limit e wiring. Os testes
montam o app com dependências falsas e sobem num servidor efêmero.

### Entrega antes do registro; nada some em silêncio

`claude.gerarResposta()` só gera; quem chama entrega e depois `confirmar()`
registra (JSONL + espelho SDR) e grava a memória. Envio que falha fica com
`entregue:false` e a resposta não entra na memória como dita. Tipos de linha
do registro: (sem tipo) IA, `falha` (IA fora: contingência curta, no máximo 1
por telefone a cada 30 min), `silencio` (horário/pausa/teto, motivo gravado),
`humano` (eco do que a Dai digita no app, campo `smb_message_echoes`; nunca
dispara resposta), `aviso` (resposta fixa sem IA, ex.: foto), `sistema`
(chamadas internas). Relatório da Dai, painel, dashboard e exportação contam
`falha/silencio/aviso/entregue:false` como **pendentes** e não como respostas
da IA.

### Dependências mínimas

E-mail via `fetch` HTTPS, JWT da conta de serviço do Google assinado com
`node:crypto`, testes com `node --test`. Cada dependência npm é superfície de
supply chain; em Node isso é hoje o vetor de ataque mais comum. A única
adição foi `pg` (driver Postgres da memória de conversa), carregado por
import dinâmico só quando existe `DATABASE_URL`.

### Determinístico onde dá, LLM só onde agrega

Verificações, alertas, comandos e agenda são código testado. A IA (Claude) é
usada para resumir: as transcrições dos clientes em texto legível (relatório)
e as conversas em episódios e fatos da ficha (memória, com o Haiku, que é mais
barato). Quem decide quando resumir, o que guardar e o que entra no contexto é
código determinístico (`memoria/regras.js`). Isso segue a recomendação da Anthropic em *Building effective agents*:
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
Pelo painel ("Desligar") vale até 72 h (`maxHoras`) ou **sem prazo**
(`indefinida: true`, "até eu religar"), que só termina com Ligar ou `/carol voltar`.
A gravação é atômica (`util/arquivo.js`).

### 2.4.3 Horário de atendimento (`horarioConfig.js`)

A regra "quando a Carol responde o WhatsApp" fica em `DATA_DIR/horario.json`,
editada pelo painel; sem arquivo, vale o padrão do ambiente (`CAROL_24H=1` →
24 horas; senão "só fora do expediente" com `CAROL_HORA_INICIO/FIM`, seg–sex).

```json
{ "modo": "24h | fora_expediente | expediente | personalizado",
  "expediente": { "dias": [1,2,3,4,5], "inicio": "08:00", "fim": "18:00" },
  "janelas": [ { "dias": [1,2,3,4,5], "inicio": "18:00", "fim": "08:00" },
               { "dias": [6], "inicio": "12:00", "fim": "24:00" } ] }
```

Dias 0 = domingo. Janela com fim ≤ início cruza a meia-noite e pertence ao
dia em que começa; `24:00` é o fim do dia. Validação forte no servidor
(`validarHorario`: dias 0–6 sem repetição, HH:MM, início ≠ fim, até 14
janelas, personalizado exige ao menos uma). `horarioComercial()` = "a Carol
fica em silêncio" e continua sendo a única consulta do webhook; o
`contextoHorario()` enviado ao Claude descreve o expediente configurado e,
quando a Carol atende fora dele, quando a equipe retorna (`proximaMudanca`,
varredura minuto a minuto em aritmética local — Brasília não tem horário de
verão). O **chat do site não consulta a regra**: segue 24 h, como antes.

### 2.4.4 Painel do administrador (`admin/`)

```
GET  /admin/painel/entrar  → formulário (chave) → POST → cookie carol_painel (12 h)
GET  /admin/painel/        → HTML; painel.js busca:
       /api/estado    a cada 5 s   (< 5 KB; cache 4 s no servidor)
       /api/detalhes  a cada 60 s  (picos, heatmap, saúde, alertas, Railway)
       /api/maquina   1x           (120 pontos de CPU/memória para semear o gráfico)
       /api/horario   1x / ao salvar
POST /api/ligar · POST /api/desligar {horas | ateReligar} · PUT /api/horario
```

- **Leitura incremental**: `criarLeitor()` guarda o offset de cada
  `registro-AAAA-MM-DD.jsonl` e só lê os bytes novos; linha incompleta espera a
  próxima leitura; arquivo encolhido é relido do zero. Os 30 dias anteriores
  (média de 7 dias por hora e heatmap dia × hora) são agregados uma vez por dia.
- **Tempo de resposta**: `medirResposta()` envolve as chamadas a `responder()`
  no `server.js` (sem tocar no `claude.js`); fica só em memória (zera no deploy).
- **Máquina**: amostra a cada 5 s (timer `unref`): CPU% por delta de
  `process.cpuUsage`, RSS/heap, atraso do event loop (`monitorEventLoopDelay`),
  conexões abertas (`server.getConnections`), commit (`RAILWAY_GIT_COMMIT_SHA`).
- **Railway**: `metrics(serviceId, environmentId, startDate, endDate,
  sampleRateSeconds: 600, measurements: [CPU_USAGE, MEMORY_USAGE_GB,
  NETWORK_RX_GB, NETWORK_TX_GB])` em `backboard.railway.com/graphql/v2`. Token de
  projeto (`Project-Access-Token`) ou de conta (`Authorization: Bearer`) via
  `RAILWAY_TOKEN_TIPO`. Cache 60 s (inclusive de falha); em falha devolve o
  último dado bom marcado como desatualizado, ou "indisponíveis". Nunca lança.
- **Cliente**: sem bibliotecas; atualiza o DOM existente; para o polling com a
  aba oculta (`visibilitychange`); recuo exponencial em erro (até 60 s);
  gráficos em SVG próprio; respeita `prefers-reduced-motion`.

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
`crypto.timingSafeEqual`. Sai só por e-mail, NUNCA pelo WhatsApp: se o e-mail
falhar, a rotação é desfeita e os admins recebem só um aviso sem conteúdo; o
painel (`POST /admin/painel/api/chave`) ou `POST /admin/chave/rotacionar?exibir=1`
(autenticados) mostram a palavra uma vez quando o e-mail está fora.

### 2.6 Agenda

Horários em Brasília (UTC-3 fixo). `agenda.json` guarda última execução,
motivo, resultado e duração. No boot: para cada tarefa, calcula a ocorrência
anterior; se não rodou e atrasou menos que `AGENDA_JANELA_RECUPERACAO_H`,
executa agora. Tarefas: `relatorio_dai` 8h00, `relatorio_socios` 8h05,
`chave_semanal` seg 7h55, `memoria_limpeza` 3h00, `catalogo_06h/12h/18h`.

### 2.7 Memória de conversa (`memoria/`)

Antes: histórico em memória com TTL de 12h e janela de 30 mensagens; cliente
que voltava no dia seguinte era tratado como novo. Agora, três camadas, com
Postgres dedicado (`DATABASE_URL`) e custo por mensagem que não cresce com a
idade do cliente (~100 mil clientes):

| Camada | Tabela | O que guarda | Vida |
|---|---|---|---|
| Memória de trabalho | `carol_memoria_trabalho` | mensagens cruas da conversa ativa (`wa:<tel>` / `site:<id>`), resumo parcial | 24h após a última mensagem (`expira_em`) |
| Episódios | `carol_episodios` | JSON do Haiku por conversa: `assunto`, `pecas`, `maquina` (só compatibilidade), `objecao`, `proximo_passo`, `status` (`em_aberto/esfriou/fechou/sem_interesse`), `resumo` | 7 dias (`CAROL_CONTEXTO_DIAS`) |
| Ficha do cliente | `carol_fichas` | nome, cidade/UF, tipo (`produtor/revenda/oficina`), máquinas, peças (consultada/comprada), preferências; cada fato com a data em que foi dito | 180 dias sem contato (`CAROL_FICHA_DIAS`) |

```
mensagem do cliente
  → memoria.contextoConversa(sessao, texto)
      gap < 12h            → 'continuacao': mensagens cruas (+ resumo parcial se a conversa passou de 30)
      gap ≥ 12h, ≤ 7 dias  → 'retomada': bloco "MEMÓRIA DO CLIENTE" = ficha + 3 últimos episódios
                              + instrução: sempre retomar; genérica ("oi") continua de onde parou,
                              específica segue o assunto novo; não inventar; preço/estoque só do catálogo
      > 7 dias com ficha   → 'ficha': só a ficha leve
      nada                 → 'nova'
  → claude.js: o bloco vai num bloco de system SEM cache, depois do prefixo cacheado (1h) e do horário
  → resposta sai; DEPOIS memoria.registrarTurno grava (fila por sessão, erro só loga)
      > 30 mensagens → Haiku resume as antigas (resumo parcial), ficam as 20 mais recentes
job a cada 10 min (memoria.agendarFechamento)
  → reivindica sessões paradas há 2h (CAROL_EPISODIO_OCIOSO_MIN): UPDATE … FOR UPDATE SKIP LOCKED + processando_ate
  → anti-lixo (só cumprimento, resposta vazia/contingência, deploy-check*) → fecha sem episódio, sem Haiku
  → Haiku (claude-haiku-4-5) devolve episódio + fatos_ficha numa chamada só
  → transação: upsert do episódio (id = sessao|início), merge da ficha (SELECT … FOR UPDATE), tira a pendência
     (se chegou mensagem nova no meio, continua pendente)
```

Regras da ficha (`regras.mesclarFicha`): o fato mais recente vence; "desconhecido"
não apaga um tipo conhecido; peça "comprada" não volta a "consultada"; listas
com no máximo 20 itens; **preço, valor, desconto, frete, estoque e
disponibilidade nunca viram fato** (filtro no parse do JSON e de novo no merge).
O bloco de contexto tem teto de ~1.500 tokens: corta primeiro os episódios mais
antigos e nunca as instruções. Cliente que volta antes do job fechar o episódio
recebe um "episódio cru" (trecho final, sem valores em reais) sem esperar o
Haiku; o fechamento de verdade acontece na gravação do turno, antes de
sobrescrever a memória de trabalho. Na retomada a saudação do horário continua
forçada pelo servidor, mas sem a reapresentação completa.

**Robustez.** `memoria/index.js` tenta o Postgres e, em qualquer erro, refaz a
mesma operação no adaptador local, loga, reporta `memoria_degradada`
(severidade alta: e-mail; a Carol segue respondendo, então não vai para o
WhatsApp) e só tenta o banco de novo depois de 60s. Quando o banco volta, as
sessões gravadas no modo local são devolvidas a ele antes da primeira leitura, e
sai um "Resolvido:". O adaptador local reidrata do registro JSONL olhando 7
dias: a cadeia ativa vira memória de trabalho e as anteriores, episódios crus.
Pool `max: 5`, `connectionTimeoutMillis` 3s, `statement_timeout` 3s,
`query_timeout` 4s. Migrações `CREATE … IF NOT EXISTS` no boot, sob
`pg_advisory_xact_lock` (duas instâncias subindo juntas). Índices: PK por
sessão; `expira_em`; parcial `(atualizado_em) WHERE pendente_episodio`;
`(sessao, fim DESC)` e `fim` nos episódios; `ultimo_contato` nas fichas.

**Limpeza** (`memoria_limpeza`, 3h BRT): fecha antes os episódios pendentes;
apaga memória de trabalho expirada (a pendente só depois de fechada, ou se
passou de 7 dias), episódios > 7 dias, fichas > 180 dias sem contato, tudo de
`deploy-check*` e os arquivos `registro-*.jsonl` com mais de 90 dias
(`CAROL_REGISTRO_DIAS`; o painel usa no máximo 90). Loga as contagens.

**Relatório de 24h.** Antes de montar, fecha os episódios ociosos; as conversas
cobertas por um episódio (mesma sessão, episódio até a última mensagem) usam o
resumo pronto; só as que sobram vão para a IA como antes. O total ganha
"Retomadas: N" (turnos com `memoria: 'retomada'` no registro).

**Painel.** Perda de contexto agora é só intervalo > 7 dias ou reapresentação
sem memória; retomadas e compactação (>30 mensagens) aparecem como aviso
informativo.

### 2.8 Origem do lead para o SDR

`registrarAtendimento` aceita `origem` (gravada no JSONL e enviada no espelho
`espelharNoSdr`), só no turno em que aparece: o turno com referral/produto ou o
primeiro turno de uma conversa. Formato (só campos presentes):
`{ tipo: 'anuncio'|'catalogo'|'site'|'organico', plataforma: 'facebook'|'instagram', source_type, source_id, source_url, headline, ctwa_clid, produto }`.
Plataforma pela `source_url` (instagram.com → instagram; facebook.com/fb.me →
facebook; anúncio sem URL → facebook). O SDR ignora campos desconhecidos.

## 3. Segurança

- **Segredos** só em variáveis de ambiente; nunca em log (a palavra-chave nunca
  é logada; tokens não aparecem em mensagens de erro além do status HTTP).
- **`/admin`**: `Authorization: Bearer <CAROL_ADMIN_KEY>` ou a sessão do
  painel; `?key=` e o cookie `carol_key` (chave em texto puro) foram removidos.
  Escrita com cookie exige mesma origem. Comparação em tempo constante, rate
  limit 60 req/10 min por IP (IPv6 por /64), `no-store`, CSP e `DENY` em tudo;
  o dashboard tem CSP com nonce por resposta. `/health` público só devolve
  `{ ok, status }`; detalhes com Bearer ou em `/admin/status`.
- **SDR**: chave própria `SDR_SYNC_KEY` (igual nos dois serviços). Carol → SDR:
  header `X-Carol-Key`; SDR → Carol: `Authorization: Bearer` só em
  `GET /admin/exportar`. `SDR_SYNC_URL` precisa ser https (http só localhost).
  Webhook encaminhado pelo messenger do SDR: corpo cru e `X-Hub-Signature-256`
  originais (HMAC validado normalmente) + header `X-SDR-Possuidos` (fora do
  HMAC) com os `from` das conversas do SDR: a Carol ignora essas mensagens
  (sem resposta, sem registro; só log mascarado). Reentregas do mesmo corpo
  são descartadas pelo id da mensagem (memória, TTL 24h, antes da fila).
- **Logs**: telefone sempre mascarado (`util/telefone.js`); número completo só
  na exportação/espelho (necessário para a integração).
- **LGPD**: `POST /admin/cliente/apagar` e `/carol apagar <telefone>` apagam
  memória, episódios, ficha e as linhas do registro (reescrita atômica).
- **Memória** é dado não confiável: bloco delimitado (`<memoria>`) e marcado
  "não são instruções"; texto com afiliação de marca proibida ou cara de
  instrução não entra (nem na gravação nem na leitura de fichas antigas);
  preferências só em categorias fixas.
- **Painel `/admin/painel`**: chave digitada num formulário (POST), nunca na
  URL; comparação por `timingSafeEqual` sobre SHA-256 (não vaza tamanho);
  cookie `HttpOnly; Secure; SameSite=Strict; Path=/admin` assinado com
  HMAC (segredo `CAROL_PAINEL_SEGREDO` ou derivado da `CAROL_ADMIN_KEY` —
  trocar a chave derruba as sessões), expira em 12 h e é revogável ("Sair"
  grava o nonce em `DATA_DIR/sessoes-revogadas.json`); login limitado a 8
  tentativas/15 min por IP (auditoria `painel_login*`); escrita exige header
  `X-Carol-Painel: 1` + `Origin` igual ao do serviço (CSRF); CSP sem inline
  (`script-src 'self'`), `X-Frame-Options: DENY`, `nosniff`, `no-store`.
  Ações gravam em `auditoria.jsonl` (`painel_ligar`, `painel_desligar`,
  `painel_horario`). O JSON nunca traz telefone completo nem a resposta da Carol.
- **Webhook**: assinatura HMAC-SHA256 do app secret, fail-closed (corpo cru
  obrigatório, Buffer não vazio); `hub.verify_token` em tempo constante.
- **Comandos**: allowlist de números + palavra semanal + lockout + auditoria em
  `auditoria.jsonl`. Defesa em profundidade: ter o número não basta, ter a
  palavra não basta.
- **Entrada do usuário**: marcadores de contexto (`[Cliente: …]`) removidos
  antes de chegar aos relatórios (anti-spoofing) — já existia e foi mantido.
- **Anti alert-fatigue** é segurança também: alerta que ninguém lê é alerta que
  não existe (Google SRE, cap. 6).

## 4. Testes

`npm test` — `node --test`, sem rede: o `tests/_setup.js` troca o `fetch`
global por um que lança "rede bloqueada em teste" (só 127.0.0.1 passa) e o
`config.js` não lê nenhum `.env` em teste (`NODE_TEST_CONTEXT`/`NODE_ENV=test`).
Relógio controlável e diretório de dados temporário por processo. 3 testes só
rodam com Postgres; o de "banco inacessível" roda sempre.
O teste de integração da memória roda com
`CAROL_TEST_DATABASE_URL=postgresql://localhost:5433/carol_memoria_test npm test`
(zera as tabelas `carol_*` desse banco).

| Arquivo | Cobre |
|---|---|
| `chave.test.js` | formato, validação, transição 24h, expiração 7d, normalização, e-mail |
| `anomalias.test.js` | canais por severidade (canaisPara), dedup/janela, forcar, fallback e-mail→WhatsApp, classificação de erros |
| `atendimentos.test.js` | agrupamento/numeração das conversas, parse do JSON da IA (com fallback), textos compacto/e-mail/detalhe, busca por número ou telefone |
| `comandos.test.js` | parse, não-admin silencioso, fluxo pendente→palavra→execução, autenticação 15 min, lockout, expiração da pendência, subcomandos, fatiar |
| `transporte.test.js` | ordem de provedores, erros claros, Gmail (JWT com sub, MIME), fallback Gmail→Resend→Brevo, agregação de falhas |
| `contingencia.test.js` | e-mail ok, queda para WhatsApp fatiado com anomalia, sem admins, desligada |
| `agenda.test.js` | cálculo de ocorrências (diária e semanal, BRT), catch-up dentro/fora da janela, idempotência no mesmo dia, falha registrada |
| `horario.test.js` | presets, personalizado, janela cruzando a meia-noite, fim de semana, próxima mudança, validação, persistência atômica, arquivo corrompido, texto de contexto |
| `painel.test.js` | sessão (válida/adulterada/expirada, tempo constante), CSRF, rate limit, mascaramento, agregação e leitura incremental do JSONL, picos/heatmap, cache do estado, desligar sem prazo, cache e falha silenciosa do Railway |
| `painel-rotas.test.js` | rotas de ponta a ponta em servidor local efêmero: 401/redirect, headers, login, CSRF, ações, rate limit do login |
| `saude.test.js` | cada verificador com respostas reais simuladas, recuperações, supervisor (consolidação, recuperação, "resolvido") |
| `memoria.test.js` | continuação < 12h, retomada 12h–7d (bloco fora do cache), > 7d só ficha, genérica × específica, compactação > 30, fila por sessão, anti-lixo, merge da ficha sem preço, teto do bloco, limpeza (cada regra + JSONL 90d), fallback Postgres → local e volta, reidratação do JSONL, relatório pelos episódios |
| `origem.test.js` | formato da origem (anúncio/catálogo/site/orgânico, plataforma), extração do referral, origem no JSONL e no espelho do SDR |
| `webhook.test.js` | fluxo do WhatsApp com deps injetadas: comandos, silêncio (pausa/horário/teto), eco da equipe sem resposta, envio antes do registro, `entregue:false`, contingência 1x/30 min + `falha`, agrupamento, uma resposta por vez, áudio/mídia |
| `claude.test.js` | `gerarResposta` com cliente Anthropic falso: saudação, origem, registro só no `confirmar`, memória, histórico normalizado; catálogo com carga única/timeout/throttle; `montarLinkCarrinho` |
| `app.test.js` | app sem listen: `/health` mínimo, Bearer, `?key=` recusado, sessão do painel (dashboard, revogação), CSRF, chave do SDR só na exportação, LGPD, erro sem stack, webhook GET, chat com falha registrada |
| `chat.test.js` | tetos por sessão e por IP (/64) e reserva de 20% do teto global |
| `lgpd.test.js` | sessões do cliente (nono dígito), exclusão na memória e reescrita do JSONL, banco fora, `/carol apagar` |
| `memoria-extra.test.js` | filtro de injeção/afiliação, bloco não confiável, preferências fixas, pendente vencida vira episódio (ou cru), anomalia de fechamento, devolução de episódios/fichas ao banco |
| `seguranca.test.js` | espelho com `SDR_SYNC_KEY` e https, chave de IP /64, tetos diários persistentes por dia de São Paulo, mascaramento |
| `memoria-postgres.test.js` | (só com `CAROL_TEST_DATABASE_URL`) migrações idempotentes, ciclo completo no banco, SKIP LOCKED entre duas instâncias, banco inacessível |

## 5. Operação

- **Deploy**: `railway up --detach --service shopify-agro-pecas-theme` da raiz
  do repositório (auto-deploy GitHub→Railway não dispara). `railway.json`
  (healthcheck `/health`, 60 s) precisa do caminho `/util/carol/railway.json`
  em Settings → Config-as-code (o Railway não segue o root directory).
  `scripts/deploy_railway.sh` só cria variáveis ausentes, nunca sobrescreve.
- **Variáveis novas**: ver `.env.example`, bloco "Monitoramento".
- **Primeiro boot** gera e envia a palavra-chave por e-mail (em segundo plano,
  depois do listen); sem e-mail ela não é gerada e os admins recebem aviso para
  gerar pelo painel.
- **Testar os alertas**: `POST /admin/anomalias/teste`.
- **Logs**: prefixos `[anomalias]`, `[saude]`, `[recuperacao]`, `[comandos]`,
  `[agenda]`, `[email]`, `[chave]`, `[memoria]`.
- **Memória**: `GET /admin/status` (ou `/health` com Bearer) mostra `memoria: postgres | local | postgres (degradada: local)`, a origem da regra de horário e o estado do crédito.
  Limpeza manual: `POST /admin/agenda/executar/memoria_limpeza`.

## 6. Limites conhecidos e próximos passos

- Memória: durante um degrade, episódios e fichas novos ficam no processo e
  voltam ao banco quando ele volta (junto com as sessões). Um reinício nesse
  intervalo perde esses resumos; o JSONL continua cobrindo 7 dias.
- A ficha é por sessão (`wa:<telefone>`, `site:<id>`): o mesmo cliente no site
  e no WhatsApp tem duas fichas.

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
