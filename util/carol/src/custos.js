// Custos por token dos modelos Claude (US$ por milhão de tokens).
// A Carol usa cache de prompt com TTL de 1h: escrita de cache custa 2x a
// entrada e leitura custa 0,1x. Valores conforme tabela pública da Anthropic.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { listarPeriodo, DATA_DIR, ehAtendimento, ehRespostaIA, ehPendente } from './registro.js';
import { config } from './config.js';
import { gravarJsonAtomico } from './util/arquivo.js';
import { limparMarcadores, nomeDoCliente, anuncioDaMensagem, semPrefixoNome } from './util/marcadores.js';
import { mascararTelefone } from './util/telefone.js';
import { gastoTotal, somarRegistro, statusCredito, baseVariavel } from './gasto.js';

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

// Rótulo para o dashboard: telefone mascarado (a exportação usa o número completo)
function rotuloCliente(sessao, { completo = false } = {}) {
  if (sessao.startsWith('wa:')) return `WhatsApp ${completo ? sessao.slice(3) : mascararTelefone(sessao.slice(3))}`;
  if (sessao.startsWith('site:')) return `Site ${sessao.slice(5, 17)}`;
  if (sessao === 'sistema:resumo') return 'Sistema: resumos p/ WhatsApp';
  if (sessao === 'sistema:relatorio') return 'Sistema: relatório diário';
  if (sessao === 'sistema:memoria') return 'Sistema: memória (episódios)';
  return sessao;
}

