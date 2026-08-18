/* ==========================================================================
   GTM — Pixel personalizado do checkout
   APP Agro Peças Padrão · contêiner GTM-TK3GX7XD

   ONDE COLAR
     Shopify Admin → Configurações → Eventos do cliente → Adicionar pixel
     personalizado → nome "GTM - Checkout" → colar → Salvar → Conectar.

   O QUE ELE ENTREGA (o que o tema não consegue medir)
     add_shipping_info  → checkout_address_info_submitted
     add_payment_info   → payment_info_submitted
     purchase           → checkout_completed
     begin_checkout     → checkout_started   [DESLIGADO por padrão, ver CONFIG]

   POR QUE ESTE ARQUIVO EXISTE
     O tema não renderiza o checkout nem a página de obrigado. Desde 28/08/2025
     a caixa "Additional scripts" da página de status do pedido é somente
     leitura (e em jan/2026 a Shopify apagou o que restava), então script de
     purchase em Liquid com objetos `checkout.*` não roda em lugar nenhum.
     Customer Events é o substituto oficial.

   LEIA ANTES DE CONECTAR — docs/GTM_SETUP.md §6
     • Este pixel roda num IFRAME SANDBOX. O dataLayer aqui é SEPARADO do
       dataLayer do site. Variáveis do storefront não existem aqui.
     • Não assine page_viewed, product_viewed, collection_viewed,
       search_submitted nem cart_viewed: o tema já publica esses eventos e
       sairiam em dobro.
     • O canal "Google & YouTube" JÁ envia purchase para o GA4 e o canal
       "Facebook & Instagram" JÁ envia Purchase para a Meta. Se ligar uma tag
       GA4/Meta de purchase no GTM sem desconectar o canal correspondente,
       cada pedido vira duas compras.
     • Na tag do GTM, sobrescreva page_location com o parâmetro `page_location`
       enviado abaixo — senão o GA4 registra a URL do sandbox.

   Cada push carrega os dois schemas, igual ao tema:
     ecommerce → GA4    (items[], currency, value, coupon, tax, shipping…)
     meta      → Meta Ads (content_ids, content_type, contents, currency,
                           value, num_items)
   ========================================================================== */

