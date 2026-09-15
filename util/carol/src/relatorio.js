// Relatório diário da Carol: resume os atendimentos das últimas 24h e envia
// por e-mail para a equipe (Dai) todo dia às 8h de Brasília.

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { listarPeriodo, registrarAtendimento } from './registro.js';
import { custoUSD } from './custos.js';
import { enviar as enviarViaTransporte } from './email/transporte.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// O relatório da Dai e o dos sócios usam o mesmo resumo de atendimentos; a
// memo evita pagar a IA duas vezes na mesma manhã.
const MEMO_MS = 20 * 60 * 1000;
let memo = { ts: 0, valor: null };

function formatarBRT(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: config.timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function identificarCliente(sessao) {
  if (sessao.startsWith('wa:')) return `WhatsApp ${sessao.slice(3)}`;
  return 'Chat do site';
}

export async function montarRelatorio(fim = new Date()) {
  if (memo.valor && Date.now() - memo.ts < MEMO_MS) return memo.valor;
  const valor = await montarRelatorioSemMemo(fim);
  memo = { ts: Date.now(), valor };
  return valor;
}

async function montarRelatorioSemMemo(fim) {
  const inicio = new Date(fim.getTime() - 24 * 60 * 60 * 1000);
  // registros de sistema (resumos, custo do próprio relatório) ficam de fora
  const entradas = listarPeriodo(inicio, fim).filter((e) => e.tipo !== 'sistema');

  const periodoTxt = `${formatarBRT(inicio.toISOString())} até ${formatarBRT(fim.toISOString())} (Brasília)`;

  if (!entradas.length) {
    return {
      assunto: `Carol: sem atendimentos no período (${new Date().toLocaleDateString('pt-BR', { timeZone: config.timezone })})`,
      corpo: `Bom dia, Dai!\n\nA Carol não registrou nenhum atendimento entre ${periodoTxt}.\n\nAté amanhã!\nCarol, atendente virtual`,
    };
  }

  // agrupa por conversa
  const conversas = new Map();
  for (const e of entradas) {
    if (!conversas.has(e.sessao)) conversas.set(e.sessao, []);
    conversas.get(e.sessao).push(e);
  }

  let transcricoes = '';
  for (const [sessao, msgs] of conversas) {
    transcricoes += `\n===== CONVERSA: ${identificarCliente(sessao)} | ${msgs.length} interações | ${formatarBRT(msgs[0].ts)} até ${formatarBRT(msgs[msgs.length - 1].ts)} =====\n`;
    for (const m of msgs) {
      transcricoes += `Cliente: ${m.mensagem}\nCarol: ${m.resposta}\n`;
    }
  }
  transcricoes = transcricoes.slice(0, 150000);

  const resposta = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: `Você prepara o relatório matinal da Carol (atendente virtual da APP Agro Peças Padrão, peças agrícolas) para a Dai, a atendente humana que assume às 8h. Escreva em português do Brasil, texto simples de e-mail, SEM travessão e SEM emoji.

Formato exigido:

PENDÊNCIAS PRIORITÁRIAS
- lista curta do que a Dai precisa fazer HOJE, em ordem de prioridade (orçamentos prometidos, encomendas de fábrica, clientes aguardando retorno, peças a verificar). Se não houver, escreva "Nenhuma pendência".

ATENDIMENTOS DO PERÍODO
Para cada conversa, um bloco com:
- Cliente: nome se informado + canal/telefone
- Assunto: peça/código/máquina tratados
- Onde parou: última situação da conversa
- Ação para a Dai: o que fazer (ou "nenhuma ação necessária")

Seja fiel às transcrições, não invente dados. Termine com uma linha de estatística: total de conversas e de mensagens.`,
      },
    ],
    messages: [{ role: 'user', content: `Período: ${periodoTxt}\n${transcricoes}` }],
  });

  const u = resposta.usage || {};
  const usoRelatorio = {
    entrada: u.input_tokens || 0,
    saida: u.output_tokens || 0,
    cacheLeitura: u.cache_read_input_tokens || 0,
    cacheEscrita: u.cache_creation_input_tokens || 0,
    chamadas: 1,
  };
  registrarAtendimento({
    canal: 'sistema',
    sessao: 'sistema:relatorio',
    tipo: 'sistema',
    mensagem: 'Geração do relatório diário para a Dai',
    resposta: `${conversas.size} conversas resumidas`,
    uso: usoRelatorio,
    custo: custoUSD(usoRelatorio),
    modelo: config.claudeModel,
  });

  const corpoIA = resposta.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .replace(/\s*[—–]\s*/g, ', ');

  const dataTxt = new Date().toLocaleDateString('pt-BR', { timeZone: config.timezone });
  return {
    assunto: `Carol: resumo dos atendimentos, ${dataTxt} (${conversas.size} conversa${conversas.size > 1 ? 's' : ''})`,
    corpo: `Bom dia, Dai!\n\nSegue o resumo do que a Carol atendeu entre ${periodoTxt}.\n\n${corpoIA}\n\nBom trabalho!\nCarol, atendente virtual`,
  };
}

/**
 * Envia um e-mail pela cadeia de provedores (Resend → Brevo → SMTP).
 * Mantém a assinatura antiga (assunto, corpo, para) por compatibilidade.
 */
export async function enviarEmail(assunto, corpo, para = config.destinatarios.dai) {
  return enviarViaTransporte({ para, assunto, texto: corpo });
}

/** Relatório operacional diário para a Dai. Agendado em agenda.js (server.js). */
export async function enviarRelatorio() {
  const { assunto, corpo } = await montarRelatorio();
  await enviarEmail(assunto, corpo);
  return { enviado: true, assunto, resumo: assunto };
}
