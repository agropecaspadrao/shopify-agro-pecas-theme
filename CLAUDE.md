# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## O que é este projeto

Tema Shopify OS 2.0 customizado para **APP Agro Peças Padrão** (`agropecaspadrao.com.br`) — distribuidora de bombas hidráulicas, sensores agrícolas e peças plásticas para o agronegócio brasileiro. Distribuidor oficial LIVENZA.

---

## Deploy

**Todo commit em `main` publica automaticamente no Shopify** via integração GitHub ↔ Shopify. O `.githooks/post-commit` faz `git push` automaticamente após cada commit local.

```bash
git push origin main   # → publica no tema ativo da loja
```

Para preview local (não necessário para deploy):

```bash
shopify theme dev --store agropecaspadrao.myshopify.com
```

---

## Stack

- **Plataforma:** Shopify OS 2.0 (Liquid + JSON sections)
- **Estilos:** CSS puro em `assets/theme.css` e `assets/base.css`
- **Scripts:** JS puro em `assets/theme.js` (placeholder) e `assets/whatsapp.js`
- **Fontes:** Barlow Condensed (títulos) + Barlow (corpo) + JetBrains Mono (SKUs/códigos) — Google Fonts via `assets/fonts.css`
- **Localização:** Apenas `pt-BR` (`locales/pt-BR.default.json`)

---

## Arquitetura

### Fluxo de renderização

`layout/theme.liquid` é o shell HTML de todas as páginas. Ele injeta:
- CSS tokens (variáveis CSS dinâmicas via `settings.*` com fallbacks hardcoded)
- `window.waNumber` e `window.waGreeting` globais (usados pelo JS)
- Os scripts `theme.js` e `whatsapp.js` com `defer`
- O botão WhatsApp flutuante

`templates/*.json` definem quais seções cada tipo de página carrega. Templates Liquid especiais (`.liquid`) existem apenas para `gift_card`, `page.cotacao` e `page.quem-somos`.

### Seções (`sections/`)

| Arquivo | Função |
|---------|--------|
| `header.liquid` | Logo, busca com predictive search, nav desktop/mobile, carrinho |
| `footer.liquid` | Links, redes sociais, CNPJ, telefone, tagline |
| `image-banner.liquid` | Hero banner da home + trust bar (4 ícones SVG) |
| `featured-collection.liquid` | Grade de produtos em destaque |
| `collection-list.liquid` | Grid de categorias na home |
| `all-products.liquid` | PLP genérica — todos os produtos |
| `main-product.liquid` | PDP completa (galeria, códigos, specs, tabs, relacionados) |
| `main-collection-product-grid.liquid` | PLP de coleção com filtros |
| `main-cart.liquid` | Carrinho / lista de cotação |
| `main-search.liquid` | Resultados de busca |
| `quem-somos.liquid` | Página institucional (hero, missão, marcas, valores, CTA) |
| `contact-page.liquid` | Formulário de contato / cotação formal |
| `main-login/register/account/addresses/order.liquid` | Área do cliente |
| `multicolumn.liquid` | Bloco de colunas informativas (editável no Customizer) |
| `main-404.liquid` | Página de erro |
| `main-page.liquid` | Template genérico de página de conteúdo |

### Snippets (`snippets/`)

| Arquivo | Função |
|---------|--------|
| `product-card.liquid` | Card de produto reutilizado em todas as PLPs |
| `stock-badge.liquid` | Badge de estoque baseado em `product.metafields.agro.stock_status` |
| `meta-tags.liquid` | Open Graph e metadados SEO |
| `ga4.liquid` | Tag do Google Analytics 4 |

### Lógica de estoque

O badge de estoque tem prioridade: `metafields.agro.stock_status` (valores: `available`, `low`, `unavailable`) > `product.available`. Se o metafield estiver vazio, usa `product.available`.

Na PDP, a exibição do botão "Adicionar ao Carrinho" depende de `product.available AND inventory_quantity > 0`. Caso contrário, exibe apenas "Consultar via WhatsApp" + "Solicitar Cotação Formal".

### Metafields do produto (namespace `agro`)

| Key | Tipo | Uso |
|-----|------|-----|
| `sku_oem` | Single line text | Código OEM exibido na PDP e no card. Tem prioridade sobre `variant.sku` |
| `part_number` | Single line text | Referência OEM do fabricante original |
| `stock_status` | Single line text | `available`, `low` ou `unavailable` |
| `specs` | Multi-line text | Especificações separadas por `\|` no formato `Label: Valor\|Label2: Valor2` |
| `compatibility` | Multi-line text | Modelos compatíveis separados por `\|` |
| `application` | Multi-line text | Aplicações separadas por `\|` (ativa a aba "Aplicação" na PDP) |
| `ficha_tecnica` | URL | Link para PDF da ficha técnica (ativa download na aba "Documentos") |

### WhatsApp

O número e a saudação vêm de `settings.whatsapp_number` e `settings.whatsapp_greeting`, injetados como `window.waNumber` e `window.waGreeting`. Cada contexto tem sua mensagem pré-formatada no template:
- **Card de produto:** `Olá! Interesse na peça *[TÍTULO]* (SKU: [SKU])...`
- **PDP:** `Olá! Tenho interesse na peça *[TÍTULO]* (SKU: [SKU])...`
- **Rodapé / botão flutuante:** `Olá! Preciso de atendimento do SAC da Agro Peças Padrão.`

