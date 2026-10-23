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
import { gravarJsonAtomico } from '../util/arquivo.js';
import { mascararTelefone, mascarar } from '../util/telefone.js';

const ARQUIVO = path.join(DATA_DIR, 'pausa.json');
export const HORAS_PADRAO = 2;
export const HORAS_MIN = 0.5;
export const HORAS_MAX = 12;
// Pelo SDR (seção Carol) o dono pode desligar por mais tempo (ou "até eu religar").
export const HORAS_MAX_PAINEL = 72;

function ler() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return null;
  }
}

function gravar(estado) {
  gravarJsonAtomico(ARQUIVO, estado);
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
  // Desligada "até eu religar": sem prazo, só volta com retomar()
  if (e?.indefinida) return { ativa: true, indefinida: true, ate: null, desde: e.desde || null, por: e.por || null, horas: null, restanteMin: null };
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
 * `indefinida: true` desliga sem prazo ("até eu religar"); `maxHoras` permite
 * à API do SDR ir além do teto dos comandos do WhatsApp.
 * @returns estado após a pausa
 */
export function pausar({ horas = HORAS_PADRAO, por = null, agora = Date.now, indefinida = false, maxHoras = HORAS_MAX } = {}) {
  const t = agora();
  if (indefinida) {
    gravar({ desde: new Date(t).toISOString(), ate: null, indefinida: true, por: por ? String(por) : null });
    console.log(`[pausa] Carol desligada no WhatsApp ate alguem religar${por ? ` (por ${mascarar(por)})` : ''}`);
    return estadoPausa({ agora });
  }
  const h = Math.min(Math.max(Number(horas) || HORAS_PADRAO, HORAS_MIN), Math.max(HORAS_MAX, Math.min(Number(maxHoras) || HORAS_MAX, HORAS_MAX_PAINEL)));
  const estado = { desde: new Date(t).toISOString(), ate: new Date(t + h * 3600000).toISOString(), horas: h, por: por ? String(por) : null };
  gravar(estado);
  console.log(`[pausa] Carol pausada no WhatsApp ate ${estado.ate} (${h}h)${por ? ` por ${mascarar(por)}` : ''}`);
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

/** Linha de status para "/carol status" e "/carol saude". */
export function textoPausa(estado = estadoPausa()) {
  if (!estado.ativa) return 'Pausa manual: nenhuma (a Carol segue o horario de atendimento configurado).';
  const quem = estado.por ? ` por ${/^\d+$/.test(estado.por) ? mascararTelefone(estado.por) : estado.por}` : '';
  if (estado.indefinida) return `Pausa manual: ATIVA sem prazo (desligada ate alguem religar)${quem}. Para voltar: /carol voltar ou o SDR (secao Carol).`;
  return `Pausa manual: ATIVA ate ${horaBRT(estado.ate)} (faltam ${estado.restanteMin} min)${quem}. Para voltar antes: /carol voltar.`;
}
