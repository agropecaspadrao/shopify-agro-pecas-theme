// Custos por token dos modelos Claude (US$ por milhão de tokens).
// A Carol usa cache de prompt com TTL de 1h: escrita de cache custa 2x a
// entrada e leitura custa 0,1x. Valores conforme tabela pública da Anthropic.

import { listarPeriodo } from './registro.js';
import { config } from './config.js';

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
  return sessao;
}

/**
 * Agrega os registros dos últimos `dias` em números para o dashboard:
 * totais, custo por dia, ranking de conversas e mensagens mais caras.
 */
export function agregarCustos(dias = 7) {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - dias * 24 * 60 * 60 * 1000);
  const entradas = listarPeriodo(inicio, fim);

  const totais = {
    custo: 0,
    mensagens: entradas.length,
    semCusto: 0, // registros antigos, gravados antes da medição de custo
    tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
  };
  const porDia = new Map();
  const conversas = new Map();

  for (const e of entradas) {
    const custo = typeof e.custo === 'number' ? e.custo : 0;
    if (typeof e.custo !== 'number') totais.semCusto++;
    totais.custo += custo;
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

  const mensagensCaras = entradas
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

  return {
    periodo: { inicio: inicio.toISOString(), fim: fim.toISOString(), dias },
    modelo: config.claudeModel,
    cotacaoBRL: config.usdBrl,
    totais: {
      ...totais,
      conversas: conversas.size,
      custoMedioMsg: entradas.length ? totais.custo / (entradas.length - totais.semCusto || 1) : 0,
    },
    porDia: listaDias,
    conversas: rankingConversas,
    mensagensCaras,
  };
}
