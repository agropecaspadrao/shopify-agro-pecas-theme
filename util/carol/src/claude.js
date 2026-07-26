import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { config } from './config.js';
import { montarSystem } from './persona.js';
import { catalogoResumo, carregarCatalogo, buscarProdutosTexto, detalharProduto } from './catalogo.js';
import { contextoHorario } from './horario.js';
import { obterHistorico, salvarHistorico } from './sessions.js';
import { registrarAtendimento } from './registro.js';
import { custoUSD } from './custos.js';
import { verificarSaldoBaixo } from './alerta.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const buscarProdutosTool = betaTool({
  name: 'buscar_produtos',
  description:
    'Busca produtos no catálogo da loja por nome, código de peça, modelo de máquina, implemento ou descrição do problema. Retorna até 5 produtos com SKU, preço (ou Sob Consulta) e link. Use sempre que o cliente mencionar uma peça, código ou máquina.',
  inputSchema: {
    type: 'object',
    properties: {
      termos: {
        type: 'string',
        description: 'Termos de busca: código da peça, nome, máquina ou modelo. Ex: "dedo retrátil john deere", "H-102724", "bomba hidráulica".',
      },
    },
    required: ['termos'],
  },
  run: async ({ termos }) => buscarProdutosTexto(termos),
});

const detalharProdutoTool = betaTool({
  name: 'detalhar_produto',
  description:
    'Retorna a ficha completa de um produto: descrição, especificações técnicas, compatibilidade de máquinas, códigos equivalentes, preço/situação de estoque e link. Use antes de afirmar qualquer detalhe técnico ou compatibilidade.',
  inputSchema: {
    type: 'object',
    properties: {
      codigo_ou_nome: {
        type: 'string',
        description: 'SKU, código equivalente, handle ou nome do produto. Ex: "H-102724".',
      },
    },
    required: ['codigo_ou_nome'],
  },
  run: async ({ codigo_ou_nome }) => detalharProduto(codigo_ou_nome),
});

// Sem travessão, sem emoji: garantia final por pós-processamento, além da instrução.
function sanitizar(texto) {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // negrito Markdown -> negrito do WhatsApp
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Gera um resumo de uma linha da conversa, para levar de contexto ao WhatsApp.
 * Retorna null quando não há histórico.
 */
export async function resumirConversa(sessaoId) {
  const historico = obterHistorico(sessaoId);
  if (!historico.length) return null;

  const transcricao = historico
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Carol'}: ${typeof m.content === 'string' ? m.content : ''}`)
    .join('\n')
    .slice(-6000);

  const resposta = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 150,
    system:
      'Resuma a conversa de atendimento abaixo em UMA linha curta em português, para a equipe entender o contexto. Inclua peça/código, máquina e dados do cliente se houver. Sem travessão, sem emoji, sem aspas. Exemplo: Conversa sobre bomba hidraulica MF-AX, cliente quer 2 unidades para trator Massey 275, aguardando orcamento.',
    messages: [{ role: 'user', content: transcricao }],
  });

  const texto = sanitizar(
    resposta.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ')
  );

  const u = resposta.usage || {};
  const uso = {
    entrada: u.input_tokens || 0,
    saida: u.output_tokens || 0,
    cacheLeitura: u.cache_read_input_tokens || 0,
    cacheEscrita: u.cache_creation_input_tokens || 0,
    chamadas: 1,
  };
  registrarAtendimento({
    canal: 'sistema',
    sessao: 'sistema:resumo',
    tipo: 'sistema',
    mensagem: 'Resumo de conversa para transferência ao WhatsApp',
    resposta: texto,
    uso,
    custo: custoUSD(uso),
    modelo: config.claudeModel,
  });

  return texto ? texto.split('\n')[0].slice(0, 300) : null;
}

/**
 * Processa uma mensagem do cliente e devolve a resposta da Carol.
 * @param {string} sessaoId identificador da conversa (telefone do WhatsApp ou id do widget)
 * @param {string} mensagem texto enviado pelo cliente
 * @param {'whatsapp'|'site'} canal
 */
export async function responder(sessaoId, mensagem, canal = 'whatsapp') {
  await carregarCatalogo();

  const historico = obterHistorico(sessaoId);
  const horario = contextoHorario();
  const mensagens = [...historico, { role: 'user', content: mensagem }];

  const system = [
    {
      type: 'text',
      text: montarSystem(catalogoResumo()),
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
    {
      type: 'text',
      text:
        `Contexto desta mensagem: canal ${canal === 'site' ? 'chat do site' : 'WhatsApp'}. ${horario.texto}` +
        (historico.length === 0
          ? ' ATENÇÃO: esta é a PRIMEIRA mensagem desta conversa. Sua resposta DEVE começar com a saudação (espelhe a saudação do cliente se ele usou uma; senão, use a saudação correta do horário) seguida de uma breve apresentação como Carol, antes de qualquer outro conteúdo.'
          : ''),
    },
  ];

  const runner = client.beta.messages.toolRunner({
    model: config.claudeModel,
    max_tokens: 1024,
    system,
    tools: [buscarProdutosTool, detalharProdutoTool],
    messages: mensagens,
    max_iterations: 6,
  });

  // Itera as rodadas do tool runner acumulando o uso de tokens de CADA
  // chamada à API (o `usage` da mensagem final cobre só a última rodada).
  let final = null;
  const uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, chamadas: 0 };
  for await (const rodada of runner) {
    final = rodada;
    const u = rodada.usage || {};
    uso.entrada += u.input_tokens || 0;
    uso.saida += u.output_tokens || 0;
    uso.cacheLeitura += u.cache_read_input_tokens || 0;
    uso.cacheEscrita += u.cache_creation_input_tokens || 0;
    uso.chamadas++;
  }
  const custo = custoUSD(uso);

  const texto = sanitizar(
    (final?.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
  );

  let resposta =
    texto ||
    'Desculpe, não consegui processar sua mensagem agora. Pode repetir de outro jeito? Se preferir, a Dai retorna no próximo horário comercial, de segunda a sexta das 8h às 18h.';

  // Garantia de saudação na primeira resposta da conversa: se o modelo não
  // começou cumprimentando, o servidor prefixa; se cumprimentou com a saudação
  // ERRADA para o horário (e o cliente não usou nenhuma), o servidor corrige.
  if (historico.length === 0) {
    const doCliente = mensagem.match(/\b(bom dia|boa tarde|boa noite)\b/i);
    const saudacao = doCliente ? doCliente[1].replace(/^./, (c) => c.toUpperCase()) : horario.saudacao;
    const usada = resposta.match(/^(bom dia|boa tarde|boa noite)/i);
    if (usada && usada[1].toLowerCase() !== saudacao.toLowerCase()) {
      resposta = saudacao + resposta.slice(usada[1].length);
    } else if (!usada && !/^(olá|oi)\b/i.test(resposta)) {
      resposta = `${saudacao}! Aqui é a Carol, atendente virtual da APP Agro Peças Padrão, obrigada pelo contato.\n\n${resposta}`;
    }
  }

  salvarHistorico(sessaoId, [...mensagens, { role: 'assistant', content: resposta }]);
  registrarAtendimento({ canal, sessao: sessaoId, mensagem, resposta, uso, custo, modelo: config.claudeModel });
  verificarSaldoBaixo().catch((e) => console.warn('[alerta] falha na verificação:', e.message));
  return resposta;
}
