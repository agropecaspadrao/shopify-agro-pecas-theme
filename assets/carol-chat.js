/* Carol — widget de chat do site (APP Agro Peças Padrão)
 * Conversa com o backend definido em window.carolBackendUrl (Railway/Render).
 * Sem dependências. Carregado apenas quando settings.carol_enabled está ativo.
 */
(function () {
  'use strict';

  var backend = (window.carolBackendUrl || '').replace(/\/+$/, '');
  if (!backend) return;

  // ── Sessão persistente por navegador ──────────────────────────────────
  var sessionId;
  try {
    sessionId = localStorage.getItem('carolSessionId');
    if (!sessionId) {
      sessionId = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('carolSessionId', sessionId);
    }
  } catch (e) {
    sessionId = 'w' + Date.now().toString(36);
  }

  var root = document.getElementById('carol-widget');
  if (!root) return;
  var painel = root.querySelector('.carol-panel');
  var botao = root.querySelector('.carol-toggle');
  var fechar = root.querySelector('.carol-close');
  var lista = root.querySelector('.carol-messages');
  var form = root.querySelector('.carol-form');
  var campo = root.querySelector('.carol-input');
  var btnWhats = root.querySelector('.carol-whats');
  var enviando = false;

  function addMsg(texto, quem) {
    var el = document.createElement('div');
    el.className = 'carol-msg carol-msg--' + quem;
    el.textContent = texto;
    lista.appendChild(el);
    lista.scrollTop = lista.scrollHeight;
    return el;
  }

  function abrir() {
    root.classList.add('is-open');
    campo.focus();
    if (!lista.childElementCount) {
      addMsg(
        'Olá! Aqui é a Carol, da Agro Peças Padrão. Posso ajudar a encontrar uma peça, tirar dúvidas técnicas ou encaminhar um orçamento. O que o senhor ou a senhora procura?',
        'carol'
      );
    }
  }

  botao.addEventListener('click', function () {
    if (root.classList.contains('is-open')) root.classList.remove('is-open');
    else abrir();
  });
  fechar.addEventListener('click', function () {
    root.classList.remove('is-open');
  });

  // Continuar no WhatsApp: pede um resumo da conversa ao backend e abre o
  // wa.me da loja com o contexto pré-preenchido na mensagem do cliente.
  if (btnWhats) {
    btnWhats.addEventListener('click', function () {
      var numero = (window.carolWhatsNumber || '5541984151085').replace(/\D/g, '');
      btnWhats.disabled = true;
      var abrir = function (resumo) {
        var texto = resumo
          ? 'Ola! Estava conversando com a Carol no site. Contexto: ' + resumo
          : 'Ola! Estava conversando com a Carol no site da Agro Pecas Padrao e quero continuar por aqui.';
        window.open('https://wa.me/' + numero + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
        btnWhats.disabled = false;
      };
      fetch(backend + '/api/resumo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) { abrir(data && data.resumo); })
        .catch(function () { abrir(null); });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var texto = campo.value.trim();
    if (!texto || enviando) return;
    campo.value = '';
    addMsg(texto, 'user');
    var digitando = addMsg('Carol está digitando...', 'typing');
    enviando = true;

    fetch(backend + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, message: texto }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        digitando.remove();
        addMsg(
          data.reply || 'Tivemos uma instabilidade. Tente novamente ou chame no WhatsApp (41) 98415-1085.',
          'carol'
        );
      })
      .catch(function () {
        digitando.remove();
        addMsg('Sem conexão com o atendimento agora. Chame no WhatsApp (41) 98415-1085.', 'carol');
      })
      .finally(function () {
        enviando = false;
        campo.focus();
      });
  });
})();
