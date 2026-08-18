# Google Tag Manager — APP Agro Peças Padrão

**Contêiner:** `GTM-TK3GX7XD`
**Loja:** agropecaspadrao.com.br (Shopify OS 2.0, tema custom neste repositório)
**Última revisão:** 18/08/2026

Este documento é a especificação do que o tema publica no `dataLayer` e o roteiro
para montar o contêiner. Quem monta as tags é o gestor de tráfego; quem publica
os dados é o tema.

---

## 0. Conformidade com a tabela de eventos

Mapeamento direto da planilha de requisitos. Coluna "Onde" = quem dispara.

| Evento pedido | GA4 | Parâmetros obrigatórios | Meta Ads | Onde dispara | Status |
|---|---|---|---|---|---|
| `view_item_list` | `view_item_list` | items, **item_list_id**, item_list_name | — | tema (`gtm-events.js`) | ✅ |
| `productClick` | `select_item` | items, item_list_id, item_list_name | — | tema (`gtm-events.js`) | ✅ |
| `view_item` | `view_item` | currency, value, items | `ViewContent` | tema (`gtm-datalayer.liquid`) | ✅ |
| `add_to_cart` | `add_to_cart` | currency, value, items | `AddToCart` | tema (`gtm-events.js`) | ✅ |
| `remove_from_cart` | `remove_from_cart` | currency, value, items | — | tema (`gtm-events.js`) | ✅ |
| `view_cart` | `view_cart` | currency, value, items | — | tema (`gtm-datalayer.liquid`) | ✅ |
| `begin_checkout` | `begin_checkout` | currency, value, **coupon**, items | `InitiateCheckout` | tema (`gtm-events.js`) | ✅ |
| `add_shipping_info` | `add_shipping_info` | currency, value, coupon, **shipping_tier**, items | — | **pixel de checkout** | ✅ |
| `add_payment_info` | `add_payment_info` | currency, value, coupon, **payment_type**, items | `AddPaymentInfo` | **pixel de checkout** | ✅ |
| `orderPlaced` | `purchase` | currency, value, **transaction_id**, coupon, shipping, tax, items | `Purchase` | **pixel de checkout** | ✅ |
| — | `search` | search_term, search_results_count | — | tema (`gtm-datalayer.liquid`) | ✅ extra |
| — | `generate_lead` | lead_method, lead_source, lead_sku… | — | tema (`whatsapp.js` / `gtm-events.js`) | ✅ extra |

**Os parâmetros da Meta já vêm prontos no dataLayer.** Cada evento carrega dois
objetos no mesmo push: `ecommerce` (schema GA4) e `meta` (schema Meta Ads, com
`content_ids`, `content_type`, `contents`, `currency`, `value`, `num_items`).
Não é preciso escrever variável de JavaScript personalizado no GTM — ver §3.4.

`add_shipping_info`, `add_payment_info` e `purchase` **não podem** sair do tema:
acontecem dentro do checkout, que a Shopify não deixa o tema renderizar. Saem do
pixel de Eventos do Cliente — instalação em 2 minutos, §6.

---

## 1. Onde cada evento dispara (leia antes de dizer que não está funcionando)

O erro mais comum no Preview é olhar só a Home. **Na Home só existe
`view_item_list`** — não há PDP para `view_item`, nem carrinho para `view_cart`.
Roteiro para ver a lista inteira:

| Passo | O que fazer | Eventos que aparecem |
|---|---|---|
| 1 | Abrir a Home | `Mensagem` (contexto) + `view_item_list` (Home) |
| 2 | Abrir `/collections/all` | `view_item_list` (nome = título da coleção) |
| 3 | Clicar num card | `select_item` → na página seguinte, `view_item` |
| 4 | Na PDP, "Adicionar ao Carrinho" | `add_to_cart` |
| 5 | Abrir `/cart` | `view_cart` |
| 6 | Clicar "Remover" num item | `remove_from_cart` |
| 7 | Clicar "Finalizar Compra" | `begin_checkout` |
| 8 | Preencher endereço no checkout | `add_shipping_info` * |
| 9 | Escolher forma de pagamento | `add_payment_info` * |
| 10 | Concluir o pedido | `purchase` * |
| 11 | Buscar por "sensor" | `search` |
| 12 | Clicar em qualquer botão de WhatsApp | `generate_lead` |

