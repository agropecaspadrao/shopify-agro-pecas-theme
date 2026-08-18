/* ==========================================================================
   gtm-events.js — eventos de interação para o dataLayer do GTM

   Complementa o snippets/gtm-datalayer.liquid, que já publica no servidor o
   contexto da página + view_item, view_cart e search.

   Aqui saem os eventos que dependem do DOM / do clique do usuário:
     view_item_list    — toda grade de produtos renderizada na página
     select_item       — clique em um card da grade (o "productClick")
     add_to_cart       — submit de qualquer form[data-gtm-atc]
     remove_from_cart  — botão "Remover" no carrinho
     begin_checkout    — clique em "Finalizar Compra"
     generate_lead     — envio do formulário de cotação formal
                         (o generate_lead do WhatsApp sai do whatsapp.js)

   add_shipping_info, add_payment_info e purchase acontecem DENTRO do checkout,
   que o tema não renderiza — saem do pixel de Eventos do Cliente
   (docs/gtm-custom-pixel-checkout.js).

   Cada push carrega os dois schemas: `ecommerce` (GA4) e `meta` (Meta Ads).
   A tradução vive em window.APP_GTM.meta(), no gtm-datalayer.liquid, para
   GA4 e Meta nunca divergirem.

   Fonte dos dados: atributo data-gtm-item nos elementos (JSON gerado pelo
   snippet gtm-item.liquid) e window.APP_GTM (contexto da página).

   Navegação: eventos que trocam de página usam eventCallback + eventTimeout
   do GTM, com timer de segurança — se o GTM estiver bloqueado ou demorar,
   a navegação acontece do mesmo jeito.
   ========================================================================== */
