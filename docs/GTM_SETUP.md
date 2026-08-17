# Google Tag Manager — APP Agro Peças Padrão

**Contêiner:** `GTM-TK3GX7XD`
**Loja:** agropecaspadrao.com.br (Shopify OS 2.0, tema custom neste repositório)
**Implementado no tema em:** 16/08/2026

Este documento é a especificação do que o tema publica no `dataLayer` e o roteiro
para montar o contêiner. Quem monta as tags é o gestor de tráfego; quem publica
os dados é o tema.

---

## 1. O que já está no ar (lado do tema)

| Arquivo | Papel |
|---------|-------|
| `snippets/gtm.liquid` | Carrega o contêiner no `<head>` |
| `snippets/gtm-noscript.liquid` | `<noscript>` como primeiro elemento do `<body>` |
| `snippets/gtm-datalayer.liquid` | Contexto da página + `view_item`, `view_cart`, `search` (renderizado no servidor) |
| `snippets/gtm-item.liquid` | Monta um item no schema GA4 — fonte única de verdade dos campos |
| `assets/gtm-events.js` | `view_item_list`, `select_item`, `add_to_cart`, `remove_from_cart`, `begin_checkout`, `generate_lead` (formulário) |
| `assets/whatsapp.js` | `generate_lead` do WhatsApp (listener delegado, pega qualquer link `wa.me` do site) |

**Ordem no `<head>`:** `dataLayer` → contêiner. Não inverter — o GTM precisa achar
o `dataLayer` já populado no primeiro tick.

**Onde mudar o ID:** Customizar → Configurações do tema → **Marketing & Integrações**
→ *Google Tag Manager* → *ID do contêiner*. Em branco desativa o GTM no site.

**Kill-switch dos eventos:** no mesmo painel, *Publicar eventos de e-commerce no dataLayer*.

---

## 2. Regra de ouro — quem já mede o quê

A loja **já tinha** dois medidores antes do GTM. Se as tags do contêiner repetirem
o que eles enviam, tudo conta em dobro — receita, conversão e ROAS ficam inflados.

| Evento | Canal Google & YouTube (web pixel) | Canal Facebook & Instagram | Tema (gtag direto) | dataLayer do GTM |
|--------|:---:|:---:|:---:|:---:|
| `page_view` | ✅ envia | ✅ PageView | ❌ (`send_page_view: false`) | — |
| `view_item` / `view_item_list` / `select_item` | ✅ envia | ✅ ViewContent | ❌ | ✅ publica |
| `add_to_cart` / `view_cart` / `remove_from_cart` | ✅ envia | ✅ AddToCart | ❌ | ✅ publica |
| `begin_checkout` / `add_payment_info` | ✅ envia | ✅ InitiateCheckout | ❌ | ✅ publica (`begin_checkout`) |
| `purchase` | ✅ envia | ✅ Purchase | ❌ | ❌ **não sai do tema** (ver §6) |
| `search` | ✅ envia | — | ❌ | ✅ publica |
| `generate_lead` (WhatsApp) | ❌ | ❌ | ✅ envia | ✅ publica |

### O que CRIAR no contêiner

- ✅ **Google Ads** — conversão de `generate_lead` (é a conversão principal da conta).
- ✅ **Google Ads** — remarketing dinâmico (usa `feed_id` + `google_business_vertical`).
- ✅ **Enhanced Conversions** do Google Ads via `user_data` (já vem com hash SHA-256).
- ✅ Qualquer pixel novo (Clarity, LinkedIn, TikTok, RD Station…).

### O que NÃO criar (contagem dupla garantida)

- ❌ Tag GA4 de e-commerce (`view_item`, `add_to_cart`, `purchase`…) enquanto o canal
  **Google & YouTube** estiver ativo em Shopify Admin → Vendas → Google & YouTube.
- ❌ Meta Pixel base / `PageView` / eventos de e-commerce — o canal **Facebook &
  Instagram** já injeta tudo, e o `snippets/meta-pixel.liquid` já carrega o `fbq`
  no documento principal para o evento `Lead`.
