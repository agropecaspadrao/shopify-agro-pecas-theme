// Agenda de tarefas com persistência e recuperação.
//
// O agendamento anterior era um setTimeout solto: se o serviço estivesse
// fora do ar às 8h, o relatório daquele dia simplesmente não existia. Aqui a
// última execução de cada tarefa fica em disco; no boot, uma tarefa que
// deveria ter rodado nas últimas N horas e não rodou é executada na hora
// (com anomalia informativa "rodou com atraso").
//
// Horários são em Brasília (UTC-3 fixo; o Brasil não tem mais horário de
// verão). Tarefa semanal usa diaSemana (0 = domingo ... 6 = sábado).

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { DATA_DIR } from './registro.js';

const ARQUIVO = path.join(DATA_DIR, 'agenda.json');
const OFFSET_BRT_MS = -3 * 3600 * 1000;
const DIA_MS = 24 * 3600 * 1000;
const MAX_TIMEOUT = 2 ** 31 - 1;

const tarefas = new Map();
let reportar = null; // injetado em iniciar() para evitar import circular em testes

function carregar() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return {};
  }
}

function salvar(estado) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify(estado));
  } catch (e) {
    console.error('[agenda] não consegui persistir:', e.message);
  }
}

/**
 * Próxima ocorrência de { hora, minuto, diaSemana? } (Brasília) depois de `apos`.
 * Também usada para achar a ocorrência anterior (com `anterior: true`).
 */
export function proximaOcorrencia({ hora, minuto = 0, diaSemana }, apos, { anterior = false } = {}) {
  // trabalha em "relógio BRT": desloca o instante, calcula em UTC, desloca de volta
  const brt = new Date(apos + OFFSET_BRT_MS);
  const base = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), hora, minuto, 0, 0);
  let alvo = base;
  if (diaSemana === undefined || diaSemana === null) {
    if (anterior) {
      if (alvo > brt.getTime()) alvo -= DIA_MS;
    } else if (alvo <= brt.getTime()) alvo += DIA_MS;
  } else {
    const diff = (diaSemana - new Date(alvo).getUTCDay() + 7) % 7;
    alvo += diff * DIA_MS;
    if (anterior) {
      if (alvo > brt.getTime()) alvo -= 7 * DIA_MS;
    } else if (alvo <= brt.getTime()) alvo += 7 * DIA_MS;
  }
  return alvo - OFFSET_BRT_MS;
}

/**
 * Registra uma tarefa. `executar` é async e pode devolver um resumo curto.
 * @param {{nome:string, quando:{hora:number, minuto?:number, diaSemana?:number}, executar:Function, descricao?:string}} t
 */
export function registrarTarefa(t) {
  if (!t?.nome || !t?.quando || typeof t.executar !== 'function') throw new Error('tarefa inválida');
  tarefas.set(t.nome, { ...t, timer: null });
}

async function rodar(nome, { motivo = 'agendado', agora = Date.now } = {}) {
  const t = tarefas.get(nome);
  if (!t) throw new Error(`tarefa desconhecida: ${nome}`);
  const estado = carregar();
  const inicio = agora();
  let resultado = { ok: true, resumo: '' };
  try {
    const r = await t.executar();
    resultado.resumo = typeof r === 'string' ? r : r?.resumo || r?.assunto || 'ok';
  } catch (e) {
    resultado = { ok: false, resumo: String(e.message || e).slice(0, 300) };
    console.error(`[agenda] ${nome} falhou:`, e.message);
  }
  estado[nome] = { ultimaExecucao: new Date(inicio).toISOString(), motivo, ...resultado, duracaoMs: agora() - inicio };
  salvar(estado);
  console.log(`[agenda] ${nome} (${motivo}): ${resultado.ok ? 'ok' : 'FALHOU'} ${resultado.resumo}`.trim());
  return estado[nome];
}

function armar(nome, agora = Date.now) {
  const t = tarefas.get(nome);
  if (!t) return;
  const proxima = proximaOcorrencia(t.quando, agora());
  const ms = Math.min(Math.max(proxima - agora(), 1000), MAX_TIMEOUT);
  if (t.timer) clearTimeout(t.timer);
  t.timer = setTimeout(async () => {
    await rodar(nome, { agora });
    armar(nome, agora);
  }, ms);
  t.timer.unref();
  console.log(`[agenda] ${nome}: próxima execução em ${(ms / 3600000).toFixed(1)}h`);
}

/**
 * Inicia todas as tarefas: recupera as perdidas (dentro da janela) e arma os timers.
 * @param {{agora?:()=>number, reportarAnomalia?:Function, janelaHoras?:number}} deps
 */
export async function iniciar(deps = {}) {
  const agora = deps.agora || Date.now;
  reportar = deps.reportarAnomalia || null;
  const janela = (deps.janelaHoras ?? config.agenda.janelaRecuperacaoHoras) * 3600 * 1000;
  const estado = carregar();
  const recuperadas = [];

  for (const [nome, t] of tarefas) {
    const anteriorPrevista = proximaOcorrencia(t.quando, agora(), { anterior: true });
    const ultima = estado[nome]?.ultimaExecucao ? new Date(estado[nome].ultimaExecucao).getTime() : 0;
    const perdida = ultima < anteriorPrevista && agora() - anteriorPrevista < janela;
    if (perdida) {
      const atrasoMin = Math.round((agora() - anteriorPrevista) / 60000);
      console.warn(`[agenda] ${nome} deveria ter rodado há ${atrasoMin} min; executando agora`);
      const r = await rodar(nome, { motivo: `recuperada (atraso ${atrasoMin} min)`, agora });
      recuperadas.push({ nome, atrasoMin, ...r });
      if (reportar) {
        await reportar({ tipo: 'agenda_atrasada', detalhe: `${nome} rodou com ${atrasoMin} min de atraso (serviço estava fora do ar no horário).` }).catch(() => {});
      }
    }
    if (!deps.semTimers) armar(nome, agora);
  }
  return recuperadas;
}

/** Executa uma tarefa agora (endpoint /admin e comandos). */
export function executarAgora(nome) {
  return rodar(nome, { motivo: 'manual' });
}

/** Quadro para o painel: cada tarefa com última execução e próxima prevista. */
export function listar({ agora = Date.now } = {}) {
  const estado = carregar();
  return [...tarefas.values()].map((t) => ({
    nome: t.nome,
    descricao: t.descricao || '',
    quando: t.quando,
    proxima: new Date(proximaOcorrencia(t.quando, agora())).toISOString(),
    ...(estado[t.nome] || {}),
  }));
}

/** Só para testes. */
export function limparTarefas() {
  for (const t of tarefas.values()) if (t.timer) clearTimeout(t.timer);
  tarefas.clear();
}
