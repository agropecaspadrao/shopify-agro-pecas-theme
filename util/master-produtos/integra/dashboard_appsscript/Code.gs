/**
 * Central de Integrações — APP Agro Peças
 * Dashboard executivo (Site x Olist x Planilha). Login Google + allowlist + rate limit.
 *
 * Config: defina a Script Property DATA_SHEET_ID com o id da planilha APP_Dashboard_Data.
 */

// e-mails autorizados (pré-cadastrados)
var ALLOWLIST = [
  'comercial@agropecaspadrao.com.br',
  'admin@agropecaspadrao.com.br',
  'socios@agropecaspadrao.com.br'
];

var RATE_LIMIT = 40;          // requisições por janela
var RATE_WINDOW_SEC = 60;     // janela (s)
var LOCKOUT_HITS = 8;         // acessos negados que disparam bloqueio
var LOCKOUT_SEC = 600;        // duração do bloqueio (s)

// planilha nativa APP_Dashboard_Data (criada pelo pipeline). A Script Property
// tem prioridade; se ausente, usa esta constante.
var DATA_SHEET_ID_FALLBACK = '1LFrTMRh3fiARn0c2eGGWnJfG4kJcVKuJvvfvAlCQQ-k';

function getDataSheetId_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_SHEET_ID') || DATA_SHEET_ID_FALLBACK;
}

/** Rate limit + lockout por usuário/IP-lógico usando CacheService. */
function rateOk_(key) {
  var cache = CacheService.getScriptCache();
  var lockKey = 'lock_' + key;
  if (cache.get(lockKey)) return false;                 // em lockout
  var cntKey = 'cnt_' + key;
  var n = parseInt(cache.get(cntKey) || '0', 10) + 1;
  cache.put(cntKey, String(n), RATE_WINDOW_SEC);
  if (n > RATE_LIMIT) {
    var negKey = 'neg_' + key;
    var neg = parseInt(cache.get(negKey) || '0', 10) + 1;
    cache.put(negKey, String(neg), LOCKOUT_SEC);
    if (neg >= LOCKOUT_HITS) cache.put(lockKey, '1', LOCKOUT_SEC);
    return false;
  }
  return true;
}

function logAcesso_(email, ok) {
  try {
    Logger.log((ok ? 'OK   ' : 'NEG  ') + email + ' @ ' + new Date().toISOString());
  } catch (e) {}
}

function doGet() {
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  var autorizado = ALLOWLIST.indexOf(email) !== -1;

  if (!rateOk_(email || 'anon')) {
    return HtmlService.createHtmlOutput(pageMsg_('Muitas requisições',
      'Aguarde alguns minutos e tente novamente.'))
      .setTitle('Acesso limitado');
  }
  logAcesso_(email, autorizado);
  if (!autorizado) {
    return HtmlService.createHtmlOutput(pageMsg_('Acesso restrito',
      'Sua conta (' + (email || 'não identificada') + ') não tem permissão. ' +
      'Fale com a administração da APP Agro Peças.'))
      .setTitle('Acesso restrito');
  }

  var t = HtmlService.createTemplateFromFile('Index');
  t.dados = carregarDados_();
  t.usuario = email;
  return t.evaluate()
    .setTitle('Central de Integrações — APP Agro Peças')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Lê todas as abas da planilha de dados e devolve um objeto. */
function carregarDados_() {
  var sid = getDataSheetId_();
  if (!sid) return { erro: 'DATA_SHEET_ID não configurado nas Script Properties.' };
  var ss = SpreadsheetApp.openById(sid);
  function tab(nome) {
    var sh = ss.getSheetByName(nome);
    if (!sh) return [];
    var v = sh.getDataRange().getValues();
    return v;
  }
  function objs(nome) {
    var v = tab(nome);
    if (v.length < 2) return [];
    var head = v[0];
    return v.slice(1).filter(function (r) { return r[0] !== '' && r[0] !== null; })
      .map(function (r) {
        var o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o;
      });
  }
  var kpisArr = tab('KPIs');
  var kpis = {};
  kpisArr.slice(1).forEach(function (r) { kpis[r[0]] = r[1]; });
  var meta = tab('Meta');
  var gerado = (meta[0] && meta[0][1]) || '';
  return {
    gerado_em: gerado,
    kpis: kpis,
    sem_foto: objs('SemFoto'),
    desc_ruins: objs('DescRuins'),
    importantes: objs('Importantes'),
    div_preco: objs('DivPreco'),
    div_custo: objs('DivCusto'),
    inativos: objs('Inativos'),
    cenarios: objs('Cenarios'),
    regras: objs('Regras')
  };
}

function pageMsg_(titulo, msg) {
  return '<div style="font-family:Arial,sans-serif;max-width:520px;margin:80px auto;padding:32px;' +
    'border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.1);text-align:center">' +
    '<div style="width:56px;height:56px;border-radius:50%;background:#1B4332;margin:0 auto 16px"></div>' +
    '<h2 style="color:#1B4332;margin:0 0 8px">' + titulo + '</h2>' +
    '<p style="color:#555;line-height:1.5">' + msg + '</p></div>';
}
