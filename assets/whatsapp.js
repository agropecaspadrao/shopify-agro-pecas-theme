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

  /* ===== Busca por aproximação =====
     Quando a busca nativa não retorna nada, casa o termo contra um índice
     local de TODO o catálogo (título, SKU, tags/part numbers, marca, tipo e
     descrição), por substring de tokens normalizados. Cobre: código com .0
     sobrando, part number no meio do SKU (ex. "680005" em 5.1621.0680005.0),
     código sem pontos, referência OEM cruzada, erro de digitação no fim. */

  function normTxt(s) {
    return (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^a-z0-9]+/g, '');
  }

  var INDEX_KEY = 'appSearchIndexV1';
  var indexPromise = null;
  function loadIndex() {
    if (indexPromise) return indexPromise;
    try {
      var cache = JSON.parse(sessionStorage.getItem(INDEX_KEY) || 'null');
      if (cache && cache.ts && (Date.now() - cache.ts) < 1800000 && cache.itens) {
        indexPromise = Promise.resolve(cache.itens);
        return indexPromise;
      }
    } catch (e) { /* sessionStorage indisponível: segue sem cache */ }
    // baixa o catálogo inteiro (até 4 páginas de 250)
    function paginas(pg, acc) {
      return fetch('/products.json?limit=250&page=' + pg)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var lote = data.products || [];
          acc = acc.concat(lote);
          if (lote.length === 250 && pg < 4) return paginas(pg + 1, acc);
          return acc;
        });
    }
    indexPromise = paginas(1, [])
      .then(function(products) {
        var itens = products.map(function(p) {
          var v = (p.variants && p.variants[0]) || {};
          var img = (p.images && p.images[0] && p.images[0].src) || '';
          var corpo = (p.body_html || '').replace(/<[^>]*>/g, ' ');
          return {
            title: p.title,
            url: '/products/' + p.handle,
            image: img ? img + (img.indexOf('?') > -1 ? '&' : '?') + 'width=96' : '',
            sku: v.sku || '',
            skuN: normTxt(v.sku),
            busca: normTxt(p.title) + '|' + normTxt(v.sku) + '|' +
                   normTxt((p.tags || []).join(' ')) + '|' + normTxt(p.vendor) + '|' +
                   normTxt(p.product_type) + '|' + normTxt(corpo)
          };
        });
        try { sessionStorage.setItem(INDEX_KEY, JSON.stringify({ ts: Date.now(), itens: itens })); } catch (e) {}
        return itens;
      });
    return indexPromise;
  }

  function localSearch(q, limit) {
    return loadIndex().then(function(itens) {
      var qN = normTxt(q);
      var tokens = q.split(/[\s.,\-\/_]+/).map(normTxt).filter(function(t) { return t.length >= 3; });
      if (!tokens.length) {
        if (qN.length < 3) return [];
        tokens = [qN];
      }
      var achados = [];
      itens.forEach(function(it) {
        // correspondência FORTE: o código digitado contém o SKU inteiro ou
        // vice-versa (ex.: "5.1302.0565053.0" digitado x SKU 5.1302.0565053)
        var forte = it.skuN.length >= 5 && qN.length >= 5 &&
                    (qN.indexOf(it.skuN) > -1 || it.skuN.indexOf(qN) > -1);
        var pontos = forte ? 100 : 0;
        if (!forte) {
          for (var i = 0; i < tokens.length; i++) {
            if (it.busca.indexOf(tokens[i]) === -1) return; // todos os tokens precisam casar
            pontos += (it.skuN && it.skuN.indexOf(tokens[i]) > -1) ? 2 : 1;
          }
        }
        achados.push({ it: it, pontos: pontos, forte: forte });
      });
      achados.sort(function(a, b) { return b.pontos - a.pontos; });
      return achados.slice(0, limit || 5).map(function(a) {
        return { title: a.it.title, url: a.it.url, image: a.it.image,
                 sku: a.it.sku, forte: a.forte, variants: [{ sku: a.it.sku }] };
      });
    });
  }
  /* Exposto p/ a página de busca */
  window.appLocalSearch = localSearch;

  function urlPath(u) { return (u || '').split('?')[0]; }

  function suggestAprox(q, limit) {
    var pNativo = suggestFetch(q, limit).catch(function() { return []; });
    var pLocal = localSearch(q, limit).catch(function() { return []; });
    return Promise.all([pNativo, pLocal]).then(function(r) {
      var nativos = r[0], locais = r[1];
      var fortes = locais.filter(function(l) { return l.forte; });
      // correspondência forte primeiro, depois busca nativa, depois aproximados
      var vistos = {}, out = [];
      fortes.concat(nativos).concat(nativos.length === 0 ? locais : []).forEach(function(p) {
        var k = urlPath(p.url);
        if (!k || vistos[k]) return;
        vistos[k] = 1;
        out.push(p);
      });
      return { products: out.slice(0, limit || 5), termo: q,
               aprox: nativos.length === 0 && out.length > 0 };
    });
  }
  /* Exposto p/ a página de busca (fallback de 0 resultados) */
  window.appSuggestAprox = suggestAprox;

  /* Escapa HTML antes de montar innerHTML — título/SKU vêm do catálogo
     (sincronizado automaticamente) e o termo vem do teclado do usuário. */
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderResults(products, termoAprox) {
    if (!searchResults) return;
    if (!products || products.length === 0) {
      searchResults.innerHTML = '<p class="predictive-no-results">Nenhum resultado encontrado.</p>';
      searchResults.hidden = false;
      return;
    }
    var html = products.slice(0, 5).map(function(p) {
      var img = p.image ? '<img src="' + escHtml(p.image) + '" class="predictive-result__img" alt="" width="48" height="48">' : '';
      var sku = (p.variants && p.variants[0] && p.variants[0].sku) ? p.variants[0].sku : '';
      return '<a href="' + escHtml(p.url) + '" class="predictive-result">' +
        img +
        '<div class="predictive-result__info">' +
          '<div class="predictive-result__title">' + escHtml(p.title) + '</div>' +
          (sku ? '<div class="predictive-result__sku">' + escHtml(sku) + '</div>' : '') +
        '</div>' +
        '</a>';
    }).join('');
    if (termoAprox) {
      html = '<p class="predictive-aprox">Resultados aproximados para "' + escHtml(termoAprox) + '"</p>' + html;
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
            renderResults(res.products, res.aprox ? res.termo : null);
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

    // GTM — dataLayer (fonte para as tags GA4 / Google Ads / Meta do container)
    var ctx = window.APP_GTM || {};
    var dlLead = {
      event: 'generate_lead',
      lead_method: 'whatsapp',
      lead_source: source,
      page_type: ctx.pageType || '',
      page_path: window.location.pathname
    };
    if (ctx.item) {
      dlLead.lead_sku = ctx.item.item_id;
      dlLead.lead_product = ctx.item.item_name;
      dlLead.lead_value = ctx.item.price;
      dlLead.currency = ctx.item.currency;
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(dlLead);

    // GA4 via gtag.js direto do tema — só existe enquanto o snippet ga4.liquid
    // estiver ativo. Ao migrar o GA4 para dentro do GTM, desligue-o nas
    // configurações do tema para não contar generate_lead duas vezes.
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
