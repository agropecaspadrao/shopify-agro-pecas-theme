/* ============================================================
   APP Agro Peças — WhatsApp + Predictive Search + Mobile Menu
   ============================================================ */

(function() {
  'use strict';

  /* ---------- Predictive Search ---------- */
  var searchInput = document.getElementById('HeaderSearchInput');
  var searchResults = document.getElementById('HeaderSearchResults');
  var searchTimeout;

  function buildWaUrl(productTitle, sku) {
    var number = window.waNumber || '5541984151085';
    var msg = 'Olá! Estava navegando no catálogo e tenho interesse na peça *' + productTitle + '* (SKU: ' + sku + '). Poderiam me passar disponibilidade?';
    return 'https://wa.me/' + number + '?text=' + encodeURIComponent(msg);
  }

  /* Campos pesquisados no predictive search — inclui SKU, código de barras
     e corpo da descrição (onde ficam part numbers e códigos cruzados). */
  var SUGGEST_FIELDS = 'title,product_type,variants.sku,variants.barcode,vendor,tag,body';

  function suggestFetch(q, limit) {
    var url = '/search/suggest.json?q=' + encodeURIComponent(q) +
      '&resources[type]=product&resources[limit]=' + (limit || 5) +
      '&resources[options][fields]=' + SUGGEST_FIELDS;
    return fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        return (data.resources && data.resources.results && data.resources.results.products) || [];
      });
  }

  /* Busca por aproximação de SKU: se o termo parece um código e não retornou
     nada, tenta versões progressivamente mais curtas (o predictive search da
     Shopify casa por prefixo). Ex.: "5.0220.0548836.0" -> "5.0220.0548836". */
  function skuCandidates(q) {
    var cands = [];
    if (!/\d/.test(q) || q.length < 5) return cands;
    var t = q;
    for (var i = 0; i < 3; i++) {
      var curto = t.replace(/[\s.\-\/_]+[^\s.\-\/_]*$/, '');
      if (curto.length >= 5 && curto !== t) { cands.push(curto); t = curto; }
      else break;
    }
    var pref = q.replace(/[^A-Za-z0-9.\-]/g, '');
    pref = pref.slice(0, Math.max(5, Math.ceil(pref.length * 0.6)));
    if (pref.length >= 5 && pref !== q && cands.indexOf(pref) === -1) cands.push(pref);
    return cands;
  }

  function suggestAprox(q, limit) {
    var fila = [q].concat(skuCandidates(q));
    var i = 0;
    function tenta() {
      if (i >= fila.length) return Promise.resolve({ products: [], termo: q });
      var termo = fila[i++];
      return suggestFetch(termo, limit).then(function(products) {
        if (products.length > 0) return { products: products, termo: termo };
        return tenta();
      });
    }
    return tenta();
  }
  /* Exposto p/ a página de busca (fallback de 0 resultados) */
  window.appSuggestAprox = suggestAprox;

  function renderResults(products, termoAprox) {
    if (!searchResults) return;
    if (!products || products.length === 0) {
      searchResults.innerHTML = '<p class="predictive-no-results">Nenhum resultado encontrado.</p>';
      searchResults.hidden = false;
      return;
    }
    var html = products.slice(0, 5).map(function(p) {
      var img = p.image ? '<img src="' + p.image + '" class="predictive-result__img" alt="" width="48" height="48">' : '';
      var sku = (p.variants && p.variants[0] && p.variants[0].sku) ? p.variants[0].sku : '';
      return '<a href="' + p.url + '" class="predictive-result">' +
        img +
        '<div class="predictive-result__info">' +
          '<div class="predictive-result__title">' + p.title + '</div>' +
          (sku ? '<div class="predictive-result__sku">' + sku + '</div>' : '') +
        '</div>' +
        '</a>';
    }).join('');
    if (termoAprox) {
      html = '<p class="predictive-aprox">Resultados aproximados para "' + termoAprox + '"</p>' + html;
    }
    searchResults.innerHTML = html;
    searchResults.hidden = false;
  }

  var searchSeq = 0;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      var q = this.value.trim();
      clearTimeout(searchTimeout);
      if (q.length < 2) {
        if (searchResults) searchResults.hidden = true;
        return;
      }
      searchTimeout = setTimeout(function() {
        var seq = ++searchSeq;
        suggestAprox(q, 5)
          .then(function(res) {
            if (seq !== searchSeq) return; // resposta velha: ignora
            renderResults(res.products, res.termo !== q ? res.termo : null);
          })
          .catch(function() {
            if (searchResults) searchResults.hidden = true;
          });
      }, 250);
    });

    document.addEventListener('click', function(e) {
      if (!e.target.closest('.header-search') && searchResults) {
        searchResults.hidden = true;
      }
    });
  }

  /* ---------- Mobile Menu ---------- */
  var menuToggle = document.getElementById('MenuToggle');
  var menuClose = document.getElementById('MenuClose');
  var mobileMenu = document.getElementById('MobileMenu');
  var menuOverlay = document.getElementById('MenuOverlay');

  function openMenu() {
    if (!mobileMenu) return;
    mobileMenu.classList.add('is-open');
    mobileMenu.setAttribute('aria-hidden', 'false');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
    if (menuOverlay) menuOverlay.classList.add('is-visible');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('is-open');
    mobileMenu.setAttribute('aria-hidden', 'true');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    if (menuOverlay) menuOverlay.classList.remove('is-visible');
    document.body.style.overflow = '';
  }

  if (menuToggle) menuToggle.addEventListener('click', openMenu);
  if (menuClose) menuClose.addEventListener('click', closeMenu);
  if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeMenu(); });

  /* ---------- Rastreamento de lead WhatsApp (GA4 + Meta Pixel) ----------
     Listener único e delegado: captura clique em QUALQUER link wa.me do site
     (botão flutuante, card, PDP, rodapé, etc.) e dispara a conversão.
     A origem vem de data-wa-source; se ausente, é inferida pela URL.        */
  function waSource(link) {
    if (link.getAttribute('data-wa-source')) return link.getAttribute('data-wa-source');
    if (link.closest('.product-card')) return 'card';
    var p = window.location.pathname;
    if (p.indexOf('/products/') > -1)    return 'pdp';
    if (p.indexOf('/collections/') > -1) return 'collection';
    if (p.indexOf('/cart') > -1)         return 'cart';
    if (p.indexOf('/search') > -1)       return 'search';
    if (p === '/' || p === '')           return 'home';
    return p.replace(/^\//, '') || 'other';
  }

  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
    if (!link) return;
    var source = waSource(link);

    // GA4 — evento generate_lead (marque como Evento-chave/conversão no GA4)
    if (typeof gtag === 'function') {
      gtag('event', 'generate_lead', {
        method: 'whatsapp',
        lead_source: source,
        page_path: window.location.pathname
      });
    }
    // Meta Pixel — evento Lead (fbq é injetado pelo canal Meta do Shopify)
    if (typeof fbq === 'function') {
      fbq('track', 'Lead', { content_name: 'whatsapp:' + source });
    }
  }, true);

})();