- ❌ Tag GA4 `generate_lead` **enquanto** *Carregar o gtag.js do GA4 direto no tema*
  estiver marcado nas configurações. Ver §7 (migração).

> Se o gestor quiser o GA4 inteiro dentro do GTM, o caminho é **desconectar o
> GA4 do canal Google & YouTube primeiro** — mas aí se perde o `purchase`, que o
> tema não consegue medir (§6). Recomendação: manter o canal como fonte de
> e-commerce e usar o GTM para mídia paga e leads.

---

## 3. Referência do `dataLayer`

### 3.1 Contexto da página (push inicial, sem `event`)

Presente em **todas** as páginas, antes do contêiner carregar:

```js
{
  page_type: 'home' | 'product' | 'collection' | 'search' | 'cart' | 'page' | 'collection_list' | 'not_found',
  page_template: 'index',
  page_title: 'Bomba Hidráulica ...',
  shop_currency: 'BRL',
  shop_name: 'APP Agro Peças Padrão',
  cart_total_value: 0.0,          // reais, não centavos
  cart_item_count: 0,
  customer_logged_in: false,

  // só quando há cliente logado:
  customer_id: 1234567890,
  customer_orders_count: 3,
  customer_total_spent: 4870.5,
  user_data: {
    sha256_email_address: '…',    // e-mail em minúsculas, sem espaços, SHA-256
    sha256_phone_number:  '…',    // normalizado para E.164 (+55…) antes do hash
    address: {
      sha256_first_name: '…',
      sha256_last_name:  '…',
      city: 'Curitiba', region: 'PR', postal_code: '80000-000', country: 'BR'
    }
  }
}
```

Nunca sai PII em texto puro. O formato de `user_data` é exatamente o que o
**Google Ads Enhanced Conversions** espera — dá para ligar direto na tag.

### 3.2 Objeto de item (`ecommerce.items[]`)

Todo evento de e-commerce usa este formato:

```js
{
  item_id: '5.1301.0565008',      // metafield agro.sku_oem > SKU da variante > id do produto
  item_name: 'Bomba Hidráulica - LIVENZA 5.1301.0565008 | Valtra BH180',
  affiliation: 'APP Agro Peças Padrão',
  item_brand: 'LIVENZA',          // vendor
  item_category: 'Bomba Hidráulica',  // type
  item_category2: 'Bombas Hidráulicas', // 1ª coleção (quando existe)
  item_variant: 'Kit 3 un.',      // omitido quando é "Default Title"
  price: 1899.9,                  // REAIS, unitário
  discount: 200.0,                // reais (compare_at − price), 0 se não houver
  currency: 'BRL',
  quantity: 1,
  index: 3,                       // posição na lista (eventos de lista)
  item_list_name: 'Bombas Hidráulicas',

  // extras fora do padrão GA4, para mapeamento no GTM:
  product_id: 8123456789,
  variant_id: 44987654321,
  sku: 'GR140990-20M',
  feed_id: 'shopify_BR_8123456789_44987654321',
  google_business_vertical: 'retail',
  in_stock: true
}
```

> **`item_id` vs `feed_id`:** o GA4 do canal Google & YouTube usa o padrão
> `shopify_BR_<produto>_<variante>`. Para o **remarketing dinâmico do Google Ads**
> e para casar com o Merchant Center, use **`feed_id`**, não `item_id`.
> Para relatório humano no GA4, `item_id` (o SKU) é o mais legível.

### 3.3 Eventos

| `event` | Quando | Payload adicional |
|---------|--------|-------------------|
| `view_item` | PDP carregada | `ecommerce.value`, `ecommerce.currency`, `items[1]` |
| `view_item_list` | Uma vez por grade renderizada (home, coleção, busca, relacionados) | `ecommerce.item_list_name`, `items[≤30]` |
| `select_item` | Clique num card da grade | `ecommerce.item_list_name`, `items[1]` |
| `add_to_cart` | Submit do form do card ou da PDP | `ecommerce.value` (preço × qtd), `items[1]` |
| `remove_from_cart` | Botão "Remover" no carrinho | `ecommerce.value`, `items[1]` |
| `view_cart` | Página do carrinho com itens | `ecommerce.value` = total, `items[n]` |
| `begin_checkout` | Clique em "Finalizar Compra" | `ecommerce.value` = total, `items[n]` |
| `search` | Página de busca com termo | `search_term`, `search_results_count` |
| `generate_lead` | Clique em qualquer link `wa.me` **ou** envio da cotação formal | ver abaixo |

