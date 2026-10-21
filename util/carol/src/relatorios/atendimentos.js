// Resumo dos atendimentos das últimas 24h, em forma estruturada.
//
// A IA devolve JSON (uma linha por conversa: cliente, assunto, onde parou,
// ação) e o texto de cada canal é montado aqui, deterministicamente:
//   - e-mail da Dai        → pendências + bloco por conversa (textoEmailDai)
//   - executivo dos sócios → pendências + uma linha por conversa (textoLinhas)
//   - WhatsApp "/carol"    → uma linha por conversa (textoCompacto)
//   - WhatsApp "/carol detalhe N" → mensagens da conversa N (textoDetalhe)
//
// A numeração das conversas é pela hora da primeira mensagem, não pela IA, para
// "/carol detalhe 3" apontar sempre para a mesma conversa que a lista mostrou.
// Sem dependência da SDK da Anthropic: tudo aqui é testável sem rede.

import { config } from '../config.js';
import { limparMarcadores, anuncioDaMensagem } from '../util/marcadores.js';

export { limparMarcadores };

const MOTIVOS_SILENCIO = { horario: 'horário da equipe', pausa: 'Carol pausada', teto: 'teto diário atingido' };

export function formatarBRT(iso, comData = true) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: config.timezone,
    ...(comData ? { day: '2-digit', month: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function identificarCliente(sessao) {
  if (String(sessao).startsWith('wa:')) return `WhatsApp ${sessao.slice(3)}`;
  return 'Chat do site';
}

/**
 * Pendências automáticas (sem IA): conversa cuja última linha deixou o cliente
 * sem resposta da Carol (falha, silêncio, aviso fixo ou envio que não saiu) e
 * que a equipe não respondeu depois.
 */
export function pendenciasSemResposta(conversas) {
  return conversas
    .filter((c) => c.ultimaSituacao)
    .map((c) => `${c.cliente} ficou sem resposta da Carol (${c.ultimaSituacao}). Responder.`);
}

/** Como a linha do registro aparece para quem lê (relatório, detalhe). */
export function situacaoDaEntrada(e) {
  if (e.tipo === 'silencio') return `sem resposta: ${MOTIVOS_SILENCIO[e.motivo] || 'silêncio'}`;
  if (e.tipo === 'falha') return e.entregue === false || !e.resposta ? 'sem resposta: falha da IA' : 'falha da IA, cliente recebeu aviso de contingência';
  if (e.tipo === 'aviso') return 'resposta automática fixa (sem IA)';
  if (e.entregue === false) return 'resposta da Carol NÃO entregue (falha no envio)';
  return '';
}

/**
 * Agrupa as entradas do registro (já sem as de sistema) em conversas numeradas
 * pela hora da primeira mensagem.
 */
export function agruparConversas(entradas) {
  const mapa = new Map();
  for (const e of entradas) {
    if (e.tipo === 'sistema') continue;
    let c = mapa.get(e.sessao);
    if (!c) {
      c = { sessao: e.sessao, canal: e.canal || (String(e.sessao).startsWith('wa:') ? 'whatsapp' : 'site'), cliente: identificarCliente(e.sessao), origemAnuncio: '', mensagens: [], inicio: e.ts, fim: e.ts };
      mapa.set(e.sessao, c);
    }
    if (!c.origemAnuncio) c.origemAnuncio = anuncioDaMensagem(e.mensagem);
    c.mensagens.push({
      ts: e.ts,
      cliente: limparMarcadores(e.mensagem),
      carol: e.tipo === 'humano' ? '' : String(e.resposta || ''),
      ...(e.tipo === 'humano' ? { equipe: String(e.resposta || '') } : {}),
      ...(e.tipo ? { tipo: e.tipo } : {}),
      situacao: situacaoDaEntrada(e),
    });
    c.ultimaSituacao = c.mensagens[c.mensagens.length - 1].situacao;
    if (e.ts < c.inicio) c.inicio = e.ts;
    if (e.ts > c.fim) c.fim = e.ts;
  }
  return [...mapa.values()].sort((a, b) => a.inicio.localeCompare(b.inicio)).map((c, i) => ({ numero: i + 1, ...c }));
}

/** Transcrição que vai para a IA, com o número de cada conversa. */
export function montarTranscricao(conversas, limite = 150000) {
  let txt = '';
  for (const c of conversas) {
    txt += `\n===== CONVERSA ${c.numero}: ${c.cliente} | ${c.mensagens.length} interações | ${formatarBRT(c.inicio)} até ${formatarBRT(c.fim)}${c.origemAnuncio ? ` | veio do anúncio "${c.origemAnuncio}"` : ''} =====\n`;
    for (const m of c.mensagens) {
      if (m.cliente) txt += `Cliente: ${m.cliente}\n`;
      if (m.equipe) txt += `Equipe (Dai, pelo aplicativo): ${m.equipe}\n`;
      if (m.carol) txt += `Carol: ${m.carol}\n`;
      if (m.situacao) txt += `[${m.situacao}]\n`;
    }
  }
  return txt.slice(0, limite);
}

export const PROMPT_RESUMO = `Você prepara o resumo matinal da Carol (atendente virtual da APP Agro Peças Padrão, peças agrícolas) para a Dai, a atendente humana que assume às 8h, e para os sócios da empresa. Escreva em português do Brasil, frases curtas, SEM travessão e SEM emoji. Seja fiel às transcrições; não invente dados.

Responda SOMENTE com um JSON válido, sem comentários nem texto fora do JSON, neste formato:
{
  "pendencias": ["o que a Dai precisa fazer HOJE, em ordem de prioridade (orçamentos prometidos, encomendas de fábrica, clientes aguardando retorno, peças a verificar); lista vazia se não houver"],
  "conversas": [
    {
      "numero": 1,
      "cliente": "nome se informado; senão deixe vazio",
      "assunto": "peça, código ou máquina tratados, em até 12 palavras",
      "ondeParou": "última situação da conversa, em uma frase",
      "acao": "o que a Dai deve fazer, ou 'nenhuma'",
      "perfil": "produtor, revenda ou oficina, conforme a conversa deixou claro; vazio se não deu para saber"
    }
  ]
}
Use exatamente o número de cada CONVERSA como veio na transcrição.`;

/**
 * Interpreta a resposta da IA. Se não vier JSON válido, devolve um resumo
 * "cru" (texto livre no campo textoLivre) para o e-mail não ficar sem nada.
 */
export function interpretarRespostaIA(texto, conversas) {
  const limpo = String(texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let dados = null;
  try {
    dados = JSON.parse(limpo);
  } catch {
    const ini = limpo.indexOf('{');
    const fim = limpo.lastIndexOf('}');
    if (ini >= 0 && fim > ini) {
      try {
        dados = JSON.parse(limpo.slice(ini, fim + 1));
      } catch {}
    }
  }
  const porNumero = new Map((Array.isArray(dados?.conversas) ? dados.conversas : []).map((c) => [Number(c.numero), c]));
  const lista = conversas.map((c) => {
    const ia = porNumero.get(c.numero) || {};
    return {
      numero: c.numero,
      sessao: c.sessao,
      canal: c.canal,
      cliente: c.cliente,
      nome: limpar(ia.cliente),
      origemAnuncio: c.origemAnuncio,
      assunto: limpar(ia.assunto),
      ondeParou: limpar(ia.ondeParou),
      acao: limpar(ia.acao),
      perfil: normalizarPerfil(ia.perfil),
      mensagens: c.mensagens.length,
      inicio: c.inicio,
      fim: c.fim,
    };
  });
  return {
    pendencias: Array.isArray(dados?.pendencias) ? dados.pendencias.map(limpar).filter(Boolean) : [],
    conversas: lista,
    textoLivre: dados ? '' : limpo,
    totais: { conversas: lista.length, mensagens: lista.reduce((s, c) => s + c.mensagens, 0) },
  };
}

// ── Episódios da memória (resumo pronto, sem pagar a IA de novo) ──────────

/** Clientes que voltaram e a Carol tinha memória (turnos marcados 'retomada' no registro). */
export function contarRetomadas(entradas) {
  return new Set(entradas.filter((e) => e.tipo !== 'sistema' && e.memoria === 'retomada').map((e) => e.sessao)).size;
}

/**
 * Usa os episódios fechados no período para resumir as conversas que eles
 * cobrem (mesma sessão, episódio terminando na última mensagem da conversa
 * ou depois). As que sobram vão para a IA como antes.
 * @returns {{cobertas:object[], pendencias:string[], faltando:object[]}}
 */
export function resumoDeEpisodios(conversas, episodios) {
  const porSessao = new Map();
  for (const ep of episodios || []) {
    if (ep?.dados?.bruto) continue;
    const atual = porSessao.get(ep.sessao);
    if (!atual || String(ep.fim) > String(atual.fim)) porSessao.set(ep.sessao, ep);
  }
  const cobertas = [];
  const pendencias = [];
  const faltando = [];
  for (const c of conversas) {
    const ep = porSessao.get(c.sessao);
    if (!ep || new Date(ep.fim).getTime() < new Date(c.fim).getTime() - 60000) {
      faltando.push(c);
      continue;
    }
    const d = ep.dados || {};
    const aberto = !d.status || d.status === 'em_aberto';
    const entrada = {
      numero: c.numero,
      sessao: c.sessao,
      canal: c.canal,
      cliente: c.cliente,
      nome: limpar(d.nome),
      origemAnuncio: c.origemAnuncio,
      assunto: limpar(d.assunto),
      ondeParou: limpar(d.resumo),
      acao: aberto ? limpar(d.proximo_passo) || 'nenhuma' : 'nenhuma',
      perfil: normalizarPerfil(d.tipo),
      mensagens: c.mensagens.length,
      inicio: c.inicio,
      fim: c.fim,
      fonte: 'episodio',
    };
    cobertas.push(entrada);
    if (aberto && d.proximo_passo) pendencias.push(`${entrada.nome || c.cliente}: ${limpar(d.proximo_passo)}`);
  }
  return { cobertas, pendencias, faltando };
}

/** Junta o que veio dos episódios com o que a IA resumiu (resumoIA pode ser null). */
export function combinarResumos({ cobertas = [], pendencias = [], resumoIA = null, retomadas = 0, semResposta = [] }) {
  const lista = [...cobertas, ...(resumoIA?.conversas || [])].sort((a, b) => a.numero - b.numero);
  return {
    // sem resposta primeiro: é o que a Dai precisa atender antes de tudo
    pendencias: [...semResposta, ...(resumoIA?.pendencias || []), ...pendencias],
    conversas: lista,
    textoLivre: cobertas.length ? '' : resumoIA?.textoLivre || '',
    totais: { conversas: lista.length, mensagens: lista.reduce((s, c) => s + c.mensagens, 0), retomadas, deEpisodios: cobertas.length },
  };
}

const PERFIS = ['produtor', 'revenda', 'oficina'];

export function normalizarPerfil(v) {
  const t = String(v ?? '').toLowerCase();
  return PERFIS.find((p) => t.includes(p)) || '';
}

/** "Perfil: 3 produtores, 1 revenda, 2 sem perfil" — vazio se não houver conversas. */
export function textoPerfis(resumo) {
  if (!resumo.conversas.length) return '';
  const n = (p) => resumo.conversas.filter((c) => c.perfil === p).length;
  const plural = { produtor: 'produtores', revenda: 'revendas', oficina: 'oficinas' };
  const partes = PERFIS.filter((p) => n(p)).map((p) => `${n(p)} ${n(p) === 1 ? p : plural[p]}`);
  const sem = n('');
  if (sem) partes.push(`${sem} sem perfil`);
  return `Perfil: ${partes.join(', ')}.`;
}

/** "Retomadas: 2 clientes voltaram e a Carol lembrou da conversa anterior." */
export function textoRetomadas(resumo) {
  const n = resumo.totais?.retomadas || 0;
  return `Retomadas: ${n} cliente${n === 1 ? ' voltou' : 's voltaram'} e a Carol lembrou da conversa anterior.`;
}

function limpar(v) {
  return String(v ?? '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rotulo(c) {
  let quem = c.nome ? `${c.nome} (${c.cliente})` : c.cliente;
  if (c.perfil && c.perfil !== 'produtor') quem += ` [${c.perfil.toUpperCase()}]`;
  return c.origemAnuncio ? `${quem}, via anúncio` : quem;
}

/** Uma linha por conversa: "1. Fulano (WhatsApp 5541...): assunto. Onde parou." */
export function textoLinhas(resumo) {
  if (!resumo.conversas.length) return 'Nenhum atendimento no período.';
  return resumo.conversas
    .map((c) => {
      const partes = [c.assunto || `${c.mensagens} mensagens`];
      if (c.ondeParou) partes.push(c.ondeParou);
      if (c.acao && !/^nenhuma?( ação)?( necessária)?\.?$/i.test(c.acao)) partes.push(`Ação: ${c.acao}`);
      return `${c.numero}. ${rotulo(c)}: ${partes.join(' ')}`;
    })
    .join('\n');
}

/** Corpo do e-mail da Dai: pendências + bloco por conversa + estatística. */
export function textoEmailDai(resumo, periodoTxt) {
  if (!resumo.conversas.length) {
    return `Bom dia, Dai!\n\nA Carol não registrou nenhum atendimento entre ${periodoTxt}.\n\nAté amanhã!\nCarol, atendente virtual`;
  }
  const linhas = [`Bom dia, Dai!`, '', `Segue o resumo do que a Carol atendeu entre ${periodoTxt}.`, ''];
  if (resumo.textoLivre) {
    linhas.push(resumo.textoLivre, '');
  } else {
    linhas.push('PENDÊNCIAS PRIORITÁRIAS');
    linhas.push(...(resumo.pendencias.length ? resumo.pendencias.map((p) => `- ${p}`) : ['- Nenhuma pendência']));
    linhas.push('', 'ATENDIMENTOS DO PERÍODO');
    for (const c of resumo.conversas) {
      linhas.push('', `${c.numero}. Cliente: ${rotulo(c)}`);
      linhas.push(`   Assunto: ${c.assunto || 'não identificado'}`);
      linhas.push(`   Onde parou: ${c.ondeParou || 'sem resumo'}`);
      linhas.push(`   Ação para a Dai: ${c.acao || 'nenhuma ação necessária'}`);
      linhas.push(`   Horário: ${formatarBRT(c.inicio)} até ${formatarBRT(c.fim)}, ${c.mensagens} mensagens`);
    }
    linhas.push('');
  }
  linhas.push(`Total: ${resumo.totais.conversas} conversa${resumo.totais.conversas === 1 ? '' : 's'}, ${resumo.totais.mensagens} mensagens.`);
  if (!resumo.textoLivre) linhas.push(textoPerfis(resumo));
  if (resumo.totais.retomadas) linhas.push(textoRetomadas(resumo));
  linhas.push('', 'Bom trabalho!', 'Carol, atendente virtual');
  return linhas.join('\n');
}

/** Texto do "/carol" pelo WhatsApp: só a lista, uma linha por atendimento. */
export function textoCompacto(resumo, agora = new Date()) {
  const data = agora.toLocaleDateString('pt-BR', { timeZone: config.timezone });
  if (!resumo.conversas.length) return `*Atendimentos das ultimas 24h (${data})*\n\nNenhum atendimento no periodo.`;
  return [
    `*Atendimentos das ultimas 24h (${data})*`,
    `${resumo.totais.conversas} conversa${resumo.totais.conversas === 1 ? '' : 's'}, ${resumo.totais.mensagens} mensagens. ${textoPerfis(resumo)}${resumo.totais.retomadas ? ` ${textoRetomadas(resumo)}` : ''}`,
    '',
    textoLinhas(resumo),
    '',
    'Para ver as mensagens de uma conversa: /carol detalhe <numero>',
  ].join('\n');
}

/** Encontra uma conversa pelo número da lista ou pelo telefone (inteiro ou final). */
export function encontrarConversa(conversas, ref) {
  const r = String(ref || '').trim().replace(/\D/g, '');
  if (!r) return null;
  if (r.length <= 3) return conversas.find((c) => c.numero === Number(r)) || null;
  return conversas.find((c) => String(c.sessao).replace(/\D/g, '').endsWith(r)) || null;
}

/** Mensagens de uma conversa, na ordem, para o WhatsApp. */
export function textoDetalhe(conversa) {
  const linhas = [`*Conversa ${conversa.numero}: ${conversa.cliente}*`, `${formatarBRT(conversa.inicio)} ate ${formatarBRT(conversa.fim)}, ${conversa.mensagens.length} mensagens${conversa.origemAnuncio ? `, via anuncio "${conversa.origemAnuncio}"` : ''}`, ''];
  for (const m of conversa.mensagens) {
    if (m.tipo === 'humano') linhas.push(`[${formatarBRT(m.ts, false)}] Equipe (app): ${m.equipe}`);
    else linhas.push(`[${formatarBRT(m.ts, false)}] Cliente: ${m.cliente || '(sem texto)'}`);
    if (m.carol) linhas.push(`Carol: ${m.carol}`);
    if (m.situacao) linhas.push(`(${m.situacao})`);
    linhas.push('');
  }
  return linhas.join('\n').trim();
}
