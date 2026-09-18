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
import { pausar, retomar, estadoPausa, horasDe, horaBRT, textoPausa } from './pausa.js';
import { reportarAnomalia as reportarPadrao } from '../alertas/anomalias.js';

import { fatiar } from '../util/texto.js';
export { fatiar };

const PENDENTE_MS = 5 * 60 * 1000;
const AUTENTICADO_MS = 15 * 60 * 1000;
const JANELA_FALHAS_MS = 60 * 60 * 1000;
const MAX_FALHAS = 3;
const BLOQUEIO_MS = 60 * 60 * 1000;

const SUBCOMANDOS = ['relatorio', 'detalhe', 'saude', 'socios', 'chave', 'ajuda', 'status', 'pausar', 'voltar'];
// Formas alternativas que os sócios tendem a escrever
const APELIDOS = { pausa: 'pausar', parar: 'pausar', pause: 'pausar', retomar: 'voltar', ativar: 'voltar', religar: 'voltar', despausar: 'voltar' };
const estados = new Map(); // numero -> { pendente, pendenteAte, autenticadoAte, falhas: [], bloqueadoAte }

export function ehComando(texto) {
  return /^\s*\/carol(\s|$)/i.test(String(texto || ''));
}

export function interpretar(texto) {
  const m = String(texto || '').trim().match(/^\/carol\s*(\S+)?\s*(.*)$/i);
  let sub = (m?.[1] || 'relatorio').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  sub = APELIDOS[sub] || sub;
  return SUBCOMANDOS.includes(sub) ? sub : 'ajuda';
}

/**
 * Normaliza um número brasileiro para comparação. Celulares cadastrados no
 * WhatsApp antes do nono dígito chegam no webhook com 12 dígitos
 * (55 + DDD + 8), enquanto o cadastro em CAROL_ADMINS costuma ter 13
 * (55 + DDD + 9 + 8). Sem isso o sócio manda "/carol" e a Carol o trata como
 * cliente comum.
 */
export function normalizarNumero(numero) {
  const n = String(numero || '').replace(/\D/g, '');
  if (n.length === 13 && n.startsWith('55') && n[4] === '9') return n.slice(0, 4) + n.slice(5);
  return n;
}

export function mesmoNumero(a, b) {
  return normalizarNumero(a) === normalizarNumero(b);
}

/** O número é de um administrador (CAROL_ADMINS), com ou sem o nono dígito? */
export function ehAdministrador(de, admins = config.admins) {
  return admins.some((a) => mesmoNumero(a, de));
}

// Aviso de silêncio: o sócio escreve texto comum no horário comercial (ou na
// pausa), a Carol fica calada por regra e ele conclui que ela está quebrada.
// Um aviso curto explica o silêncio; no máximo um a cada 12h por número.
const AVISO_SILENCIO_MS = 12 * 60 * 60 * 1000;
const ultimoAvisoSilencio = new Map(); // numero normalizado -> timestamp

/**
 * @param {'horario'|'pausa'} motivo
 * @returns {string|null} texto do aviso, ou null se não é admin ou já foi avisado
 */
export function avisoSilencioAdmin(de, motivo, { agora = Date.now, admins = config.admins } = {}) {
  if (!ehAdministrador(de, admins)) return null;
  const chave = normalizarNumero(de);
  const t = agora();
  if (t - (ultimoAvisoSilencio.get(chave) || 0) < AVISO_SILENCIO_MS) return null;
  ultimoAvisoSilencio.set(chave, t);
  const porque =
    motivo === 'pausa'
      ? 'Estou pausada no WhatsApp agora (um socio assumiu o atendimento), por isso nao respondo mensagens comuns.'
      : 'No horario comercial (seg-sex, 8h as 18h) eu fico em silencio no WhatsApp para a Dai atender, por isso nao respondo mensagens comuns.';
  return `Oi, aqui e a Carol. ${porque}\nPara falar comigo a qualquer hora, mande /carol (ou /carol ajuda para ver os comandos).`;
}