O `whatsapp.js` também implementa o **predictive search** (debounce 250ms, `/search/suggest.json`, máx. 5 resultados) e o **mobile menu** (toggle por `is-open`/`is-visible`).

---

## Paleta de Cores (tokens CSS)

Todos definidos em `layout/theme.liquid` via `settings.*`:

| Token | Valor padrão | Uso |
|-------|-------------|-----|
| `--color-primary` | `#1B4332` | Verde floresta — botões, headers |
| `--color-primary-dark` | `#153628` | Hover states |
| `--color-primary-mid` | `#2F6B4F` | Gradientes |
| `--color-accent` | `#D4AF37` | Dourado premium — badges, destaques |
| `--color-accent-light` | `#E7C86A` | Trust icons, fundos escuros |
| `--color-accent-dark` | `#B8942B` | Hover do accent |
| `--color-stone-900` | `#1c1917` | Footer |
| `--color-whatsapp` | `#25D366` | Botão WhatsApp |
| `--color-success` | `#22c55e` | Badge "Em Estoque" |
| `--color-error` | `#C62828` | Mensagens de erro |

---

## Configurações do Tema (`config/settings_schema.json`)

Editáveis em **Shopify Admin → Online Store → Themes → Customize → Theme Settings**:

- **Logo:** `logo` (principal), `logo_white` (rodapé/auth), `logo_width`
- **Cores:** `color_primary`, `color_accent`, `color_text`, `color_bg`, `color_footer_bg`, etc.
- **Tipografia:** `font_heading` (barlow-condensed | system), `font_size_base`
- **Marca:** `brand_tagline`, `brand_tagline_footer`, `brand_distributor`, `brand_iso_cert`
- **WhatsApp:** `whatsapp_number` (com DDI, ex: `5541984151085`), `whatsapp_greeting`
- **Loja:** `store_cnpj`, `store_address`, `store_phone`, `store_email`
- **Rodapé:** `footer_tagline`

---

## Utilitários (`util/`)

| Script | Como usar | Função |
|--------|-----------|--------|
| `atualizar-produtos/atualizar_produtos.py` | `python3 atualizar_produtos.py` (no diretório do script) | Sobe imagens (foto 3D + desenho técnico) e PDFs de ficha técnica para produtos existentes na loja. Lê arquivos de `/app_uteis/` local. |
| `atualizar-produtos/sincronizar_loja.py` | `python3 sincronizar_loja.py` | Sincroniza título, descrição, tags, tipo e vendor a partir do `master_products_import.csv`. Cria produtos novos se não encontrados por SKU. Zera estoque de todas as variantes. |
| `atualizar-produtos/cadastrar_produtos.py` | `python3 cadastrar_produtos.py` | Cadastro inicial de produtos. |
| `criar-colecoes/index.js` | `node index.js` (com `.env` configurado) | Cria coleções na loja via API REST. |
| `criar-colecoes/sincronizar.js` | `node sincronizar.js` | Sincroniza produtos com coleções. |
| `optimize-logo.py` | `python3 optimize-logo.py` | Redimensiona logo PNG para 640px Retina-safe. |
| `MANUAL_IDENTIDADE_VISUAL.md` | Referência | Manual completo de brand, paleta, tipografia e tom de voz. |

### Credenciais dos utilitários

Cada subdiretório com scripts tem seu próprio `.env` (ignorado pelo git) com:

```
SHOPIFY_SHOP=agro-pecas-padrao-2
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
```

Os scripts Python usam a API REST `2025-01` com autenticação `client_credentials`. Os scripts Node usam a mesma autenticação.

---

## Master CSV (`master_products_import.csv`)

Fonte da verdade para título, descrição, vendor, tipo, tags e SKUs dos produtos. Importável diretamente no Shopify Admin (Products → Import) ou via `sincronizar_loja.py`.

Colunas relevantes: `Handle`, `Title`, `Body (HTML)`, `Vendor`, `Type`, `Tags`, `Published`, `Status`, `Variant SKU`, `Option1 Name`, `Option1 Value`.

---

## Identidade visual — regras críticas

- **Fonte de títulos:** Barlow Condensed (600/700/800) — uppercase em eyebrows e labels
- **Fonte de corpo:** Barlow (400/500/600)
- **Fonte de códigos técnicos (SKU, part number):** JetBrains Mono — use `<code>` para renderizar
- **Combinações aprovadas de cor:** fundo `#1B4332` + texto branco; botões CTA verde primário em fundo branco; accent dourado apenas como destaque sobre verde ou branco
- **"Padrão OEM"** é o termo correto — nunca "original" isolado
- **"Sob Consulta"** = produto sem estoque (nunca "Indisponível" ou "Esgotado")
- Páginas de auth (login/cadastro): painel esquerdo verde (oculto no mobile) + formulário branco à direita

---

## Dados institucionais

| Campo | Valor |
|-------|-------|
| CNPJ | 66.316.831/0001-85 |
| WhatsApp | `5541984151085` |
| E-mail | comercial@agropecaspadrao.com.br |
| Loja Shopify | agropecaspadrao-2.myshopify.com |
| Fornecedor principal | LIVENZA (distribuidor autorizado) |
| Certificações | ISO 9001 · ISO 14001 · OHSAS 18001 |
