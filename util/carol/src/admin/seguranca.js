// Segurança da área administrativa (/admin/*): comparação de chaves em tempo
// constante, headers das respostas e o endereço do portal da operação.
//
// A administração da Carol é feita pelo SDR comercial (seção "Carol"), que
// chama a API /admin/api/* servidor→servidor com a CAROL_ADMIN_KEY no header
// Authorization. Não há mais painel próprio, login nem cookie de sessão.

import crypto from 'node:crypto';

export const PORTAL_PADRAO = 'https://sdr-backend-production.up.railway.app/sdr/admin/carol';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

/**
 * A chave recebida confere com a esperada? Compara hashes de tamanho fixo em
 * tempo constante (crypto.timingSafeEqual), sem vazar nem o tamanho da chave.
 */
export function chaveConfere(recebida, esperada) {
  if (!esperada || typeof recebida !== 'string' || !recebida) return false;
  return crypto.timingSafeEqual(sha(recebida), sha(esperada));
}

/** Headers de segurança de todas as respostas de /admin (só JSON e texto). */
export function headersSeguranca(_req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * Endereço da seção Carol no SDR (CAROL_PORTAL_URL). Só aceita http(s);
 * qualquer outra coisa cai no padrão, para o redirect nunca virar
 * javascript: ou caminho relativo.
 */
export function urlPortal(valor = process.env.CAROL_PORTAL_URL) {
  const s = String(valor || '').trim();
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
  } catch {}
  return PORTAL_PADRAO;
}