/** Argumento depois do subcomando ("/carol detalhe 3" → "3"). */
export function argumento(texto) {
  const m = String(texto || '').trim().match(/^\/carol\s*\S*\s*(.*)$/i);
  return (m?.[1] || '').trim();
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
  '/carol - lista dos atendimentos das ultimas 24h (uma linha por conversa)',
  '/carol detalhe 3 - mensagens da conversa numero 3 da lista (ou o telefone)',
  '/carol saude - situacao dos sistemas (WhatsApp, IA, e-mail, loja, planilha)',
  '/carol socios - envia agora o relatorio executivo por e-mail',
  '/carol chave - gera nova palavra-chave e envia por e-mail',
  '/carol status - quando a palavra-chave vence, quem esta autenticado e se ha pausa',
  '/carol pausar - a Carol para de responder clientes no WhatsApp por 2 horas (ex.: /carol pausar 4 = 4 horas)',
  '/carol voltar - encerra a pausa antes da hora',
].join('\n');

async function executar(sub, arg, deps, de = null) {
  const agora = deps.agora || Date.now;
  switch (sub) {
    case 'pausar': {
      const antes = estadoPausa({ agora });
      const horas = horasDe(arg);
      const e = pausar({ horas, por: de, agora });
      const duracao = Number.isInteger(horas) ? `${horas} hora${horas === 1 ? '' : 's'}` : `${String(horas).replace('.', ',')} horas`;
      auditar({ evento: 'pausa', de, horas, ate: e.ate });
      return [
        `${antes.ativa ? 'Pausa renovada' : 'Carol pausada no WhatsApp'} ate as ${horaBRT(e.ate)} (${duracao}).\n` +
          'Ate la ela nao responde clientes no WhatsApp: quem escrever fica esperando a equipe no aplicativo. O chat do site continua normal.\n' +
          'Ela volta sozinha no horario. Para voltar antes, mande /carol voltar.',
      ];
    }
    case 'voltar': {
      const antes = retomar({ agora });
      auditar({ evento: 'voltar', de, estavaPausada: antes.ativa });
      if (!antes.ativa) return ['A Carol nao estava pausada. Ela atende normalmente fora do horario comercial (seg-sex, 8h as 18h).'];
      return ['Carol de volta ao atendimento no WhatsApp.'];
    }
    case 'relatorio': {
      return fatiar(await deps.resumoCompacto());
    }
    case 'detalhe': {
      if (!arg) return ['Qual conversa? Mande /carol detalhe <numero da lista> ou /carol detalhe <telefone>.'];
      return fatiar(await deps.detalheConversa(arg));
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
      return [`Palavra-chave atual vale ate ${ate}.\nAutenticados agora: ${autenticados.length ? autenticados.join(', ') : 'ninguem'}.\nAdministradores cadastrados: ${config.admins.length}.\n${textoPausa(estadoPausa({ agora }))}`];
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
  const ehAdmin = ehAdministrador(de, admins);

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
    const arg = argumento(texto);
    auditar({ evento: 'comando', de, sub });
    if (sub === 'ajuda') return { tratado: true, respostas: [AJUDA] };
    if (e.autenticadoAte > t) {
      let respostas;
      try {
        respostas = await executar(sub, arg, execDeps, de);
      } catch (err) {
        console.error('[comandos] falha ao executar', sub, err);
        respostas = [`Nao consegui executar "${sub}" agora: ${String(err.message).slice(0, 200)}`];
      }
      return { tratado: true, respostas };
    }
    e.pendente = { sub, arg };
    e.pendenteAte = t + PENDENTE_MS;
    return { tratado: true, respostas: ['Qual e a palavra-chave desta semana?'] };
  }

  if (e.pendente && e.pendenteAte > t) {
    const ok = validarChave(texto);
    e.falhas = e.falhas.filter((f) => t - f < JANELA_FALHAS_MS);
    if (ok) {
      const { sub, arg } = e.pendente;
      e.pendente = null;
      e.autenticadoAte = t + AUTENTICADO_MS;
      e.falhas = [];
      auditar({ evento: 'chave_ok', de, sub });
      let respostas;
      try {
        respostas = await executar(sub, arg, execDeps, de);
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
  ultimoAvisoSilencio.clear();
}