\* passos 8–10 dependem do pixel de checkout instalado (§6) e aparecem em outra
aba do Preview, porque rodam no sandbox do checkout.

⚠️ **Ligue "Preserve log"** (Preservar registro) no Tag Assistant. `select_item`,
`add_to_cart` e `begin_checkout` disparam no clique que troca de página — sem
preservar o log eles somem da tela antes de você ler.

⚠️ **O pedido mínimo da loja é R$ 200 por carrinho.** Abaixo disso o botão
"Finalizar Compra" fica desabilitado de propósito e `begin_checkout` **não**
dispara — não é bug. Monte um carrinho acima de R$ 200 para testar.

---

## 2. O que já está no ar (lado do tema)

| Arquivo | Papel |
|---------|-------|
| `snippets/gtm.liquid` | Carrega o contêiner no `<head>` |
| `snippets/gtm-noscript.liquid` | `<noscript>` como primeiro elemento do `<body>` |
| `snippets/gtm-datalayer.liquid` | Contexto da página + `view_item`, `view_cart`, `search` + tradutor GA4→Meta |
| `snippets/gtm-item.liquid` | Monta um item no schema GA4 — fonte única de verdade dos campos |
| `assets/gtm-events.js` | `view_item_list`, `select_item`, `add_to_cart`, `remove_from_cart`, `begin_checkout`, `generate_lead` (formulário) |
| `assets/whatsapp.js` | `generate_lead` do WhatsApp (listener delegado, pega qualquer link `wa.me` do site) |
| `docs/gtm-custom-pixel-checkout.js` | `add_shipping_info`, `add_payment_info`, `purchase` |

**Ordem no `<head>`:** `dataLayer` → contêiner. Não inverter — o GTM precisa achar
o `dataLayer` já populado no primeiro tick.

**Configurações** (Customizar → Configurações do tema → **Marketing & Integrações**):