(function () {
  /* ----------------------------- CONFIG ----------------------------- */
  var CONFIG = {
    GTM_ID: 'GTM-TK3GX7XD',

    // URL do loader. Trocar pela do GTM Server (stape.io) quando virar
    // server-side — ex.: 'https://sgtm.agropecaspadrao.com.br'
    GTM_HOST: 'https://www.googletagmanager.com',

    // begin_checkout já sai do tema no clique de "Finalizar Compra".
    // Ligar aqui DUPLICA o evento. Só ative se remover o do tema.
    SEND_BEGIN_CHECKOUT: false,

    // ID usado em meta.content_ids. 'feed' = shopify_BR_<produto>_<variante>
    // (retailer_id do catálogo criado pelo canal Facebook & Instagram).
    // Troque para 'sku' se o catálogo da Meta for alimentado por SKU.
    META_ID_SOURCE: 'feed'
  };
  /* ------------------------------------------------------------------ */

  // Carrega o contêiner dentro do sandbox do pixel.
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

  var s = document.createElement('script');
  s.async = true;
  s.src = CONFIG.GTM_HOST + '/gtm.js?id=' + CONFIG.GTM_ID;
  document.head.appendChild(s);

  function num(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
  }

  function toItems(lineItems) {
    return (lineItems || []).map(function (li, i) {
      var v = li.variant || {};
      var p = v.product || {};
      var unit = v.price ? Number(v.price.amount) : 0;
      return {
        item_id: v.sku || String(p.id || ''),
        item_name: p.title || li.title || '',
        affiliation: 'APP Agro Peças Padrão',
        item_brand: p.vendor || '',
        item_category: p.type || '',
        item_variant: v.title && v.title !== 'Default Title' ? v.title : undefined,
        price: num(unit),
        currency: v.price ? v.price.currencyCode : 'BRL',
        quantity: li.quantity || 1,
        index: i + 1,
        product_id: p.id,
        variant_id: v.id,
        sku: v.sku || '',
        // mesmo ID do feed do Merchant Center / catálogo da Meta
        feed_id: 'shopify_BR_' + p.id + '_' + v.id,
        google_business_vertical: 'retail'
      };
    });
  }

  // Mesma tradução GA4 → Meta usada no tema (window.APP_GTM.meta).
  function metaOf(ecom) {
    var items = (ecom && ecom.items) || [];
    var ids = [], contents = [], n = 0, sum = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var q = Number(it.quantity) || 1;
      var pr = Number(it.price) || 0;
      var id = CONFIG.META_ID_SOURCE === 'sku' ? (it.sku || it.item_id) : (it.feed_id || it.item_id);
      n += q; sum += pr * q;
      ids.push(id);
      contents.push({ id: id, quantity: q, item_price: pr });
    }
    return {
      content_type: 'product',
      content_ids: ids,
      contents: contents,
      currency: (ecom && ecom.currency) || 'BRL',
      value: (ecom && typeof ecom.value === 'number') ? ecom.value : num(sum),
      num_items: n
    };
  }

  function coupons(checkout) {
    return (checkout.discountApplications || [])
      .map(function (d) { return d.title || d.code || ''; })
      .filter(Boolean)
      .join(',');
  }

  function pageOf(event) {
    var doc = (event.context && event.context.document) || {};
    return {
      page_location: doc.location ? doc.location.href : '',
      page_title: doc.title || '',
      page_referrer: doc.referrer || ''
    };
  }

  function send(event, name, ecommerce, extra) {
    var payload = { event: name, ecommerce: ecommerce, meta: metaOf(ecommerce) };
    var page = pageOf(event);
    for (var k in page) payload[k] = page[k];
    if (extra) { for (var j in extra) payload[j] = extra[j]; }
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push(payload);
  }

  /* ---------- begin_checkout (opcional — ver CONFIG) ---------- */

  if (CONFIG.SEND_BEGIN_CHECKOUT) {
    analytics.subscribe('checkout_started', function (event) {
      var c = event.data.checkout || {};
      send(event, 'begin_checkout', {
        currency: c.currencyCode || 'BRL',
        value: c.totalPrice ? num(c.totalPrice.amount) : 0,
        coupon: coupons(c),
        items: toItems(c.lineItems)
      });
    });
  }

  /* ---------- add_shipping_info ---------- */

  analytics.subscribe('checkout_address_info_submitted', function (event) {
    var c = event.data.checkout || {};
    send(event, 'add_shipping_info', {
      currency: c.currencyCode || 'BRL',
      value: c.totalPrice ? num(c.totalPrice.amount) : 0,
      coupon: coupons(c),
      shipping_tier: (c.shippingLine && c.shippingLine.title) || 'Padrão',
      items: toItems(c.lineItems)
    });
  });

  /* ---------- add_payment_info ---------- */

  analytics.subscribe('payment_info_submitted', function (event) {
    var c = event.data.checkout || {};
    var tx = (c.transactions && c.transactions[0]) || {};
    send(event, 'add_payment_info', {
      currency: c.currencyCode || 'BRL',
      value: c.totalPrice ? num(c.totalPrice.amount) : 0,
      coupon: coupons(c),
      payment_type: tx.gateway || 'desconhecido',
      items: toItems(c.lineItems)
    });
  });

  /* ---------- purchase ---------- */

  analytics.subscribe('checkout_completed', function (event) {
    var c = event.data.checkout || {};
    var addr = c.billingAddress || c.shippingAddress || {};

    send(
      event,
      'purchase',
      {
        transaction_id: String((c.order && c.order.id) || c.token || ''),
        affiliation: 'APP Agro Peças Padrão',
        value: c.totalPrice ? num(c.totalPrice.amount) : 0,
        tax: c.totalTax ? num(c.totalTax.amount) : 0,
        shipping: c.shippingLine && c.shippingLine.price ? num(c.shippingLine.price.amount) : 0,
        subtotal: c.subtotalPrice ? num(c.subtotalPrice.amount) : 0,
        coupon: coupons(c),
        currency: c.currencyCode || 'BRL',
        items: toItems(c.lineItems)
      },
      {
        // Enhanced Conversions / Advanced Matching.
        // ATENÇÃO: sem hash — o sandbox não expõe crypto síncrono. Na tag do
        // Google Ads marque o campo como "não criptografado" para o próprio
        // Google fazer o hash. Não replique isto para tag de terceiro.
        user_data: {
          email_address: c.email || '',
          phone_number: c.phone || addr.phone || '',
          address: {
            first_name: addr.firstName || '',
            last_name: addr.lastName || '',
            street: addr.address1 || '',
            city: addr.city || '',
            region: addr.provinceCode || '',
            postal_code: addr.zip || '',
            country: addr.countryCode || 'BR'
          }
        },
        customer_id: (c.order && c.order.customer && c.order.customer.id) || undefined,
        order_id: (c.order && c.order.id) || undefined
      }
    );
  });
})();
