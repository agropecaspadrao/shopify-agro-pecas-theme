// Relatório executivo diário para os sócios.
//
// Ordem de leitura: o que exige atenção primeiro (críticos e anomalias), depois
// o que aconteceu (atendimentos, campanhas), depois o que custa e o estado
// dos sistemas. O bloco de atendimentos reaproveita o resumo já gerado para a
// Dai (memoizado em relatorio.js), sem pagar a IA duas vezes.

import { config } from '../config.js';
import { montarRelatorio } from '../relatorio.js';
import { agregarCustos, saldoEstimado } from '../custos.js';
import { resumoAnomalias, TIPOS } from '../alertas/anomalias.js';
import { ultimoEstado, textoSaude, verificarTudo } from '../saude/supervisor.js';
import { resumoCampanhasMeta, textoCampanhas } from './campanhas.js';
import { listar as listarAgenda } from '../agenda.js';
import { enviarOuContingencia } from '../email/contingencia.js';

const usd = (v) => 'US$ ' + Number(v || 0).toFixed(2).replace('.', ',');
const brl = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
const dataBRT = (ts, comHora = true) =>
  new Date(ts).toLocaleString('pt-BR', { timeZone: config.timezone, day: '2-digit', month: '2-digit', ...(comHora ? { hour: '2-digit', minute: '2-digit' } : {}) });

function blocoCriticos(anom, saude) {
  const abertos = anom.tipos.filter((t) => !t.recuperado && t.severidade !== 'media');
  const falhas = (saude?.resultados || []).filter((r) => r.estado === 'falha');
  if (!abertos.length && !falhas.length) return 'Nenhum assunto crítico nas últimas 24 horas.';
  const linhas = [];
  for (const t of abertos) {
    const info = TIPOS[t.tipo] || {};
    linhas.push(`- [${t.severidade.toUpperCase()}] ${t.titulo} (${t.ocorrencias}x, última ${dataBRT(t.ultima)})`);
    if (info.acao) linhas.push(`  O que fazer: ${info.acao}`);
  }
  for (const f of falhas) {
    if (!abertos.some((t) => t.tipo === f.tipoAnomalia)) linhas.push(`- [FALHA AGORA] ${f.nome}: ${f.resumo}`);
  }
  return linhas.join('\n');
}

function blocoAtendimentos(custos1d, relatorioDai) {
  const conversas = custos1d.conversas || [];
  const leadsAnuncio = conversas.filter((c) => c.origemAnuncio).length;
  const wa = conversas.filter((c) => c.canal === 'whatsapp').length;
  const site = conversas.length - wa;
  const cab = `${conversas.length} conversas (${wa} WhatsApp, ${site} site), ${custos1d.totais.mensagens} mensagens, ${leadsAnuncio} vindas de anúncio.`;
  const corpo = relatorioDai?.corpo ? relatorioDai.corpo.replace(/^Bom dia, Dai!\s*/i, '').replace(/\s*Bom trabalho!\s*Carol, atendente virtual\s*$/i, '').trim() : '';
  return corpo ? `${cab}\n\n${corpo}` : cab;
}

function blocoCustos(c1, c7) {
  const saldo = saldoEstimado();
  const porMsg = c7.totais.mensagens ? c7.totais.custo / c7.totais.mensagens : 0;
  const projecaoMes = (c7.totais.custo / 7) * 30;
  const linhas = [
    `Últimas 24h: ${usd(c1.totais.custo)} (${c1.totais.mensagens} msgs). Últimos 7 dias: ${usd(c7.totais.custo)}, ${usd(porMsg)} por mensagem. Projeção mensal: ${usd(projecaoMes)} (${brl(projecaoMes * config.usdBrl)}).`,
  ];
  if (saldo) {
    const dias = projecaoMes > 0 ? Math.round(saldo.restante / (projecaoMes / 30)) : null;
    linhas.push(`Saldo estimado na Anthropic: ${usd(saldo.restante)} de ${usd(saldo.credito)} carregados em ${dataBRT(saldo.desde, false)}${dias !== null ? `, dá para cerca de ${dias} dias neste ritmo` : ''}.`);
  } else {
    linhas.push('Saldo estimado: não sincronizado (CAROL_CREDITO_USD e CAROL_CREDITO_DESDE em branco).');
  }
  return linhas.join('\n');
}