Todo evento de e-commerce é precedido de `dataLayer.push({ ecommerce: null })` —
o reset exigido pelo GA4 via GTM para o objeto anterior não vazar.

#### `generate_lead`

Fonte principal de conversão da conta. Dois sabores:

```js
// WhatsApp (assets/whatsapp.js) — pega TODO link wa.me do site
{
  event: 'generate_lead',
  lead_method: 'whatsapp',
  lead_source: 'float' | 'card' | 'pdp' | 'collection' | 'cart' | 'search' | 'home' | 'footer' | …,
  page_type: 'product',
  page_path: '/products/bomba-hidraulica-...',
  // só quando o clique acontece numa PDP:
  lead_sku: '5.1301.0565008',
  lead_product: 'Bomba Hidráulica - LIVENZA …',
  lead_value: 1899.9,
  currency: 'BRL'
}

// Cotação formal (assets/gtm-events.js)
{
  event: 'generate_lead',
  lead_method: 'formulario',
  lead_source: 'cotacao_formal',
  page_type: 'page',
  page_path: '/pages/contato',
  lead_sku: '…',        // quando o campo veio preenchido
  lead_product: '…'
}
```

`lead_source` separa botão flutuante de card e de PDP — é o que permite otimizar
criativo por posição. **Não** existe `value` no lead do WhatsApp fora da PDP: se a
conta precisar de valor de conversão, defina um valor fixo na tag do Google Ads.

---

## 4. Montagem do contêiner

### 4.1 Variáveis (Variável da camada de dados)

Nome sugerido → *Nome da variável da camada de dados*:

| Nome no GTM | Caminho |
|-------------|---------|
| `DLV - page_type` | `page_type` |
| `DLV - lead_method` | `lead_method` |
| `DLV - lead_source` | `lead_source` |
| `DLV - lead_sku` | `lead_sku` |
| `DLV - lead_product` | `lead_product` |
| `DLV - lead_value` | `lead_value` |
| `DLV - search_term` | `search_term` |
| `DLV - search_results_count` | `search_results_count` |
| `DLV - ecom value` | `ecommerce.value` |
| `DLV - ecom currency` | `ecommerce.currency` |
| `DLV - ecom items` | `ecommerce.items` |
| `DLV - customer_id` | `customer_id` |
| `DLV - cart_total_value` | `cart_total_value` |
| `DLV - ud email` | `user_data.sha256_email_address` |
| `DLV - ud phone` | `user_data.sha256_phone_number` |
| `DLV - ud city` | `user_data.address.city` |
| `DLV - ud region` | `user_data.address.region` |
| `DLV - ud zip` | `user_data.address.postal_code` |
| `DLV - ud country` | `user_data.address.country` |

Versão da camada de dados: **Versão 2** em todas.

Variável extra útil — **feed_id do primeiro item**, para o remarketing:
tipo *JavaScript personalizado*

```js
function () {
  var items = {{DLV - ecom items}} || [];
  return items.map(function (i) { return { id: i.feed_id, google_business_vertical: 'retail' }; });
}
```

### 4.2 Gatilhos (Evento personalizado)

Um para cada: `view_item`, `view_item_list`, `select_item`, `add_to_cart`,
`remove_from_cart`, `view_cart`, `begin_checkout`, `search`, `generate_lead`.

Gatilho mais granular que vale a pena: `generate_lead` **+ condição**
`DLV - lead_method` igual a `whatsapp` — separa lead de WhatsApp de lead de
formulário na conta de Ads.

### 4.3 Tags — o mínimo que entrega valor

