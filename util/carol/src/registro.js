// Registro persistente dos atendimentos da Carol (arquivos JSONL por dia).
// Usado pelo relatório diário enviado à equipe às 8h.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.CAROL_DATA_DIR || path.join(here, '..', 'data');

function arquivoDoDia(data = new Date()) {
  const dia = data.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return path.join(DATA_DIR, `registro-${dia}.jsonl`);
}

export function registrarAtendimento({ canal, sessao, mensagem, resposta }) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const linha = JSON.stringify({
      ts: new Date().toISOString(),
      canal,
      sessao,
      mensagem: String(mensagem).slice(0, 2000),
      resposta: String(resposta).slice(0, 2000),
    });
    fs.appendFileSync(arquivoDoDia(), linha + '\n');
  } catch (e) {
    console.warn('[registro] falha ao gravar:', e.message);
  }
}

/** Retorna as entradas com ts entre inicio e fim (objetos Date). */
export function listarPeriodo(inicio, fim) {
  const entradas = [];
  // varre os arquivos dos dias que o período pode tocar
  for (let d = new Date(inicio); d <= new Date(fim.getTime() + 86400000); d = new Date(d.getTime() + 86400000)) {
    const arq = arquivoDoDia(d);
    if (!fs.existsSync(arq)) continue;
    for (const linha of fs.readFileSync(arq, 'utf8').split('\n')) {
      if (!linha.trim()) continue;
      try {
        const e = JSON.parse(linha);
        const ts = new Date(e.ts);
        if (ts >= inicio && ts < fim) entradas.push(e);
      } catch {}
    }
  }
  return entradas.sort((a, b) => a.ts.localeCompare(b.ts));
}
