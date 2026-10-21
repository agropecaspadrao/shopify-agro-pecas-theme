// Chave de IP para limites de uso. IPv6: um cliente costuma ter um /64
// inteiro (2^64 endereços), então limitar por endereço não limita nada;
// agrupa pelos 4 primeiros blocos. IPv4 (inclusive mapeado em IPv6) fica como está.

function expandirIpv6(ip) {
  const [esq, dir = ''] = ip.split('::');
  const a = esq ? esq.split(':') : [];
  const b = dir ? dir.split(':') : [];
  const meio = ip.includes('::') ? Array(Math.max(0, 8 - a.length - b.length)).fill('0') : [];
  return [...a, ...meio, ...b].map((h) => h.toLowerCase().replace(/^0+(?=.)/, ''));
}

export function chaveIp(ip) {
  const s = String(ip || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
  if (!s) return 'sem-ip';
  const v4 = s.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4) return v4[1];
  if (!s.includes(':')) return s;
  return `${expandirIpv6(s).slice(0, 4).join(':')}::/64`;
}