| Campo | Efeito |
|---|---|
| *Ativar as tags do tema* | Interruptor geral. Desmarcado, o tema não injeta nada — nem GTM, nem dataLayer, nem gtag, nem Pixel Meta |
| *ID do contêiner* | `GTM-TK3GX7XD`. Em branco desativa só o contêiner |
| *Servidor do contêiner (server-side)* | Em branco = Google. Para stape.io, cole a URL do servidor sem barra final |
| *Publicar eventos de e-commerce no dataLayer* | Kill-switch dos eventos de e-commerce (lead continua) |
| *Carregar o gtag.js do GA4 direto no tema* | Ver §7 (migração) |

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
  shop_name: 'Agro Peças Padrão',
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
  item_id: 'APP142226',           // metafield agro.sku_oem > SKU da variante > id do produto
  item_name: 'Sensor de Fluxo 25,4mm - APP | Precision Planting PM400',
  affiliation: 'Agro Peças Padrão',
  item_brand: 'APP Agro Peças Padrão',   // vendor
  item_category: 'Sensores Agrícolas',   // type
  item_category2: 'Sensores Agrícolas',  // 1ª coleção (quando existe)
  item_variant: 'Kit 3 un.',      // omitido quando é "Default Title"
  price: 457.26,                  // REAIS, unitário
  discount: 0,                    // reais (compare_at − price)
  currency: 'BRL',
  quantity: 1,
  index: 16,                      // posição na lista
  item_list_id: 'home',           // slug da lista
  item_list_name: 'Home',

  // extras fora do padrão GA4, para mapeamento no GTM:
  product_id: 11046876938513,
  variant_id: 53518646542609,
  sku: 'APP142226',
  feed_id: 'shopify_BR_11046876938513_53518646542609',
  google_business_vertical: 'retail',
  in_stock: true
}
```

> **`item_id` vs `feed_id`:** o GA4 do canal Google & YouTube usa o padrão
> `shopify_BR_<produto>_<variante>`. Para **remarketing dinâmico do Google Ads**
> e para casar com o Merchant Center / catálogo da Meta, use **`feed_id`**.
> Para relatório humano no GA4, `item_id` (o SKU) é o mais legível.

**Valores de `item_list_id` / `item_list_name`:**

| Página | `item_list_id` | `item_list_name` |
|---|---|---|
| Home | `home` | `Home` |
| Coleção | handle da coleção | título da coleção |
| Busca | `search_results` | `Busca` |
| Relacionados na PDP | `related_products` | `Produtos Relacionados` |

### 3.3 Eventos

| `event` | Quando | `ecommerce` |
|---------|--------|-------------|
| `view_item` | PDP carregada | `currency`, `value`, `items[1]` |
| `view_item_list` | Uma vez por grade renderizada | `item_list_id`, `item_list_name`, `items[≤30]` |
| `select_item` | Clique num card da grade | `item_list_id`, `item_list_name`, `items[1]` |
| `add_to_cart` | Submit do form do card ou da PDP | `currency`, `value` (preço × qtd), `items[1]` |
| `remove_from_cart` | Botão "Remover" no carrinho | `currency`, `value`, `items[1]` |
| `view_cart` | Página do carrinho com itens | `currency`, `value`, `coupon`, `items[n]` |
| `begin_checkout` | Clique em "Finalizar Compra" | `currency`, `value`, `coupon`, `items[n]` |
| `add_shipping_info` | Endereço enviado no checkout | `currency`, `value`, `coupon`, `shipping_tier`, `items[n]` |
| `add_payment_info` | Pagamento escolhido no checkout | `currency`, `value`, `coupon`, `payment_type`, `items[n]` |
| `purchase` | Pedido concluído | `transaction_id`, `currency`, `value`, `tax`, `shipping`, `subtotal`, `coupon`, `items[n]` |
| `search` | Página de busca com termo | (fora de `ecommerce`) `search_term`, `search_results_count` |
| `generate_lead` | Clique em `wa.me` **ou** envio da cotação | ver 3.5 |

Todo evento de e-commerce é precedido de `dataLayer.push({ ecommerce: null })` —
o reset exigido pelo GA4 via GTM para o objeto anterior não vazar.

### 3.4 Parâmetros da Meta Ads (objeto `meta`)

No **mesmo push** do evento, ao lado de `ecommerce`:

```js
{
  event: 'add_to_cart',
  ecommerce: { currency: 'BRL', value: 457.26, items: [ … ] },
  meta: {
    content_type: 'product',
    content_ids: ['shopify_BR_11046876938513_53518646542609'],
    contents: [{ id: 'shopify_BR_11046876938513_53518646542609', quantity: 1, item_price: 457.26 }],
    currency: 'BRL',
    value: 457.26,
    num_items: 1,
    content_name: 'Sensor de Fluxo 25,4mm - APP | …',   // só quando é 1 item
    content_category: 'Sensores Agrícolas'              // só quando é 1 item
  }
}
```

Mapeamento na tag da Meta: `ViewContent` ← `view_item`, `AddToCart` ←
`add_to_cart`, `InitiateCheckout` ← `begin_checkout`, `AddPaymentInfo` ←
`add_payment_info`, `Purchase` ← `purchase`.

`content_ids` usa o `feed_id`, que é o `retailer_id` do catálogo criado pelo
canal Facebook & Instagram. Se o catálogo da Meta for alimentado por SKU, use
`{{DLV - ecom items}}` e troque para `sku` — ou, no pixel do checkout, mude
`META_ID_SOURCE` para `'sku'`.

### 3.5 `generate_lead`

Fonte principal de conversão da conta. Dois sabores:

```js
// WhatsApp (assets/whatsapp.js) — pega TODO link wa.me do site
{
  event: 'generate_lead',
  lead_method: 'whatsapp',
  lead_source: 'float' | 'card' | 'pdp' | 'collection' | 'cart' | 'search' | 'home' | …,
  page_type: 'product',
  page_path: '/products/sensor-de-fluxo-…',
  // só quando o clique acontece numa PDP:
  lead_sku: 'APP142226',
  lead_product: 'Sensor de Fluxo 25,4mm - APP …',
  lead_value: 457.26,
  currency: 'BRL'
}

