// Autenticação de conta de serviço do Google sem SDK: JWT RS256 assinado com
// node:crypto e trocado por access token. Suporta impersonação (`sub`) para
// delegação em todo o domínio do Workspace (usada pelo envio via Gmail API).

import crypto from 'node:crypto';

const cache = new Map(); // chave (email|escopo|sub) -> { token, expira }

export function lerContaServico(bruto) {
  if (!bruto) return null;
  const txt = String(bruto).trim().startsWith('{') ? bruto : Buffer.from(bruto, 'base64').toString('utf8');
  const sa = JSON.parse(txt);
  if (!sa.client_email || !sa.private_key) throw new Error('conta de serviço sem client_email/private_key');
  return sa;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Access token da conta de serviço para o escopo pedido.
 * @param {object} sa JSON da conta de serviço
 * @param {string} escopo ex.: https://www.googleapis.com/auth/gmail.send
 * @param {{fetchFn?:Function, agora?:()=>number, sub?:string}} opts sub = usuário do Workspace a impersonar
 */
export async function tokenContaServico(sa, escopo, { fetchFn = fetch, agora = Date.now, sub } = {}) {
  const chave = `${sa.client_email}|${escopo}|${sub || ''}`;
  const c = cache.get(chave);
  if (c && c.expira - agora() > 60000) return c.token;

  const iat = Math.floor(agora() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: escopo, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600, ...(sub ? { sub } : {}) }));
  const assinatura = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key);
  const jwt = `${header}.${claims}.${b64url(assinatura)}`;

  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    signal: AbortSignal.timeout(15000),
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`Google OAuth ${res.status}: ${corpo.error_description || corpo.error || ''}`);
    e.codigo = corpo.error;
    throw e;
  }
  cache.set(chave, { token: corpo.access_token, expira: agora() + (corpo.expires_in || 3600) * 1000 });
  return corpo.access_token;
}

/** Só para testes. */
export function limparCacheTokens() {
  cache.clear();
}
