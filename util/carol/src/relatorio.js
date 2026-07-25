// Relatório diário da Carol: resume os atendimentos das últimas 24h e envia
// por e-mail para a equipe (Dai) todo dia às 8h de Brasília.

import dns from 'node:dns/promises';
import nodemailer from 'nodemailer';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { listarPeriodo } from './registro.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const REPORT_TO = process.env.REPORT_TO || 'comercial@agropecaspadrao.com.br';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

// 8h de Brasília = 11h UTC (o Brasil não tem mais horário de verão)
const HORA_RELATORIO_UTC = 11;

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
  const inicio = new Date(fim.getTime() - 24 * 60 * 60 * 1000);
  const entradas = listarPeriodo(inicio, fim);

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

export async function enviarRelatorio() {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('[relatorio] SMTP_USER/SMTP_PASS não configurados; relatório não enviado.');
    return { enviado: false, motivo: 'SMTP não configurado' };
  }
  const { assunto, corpo } = await montarRelatorio();
  // O ambiente do Railway não tem rota IPv6 de saída e o nodemailer resolve
  // AAAA primeiro; conectamos pelo IPv4 explicitamente, validando o TLS pelo
  // hostname via servername.
  let hostConexao = SMTP_HOST;
  try {
    [hostConexao] = await dns.resolve4(SMTP_HOST);
  } catch {}
  const transporte = nodemailer.createTransport({
    host: hostConexao,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { servername: SMTP_HOST },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });
  await transporte.sendMail({
    from: `"Carol - Agro Peças Padrão" <${SMTP_USER}>`,
    to: REPORT_TO,
    subject: assunto,
    text: corpo,
  });
  console.log(`[relatorio] enviado para ${REPORT_TO}: ${assunto}`);
  return { enviado: true, assunto };
}

/** Agenda o envio diário às 8h de Brasília (11h UTC). */
export function agendarRelatorioDiario() {
  const proximo = () => {
    const agora = new Date();
    const alvo = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), HORA_RELATORIO_UTC, 0, 0));
    if (alvo <= agora) alvo.setUTCDate(alvo.getUTCDate() + 1);
    return alvo.getTime() - agora.getTime();
  };
  const marcar = () => {
    const ms = proximo();
    console.log(`[relatorio] próximo envio em ${(ms / 3600000).toFixed(1)}h`);
    setTimeout(async () => {
      try {
        await enviarRelatorio();
      } catch (e) {
        console.error('[relatorio] falha no envio:', e.message);
      }
      marcar();
    }, ms).unref();
  };
  marcar();
}