// Identificador opaco da conversa para o HTML do dashboard (não expõe o telefone)
function idOpaco(sessao) {
  return crypto.createHash('sha256').update(String(sessao)).digest('hex').slice(0, 16);
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
  const atendimento = entradas.filter(ehAtendimento);

  const totais = {
    custo: 0,
    custoSistema: 0,
    // "respondidas pela Carol": só respostas da IA que chegaram ao cliente
    mensagens: atendimento.filter(ehRespostaIA).length,
    // cliente sem resposta da Carol (falha da IA, silêncio, aviso fixo, envio que não saiu)
    falhas: atendimento.filter((e) => e.tipo === 'falha' || (!e.tipo && e.entregue === false)).length,
    silencios: atendimento.filter((e) => e.tipo === 'silencio').length,
    respostasEquipe: atendimento.filter((e) => e.tipo === 'humano').length,
    semCusto: 0, // registros antigos, gravados antes da medição de custo
    tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
  };
  const porDia = new Map();
  const conversas = new Map();

  for (const e of entradas) {
    const custo = typeof e.custo === 'number' ? e.custo : 0;
    if (typeof e.custo !== 'number' && ehRespostaIA(e)) totais.semCusto++;
    totais.custo += custo;
    if (e.tipo === 'sistema') totais.custoSistema += custo;
    for (const k of Object.keys(totais.tokens)) totais.tokens[k] += e.uso?.[k] || 0;

    const dia = diaBRT(e.ts);
    const d = porDia.get(dia) || { dia, custo: 0, mensagens: 0 };
    d.custo += custo;
    if (ehRespostaIA(e)) d.mensagens++;
    porDia.set(dia, d);

    const c = conversas.get(e.sessao) || {
      sessao: idOpaco(e.sessao),
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
    if (e.mensagem) c.ultimaMensagem = semPrefixoNome(e.mensagem).slice(0, 120);
    c.pendente = ehPendente(e) ? e.tipo || 'nao_entregue' : e.tipo === 'humano' || ehRespostaIA(e) ? '' : c.pendente || '';
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
    if (e.tipo === 'humano') continue; // resposta da equipe não é procura do cliente
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

  // Conversas que pararam no comecinho ou ficaram sem resposta: follow-up da equipe
  const acompanhar = conversasClientes
    .filter((c) => c.mensagens <= 2 || c.pendente)
    .sort((a, b) => (b.pendente ? 1 : 0) - (a.pendente ? 1 : 0) || b.ultimaTs.localeCompare(a.ultimaTs));

  // preenche dias sem movimento para o gráfico não "pular" datas
  const listaDias = [];
  for (let i = dias - 1; i >= 0; i--) {
    const dia = diaBRT(new Date(fim.getTime() - i * 24 * 60 * 60 * 1000).toISOString());
    listaDias.push(porDia.get(dia) || { dia, custo: 0, mensagens: 0 });
  }

  const rankingConversas = [...conversas.values()].sort((a, b) => b.custo - a.custo);

  const mensagensCaras = atendimento
    .filter((e) => typeof e.custo === 'number' && e.custo > 0)
    .sort((a, b) => b.custo - a.custo)
    .slice(0, 10)
    .map((e) => ({
      ts: e.ts,
      cliente: rotuloCliente(e.sessao),
      canal: e.canal,
      custo: e.custo,
      uso: e.uso || null,
      mensagem: limparMarcadores(e.mensagem).slice(0, 120),
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
      mensagem: semPrefixoNome(e.mensagem).slice(0, 160),
      resposta: (e.tipo === 'humano' ? '[equipe] ' : e.tipo === 'silencio' ? '[sem resposta: silêncio] ' : e.tipo === 'falha' ? '[falha da IA] ' : '') + String(e.resposta || '').slice(0, 220),
    }));

  // ── Conversas completas para a aba "Conversas" do dashboard ──────────────
  // Cada registro é um par cliente+Carol. Os sinais seguem a memória de
  // conversa (src/memoria): voltar depois de 12h abre conversa nova COM
  // memória (episódios de 7 dias + ficha), então só conta como perda de
  // contexto o intervalo de mais de 7 dias ou a reapresentação sem memória
  // (turno sem o campo `memoria`). Acima de 30 mensagens (15 pares) as mais
  // antigas viram resumo parcial.
  const GAP_PERDA_MS = 7 * 24 * 60 * 60 * 1000;
  const LIMITE_PARES = 15;
  const porSessaoCompleta = new Map();
  for (const e of atendimento) {
    if (!porSessaoCompleta.has(e.sessao)) porSessaoCompleta.set(e.sessao, []);
    porSessaoCompleta.get(e.sessao).push(e);
  }
  let conversasCompletas = [...porSessaoCompleta.entries()]
    .map(([sessao, msgs]) => {
      let resets = 0;
      const itens = msgs.map((e, i) => {
        const flags = [];
        if (i > 0 && new Date(e.ts) - new Date(msgs[i - 1].ts) > GAP_PERDA_MS) flags.push('sessao_expirada');
        if (e.memoria === 'retomada') flags.push('retomada');
        if (i > 0 && !e.tipo && !e.memoria && /(aqui é a carol|sou a carol)/i.test(String(e.resposta || '').slice(0, 160))) flags.push('reapresentacao');
        if (i === LIMITE_PARES) flags.push('janela_cheia');
        if (String(e.mensagem || '').includes('[Mensagem de voz do cliente')) flags.push('audio');
        if (e.tipo === 'falha' || e.entregue === false || String(e.resposta || '').startsWith('Desculpe, não consegui processar')) flags.push('falha');
        if (e.tipo === 'silencio') flags.push('silencio');
        if (e.tipo === 'humano') flags.push('humano');
        if (flags.includes('sessao_expirada') || flags.includes('reapresentacao')) resets++;
        return {
          ts: e.ts,
          mensagem: limparMarcadores(e.mensagem),
          resposta: String(e.resposta || ''),
          custo: typeof e.custo === 'number' ? e.custo : null,
          flags,
        };
      });
      const agg = conversas.get(sessao); // chave = sessão real; o campo exposto é opaco
      return {
        sessao: idOpaco(sessao),
        cliente: rotuloCliente(sessao),
        canal: msgs[0].canal,
        nome: agg?.nome || '',
        origemAnuncio: agg?.origemAnuncio || '',
        custo: agg?.custo || 0,
        primeiraTs: msgs[0].ts,
        ultimaTs: msgs[msgs.length - 1].ts,
        sinais: { resets, janelaCheia: msgs.length > LIMITE_PARES },
        msgs: itens,
      };
    })
    .sort((a, b) => b.ultimaTs.localeCompare(a.ultimaTs));
  // Limite de payload da página: mantém as conversas mais recentes até ~1500 pares
  const totalConversas = conversasCompletas.length;
  let paresAcumulados = 0;
  conversasCompletas = conversasCompletas.filter((c) => (paresAcumulados += c.msgs.length) <= 1500);

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
    conversasCompletas,
    totalConversas,
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

const ARQ_SALDO = path.join(DATA_DIR, 'saldo.json');

/** Saldo informado à mão (volume de dados). Tem prioridade sobre as variáveis de ambiente. */
function lerSaldoManual() {
  try {
    const j = JSON.parse(fs.readFileSync(ARQ_SALDO, 'utf8'));
    return j.usd >= 0 && j.desde ? j : null;
  } catch {
    return null;
  }
}

/**
 * Registra o saldo atual do console.anthropic.com. O gasto passa a ser
 * contado a partir de agora (guarda o contador de gasto deste momento).
 * Não precisa de deploy nem de mexer no Railway.
 */
export function definirSaldo(usd, { por = null, agora = Date.now } = {}) {
  const v = Number(String(usd).replace(',', '.'));
  if (!Number.isFinite(v) || v < 0 || v > 100000) throw new Error('valor de saldo inválido');
  const reg = { usd: v, desde: new Date(agora()).toISOString(), por, gastoNaBase: gastoTotal() };
  gravarJsonAtomico(ARQ_SALDO, reg);
  return reg;
}

/**
 * Saldo ESTIMADO do crédito Anthropic: crédito sincronizado (saldo.json, ou
 * CAROL_CREDITO_USD na data CAROL_CREDITO_DESDE) menos o que o contador
 * persistente de gasto (gasto.js) somou desde então. O saldo oficial fica no
 * console.anthropic.com (a API não expõe saldo); atualize com `/carol saldo <valor>`.
 * Não relê o registro: O(1) por resposta e não "sobe" quando a limpeza de 90
 * dias apaga arquivos antigos.
 */
export function saldoEstimado() {
  let base = lerSaldoManual();
  let origem = 'painel';
  if (base && typeof base.gastoNaBase !== 'number') {
    // saldo.json anterior ao contador: calcula a base uma única vez e grava
    base = { ...base, gastoNaBase: gastoTotal() - somarRegistro(Date.parse(base.desde)) };
    try {
      gravarJsonAtomico(ARQ_SALDO, base);
    } catch {}
  }
  if (!base) {
    if (!(config.creditoUsd > 0)) return null;
    const b = baseVariavel(config.creditoUsd, config.creditoDesde);
    base = { usd: b.credito, desde: b.desde, gastoNaBase: b.gastoNaBase };
    origem = 'variavel';
  }
  const credito = base.usd;
  if (!(credito > 0)) return null;
  const gasto = Math.max(0, gastoTotal() - base.gastoNaBase);
  const cred = statusCredito();
  return {
    credito,
    desde: new Date(base.desde).toISOString(),
    gasto,
    restante: Math.max(0, credito - gasto),
    // Gastou mais que o crédito e a API seguiu aceitando: houve recarga não informada
    desatualizado: gasto > credito && !cred.esgotado,
    origem,
    creditoEsgotado: cred.esgotado,
    esgotadoDesde: cred.desde,
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
  let s = String(v ?? '').replace(/\r?\n/g, ' ');
  // Anti CSV-injection: célula começando com = + - @ ou TAB viraria fórmula
  // ao abrir no Excel/Numbers — prefixa apóstrofo para forçar texto.
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * Exporta os atendimentos do período para download e análise.
 * Formatos: csv (Excel/planilha), txt (transcrição por conversa, ideal para
 * colar numa IA e analisar) e json (dados brutos).
 */
export function exportarAtendimentos(dias = 7, formato = 'csv') {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - dias * 24 * 60 * 60 * 1000);
  const entradas = listarPeriodo(inicio, fim).filter(ehAtendimento);
  const base = `carol-conversas-${dias}d-${fim.toISOString().slice(0, 10)}`;

  if (formato === 'json') {
    return { corpo: JSON.stringify(entradas, null, 2), mime: 'application/json', nomeArquivo: `${base}.json` };
  }

  if (formato === 'csv') {
    const cab = [
      'data_hora_brasilia', 'canal', 'sessao', 'cliente', 'origem_anuncio', 'tipo', 'entregue',
      'mensagem_cliente', 'resposta_carol', 'custo_usd',
      'tokens_entrada', 'tokens_saida', 'tokens_cache_leitura', 'tokens_cache_escrita', 'chamadas_api', 'modelo',
    ];
    const linhas = entradas.map((e) =>
      [
        dataHoraBRT(e.ts), e.canal, e.sessao, nomeDoCliente(e.mensagem), anuncioDaMensagem(e.mensagem), e.tipo || 'ia', e.entregue === false ? 'nao' : 'sim',
        semPrefixoNome(e.mensagem), e.resposta || '',
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
      const texto = semPrefixoNome(m.mensagem);
      const linhas = [];
      if (m.tipo === 'humano') linhas.push(`[${quando}] EQUIPE (app): ${m.resposta || ''}`);
      else {
        linhas.push(`[${quando}] CLIENTE: ${texto}`);
        if (m.tipo === 'silencio') linhas.push(`[${quando}] (sem resposta: ${m.motivo || 'silêncio'})`);
        else linhas.push(`[${quando}] ${m.tipo === 'falha' ? 'CAROL (contingência, IA falhou)' : 'CAROL'}: ${m.resposta || ''}${m.entregue === false ? ' [NÃO ENTREGUE]' : ''}`);
      }
      linhas.push('');
      return linhas;
    });
    return [
      '='.repeat(70),
      `CONVERSA ${i + 1}: ${rotuloCliente(sessao, { completo: true })}${nome ? ` (${nome})` : ''}`,
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
