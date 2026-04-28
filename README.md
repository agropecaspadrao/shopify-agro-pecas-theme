# APP Agro Peças Padrão — Shopify Theme

Tema Shopify customizado para [agropecaspadrao.com.br](https://www.agropecaspadrao.com.br).  
Distribuidora especializada em bombas hidráulicas e peças para o agronegócio brasileiro — distribuidor oficial LIVENZA.

---

## Deploy

**O tema faz deploy automático.** Qualquer commit na branch `main` é publicado no Shopify via integração GitHub.  
Não é necessário usar o Shopify CLI para publicar.

```
git push origin main   # → publica automaticamente no tema ativo
```

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Plataforma | Shopify OS 2.0 |
| Templates | Liquid + JSON sections |
| Estilos | CSS puro — `assets/theme.css` |
| Scripts | JS puro — `assets/theme.js` |
| Fontes | Barlow + Barlow Condensed (Google Fonts) |
| Ícones | SVGs inline |

---

## Estrutura de Pastas

```
├── assets/           # CSS, JS, imagens, logo
├── config/           # settings_schema.json + settings_data.json
├── layout/           # theme.liquid (shell HTML + CSS vars)
├── locales/          # pt-BR.json
├── sections/         # Seções editáveis pelo Customizer
├── snippets/         # Partials reutilizáveis
├── templates/        # JSON de página + templates Liquid especiais
└── util/             # Scripts de manutenção e documentação
```

### Seções principais (`sections/`)

| Arquivo | Função |
|---------|--------|
| `header.liquid` | Cabeçalho: logo, search, nav desktop/mobile |
| `footer.liquid` | Rodapé: links, redes, dados da empresa |
| `image-banner.liquid` | Hero banner da home + trust bar |
| `featured-collection.liquid` | Grade de produtos em destaque |
| `collection-list.liquid` | Grid de categorias (home) |
| `all-products.liquid` | Todos os produtos (PLP genérica) |
| `main-product.liquid` | PDP — página de produto |
| `main-collection-product-grid.liquid` | PLP de coleção |
| `main-cart.liquid` | Carrinho |
| `main-search.liquid` | Resultados de busca |
| `multicolumn.liquid` | Bloco de colunas informativas |
| `quem-somos.liquid` | Página Quem Somos |
| `contact-page.liquid` | Página de Contato |
| `main-page.liquid` | Template genérico de página |
| `main-login/register/account/addresses/order.liquid` | Área do cliente |
| `main-404.liquid` | Página de erro |

---

## Paleta de Cores

| Token CSS | Valor | Uso |
|-----------|-------|-----|
| `--color-primary` | `#1B4332` | Verde floresta — cor principal |
| `--color-primary-dark` | `#153628` | Hover e estados ativos |
| `--color-primary-mid` | `#2F6B4F` | Gradientes e variações |
| `--color-accent` | `#D4AF37` | Dourado premium — destaques |
| `--color-accent-light` | `#E7C86A` | Trust icons, decorações |
| `--color-text` | `#2F2F2F` | Texto principal |
| `--color-bg` | `#ffffff` | Fundo padrão |
| `--color-bg-soft` | `#f9f8f7` | Seções zebradas |
| `--color-whatsapp` | `#25D366` | Botão WhatsApp |

Todos os tokens são definidos em `layout/theme.liquid` via `settings.*` e têm fallbacks hardcoded.

---

## Configurações do Tema

Editáveis em **Shopify Admin → Online Store → Themes → Customize → Theme Settings**:

- **Cores** — paleta primária, accent, texto, fundo
- **WhatsApp** — número e saudação padrão
- **Empresa** — CNPJ, endereço, telefone, e-mail
- **Rodapé** — tagline e redes sociais
- **Marca** — distribuidor, certificação ISO

---

## Desenvolvimento Local

```bash
# Instalar Shopify CLI
npm install -g @shopify/cli @shopify/theme

# Preview local (não necessário para deploy — use git push)
shopify theme dev --store agropecaspadrao.myshopify.com
```

---

## Utilitários (`util/`)

| Script | Função |
|--------|--------|
| `optimize-logo.py` | Redimensiona o logo PNG para 640px (Retina-safe) e envia via CLI |
| `MANUAL_IDENTIDADE_VISUAL.md` | Manual completo de brand, paleta, tipografia e tom de voz |

---

## Suporte

- WhatsApp: (41) 9833-3338  
- E-mail: comercial@agropecaspadrao.com.br  
- CNPJ: 66.316.831/0001-85
