// Estado de atendimento para o painel, a partir dos arquivos de registro
// (DATA_DIR/registro-AAAA-MM-DD.jsonl, um por dia UTC).
//
// O polling de 5 s não pode reler o dia inteiro a cada vez: o leitor guarda,
// por arquivo, até onde já leu (offset) e só lê o que foi acrescentado desde
// então. Linha incompleta no fim (gravação em andamento) fica guardada até a
// próxima leitura. Arquivo menor que o offset (recriado) é relido do zero.
//
// Dados pessoais: o painel recebe só telefone mascarado e um trecho curto da
// mensagem; o texto completo e a resposta da Carol não saem daqui.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export const ATIVA_MS = 30 * 60 * 1000;
const DIA_MS = 86400000;

// ── Fuso local (uma chamada Intl por entrada, feita uma única vez) ─────────
const fmtLocal = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** { data: 'AAAA-MM-DD' local, hora, min, dow (0 = domingo) } */
export function infoLocal(t) {
  const p = Object.fromEntries(fmtLocal.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, min: Number(p.minute), dow: DOW[p.weekday] };
}

/** Início do dia local (meia-noite no fuso da loja) em ms. */
export function inicioDiaLocal(t) {
  const { hora, min } = infoLocal(t);
  return t - (t % 60000) - (hora * 60 + min) * 60000;
}

// ── Mascaramento (fonte única em util/telefone.js) ────────────────────────
import { mascararSessao } from '../util/telefone.js';
export { mascararTelefone, mascararSessao } from '../util/telefone.js';

