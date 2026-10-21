// Mascaramento de telefone: única função usada em logs, painel, dashboard e
// textos de status. O número completo só sai na exportação para o SDR/CSV
// (necessário para a integração) e nunca em log.

/** 5541984151085 → 55419****1085 */
export function mascararTelefone(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length < 9) return d ? '****' : '';
  return `${d.slice(0, 5)}****${d.slice(-4)}`;
}

/** Sessão do registro → rótulo seguro para exibir/logar. */
export function mascararSessao(sessao) {
  const s = String(sessao || '');
  if (s.startsWith('wa:')) return mascararTelefone(s.slice(3));
  if (s.startsWith('site:')) return `site ${s.slice(5, 9)}…`;
  return 'sistema';
}

/** Para log: aceita telefone puro ou sessão ("wa:..."/"site:..."). */
export function mascarar(v) {
  const s = String(v || '');
  if (s.startsWith('wa:') || s.startsWith('site:') || s.startsWith('sistema')) return mascararSessao(s);
  return mascararTelefone(s);
}
