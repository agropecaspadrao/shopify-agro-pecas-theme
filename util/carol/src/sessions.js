// Estado de conversa em memória, com reidratação a partir do registro JSONL:
// se o serviço reiniciar (deploy do Railway), o histórico recente é
// reconstruído do disco e a Carol continua a conversa de onde parou.

import { listarPeriodo } from './registro.js';

const TTL_MS = 12 * 60 * 60 * 1000; // 12h
const MAX_TURNOS = 30; // mensagens (user+assistant) mantidas por conversa

const sessoes = new Map();

export function obterHistorico(id) {
  const s = sessoes.get(id);
  if (!s || Date.now() - s.atualizadoEm > TTL_MS) {
    sessoes.delete(id);
    return reidratarDoRegistro(id);
  }
  return s.mensagens;
}

export function salvarHistorico(id, mensagens) {
  sessoes.set(id, {
    mensagens: mensagens.slice(-MAX_TURNOS),
    atualizadoEm: Date.now(),
  });
}

/**
 * Reconstrói o histórico da conversa a partir do registro em disco quando a
 * sessão em memória se perdeu. Mesmas regras da sessão viva: só entra a cadeia
 * ativa de mensagens (intervalos de até 12h entre pares, contando do fim) e no
 * máximo 30 mensagens. Retorna [] quando não há nada recente — aí a Carol
 * trata como conversa nova, com saudação.
 */
function reidratarDoRegistro(id) {
  let entradas;
  try {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - 3 * 24 * 60 * 60 * 1000);
    entradas = listarPeriodo(inicio, fim).filter(
      (e) => e.sessao === id && e.tipo !== 'sistema' && String(e.mensagem || '').trim() && String(e.resposta || '').trim()
    );
  } catch (e) {
    console.warn('[sessoes] falha ao reidratar do registro:', e.message);
    return [];
  }
  if (!entradas.length || Date.now() - new Date(entradas[entradas.length - 1].ts) > TTL_MS) return [];

  let i = entradas.length - 1;
  while (i > 0 && new Date(entradas[i].ts) - new Date(entradas[i - 1].ts) <= TTL_MS) i--;
  const mensagens = entradas
    .slice(i)
    .flatMap((e) => [
      { role: 'user', content: String(e.mensagem) },
      { role: 'assistant', content: String(e.resposta) },
    ])
    .slice(-MAX_TURNOS);

  salvarHistorico(id, mensagens);
  console.log(`[sessoes] histórico de ${id} reidratado do registro (${mensagens.length / 2} pares)`);
  return mensagens;
}

// Limpeza periódica
setInterval(() => {
  const agora = Date.now();
  for (const [id, s] of sessoes) {
    if (agora - s.atualizadoEm > TTL_MS) sessoes.delete(id);
  }
}, 30 * 60 * 1000).unref();