/** Trecho curto e limpo da mensagem do cliente (sem marcadores internos). */
export function trecho(texto, max = 60) {
  const t = String(texto || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function compactar(e) {
  const t = Date.parse(e.ts);
  if (!Number.isFinite(t)) return null;
  const loc = infoLocal(t);
  return {
    t,
    data: loc.data,
    hora: loc.hora,
    dow: loc.dow,
    canal: e.canal === 'site' ? 'site' : e.canal === 'sistema' ? 'sistema' : 'whatsapp',
    sessao: String(e.sessao || ''),
    sistema: e.tipo === 'sistema' || e.canal === 'sistema' || String(e.sessao || '').startsWith('sistema'),
    tipo: e.tipo || (e.entregue === false ? 'nao_entregue' : ''),
    msg: trecho(e.tipo === 'humano' ? `[equipe] ${e.resposta || ''}` : e.mensagem),
  };
}

export function arquivoDoDiaUTC(dir, t) {
  return path.join(dir, `registro-${new Date(t).toISOString().slice(0, 10)}.jsonl`);
}

// ── Leitor incremental ────────────────────────────────────────────────────
export function criarLeitor() {
  const arquivos = new Map(); // caminho -> { offset, resto, entradas }
  const stats = { bytesLidos: 0, leituras: 0 };

  function ler(arquivo) {
    let st;
    try {
      st = fs.statSync(arquivo);
    } catch {
      arquivos.delete(arquivo);
      return [];
    }
    let reg = arquivos.get(arquivo);
    if (!reg || st.size < reg.offset) {
      reg = { offset: 0, resto: '', entradas: [] };
      arquivos.set(arquivo, reg);
    }
    if (st.size > reg.offset) {
      const n = st.size - reg.offset;
      const buf = Buffer.alloc(n);
      const fd = fs.openSync(arquivo, 'r');
      let lidos = 0;
      try {
        lidos = fs.readSync(fd, buf, 0, n, reg.offset);
      } finally {
        fs.closeSync(fd);
      }
      reg.offset += lidos;
      stats.bytesLidos += lidos;
      stats.leituras++;
      const texto = reg.resto + buf.subarray(0, lidos).toString('utf8');
      const linhas = texto.split('\n');
      reg.resto = linhas.pop(); // pedaço sem \n ainda: espera a próxima leitura
      for (const l of linhas) {
        if (!l.trim()) continue;
        try {
          const c = compactar(JSON.parse(l));
          if (c) reg.entradas.push(c);
        } catch {}
      }
    }
    return reg.entradas;
  }

  /** Mantém em memória só os arquivos da lista (libera os dias antigos). */
  function manterSo(lista) {
    const manter = new Set(lista);
    for (const k of arquivos.keys()) if (!manter.has(k)) arquivos.delete(k);
  }

  return { ler, manterSo, stats };
}

/** Entradas desde `desde` (ms), lendo de forma incremental os arquivos UTC que o intervalo toca. */
export function entradasDesde(leitor, dir, desde, agora) {
  const lista = [];
  for (let d = desde - (desde % DIA_MS); d <= agora; d += DIA_MS) lista.push(arquivoDoDiaUTC(dir, d));
  leitor.manterSo(lista);
  const r = [];
  for (const arq of lista) for (const e of leitor.ler(arq)) if (e.t >= desde && e.t <= agora) r.push(e);
  return r;
}

/**
 * Contadores de hoje (dia local) + conversas ativas + últimas interações.
 */
export function resumoAtendimento({ leitor, dir, agora = Date.now() }) {
  const inicio = inicioDiaLocal(agora);
  const todas = entradasDesde(leitor, dir, Math.min(inicio, agora - ATIVA_MS), agora).filter((e) => !e.sistema);
  const hoje = todas.filter((e) => e.t >= inicio);

  const ultimaPorSessao = new Map();
  for (const e of todas) ultimaPorSessao.set(e.sessao, Math.max(ultimaPorSessao.get(e.sessao) || 0, e.t));
  let ativas = 0;
  for (const t of ultimaPorSessao.values()) if (agora - t < ATIVA_MS) ativas++;

  const porCanal = { whatsapp: 0, site: 0 };
  const porHora = new Array(24).fill(0);
  const sessoes = new Set();
  let semRespostaHoje = 0;
  let respostasEquipeHoje = 0;
  for (const e of hoje) {
    if (e.tipo === 'humano') {
      respostasEquipeHoje++;
      continue; // resposta da equipe não é mensagem de cliente
    }
    if (['falha', 'silencio', 'aviso', 'nao_entregue'].includes(e.tipo)) semRespostaHoje++;
    porCanal[e.canal] = (porCanal[e.canal] || 0) + 1;
    porHora[e.hora]++;
    sessoes.add(e.sessao);
  }

  const ultimas = [...todas]
    .sort((a, b) => b.t - a.t)
    .slice(0, 10)
    .map((e) => ({ t: e.t, canal: e.canal, quem: mascararSessao(e.sessao), trecho: e.msg, ...(e.tipo ? { tipo: e.tipo } : {}) }));

  const mensagensHoje = hoje.filter((e) => e.tipo !== 'humano').length;
  return { inicioDia: inicio, ativas, mensagensHoje, clientesHoje: sessoes.size, porCanal, porHora, ultimas, semRespostaHoje, respostasEquipeHoje };
}

// ── Picos (histórico) ─────────────────────────────────────────────────────
// Dias passados não mudam: o agregado dos últimos 30 dias é calculado uma vez
// por dia local e reaproveitado; só o dia de hoje vem do leitor incremental.
function lerArquivoInteiro(arquivo) {
  let txt = '';
  try {
    txt = fs.readFileSync(arquivo, 'utf8');
  } catch {
    return [];
  }
  const r = [];
  for (const l of txt.split('\n')) {
    if (!l.trim()) continue;
    try {
      const c = compactar(JSON.parse(l));
      if (c && !c.sistema && c.tipo !== 'humano') r.push(c);
    } catch {}
  }
  return r;
}

export function agregarHistorico(dir, inicioHoje, dias = 30) {
  const desde = inicioHoje - dias * DIA_MS;
  const porDiaHora = new Map(); // 'AAAA-MM-DD' -> number[24]
  for (let d = desde - (desde % DIA_MS); d < inicioHoje + DIA_MS; d += DIA_MS) {
    for (const e of lerArquivoInteiro(arquivoDoDiaUTC(dir, d))) {
      if (e.t < desde || e.t >= inicioHoje) continue;
      if (!porDiaHora.has(e.data)) porDiaHora.set(e.data, new Array(24).fill(0));
      porDiaHora.get(e.data)[e.hora]++;
    }
  }
  // média dos últimos 7 dias (dias sem mensagem contam como zero)
  const media7 = new Array(24).fill(0);
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const ocorrencias = new Array(7).fill(0);
  for (let i = 1; i <= dias; i++) {
    const t = inicioHoje - i * DIA_MS + 12 * 3600000; // meio-dia do dia local i dias atrás
    const { data, dow } = infoLocal(t);
    const linha = porDiaHora.get(data) || new Array(24).fill(0);
    ocorrencias[dow]++;
    for (let h = 0; h < 24; h++) {
      heat[dow][h] += linha[h];
      if (i <= 7) media7[h] += linha[h] / 7;
    }
  }
  // heatmap como média por ocorrência daquele dia da semana
  const heatMedia = heat.map((l, dow) => l.map((v) => (ocorrencias[dow] ? Math.round((v / ocorrencias[dow]) * 10) / 10 : 0)));
  let pico = { dow: null, hora: null, media: 0 };
  heatMedia.forEach((l, dow) => l.forEach((v, h) => {
    if (v > pico.media) pico = { dow, hora: h, media: v };
  }));
  return { media7: media7.map((v) => Math.round(v * 10) / 10), heatmap: heatMedia, picoSemana: pico, total: [...porDiaHora.values()].reduce((s, l) => s + l.reduce((a, b) => a + b, 0), 0) };
}

export function criarPicos({ dir }) {
  let cacheDia = null; // { inicio, dados }
  return function picos({ porHoraHoje, agora = Date.now() }) {
    const inicio = inicioDiaLocal(agora);
    if (!cacheDia || cacheDia.inicio !== inicio) cacheDia = { inicio, dados: agregarHistorico(dir, inicio) };
    let picoHoje = { hora: null, n: 0 };
    porHoraHoje.forEach((n, h) => {
      if (n > picoHoje.n) picoHoje = { hora: h, n };
    });
    return { hoje: porHoraHoje, media7: cacheDia.dados.media7, picoHoje, heatmap: cacheDia.dados.heatmap, picoSemana: cacheDia.dados.picoSemana, total30d: cacheDia.dados.total };
  };
}
