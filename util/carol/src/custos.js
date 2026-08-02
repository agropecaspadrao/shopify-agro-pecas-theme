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

// Título do anúncio quando o cliente chegou por click-to-WhatsApp
function anuncioDaMensagem(mensagem) {
  const m = String(mensagem || '').match(/\[Cliente chegou clicando no anúncio "([^"]+)"/);
  return m ? m[1] : '';
}

function horaBRT(iso) {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
  return Number(h) % 24;
}

function fmtUsd(v) {
  return 'US$ ' + (v || 0).toFixed(v && v < 0.1 ? 4 : 2).replace('.', ',');
}

function fmtBrl(v) {
  return 'R$ ' + ((v || 0) * config.usdBrl).toFixed(2).replace('.', ',');
}

function fmtDiaCurto(diaISO) {
  const [, m, d] = String(diaISO).split('-');
  return `${d}/${m}`;
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
    if (e.tipo !== 'sistema') d.mensagens++;
    porDia.set(dia, d);

    const c = conversas.get(e.sessao) || {
      sessao: e.sessao,
      cliente: rotuloCliente(e.sessao),
      canal: e.canal,
      nome: '',
      origemAnuncio: '',
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
    if (!c.nome) c.nome = nomeDoCliente(e.mensagem);
    if (!c.origemAnuncio) c.origemAnuncio = anuncioDaMensagem(e.mensagem);
    c.ultimaTs = e.ts;
    c.ultimaMensagem = String(e.mensagem || '').replace(/^\[Cliente: [^\]]+\] /, '').slice(0, 120);
    conversas.set(e.sessao, c);
  }

  // ── Analytics de operação (só atendimentos, sem registros de sistema) ────
  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, mensagens: 0 }));
  const porCanal = {
    whatsapp: { mensagens: 0, conversas: 0 },
    site: { mensagens: 0, conversas: 0 },
  };
  const anunciosMap = new Map();
  let audios = 0;
  for (const e of atendimento) {
    porHora[horaBRT(e.ts)].mensagens++;
    if (porCanal[e.canal]) porCanal[e.canal].mensagens++;
    const ad = anuncioDaMensagem(e.mensagem);
    if (ad) {
      const a = anunciosMap.get(ad) || { titulo: ad, leads: new Set(), mensagens: 0, custo: 0 };
      a.leads.add(e.sessao);
      a.mensagens++;
      a.custo += typeof e.custo === 'number' ? e.custo : 0;
      anunciosMap.set(ad, a);
    }
    if (String(e.mensagem || '').includes('[Mensagem de voz do cliente')) audios++;
  }
  const conversasClientes = [...conversas.values()].filter((c) => c.canal !== 'sistema');
  for (const c of conversasClientes) if (porCanal[c.canal]) porCanal[c.canal].conversas++;
  const anuncios = [...anunciosMap.values()]
    .map((a) => ({ ...a, leads: a.leads.size }))
    .sort((a, b) => b.leads - a.leads);

  // Conversas que pararam no comecinho: candidatas a follow-up da equipe
  const acompanhar = conversasClientes
    .filter((c) => c.mensagens <= 2)
    .sort((a, b) => b.ultimaTs.localeCompare(a.ultimaTs));

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
  const custoMedioDia = dias ? totais.custo / dias : 0;
  const projecao = {
    custoMedioDia,
    mensal: custoMedioDia * 30,
    runwayDias: saldo && custoMedioDia > 0 ? saldo.restante / custoMedioDia : null,
  };

  const dados = {
    periodo: { inicio: inicio.toISOString(), fim: fim.toISOString(), dias },
    modelo: config.claudeModel,
    cotacaoBRL: config.usdBrl,
    saldo,
    totais: {
      ...totais,
      conversas: conversas.size,
      conversasClientes: conversasClientes.length,
      clientesUnicos: conversasClientes.length,
      audios,
      custoAtendimento,
      custoMedioMsg: totais.mensagens ? custoAtendimento / (totais.mensagens - totais.semCusto || 1) : 0,
    },
    porDia: listaDias,
    porHora,
    porCanal,
    anuncios,
    acompanhar,
    projecao,
    conversas: rankingConversas,
    mensagensCaras,
    detalhe,
    extrato: EXTRATO,
  };
  dados.resumoExecutivo = montarResumoExecutivo(dados);
  return dados;
}

