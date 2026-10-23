// Trilha de auditoria (DATA_DIR/auditoria.jsonl): comandos /carol, ações da
// API de administração (origem 'sdr', com o login de quem fez no SDR),
// exclusões LGPD. Nunca lança.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './dados.js';

export function auditar(evento, { dir = DATA_DIR } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'auditoria.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...evento }) + '\n');
  } catch {}
}

/** Últimas `n` linhas da trilha, mais recentes primeiro. */
export function lerAuditoria(n = 100, { dir = DATA_DIR } = {}) {
  let linhas = [];
  try {
    linhas = fs.readFileSync(path.join(dir, 'auditoria.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
  } catch {}
  const eventos = linhas
    .slice(-n)
    .reverse()
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { bruto: l };
      }
    });
  return { total: linhas.length, eventos };
}