// Cotação formal (assets/gtm-events.js)
{
  event: 'generate_lead',
  lead_method: 'formulario',
  lead_source: 'cotacao_formal',
  page_type: 'page',
  page_path: '/pages/contato',
  lead_sku: '…',
  lead_product: '…'
}
```

`lead_source` separa botão flutuante de card e de PDP — é o que permite otimizar
criativo por posição.

---

## 4. Regra de ouro — quem já mede o quê

A loja **já tinha** dois medidores antes do GTM. Se as tags do contêiner repetirem
o que eles enviam, tudo conta em dobro — receita, conversão e ROAS inflados.

| Evento | Canal Google & YouTube | Canal Facebook & Instagram | Tema (gtag direto) | dataLayer do GTM |
|--------|:---:|:---:|:---:|:---:|
| `page_view` | ✅ envia | ✅ PageView | ❌ (`send_page_view: false`) | — |
| `view_item` / `view_item_list` / `select_item` | ✅ envia | ✅ ViewContent | ❌ | ✅ publica |
| `add_to_cart` / `view_cart` / `remove_from_cart` | ✅ envia | ✅ AddToCart | ❌ | ✅ publica |
| `begin_checkout` / `add_shipping_info` / `add_payment_info` | ✅ envia | ✅ InitiateCheckout | ❌ | ✅ publica |
| `purchase` | ✅ envia | ✅ Purchase | ❌ | ✅ publica (via pixel, §6) |
| `search` | ✅ envia | — | ❌ | ✅ publica |
| `generate_lead` (WhatsApp) | ❌ | ❌ | ✅ envia | ✅ publica |

### O que CRIAR no contêiner

- ✅ **Google Ads** — conversão de `generate_lead` (é a conversão principal da conta).
- ✅ **Google Ads** — conversão de `purchase` (se não preferir importar do GA4).
- ✅ **Google Ads** — remarketing dinâmico (usa `feed_id` + `google_business_vertical`).
- ✅ **Enhanced Conversions** via `user_data` (já vem com hash no storefront).
- ✅ Qualquer pixel novo (Clarity, LinkedIn, TikTok, RD Station…).

### O que NÃO criar sem antes desligar a fonte atual

- ⛔ Tag **GA4 de e-commerce** enquanto o canal **Google & YouTube** estiver ativo
  (Admin → Vendas → Google & YouTube). É ele quem alimenta o GA4 hoje.
- ⛔ **Meta Pixel base / PageView / e-commerce** — o canal **Facebook & Instagram**
  já injeta tudo. O `snippets/meta-pixel.liquid` carrega o `fbq` no documento
  principal **só** para o evento `Lead`.
- ⛔ Tag GA4 `generate_lead` enquanto *Carregar o gtag.js do GA4 direto no tema*
  estiver marcado. Ver §7.

> Se o gestor quiser o GA4 inteiro dentro do GTM: desconecte o GA4 do canal
> Google & YouTube **primeiro**, instale o pixel do checkout (§6) e só então
> construa as tags. O dataLayer já cobre o funil completo, incluindo `purchase`.
> Mesma lógica para a Meta: desligue o canal antes de assumir o pixel no GTM.

---

## 5. Montagem do contêiner

### 5.1 Variáveis (Variável da camada de dados, Versão 2)

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
| `DLV - ecom coupon` | `ecommerce.coupon` |
| `DLV - ecom transaction_id` | `ecommerce.transaction_id` |
| `DLV - ecom tax` | `ecommerce.tax` |
| `DLV - ecom shipping` | `ecommerce.shipping` |
| `DLV - ecom list_id` | `ecommerce.item_list_id` |
| `DLV - ecom list_name` | `ecommerce.item_list_name` |
| `DLV - meta content_ids` | `meta.content_ids` |
| `DLV - meta contents` | `meta.contents` |
| `DLV - meta content_type` | `meta.content_type` |
| `DLV - meta num_items` | `meta.num_items` |
| `DLV - meta value` | `meta.value` |
| `DLV - customer_id` | `customer_id` |
| `DLV - cart_total_value` | `cart_total_value` |
| `DLV - ud email` | `user_data.sha256_email_address` |
| `DLV - ud phone` | `user_data.sha256_phone_number` |
| `DLV - ud city` | `user_data.address.city` |
| `DLV - ud region` | `user_data.address.region` |
| `DLV - ud zip` | `user_data.address.postal_code` |
| `DLV - ud country` | `user_data.address.country` |
| `DLV - page_location` | `page_location` (só existe nos eventos do checkout) |

Variável para **remarketing dinâmico do Google Ads** — JavaScript personalizado:

```js
function () {
  var items = {{DLV - ecom items}} || [];
  return items.map(function (i) { return { id: i.feed_id, google_business_vertical: 'retail' }; });
}
```

### 5.2 Gatilhos (Evento personalizado)

Um para cada: `view_item`, `view_item_list`, `select_item`, `add_to_cart`,
`remove_from_cart`, `view_cart`, `begin_checkout`, `add_shipping_info`,
`add_payment_info`, `purchase`, `search`, `generate_lead`.

Gatilho granular que vale a pena: `generate_lead` **+ condição**
`DLV - lead_method` igual a `whatsapp` — separa lead de WhatsApp de lead de
formulário na conta de Ads.

### 5.3 Tags — o mínimo que entrega valor

**A. Google Ads — Conversão "Lead WhatsApp"**
- Gatilho: `generate_lead` (+ `lead_method = whatsapp`)
- Valor: `{{DLV - lead_value}}` com fallback fixo, ou valor fixo da conta
- Enhanced Conversions: `{{DLV - ud email}}` / `{{DLV - ud phone}}` — já chegam
  com hash, marcar como "já criptografado"

**B. Google Ads — Conversão "Cotação Formal"** — igual, com `lead_method = formulario`

**C. Google Ads — Conversão "Compra"**
- Gatilho: `purchase`
- Valor `{{DLV - ecom value}}`, moeda `{{DLV - ecom currency}}`,
  ID da transação `{{DLV - ecom transaction_id}}`
- No checkout o `user_data` vai **sem hash** — marcar como "não criptografado"

**D. Google Ads — Remarketing dinâmico**
- Gatilho: `view_item`, `view_item_list`, `add_to_cart`, `begin_checkout`, `purchase`
- Itens: a variável de JS da §5.1

**E. Vinculador de conversões** — gatilho *Todas as páginas*. Sem ela o GCLID não
persiste e a atribuição de Ads quebra.

**F. GA4 / Meta** — só depois de desligar a fonte atual (§4).

### 5.4 Consentimento / LGPD

O site hoje **não** tem CMP. Não configure Consent Mode com padrão `denied`,
senão a medição para de subir. Se um banner for instalado, ative o Consent Mode
v2 no GTM e dispare `gtag('consent','update',…)` a partir do CMP — nada disso
está no tema.

---

## 6. Checkout: `add_shipping_info`, `add_payment_info`, `purchase`

O tema **não** renderiza o checkout nem a página de obrigado. Desde **28/08/2025**
a caixa *Additional scripts* da página de status do pedido é somente leitura, e em
**janeiro/2026** a Shopify removeu automaticamente o que ainda estava lá — por isso
script de `purchase` em Liquid com objetos `checkout.*` não funciona mais. O
substituto oficial é **Customer Events (pixels)**.

### Instalação (2 minutos)

1. Shopify Admin → **Configurações → Eventos do cliente → Adicionar pixel personalizado**
2. Nome: `GTM - Checkout`
3. Colar o conteúdo de **`docs/gtm-custom-pixel-checkout.js`**
4. Permissões: *Dados do cliente* conforme a política de privacidade da loja
5. **Salvar** e **Conectar**

Entrega `add_shipping_info`, `add_payment_info` e `purchase` com todos os
parâmetros da tabela do §0, nos dois schemas (`ecommerce` + `meta`).

### Cuidados

- O pixel roda em **iframe sandbox**: é um `dataLayer` **separado** do site.
  No Preview do GTM ele aparece como outro contêiner/aba.
- `page_location` precisa ser sobrescrito na tag pelo valor que o pixel envia —
  senão o GA4 registra a URL do sandbox.
- O pixel **não** assina `page_viewed`, `product_viewed` nem `cart_viewed`: o tema
  já publica esses e sairia em dobro.
- `begin_checkout` sai do **tema** (clique em "Finalizar Compra"). No pixel ele
  está desligado por padrão (`SEND_BEGIN_CHECKOUT: false`). Ligue apenas se
  remover o do tema.
- Se ligar tag GA4/Meta de `purchase` aqui, **desconecte antes** o canal
  correspondente — senão são duas compras por pedido.

### Alternativa sem código

Conversão de compra no Google Ads → **importar do GA4** (Ads → Objetivos →
Conversões → Importar → Google Analytics 4). O canal Google & YouTube já entrega
o `purchase` ao GA4. Zero código, zero duplicação.

---

## 7. Migração do GA4 para dentro do GTM (opcional)

Hoje o tema carrega `gtag.js` direto (`snippets/ga4.liquid`, `G-R0SEJRX1B0`) só
para o `generate_lead`. Para mover isso ao contêiner:

1. Criar no GTM a tag do Google (`G-R0SEJRX1B0`) com **`send_page_view` desligado**.
2. Criar a tag de evento GA4 `generate_lead` com os parâmetros da §3.5.
3. Publicar e conferir no **DebugView** que o evento chega **uma vez**.
4. Só então: Configurações do tema → Marketing & Integrações → **desmarcar**
   *Carregar o gtag.js do GA4 direto no tema*.

O passo 4 é o que evita contagem dupla. Enquanto ele não acontecer, **não crie**
a tag GA4 `generate_lead` no GTM.

Efeito colateral: o parâmetro `content_group` (Home / Produto / Coleção / Busca /
Carrinho) sai do ar. Para recuperá-lo, mapeie `{{DLV - page_type}}` como
`content_group` na tag do Google dentro do GTM.

---

## 8. Server-side (stape.io) — quando for a hora

O tema já está preparado: Configurações do tema → Marketing & Integrações →
**Servidor do contêiner (server-side)**. Cole a URL do GTM Server sem barra final
(ex.: `https://sgtm.agropecaspadrao.com.br`) e tanto o script do `<head>` quanto o
`<noscript>` passam a carregar de lá. No pixel do checkout, ajuste `GTM_HOST` no
bloco `CONFIG`.

