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
    var number = window.waNumber || '5541997217541';
    var msg = 'Olá! Estava navegando no catálogo e tenho interesse na peça *' + productTitle + '* (SKU: ' + sku + '). Poderiam me passar disponibilidade?';
    return 'https://wa.me/' + number + '?text=' + encodeURIComponent(msg);
  }

  function renderResults(products) {
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
    searchResults.innerHTML = html;
    searchResults.hidden = false;
  }

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      var q = this.value.trim();
      clearTimeout(searchTimeout);
      if (q.length < 2) {
        if (searchResults) searchResults.hidden = true;
        return;
      }
      searchTimeout = setTimeout(function() {
        fetch('/search/suggest.json?q=' + encodeURIComponent(q) + '&resources[type]=product&resources[limit]=5')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var products = (data.resources && data.resources.results && data.resources.results.products) || [];
            renderResults(products);
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

})();
