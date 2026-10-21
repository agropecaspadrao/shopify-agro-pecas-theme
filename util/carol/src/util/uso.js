// Uso de tokens de uma chamada à API da Anthropic, no formato do registro.

export function usoVazio() {
  return { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, chamadas: 0 };
}

/** Soma o `usage` de uma resposta da SDK no acumulador (ou num novo). */
export function somarUso(usage, acc = usoVazio()) {
  const u = usage || {};
  acc.entrada += u.input_tokens || 0;
  acc.saida += u.output_tokens || 0;
  acc.cacheLeitura += u.cache_read_input_tokens || 0;
  acc.cacheEscrita += u.cache_creation_input_tokens || 0;
  acc.chamadas++;
  return acc;
}

/** Uso de uma chamada única. */
export function usoDe(usage) {
  return somarUso(usage);
}
