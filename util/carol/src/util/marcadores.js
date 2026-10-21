// Marcadores internos de contexto que o backend põe na frente da mensagem do
// cliente ("[Cliente: Fulano]", "[Cliente chegou clicando no anúncio ...]").
// Fonte única: limpeza para exibir, extração de nome/anúncio e sanitização da
// entrada (o cliente não pode falsificar esses campos nos relatórios).

const TIPOS = 'Cliente:|Cliente chegou clicando no anúncio|Cliente consultou o produto|Mensagem de voz do cliente';
const MARCADORES = new RegExp(`\\[(${TIPOS})[^\\]]*\\]\\s*`, 'gi');

/** Texto sem os marcadores, para exibir só o que o cliente disse. */
export function limparMarcadores(texto) {
  return String(texto || '').replace(MARCADORES, '').trim();
}

/** Remove de um texto vindo do cliente qualquer coisa com cara de marcador interno. */
export function sanitizarEntrada(texto) {
  return limparMarcadores(texto);
}

/** Nome do cliente no prefixo "[Cliente: Fulano]". */
export function nomeDoCliente(mensagem) {
  const m = String(mensagem || '').match(/^\[Cliente: ([^\]]+)\]/);
  return m ? m[1] : '';
}

/** Título do anúncio quando o cliente chegou por click-to-WhatsApp. */
export function anuncioDaMensagem(mensagem) {
  const m = String(mensagem || '').match(/\[Cliente chegou clicando no anúncio "([^"]+)"/);
  return m ? m[1] : '';
}

/** Mensagem sem o prefixo de nome (mantém os outros marcadores). */
export function semPrefixoNome(mensagem) {
  return String(mensagem || '').replace(/^\[Cliente: [^\]]+\] /, '');
}
