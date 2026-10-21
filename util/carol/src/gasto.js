// Gasto acumulado com a API da Anthropic (DATA_DIR/gasto.json).
//
// Antes o saldo estimado relia TODOS os registros JSONL a cada resposta e
// "subia sozinho" quando a limpeza de 90 dias apagava arquivos antigos. Agora
// há um contador persistente: cada chamada paga soma o custo (gravação
// atômica). Na primeira vez (migração) o contador nasce da soma do registro
// que existir no disco, uma única vez.
//
// Também guarda o estado do crédito visto pela API: quando uma chamada falha
// com "credit balance is too low" (anomalia anthropic_credito) o crédito é
// marcado como esgotado até a próxima chamada paga com sucesso. É isso que o
// painel e o verificador de saúde mostram (count_tokens é gratuito e não
// prova que há crédito).

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './util/dados.js';
import { gravarJsonAtomico, lerJson } from './util/arquivo.js';

const arquivo = () => path.join(DATA_DIR, 'gasto.json');

/** Soma o campo `custo` das linhas do registro com ts >= desde (ms). Só na migração/base. */
export function somarRegistro(desde = 0, { dir = DATA_DIR } = {}) {
  let total = 0;
  let nomes = [];
  try {
    nomes = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  const diaCorte = new Date(desde || 0).toISOString().slice(0, 10);
  for (const nome of nomes) {
    const m = nome.match(/^registro-(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (!m || m[1] < diaCorte) continue;
    let txt = '';
    try {
      txt = fs.readFileSync(path.join(dir, nome), 'utf8');
    } catch {
      continue;
    }
    for (const l of txt.split('\n')) {
      if (!l.trim()) continue;
      try {
        const e = JSON.parse(l);
        if (typeof e.custo === 'number' && e.custo > 0 && Date.parse(e.ts) >= desde) total += e.custo;
      } catch {}
    }
  }
  return total;
}

function ler() {
  const g = lerJson(arquivo());
  if (g && typeof g.totalUsd === 'number') return g;
  // Migração: o contador nasce do registro existente (uma vez só)
  const novo = { totalUsd: somarRegistro(0), migradoEm: new Date().toISOString(), atualizadoEm: null, credito: {} };
  gravar(novo);
  return novo;
}

function gravar(g) {
  try {
    gravarJsonAtomico(arquivo(), g);
  } catch (e) {
    console.warn('[gasto] não consegui gravar o contador:', e.message);
  }
}

/** Total gasto (US$) desde que o contador existe. */
export function gastoTotal() {
  return ler().totalUsd;
}

/** Soma uma chamada paga. Chamada paga com sucesso também prova que há crédito. */
export function somarGasto(usd, { agora = Date.now } = {}) {
  const v = Number(usd);
  if (!Number.isFinite(v) || v <= 0) return;
  const g = ler();
  const ts = new Date(agora()).toISOString();
  g.totalUsd += v;
  g.atualizadoEm = ts;
  g.credito = { ...(g.credito || {}), okEm: ts };
  gravar(g);
}

/** A API recusou por falta de crédito. */
export function marcarErroCredito({ agora = Date.now } = {}) {
  const g = ler();
  g.credito = { ...(g.credito || {}), erroEm: new Date(agora()).toISOString() };
  gravar(g);
}

/** { esgotado, desde } — esgotado = último erro de crédito sem chamada paga depois. */
export function statusCredito() {
  const c = ler().credito || {};
  const esgotado = Boolean(c.erroEm) && (!c.okEm || c.okEm <= c.erroEm);
  return { esgotado, desde: esgotado ? c.erroEm : null, ultimaChamadaPagaEm: c.okEm || null };
}

/** Lê/grava a base derivada das variáveis CAROL_CREDITO_USD/DESDE (calculada uma vez). */
export function baseVariavel(credito, desde) {
  const g = ler();
  const b = g.baseVariavel;
  if (b && b.credito === credito && b.desdeVar === desde) return b;
  const inicio = desde ? Date.parse(desde) : Date.now() - 30 * 86400000;
  const nova = { credito, desdeVar: desde, desde: new Date(Number.isFinite(inicio) ? inicio : Date.now()).toISOString(), gastoNaBase: g.totalUsd - somarRegistro(inicio) };
  g.baseVariavel = nova;
  gravar(g);
  return nova;
}
