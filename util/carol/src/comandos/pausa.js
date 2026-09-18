// Pausa manual da Carol no WhatsApp ("/carol pausar" / "/carol voltar").
//
// Serve para quando um sócio quer atender pessoalmente fora do horário
// comercial (ou a Dai fica até mais tarde): a Carol fica em silêncio com os
// clientes por um período, sem mexer em variável do Railway nem redeploy.
// O estado fica em disco (DATA_DIR/pausa.json) para sobreviver a reinício.
// Os comandos "/carol" continuam funcionando durante a pausa.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { DATA_DIR } from '../registro.js';

const ARQUIVO = path.join(DATA_DIR, 'pausa.json');
export const HORAS_PADRAO = 2;
export const HORAS_MIN = 0.5;
export const HORAS_MAX = 12;

function ler() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return null;
  }
}

function gravar(estado) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(estado));
}

/** Converte o argumento do comando em horas válidas (vazio → padrão). */
export function horasDe(arg) {
  const n = Number(String(arg || '').replace(',', '.').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return HORAS_PADRAO;
  return Math.min(Math.max(n, HORAS_MIN), HORAS_MAX);
}

/** Hora legível em Brasília ("20:30"). */
export function horaBRT(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' });
}

/** Estado atual: { ativa, ate, desde, por, restanteMin }. */
export function estadoPausa({ agora = Date.now } = {}) {
  const e = ler();
  if (!e?.ate) return { ativa: false };
  const ate = new Date(e.ate).getTime();
  if (!(ate > agora())) return { ativa: false, expirouEm: e.ate };
  return {
    ativa: true,
    ate: e.ate,
    desde: e.desde || null,
    por: e.por || null,
    horas: e.horas || null,
    restanteMin: Math.ceil((ate - agora()) / 60000),
  };
}

export function pausada(opts) {
  return estadoPausa(opts).ativa;
}

/**
 * Pausa a Carol por N horas a partir de agora (renova se já estava pausada).
 * @returns estado após a pausa
 */
export function pausar({ horas = HORAS_PADRAO, por = null, agora = Date.now } = {}) {
  const h = Math.min(Math.max(Number(horas) || HORAS_PADRAO, HORAS_MIN), HORAS_MAX);
  const t = agora();
  const estado = { desde: new Date(t).toISOString(), ate: new Date(t + h * 3600000).toISOString(), horas: h, por: por ? String(por) : null };
  gravar(estado);
  console.log(`[pausa] Carol pausada no WhatsApp ate ${estado.ate} (${h}h)${por ? ` por ${por}` : ''}`);
  return estadoPausa({ agora });
}

/** Encerra a pausa. Devolve o estado que havia antes. */
export function retomar({ agora = Date.now } = {}) {
  const antes = estadoPausa({ agora });
  try {
    fs.unlinkSync(ARQUIVO);
  } catch {}
  if (antes.ativa) console.log('[pausa] Carol de volta ao atendimento no WhatsApp');
  return antes;
}

function mascarar(numero) {
  return String(numero || '').replace(/^(\d{4})\d+(\d{4})$/, '$1****$2');
}

/** Linha de status para "/carol status" e "/carol saude". */
export function textoPausa(estado = estadoPausa()) {
  if (!estado.ativa) return 'Pausa manual: nenhuma (a Carol atende normalmente fora do horario comercial).';
  const quem = estado.por ? ` por ${mascarar(estado.por)}` : '';
  return `Pausa manual: ATIVA ate ${horaBRT(estado.ate)} (faltam ${estado.restanteMin} min)${quem}. Para voltar antes: /carol voltar.`;
}
