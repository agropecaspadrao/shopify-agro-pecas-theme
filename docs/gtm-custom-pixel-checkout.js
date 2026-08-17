/* ==========================================================================
   GTM — Pixel personalizado do checkout
   APP Agro Peças Padrão · contêiner GTM-TK3GX7XD

   ONDE COLAR
     Shopify Admin → Configurações → Eventos do cliente → Adicionar pixel
     personalizado → nome "GTM - Checkout" → colar → Salvar → Conectar.

   POR QUE ESTE ARQUIVO EXISTE
     O tema não renderiza o checkout nem a página de obrigado. Desde 28/08/2025
     a caixa "Additional scripts" da página de status do pedido é somente
     leitura (e em jan/2026 a Shopify apagou o que restava), então o script de
     purchase em Liquid com objetos `checkout.*` não roda em lugar nenhum.
     Customer Events é o substituto oficial.

   LEIA ANTES DE CONECTAR — docs/GTM_SETUP.md §6
     • Este pixel roda num IFRAME SANDBOX. O dataLayer aqui é SEPARADO do
       dataLayer do site. Variáveis do storefront não existem aqui.
     • Ele assina SOMENTE checkout_completed. Não assine page_viewed,
       product_viewed, collection_viewed, search_submitted nem cart_viewed:
       o tema já publica esses eventos e sairiam em dobro.
     • O canal "Google & YouTube" JÁ envia purchase para o GA4 e o canal
       "Facebook & Instagram" JÁ envia Purchase para a Meta. Se você ligar uma
       tag GA4 de purchase no GTM sem desconectar o GA4 do canal, cada pedido
       vira duas compras.
     • Na tag do GTM, sobrescreva page_location com o parâmetro `page_location`
       enviado abaixo — senão o GA4 registra a URL do sandbox.
   ========================================================================== */

(function () {
  var GTM_ID = 'GTM-TK3GX7XD';

  // Carrega o contêiner dentro do sandbox do pixel.
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
  document.head.appendChild(s);

  function toItems(lineItems) {
    return (lineItems || []).map(function (li, i) {
      var v = li.variant || {};
      var p = v.product || {};
      return {
        item_id: v.sku || String(p.id || ''),
        item_name: p.title || li.title || '',
        item_brand: p.vendor || '',
        item_category: p.type || '',
        item_variant: v.title && v.title !== 'Default Title' ? v.title : undefined,
        price: v.price ? v.price.amount : 0,
        currency: v.price ? v.price.currencyCode : 'BRL',
        quantity: li.quantity || 1,
        index: i + 1,
        product_id: p.id,
        variant_id: v.id,
        sku: v.sku || '',
        // mesmo ID do feed do Merchant Center — usar no remarketing dinâmico
        feed_id: 'shopify_BR_' + p.id + '_' + v.id,
        google_business_vertical: 'retail'
      };
    });
  }

  analytics.subscribe('checkout_completed', function (event) {
    var c = event.data.checkout || {};
    var doc = (event.context && event.context.document) || {};

    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({
      event: 'purchase',
      // O sandbox tem URL própria: a tag do GTM deve usar ESTES valores.
      page_location: doc.location ? doc.location.href : '',
      page_title: doc.title || '',
      ecommerce: {
        transaction_id: c.order ? c.order.id : c.token,
        affiliation: 'APP Agro Peças Padrão',
        value: c.totalPrice ? c.totalPrice.amount : 0,
        tax: c.totalTax ? c.totalTax.amount : 0,
        shipping: c.shippingLine && c.shippingLine.price ? c.shippingLine.price.amount : 0,
        subtotal: c.subtotalPrice ? c.subtotalPrice.amount : 0,
        currency: c.currencyCode || 'BRL',
        coupon: (c.discountApplications || [])
          .map(function (d) { return d.title || (d.discountCode || ''); })
          .filter(Boolean)
          .join(','),
        items: toItems(c.lineItems)
      },
      // Enhanced Conversions / Advanced Matching.
      // ATENÇÃO: aqui os dados vão SEM hash — o sandbox não tem crypto síncrono.
      // Na tag do Google Ads, marque o campo como "não criptografado" para o
      // próprio Google fazer o hash antes de enviar. Não replique esses valores
      // para nenhuma tag de terceiro.
      user_data: {
        email_address: c.email || '',
        phone_number: c.phone || (c.billingAddress ? c.billingAddress.phone : '') || '',
        address: {
          first_name: c.billingAddress ? c.billingAddress.firstName : '',
          last_name: c.billingAddress ? c.billingAddress.lastName : '',
          street: c.billingAddress ? c.billingAddress.address1 : '',
          city: c.billingAddress ? c.billingAddress.city : '',
          region: c.billingAddress ? c.billingAddress.provinceCode : '',
          postal_code: c.billingAddress ? c.billingAddress.zip : '',
          country: c.billingAddress ? c.billingAddress.countryCode : 'BR'
        }
      },
      customer_id: c.order && c.order.customer ? c.order.customer.id : undefined,
      order_number: c.order ? c.order.id : undefined
    });
  });

  /* ------------------------------------------------------------------
     OPCIONAIS — descomente só se o funil de checkout precisar aparecer
     no GTM. `begin_checkout` já sai do tema (clique em "Finalizar
     Compra"): habilitar checkout_started aqui DUPLICA o evento.
     ------------------------------------------------------------------

  analytics.subscribe('payment_info_submitted', function (event) {
    var c = event.data.checkout || {};
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({
      event: 'add_payment_info',
      ecommerce: {
        currency: c.currencyCode || 'BRL',
        value: c.totalPrice ? c.totalPrice.amount : 0,
        payment_type: (c.transactions && c.transactions[0] && c.transactions[0].gateway) || '',
        items: toItems(c.lineItems)
      }
    });
  });

  analytics.subscribe('checkout_address_info_submitted', function (event) {
    var c = event.data.checkout || {};
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({
      event: 'add_shipping_info',
      ecommerce: {
        currency: c.currencyCode || 'BRL',
        value: c.totalPrice ? c.totalPrice.amount : 0,
        shipping_tier: (c.shippingLine && c.shippingLine.title) || '',
        items: toItems(c.lineItems)
      }
    });
  });

  ------------------------------------------------------------------ */
})();
