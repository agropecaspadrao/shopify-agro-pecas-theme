// Custos por token dos modelos Claude (US$ por milhão de tokens).
// A Carol usa cache de prompt com TTL de 1h: escrita de cache custa 2x a
// entrada e leitura custa 0,1x. Valores conforme tabela pública da Anthropic.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listarPeriodo } from './registro.js';
import { config } from './config.js';

// Extrato manual do crédito (recargas e gastos anteriores à medição
// automática) — editar src/extrato.json ao recarregar créditos.
const here = path.dirname(fileURLToPath(import.meta.url));
let EXTRATO = [];
try {
  EXTRATO = JSON.parse(fs.readFileSync(path.join(here, 'extrato.json'), 'utf8'));
} catch {}

const PRECOS = {
  'claude-opus-4-8': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 10 },
  'claude-opus-4-7': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 10 },
  'claude-opus-4-6': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 10 },
  'claude-sonnet-5': { entrada: 3, saida: 15, cacheLeitura: 0.3, cacheEscrita: 6 },
  'claude-sonnet-4-6': { entrada: 3, saida: 15, cacheLeitura: 0.3, cacheEscrita: 6 },
  'claude-haiku-4-5': { entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 2 },
};

/** Custo em US$ de uma resposta, a partir do uso acumulado de tokens. */
export function custoUSD(uso, modelo = config.claudeModel) {
  const p = PRECOS[modelo] || PRECOS['claude-opus-4-8'];
  return (
    ((uso.entrada || 0) * p.entrada +
      (uso.saida || 0) * p.saida +
      (uso.cacheLeitura || 0) * p.cacheLeitura +
      (uso.cacheEscrita || 0) * p.cacheEscrita) /
    1_000_000
  );
}

function diaBRT(iso) {
  return new Date(iso).toLocaleDateString('sv', { timeZone: config.timezone }); // YYYY-MM-DD
}

function rotuloCliente(sessao) {
  if (sessao.startsWith('wa:')) return `WhatsApp ${sessao.slice(3)}`;
  if (sessao.startsWith('site:')) return `Site ${sessao.slice(5, 17)}`;
  if (sessao === 'sistema:resumo') return 'Sistema: resumos p/ WhatsApp';
  if (sessao === 'sistema:relatorio') return 'Sistema: relatório diário';
  return sessao;
}

// Nome do cliente quando informado no prefixo "[Cliente: Fulano]" da mensagem
function nomeDoCliente(mensagem) {
  const m = String(mensagem || '').match(/^\[Cliente: ([^\]]+)\]/);
  return m ? m[1] : '';
}

/**
 * Agrega os registros dos últimos `dias` em números para o dashboard:
 * totais, custo por dia, ranking de conversas e mensagens mais caras.
 */
export function agregarCustos(dias = 7) {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - dias * 24 * 60 * 60 * 1000);
  const entradas = listarPeriodo(inicio, fim);
  const atendimento = entradas.filter((e) => e.tipo !== 'sistema');

  const totais = {
    custo: 0,
    custoSistema: 0,
    mensagens: atendimento.length,
    semCusto: 0, // registros antigos, gravados antes da medição de custo
    tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
  };
  const porDia = new Map();
  const conversas = new Map();

  for (const e of entradas) {
    const custo = typeof e.custo === 'number' ? e.custo : 0;
    if (typeof e.custo !== 'number' && e.tipo !== 'sistema') totais.semCusto++;
    totais.custo += custo;
    if (e.tipo === 'sistema') totais.custoSistema += custo;
    for (const k of Object.keys(totais.tokens)) totais.tokens[k] += e.uso?.[k] || 0;

    const dia = diaBRT(e.ts);
    const d = porDia.get(dia) || { dia, custo: 0, mensagens: 0 };
    d.custo += custo;
    d.mensagens++;
    porDia.set(dia, d);

    const c = conversas.get(e.sessao) || {
      sessao: e.sessao,
      cliente: rotuloCliente(e.sessao),
      canal: e.canal,
      mensagens: 0,
      custo: 0,
      tokens: 0,
      primeiraTs: e.ts,
      ultimaTs: e.ts,
      ultimaMensagem: '',
    };
    c.mensagens++;
    c.custo += custo;
    c.tokens += (e.uso?.entrada || 0) + (e.uso?.saida || 0) + (e.uso?.cacheLeitura || 0) + (e.uso?.cacheEscrita || 0);
    c.ultimaTs = e.ts;
    c.ultimaMensagem = String(e.mensagem || '').slice(0, 120);
    conversas.set(e.sessao, c);
  }

  // preenche dias sem movimento para o gráfico não "pular" datas
  const listaDias = [];
  for (let i = dias - 1; i >= 0; i--) {
    const dia = diaBRT(new Date(fim.getTime() - i * 24 * 60 * 60 * 1000).toISOString());
    listaDias.push(porDia.get(dia) || { dia, custo: 0, mensagens: 0 });
  }

  const rankingConversas = [...conversas.values()].sort((a, b) => b.custo - a.custo);

  const mensagensCaras = atendimento
    .filter((e) => typeof e.custo === 'number')
    .sort((a, b) => b.custo - a.custo)
    .slice(0, 10)
    .map((e) => ({
      ts: e.ts,
      cliente: rotuloCliente(e.sessao),
      canal: e.canal,
      custo: e.custo,
      uso: e.uso || null,
      mensagem: String(e.mensagem || '').slice(0, 120),
    }));

  // Lista detalhada, mensagem a mensagem (mais recentes primeiro), para a
  // tabela com filtros do dashboard.
  const detalhe = atendimento
    .slice()
    .reverse()
    .slice(0, 1500)
    .map((e) => ({
      ts: e.ts,
      cliente: rotuloCliente(e.sessao),
      nome: nomeDoCliente(e.mensagem),
      canal: e.canal,
      custo: typeof e.custo === 'number' ? e.custo : null,
      mensagem: String(e.mensagem || '').replace(/^\[Cliente: [^\]]+\] /, '').slice(0, 160),
      resposta: String(e.resposta || '').slice(0, 220),
    }));

  const saldo = saldoEstimado();

  const custoAtendimento = totais.custo - totais.custoSistema;
  return {
    periodo: { inicio: inicio.toISOString(), fim: fim.toISOString(), dias },
    modelo: config.claudeModel,
    cotacaoBRL: config.usdBrl,
    saldo,
    totais: {
      ...totais,
      conversas: conversas.size,
      custoMedioMsg: totais.mensagens ? custoAtendimento / (totais.mensagens - totais.semCusto || 1) : 0,
    },
    porDia: listaDias,
    conversas: rankingConversas,
    mensagensCaras,
    detalhe,
    extrato: EXTRATO,
  };
}

/**
 * Saldo ESTIMADO do crédito Anthropic: crédito sincronizado (CAROL_CREDITO_USD
 * na data CAROL_CREDITO_DESDE) menos tudo que a Carol registrou desde então.
 * O saldo oficial fica no console.anthropic.com (a API não expõe saldo).
 */
export function saldoEstimado() {
  if (!(config.creditoUsd > 0)) return null;
  const fim = new Date();
  const desde = config.creditoDesde
    ? new Date(config.creditoDesde)
    : new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);
  const gasto = listarPeriodo(desde, fim).reduce(
    (s, e) => s + (typeof e.custo === 'number' ? e.custo : 0),
    0
  );
  return {
    credito: config.creditoUsd,
    desde: desde.toISOString(),
    gasto,
    restante: Math.max(0, config.creditoUsd - gasto),
  };
}