/**
 * Resumo executivo determinístico (sem custo de API): frases prontas com os
 * destaques de operação, aquisição e custo do período.
 */
function montarResumoExecutivo(d) {
  const b = [];
  const t = d.totais;

  if (!t.mensagens) {
    b.push(`Nenhum atendimento de cliente registrado nos últimos ${d.periodo.dias === 1 ? '1 dia' : d.periodo.dias + ' dias'}.`);
  } else {
    b.push(
      `Movimento: ${t.conversasClientes} conversa${t.conversasClientes === 1 ? '' : 's'} de cliente${t.conversasClientes === 1 ? '' : 's'} e ${t.mensagens} mensage${t.mensagens === 1 ? 'm' : 'ns'} respondida${t.mensagens === 1 ? '' : 's'} pela Carol: ${d.porCanal.whatsapp.mensagens} no WhatsApp e ${d.porCanal.site.mensagens} no chat do site.`
    );
    const pico = d.porDia.reduce((m, x) => (x.mensagens > (m?.mensagens || 0) ? x : m), null);
    if (pico && pico.mensagens > 0 && d.periodo.dias > 1) {
      b.push(`Dia mais movimentado: ${fmtDiaCurto(pico.dia)}, com ${pico.mensagens} mensage${pico.mensagens === 1 ? 'm' : 'ns'}.`);
    }
    const horasAtivas = d.porHora.filter((h) => h.mensagens > 0);
    if (horasAtivas.length) {
      const picoHora = horasAtivas.reduce((m, h) => (h.mensagens > m.mensagens ? h : m));
      b.push(`Horário de maior procura fora do expediente da Dai: ${picoHora.hora}h (${picoHora.mensagens} mensage${picoHora.mensagens === 1 ? 'm' : 'ns'} no período).`);
    }
    if (d.anuncios.length) {
      const totalLeads = d.anuncios.reduce((s, a) => s + a.leads, 0);
      const lista = d.anuncios.slice(0, 3).map((a) => `"${a.titulo}" (${a.leads})`).join(', ');
      b.push(`Aquisição: ${totalLeads} lead${totalLeads === 1 ? '' : 's'} chegar${totalLeads === 1 ? 'ou' : 'am'} por anúncio click-to-WhatsApp: ${lista}.`);
    } else {
      b.push('Aquisição: nenhum lead chegou por anúncio click-to-WhatsApp no período.');
    }
    if (t.audios) b.push(`${t.audios} mensage${t.audios === 1 ? 'm' : 'ns'} de voz transcrita${t.audios === 1 ? '' : 's'} automaticamente.`);
    if (d.acompanhar.length) {
      b.push(`Atenção: ${d.acompanhar.length} conversa${d.acompanhar.length === 1 ? '' : 's'} par${d.acompanhar.length === 1 ? 'ou' : 'aram'} nas primeiras mensagens. Vale a equipe retomar no horário comercial (lista abaixo).`);
    }
  }

  b.push(
    `Custo: ${fmtUsd(t.custo)} no período (~${fmtBrl(t.custo)}), média de ${fmtUsd(t.custoMedioMsg)} por mensagem. Projeção de ${fmtUsd(d.projecao.mensal)}/mês no ritmo atual.`
  );
  if (d.saldo) {
    const runway = d.projecao.runwayDias;
    const ate = runway && runway < 400 ? new Date(Date.now() + runway * 86400000) : null;
    b.push(
      `Saldo estimado do crédito: ${fmtUsd(d.saldo.restante)}` +
        (runway
          ? runway > 365
            ? ', dura mais de um ano no ritmo atual.'
            : `, dura cerca de ${Math.round(runway)} dia${Math.round(runway) === 1 ? '' : 's'} no ritmo atual (até ~${ate.toLocaleDateString('pt-BR', { timeZone: config.timezone, day: '2-digit', month: '2-digit' })}).`
          : '.')
    );
  }
  return b;
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

// ── Exportação das conversas ────────────────────────────────────────────────

function dataHoraBRT(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: config.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function campoCSV(v) {
  return '"' + String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
}

/**
 * Exporta os atendimentos do período para download e análise.
 * Formatos: csv (Excel/planilha), txt (transcrição por conversa, ideal para
 * colar numa IA e analisar) e json (dados brutos).
 */
export function exportarAtendimentos(dias = 7, formato = 'csv') {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - dias * 24 * 60 * 60 * 1000);
  const entradas = listarPeriodo(inicio, fim).filter((e) => e.tipo !== 'sistema');
  const base = `carol-conversas-${dias}d-${fim.toISOString().slice(0, 10)}`;

  if (formato === 'json') {
    return { corpo: JSON.stringify(entradas, null, 2), mime: 'application/json', nomeArquivo: `${base}.json` };
  }

  if (formato === 'csv') {
    const cab = [
      'data_hora_brasilia', 'canal', 'sessao', 'cliente', 'origem_anuncio',
      'mensagem_cliente', 'resposta_carol', 'custo_usd',
      'tokens_entrada', 'tokens_saida', 'tokens_cache_leitura', 'tokens_cache_escrita', 'chamadas_api', 'modelo',
    ];
    const linhas = entradas.map((e) =>
      [
        dataHoraBRT(e.ts), e.canal, e.sessao, nomeDoCliente(e.mensagem), anuncioDaMensagem(e.mensagem),
        String(e.mensagem || '').replace(/^\[Cliente: [^\]]+\] /, ''), e.resposta || '',
        typeof e.custo === 'number' ? e.custo.toFixed(6).replace('.', ',') : '',
        e.uso?.entrada ?? '', e.uso?.saida ?? '', e.uso?.cacheLeitura ?? '', e.uso?.cacheEscrita ?? '', e.uso?.chamadas ?? '', e.modelo || '',
      ].map(campoCSV).join(';')
    );
    // BOM + separador ";" para abrir direto no Excel/Numbers em pt-BR
    return { corpo: '﻿' + [cab.join(';'), ...linhas].join('\r\n'), mime: 'text/csv; charset=utf-8', nomeArquivo: `${base}.csv` };
  }

  // txt: transcrição agrupada por conversa, em ordem cronológica
  const porSessao = new Map();
  for (const e of entradas) {
    if (!porSessao.has(e.sessao)) porSessao.set(e.sessao, []);
    porSessao.get(e.sessao).push(e);
  }
  const blocos = [...porSessao.entries()].map(([sessao, msgs], i) => {
    const nome = msgs.map((m) => nomeDoCliente(m.mensagem)).find(Boolean) || '';
    const anuncio = msgs.map((m) => anuncioDaMensagem(m.mensagem)).find(Boolean) || '';
    const custo = msgs.reduce((s, m) => s + (typeof m.custo === 'number' ? m.custo : 0), 0);
    const linhas = msgs.flatMap((m) => {
      const quando = dataHoraBRT(m.ts);
      const texto = String(m.mensagem || '').replace(/^\[Cliente: [^\]]+\] /, '');
      return [`[${quando}] CLIENTE: ${texto}`, `[${quando}] CAROL: ${m.resposta || ''}`, ''];
    });
    return [
      '='.repeat(70),
      `CONVERSA ${i + 1}: ${rotuloCliente(sessao)}${nome ? ` (${nome})` : ''}`,
      `Canal: ${msgs[0].canal} · ${msgs.length} mensage${msgs.length === 1 ? 'm' : 'ns'} · custo US$ ${custo.toFixed(4)}`,
      ...(anuncio ? [`Origem: anúncio "${anuncio}"`] : []),
      '='.repeat(70),
      '',
      ...linhas,
    ].join('\n');
  });
  const cabecalho = [
    'ATENDIMENTOS DA CAROL - APP AGRO PECAS PADRAO',
    `Período: ${dataHoraBRT(inicio.toISOString())} até ${dataHoraBRT(fim.toISOString())} (horário de Brasília)`,
    `${porSessao.size} conversa${porSessao.size === 1 ? '' : 's'}, ${entradas.length} mensage${entradas.length === 1 ? 'm' : 'ns'}.`,
    '',
    '',
  ].join('\n');
  return { corpo: cabecalho + blocos.join('\n\n'), mime: 'text/plain; charset=utf-8', nomeArquivo: `${base}.txt` };
}
