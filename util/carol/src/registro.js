// Registro persistente dos atendimentos da Carol (arquivos JSONL por dia).
// Usado pelo relatório diário enviado à equipe às 8h.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.CAROL_DATA_DIR || path.join(here, '..', 'data');

function arquivoDoDia(data = new Date()) {
  const dia = data.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return path.join(DATA_DIR, `registro-${dia}.jsonl`);
}

export function registrarAtendimento({ canal, sessao, mensagem, resposta, uso, custo, modelo, tipo }) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const linha = JSON.stringify({
      ts: new Date().toISOString(),
      canal,
      sessao,
      ...(tipo ? { tipo } : {}),
      mensagem: String(mensagem).slice(0, 2000),
      resposta: String(resposta).slice(0, 2000),
      ...(uso ? { uso } : {}),
      ...(typeof custo === 'number' ? { custo } : {}),
      ...(modelo ? { modelo } : {}),
    });
    fs.appendFileSync(arquivoDoDia(), linha + '\n');
    espelharNoSdr(JSON.parse(linha));
  } catch (e) {
    console.warn('[registro] falha ao gravar:', e.message);
  }
}

// Espelho em tempo real no SDR comercial (app-agente-sdr): cada turno do
// WhatsApp vai para a conversa do mesmo telefone no painel do SDR. Fogo e
// esquece: nunca atrasa nem derruba o atendimento; se falhar, o SDR puxa o
// registro sozinho a cada 10 minutos (idempotente pela data do turno).
function espelharNoSdr(entrada) {
  const url = process.env.SDR_SYNC_URL;
  const chave = process.env.CAROL_ADMIN_KEY;
  if (!url || !chave || entrada.tipo === 'sistema' || !String(entrada.sessao || '').startsWith('wa:')) return;
  const { ts, canal, sessao, mensagem, resposta } = entrada;
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carol-key': chave },
    body: JSON.stringify({ ts, canal, sessao, mensagem, resposta }),
    signal: AbortSignal.timeout(15000),
  })
    .then((r) => { if (!r.ok) console.warn(`[sdr] espelho respondeu ${r.status}`); })
    .catch((e) => console.warn('[sdr] espelho falhou:', e.message));
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
