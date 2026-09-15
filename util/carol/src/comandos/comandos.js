// Comandos "/carol" pelo WhatsApp, para os administradores cadastrados.
//
// Fluxo: "/carol [subcomando]" → a Carol pede a palavra-chave da semana →
// confere → executa. Depois de confirmar, o número fica autenticado por 15
// minutos para não pedir a palavra a cada comando. Três erros em uma hora
// bloqueiam o número por uma hora e geram anomalia de segurança.
//
// Tudo aqui é determinístico (sem LLM): comando é operação, não conversa.
// Números fora da lista de administradores são ignorados em silêncio, para o
// recurso não ser descoberto por tentativa.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { DATA_DIR } from '../registro.js';
import { validar as validarChavePadrao, rotacionarEEnviar as rotacionarPadrao, estadoChave } from './chave.js';
import { reportarAnomalia as reportarPadrao } from '../alertas/anomalias.js';

import { fatiar } from '../util/texto.js';
export { fatiar };

const PENDENTE_MS = 5 * 60 * 1000;
const AUTENTICADO_MS = 15 * 60 * 1000;
const JANELA_FALHAS_MS = 60 * 60 * 1000;
const MAX_FALHAS = 3;
const BLOQUEIO_MS = 60 * 60 * 1000;

const SUBCOMANDOS = ['relatorio', 'saude', 'socios', 'chave', 'ajuda', 'status'];
const estados = new Map(); // numero -> { pendente, pendenteAte, autenticadoAte, falhas: [], bloqueadoAte }

export function ehComando(texto) {
  return /^\s*\/carol(\s|$)/i.test(String(texto || ''));
}

export function interpretar(texto) {
  const m = String(texto || '').trim().match(/^\/carol\s*(\S+)?/i);
  const sub = (m?.[1] || 'relatorio').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return SUBCOMANDOS.includes(sub) ? sub : 'ajuda';
}

function auditar(evento) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'auditoria.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...evento }) + '\n');
  } catch {}
}

function estadoDe(numero) {
  let e = estados.get(numero);
  if (!e) {
    e = { pendente: null, pendenteAte: 0, autenticadoAte: 0, falhas: [], bloqueadoAte: 0 };
    estados.set(numero, e);
  }
  return e;
}

const AJUDA = [
  'Comandos da Carol:',
  '/carol - resumo dos atendimentos das ultimas 24h',
  '/carol saude - situacao dos sistemas (WhatsApp, IA, e-mail, loja, planilha)',
  '/carol socios - envia agora o relatorio executivo por e-mail',
  '/carol chave - gera nova palavra-chave e envia por e-mail',
  '/carol status - quando a palavra-chave vence e quem esta autenticado',
].join('\n');