(function () {
  'use strict';

  window.dataLayer = window.dataLayer || [];

  var CFG = window.APP_GTM || {};
  var CURRENCY = CFG.currency || 'BRL';
  var NAV_TIMEOUT = 900;   // ms — teto de espera antes de liberar a navegação
  var LIST_MAX = 30;       // itens por view_item_list (payload leve)

  /* ---------- helpers ---------- */

  function push(obj) {
    window.dataLayer.push(obj);
  }

  // Fallback: se o gtm-datalayer não rodou (interruptor geral desligado),
  // ainda assim mantemos o formato dos pushes coerente.
  function metaOf(ecom) {
    if (CFG.meta) return CFG.meta(ecom);
    var items = (ecom && ecom.items) || [];
    var ids = [], contents = [], num = 0, sum = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var q = Number(it.quantity) || 1;
      var p = Number(it.price) || 0;
      var id = it.feed_id || it.item_id;
      num += q; sum += p * q;
      ids.push(id);
      contents.push({ id: id, quantity: q, item_price: p });
    }
    return {
      content_type: 'product',
      content_ids: ids,
      contents: contents,
      currency: (ecom && ecom.currency) || CURRENCY,
      value: (ecom && typeof ecom.value === 'number') ? ecom.value : Math.round(sum * 100) / 100,
      num_items: num
    };
  }

  // O reset (ecommerce: null) evita que o objeto do evento anterior vaze
  // para o próximo — exigência do GA4 via GTM.
  function pushEcom(event, ecommerce, extra) {
    push({ ecommerce: null });
    var payload = { event: event, ecommerce: ecommerce, meta: metaOf(ecommerce) };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      }
    }
    push(payload);
  }

  // Dispara o evento e só então navega. Nunca deixa o usuário preso.
  function pushEcomThen(event, ecommerce, go) {
    var done = false;
    function release() {
      if (done) return;
      done = true;
      go();
    }
    if (!window.google_tag_manager) {
      pushEcom(event, ecommerce);
      release();
      return;
    }
    push({ ecommerce: null });
    push({
      event: event,
      ecommerce: ecommerce,
      meta: metaOf(ecommerce),
      eventCallback: release,
      eventTimeout: NAV_TIMEOUT
    });
    setTimeout(release, NAV_TIMEOUT + 100);
  }

  function parseItem(el) {
    if (!el) return null;
    var raw = el.getAttribute('data-gtm-item');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function clone(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : null;
  }

  function money(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function lineValue(item) {
    return money((Number(item.price) || 0) * (Number(item.quantity) || 1));
  }

  function closestItem(el) {
    if (!el) return null;
    if (el.hasAttribute && el.hasAttribute('data-gtm-item')) return el;
    return el.closest('[data-gtm-item]') || el.querySelector('[data-gtm-item]');
  }

  /* ---------- generate_lead — cotação formal ---------- */
  /* Registrado antes do kill-switch de e-commerce: lead é a conversão
     principal da operação e não deve depender dessa configuração.
     Sem preventDefault — o formulário de contato tem JS próprio na seção,
     e o GA4 entrega por sendBeacon, que sobrevive ao unload.                */

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('#QfContactForm, form[action*="/contact"]');
    if (!form) return;

    var payload = {
      event: 'generate_lead',
      lead_method: 'formulario',
      lead_source: 'cotacao_formal',
      page_type: CFG.pageType || '',
      page_path: window.location.pathname
    };

    var sku = form.querySelector('[name="contact[sku]"]');
    var prod = form.querySelector('[name="contact[product]"]');
    if (sku && sku.value) payload.lead_sku = sku.value;
    if (prod && prod.value) payload.lead_product = prod.value;

    push(payload);
  });

  /* ---------- kill-switch dos eventos de e-commerce ----------
     Configurações do tema → Marketing & Integrações →
     "Publicar eventos de e-commerce no dataLayer".                          */

  if (CFG.ecommerce === false) return;

  /* ---------- view_item_list ---------- */
  /* Uma grade = uma lista. O agrupamento vem do data-gtm-list do card, então
     home, coleção, busca e relacionados da PDP saem como listas separadas.  */

  var listCounters = {};   // posição corrente por lista, mantida entre reprocessos

  function pushLists() {
    // :not([data-gtm-listed]) — grades reinjetadas não recontam o que já saiu
    var cards = document.querySelectorAll('[data-gtm-item][data-gtm-list]:not([data-gtm-listed])');
    if (!cards.length) return;

    var groups = {};
    var ids = {};
    var order = [];

    Array.prototype.forEach.call(cards, function (el) {
      el.setAttribute('data-gtm-listed', '1');
      var item = parseItem(el);
      if (!item) return;
      var list = el.getAttribute('data-gtm-list') || 'Catálogo';
      var listId = el.getAttribute('data-gtm-list-id') || item.item_list_id || 'catalog';

      listCounters[list] = (listCounters[list] || 0) + 1;
      item.item_list_name = list;
      item.item_list_id = listId;
      item.index = listCounters[list];
      item.quantity = 1;

      // guardado no DOM para o select_item/add_to_cart reaproveitarem a posição
      el.setAttribute('data-gtm-index', listCounters[list]);

      if (!groups[list]) {
        groups[list] = [];
        ids[list] = listId;
        order.push(list);
      }
      groups[list].push(item);
    });

    order.forEach(function (list) {
      pushEcom('view_item_list', {
        item_list_id: ids[list],
        item_list_name: list,
        items: groups[list].slice(0, LIST_MAX)
      });
    });
  }

  /* ---------- select_item ---------- */

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href*="/products/"]');
    if (!link) return;

    var card = link.closest('[data-gtm-item]');
    if (!card) return;

    var item = parseItem(card);
    if (!item) return;

    var list = card.getAttribute('data-gtm-list') || '';
    var listId = card.getAttribute('data-gtm-list-id') || item.item_list_id || '';
    var idx = parseInt(card.getAttribute('data-gtm-index'), 10);

    item.item_list_name = list;
    item.item_list_id = listId;
    if (idx) item.index = idx;
    item.quantity = 1;

    pushEcom('select_item', {
      item_list_id: listId,
      item_list_name: list,
      items: [item]
    });
  });

  /* ---------- add_to_cart ---------- */
  /* Vale para o card do catálogo e para a PDP. Na PDP o item vem do
     window.APP_GTM.item (o form do Shopify não carrega o data-attribute).   */

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-gtm-atc]');
    if (!form) return;

    var item = parseItem(closestItem(form)) || clone(CFG.item);
    if (!item) return;

    var qtyEl = form.querySelector('[name="quantity"]');
    var qty = qtyEl ? parseInt(qtyEl.value, 10) : 1;
    item.quantity = qty > 0 ? qty : 1;

    var card = form.closest('[data-gtm-list]');
    if (card) {
      item.item_list_name = card.getAttribute('data-gtm-list');
      item.item_list_id = card.getAttribute('data-gtm-list-id') || item.item_list_id;
      var idx = parseInt(card.getAttribute('data-gtm-index'), 10);
      if (idx) item.index = idx;
    }

    e.preventDefault();
    pushEcomThen(
      'add_to_cart',
      { currency: item.currency || CURRENCY, value: lineValue(item), items: [item] },
      function () {
        // .call evita colisão com um campo chamado "submit" dentro do form
        HTMLFormElement.prototype.submit.call(form);
      }
    );
  });

  /* ---------- remove_from_cart ---------- */
  /* O main-cart faz fetch + reload; aqui só publicamos antes disso.          */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.cart-item__remove');
    if (!btn) return;

    var item = parseItem(btn.closest('[data-gtm-item]'));
    if (!item) return;

    pushEcom('remove_from_cart', {
      currency: item.currency || CURRENCY,
      value: lineValue(item),
      items: [item]
    });
  });

  /* ---------- begin_checkout ---------- */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('a.cart-checkout-btn, [data-gtm-checkout]');
    if (!btn) return;
    if (btn.classList.contains('cart-checkout-btn--disabled')) return; // gate do pedido mínimo

    var cart = CFG.cart;
    if (!cart || !cart.items || !cart.items.length) return;

    var ecommerce = {
      currency: cart.currency || CURRENCY,
      value: cart.value,
      coupon: cart.coupon || '',
      items: cart.items
    };

    // abrir em nova aba / novo contexto: publica e deixa o navegador seguir
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || btn.target === '_blank') {
      pushEcom('begin_checkout', ecommerce);
      return;
    }

    var href = btn.getAttribute('href');
    if (!href) return;

    e.preventDefault();
    pushEcomThen('begin_checkout', ecommerce, function () {
      window.location.href = href;
    });
  });

  /* ---------- boot ---------- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pushLists);
  } else {
    pushLists();
  }

  // grades injetadas depois (filtros, busca aproximada) podem reprocessar
  window.appGtmRefreshLists = pushLists;
})();
