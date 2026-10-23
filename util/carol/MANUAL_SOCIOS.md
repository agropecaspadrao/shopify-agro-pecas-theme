# Carol — Manual para os sócios

> Como a Carol cuida da operação sozinha, o que ela manda por e-mail, o que
> fazer quando chegar um "Urgente Carol", onde administrar (SDR → seção Carol)
> e como usar os comandos de emergência pelo WhatsApp.
>
> **Onde administrar a Carol:** no **SDR comercial, seção Carol**
> (`https://sdr-backend-production.up.railway.app/sdr/admin/carol`). O antigo
> painel próprio da Carol (`/admin/painel`) e o dashboard (`/admin/dashboard`)
> foram desligados: quem abrir esses endereços é levado para o SDR. Os
> comandos `/carol` pelo WhatsApp continuam, como **acesso de emergência**
> (quando o SDR estiver fora do ar ou você longe do computador).

---

## 1. O que a Carol faz agora, além de atender

Até hoje a Carol era a atendente: respondia clientes no WhatsApp fora do horário
comercial e no chat do site. A partir desta versão ela também é o **agente de
operação** da loja. Isso significa quatro coisas:

| Ela faz | Como | Quando |
|---|---|---|
| **Vigia os sistemas** | Testa WhatsApp, IA, e-mail, catálogo, loja, planilha, Meta e Google | A cada 30 minutos, 24h por dia |
| **Se recupera sozinha** | Troca token do WhatsApp por um reserva, recarrega o catálogo, refaz uma tarefa perdida | No momento em que detecta |
| **Avisa quando algo dá errado** | E-mail "Urgente Carol"; WhatsApp dos administradores só no que é crítico | Na hora, sem repetir o mesmo aviso a cada minuto |
| **Reporta todo dia** | Um único e-mail: o relatório executivo, com atendimentos, avisos menores, campanhas, custos e saúde | 8h05 da manhã, de segunda a domingo |

Nada disso usa inteligência artificial para decidir. As verificações, os alertas
e os comandos são regras fixas e testadas: a IA entra só para resumir as
conversas dos clientes em português legível.

---

## 2. Os e-mails que você vai receber

Regra geral, pedida pelos sócios em 16/09/2026: **pouca mensagem**. Um e-mail
por dia com tudo; alerta na hora só para o que precisa de ação; WhatsApp só
para o crítico. O resumo da Dai (atendimentos) vai dentro do executivo, uma
linha por conversa. Quem quiser ler as mensagens de uma conversa usa
`/carol detalhe <número>` pelo WhatsApp (seção 3).

### 2.1 Relatório executivo diário — 8h05

Assunto: **`Carol: relatório executivo DD/MM (TUDO OK | ATENÇÃO | FALHA EM SISTEMA)`**

O status já vem no assunto. Se estiver **TUDO OK**, dá para arquivar sem abrir.
Se estiver **ATENÇÃO** ou **FALHA**, a primeira seção diz exatamente o quê.

Seções, na ordem de importância:

1. **Assuntos críticos** — o que exige ação hoje, com a instrução do que fazer; embaixo, os **avisos menores** das últimas 24h (que não geram e-mail na hora) e o que foi **resolvido**
2. **Atendimentos das últimas 24h** — quantas conversas, quantas vieram de anúncio, as pendências da Dai e **uma linha por conversa** (cliente, peça, onde parou, ação). As mensagens completas ficam no `/carol detalhe <número>`
3. **Campanhas** — investimento, cliques, conversas de WhatsApp e leads de ontem e da semana, campanha por campanha
4. **Custos da Carol** — quanto gastou de IA, projeção do mês, saldo restante e para quantos dias dá
5. **Inventário e planilha** — quantos produtos publicados, quantos sem estoque, quando foi a última edição na loja e **quem editou a planilha master por último**
6. **Sistemas** — o quadro de saúde, item por item
7. **Rotinas automáticas** — se os relatórios e a rotação de senha rodaram no horário

### 2.2 Alertas — "Urgente Carol"

Assunto: **`Urgente Carol: <o que aconteceu>`**

Chega **na hora** em que a Carol detecta um problema grave (gravidade crítica ou
alta). Só as **críticas** (WhatsApp mudo, IA sem crédito, disco cheio) também
vão pelo WhatsApp dos administradores. Cada e-mail traz:

