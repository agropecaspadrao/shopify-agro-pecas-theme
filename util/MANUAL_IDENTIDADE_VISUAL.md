# Manual de Identidade Visual & Marketing
## APP Agro Peças Padrão

> **Instruções para uso em outro prompt:**
> Cole este documento completo em um novo chat e peça:
> *"Com base neste manual de identidade visual e marketing, crie um documento formal de Manual de Marketing da marca APP Agro Peças Padrão, incluindo: brand story, posicionamento, tom de voz, diretrizes de comunicação, guia de mídias sociais, estratégia de conteúdo e templates de copy para cada canal."*

---

## 1. IDENTIDADE DA MARCA

### Nome
**APP Agro Peças Padrão**
- Sigla: **APP**
- Nome curto em comunicação informal: **Agro Peças**

### Tagline principal
> *"Peças originais. Entrega ágil. Confiança de verdade."*

### Tagline secundária (rodapé/assinatura)
> *"Especialistas em bombas hidráulicas e peças para o agronegócio brasileiro."*

### Propósito da marca
A APP Agro Peças Padrão nasceu de um sonho: entregar **mais agilidade e confiança** para quem trabalha com máquinas agrícolas no Brasil. O produtor rural não pode perder dias esperando uma peça. Criamos esta empresa para ser a resposta rápida que o setor precisa.

### Posicionamento
**Distribuidora especializada** em peças hidráulicas e sensores agrícolas originais LIVENZA, com foco em agilidade, procedência garantida e suporte técnico direto via WhatsApp — para produtores rurais, técnicos agrícolas e empresas do agronegócio brasileiro.

---

## 2. PALETA DE CORES

### Cores Primárias

| Nome | HEX | Uso |
|------|-----|-----|
| **Verde Floresta** | `#1B4332` | Cor principal — headers, botões CTA, backgrounds escuros |
| **Verde Escuro** | `#153628` | Hover states, versão mais densa do primário |
| **Verde Médio** | `#2F6B4F` | Gradientes, variações do primário |
| **Dourado Premium** | `#D4AF37` | Accent — destaques, badges, ícones, CTAs secundários |
| **Dourado Claro** | `#E7C86A` | Trust icons, elementos decorativos em fundos escuros |
| **Dourado Dark** | `#B8942B` | Hover do accent |

### Cores Neutras

| Nome | HEX | Uso |
|------|-----|-----|
| **Texto Principal** | `#2F2F2F` | Corpo de texto |
| **Texto Suave** | `#78716b` | Labels, metadados, secundários |
| **Stone 600** | `#57534e` | Legendas, subtítulos |
| **Stone 800** | `#292524` | Backgrounds escuros neutros |
| **Stone 900** | `#1c1917` | Footer, quase preto |
| **Fundo Branco** | `#ffffff` | Fundo padrão de cards e páginas |
| **Fundo Suave** | `#f9f8f7` | Seções zebradas, backgrounds de cards |
| **Fundo Neutro (Stone)** | `#E6E1D9` | Backgrounds levemente quentes, seções de contraste |
| **Borda** | `#DCD7CE` | Divisores, bordas de input |

### Cores Funcionais

| Nome | HEX | Uso |
|------|-----|-----|
| **WhatsApp** | `#25D366` | Botões e links do WhatsApp |
| **Erro** | `#C62828` | Mensagens de erro |
| **Sucesso** | `#22c55e` | Badges de estoque disponível |

### Combinações aprovadas
- **Fundo verde `#1B4332` + texto branco** → Headers, banners, footers, painéis de auth
- **Fundo branco + texto `#2F2F2F`** → Cards, formulários, páginas internas
- **Accent dourado `#D4AF37` em fundo verde** → Trust items, eyebrows, destaques em dark sections
- **Verde primário em fundo branco** → Botões CTA, links ativos
- **Fundo neutro `#E6E1D9`** → Seções alternadas, fundos de depoimentos e trust bar

---

## 3. TIPOGRAFIA

### Fonte Display — Barlow Condensed
- **Uso:** Títulos, CTAs, eyebrows, labels em caps, números de destaque
- **Pesos:** 600, 700, 800
- **Características:** Condensada, forte, transmite solidez e precisão técnica
- **Google Fonts:** `Barlow+Condensed:wght@600;700;800`

### Fonte Body — Barlow
- **Uso:** Corpo de texto, parágrafos, inputs, descrições
- **Pesos:** 400, 500, 600
- **Características:** Legível, clean, fácil de ler em telas pequenas
- **Google Fonts:** `Barlow:wght@400;500;600`

### Fonte Mono — JetBrains Mono
- **Uso:** SKUs, referências OEM, part numbers, códigos técnicos
- **Características:** Transmite precisão técnica, diferencia dados de texto editorial

### Hierarquia Tipográfica

