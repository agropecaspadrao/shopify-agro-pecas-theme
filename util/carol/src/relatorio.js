// Relatório diário da Carol: resume os atendimentos das últimas 24h e envia
// por e-mail para a Dai todo dia às 8h de Brasília. O mesmo resumo (memoizado)
// alimenta o bloco de atendimentos do relatório executivo dos sócios e os
// comandos /carol e /carol detalhe pelo WhatsApp.

import { config } from './config.js';
import { listarPeriodo, registrarAtendimento } from './registro.js';
import { custoUSD } from './custos.js';
import { clienteAnthropic } from './ia/anthropic.js';
import { usoDe } from './util/uso.js';
import { enviarOuContingencia } from './email/contingencia.js';
import { agruparConversas, montarTranscricao, PROMPT_RESUMO, interpretarRespostaIA, textoEmailDai, textoCompacto, textoDetalhe, encontrarConversa, formatarBRT, contarRetomadas, resumoDeEpisodios, combinarResumos, pendenciasSemResposta } from './relatorios/atendimentos.js';
import { memoria } from './memoria/index.js';


// O relatório da Dai e o dos sócios usam o mesmo resumo de atendimentos; a
// memo evita pagar a IA duas vezes na mesma manhã.
const MEMO_MS = 20 * 60 * 1000;
let memo = { ts: 0, valor: null };

/**
 * Monta o resumo dos atendimentos das últimas 24h.
 * @returns {{assunto:string, corpo:string, resumo:object}} corpo = e-mail da Dai;
 *   resumo = dados estruturados (pendências + uma entrada por conversa) usados
 *   pelo relatório executivo e pelos comandos do WhatsApp.
 */
export async function montarRelatorio(fim = new Date()) {
  if (memo.valor && Date.now() - memo.ts < MEMO_MS) return memo.valor;
  const valor = await montarRelatorioSemMemo(fim);
  memo = { ts: Date.now(), valor };
  return valor;
}

function periodoDe(fim) {
  const inicio = new Date(fim.getTime() - 24 * 60 * 60 * 1000);
  return { inicio, texto: `${formatarBRT(inicio.toISOString())} até ${formatarBRT(fim.toISOString())} (Brasília)` };
}

async function montarRelatorioSemMemo(fim) {
  const { inicio, texto: periodoTxt } = periodoDe(fim);
  const entradas = listarPeriodo(inicio, fim);
  const conversas = agruparConversas(entradas);
  const retomadas = contarRetomadas(entradas);
  const dataTxt = new Date().toLocaleDateString('pt-BR', { timeZone: config.timezone });

  if (!conversas.length) {
    const resumo = { pendencias: [], conversas: [], textoLivre: '', totais: { conversas: 0, mensagens: 0, retomadas: 0 } };
    return { assunto: `Carol: sem atendimentos no período (${dataTxt})`, corpo: textoEmailDai(resumo, periodoTxt), resumo };
  }

  // Conversas que já viraram episódio (memória) não passam pela IA de novo;
  // só as que ainda não fecharam (ou sem banco) vão para o resumo da IA.
  // Fecha antes os episódios das conversas já paradas (Haiku, mais barato que o resumo cru)
  await memoria.fecharEpisodiosOciosos().catch((e) => console.warn('[relatorio] fechamento de episódios falhou:', e.message));
  const episodios = await memoria.episodiosNoPeriodo(inicio, fim);
  const { cobertas, pendencias, faltando } = resumoDeEpisodios(conversas, episodios);
  const resumoIA = faltando.length ? await resumirComIA(faltando, periodoTxt) : null;
  if (cobertas.length) console.log(`[relatorio] ${cobertas.length} conversa(s) resumida(s) pelos episódios da memória, ${faltando.length} pela IA`);
  const resumo = combinarResumos({ cobertas, pendencias, resumoIA, retomadas, semResposta: pendenciasSemResposta(conversas) });

  return {
    assunto: `Carol: resumo dos atendimentos, ${dataTxt} (${conversas.length} conversa${conversas.length > 1 ? 's' : ''})`,
    corpo: textoEmailDai(resumo, periodoTxt),
    resumo,
  };
}

/** Caminho original: a IA resume as transcrições cruas (só das conversas sem episódio). */
async function resumirComIA(conversas, periodoTxt) {
  const resposta = await clienteAnthropic().messages.create({
    model: config.claudeModel,
    max_tokens: 4000,
    system: [{ type: 'text', text: PROMPT_RESUMO }],
    messages: [{ role: 'user', content: `Período: ${periodoTxt}\n${montarTranscricao(conversas)}` }],
  });

  const usoRelatorio = usoDe(resposta.usage);
  registrarAtendimento({
    canal: 'sistema',
    sessao: 'sistema:relatorio',
    tipo: 'sistema',
    mensagem: 'Geração do resumo diário dos atendimentos',
    resposta: `${conversas.length} conversas resumidas`,
    uso: usoRelatorio,
    custo: custoUSD(usoRelatorio),
    modelo: config.claudeModel,
  });

  const textoIA = resposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const resumo = interpretarRespostaIA(textoIA, conversas);
  if (resumo.textoLivre) console.warn('[relatorio] a IA não devolveu JSON; usando o texto como veio');
  return resumo;
}

/** Lista compacta (uma linha por conversa) para o "/carol" no WhatsApp. */
export async function resumoCompacto() {
  const { resumo } = await montarRelatorio();
  return textoCompacto(resumo);
}

/**
 * Mensagens de uma conversa das últimas 24h, pelo número da lista ou pelo
 * telefone. Não usa IA: lê direto do registro.
 */
export function detalheConversa(ref, fim = new Date()) {
  const { inicio } = periodoDe(fim);
  const conversas = agruparConversas(listarPeriodo(inicio, fim));
  if (!conversas.length) return 'Nenhum atendimento nas ultimas 24h.';
  const c = encontrarConversa(conversas, ref);
  if (!c) return `Nao achei a conversa "${String(ref || '').trim() || '?'}". Mande /carol para ver a lista numerada (1 a ${conversas.length}) ou informe o telefone.`;
  return textoDetalhe(c);
}

/**
 * Relatório operacional diário para a Dai. Agendado em agenda.js (server.js).
 * Se o e-mail falhar, vai pelo WhatsApp dos administradores (contingência).
 */
export async function enviarRelatorio(deps = {}) {
  const { assunto, corpo } = await montarRelatorio();
  const r = await enviarOuContingencia({ para: config.destinatarios.dai, assunto, texto: corpo }, deps);
  if (r.canal === 'nenhum') throw new Error(`relatório não entregue: ${r.erroEmail || 'sem canal'}`);
  return { enviado: true, canal: r.canal, assunto, resumo: `${assunto} (${r.canal})` };
}
