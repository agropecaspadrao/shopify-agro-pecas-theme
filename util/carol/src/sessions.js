// Estado de conversa em memória. Suficiente para a v1: se o serviço
// reiniciar, a Carol perde o histórico e recomeça a conversa educadamente.

const TTL_MS = 12 * 60 * 60 * 1000; // 12h
const MAX_TURNOS = 30; // mensagens (user+assistant) mantidas por conversa

const sessoes = new Map();

export function obterHistorico(id) {
  const s = sessoes.get(id);
  if (!s || Date.now() - s.atualizadoEm > TTL_MS) {
    sessoes.delete(id);
    return [];
  }
  return s.mensagens;
}

export function salvarHistorico(id, mensagens) {
  sessoes.set(id, {
    mensagens: mensagens.slice(-MAX_TURNOS),
    atualizadoEm: Date.now(),
  });
}

// Limpeza periódica
setInterval(() => {
  const agora = Date.now();
  for (const [id, s] of sessoes) {
    if (agora - s.atualizadoEm > TTL_MS) sessoes.delete(id);
  }
}, 30 * 60 * 1000).unref();