| Nível | Fonte | Tamanho | Peso | Uso |
|-------|-------|---------|------|-----|
| H1 Hero | Barlow Condensed | 40–56px | 800 | Títulos de banner e hero |
| H1 Página | Barlow Condensed | 28–40px | 800 | Títulos de páginas internas |
| H2 Seção | Barlow Condensed | 22–28px | 800 | Títulos de seções |
| H3 Card | Barlow Condensed | 16–18px | 700 | Títulos de cards |
| Eyebrow | Barlow Condensed | 10–12px | 700 | Labels em uppercase, badge de seção |
| Body | Barlow | 14–16px | 400/500 | Texto corrido |
| Label | Barlow Condensed | 11–13px | 700 | Labels de formulários, tabelas |
| Código | JetBrains Mono | 12–14px | 400 | SKUs, referências técnicas |

---

## 4. ESPAÇAMENTO E LAYOUT

| Variável | Valor | Uso |
|----------|-------|-----|
| `--page-width` | 1280px | Largura máxima do conteúdo |
| `--page-gutter` | 24px (16px mobile) | Padding lateral das páginas |
| `--section-padding` | 64px (40px mobile) | Padding vertical das seções |
| `--radius-sm` | 4px | Badges pequenos |
| `--radius-md` | 12px | Cards, inputs, botões |
| `--radius-lg` | 16px | Containers maiores |
| `--radius-full` | 9999px | Pills, eyebrows, tags |

---

## 5. ELEMENTOS DE INTERFACE

### Botões

**Primário (CTA principal)**
- Fundo: `#1B4332` → `#153628` (hover)
- Texto: branco, Barlow Condensed 700, uppercase
- Border-radius: 12px
- Box-shadow: `0 4px 16px rgba(27,67,50,.3)`

**WhatsApp**
- Fundo: `#25D366` → `#1eb857` (hover)
- Ícone SVG do WhatsApp + texto

**Outline / Secundário**
- Borda: `#1B4332`
- Texto: `#1B4332`
- Hover: fundo verde + texto branco

**Accent (destaque)**
- Fundo: `#D4AF37`
- Uso: Trust items, eyebrows, badges premium

### Cards de Produto
- Fundo branco, border `#DCD7CE`, border-radius 12px
- Hover: `box-shadow: 0 4px 12px rgba(0,0,0,.08)` + `translateY(-2px)`
- Badge "Em Estoque": verde `#1B4332`
- Badge "Sob Consulta": dourado `#D4AF37`

### Formulários
- Inputs: border `#e7e5e3`, border-radius 12px, focus: borda verde + shadow suave
- Labels: 12px, uppercase, letter-spacing .06em, cor `#57534e`
- Submit: estilo botão primário com gradient

### Trust Bar (faixa de confiança)
- 4 itens fixos com ícone SVG em quadrado âmbar + duas linhas de texto
- Separador vertical entre itens, colapsa para 2 colunas em mobile

---

## 6. PÁGINAS COM IDENTIDADE VISUAL APLICADA

### Auth Pages (Login / Cadastro)
- Layout dividido: **painel esquerdo verde** (400px) + **painel direito branco** (formulário)
- Painel verde: logo, eyebrow dourado, título, subtítulo, 3 trust items com ícones SVG, rodapé com CNPJ
- Painel formulário: card branco centralizado, sombra xl, eyebrow âmbar
- Mobile: painel verde oculto, apenas formulário

### Página de Conta (Dashboard)
- Header com ícone avatar verde + saudação personalizada pelo nome
- Tabela de pedidos com cabeçalho verde primário e textos brancos
- Status de pedido como pills coloridos (verde/âmbar/vermelho)
- Empty state com ícone e CTA para catálogo

### Página Quem Somos
- Hero verde com eyebrow dourado, stats em grade, lead text
- Seção missão: texto à esquerda + 4 cards (1 destacado verde + 3 neutros)
- Seção marcas: pills das marcas atendidas
- Seção valores: ícones numerados em gradiente verde
- CTA final: dark green com 3 botões

---

## 7. IDENTIDADE DA MARCA — TOM DE VOZ

### Personalidade da marca
- **Confiável** — fala com segurança, tem procedência em tudo
- **Direto** — não enrola, vai ao ponto
- **Próximo** — parceiro, não fornecedor distante
- **Técnico quando precisa** — sabe do assunto, sem ser arrogante
- **Ágil** — transmite velocidade, resolve rápido

### O que a marca É:
- Parceiro do produtor rural
- Especialista em hidráulica agrícola
- Solução rápida para máquina parada
- Referência em peças originais LIVENZA

### O que a marca NÃO é:
- Genérica
- Burocrática
- Distante
- Inflada (sem exagerar conquistas)

