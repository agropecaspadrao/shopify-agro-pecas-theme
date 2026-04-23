# APP Agro Peças Padrão — Guia de Instalação Shopify

## 1. Conectar o Tema via GitHub

O tema está hospedado em `https://github.com/agropecaspadrao/shopify-agro-pecas-theme`.

1. Shopify Admin → **Online Store → Themes → Add theme → Connect from GitHub**
2. Autorize o Shopify a acessar sua conta GitHub
3. Selecione o repositório `agropecaspadrao/shopify-agro-pecas-theme`
4. Selecione a branch `main`
5. Clique em **Connect** e aguarde
6. Clique em **Customize** para editar ou **Publish** para publicar

> **Alternativa via ZIP:** Baixe o repositório como `.zip` em GitHub → Code → Download ZIP e faça upload em Online Store → Themes → Upload theme.

---

## 2. Configurar o WhatsApp

1. Shopify Admin → **Online Store → Themes → Customize**
2. Clique em **Theme Settings** (ícone de engrenagem no canto inferior esquerdo)
3. Vá em **WhatsApp** e configure:
   - **Número**: `5541997217541` (somente dígitos com DDI, sem espaços ou símbolos)
   - **Saudação padrão**: personalize a mensagem inicial

---

## 3. Criar as Coleções

Crie estas coleções antes de importar os produtos.

Shopify Admin → **Products → Collections → Create collection**

| Handle (URL) | Título |
|---|---|
| `bombas-hidraulicas` | Bombas Hidráulicas |
| `sensores-agricolas` | Sensores Agrícolas |

> A coleção `all` (Todos os Produtos) é criada automaticamente pelo Shopify — não precisa criar.

---

## 4. Importar os Produtos via CSV

> ⚠️ **Problema conhecido:** O campo `Product Category` do CSV usa a taxonomia interna do Shopify, que não aceita valores em texto livre como `"Agricultural Machinery"`. O Shopify retorna aviso para todas as linhas e **ignora esse campo** — os produtos são importados normalmente, mas sem categoria automática.

### Como importar

1. Shopify Admin → **Products → Import**
2. Selecione o arquivo `products_import.csv`
3. Clique em **Upload and continue**
4. Ignore os avisos de `"Agricultural Machinery" is not a valid product category` — eles não impedem a importação
5. Confirme a importação

### Corrigir a categoria manualmente (opcional)

Após importar, atribua a categoria correta em cada produto:

1. Abra um produto → campo **Product category**
2. Busque por `Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts`
3. Repita para cada produto, ou use o **bulk edit** selecionando todos e editando em massa

### Adicionar os produtos às coleções

Após importar, associe cada produto à coleção correta:

- **Bombas Hidráulicas**: todos os produtos com tipo `Bombas Hidráulicas`
- **Sensores Agrícolas**: `Sensor de Fluxo SFLX2` e `Sensor de Semente PUL-2`

Você pode fazer isso em **Products → Collections → [nome da coleção] → Browse products**.

---

## 5. Subir as Imagens dos Produtos

As imagens estão na pasta `assets/` do repositório. Após a importação do CSV, substitua as imagens placeholder pelas fotos reais:

| SKU | Arquivo de Imagem |
|-----|-------------------|
| 5.0220.0548824-2 | `5.0220.0548824-2_p1.png` |
| 5.1301.0565008 | `5.1301.0565008_p1.png` |
| 5.1301.0565017 | `5.1301.0565017_p1.png` |
| 5.1301.0565035 | `5.1301.0565035_p1.png` |
| 5.1305.0565036 | `5.1305.0565036_p1.png` |
| 5.1305.0565071 | `5.1305.0565071_p1.png` |
| 5.0220.0547201 | `Livenza_5.0220.0547201-CT_REV._0_p1.png` |
| 5.0220.0547205 | `Livenza_5.0220.0547205-CT_REV._0_p1.png` |
| 5.0220.0547206 | `Livenza_5.0220.0547206-CT_REV._0_p1.png` |
| 5.1302.0547820 | `Livenza_5.1302.0547820-CT_REV._0_p1.png` + `...p2.png` (2 imagens) |
| 5.1302.0547844 | `Livenza_5.1302.0547844-CT_REV._A_p1.png` |
| 5.1302.0565053 | `Livenza_5.1302.0565053-1_p1.png` |
| 5.1301.0565001 | `Livenza_5.1301.0565001-CT_REV._0_p1.png` |
| 5.1301.0565002 | `Livenza_5.1301.0565002-CT_REV._0_p1.png` |
| 5.1301.0565004 | `Livenza_5.1301.0565004-CT_REV._A_p1.png` |
| 5.0220.0548836 | `Livenza_5.0220.0548836-CT_REV._0_p1.png` |
| SFLX2 | `sensor_SFLX2.jpg` |

