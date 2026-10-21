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

**Por segurança, a palavra nova vai só por e-mail e NUNCA pelo WhatsApp** (o
WhatsApp é justamente o canal que ela protege). Se o e-mail estiver fora do ar,
a troca é cancelada (a palavra atual continua valendo) e os administradores
recebem no WhatsApp só um aviso, sem a palavra. Para gerar uma nova nesse caso,
entre no painel (`/admin/painel`, cartão **Palavra-chave**): ela aparece na tela
uma única vez.

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
| `/carol status` | Até quando vale a palavra atual, quem está autenticado e se há pausa ativa |
| `/carol pausar` | A Carol **para de responder clientes no WhatsApp por 2 horas** e volta sozinha. `/carol pausar 4` = 4 horas (mínimo 30 min, máximo 12 h). Mandar de novo renova o prazo. Para desligar por mais tempo ou "até eu religar", use o painel (seção 5.1) |
| `/carol voltar` | Encerra a pausa antes da hora |
| `/carol apagar 5541999990001` | **LGPD:** apaga todos os dados daquele cliente (memória, ficha, histórico das conversas no registro) e responde com as contagens. Não tem volta. Use quando o cliente pedir a exclusão |
| `/carol ajuda` | Esta lista |

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

## 5. Painel do administrador (novo) e endereços técnicos

### 5.1 Painel do administrador — `/admin/painel`

Abra no navegador (funciona no celular) o endereço do serviço da Carol seguido
de **`/admin/painel`** (ex.: `https://<serviço da Carol no Railway>/admin/painel`).
Digite a **chave de administrador** (`CAROL_ADMIN_KEY`) e toque em Entrar. A
sessão vale 12 horas naquele aparelho; o botão **Sair** encerra antes. A chave
nunca vai na barra de endereço. Depois de 8 tentativas erradas em 15 minutos o
login fica bloqueado por 15 minutos naquele endereço de internet.

O que você vê e faz:

| Bloco | Para que serve |
|---|---|
| **Agora a Carol está** | ATENDENDO (verde), EM SILÊNCIO (Dai) (âmbar, horário da equipe), FORA DO HORÁRIO (ninguém atende: fora da regra da Carol e fora do expediente, por exemplo no modo "só no expediente" à noite) ou DESLIGADA (vermelho), e a próxima mudança ("volta a atender hoje às 18:00"). Logo abaixo, a **origem da regra**: "padrão do servidor" (variáveis `CAROL_24H` / `CAROL_HORA_*`) ou "definida no painel" (aí as variáveis não têm efeito). Se o crédito da Anthropic acabar, aparece um aviso vermelho aqui |
| **Ligar / Desligar** | Desligar por 1 h, 2 h, 4 h, 8 h, 12 h, 24 h, 2 ou 3 dias, ou **até eu religar**. "Ligar agora" religa na hora. É a mesma pausa do `/carol pausar` / `/carol voltar` e fica registrada na auditoria |
| **Atendimento hoje** | Conversas ativas (última mensagem há menos de 30 min), mensagens e clientes do dia, tempo médio de resposta da Carol, quantas respostas ela está escrevendo agora, erros do dia, **sem resposta da Carol hoje** (mensagens em silêncio, falha da IA ou envio que não saiu: a equipe precisa responder) e o uso dos tetos diários (WhatsApp e site) |
| **Últimas interações** | As 10 mais recentes, com telefone mascarado (55419\*\*\*\*1085) e um trecho curto |
| **Picos de atendimento** | Mensagens por hora hoje x média dos últimos 7 dias, o pico do dia e um mapa dia da semana × hora dos últimos 30 dias |
| **Máquina agora** | Processador, memória, atraso interno, há quanto tempo está ligada, conexões e versão, com gráfico dos últimos 10 minutos |
| **Verificações automáticas** | O resultado da última checagem de saúde (a cada 30 min) e os alertas abertos nas últimas 24 h |
| **Servidor no Railway (24h)** | CPU e memória do servidor nas últimas 24 h e os picos. Só aparece se `RAILWAY_API_TOKEN` estiver configurado; senão mostra "não configuradas" |
| **Horário de atendimento no WhatsApp** | Escolha quando a Carol responde: **24 horas**, **só fora do expediente** (o padrão de sempre: noite e fins de semana), **só no expediente** ou **personalizado** (dias e horários à sua escolha, inclusive janelas que passam da meia-noite, como seg–sex 18:00 até 08:00). Também se edita o **expediente da equipe (Dai)**, que a Carol usa para dizer ao cliente quando a equipe volta. Vale na hora, sem redeploy. Depois de salvo aqui, as variáveis do Railway deixam de valer; o botão **Voltar ao padrão do servidor** apaga a regra do painel |
| **Palavra-chave dos comandos** | Gera uma palavra nova e manda por e-mail; se o e-mail estiver fora, mostra na tela uma única vez |