**A. Google Ads — Conversão "Lead WhatsApp"**
- Tipo: Rastreamento de conversões do Google Ads
- Gatilho: `generate_lead` (+ `lead_method = whatsapp`)
- Valor da conversão: `{{DLV - lead_value}}` com fallback fixo, ou valor fixo da conta
- Dados fornecidos pelo usuário (Enhanced Conversions): ligar em `{{DLV - ud email}}`
  e `{{DLV - ud phone}}` — já chegam com hash, marcar o campo como "já criptografado"

**B. Google Ads — Conversão "Cotação Formal"**
- Mesmo modelo, gatilho `generate_lead` + `lead_method = formulario`

**C. Google Ads — Remarketing dinâmico**
- Tipo: Remarketing do Google Ads
- Gatilho: `view_item`, `view_item_list`, `add_to_cart`, `begin_checkout`
- `Enviar dados de comércio eletrônico` → *Camada de dados*, ou parâmetros manuais
  usando a variável de `feed_id` da §4.1 (é o que casa com o Merchant Center)

**D. Google Ads — Tag do Google (linker / conversion linker)**
- Tipo: Vinculador de conversões, gatilho *Todas as páginas*. Sem ela o GCLID
  não persiste e a atribuição de Ads quebra.

**E. (opcional) GA4 — apenas eventos que o canal não cobre**
- `generate_lead` — **somente depois** de desligar o gtag do tema (§7)

### 4.4 Consentimento / LGPD

O site hoje **não** tem CMP (banner de consentimento). Consequência prática:
não configurar Consent Mode com padrão `denied`, senão a medição para de subir.
Se um banner for instalado depois, o caminho é ativar o Consent Mode v2 no GTM e
disparar `gtag('consent','update',…)` a partir do CMP — nada disso está no tema.

---

## 5. Sobre o script que veio do gestor

O trecho enviado tem três problemas — dois de digitação e um estrutural:

1. **ID placeholder.** A última linha do loader estava com `'GTM-xxxxx'` em vez de
   `GTM-TK3GX7XD`. Corrigido em `snippets/gtm.liquid`.
2. **Faltava o `<noscript>`** que vai como primeiro elemento do `<body>`.
   Adicionado em `snippets/gtm-noscript.liquid`.
3. **O bloco do `purchase` não roda em lugar nenhum deste tema.** Ele usa objetos
   `checkout.*` e `first_time_accessed`, que só existem no `checkout.liquid` /
   *Additional scripts* da página de status do pedido. Ver §6.

Detalhes menores do bloco original, para referência: `'transaction_id'` estava com
`| json` dentro de aspas (viraria `"\"1001\""`), `'phone'` aparecia duas vezes na
mesma chave, `'discount'` dentro do loop de itens referenciava a variável `discount`
do loop de descontos — que já tinha saído de escopo — e `line_item.product.price`
pega o preço do produto, não o da linha vendida. Nenhum desses foi reaproveitado:
o `purchase` foi remontado do zero em `docs/gtm-custom-pixel-checkout.js`.

---

## 6. Purchase e o funil de checkout

**O tema não renderiza o checkout nem a página de obrigado.** Desde **28/08/2025**
a caixa *Additional scripts* da página de status do pedido é somente leitura, e em
**janeiro/2026** a Shopify removeu automaticamente o que ainda estava lá. O
substituto oficial é **Customer Events (pixels)**.

### Opção 1 — recomendada: não medir purchase pelo GTM

- `purchase` no GA4 → já vem do canal **Google & YouTube**.
- `Purchase` na Meta → já vem do canal **Facebook & Instagram**.
- Conversão de compra no Google Ads → **importar do GA4** (Ads → Objetivos →
  Conversões → Importar → Google Analytics 4). Zero código, zero duplicação.

Como a conversão principal da operação é lead de WhatsApp e não compra no site,
esta opção cobre 100% da necessidade de mídia.

### Opção 2 — GTM dono do purchase

