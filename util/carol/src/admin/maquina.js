// Saúde do processo da Carol, em tempo real e sem dependências:
//   - CPU% pelo delta de process.cpuUsage() entre amostras
//   - memória (RSS = memória usada pelo processo; heap = memória do JavaScript)
//   - atraso do event loop (perf_hooks.monitorEventLoopDelay): quanto o
//     processo demora para "pegar" uma tarefa nova; alto = engasgado
//   - tempo de resposta da Carol: medido em volta de cada chamada ao Claude
//     (server.js chama medirResposta), guardado só em memória
//
// A amostragem roda a cada 5 s num timer com unref() (não segura o processo)
// e guarda um buffer circular de 120 pontos (~10 min) para o gráfico ao vivo.

import { monitorEventLoopDelay } from 'node:perf_hooks';

export const INTERVALO_MS = 5000;
export const PONTOS = 120;

// ── Buffer circular ───────────────────────────────────────────────────────
export function criarBuffer(capacidade) {
  const itens = new Array(capacidade);
  let inicio = 0;
  let tamanho = 0;
  return {
    push(x) {
      itens[(inicio + tamanho) % capacidade] = x;
      if (tamanho < capacidade) tamanho++;
      else inicio = (inicio + 1) % capacidade;
    },
    lista() {
      const r = [];
      for (let i = 0; i < tamanho; i++) r.push(itens[(inicio + i) % capacidade]);
      return r;
    },
    ultimo() {
      return tamanho ? itens[(inicio + tamanho - 1) % capacidade] : null;
    },
    get tamanho() {
      return tamanho;
    },
  };
}

// ── Amostragem do processo ────────────────────────────────────────────────
const serie = criarBuffer(PONTOS);
let timer = null;
let eld = null;
let cpuAnterior = null;
let tAnterior = 0;
let servidorHttp = null;
let conexoes = null;

const MB = 1024 * 1024;
const r1 = (n) => Math.round(n * 10) / 10;

/** Tira uma amostra agora (também usado nos testes). */
export function amostrar() {
  const t = Date.now();
  const cpu = process.cpuUsage();
  let cpuPct = 0;
  if (cpuAnterior && t > tAnterior) {
    const usadoUs = cpu.user - cpuAnterior.user + (cpu.system - cpuAnterior.system);
    cpuPct = (usadoUs / 1000 / (t - tAnterior)) * 100; // % de um núcleo
  }
  cpuAnterior = cpu;
  tAnterior = t;
  const mem = process.memoryUsage();
  let lag = 0;
  let lagMax = 0;
  if (eld) {
    lag = eld.mean / 1e6;
    lagMax = eld.max / 1e6;
    eld.reset();
  }
  const ponto = { t, cpu: r1(Math.max(cpuPct, 0)), rss: r1(mem.rss / MB), heap: r1(mem.heapUsed / MB), heapTotal: r1(mem.heapTotal / MB), lag: r1(Number.isFinite(lag) ? lag : 0), lagMax: r1(Number.isFinite(lagMax) ? lagMax : 0) };
  serie.push(ponto);
  if (servidorHttp) {
    servidorHttp.getConnections((err, n) => {
      if (!err) conexoes = n;
    });
  }
  return ponto;
}

/** Liga a amostragem (idempotente). */
export function iniciarAmostragem() {
  if (timer) return;
  try {
    eld = monitorEventLoopDelay({ resolution: 20 });
    eld.enable();
  } catch {
    eld = null;
  }
  amostrar();
  timer = setInterval(amostrar, INTERVALO_MS);
  timer.unref();
}

export function pararAmostragem() {
  if (timer) clearInterval(timer);
  timer = null;
  eld?.disable();
  eld = null;
}

/** server.js passa o http.Server para contarmos as conexões abertas. */
export function registrarServidorHttp(s) {
  servidorHttp = s;
}

/** Resumo atual (para o polling de 5 s). */
export function estadoMaquina() {
  const p = serie.ultimo() || amostrar();
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || '';
  return {
    ...p,
    uptimeS: Math.round(process.uptime()),
    conexoes,
    versao: sha ? sha.slice(0, 7) : null,
    node: process.version,
  };
}

/** Série completa (para semear o gráfico ao abrir o painel). */
export function serieMaquina() {
  return serie.lista().map((p) => [p.t, p.cpu, p.rss, p.heap, p.lag]);
}

// ── Tempo de resposta da Carol ────────────────────────────────────────────
const respostas = criarBuffer(500); // { t, ms, canal, ok }
let emAndamento = 0;

/** Mede uma chamada (ex.: responder do Claude) sem alterar o resultado. */
export async function medirResposta(canal, fn) {
  const t0 = performance.now();
  emAndamento++;
  try {
    const r = await fn();
    respostas.push({ t: Date.now(), ms: Math.round(performance.now() - t0), canal, ok: true });
    return r;
  } catch (e) {
    respostas.push({ t: Date.now(), ms: Math.round(performance.now() - t0), canal, ok: false });
    throw e;
  } finally {
    emAndamento--;
  }
}

/** Estatística das respostas medidas desde `desde` (ms epoch). */
export function estatisticaRespostas(desde = 0) {
  const lista = respostas.lista().filter((r) => r.t >= desde);
  const ok = lista.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const media = ok.length ? Math.round(ok.reduce((s, x) => s + x, 0) / ok.length) : null;
  const p90 = ok.length ? ok[Math.min(ok.length - 1, Math.floor(ok.length * 0.9))] : null;
  return { medidas: ok.length, mediaMs: media, p90Ms: p90, maxMs: ok.length ? ok[ok.length - 1] : null, falhas: lista.length - ok.length, emAndamento };
}

/** Só para testes. */
export function _registrarResposta(r) {
  respostas.push(r);
}