async function executar(sub, numero, deps) {
  const agora = deps.agora || Date.now;
  switch (sub) {
    case 'relatorio': {
      const { corpo, assunto } = await deps.montarRelatorio();
      return fatiar(`${assunto}\n\n${corpo}`);
    }
    case 'saude': {
      const estado = await deps.verificarTudo();
      return fatiar(deps.textoSaude(estado));
    }
    case 'socios': {
      const r = await deps.enviarRelatorioSocios();
      const via = r.canal === 'whatsapp' ? 'WhatsApp dos administradores (contingencia: e-mail indisponivel)' : `e-mail para ${(r.enviadoPara || config.destinatarios.socios).join(', ')}`;
      return [`Relatorio executivo enviado por ${via}.`];
    }
    case 'chave': {
      const r = await deps.rotacionarChave();
      // Por desenho a palavra nova sai por e-mail; só cai para o WhatsApp dos
      // administradores se o e-mail estiver indisponível (contingência).
      const via = r.canal === 'whatsapp' ? 'WhatsApp dos administradores (contingencia: e-mail indisponivel)' : `e-mail para ${r.enviadaPara.join(', ')}`;
      return [`Nova palavra-chave gerada e enviada por ${via}. A anterior vale por mais 24 horas.`];
    }
    case 'status': {
      const c = estadoChave({ agora });
      const ate = c.existe ? new Date(c.validaAte).toLocaleString('pt-BR', { timeZone: config.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nenhuma';
      const autenticados = [...estados.entries()].filter(([, e]) => e.autenticadoAte > agora()).map(([n]) => n.replace(/^(\d{4})\d+(\d{4})$/, '$1****$2'));
      return [`Palavra-chave atual vale ate ${ate}.\nAutenticados agora: ${autenticados.length ? autenticados.join(', ') : 'ninguem'}.\nAdministradores cadastrados: ${config.admins.length}.`];
    }
    default:
      return [AJUDA];
  }
}

/**
 * Trata uma mensagem recebida ANTES do fluxo normal de atendimento.
 * @returns {{tratado:boolean, respostas:string[]}} tratado=false → segue para a Carol normal
 */
export async function tratarMensagemAdmin({ de, texto }, deps = {}) {
  const agora = deps.agora || Date.now;
  const admins = deps.admins || config.admins;
  const validarChave = deps.validarChave || ((t) => validarChavePadrao(t, { agora }));
  const reportarAnomalia = deps.reportarAnomalia || reportarPadrao;
  const ehAdmin = admins.includes(String(de));

  if (!ehAdmin) {
    if (ehComando(texto)) {
      auditar({ evento: 'comando_nao_autorizado', de });
      console.warn(`[comandos] ${de} tentou /carol sem ser administrador (ignorado)`);
      return { tratado: true, respostas: [] };
    }
    return { tratado: false, respostas: [] };
  }

  const e = estadoDe(de);
  const t = agora();

  if (e.bloqueadoAte > t) {
    if (ehComando(texto) || e.pendente) {
      auditar({ evento: 'comando_bloqueado', de });
      return { tratado: true, respostas: [] };
    }
    return { tratado: false, respostas: [] };
  }

  const execDeps = { ...deps, agora };

  if (ehComando(texto)) {
    const sub = interpretar(texto);
    auditar({ evento: 'comando', de, sub });
    if (sub === 'ajuda') return { tratado: true, respostas: [AJUDA] };
    if (e.autenticadoAte > t) {
      return { tratado: true, respostas: await executar(sub, de, execDeps) };
    }
    e.pendente = sub;
    e.pendenteAte = t + PENDENTE_MS;
    return { tratado: true, respostas: ['Qual e a palavra-chave desta semana?'] };
  }

  if (e.pendente && e.pendenteAte > t) {
    const ok = validarChave(texto);
    e.falhas = e.falhas.filter((f) => t - f < JANELA_FALHAS_MS);
    if (ok) {
      const sub = e.pendente;
      e.pendente = null;
      e.autenticadoAte = t + AUTENTICADO_MS;
      e.falhas = [];
      auditar({ evento: 'chave_ok', de, sub });
      let respostas;
      try {
        respostas = await executar(sub, de, execDeps);
      } catch (err) {
        console.error('[comandos] falha ao executar', sub, err);
        respostas = [`Nao consegui executar "${sub}" agora: ${String(err.message).slice(0, 200)}`];
      }
      return { tratado: true, respostas };
    }
    e.falhas.push(t);
    auditar({ evento: 'chave_errada', de, falhas: e.falhas.length });
    const restantes = MAX_FALHAS - e.falhas.length;
    if (restantes <= 0) {
      e.pendente = null;
      e.bloqueadoAte = t + BLOQUEIO_MS;
      await reportarAnomalia({ tipo: 'seguranca_tentativas', detalhe: `Numero ${de} errou a palavra-chave ${MAX_FALHAS} vezes em uma hora e foi bloqueado por 1h.` });
      return { tratado: true, respostas: ['Palavra-chave incorreta. Comandos bloqueados por uma hora.'] };
    }
    return { tratado: true, respostas: [`Palavra-chave incorreta. Tentativas restantes: ${restantes}.`] };
  }

  if (e.pendente && e.pendenteAte <= t) e.pendente = null;
  return { tratado: false, respostas: [] };
}

/** Só para testes: zera o estado em memória. */
export function limparEstados() {
  estados.clear();
}
