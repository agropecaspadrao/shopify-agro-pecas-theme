# Carol — Manual para os sócios

> Como a Carol cuida da operação sozinha, o que ela manda por e-mail, o que
> fazer quando chegar um "Urgente Carol" e como usar os comandos pelo WhatsApp.

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

**Por segurança, a palavra nova vai por e-mail.** Só cai para o WhatsApp dos
administradores se o e-mail estiver fora do ar (a mensagem vem marcada como
"contingência") — do contrário os comandos ficariam mortos até o e-mail voltar.

---

## 3. Comandos pelo WhatsApp

Funcionam **só para os números cadastrados como administradores**. Qualquer
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
| `/carol status` | Até quando vale a palavra atual e quem está autenticado |
| `/carol ajuda` | Esta lista |

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
  distração, é só esperar. Se não foi você, rotacione a palavra pelo painel.
- A palavra digitada aceita maiúsculas, espaços e acento por engano
  (`Agro Trator 42` funciona), mas não aceita errado.
- Todas as tentativas, certas e erradas, ficam registradas com número e horário.

---

## 4. O que fazer quando chegar cada alerta

| Assunto do e-mail | O que significa | O que fazer |
|---|---|---|
| **WhatsApp parou de responder (token inválido)** | A senha de acesso ao WhatsApp expirou. Clientes escrevem e ninguém responde | Se houver token reserva, a Carol já trocou sozinha e o e-mail diz "Recuperação automática". Se não, gerar token permanente no Meta Business e atualizar `WA_ACCESS_TOKEN` no Railway |
| **Token do WhatsApp expira em breve** | Vai expirar em menos de 7 dias | Trocar antes. Prefira token permanente (Usuário do Sistema) |
| **Crédito da Anthropic acabou** | A IA parou. Carol não responde ninguém | Recarregar em console.anthropic.com > Plans & Billing. Depois atualizar `CAROL_CREDITO_USD` e `CAROL_CREDITO_DESDE` |
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

## 5. Painel administrativo

Com a chave de administrador (`CAROL_ADMIN_KEY`), no endereço do serviço:

| Endereço | Mostra |
|---|---|
| `/admin/dashboard` | Painel visual de custos e conversas (já existia) |
| `/admin/saude` | Último quadro de saúde, recursos configurados e agenda |
| `/admin/anomalias?horas=24` | Histórico de anomalias, incluindo as suprimidas por deduplicação |
| `/admin/agenda` | Cada rotina, última execução e próxima prevista |
| `/admin/chave` | Até quando vale a palavra-chave atual |
| `/admin/relatorio-socios` | Prévia do relatório executivo sem enviar |

E ações (POST): `/admin/saude` (verificar agora), `/admin/anomalias/teste`
(testa se os alertas chegam), `/admin/chave/rotacionar`, `/admin/relatorio-socios`
(enviar agora), `/admin/agenda/executar/<nome>`.

---

## 6. O que precisa estar configurado

Sem estas variáveis no Railway, a função correspondente fica desligada — a
Carol avisa no boot e na seção "Sistemas" do relatório, mas continua atendendo
normalmente.

| Variável | Para quê | Sem ela |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` + `GMAIL_SENDER` | Todo e-mail pela Gmail API da empresa **e** "quem editou a planilha master" | **Nenhum e-mail sai** (o Railway bloqueia SMTP). Relatórios e palavra-chave caem para o WhatsApp dos administradores (contingência) |
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
| Testar: `POST /admin/anomalias/teste` → e-mail em admin@ e socios@ | depois dos passos acima |

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
endereço `/health` responde em qualquer navegador e diz se ela está no ar.

**Posso pedir o relatório pelo WhatsApp em vez de esperar o e-mail?**
Sim: `/carol` + palavra-chave. Ele vem em partes numeradas se for longo.

**A palavra-chave é segura?**
Ela só existe em texto claro no e-mail. No servidor fica um hash (não dá para
recuperar a palavra a partir dele). Três erros bloqueiam. E ela troca toda
semana sozinha.

**Quem vê as conversas dos clientes?**
Só quem tem a chave de administrador (painel) ou é administrador cadastrado no
WhatsApp e sabe a palavra da semana. O resumo por e-mail vai só para os
destinatários configurados.