Os números se atualizam sozinhos a cada 5 segundos (gráficos e saúde a cada
minuto). Com a aba em segundo plano o painel para de consultar, para não gastar
bateria nem servidor. O chat do site continua 24 horas, qualquer que seja o
horário escolhido — a regra vale só para o WhatsApp.

### 5.2 Endereços técnicos

Pelo navegador, depois de entrar no painel (a mesma sessão abre estes
endereços); por curl, com o header `Authorization: Bearer <CAROL_ADMIN_KEY>`.
A chave **nunca** vai na URL (`?key=` não funciona mais):

| Endereço | Mostra |
|---|---|
| `/admin/painel` | **Painel do administrador** (seção 5.1) — login próprio, sem chave na URL |
| `/admin/dashboard` | Painel visual de custos e conversas (exige a sessão do painel; telefones mascarados) |
| `/admin/status` | Detalhes de saúde (o `/health` público só diz se está no ar) |
| `/admin/saude` | Último quadro de saúde, recursos configurados e agenda |
| `/admin/anomalias?horas=24` | Histórico de anomalias, incluindo as suprimidas por deduplicação |
| `/admin/agenda` | Cada rotina, última execução e próxima prevista |
| `/admin/chave` | Até quando vale a palavra-chave atual |
| `/admin/pausa` | Se a Carol está pausada, até quando e por quem |
| `/admin/auditoria?linhas=100` | Quem mandou quais comandos `/carol` (inclusive tentativas de números não cadastrados) |
| `/admin/relatorio-socios` | Prévia do relatório executivo sem enviar |

E ações (POST): `/admin/saude` (verificar agora), `/admin/anomalias/teste`
(testa se os alertas chegam), `/admin/chave/rotacionar`, `/admin/relatorio-socios`
(enviar agora), `/admin/agenda/executar/<nome>`, `/admin/pausa?horas=2` (pausar;
`DELETE /admin/pausa` encerra), `/admin/cliente/apagar` (LGPD, ver 5.3).

### 5.3 Pedido de exclusão de dados (LGPD)

Quando um cliente pedir que apaguem os dados dele:

- pelo WhatsApp: `/carol apagar <telefone com DDD>` (ex.: `/carol apagar 5541999990001`);
- ou por curl: `POST /admin/cliente/apagar` com `Authorization: Bearer <CAROL_ADMIN_KEY>` e corpo `{"telefone":"5541999990001"}` (para o chat do site: `{"sessao":"site:..."}`).

A Carol apaga a memória da conversa, os resumos (episódios) e a ficha do
cliente (no banco e na memória local) e reescreve o registro das conversas sem
as linhas dele (as duas formas do número, com e sem o nono dígito). A resposta
traz quantas linhas e itens foram apagados; tudo fica na auditoria (com o
telefone mascarado). Se o banco estiver fora do ar, a resposta avisa para
repetir depois. Atenção: o histórico espelhado no SDR comercial é apagado lá,
pelo painel do SDR.

### 5.4 Quando a IA fica fora (crédito zerado, chave recusada)

O cliente do WhatsApp não fica mais sem resposta e sem registro: ele recebe
"Recebi sua mensagem. Nossa equipe vai te responder em seguida." (ou "a partir
de amanhã às 08:00", conforme o expediente; no máximo uma vez a cada 30 minutos
por cliente), a conversa fica marcada como **pendente** no relatório da Dai, no
painel e no SDR, e chega o alerta "Urgente Carol: Crédito da Anthropic acabou".
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
| `GOOGLE_SERVICE_ACCOUNT_JSON` + `GMAIL_SENDER` | Todo e-mail pela Gmail API da empresa **e** "quem editou a planilha master" | **Nenhum e-mail sai** (o Railway bloqueia SMTP). Relatórios caem para o WhatsApp dos administradores (contingência); a palavra-chave nova só pelo painel |
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
endereço `/health` responde em qualquer navegador e diz se ela está no ar
(só "ok"; os detalhes ficam no painel e em `/admin/status`).

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
em `CAROL_ADMINS` (ou está com um dígito errado): confira em `/admin/auditoria`,
que mostra o número exato que tentou o comando.

**Quem vê as conversas dos clientes?**
Só quem tem a chave de administrador (painel) ou é administrador cadastrado no
WhatsApp e sabe a palavra da semana. O resumo por e-mail vai só para os
destinatários configurados.
