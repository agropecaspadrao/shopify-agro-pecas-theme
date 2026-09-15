// Verificadores de saúde: cada um é um "worker" independente que examina uma
// dependência da Carol e devolve um resultado padronizado. O supervisor
// (supervisor.js) orquestra, consolida e decide o que fazer.
//
// Resultado: { nome, estado: 'ok'|'aviso'|'falha'|'nao_configurado', resumo,
//              detalhe?, tipoAnomalia?, dados? }
//
// Todos aceitam { fetchFn, agora } por injeção para testes determinísticos.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, recursosConfigurados } from '../config.js';
import { DATA_DIR } from '../registro.js';
import { estadoCatalogo } from '../catalogo.js';
import { ultimoEnvio } from '../email/transporte.js';
import { saldoEstimado } from '../custos.js';

const GRAPH = () => `https://graph.facebook.com/${config.graphVersion}`;
const DIA = 24 * 3600 * 1000;

function fmtData(ts) {
  return new Date(ts).toLocaleString('pt-BR', { timeZone: config.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function getJson(fetchFn, url, opts = {}) {
  const res = await fetchFn(url, { ...opts, signal: AbortSignal.timeout(opts.timeoutMs || 15000) });
  let corpo = null;
  try {
    corpo = await res.json();
  } catch {}
  return { status: res.status, ok: res.ok, corpo };
}

// ── WhatsApp: token válido? expira em breve? ──────────────────────────────
export async function verificarWhatsApp({ fetchFn = fetch, agora = Date.now, token = config.waAccessToken } = {}) {
  const nome = 'whatsapp';
  if (!config.waPhoneNumberId || !token) return { nome, estado: 'nao_configurado', resumo: 'WhatsApp não configurado' };

  const r = await getJson(fetchFn, `${GRAPH()}/${config.waPhoneNumberId}?fields=display_phone_number,quality_rating`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (r.status === 401 || r.corpo?.error?.code === 190) {
    return {
      nome,
      estado: 'falha',
      tipoAnomalia: 'whatsapp_token_invalido',
      resumo: 'token do WhatsApp inválido ou expirado',
      detalhe: r.corpo?.error?.message || `HTTP ${r.status}`,
    };
  }
  if (!r.ok) {
    return { nome, estado: 'falha', tipoAnomalia: 'whatsapp_envio_falhou', resumo: `Cloud API respondeu HTTP ${r.status}`, detalhe: JSON.stringify(r.corpo || {}).slice(0, 300) };
  }

  // Validade do token (debug_token exige um token com acesso ao app; se não
  // der, seguimos só com o resultado acima).
  let expiraEm = null;
  try {
    const d = await getJson(fetchFn, `${GRAPH()}/debug_token?input_token=${encodeURIComponent(token)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const exp = d.corpo?.data?.expires_at;
    if (typeof exp === 'number' && exp > 0) expiraEm = exp * 1000;
  } catch {}

  const dados = { numero: r.corpo?.display_phone_number, qualidade: r.corpo?.quality_rating, expiraEm };
  if (expiraEm && expiraEm - agora() < 7 * DIA) {
    return {
      nome,
      estado: 'aviso',
      tipoAnomalia: 'whatsapp_token_expira',
      resumo: `token do WhatsApp expira em ${fmtData(expiraEm)}`,
      detalhe: 'Trocar o token antes dessa data. Prefira um token permanente de Usuário do Sistema.',
      dados,
    };
  }
  return { nome, estado: 'ok', resumo: `WhatsApp ${dados.numero || ''} ok${expiraEm ? `, token válido até ${fmtData(expiraEm)}` : ', token permanente'}`, dados };
}

// ── Anthropic: chave aceita? (count_tokens é gratuito) e saldo estimado ───
export async function verificarAnthropic({ fetchFn = fetch } = {}) {
  const nome = 'anthropic';
  if (!config.anthropicApiKey) return { nome, estado: 'nao_configurado', resumo: 'ANTHROPIC_API_KEY ausente' };
  const r = await getJson(fetchFn, 'https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: { 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.claudeModel, messages: [{ role: 'user', content: 'ping' }] }),
  });
  if (r.status === 401) return { nome, estado: 'falha', tipoAnomalia: 'anthropic_chave', resumo: 'chave da Anthropic recusada', detalhe: r.corpo?.error?.message };
  if (r.status === 400 && /credit/i.test(r.corpo?.error?.message || '')) {
    return { nome, estado: 'falha', tipoAnomalia: 'anthropic_credito', resumo: 'crédito da Anthropic esgotado', detalhe: r.corpo?.error?.message };
  }
  if (r.status === 404) return { nome, estado: 'falha', tipoAnomalia: 'anthropic_api', resumo: `modelo ${config.claudeModel} não encontrado`, detalhe: r.corpo?.error?.message };
  if (!r.ok && r.status !== 429) return { nome, estado: 'falha', tipoAnomalia: 'anthropic_api', resumo: `API da Anthropic respondeu HTTP ${r.status}`, detalhe: JSON.stringify(r.corpo || {}).slice(0, 300) };

  const saldo = saldoEstimado();
  const dados = { modelo: config.claudeModel, saldo };
  if (saldo && saldo.restante < config.alertaSaldoUsd) {
    return { nome, estado: 'aviso', resumo: `chave ok, saldo estimado baixo (US$ ${saldo.restante.toFixed(2)})`, dados };
  }
  return { nome, estado: 'ok', resumo: `chave ok (${config.claudeModel})${saldo ? `, saldo estimado US$ ${saldo.restante.toFixed(2)}` : ', saldo não sincronizado'}`, dados };
}

// ── Meta (token de Ads/páginas) ───────────────────────────────────────────
export async function verificarMeta({ fetchFn = fetch, agora = Date.now } = {}) {
  const nome = 'meta';
  const token = config.saude.metaAccessToken;
  if (!token) return { nome, estado: 'nao_configurado', resumo: 'META_ACCESS_TOKEN ausente' };
  const r = await getJson(fetchFn, `${GRAPH()}/debug_token?input_token=${encodeURIComponent(token)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const d = r.corpo?.data;
  if (!r.ok || !d || d.is_valid === false) {
    return { nome, estado: 'falha', tipoAnomalia: 'meta_token_invalido', resumo: 'token da Meta inválido', detalhe: d?.error?.message || r.corpo?.error?.message || `HTTP ${r.status}` };
  }
  const expiraEm = d.expires_at ? d.expires_at * 1000 : null;
  if (expiraEm && expiraEm - agora() < 7 * DIA) {
    return { nome, estado: 'aviso', tipoAnomalia: 'meta_token_invalido', resumo: `token da Meta expira em ${fmtData(expiraEm)}`, dados: { expiraEm, escopos: d.scopes } };
  }
  return { nome, estado: 'ok', resumo: `token da Meta ok (${(d.scopes || []).length} permissões${expiraEm ? `, válido até ${fmtData(expiraEm)}` : ', permanente'})`, dados: { expiraEm, escopos: d.scopes } };
}

// ── Google Ads (refresh token ainda vale?) ────────────────────────────────
export async function verificarGoogleAds({ fetchFn = fetch } = {}) {
  const nome = 'google_ads';
  const s = config.saude;
  if (!s.googleClientId || !s.googleClientSecret || !s.googleRefreshToken) return { nome, estado: 'nao_configurado', resumo: 'credenciais do Google Ads ausentes' };
  const body = new URLSearchParams({ client_id: s.googleClientId, client_secret: s.googleClientSecret, refresh_token: s.googleRefreshToken, grant_type: 'refresh_token' });
  const r = await getJson(fetchFn, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) {
    return { nome, estado: 'falha', tipoAnomalia: 'google_token_invalido', resumo: `Google recusou o refresh token (${r.corpo?.error || r.status})`, detalhe: r.corpo?.error_description };
  }
  return { nome, estado: 'ok', resumo: 'acesso ao Google Ads ok' };
}

// ── Catálogo da loja em memória ───────────────────────────────────────────
export async function verificarCatalogo({ agora = Date.now } = {}) {
  const nome = 'catalogo';
  const e = estadoCatalogo();
  if (!e.produtos) return { nome, estado: 'falha', tipoAnomalia: 'catalogo_falha', resumo: 'catálogo vazio em memória' };
  const idadeMin = (agora() - e.ultimaCarga) / 60000;
  if (idadeMin > 120) return { nome, estado: 'aviso', tipoAnomalia: 'catalogo_falha', resumo: `catálogo sem atualizar há ${Math.round(idadeMin)} min (${e.produtos} produtos)`, dados: e };
  return { nome, estado: 'ok', resumo: `${e.produtos} produtos, ${e.specs} com ficha técnica, atualizado há ${Math.round(idadeMin)} min`, dados: e };
}

// ── Inventário Shopify: última edição de produto (products.json público) ──
export async function verificarInventario({ fetchFn = fetch, agora = Date.now } = {}) {
  const nome = 'inventario';
  const r = await getJson(fetchFn, `${config.shopUrl}/products.json?limit=250`, { timeoutMs: 20000 });
  if (!r.ok || !Array.isArray(r.corpo?.products)) return { nome, estado: 'falha', tipoAnomalia: 'catalogo_falha', resumo: `loja não respondeu products.json (HTTP ${r.status})` };
  const produtos = r.corpo.products;
  let ultimo = null;
  for (const p of produtos) {
    const t = new Date(p.updated_at).getTime();
    if (!ultimo || t > ultimo.t) ultimo = { t, titulo: p.title, handle: p.handle };
  }
  const semEstoque = produtos.filter((p) => !(p.variants || []).some((v) => v.available)).length;
  const dados = { produtos: produtos.length, semEstoque, ultimaEdicao: ultimo?.t || null, ultimoProduto: ultimo?.titulo || null };
  if (!ultimo) return { nome, estado: 'aviso', resumo: 'loja sem produtos publicados', dados };
  const dias = (agora() - ultimo.t) / DIA;
  const resumo = `${produtos.length} produtos publicados, última edição ${fmtData(ultimo.t)} (${ultimo.titulo.slice(0, 40)})`;
  if (dias > config.saude.inventarioDiasAlerta) {
    return { nome, estado: 'aviso', tipoAnomalia: 'inventario_desatualizado', resumo: `${resumo}, há ${Math.round(dias)} dias`, dados };
  }
  return { nome, estado: 'ok', resumo, dados };
}

// ── Planilha master no Drive: quem editou por último ──────────────────────
function lerContaServico() {
  const bruto = config.saude.googleServiceAccountJson;
  if (!bruto) return null;
  const txt = bruto.trim().startsWith('{') ? bruto : Buffer.from(bruto, 'base64').toString('utf8');
  return JSON.parse(txt);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Access token de conta de serviço (JWT RS256 assinado com node:crypto, sem SDK). */
export async function tokenContaServico(sa, escopo, { fetchFn = fetch, agora = Date.now } = {}) {
  const iat = Math.floor(agora() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: escopo, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const assinatura = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key);
  const jwt = `${header}.${claims}.${b64url(assinatura)}`;
  const r = await getJson(fetchFn, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!r.ok) throw new Error(`Google OAuth ${r.status}: ${r.corpo?.error_description || r.corpo?.error || ''}`);
  return r.corpo.access_token;
}

export async function verificarMaster({ fetchFn = fetch, agora = Date.now } = {}) {
  const nome = 'master';
  let sa;
  try {
    sa = lerContaServico();
  } catch (e) {
    return { nome, estado: 'falha', resumo: 'GOOGLE_SERVICE_ACCOUNT_JSON inválido', detalhe: e.message };
  }
  if (!sa) return { nome, estado: 'nao_configurado', resumo: 'conta de serviço do Google não configurada (ver manual)' };
  try {
    const token = await tokenContaServico(sa, 'https://www.googleapis.com/auth/drive.metadata.readonly', { fetchFn, agora });
    const r = await getJson(fetchFn, `https://www.googleapis.com/drive/v3/files/${config.saude.masterDriveFileId}?fields=name,modifiedTime,lastModifyingUser(displayName,emailAddress)&supportsAllDrives=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { nome, estado: 'falha', resumo: `Drive respondeu HTTP ${r.status}`, detalhe: r.corpo?.error?.message || 'a planilha precisa estar compartilhada com o e-mail da conta de serviço' };
    const t = new Date(r.corpo.modifiedTime).getTime();
    const quem = r.corpo.lastModifyingUser?.displayName || r.corpo.lastModifyingUser?.emailAddress || 'desconhecido';
    const dias = (agora() - t) / DIA;
    const dados = { arquivo: r.corpo.name, ultimaEdicao: t, editadoPor: quem, email: r.corpo.lastModifyingUser?.emailAddress || null };
    const resumo = `"${r.corpo.name}" editada por ${quem} em ${fmtData(t)}`;
    if (dias > config.saude.inventarioDiasAlerta) return { nome, estado: 'aviso', tipoAnomalia: 'master_desatualizada', resumo: `${resumo}, há ${Math.round(dias)} dias`, dados };
    return { nome, estado: 'ok', resumo, dados };
  } catch (e) {
    return { nome, estado: 'falha', resumo: 'não consegui consultar a planilha master', detalhe: e.message };
  }
}

// ── Disco de dados gravável ───────────────────────────────────────────────
export async function verificarDisco() {
  const nome = 'disco';
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const p = path.join(DATA_DIR, '.saude-teste');
    fs.writeFileSync(p, String(Date.now()));
    fs.unlinkSync(p);
    const arquivos = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('registro-')).length;
    return { nome, estado: 'ok', resumo: `disco de dados ok (${arquivos} dias de registro)`, dados: { dir: DATA_DIR, arquivos } };
  } catch (e) {
    return { nome, estado: 'falha', tipoAnomalia: 'disco_falha', resumo: 'não consigo gravar no disco de dados', detalhe: e.message };
  }
}

// ── E-mail: provedor configurado e último envio ───────────────────────────
export async function verificarEmail() {
  const nome = 'email';
  const rec = recursosConfigurados();
  if (!rec.emailHttp && !rec.emailSmtp) return { nome, estado: 'falha', tipoAnomalia: 'email_falha', resumo: 'nenhum provedor de e-mail configurado (RESEND_API_KEY ou BREVO_API_KEY)' };
  if (!rec.emailHttp) return { nome, estado: 'aviso', resumo: 'só SMTP configurado; no Railway o SMTP é bloqueado. Configure RESEND_API_KEY ou BREVO_API_KEY' };
  const u = ultimoEnvio();
  return { nome, estado: 'ok', resumo: u ? `último e-mail via ${u.provedor} em ${fmtData(u.ts)}` : 'provedor configurado, nenhum envio ainda' };
}

/** Todos os verificadores, na ordem de exibição. */
export const VERIFICADORES = [
  verificarWhatsApp,
  verificarAnthropic,
  verificarEmail,
  verificarCatalogo,
  verificarInventario,
  verificarMaster,
  verificarMeta,
  verificarGoogleAds,
  verificarDisco,
];