function blocoInventario(saude) {
  const inv = saude?.resultados?.find((r) => r.nome === 'inventario');
  const mst = saude?.resultados?.find((r) => r.nome === 'master');
  const cat = saude?.resultados?.find((r) => r.nome === 'catalogo');
  const linhas = [];
  if (inv?.dados) linhas.push(`Loja (Shopify): ${inv.dados.produtos} produtos publicados, ${inv.dados.semEstoque} sem estoque. Última edição de produto: ${inv.dados.ultimaEdicao ? dataBRT(inv.dados.ultimaEdicao) : 'desconhecida'}${inv.dados.ultimoProduto ? ` (${inv.dados.ultimoProduto})` : ''}.`);
  else linhas.push(`Loja (Shopify): ${inv?.resumo || 'sem leitura'}.`);
  if (mst?.dados) linhas.push(`Planilha master: última edição por ${mst.dados.editadoPor} em ${dataBRT(mst.dados.ultimaEdicao)}.`);
  else linhas.push(`Planilha master: ${mst?.resumo || 'sem leitura'}.`);
  if (cat?.resumo) linhas.push(`Catálogo em memória da Carol: ${cat.resumo}.`);
  return linhas.join('\n');
}

function blocoAgenda() {
  const lista = listarAgenda();
  if (!lista.length) return 'Nenhuma tarefa agendada.';
  return lista
    .map((t) => `- ${t.nome}: ${t.ultimaExecucao ? `última ${dataBRT(t.ultimaExecucao)} (${t.ok === false ? 'FALHOU: ' + t.resumo : t.motivo || 'ok'})` : 'nunca rodou'}, próxima ${dataBRT(t.proxima)}`)
    .join('\n');
}

/**
 * Monta o relatório executivo. Roda uma verificação de saúde fresca se a
 * última tiver mais de 20 minutos.
 */
export async function montarRelatorioSocios({ fetchFn, agora = Date.now } = {}) {
  let saude = ultimoEstado();
  if (!saude || agora() - new Date(saude.ts).getTime() > 20 * 60000) {
    saude = await verificarTudo({ fetchFn, agora }).catch(() => saude);
  }
  const anom = resumoAnomalias(24);
  const c1 = agregarCustos(1);
  const c7 = agregarCustos(7);
  const [relatorioDai, campanhas] = await Promise.all([
    montarRelatorio().catch((e) => ({ corpo: `(resumo dos atendimentos indisponível: ${e.message})` })),
    resumoCampanhasMeta({ fetchFn }),
  ]);

  const statusTxt = saude?.geral === 'falha' ? 'FALHA EM SISTEMA' : saude?.geral === 'aviso' || anom.criticas + anom.altas > 0 ? 'ATENÇÃO' : 'TUDO OK';
  const hoje = dataBRT(agora(), false);
  const secao = (titulo, corpo) => `${titulo.toUpperCase()}\n${'-'.repeat(titulo.length)}\n${corpo}`;

  const corpo = [
    `Bom dia!`,
    '',
    `Situação geral: ${statusTxt}. Anomalias nas últimas 24h: ${anom.total} (${anom.criticas} críticas, ${anom.altas} altas, ${anom.medias} médias).`,
    '',
    secao('1. Assuntos críticos', blocoCriticos(anom, saude)),
    '',
    secao('2. Atendimentos das últimas 24h', blocoAtendimentos(c1, relatorioDai)),
    '',
    secao('3. Campanhas', textoCampanhas(campanhas)),
    '',
    secao('4. Custos da Carol', blocoCustos(c1, c7)),
    '',
    secao('5. Inventário e planilha', blocoInventario(saude)),
    '',
    secao('6. Sistemas', textoSaude(saude)),
    '',
    secao('7. Rotinas automáticas', blocoAgenda()),
    '',
    'Comandos pelo WhatsApp da loja (só administradores, com a palavra-chave da semana): /carol, /carol saude, /carol socios, /carol chave.',
    '',
    'Carol, agente de monitoramento',
  ].join('\n');

  return { assunto: `Carol: relatório executivo ${hoje} (${statusTxt})`, corpo, status: statusTxt };
}

export async function enviarRelatorioSocios(deps = {}) {
  const para = deps.destinatarios || config.destinatarios.socios;
  const { assunto, corpo, status } = await montarRelatorioSocios(deps);
  const r = await enviarOuContingencia({ para, assunto, texto: corpo }, deps);
  if (r.canal === 'nenhum') throw new Error(`relatório dos sócios não entregue: ${r.erroEmail || 'sem canal'}`);
  return { enviado: true, canal: r.canal, assunto, status, enviadoPara: para, resumo: `${assunto} (${r.canal})` };
}
