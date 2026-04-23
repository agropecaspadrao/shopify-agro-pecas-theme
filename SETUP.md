# APP Agro Peças Padrão — Guia de Instalação Shopify

## 1. Subir o tema

1. Compacte a pasta `shopify-agro-pecas-theme/` em um arquivo `.zip`
2. No Shopify Admin → **Online Store → Themes → Upload theme**
3. Selecione o `.zip` e aguarde o upload
4. Clique em **Customize** para editar ou **Publish** para publicar

---

## 2. Configurar o WhatsApp

1. No Shopify Admin → **Online Store → Themes → Customize**
2. Clique em **Theme Settings** (canto inferior esquerdo)
3. Vá em **WhatsApp** e configure:
   - **Número**: `5541997217541` (somente dígitos com DDI)
   - **Saudação padrão**: personalize a mensagem inicial

---

## 3. Criar as Coleções

Crie estas coleções no Shopify Admin → **Products → Collections**:

| Handle | Título |
|--------|--------|
| `bombas-hidraulicas` | Bombas Hidráulicas |
| `sensores-agricolas` | Sensores Agrícolas |
| `all` | Todos os Produtos |

---

## 4. Importar os Produtos

1. Shopify Admin → **Products → Import**
2. Selecione o arquivo `products_import.csv`
3. Após importar, substitua as imagens placeholder pelas imagens reais da pasta `assets/`

### Imagens por Produto

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
| 5.1302.0547820 | `Livenza_5.1302.0547820-CT_REV._0_p1.png` + `p2.png` |
| 5.1302.0547844 | `Livenza_5.1302.0547844-CT_REV._A_p1.png` |
| 5.1302.0565053 | `Livenza_5.1302.0565053-1_p1.png` |
| 5.1301.0565001 | `Livenza_5.1301.0565001-CT_REV._0_p1.png` |
| 5.1301.0565002 | `Livenza_5.1301.0565002-CT_REV._0_p1.png` |
| 5.1301.0565004 | `Livenza_5.1301.0565004-CT_REV._A_p1.png` |
| 5.0220.0548836 | `Livenza_5.0220.0548836-CT_REV._0_p1.png` |
| SFLX2 | `sensor_SFLX2.jpg` |

---

## 5. Configurar Metafields dos Produtos

Para habilitar os dados avançados (SKU Livenza, compatibilidade, estoque, specs):

### Criar definições de Metafield

Shopify Admin → **Settings → Custom Data → Products → Add definition**

| Namespace | Key | Tipo | Descrição |
|-----------|-----|------|-----------|
| agro | sku_livenza | Single line text | SKU código Livenza |
| agro | part_number | Single line text | Referência OEM |
| agro | stock_status | Single line text | `available`, `low`, ou `unavailable` |
| agro | specs | Multi-line text | Specs separadas por `\|` ex: `Caudal I: 22,5 l/min\|Caudal II: 16 l/min` |
| agro | compatibility | Multi-line text | Modelos separados por `\|` ex: `VALTRA 885\|VALTRA 985` |

### Preencher os metafields

Após criar as definições, edite cada produto individualmente e preencha os metafields. Ou use o **Matrixify** (app Shopify) para importação em massa via planilha.

---

## 6. Criar a Página de Cotação

1. Shopify Admin → **Online Store → Pages → Add page**
2. **Title**: `Cotação`
3. **URL handle**: `cotacao`
4. O template `page.cotacao` será usado automaticamente (já está configurado em `templates/page.cotacao.liquid`)

---

## 7. Configurar os Menus

Shopify Admin → **Online Store → Navigation**

### Menu Principal (`main-menu`)
- Início → `/`
- Bombas Hidráulicas → `/collections/bombas-hidraulicas`
- Sensores Agrícolas → `/collections/sensores-agricolas`
- Solicitar Cotação → `/pages/cotacao`
- Buscar → `/search`

### Rodapé Produtos (`footer-produtos`)
- Bombas Hidráulicas → `/collections/bombas-hidraulicas`
- Sensores Agrícolas → `/collections/sensores-agricolas`
- Todos os Produtos → `/collections/all`

### Rodapé Institucional (`footer-institucional`)
- Sobre Nós → `/pages/sobre`
- Cotação B2B → `/pages/cotacao`
- Contato → `/pages/contato`

---

## 8. Configurar o Banner da Home

1. Shopify Admin → **Online Store → Customize → Home page**
2. Clique no bloco **Banner Principal**
3. Faça upload da imagem `banner-agro.png` (já está em `assets/`)
4. Ajuste o texto, CTAs e opacidade do overlay

---

## 9. Desativar Preços

O tema foi construído **sem exibir preços** por padrão. Para garantir:
- Não configure "Compare at price" em nenhum produto
- Deixe o preço zerado ou use o app **Hide Price** se necessário

---

## 10. Testar

- Abra a loja em modo preview
- Teste a busca: `/?q=john+deere` ou `/search?q=valtra`  
- Teste os links de WhatsApp em cada produto
- Teste o formulário de cotação em `/pages/cotacao`
- Verifique o menu mobile em resolução < 1024px

---

## Suporte

WhatsApp: (41) 99721-7541  
E-mail: contato@appagropecas.com.br