---

## 6. Configurar Metafields dos Produtos

Os metafields habilitam dados avançados na PDP: SKU Livenza, referência OEM, badge de estoque, especificações e compatibilidade.

### Criar as definições

Shopify Admin → **Settings → Custom Data → Products → Add definition**

| Namespace | Key | Tipo | Para que serve |
|-----------|-----|------|----------------|
| `agro` | `sku_livenza` | Single line text | Código SKU Livenza exibido na PDP e no card |
| `agro` | `part_number` | Single line text | Referência OEM do fabricante |
| `agro` | `stock_status` | Single line text | Badge de estoque: `available`, `low` ou `unavailable` |
| `agro` | `specs` | Multi-line text | Especificações separadas por `\|` (ex: `Caudal I: 22,5 l/min\|Caudal II: 16 l/min`) |
| `agro` | `compatibility` | Multi-line text | Modelos compatíveis separados por `\|` (ex: `VALTRA 885\|VALTRA 985`) |

### Preencher os metafields

**Opção A — Manual:** Edite cada produto no admin e preencha os campos `agro.*` no final da página.

**Opção B — Em massa:** Use o app **Matrixify** (gratuito até certo limite) para importar os metafields via planilha Excel/CSV. É o método mais rápido para os 18 produtos.

---

## 7. Criar a Página de Cotação

1. Shopify Admin → **Online Store → Pages → Add page**
2. **Title**: `Cotação`
3. **URL handle**: `cotacao` (verificar em "Website SEO")
4. O template `page.cotacao` é aplicado automaticamente pois o arquivo `templates/page.cotacao.liquid` já existe no tema

---

## 8. Configurar os Menus

Shopify Admin → **Online Store → Navigation**

### Menu Principal (`main-menu`)

| Item | URL |
|------|-----|
| Início | `/` |
| Bombas Hidráulicas | `/collections/bombas-hidraulicas` |
| Sensores Agrícolas | `/collections/sensores-agricolas` |
| Solicitar Cotação | `/pages/cotacao` |
| Buscar | `/search` |

### Rodapé Produtos (`footer-produtos`)

| Item | URL |
|------|-----|
| Bombas Hidráulicas | `/collections/bombas-hidraulicas` |
| Sensores Agrícolas | `/collections/sensores-agricolas` |
| Todos os Produtos | `/collections/all` |

### Rodapé Institucional (`footer-institucional`)

| Item | URL |
|------|-----|
| Sobre Nós | `/pages/sobre` |
| Cotação B2B | `/pages/cotacao` |
| Contato | `/pages/contato` |

---

## 9. Configurar o Banner da Home

1. Shopify Admin → **Online Store → Themes → Customize → Home page**
2. Clique no bloco **Banner Principal**
3. Faça upload da imagem `banner-agro.png` (disponível na pasta `assets/` do repositório)
4. Ajuste título, subtítulo, CTAs e opacidade do overlay

---

## 10. Preços

O tema foi construído **sem exibir preços** — nenhum campo de preço aparece nas páginas. Para garantir:

- Deixe os produtos sem preço configurado, ou defina como `0`
- Não exiba "Compare at price"
- Se precisar ocultar o preço por segurança adicional, use o app **Hulk Hide Price**

---

## 11. Testar antes de publicar

- [ ] Home carrega banner, categorias e produtos em destaque
- [ ] PLP filtra por categoria e disponibilidade
- [ ] PDP exibe SKU, badge de estoque, botão WhatsApp e formulário de cotação
- [ ] Busca em `/search?q=john+deere` retorna resultados
- [ ] Formulário de cotação em `/pages/cotacao` envia corretamente
- [ ] Links de WhatsApp abrem com mensagem pré-preenchida no celular
- [ ] Menu mobile funciona em resolução < 1024px

---

## Problemas conhecidos e soluções

| Problema | Causa | Solução |
|----------|-------|---------|
| `"Agricultural Machinery" is not a valid product category` | Taxonomia do Shopify não aceita texto livre nesse campo | Ignore o aviso — produtos são importados normalmente; corrija a categoria manualmente depois |
| `Branch isn't a valid theme` no GitHub integration | `{% sections %}` (plural) com JSON de section group inválido | Corrigido: tema agora usa `{% section %}` (singular) diretamente no `theme.liquid` |

---

## Suporte

WhatsApp: (41) 99721-7541  
E-mail: contato@appagropecas.com.br