---

## 9. QA — checklist antes de publicar o contêiner

1. **Modo Visualizar do GTM** apontando para `agropecaspadrao.com.br`, com
   **Preserve log** ligado.
2. Percorrer o roteiro do §1 inteiro — não julgue pela Home.
3. Em cada evento, abrir a aba **Data Layer** e confirmar:
   - `ecommerce.items[0].price` em **reais** (não centavos)
   - `ecommerce.items[0].feed_id` preenchido
   - `ecommerce.item_list_id` presente em `view_item_list` / `select_item`
   - `meta.content_ids` e `meta.contents` preenchidos
4. Dois `generate_lead` com `lead_source` diferente (botão flutuante = `float`,
   card = `card`).
5. **Tag Assistant** → não pode existir duas tags GA4 na página (uma do tema +
   uma do GTM), e o Meta Pixel aparece uma única vez.
6. **GA4 DebugView** → nenhum evento duplicado.
7. Console limpo — `window.APP_GTM` e `window.dataLayer` definidos.

Teste rápido no console de qualquer página:

```js
// lista os eventos que já entraram no dataLayer
dataLayer.filter(e => e && e.event).map(e => e.event);

// inspeciona o último evento de e-commerce
dataLayer.filter(e => e && e.ecommerce).pop();
```

> **Nota sobre ferramentas headless:** navegadores anti-detecção (patchright,
> alguns crawlers) rodam `evaluate` em contexto isolado e enxergam
> `window.dataLayer` vazio mesmo com tudo funcionando. Confirme sempre no
> Chrome real, com o Tag Assistant.

---

## 10. Deploy

Tudo neste repositório sobe sozinho: commit em `main` → push → tema ativo da loja.
Alterar ID do contêiner, URL do servidor ou os interruptores **não exige deploy** —
são campos de configuração do tema.

O pixel do checkout (§6) é colado no Admin, **não** sobe pelo repositório.

Fontes sobre o fim dos *additional scripts*:
[Shopify Help Center — Non-Plus upgrade guide](https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status/upgrade-guide) ·
[Shopify Community — Removal of script tags and additional scripts](https://community.shopify.com/t/removal-of-script-tags-and-additional-scripts/359858)