- **O que aconteceu** — em português, sem jargão
- **Gravidade** — crítica ou alta
- **O que fazer** — a instrução concreta, sempre
- **Detalhe técnico** — para quem for resolver

A mesma anomalia **não se repete** por e-mail antes de passar a janela dela
(1 hora para crítica, 6 horas para alta). Se o problema continua, você recebe
um lembrete quando a janela vence — não um e-mail por minuto.

Quando o problema se resolve, chega um e-mail com assunto começando por
**"Resolvido:"**, para ninguém ficar procurando.

Avisos de menor gravidade (por exemplo, "e-mail falhou uma vez", "planilha sem
edição há 30 dias", "saldo baixo") **não chegam na hora**: ficam registrados e
aparecem na seção 1 do relatório executivo do dia seguinte.

### 2.3 Palavra-chave da semana — toda segunda, 7h55

Assunto: **`Carol: palavra-chave da semana`**

É a senha para usar os comandos pelo WhatsApp (seção 3). Formato `agro-palavra-NN`,
por exemplo `agro-trator-42`. Vale por 7 dias; a da semana anterior continua
aceita por 24 horas na virada, para ninguém ficar travado na segunda de manhã.

**Por segurança, a palavra nova vai só por e-mail e NUNCA pelo WhatsApp** (o
WhatsApp é justamente o canal que ela protege). Se o e-mail estiver fora do ar,
a troca é cancelada (a palavra atual continua valendo) e os administradores
recebem no WhatsApp só um aviso, sem a palavra. Para gerar uma nova nesse caso,
use o SDR (seção **Carol**, **Palavra-chave**): ela aparece na tela uma única vez.

---

## 3. Comandos pelo WhatsApp (acesso de emergência)

O lugar principal para administrar a Carol é o **SDR, seção Carol** (seção 5).
Os comandos abaixo continuam funcionando para quando o SDR estiver fora do ar
ou você estiver só com o celular. Funcionam **só para os números cadastrados como administradores**. Qualquer
outro número que mande `/carol` é ignorado em silêncio — a Carol nem confirma
que o comando existe.

Mande pelo WhatsApp da loja **(41) 98415-1085**, a qualquer hora, inclusive no
horário comercial:

| Comando | O que acontece |
|---|---|
| `/carol` | Lista dos atendimentos das últimas 24 horas, uma linha por conversa (numerada) |
| `/carol detalhe 3` | Todas as mensagens da conversa número 3 da lista. Também aceita o telefone: `/carol detalhe 5541999990001` |
| `/carol saude` | Situação de cada sistema (WhatsApp, IA, e-mail, loja, planilha, Meta, Google) |
| `/carol socios` | Dispara o relatório executivo por e-mail agora, sem esperar as 8h05 |
| `/carol chave` | Gera uma palavra-chave nova e envia por e-mail (use se suspeitar que vazou) |
| `/carol status` | Até quando vale a palavra atual, quem está autenticado e se há pausa ativa |
| `/carol pausar` | A Carol **para de responder clientes no WhatsApp por 2 horas** e volta sozinha. `/carol pausar 4` = 4 horas (mínimo 30 min, máximo 12 h). Mandar de novo renova o prazo. Para desligar por mais tempo ou "até eu religar", use o SDR → Carol (seção 5) |
| `/carol voltar` | Encerra a pausa antes da hora |
| `/carol apagar 5541999990001` | **LGPD:** apaga todos os dados daquele cliente (memória, ficha, histórico das conversas no registro) e responde com as contagens. Não tem volta. Use quando o cliente pedir a exclusão |
| `/carol ajuda` | Esta lista (e o link da seção Carol no SDR) |

### Pausar a Carol para atender pessoalmente

Quando um sócio quer assumir o WhatsApp fora do horário comercial (ou a Dai
fica até mais tarde), manda `/carol pausar`. Durante a pausa:

- A Carol **não responde nenhum cliente** no WhatsApp. Quem escrever fica
  esperando a equipe pelo aplicativo, como no horário comercial.
- Os comandos `/carol` continuam funcionando (inclusive `/carol voltar`).
- O chat do site continua normal (lá não há atendente humano).
- A pausa sobrevive a reinício do serviço e vale para todos os sócios: quem
  pausou aparece no `/carol status`.
- Passado o prazo, ela volta sozinha. Ninguém precisa lembrar de religar.

```
Você:   /carol pausar
Carol:  Qual e a palavra-chave desta semana?
Você:   agro-trator-42
Carol:  Carol pausada no WhatsApp ate as 20:30 (2 horas).
        Ate la ela nao responde clientes no WhatsApp: quem escrever fica esperando a equipe no aplicativo. O chat do site continua normal.
        Ela volta sozinha no horario. Para voltar antes, mande /carol voltar.
...
Você:   /carol voltar
Carol:  Carol de volta ao atendimento no WhatsApp.
```

### Como funciona a conversa

```
Você:   /carol
Carol:  Qual e a palavra-chave desta semana?
Você:   agro-trator-42
Carol:  Atendimentos das ultimas 24h (16/09/2026)
        4 conversas, 11 mensagens.
        1. João (WhatsApp 5541999990001), via anúncio: bomba Valtra BH180. Aguarda orçamento. Ação: enviar orçamento
        2. WhatsApp 5554999990002: dedo de plataforma. Perguntou o modelo.
        ...
Você:   /carol detalhe 1
Carol:  Conversa 1: WhatsApp 5541999990001
        [09:00] Cliente: quero uma bomba
        Carol: Qual máquina?
        ...
```

Depois de acertar a palavra, você fica **autenticado por 15 minutos** — os
próximos comandos não pedem a palavra de novo.

### Proteções

- **Três erros em uma hora bloqueiam o número por uma hora** e disparam um
  alerta "Urgente Carol: tentativas repetidas" por e-mail. Se você errou por
  distração, é só esperar. Se não foi você, rotacione a palavra pelo SDR (seção Carol).
- A palavra digitada aceita maiúsculas, espaços e acento por engano
  (`Agro Trator 42` funciona), mas não aceita errado.
- Todas as tentativas, certas e erradas, ficam registradas com número e horário.

---

## 4. O que fazer quando chegar cada alerta

| Assunto do e-mail | O que significa | O que fazer |
|---|---|---|
| **WhatsApp parou de responder (token inválido)** | A senha de acesso ao WhatsApp expirou. Clientes escrevem e ninguém responde | Se houver token reserva, a Carol já trocou sozinha e o e-mail diz "Recuperação automática". Se não, gerar token permanente no Meta Business e atualizar `WA_ACCESS_TOKEN` no Railway |
| **Token do WhatsApp expira em breve** | Vai expirar em menos de 7 dias | Trocar antes. Prefira token permanente (Usuário do Sistema) |
| **Crédito da Anthropic acabou** | A IA parou. Carol não responde ninguém | Recarregar em console.anthropic.com > Plans & Billing. Depois informar o saldo do console no SDR → Carol → **Custos e saldo** (ou `/carol saldo <valor>`) |
| **Saldo de créditos baixo** (só no relatório) | Falta menos de US$ 0,50 | Recarregar antes que zere. O saldo é estimado pelo uso registrado desde `CAROL_CREDITO_DESDE`; depois de recarregar, atualizar `CAROL_CREDITO_USD` com o saldo do console e `CAROL_CREDITO_DESDE` com a data, senão o aviso fica errado |
| **Chave da API da Anthropic recusada** | A senha da IA está errada ou foi revogada | Conferir `ANTHROPIC_API_KEY` no Railway |
| **Catálogo da loja não carregou** | O site não respondeu. A Carol segue com a última cópia | Conferir se agropecaspadrao.com.br está no ar |
| **Token da Meta inválido** | Campanhas e validade da Meta não podem ser lidas | Gerar novo token no Meta Business |
| **Acesso ao Google Ads expirou** | O refresh token foi revogado | Refazer a autorização OAuth do Google Ads |
| **Envio de e-mail falhou** (só no relatório) | O Google recusou o envio | Conferir a delegação da conta de serviço em admin.google.com (escopo gmail.send) |
| **Tentativas repetidas com palavra errada** | Alguém errou 3 vezes | Se não foi um sócio, rotacionar a palavra |
| **Tarefa agendada rodou com atraso** | O serviço estava fora do ar no horário; a Carol rodou assim que voltou | Nada. É informativo |
| **A Carol se recuperou sozinha** | Um problema aconteceu e ela resolveu | Ler o detalhe e corrigir a causa em definitivo (ex.: trocar o token principal) |

---

## 5. Administração no SDR (seção Carol) e endereços técnicos

### 5.1 SDR → seção Carol

Toda a administração da Carol fica no **SDR comercial**, o portal único da
operação: entre no SDR com o seu login e abra a seção **Carol**
(`https://sdr-backend-production.up.railway.app/sdr/admin/carol`). Não existe
mais login nem chave para digitar: o SDR conversa com a Carol por trás, com a
chave de administrador guardada no servidor. Cada ação feita lá (ligar,
desligar, mudar horário, informar saldo, apagar cliente...) fica registrada na
auditoria da Carol **com o seu login do SDR**.

O que você vê e faz:

| Bloco | Para que serve |
|---|---|
| **Agora a Carol está** | ATENDENDO, EM SILÊNCIO (Dai) (horário da equipe), FORA DO HORÁRIO (ninguém atende: fora da regra da Carol e fora do expediente) ou DESLIGADA, e a próxima mudança ("volta a atender hoje às 18:00"). Mostra também a **origem da regra**: "padrão do servidor" (variáveis `CAROL_24H` / `CAROL_HORA_*`) ou "definida no SDR" (aí as variáveis não têm efeito) |
| **Ligar / Desligar** | Desligar por algumas horas (até 3 dias) ou **até eu religar**; "Ligar" religa na hora. É a mesma pausa do `/carol pausar` / `/carol voltar` |
| **Atendimento hoje** | Conversas ativas, mensagens e clientes do dia, tempo médio de resposta, erros, **sem resposta da Carol hoje** (a equipe precisa responder) e o uso dos tetos diários |
| **Picos, máquina e Railway** | Mensagens por hora hoje × média de 7 dias, mapa dia × hora de 30 dias, processador/memória do serviço e, com `RAILWAY_API_TOKEN`, as últimas 24 h do Railway |
| **Saúde e alertas** | Último quadro das verificações automáticas (com botão para verificar agora), alertas abertos e o histórico; teste do canal de alertas |
| **Horário de atendimento no WhatsApp** | **24 horas**, **só fora do expediente**, **só no expediente** ou **personalizado**, e o expediente da equipe (Dai). Vale na hora; **Voltar ao padrão do servidor** apaga a regra salva |
| **Custos e saldo** | Gasto do período (1, 7, 30 ou 90 dias), projeção do mês, saldo estimado do crédito da Anthropic e se o crédito zerou. Depois de recarregar, informe ali o saldo do console (equivale ao `/carol saldo 25`) |
| **Rotinas** | Cada tarefa automática, última e próxima execução, com botão para rodar agora |
| **Relatórios** | Prévia e envio imediato do relatório da Dai e do executivo dos sócios |
| **Palavra-chave dos comandos** | Gera uma palavra nova e manda por e-mail; se o e-mail estiver fora, mostra na tela uma única vez |
| **LGPD** | Apagar todos os dados de um cliente pelo telefone (ver 5.3) |

O chat do site continua 24 horas, qualquer que seja o horário escolhido — a
regra vale só para o WhatsApp.

### 5.2 Endereços técnicos (para quem usa curl ou scripts)

A seção Carol do SDR usa a API `/admin/api/*` da Carol, sempre com o header
`Authorization: Bearer <CAROL_ADMIN_KEY>` (a chave **nunca** vai na URL e não
há mais login por navegador). Os principais:

| Endereço | Mostra / faz |
|---|---|
| `GET /admin/api/resumo` | Resumo rápido: estado, atendimento do dia, saúde, alertas abertos, saldo |
| `GET /admin/api/estado` · `/detalhes` | Estado completo · picos, mapa, saúde e Railway |
| `GET/PUT/DELETE /admin/api/horario` | Regra de horário (ler, salvar, voltar ao padrão) |
| `POST /admin/api/ligar` · `/desligar` | Religar · desligar (`{"horas":4}` ou `{"ateReligar":true}`) |
| `GET /admin/api/saude` · `POST /admin/api/saude/verificar` | Último quadro de saúde · verificar agora |
| `GET /admin/api/anomalias` · `POST /admin/api/anomalias/teste` | Alertas · testar se os alertas chegam |
| `GET /admin/api/agenda` · `POST /admin/api/agenda/executar/<nome>` | Rotinas · rodar uma agora |
| `GET /admin/api/custos?dias=7` · `POST /admin/api/saldo` | Custos · informar o saldo do console (`{"usd":25}`) |
| `POST /admin/api/chave/rotacionar` | Nova palavra-chave |
| `POST /admin/api/cliente/apagar` | LGPD (ver 5.3) |
| `GET/POST /admin/api/relatorio` · `/relatorio-socios` | Prévia / enviar agora |
| `GET /admin/api/auditoria?linhas=100` | Quem fez o quê (comandos `/carol` e ações pelo SDR, com o login) |

As rotas antigas (`/admin/status`, `/admin/saude`, `/admin/pausa`,
`/admin/auditoria` etc.) continuam respondendo com o mesmo header, para scripts.
`/admin/painel` e `/admin/dashboard` só levam para o SDR.

### 5.3 Pedido de exclusão de dados (LGPD)

Quando um cliente pedir que apaguem os dados dele:

- pelo WhatsApp (emergência): `/carol apagar <telefone com DDD>` (ex.: `/carol apagar 5541999990001`);
- pelo SDR: seção Carol → **LGPD**;
- ou por curl: `POST /admin/api/cliente/apagar` com `Authorization: Bearer <CAROL_ADMIN_KEY>` e corpo `{"telefone":"5541999990001"}` (para o chat do site: `{"sessao":"site:..."}`).

A Carol apaga a memória da conversa, os resumos (episódios) e a ficha do
cliente (no banco e na memória local) e reescreve o registro das conversas sem
as linhas dele (as duas formas do número, com e sem o nono dígito). A resposta
traz quantas linhas e itens foram apagados; tudo fica na auditoria (com o
telefone mascarado). Se o banco estiver fora do ar, a resposta avisa para
repetir depois. Atenção: o histórico espelhado no SDR comercial é apagado lá,
pela tela de conversas do SDR.

### 5.4 Quando a IA fica fora (crédito zerado, chave recusada)

O cliente do WhatsApp não fica mais sem resposta e sem registro: ele recebe
"Recebi sua mensagem. Nossa equipe vai te responder em seguida." (ou "a partir
de amanhã às 08:00", conforme o expediente; no máximo uma vez a cada 30 minutos
por cliente), a conversa fica marcada como **pendente** no relatório da Dai e
no SDR, e chega o alerta "Urgente Carol: Crédito da Anthropic acabou".
Mensagens recebidas no horário da equipe, na pausa ou acima do teto diário
também ficam registradas como pendentes, e as respostas que a Dai digita no app
entram no histórico para a Carol saber o que foi combinado.

---

## 6. O que precisa estar configurado

Sem estas variáveis no Railway, a função correspondente fica desligada — a
Carol avisa no boot e na seção "Sistemas" do relatório, mas continua atendendo
normalmente.

| Variável | Para quê | Sem ela |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` + `GMAIL_SENDER` | Todo e-mail pela Gmail API da empresa **e** "quem editou a planilha master" | **Nenhum e-mail sai** (o Railway bloqueia SMTP). Relatórios caem para o WhatsApp dos administradores (contingência); a palavra-chave nova só pelo SDR (seção Carol) |
| `RESEND_API_KEY` ou `BREVO_API_KEY` | Alternativa de e-mail por terceiro | Opcional se o Gmail estiver ligado |
| `CAROL_ADMINS` | Números que podem usar `/carol` e recebem alertas e contingências por WhatsApp | Comandos desligados; sem contingência |
| `WA_ACCESS_TOKEN_FALLBACK` | Token reserva do WhatsApp | Sem auto-recovery de token; só alerta |
| `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` | Bloco de campanhas e validade da Meta | Seção 3 do relatório diz "não configurado" |

### E-mail pela própria empresa (Gmail API + conta de serviço) — caminho preferido

Sai pelo Google Workspace da APP, sem provedor terceiro e sem mexer em DNS. A
mesma chave também lê a planilha master. Estado em 15/09/2026:

| Passo | Status |
|---|---|
| Conta de serviço `carol-monitor@gen-lang-client-0608451405.iam.gserviceaccount.com` criada, Gmail API e Drive API habilitadas | feito |
| Planilha master compartilhada com a conta de serviço como Leitor | feito |
| **Gerar a chave JSON** (só o dono do projeto pode): `gcloud iam service-accounts keys create ~/carol-monitor-key.json --iam-account carol-monitor@gen-lang-client-0608451405.iam.gserviceaccount.com --project gen-lang-client-0608451405` | **você** |
| **Autorizar a delegação no Workspace**: admin.google.com → Segurança → Controle de acesso e dados → Controles de API → **Delegação em todo o domínio** → Adicionar novo → ID do cliente `102179036680809640401` → escopo `https://www.googleapis.com/auth/gmail.send` → Autorizar | **você** (1 minuto) |
| Colar o JSON da chave em `GOOGLE_SERVICE_ACCOUNT_JSON` no Railway (ou me passar o caminho do arquivo que eu subo) | você ou eu |
| `GMAIL_SENDER=admin@agropecaspadrao.com.br` (o remetente precisa ser um usuário real do Workspace; o nome exibido é "Carol - Agro Peças Padrão") | feito |
| Testar: SDR → Carol → testar alertas (ou `POST /admin/api/anomalias/teste`) → e-mail em admin@ e socios@ | depois dos passos acima |

### Alternativa: Resend (terceiro, 5 minutos)

1. Criar conta em resend.com com admin@agropecaspadrao.com.br
2. **Domains → Add domain → agropecaspadrao.com.br** e adicionar os registros DNS (SPF e DKIM) na Cloudflare
3. **API Keys → Create** → `RESEND_API_KEY` no Railway e `EMAIL_FROM=carol@agropecaspadrao.com.br`

### Token reserva do WhatsApp (auto-recovery)

Meta Business → Configurações da empresa → Usuários → **Usuários do sistema** →
Adicionar (nome `carol-reserva`, função Administrador) → Atribuir ativos:
o app da Carol e a conta do WhatsApp → **Gerar token** com
`whatsapp_business_messaging` e `whatsapp_business_management`, validade
**Nunca**. Colar em `WA_ACCESS_TOKEN_FALLBACK` no Railway. Precisa ser
diferente do token principal.

---

## 7. Perguntas frequentes

**Vou receber e-mail todo dia mesmo sem nada acontecer?**
Sim, o relatório das 8h05. O assunto diz TUDO OK — dá para arquivar sem abrir.
Alertas "Urgente Carol" só chegam quando há problema.

**E se o e-mail cair?**
Os alertas vão também pelo WhatsApp dos administradores. E o próprio "e-mail
caiu" vira uma anomalia registrada, que aparece no relatório seguinte.

**E se a Carol inteira cair?**
Aí ela não consegue avisar. Por isso o relatório diário existe: se um dia
**não chegar** o e-mail das 8h05, é sinal de que o serviço está fora. O
endereço `/health` responde em qualquer navegador e diz se ela está no ar
(só "ok"; os detalhes ficam no SDR, seção Carol).

**Posso pedir o relatório pelo WhatsApp em vez de esperar o e-mail?**
Sim: `/carol` + palavra-chave. Ele vem em partes numeradas se for longo.

**A palavra-chave é segura?**
Ela só existe em texto claro no e-mail. No servidor fica um hash (não dá para
recuperar a palavra a partir dele). Três erros bloqueiam. E ela troca toda
semana sozinha.

**Mandei `/carol` e a Carol me respondeu como se eu fosse cliente. Por quê?**
Até 16/09/2026, números de celular antigos (cadastrados no WhatsApp antes do
nono dígito) chegavam para a Carol com 12 dígitos, e o cadastro de
administradores tem 13. Ela não reconhecia o sócio e o atendia como cliente.
Corrigido: agora os dois formatos valem. Se ainda acontecer, o número não está
em `CAROL_ADMINS` (ou está com um dígito errado): confira a auditoria no SDR (seção Carol) ou em `/admin/api/auditoria`,
que mostra o número exato que tentou o comando.

**Quem vê as conversas dos clientes?**
Só quem tem acesso à seção Carol do SDR ou é administrador cadastrado no
WhatsApp e sabe a palavra da semana. O resumo por e-mail vai só para os
destinatários configurados.
