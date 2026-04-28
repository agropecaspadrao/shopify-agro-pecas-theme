# APP Agro Peças Padrão — Guia de Instalação

## 1. Conectar o Tema via GitHub

O tema publica automaticamente via integração GitHub ↔ Shopify.

1. Shopify Admin → **Online Store → Themes → Add theme → Connect from GitHub**
2. Autorize o Shopify a acessar sua conta GitHub
3. Selecione o repositório `agropecaspadrao/shopify-agro-pecas-theme`
4. Selecione a branch `main`
5. Clique em **Connect**
6. Clique em **Publish** para ativar

> A partir desse ponto, todo commit em `main` publica automaticamente — sem necessidade de CLI.

---

## 2. Configurar o Theme Settings

Shopify Admin → **Online Store → Themes → Customize → Theme Settings (ícone de engrenagem)**

### WhatsApp
- **Número**: `5541998333338` (DDI + DDD + número, somente dígitos)
- **Saudação**: `Olá! Estava navegando no catálogo da APP Agro Peças Padrão e tenho interesse na peça`

### Dados da Empresa
- **CNPJ**: `66.316.831/0001-85`
- **Telefone**: `(41) 9833-3338`
- **E-mail**: `comercial@agropecaspadrao.com.br`
- **Endereço**: `R. José Benedito Cottolengo, 901 — Casa 19, Cond. Jardim de Monet, Campo Comprido, Curitiba – PR, CEP 81.220-310`

---

## 3. Configurar o Banner da Home

1. Shopify Admin → **Online Store → Themes → Customize → Home page**
2. Clique no bloco **Banner Principal**
3. Configure título, subtítulo e CTAs
4. A imagem de fundo padrão já está no repositório: `APP - WALLPAPER - BANNER - HEADER.jpg`
5. Para trocar: faça upload em **Image de Fundo** no painel do bloco
6. **Opacidade do Overlay**: recomendado entre 35–50% para garantir leitura do texto

---

## 4. Criar as Coleções

Shopify Admin → **Products → Collections → Create collection**

| Handle (URL) | Título sugerido |
|---|---|
| `bombas-hidraulicas` | Bombas Hidráulicas |
| `sensores-agricolas` | Sensores Agrícolas |
| `filtros` | Filtros |
| `kits-reparo` | Kits de Reparo |

A coleção `all` é criada automaticamente pelo Shopify.

---

## 5. Importar Produtos via CSV

1. Shopify Admin → **Products → Import**
2. Selecione o arquivo CSV de produtos
3. Após importar, associe cada produto à coleção correta via **Collections → Browse products**

> **Aviso esperado:** `"Agricultural Machinery" is not a valid product category` — ignore, não impede a importação.

---

## 6. Configurar Metafields dos Produtos

Shopify Admin → **Settings → Custom Data → Products → Add definition**

| Namespace | Key | Tipo | Finalidade |
|-----------|-----|------|-----------|
| `agro` | `sku_livenza` | Single line text | Código SKU Livenza exibido na PDP |
| `agro` | `part_number` | Single line text | Referência OEM do fabricante |
| `agro` | `stock_status` | Single line text | Badge: `available`, `low` ou `unavailable` |
| `agro` | `specs` | Multi-line text | Especificações separadas por `\|` |
| `agro` | `compatibility` | Multi-line text | Modelos compatíveis separados por `\|` |

---

## 7. Configurar os Menus

Shopify Admin → **Online Store → Navigation**

### Menu Principal (`main-menu`)

| Item | URL |
|------|-----|
| Início | `/` |
| Produtos | `/collections/all` |
| Catálogo | `/collections` |
| Quem Somos | `/pages/quem-somos` |
| Contato | `/pages/contato` |

---

## 8. Criar Páginas de Conteúdo

Shopify Admin → **Online Store → Pages → Add page**

| Handle | Título | Template |
|--------|--------|---------|
| `quem-somos` | Quem Somos Nós | `page.quem-somos` |
| `contato` | Contato | `page.contact` |
| `politica-de-devolucao` | Política de Devolução | `page` (padrão) |
| `politica-de-envio` | Política de Envio | `page` (padrão) |

---

## 9. Checklist antes de publicar

- [ ] Home carrega banner e produtos em destaque
- [ ] Grade de categorias aparece na home
- [ ] PDP exibe SKU, badge de estoque e botão WhatsApp
- [ ] Busca retorna resultados em `/search?q=john+deere`
- [ ] Links de WhatsApp abrem com mensagem pré-preenchida
- [ ] Menu mobile funciona em resolução < 1024px
- [ ] Rodapé exibe CNPJ, endereço e telefone corretos
- [ ] Trust bar aparece abaixo do banner (entrega, estoque, suporte, pagamento)

---

## Suporte

WhatsApp: (41) 9833-3338  
E-mail: comercial@agropecaspadrao.com.br
