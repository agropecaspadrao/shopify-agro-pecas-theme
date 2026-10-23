// Palavra-chave semanal dos comandos "/carol".
//
// Segurança: a palavra em texto claro só existe (1) no e-mail enviado aos
// sócios, (2) na memória durante a geração e (3) na resposta autenticada de
// POST /admin/api/chave/rotacionar (SDR) quando o e-mail falha. Em disco fica só o hash scrypt com sal
// aleatório. Validação com comparação em tempo constante. A palavra anterior
// continua valendo por 24h após a rotação (janela de transição).
// A palavra NUNCA sai pelo WhatsApp (nem como contingência): o WhatsApp é o
// canal que ela protege. Se o e-mail falhar, a rotação é desfeita (a palavra
// atual continua valendo) e os administradores recebem no WhatsApp só o
// aviso, sem o conteúdo, de que podem gerar pelo SDR (seção Carol).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { DATA_DIR } from '../registro.js';
import { enviarOuContingencia } from '../email/contingencia.js';
import { semAcentos } from '../util/texto.js';

const ARQUIVO = path.join(DATA_DIR, 'chave-semanal.json');
const VALIDADE_MS = 7 * 24 * 3600 * 1000;
const TRANSICAO_MS = 24 * 3600 * 1000;

// Vocabulário do mundo da loja: fácil de ditar por telefone, difícil de chutar
// junto com o número.
const PALAVRAS = [
  'trator', 'colheita', 'semente', 'plantio', 'safra', 'bomba', 'condutor', 'dedo', 'sensor', 'bocal',
  'engate', 'mancal', 'peneira', 'dosador', 'molinete', 'pistao', 'valvula', 'mangueira', 'rolamento', 'polia',
  'lavoura', 'campo', 'terra', 'chuva', 'sol', 'soja', 'milho', 'trigo', 'algodao', 'cana',
  'curitiba', 'parana', 'gaucho', 'catarina', 'cerrado', 'pampa', 'serra', 'vale', 'rio', 'lago',
  'arado', 'grade', 'roda', 'eixo', 'pinhao', 'tampa', 'anel', 'bucha', 'bico', 'aro',
  'verde', 'dourado', 'ferro', 'aco', 'bronze', 'motor', 'turbo', 'diesel', 'hidraulica', 'pneu',
];

function ler() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return null;
  }
}

function gravar(estado) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(estado), { mode: 0o600 });
}

/** Volta ao estado anterior a uma rotação (null = não havia palavra). */
function restaurar(estado) {
  if (estado) gravar(estado);
  else {
    try {
      fs.unlinkSync(ARQUIVO);
    } catch {}
  }
}

export function normalizar(texto) {
  return semAcentos(texto)
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function derivar(palavra, salt) {
  return crypto.scryptSync(normalizar(palavra), salt, 32, { N: 16384, r: 8, p: 1 });
}

/** Gera uma palavra-chave nova no formato agro-<palavra>-<dois dígitos>. */
export function gerarPalavra(rng = crypto.randomInt) {
  const palavra = PALAVRAS[rng(PALAVRAS.length)];
  const numero = String(rng(10, 100));
  return `agro-${palavra}-${numero}`;
}

/**
 * Rotaciona a palavra-chave. Devolve a palavra em texto claro UMA vez, para
 * ser enviada por e-mail. A anterior vale por mais 24h.
 */
export function rotacionar({ agora = Date.now, rng } = {}) {
  const atual = ler();
  const palavra = gerarPalavra(rng);
  const salt = crypto.randomBytes(16).toString('hex');
  const novo = {
    atual: { hash: derivar(palavra, salt).toString('hex'), salt, criadaEm: new Date(agora()).toISOString(), validaAte: new Date(agora() + VALIDADE_MS).toISOString() },
    anterior: atual?.atual ? { ...atual.atual, validaAte: new Date(agora() + TRANSICAO_MS).toISOString() } : null,
  };
  gravar(novo);
  console.log(`[chave] palavra-chave rotacionada, válida até ${novo.atual.validaAte}`);
  return { palavra, validaAte: novo.atual.validaAte };
}

/** Confere uma tentativa contra a palavra atual (e a anterior, na transição). */
export function validar(tentativa, { agora = Date.now } = {}) {
  const estado = ler();
  if (!estado?.atual || !tentativa) return false;
  const candidatas = [estado.atual, estado.anterior].filter((c) => c && new Date(c.validaAte).getTime() > agora());
  for (const c of candidatas) {
    const esperado = Buffer.from(c.hash, 'hex');
    const recebido = derivar(tentativa, c.salt);
    if (esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido)) return true;
  }
  return false;
}

