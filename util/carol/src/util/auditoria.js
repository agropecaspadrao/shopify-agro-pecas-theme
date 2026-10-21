// Trilha de auditoria (DATA_DIR/auditoria.jsonl): comandos /carol, painel,
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
