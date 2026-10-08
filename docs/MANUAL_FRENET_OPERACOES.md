# Manual Frenet — Operações APP Agro Peças Padrão

**Versão:** 1.0 · **Data:** 2026-06-07
**Público-alvo:** Time de Operações & Logística APP
**Pré-requisito:** Acesso admin ao Shopify (agropecaspadrao.myshopify.com) + CNPJ + dados bancários da APP

---

## 📋 Sumário

1. [O que é Frenet e por que escolhemos](#1-o-que-é-frenet)
2. [Antes de começar — limpeza de dados na planilha master](#2-antes-de-começar)
3. [Passo a passo: criar conta Frenet](#3-criar-conta-frenet)
4. [Contratar transportadoras dentro do painel](#4-contratar-transportadoras)
5. [Configurar caixas-mestras (essencial)](#5-configurar-caixas-mestras)
6. [Instalar e conectar o app no Shopify](#6-instalar-app-no-shopify)
7. [Testar o checkout (validação)](#7-testar-checkout)
8. [Operação diária — emitir etiquetas e dar baixa](#8-operação-diária)
9. [Split de envio — bomba pesada vs plásticos](#9-split-de-envio)
10. [Troubleshooting — problemas comuns](#10-troubleshooting)
11. [Apêndice A — Tabela de caixas sugeridas](#apêndice-a)
12. [Apêndice B — Conversões mm↔cm e regras de cubagem](#apêndice-b)

---

<a id="1-o-que-é-frenet"></a>
## 1. O que é Frenet e por que escolhemos

**Frenet** é um agregador de fretes brasileiro que permite cotar e contratar dezenas de transportadoras (Correios, Jadlog, Total, Braspress, Mandaê, Loggi, etc.) por uma só conta. Ele se integra ao Shopify e mostra **opções de envio em tempo real no checkout** do cliente, calculando com base no CEP de destino + peso/dimensões dos produtos.

### Por que Frenet (e não os outros)

| Critério | Frenet | Melhor Envio | Kangu |
|---|---|---|---|
| Integração nativa Shopify | ✅ | ✅ | ✅ |
| Cotação em tempo real no checkout | ✅ | ✅ | ✅ |
| Faz cubagem por item | ✅ | ✅ | parcial |
| Contratos com transportadoras pesadas (bombas) | ✅ Braspress, Total, Bauer | ❌ só Correios+Jadlog | ❌ só pequenos |
| Caixas-mestras configuráveis | ✅ | parcial | ❌ |
| Custo | R$ 99-299/mês | R$ 0 + taxa/etiqueta | R$ 0 + taxa/etiqueta |
| Dashboard de envios | ✅ | ✅ | básico |

**Veredito:** Frenet vence pela cobertura de transportadoras pesadas (essencial para bombas hidráulicas SOHIPREN que chegam a 50+ kg).

### ⚠️ O que Frenet **não** faz sozinho

- **3D bin packing real** (escolher a melhor combinação de caixas para múltiplos itens). Para isso seria necessário Intelipost (R$ 500+/mês), que é exagero pro volume atual.
- **Decidir qual transportadora é a melhor por peça** — quem decide é o cliente no checkout (vê todas as opções).
- **Funcionar com dados ruins** — exige peso, dimensões e CEP de origem corretos.

---

<a id="2-antes-de-começar"></a>
## 2. Antes de começar — Limpeza de dados na planilha master

Antes de mexer no Frenet, a planilha [APP_Master_Produtos_Shopify.xlsx](../util/APP_Master_Produtos_Shopify.xlsx) precisa estar limpa nas colunas técnicas, senão o frete vai sair errado.

### Checklist (já mapeado no [relatório de qualidade](#relatorio)):

#### ❌ Problema 1: AGCO com texto no campo Frete
**22 SKUs** (toda a aba 03_AGCO) têm `"orçar frete com transportadoras para 50 peças"` em vez de um valor numérico.

**O que fazer:**
1. Abrir [APP_Master_Produtos_Shopify.xlsx](../util/APP_Master_Produtos_Shopify.xlsx), aba `03_AGCO`
2. Coluna **T (Frete fábrica → eCom)** linhas 6 a 27
3. Substituir o texto por um **valor numérico** (rateio do frete total ÷ qtd peças). Ex.: se o frete fábrica de 50 peças custa R$ 250, colocar `5.00` em cada linha.
4. Salvar a planilha
5. Avisar o desenvolvedor para rodar a auditoria de preços de novo

#### ❌ Problema 2: 59 SKUs com frete vazio
- **05_JOHN_DEERE**: 18 SKUs
- **06_STARA**: 35 SKUs
- **07_GTS**: 6 SKUs

Mesmo procedimento — preencher coluna **S/T (Frete fábrica → eCom)** com valor numérico de rateio.

#### ❌ Problema 3: Dimensões em mm marcadas como cm
14 SKUs identificados com dimensões impossíveis (caixa de 26 metros). Provável erro de unidade — está em **mm** mas o cabeçalho diz **cm**.

**Lista para revisão urgente:**

| Aba | SKU | C×L×A atual (cm) | Provável correto (cm) |
|---|---|---|---|
| 03_AGCO | ACX3266690 | 2600 × 422 × 179 | 260 × 42,2 × 17,9 |
| 03_AGCO | ACW0551840 | 490 × 490 × 45 | 49 × 49 × 4,5 |
| 03_AGCO | ACX3454710 | 285 × 285 × 247 | 28,5 × 28,5 × 24,7 |
| 03_AGCO | ACX283890A | 161 × 207 × 15 | 16,1 × 20,7 × 1,5 |
| 05_JOHN_DEERE | KK31823 | 336 × 380 × 1,6 | 33,6 × 38 × 1,6 |
| 05_JOHN_DEERE | KK31824 | 334 × 270 × 1,6 | 33,4 × 27 × 1,6 |
| 05_JOHN_DEERE | KK31825 | 330 × 162 × 1,6 | 33 × 16,2 × 1,6 |
| 05_JOHN_DEERE | CQ65827 | 35 × 400 × 35 | 35 × 40 × 3,5 |
| 05_JOHN_DEERE | AA67780 | 65 × 439 × 45 | 65 × 43,9 × 4,5 |
| 06_STARA | 8031-4009 | 395 × 894 × 256 | 39,5 × 89,4 × 25,6 |
| 06_STARA | 8031-4010 | 240 × 840 × 358 | 24 × 84 × 35,8 |
| 06_STARA | 8031-4008 | 115 × 234 × 100 | 11,5 × 23,4 × 10 |
| 06_STARA | 6424-4013 | 70 × 540 × 70 | 7 × 54 × 7 |

⚠️ **NÃO faça regra automática de "dividir por 10"** — algumas medidas podem estar certas. **Conferir cada item com a peça em mãos ou com o fornecedor**.

#### ❌ Problema 4: Pesos faltando (active)
- **02_SOHIPREN** — 1 SKU active sem peso
- **04_GRECO** — 1 SKU active sem peso (provavelmente o GR140990 Kit Ponta de Cerca, que tem variantes 20m/30m)

Pesar a peça e preencher coluna **M (Peso kg)**.

#### ❌ Problema 5: Peso suspeito
- **6424-4005 (Acabamento Lateral Reservatório)**: 0,008 kg = 8 gramas. Confirmar: é 8 g, 80 g, ou 800 g?

### ✅ Quando terminar
Avise o desenvolvedor (Guilherme) com: **"Planilha limpa, pode sincronizar Frenet"**. Em ~5 min ele aplica peso + dimensões + frete em todos os SKUs ativos do Shopify via API.

---

<a id="3-criar-conta-frenet"></a>
## 3. Passo a passo: criar conta Frenet

### 3.1. Cadastro inicial

1. Acesse **[www.frenet.com.br](https://www.frenet.com.br)**
2. Clique em **"Cadastre-se grátis"** (canto superior direito)
3. Preencha:
   - **Nome da empresa:** APP Agro Peças Padrão
   - **CNPJ:** 66.316.831/0001-85
   - **E-mail:** comercial@agropecaspadrao.com.br (usar um e-mail de operações, NÃO o pessoal)
   - **Telefone:** o do SAC
   - **Senha:** mínimo 8 caracteres, anotar no gerenciador de senhas da empresa

4. Confirmar o e-mail (vai chegar um link)

### 3.2. Completar perfil da loja

Depois de logar, vá em **Configurações → Dados da Empresa**:

| Campo | Valor |
|---|---|
| Razão Social | APP Agro Peças Padrão Ltda. |
| Nome Fantasia | Agro Peças Padrão |
| CNPJ | 66.316.831/0001-85 |
| Inscrição Estadual | _verificar com contador_ |
| Endereço (origem dos envios) | _endereço do depósito/escritório_ |
| CEP de origem | _preencher_ |
| Telefone | (41) 98415-1085 (WhatsApp comercial) |

**Importante:** o **CEP de origem** é usado em TODOS os cálculos de frete. Se estiver errado, o cliente vai pagar um frete que não bate com a realidade.

### 3.3. Plano

Para o volume da APP (estimativa <100 envios/mês inicial), o plano **Starter (R$ 99/mês)** é suficiente. Inclui:
- Até 200 envios/mês
- Cotação ilimitada
- Integração Shopify
- Suporte por chat

Quando o volume passar de 200/mês, fazer upgrade para Pro (R$ 199/mês).

---

<a id="4-contratar-transportadoras"></a>
## 4. Contratar transportadoras dentro do painel

Frenet funciona como um marketplace de transportadoras. Você escolhe quais quer ativar.

### Para a APP, o setup recomendado:

| Transportadora | Quando usar | Como ativar |
|---|---|---|
| **Correios PAC** | Peças pequenas (plásticos, sensores < 5 kg), todo Brasil | Já vem pré-ativada. Verificar se contrato APP-Correios existe; se não, usar tabela pública. |
| **Correios SEDEX** | Mesma faixa, modo expresso para clientes que pagam mais | Mesma coisa do PAC |
| **Jadlog Econômico** | Peças médias (5-30 kg), bom custo-benefício | Painel Frenet → Transportadoras → Jadlog → "Contratar". Preenche CNPJ e em 24-48h ativa |
| **Total Express** | Bombas hidráulicas (>30 kg) para Sudeste/Sul | Painel → Total → "Contratar". Pode pedir comprovante de volume mensal |
| **Braspress** | Bombas e cargas pesadas Nordeste/Norte | Painel → Braspress → "Contratar". Geralmente exige contrato comercial direto |

### Como ativar (vale para todas)

1. Painel Frenet → menu lateral **"Transportadoras"**
2. Encontrar a transportadora desejada na lista
3. Clicar em **"Contratar"** ou **"Solicitar contrato"**
4. Preencher formulário (CNPJ + estimativa de volume mensal)
5. Aguardar aprovação (24-72h)
6. Quando aprovado, ela aparece com toggle verde → ativar

### ⚠️ Tabela própria vs. tabela Frenet

Se a APP **já tem contrato direto** com alguma transportadora (ex.: Jadlog), peça ao gerente da conta para enviar a **tabela negociada** e cadastre ela em **Configurações → Tabelas customizadas**. Sai mais barato que a tabela pública do Frenet.

---

<a id="5-configurar-caixas-mestras"></a>
## 5. Configurar caixas-mestras (essencial)

Isso é **o coração** do cálculo de frete inteligente. Sem isso, Frenet manda cada item como uma caixa separada → frete absurdo.

### O conceito

Quando o cliente compra 5 peças plásticas pequenas, a operação **não despacha 5 envelopes** — coloca tudo numa caixa só. O Frenet precisa saber **quais caixas você tem disponíveis** para escolher a melhor.

### Caixas sugeridas para APP

| Nome | Dimensões (cm) | Peso máx | Uso |
|---|---|---|---|
| **Envelope Plástico** | 30 × 20 × 5 | 1 kg | Peças MUITO pequenas (parafusos, anéis, dedos retráteis) |
| **Caixa P** | 30 × 25 × 15 | 5 kg | Múltiplas peças plásticas pequenas (até 8-10 unidades) |
| **Caixa M** | 40 × 30 × 25 | 15 kg | Peças plásticas grandes, sensores, kits |
| **Caixa G** | 50 × 40 × 35 | 30 kg | Bombas pequenas (BOI), múltiplas peças médias |
| **Caixa GG** | 60 × 50 × 50 | 50 kg | Bombas grandes (Sohipren série Valtra/JD/CNH) |
| **Pallet** | 100 × 80 × 100 | 200 kg | Pedidos B2B com muitas bombas (>5 unidades pesadas) |

### Como configurar no Frenet

1. Painel Frenet → **Configurações → Embalagens**
2. Clicar **"+ Adicionar embalagem"**
3. Para cada caixa da tabela acima:
   - Nome (igual ao da tabela)
   - Dimensões C × L × A em cm
   - Peso máximo em kg
   - Marcar **"Disponível"**
4. Salvar

### Regra "1 unidade = R$14, 5 unidades = R$45"

Esta é exatamente a lógica que Frenet aplica automaticamente quando as caixas estão configuradas:

- Cliente compra 1 plástico (peso 0,5 kg, 10×10×5 cm) → cabe na **Caixa P** → frete da rota da Caixa P (~R$ 14)
- Cliente compra 5 plásticos iguais → 5 × 0,5 = 2,5 kg, ainda cabe na **Caixa P** → frete continua ~R$ 14
- Cliente compra 12 plásticos → não cabe na P → vai pra **Caixa M** → frete sobe pra ~R$ 22 (não para 5×R$ 14 = R$ 70)

**Resultado: o cliente paga o frete REAL da caixa real, não o frete multiplicado por unidade.**

---

<a id="6-instalar-app-no-shopify"></a>
## 6. Instalar e conectar o app no Shopify

### 6.1. Instalar

1. Logar no Shopify Admin com conta de owner
2. Ir em **Apps → Shopify App Store**
3. Buscar **"Frenet"**
4. Clicar no app oficial **"Frenet — Fretes inteligentes"**
5. **Instalar** → aceitar permissões (Frenet precisa ler produtos para cotar)
6. Após instalar, abre a tela de configuração

### 6.2. Conectar à conta Frenet

1. Na tela do app dentro do Shopify, há um campo **"Token Frenet"** ou **"E-mail + Senha"**
2. Vá no painel Frenet (em outra aba) → **Configurações → API → Gerar Token**
3. Copie o token e cole no Shopify
4. Clicar **"Conectar"**
5. Status deve mudar para **✅ Conectado**

### 6.3. Ativar nas zonas de envio

1. Shopify Admin → **Settings → Shipping and delivery**
2. Editar a zona **"Brasil"** (ou criar uma se não existir)
3. **"Add rate" → "Use carrier or app to calculate rates"**
4. Selecionar **Frenet** na lista
5. Marcar todas as transportadoras que ativou no Frenet
6. Salvar

### 6.4. Configurações extras importantes

- **Tempo de manuseio (handling time)**: Frenet → Configurações → adicionar **2 dias úteis** (tempo da operação separar e despachar)
- **Frete grátis acima de X**: opcional — pode configurar no Shopify (Settings → Shipping → Rate → Free shipping if price > R$ 500, por ex.)
- **Margem de segurança no frete**: Frenet permite adicionar **+5% sobre o valor** para cobrir surpresas. Recomendado.

---

<a id="7-testar-checkout"></a>
## 7. Testar o checkout (validação)

**NÃO** ative em produção sem testar. Faça 5 carrinhos de teste:

### Teste 1 — Peça pequena, CEP perto
- Adicione `ACX363311B` (Copo Venturi B — plástico pequeno) ao carrinho
- Endereço: CEP de São Paulo capital (ex.: 01310-100)
- **Esperado:** Frete entre R$ 12 e R$ 25, opções de PAC + SEDEX visíveis

### Teste 2 — Peça pequena, CEP longe
- Mesmo produto, CEP de Manaus (69000-000)
- **Esperado:** Frete entre R$ 35 e R$ 80, PAC + SEDEX

### Teste 3 — Múltiplas peças pequenas
- Adicione 5x `ACX363311B`
- CEP de SP
- **Esperado:** Frete NÃO deve ser 5× o do Teste 1. Deve ser ~R$ 18-25 (uma caixa só)

### Teste 4 — Bomba pesada
- Adicione 1x bomba SOHIPREN (ex.: `5.0220.0548824-2` — Bomba Dupla Valtra-Valmet BH160)
- CEP de SP
- **Esperado:** Frete entre R$ 80 e R$ 150, opções Total Express e Braspress aparecem (PAC pode não aparecer por exceder peso)

### Teste 5 — Pedido misto
- 1x bomba + 3x peças plásticas
- CEP qualquer
- **Esperado:** Frete deve dividir em **2 caixas** (uma GG para a bomba, uma P para os plásticos), e o cliente vê 2 opções de envio ou 1 valor consolidado

### Se algum teste falhar

→ ir direto pro **Troubleshooting (seção 10)**.

---

<a id="8-operação-diária"></a>
## 8. Operação diária — Emitir etiquetas e dar baixa

### Fluxo normal

1. **Cliente compra na loja** → pedido cai no Shopify Admin
2. **Operações vê o pedido** em **Orders → Unfulfilled**
3. **Conferir a peça fisicamente** no estoque
4. Clicar no pedido → painel direito **"Fulfillment" → Mark as fulfilled → Frenet**
5. Frenet pergunta:
   - Qual caixa usar (já sugere a recomendada)
   - Confirma peso real (se diferente, ajustar)
   - Confirmar transportadora (das opções que o cliente pagou)
6. Frenet **gera a etiqueta PDF** automaticamente
7. **Imprimir** etiqueta + nota fiscal, colar na caixa
8. Quando a transportadora retirar, no Frenet clicar **"Confirmar coleta"**
9. Shopify atualiza automaticamente para **"Fulfilled"** + envia código de rastreio ao cliente

### Etiquetas em lote

Para múltiplos pedidos no mesmo dia:
1. Shopify Admin → **Orders** → marcar checkbox dos pedidos a despachar
2. **Bulk actions → Print packing slips**
3. No Frenet: **Painel → Pedidos → Imprimir etiquetas em lote**

### Notas fiscais

Frenet **NÃO emite NFe**. Você precisa de um ERP/emissor separado (Bling, Tiny, Omie, etc.). Sugestão: integrar **Tiny ERP** → ele puxa pedido do Shopify, gera NF, e a etiqueta Frenet anexa.

---

<a id="9-split-de-envio"></a>
## 9. Split de envio — Bomba pesada vs. plásticos

Quando um cliente compra **1 bomba + 5 plásticos**, a operação tem duas escolhas:

### Opção A — Despachar em 1 caixa só (consolidado)
Coloca a bomba + os plásticos juntos na **Caixa GG**. Vantagem: cliente recebe tudo de uma vez.
**Quando usar:** se a bomba é pequena (BOI < 10 kg) e cabe junto.

### Opção B — Split em 2 envios
- Caixa GG só com a bomba (Total Express)
- Caixa P com os plásticos (Correios PAC)

**Quando usar:**
- Bomba > 30 kg
- Transportadoras diferentes (bomba precisa de carga seca, plástico vai de PAC)
- Cliente B2B aceita receber em dias diferentes

**Como fazer split no Shopify:**
1. Abrir o pedido
2. Clicar **"Fulfill some items"** (não "all")
3. Selecionar só a bomba → gerar etiqueta GG
4. Voltar e clicar **"Fulfill some items"** de novo → selecionar os plásticos → etiqueta P
5. Cliente recebe 2 e-mails de rastreio (1 por envio)

---

<a id="10-troubleshooting"></a>
## 10. Troubleshooting — Problemas comuns

### "Frete não apareceu no checkout"
**Causa provável:** produto sem peso ou sem dimensões, ou CEP de origem não preenchido.
**Solução:**
1. Verificar no Shopify se o produto tem peso > 0 (Product → Shipping → Weight)
2. Verificar Frenet → Configurações → CEP de origem preenchido
3. Se persistir, ver logs em Frenet → **Logs → Filtrar pelo pedido**

### "Valor de frete absurdo (R$ 500+ para um plástico)"
**Causa provável:** dimensões em mm registradas como cm (erro flagged no relatório).
**Solução:**
1. Olhar Product no Shopify → Shipping → Dimensions
2. Se valor parece grande demais, **dividir por 10** (mm → cm)
3. Salvar e cotar de novo

### "Transportadora rejeitou após coleta"
**Causa provável:** peso real ≠ peso declarado, ou caixa fora das dimensões da transportadora.
**Solução:**
- Pesar caixa fechada **antes** de gerar etiqueta
- Se a caixa for muito grande (>1m³ ou >60kg), usar transportadora de carga (Braspress, Total) em vez de Correios/Jadlog
- Em caso de rejeição, abrir ticket no Frenet → eles falam direto com a transportadora

### "Cliente reclamou que pagou frete duplicado"
**Causa provável:** split de envio mal feito — cliente foi cobrado pela bomba (Total) E pelos plásticos (PAC), totalizando 2 fretes.
**Solução:**
- Confirmar com financeiro qual o pacote certo
- Se for caso de equivocou, fazer **reembolso parcial** no Shopify do valor extra

### "Frenet caiu / não cota"
**Solução de emergência:**
1. Ir em Shopify Admin → Settings → Shipping
2. Desativar temporariamente o método **Frenet**
3. Ativar uma **flat rate** (frete fixo) de R$ 50 nacional como fallback
4. Quando Frenet voltar, reativar e desativar a flat rate

### "Pedido com SKU inexistente no Frenet"
**Causa:** SKU foi criado no Shopify depois da última sync com Frenet.
**Solução:**
- Frenet → Configurações → **Sincronizar catálogo agora**
- Ou aguardar a sync automática (4× ao dia)

---

<a id="apêndice-a"></a>
## Apêndice A — Tabela de caixas sugeridas (resumo)

| Nome | Dimensões (cm) | Peso máx | Uso típico APP |
|---|---|---|---|
| Envelope Plástico | 30×20×5 | 1 kg | 1-2 peças plásticas micro |
| Caixa P | 30×25×15 | 5 kg | Até 10 peças plásticas pequenas |
| Caixa M | 40×30×25 | 15 kg | Sensores GRECO, peças plásticas médias |
| Caixa G | 50×40×35 | 30 kg | Bombas pequenas (BOI), kits |
| Caixa GG | 60×50×50 | 50 kg | Bombas grandes Sohipren/JD/CNH |
| Pallet | 100×80×100 | 200 kg | Pedidos B2B múltiplas bombas |

**Compra das caixas:** sugiro encomendar 50 unidades de cada tamanho no [embalixo.com.br](https://embalixo.com.br) ou fornecedor local. Custo médio: R$ 200-400 inicial.

---

<a id="apêndice-b"></a>
## Apêndice B — Conversões e cubagem

### Conversão mm ↔ cm
- 1 cm = 10 mm
- **Sempre cadastrar em CM** no Shopify e Frenet

### Conversão g ↔ kg
- 1 kg = 1000 g
- **Sempre cadastrar em KG** no Shopify e Frenet (mesmo que o número fique 0,008)

### Cubagem — como transportadoras calculam

Transportadora cobra pelo **maior** entre:
- **Peso real** (o que a balança mostra)
- **Peso cubado** = (C × L × A em cm) ÷ **fator cubagem**

| Modal | Fator |
|---|---|
| Aéreo (SEDEX, Total Air) | 6.000 |
| Rodoviário (PAC, Jadlog, Braspress) | 6.000 (alguns 5.000) |

**Exemplo:** Bomba 5.0220.0548824-2 — peso real 25 kg, caixa 60×50×50 cm
- Cubado = (60 × 50 × 50) ÷ 6.000 = **25 kg**
- Peso cobrado = max(25, 25) = **25 kg** ✓

**Exemplo problemático:** Sensor GR141207 — peso real 2 kg, caixa 30×25×15 cm
- Cubado = (30 × 25 × 15) ÷ 6.000 = **1,875 kg**
- Peso cobrado = max(2, 1,875) = **2 kg** ✓

**Exemplo MUITO problemático (se cadastrar dim errada):** Plástico ACX3266690 — peso real 1,3 kg, caixa cadastrada como 2600×422×179 cm (mm cadastrado como cm)
- Cubado = (2600 × 422 × 179) ÷ 6.000 = **32.726 kg** 🚨
- Cliente paga frete para 32 toneladas — **inviável**

→ Por isso a Fase 1 de limpeza é crítica.

---

## 📞 Contatos úteis

- **Suporte Frenet:** suporte@frenet.com.br · chat no painel (resposta < 1h em horário comercial)
- **Gerente comercial Frenet:** atribuído após contratar o plano Starter
- **Documentação API Frenet:** [docs.frenet.com.br](https://docs.frenet.com.br)
- **Shopify Help (envio):** [help.shopify.com/manual/shipping](https://help.shopify.com/manual/shipping)

---

## ✅ Checklist final antes de ativar em produção

- [ ] Planilha master limpa (frete numérico em AGCO/JD/STARA/GTS, dimensões em cm, pesos preenchidos)
- [ ] Dados sincronizados do Shopify (avisar desenvolvedor)
- [ ] Conta Frenet criada e perfil completo
- [ ] Plano Starter contratado
- [ ] Transportadoras ativas: Correios + Jadlog + Total + Braspress
- [ ] Caixas-mestras configuradas (6 tipos)
- [ ] App Frenet instalado no Shopify
- [ ] Zone "Brasil" configurada com Frenet como método
- [ ] 5 testes de checkout passaram
- [ ] Treinamento da operação: como gerar etiqueta + split de envio
- [ ] Plano B: flat rate R$ 50 cadastrada como fallback

---

**Dúvidas técnicas:** Guilherme (desenvolvedor) · **Dúvidas operacionais:** suporte Frenet
