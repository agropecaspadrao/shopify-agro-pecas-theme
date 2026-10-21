// Sessão do painel do administrador.
//
// Login com a CAROL_ADMIN_KEY num formulário (POST), nunca na URL. Em troca o
// navegador recebe um cookie assinado (HMAC-SHA256) com validade de 12 h:
//   carol_painel = v1.<expiraEmMs>.<nonce>.<assinatura base64url>
// O cookie vale para todo /admin (painel, dashboard antigo, exportação) e
// é revogável: "Sair" põe o nonce numa lista em DATA_DIR/sessoes-revogadas.json
// até a data de expiração do token.
// O segredo da assinatura é CAROL_PAINEL_SEGREDO ou, na falta dele, derivado
// da própria chave de administrador — trocar a chave derruba todas as sessões.
//
// Comparações em tempo constante (crypto.timingSafeEqual) sobre hashes de
// tamanho fixo, para não vazar nem o tamanho da chave.

import crypto from 'node:crypto';
import path from 'node:path';
import { DATA_DIR } from '../util/dados.js';
import { gravarJsonAtomico, lerJson } from '../util/arquivo.js';

export const COOKIE = 'carol_painel';
export const VALIDADE_MS = 12 * 60 * 60 * 1000;
export const CAMINHO = '/admin';
const CAMINHO_ANTIGO = '/admin/painel';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function segredoDe({ chaveAdmin = process.env.CAROL_ADMIN_KEY || '', segredo = process.env.CAROL_PAINEL_SEGREDO || '' } = {}) {
  if (segredo) return Buffer.from(segredo);
  if (!chaveAdmin) return null;
  return crypto.createHmac('sha256', 'carol-painel-v1').update(chaveAdmin).digest();
}

/** A chave digitada confere com a de administrador? (tempo constante) */
export function chaveConfere(recebida, esperada) {
  if (!esperada || typeof recebida !== 'string' || !recebida) return false;
  return crypto.timingSafeEqual(sha(recebida), sha(esperada));
}

function assinar(segredo, carga) {
  return crypto.createHmac('sha256', segredo).update(carga).digest('base64url');
}

export function criarToken(segredo, { agora = Date.now, validadeMs = VALIDADE_MS } = {}) {
  const carga = `v1.${agora() + validadeMs}.${crypto.randomBytes(12).toString('base64url')}`;
  return `${carga}.${assinar(segredo, carga)}`;
}

/**
 * Lista de sessões revogadas (nonce → expiração). Persistida em disco para
 * valer depois de reinício; entradas vencidas são descartadas ao gravar.
 */
export function criarRevogados({ arquivo = path.join(DATA_DIR, 'sessoes-revogadas.json'), agora = Date.now, persistir = true } = {}) {
  let mapa = null;
  const carregar = () => (mapa ||= new Map(Object.entries((persistir && lerJson(arquivo)) || {})));
  return {
    revogado(nonce) {
      const exp = carregar().get(nonce);
      return Boolean(exp && exp > agora());
    },
    revogar(nonce, expiraEm) {
      const m = carregar();
      for (const [k, v] of m) if (v <= agora()) m.delete(k);
      m.set(nonce, expiraEm);
      if (persistir) {
        try {
          gravarJsonAtomico(arquivo, Object.fromEntries(m));
        } catch (e) {
          console.warn('[painel] não consegui gravar a revogação da sessão:', e.message);
        }
      }
    },
  };
}

let revogadosPadrao = null;
export function revogadosDoServico() {
  return (revogadosPadrao ||= criarRevogados());
}

/** Revoga o token (botão "Sair"). Token inválido é ignorado. */
export function revogarToken(token, segredo, revogados = revogadosDoServico()) {
  const v = verificarToken(token, segredo, { revogados });
  if (v.ok) revogados.revogar(v.nonce, v.expiraEm);
  return v.ok;
}

/** @returns {{ok:boolean, motivo?:string, expiraEm?:number, nonce?:string}} */
export function verificarToken(token, segredo, { agora = Date.now, revogados = null } = {}) {
  if (!segredo) return { ok: false, motivo: 'painel desativado' };
  const partes = String(token || '').split('.');
  if (partes.length !== 4 || partes[0] !== 'v1') return { ok: false, motivo: 'formato' };
  const carga = partes.slice(0, 3).join('.');
  const esperada = Buffer.from(assinar(segredo, carga));
  const recebida = Buffer.from(partes[3]);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return { ok: false, motivo: 'assinatura' };
  const expira = Number(partes[1]);
  if (!Number.isFinite(expira) || expira <= agora()) return { ok: false, motivo: 'expirada' };
  if (revogados?.revogado(partes[2])) return { ok: false, motivo: 'revogada' };
  return { ok: true, expiraEm: expira, nonce: partes[2] };
}

export function lerCookie(req, nome = COOKIE) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`));
  return m ? m[1] : '';
}

export function cookieSessao(token, { maxAgeS = VALIDADE_MS / 1000 } = {}) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=${CAMINHO}; Max-Age=${maxAgeS}`;
}

/** Apaga o cookie (no caminho atual e no antigo /admin/painel, de antes da mudança). */
export function cookieSaida() {
  return [CAMINHO, CAMINHO_ANTIGO].map((c) => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=${c}; Max-Age=0`);
}

/**
 * Proteção CSRF das ações de escrita (além do SameSite=Strict):
 * exige o header X-Carol-Painel e Origin igual ao do próprio serviço (ou,
 * sem Origin, Sec-Fetch-Site same-origin). Formulário de outro site não
 * consegue mandar header customizado sem preflight, e o CORS não o libera.
 */
export function origemConfere(req, { exigirHeader = true } = {}) {
  if (exigirHeader && req.get('x-carol-painel') !== '1') return false;
  const origem = req.get('origin');
  const propria = `${req.protocol}://${req.get('host')}`;
  if (origem) return origem === propria;
  return req.get('sec-fetch-site') === 'same-origin';
}

/** Headers de segurança de todas as respostas do painel. */
export function headersSeguranca(_req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // same-origin (não no-referrer): com no-referrer o Chrome manda "Origin: null"
  // no POST do formulário de login e a verificação de origem recusaria.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}