Se houver motivo real para o `purchase` sair do contêiner (ex.: pixel de terceiro
que só existe no GTM), use o pixel pronto em **`docs/gtm-custom-pixel-checkout.js`**:

1. Shopify Admin → **Configurações → Eventos do cliente → Adicionar pixel personalizado**
2. Nome: `GTM - Checkout`
3. Cole o conteúdo do arquivo, salve e **Conectar**
4. Permissões: *Dados do cliente* → conforme a política de privacidade da loja

Cuidados desse caminho:

- O pixel roda em **iframe sandbox**: é um `dataLayer` **separado** do site. As
  tags que dependem de variáveis do storefront não enxergam nada ali.
- `page_location` precisa ser sobrescrito na tag pelo valor que o pixel envia
  (`page_location` do push) — senão o GA4 registra a URL do sandbox.
- O pixel assina **só** `checkout_completed`. Não assine `page_viewed`,
  `product_viewed` nem `cart_viewed`: o tema já publica esses e sairia em dobro.
- Se ligar a tag GA4 `purchase` aqui, **desconecte o GA4 do canal Google & YouTube**
  antes — senão são duas compras por pedido.

---

## 7. Migração do GA4 para dentro do GTM (opcional, futuro)

Hoje o tema carrega `gtag.js` direto (`snippets/ga4.liquid`, `G-R0SEJRX1B0`) só
para o `generate_lead`. Para mover isso ao contêiner:

1. Criar no GTM a tag do Google (`G-R0SEJRX1B0`) com **`send_page_view` desligado**
   (o `page_view` continua vindo do canal).
2. Criar a tag de evento GA4 `generate_lead` com os parâmetros da §3.3.
3. Publicar o contêiner e conferir no **DebugView** que o evento chega **uma vez**.
4. Só então: Customizar → Configurações do tema → Marketing & Integrações →
   **desmarcar** *Carregar o gtag.js do GA4 direto no tema*.

O passo 4 é o que evita contagem dupla. Enquanto ele não acontecer, **não crie**
a tag GA4 `generate_lead` no GTM.

Efeito colateral do passo 4: o parâmetro `content_group` (Home / Produto / Coleção /
Busca / Carrinho) sai do ar. Para recuperá-lo, mapeie `{{DLV - page_type}}` como
`content_group` na tag do Google dentro do GTM.

---

## 8. QA — checklist antes de publicar o contêiner

1. **Modo Visualizar do GTM** apontando para `agropecaspadrao.com.br`.
2. Percorrer: home → coleção → PDP → adicionar ao carrinho → carrinho → finalizar.
   Conferir a sequência `view_item_list` → `select_item` → `view_item` →
   `add_to_cart` → `view_cart` → `begin_checkout`.
3. Em cada evento, abrir a aba **Data Layer** e confirmar que `ecommerce.items[0]`
   tem `item_id`, `price` **em reais** (não centavos) e `feed_id` preenchido.
4. Clicar no botão flutuante do WhatsApp e num "Consultar via WhatsApp" de card:
   dois `generate_lead` com `lead_source` diferente (`float` e `card`).
5. Buscar por um SKU: evento `search` com `search_term`.
6. **Tag Assistant** → confirmar que **não** existem duas tags do GA4 na página
   (uma do tema + uma do GTM) e que o Meta Pixel aparece uma única vez.
7. **GA4 DebugView** → nenhum evento chegando duplicado.
8. Console do navegador limpo — `window.APP_GTM` e `window.dataLayer` definidos.

Teste rápido no console de qualquer página:

```js
window.dataLayer.filter(function (e) { return e.event; }).map(function (e) { return e.event; });
```

---

## 9. Deploy

Tudo neste repositório sobe sozinho: commit em `main` → push → tema ativo da loja.
Alterar o ID do contêiner **não exige deploy** — é campo de configuração do tema.

Fontes sobre o fim dos *additional scripts*:
[Shopify Help Center — Non-Plus upgrade guide](https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status/upgrade-guide) ·
[Shopify Community — Removal of script tags and additional scripts](https://community.shopify.com/t/removal-of-script-tags-and-additional-scripts/359858)