### Exemplos de Tom
| Contexto | Tom correto | Tom errado |
|----------|-------------|------------|
| Produto sem estoque | "Peça disponível sob consulta — fale com a gente." | "Desculpe, produto indisponível." |
| CTA principal | "Ver Catálogo de Peças" | "Clique aqui para ver nossos produtos" |
| Página Quem Somos | "Nascemos para mudar o jeito de comprar peças no agro." | "Somos líderes do mercado há muitos anos." |
| WhatsApp SAC | "Olá! Preciso de atendimento da Agro Peças Padrão." | "Oi, quero falar com alguém." |
| Empty state pedidos | "Nenhum pedido ainda. Explore nosso catálogo." | "Você não fez nenhum pedido." |

---

## 8. MENSAGENS WHATSAPP POR CONTEXTO

| Área | Número | Mensagem pré-preenchida |
|------|--------|------------------------|
| **SAC (rodapé)** | 5541998333338 | `Olá! Preciso de atendimento do SAC da Agro Peças Padrão.` |
| **Produto específico** | 5541998333338 | `Olá! Tenho interesse na peça *[TÍTULO]* (SKU: [SKU]) do catálogo Agro Peças Padrão. Gostaria de saber preço e disponibilidade.` |
| **Catálogo** | 5541998333338 | `Olá! Estava navegando no catálogo da APP Agro Peças Padrão e tenho interesse na peça` |
| **Quem Somos** | 5541998333338 | `Olá! Vim pela página Quem Somos e gostaria de mais informações sobre os produtos da Agro Peças Padrão.` |
| **Cotação formal** | 5541998333338 | `Olá! Gostaria de solicitar uma cotação pela APP Agro Peças Padrão. Podem me atender?` |
| **Busca sem resultado** | 5541998333338 | `Olá! Não encontrei a peça que preciso no site. Estou buscando por: [TERMO]` |
| **Ficha técnica** | 5541998333338 | `Olá! Gostaria de solicitar a ficha técnica da peça [TÍTULO] (SKU: [SKU]).` |

---

## 9. DADOS INSTITUCIONAIS

| Campo | Valor |
|-------|-------|
| **Razão Social** | APP Agro Peças Padrão |
| **CNPJ** | 66.316.831/0001-85 |
| **Endereço** | R. José Benedito Cottolengo, 901 — Casa 19, Cond. Jardim de Monet, Campo Comprido, Curitiba – PR, CEP 81.220-310 |
| **Telefone** | (41) 9833-3338 |
| **WhatsApp** | (41) 9983-3338 — `5541998333338` |
| **E-mail** | comercial@agropecaspadrao.com.br |
| **Loja online** | agropecaspadrao-2.myshopify.com |
| **Fornecedor principal** | LIVENZA (distribuidor autorizado) |
| **Certificações** | ISO 9001 / ISO 14001 / OHSAS 18001 |
| **Horário** | Seg–Sex 08h–18h · Sáb 08h–12h |

---

## 10. MARCAS ATENDIDAS

Peças compatíveis com as principais marcas do agronegócio brasileiro:
- John Deere
- New Holland
- Case IH
- AGCO / Fendt
- Valtra
- Massey Ferguson
- Komatsu
- CNH Industrial
- Jacto
- Stara

---

## 11. CATEGORIAS DE PRODUTO

### Bombas Hidráulicas
- Bombas de engrenagem
- Bombas de pistão
- Bombas de palheta
- Motores hidráulicos

### Sensores Agrícolas
- Sensores de fluxo (sementes)
- Sensores de velocidade
- Sensores de posição
- Sensores de pressão

---

## 12. MEIOS DE PAGAMENTO

- **PIX** (teal `#32bcad`)
- **Cartão de Crédito:** Visa, Mastercard, Elo, Amex, Hipercard
- **PayPal** (azul `#009cde`)
- **Boleto Bancário**
- **Parcelamento:** até 10× no cartão

---

## 13. ATIVOS DIGITAIS

| Arquivo | Descrição |
|---------|-----------|
| `APP - LOGO - SEM FUNDO V3.png` | Logo PNG 640px (Retina-safe) — fundo transparente |
| `APP - WALLPAPER - BANNER - HEADER.jpg` | Imagem de fundo do hero banner da home |
| `fonts.css` | Import Google Fonts (Barlow Condensed + Barlow) |
| `theme.css` | Folha de estilos principal com todos os tokens CSS |

---

## 14. ESTRUTURA DO SITE

```
/ ——————————————— Home (Banner + Destaques + Coleções)
/collections ——— Catálogo (lista de coleções)
/collections/all — Todos os produtos
/products/[slug] — Página do produto
/pages/quem-somos — Quem Somos Nós
/pages/contato ——— Fale Conosco / Cotação Formal
/pages/politica-de-devolucao — Política de Devolução
/pages/politica-de-envio ——— Política de Envio
/account ————————— Conta do cliente
/account/login —— Login
/account/register — Cadastro
/cart ——————————— Carrinho
/search ————————— Busca
```

---

*Atualizado em 2026-04-27 · APP Agro Peças Padrão · CNPJ 66.316.831/0001-85*