export function estadoChave({ agora = Date.now } = {}) {
  const e = ler();
  if (!e?.atual) return { existe: false };
  return {
    existe: true,
    criadaEm: e.atual.criadaEm,
    validaAte: e.atual.validaAte,
    expirada: new Date(e.atual.validaAte).getTime() <= agora(),
    transicaoAte: e.anterior?.validaAte || null,
  };
}

/** Precisa rotacionar? (não existe, ou já passou a validade) */
export function precisaRotacionar({ agora = Date.now } = {}) {
  const e = estadoChave({ agora });
  return !e.existe || e.expirada;
}

export function textoEmailChave(palavra, validaAte) {
  const ate = new Date(validaAte).toLocaleString('pt-BR', { timeZone: config.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return [
    'Bom dia!',
    '',
    'Esta é a palavra-chave da Carol para esta semana:',
    '',
    `    ${palavra}`,
    '',
    `Vale até ${ate} (Brasília). A palavra da semana passada continua aceita por 24 horas, para ninguém ficar travado na virada.`,
    '',
    'Como usar: pelo WhatsApp da loja, mande "/carol" que a Carol pede a palavra-chave. Depois de confirmar, ela envia o resumo dos atendimentos das últimas 24 horas. Outros comandos: "/carol saude" (situação dos sistemas), "/carol socios" (envia o relatório executivo por e-mail agora) e "/carol chave" (gera uma palavra nova e manda por e-mail).',
    '',
    'Só os números cadastrados como administradores conseguem usar os comandos. Se esta mensagem chegou a alguém que não deveria, peça para gerar uma nova palavra com "/carol chave".',
    '',
    'Carol, agente de monitoramento',
  ].join('\n');
}

export const AVISO_SEM_EMAIL =
  'Carol: nao consegui enviar a nova palavra-chave por e-mail (e-mail indisponivel). Por seguranca ela nao sai pelo WhatsApp. ' +
  'A palavra atual continua valendo. Para gerar uma nova e ve-la na tela, use o SDR (secao Carol, Palavra-chave).';

/**
 * Rotaciona e envia por e-mail aos sócios e administradores.
 * Se o e-mail estiver indisponível:
 *   - `exibir: true` (API do SDR / HTTP autenticado com a chave de administrador):
 *     mantém a rotação e devolve a palavra para ser mostrada UMA vez na tela;
 *   - senão: desfaz a rotação, avisa os administradores pelo WhatsApp SEM o
 *     conteúdo e lança erro.
 */
export async function rotacionarEEnviar(deps = {}) {
  const anterior = ler();
  const { palavra, validaAte } = rotacionar(deps);
  const para = deps.destinatarios || config.destinatarios.socios;
  const r = await enviarOuContingencia({ para, assunto: 'Carol: palavra-chave da semana', texto: textoEmailChave(palavra, validaAte) }, { ...deps, permitirWhatsApp: false });
  if (r.canal === 'email') return { validaAte, enviadaPara: para, canal: 'email' };
  if (deps.exibir) return { validaAte, enviadaPara: [], canal: 'tela', palavra, erroEmail: r.erroEmail };
  restaurar(anterior);
  const avisar = deps.avisarAdmins || (async (texto) => {
    const { enviarTexto } = await import('../whatsapp.js');
    for (const n of config.admins) await enviarTexto(n, texto).catch(() => {});
  });
  await avisar(AVISO_SEM_EMAIL).catch(() => {});
  throw new Error(`e-mail indisponível (${r.erroEmail || 'sem provedor'}); palavra-chave não rotacionada, a atual continua valendo`);
}
