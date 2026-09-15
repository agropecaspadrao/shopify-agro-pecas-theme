// Utilitários de texto compartilhados.

const LIMITE_WHATSAPP = 3500;

/** Divide um texto longo em mensagens de WhatsApp, cortando em quebras de linha. */
export function fatiar(texto, limite = LIMITE_WHATSAPP) {
  const partes = [];
  let resto = String(texto || '');
  while (resto.length > limite) {
    let corte = resto.lastIndexOf('\n', limite);
    if (corte < limite * 0.5) corte = limite;
    partes.push(resto.slice(0, corte).trimEnd());
    resto = resto.slice(corte).trimStart();
  }
  if (resto) partes.push(resto);
  return partes.map((p, i) => (partes.length > 1 ? `(${i + 1}/${partes.length})\n${p}` : p));
}
