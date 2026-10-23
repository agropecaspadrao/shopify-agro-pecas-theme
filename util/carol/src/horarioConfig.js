// Horário de atendimento da Carol no WhatsApp, editável pelo SDR (seção Carol,
// via PUT /admin/api/horario). A origem 'painel' identifica a regra salva por lá.
//
// Antes a regra vinha só do ambiente (CAROL_24H, CAROL_HORA_INICIO/FIM). Agora
// fica em DATA_DIR/horario.json (volume do Railway) e o ambiente vira apenas o
// valor inicial, usado enquanto ninguém salvou nada pelo painel.
//
// Dois conceitos separados:
//   - expediente: quando a equipe humana (Dai) trabalha. Usado no texto que vai
//     para o Claude ("a equipe retorna segunda às 8h") e no preset padrão.
//   - quando a Carol atende: escolhido por um preset ou por janelas próprias.
//
// Janelas: { dias: [0..6] (0 = domingo), inicio: 'HH:MM', fim: 'HH:MM' }.
// Se fim <= inicio a janela cruza a meia-noite: começa no dia listado e termina
// no dia seguinte (ex.: seg 18:00 → ter 08:00). '24:00' vale como fim do dia.
// Fuso: config.timezone (America/Sao_Paulo, sem horário de verão desde 2019),
// por isso a aritmética em minutos locais é segura.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { DATA_DIR } from './registro.js';
import { gravarJsonAtomico, lerJson } from './util/arquivo.js';

const ARQUIVO = path.join(DATA_DIR, 'horario.json');
export const MODOS = ['24h', 'fora_expediente', 'expediente', 'personalizado'];
export const MAX_JANELAS = 14;
const MIN_DIA = 1440;

export const PRESETS = {
  '24h': { rotulo: '24 horas', descricao: 'A Carol responde o WhatsApp a qualquer hora, todos os dias.' },
  fora_expediente: { rotulo: 'Só fora do expediente', descricao: 'A Carol responde quando a equipe não está (noite e fins de semana). No expediente, a Dai atende.' },
  expediente: { rotulo: 'Só no expediente', descricao: 'A Carol responde apenas durante o expediente. Fora dele, ninguém responde automaticamente.' },
  personalizado: { rotulo: 'Personalizado', descricao: 'Você escolhe os dias e horários em que a Carol responde.' },
};

const NOMES_DIA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function hhmm(h) {
  const n = Math.min(Math.max(Math.floor(Number(h) || 0), 0), 24);
  return `${String(n).padStart(2, '0')}:00`;
}

/** Configuração inicial derivada do ambiente (comportamento anterior ao painel). */
export function configPadrao() {
  return {
    versao: 1,
    modo: config.atende24h ? '24h' : 'fora_expediente',
    expediente: { dias: [1, 2, 3, 4, 5], inicio: hhmm(config.businessHourStart), fim: hhmm(config.businessHourEnd) },
    janelas: [
      { dias: [1, 2, 3, 4, 5], inicio: hhmm(config.businessHourEnd), fim: hhmm(config.businessHourStart) },
      { dias: [0, 6], inicio: '00:00', fim: '24:00' },
    ],
    atualizadoEm: null,
    atualizadoPor: null,
  };
}

// ── Validação ─────────────────────────────────────────────────────────────
const HORA_RE = /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

export function paraMinutos(hora) {
  if (hora === '24:00') return MIN_DIA;
  const m = String(hora).match(HORA_RE);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function validarJanela(j, rotulo, erros) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    erros.push(`${rotulo}: formato inválido`);
    return null;
  }
  const dias = Array.isArray(j.dias) ? j.dias : [];
  const diasOk = [...new Set(dias.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (!diasOk.length || diasOk.length !== dias.length) erros.push(`${rotulo}: escolha ao menos um dia (0 = domingo a 6 = sábado), sem repetir`);
  const inicio = String(j.inicio ?? '');
  const fim = String(j.fim ?? '');
  if (!HORA_RE.test(inicio) || inicio === '24:00') erros.push(`${rotulo}: horário de início inválido (use HH:MM, ex. 08:00)`);
  if (!HORA_RE.test(fim)) erros.push(`${rotulo}: horário de fim inválido (use HH:MM, ex. 18:00 ou 24:00)`);
  if (HORA_RE.test(inicio) && HORA_RE.test(fim) && paraMinutos(inicio) % MIN_DIA === paraMinutos(fim) % MIN_DIA) {
    erros.push(`${rotulo}: início e fim iguais; para o dia inteiro use 00:00 até 24:00`);
  }
  return { dias: diasOk, inicio, fim };
}

/**
 * Valida e normaliza a configuração vinda do painel. Campos desconhecidos são
 * descartados. @returns {{ok:boolean, erros:string[], config?:object}}
 */
export function validarHorario(entrada) {
  const erros = [];
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return { ok: false, erros: ['configuração ausente'] };
  const modo = String(entrada.modo || '');
  if (!MODOS.includes(modo)) erros.push(`modo inválido (use ${MODOS.join(', ')})`);
  const expediente = validarJanela(entrada.expediente, 'Expediente da equipe', erros);
  const brutas = entrada.janelas == null ? [] : entrada.janelas;
  if (!Array.isArray(brutas)) erros.push('janelas: precisa ser uma lista');
  const lista = Array.isArray(brutas) ? brutas : [];
  if (lista.length > MAX_JANELAS) erros.push(`no máximo ${MAX_JANELAS} janelas`);
  const janelas = lista.slice(0, MAX_JANELAS).map((j, i) => validarJanela(j, `Janela ${i + 1}`, erros)).filter(Boolean);
  if (modo === 'personalizado' && !janelas.length) erros.push('no modo personalizado, cadastre ao menos uma janela');
  if (erros.length) return { ok: false, erros };
  return { ok: true, erros: [], config: { versao: 1, modo, expediente, janelas } };
}

// ── Persistência ──────────────────────────────────────────────────────────
let cache = null;

/**
 * Configuração em vigor (arquivo salvo pelo painel ou padrão do ambiente).
 * `origem` diz de onde veio: 'painel' (DATA_DIR/horario.json; as variáveis
 * CAROL_24H/CAROL_HORA_* ficam SEM efeito) ou 'variavel' (ambiente).
 */
export function obterHorario() {
  if (cache) return cache;
  const salvo = lerJson(ARQUIVO);
  const v = salvo ? validarHorario(salvo) : null;
  if (salvo && !v.ok) console.warn(`[horario] ${ARQUIVO} inválido (${v.erros.join('; ')}); usando o padrão do ambiente`);
  cache = v?.ok ? { ...v.config, atualizadoEm: salvo.atualizadoEm || null, atualizadoPor: salvo.atualizadoPor || null, origem: 'painel' } : { ...configPadrao(), origem: 'variavel' };
  if (cache.origem === 'painel' && process.env.CAROL_24H && (cache.modo === '24h') !== config.atende24h) {
    console.warn(`[horario] CAROL_24H=${process.env.CAROL_24H} está sendo IGNORADA: vale a regra salva pelo SDR (${descreverRegra(cache)}). Para voltar à variável, use "Voltar ao padrão do servidor" no SDR → Carol (DELETE /admin/api/horario).`);
  }
  return cache;
}

/** Texto curto da origem da regra, para painel, /health e /carol status. */
export function descreverOrigem(cfg = obterHorario()) {
  if (cfg.origem === 'painel') return `definida no SDR (seção Carol)${cfg.atualizadoEm ? ` em ${new Date(cfg.atualizadoEm).toLocaleString('pt-BR', { timeZone: config.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''} (as variáveis CAROL_24H/CAROL_HORA_* do servidor não têm efeito)`;
  return 'padrão do servidor (variáveis CAROL_24H/CAROL_HORA_INICIO/CAROL_HORA_FIM)';
}

/** Apaga a regra do painel: volta a valer o ambiente. */
export function restaurarPadraoHorario() {
  try {
    fs.unlinkSync(ARQUIVO);
  } catch {}
  cache = null;
  const cfg = obterHorario();
  console.log(`[horario] regra do painel removida; vale o padrão do servidor: ${descreverRegra(cfg)}`);
  return cfg;
}

/** Valida, grava de forma atômica e passa a valer na hora. Lança se inválida. */
export function salvarHorario(entrada, { por = null, agora = Date.now } = {}) {
  const v = validarHorario(entrada);
  if (!v.ok) {
    const e = new Error(v.erros.join('; '));
    e.erros = v.erros;
    e.status = 400;
    throw e;
  }
  const final = { ...v.config, atualizadoEm: new Date(agora()).toISOString(), atualizadoPor: por ? String(por).slice(0, 60) : null };
  gravarJsonAtomico(ARQUIVO, final);
  cache = { ...final, origem: 'painel' };
  console.log(`[horario] nova regra: ${descreverRegra(final)}${por ? ` (por ${por})` : ''}`);
  return cache;
}

/** Só para testes: esquece o cache em memória. */
export function recarregarHorario() {
  cache = null;
  return obterHorario();
}

// ── Avaliação ─────────────────────────────────────────────────────────────
const fmtPartes = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DIA_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana (0 = domingo) e minuto do dia no fuso da loja. */
export function partesLocal(data = new Date()) {
  const p = Object.fromEntries(fmtPartes.formatToParts(new Date(data)).map((x) => [x.type, x.value]));
  return { dia: DIA_EN[p.weekday], min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

export function dentroJanela(j, dia, min) {
  const ini = paraMinutos(j.inicio);
  const fim = paraMinutos(j.fim);
  if (ini < fim) return j.dias.includes(dia) && min >= ini && min < fim;
  // cruza a meia-noite: [ini, 24:00) no dia listado + [00:00, fim) no dia seguinte
  return (j.dias.includes(dia) && min >= ini) || (j.dias.includes((dia + 6) % 7) && min < fim);
}

function avaliarLocal(cfg, tipo, dia, min) {
  const exp = dentroJanela(cfg.expediente, dia, min);
  if (tipo === 'expediente') return exp;
  switch (cfg.modo) {
    case '24h':
      return true;
    case 'expediente':
      return exp;
    case 'personalizado':
      return cfg.janelas.some((j) => dentroJanela(j, dia, min));
    default:
      return !exp; // fora_expediente
  }
}

/** A Carol responde o WhatsApp neste instante (ignora a pausa manual)? */
export function carolAtende(data = new Date(), cfg = obterHorario()) {
  const { dia, min } = partesLocal(data);
  return avaliarLocal(cfg, 'carol', dia, min);
}

/** A equipe humana está em expediente neste instante? */
export function emExpediente(data = new Date(), cfg = obterHorario()) {
  const { dia, min } = partesLocal(data);
  return avaliarLocal(cfg, 'expediente', dia, min);
}

/**
 * Próximo instante em que a regra muda de valor (minuto a minuto, em
 * aritmética local, até 8 dias à frente). @returns {{em:number, valor:boolean}|null}
 */
export function proximaMudanca(data = new Date(), { cfg = obterHorario(), tipo = 'carol' } = {}) {
  const t = new Date(data).getTime();
  const inicioMinuto = t - (t % 60000);
  let { dia, min } = partesLocal(t);
  const atual = avaliarLocal(cfg, tipo, dia, min);
  for (let k = 1; k <= 8 * MIN_DIA; k++) {
    min++;
    if (min >= MIN_DIA) {
      min = 0;
      dia = (dia + 1) % 7;
    }
    const v = avaliarLocal(cfg, tipo, dia, min);
    if (v !== atual) return { em: inicioMinuto + k * 60000, valor: v };
  }
  return null;
}

// ── Textos ────────────────────────────────────────────────────────────────
function horaTexto(hora) {
  const [h, m] = hora.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

/** [1,2,3,4,5] → "segunda a sexta"; [0,6] → "sábado e domingo". */
export function descreverDias(dias) {
  const d = [...dias].sort((a, b) => a - b);
  if (d.length === 7) return 'todos os dias';
  // começa a semana na segunda para "segunda a domingo" ficar natural
  const ord = d.map((x) => (x === 0 ? 7 : x)).sort((a, b) => a - b);
  const nome = (x) => NOMES_DIA[x % 7].replace('-feira', '');
  const grupos = [];
  for (const x of ord) {
    const g = grupos[grupos.length - 1];
    if (g && x === g[g.length - 1] + 1) g.push(x);
    else grupos.push([x]);
  }
  const partes = grupos.flatMap((g) => (g.length >= 3 ? [`${nome(g[0])} a ${nome(g[g.length - 1])}`] : g.map(nome)));
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0];
}

export function descreverJanela(j) {
  if (j.inicio === '00:00' && j.fim === '24:00') return `${descreverDias(j.dias)}, dia inteiro`;
  const cruza = paraMinutos(j.fim) <= paraMinutos(j.inicio);
  return `${descreverDias(j.dias)}, ${horaTexto(j.inicio)} às ${horaTexto(j.fim)}${cruza ? ' do dia seguinte' : ''}`;
}

export function descreverExpediente(cfg = obterHorario()) {
  return descreverJanela(cfg.expediente);
}

/** Frase curta da regra em vigor, para painel, logs e avisos. */
export function descreverRegra(cfg = obterHorario()) {
  switch (cfg.modo) {
    case '24h':
      return 'a Carol atende 24 horas';
    case 'expediente':
      return `a Carol atende só no expediente (${descreverExpediente(cfg)})`;
    case 'personalizado':
      return `a Carol atende em: ${cfg.janelas.map(descreverJanela).join('; ')}`;
    default:
      return `a Carol atende fora do expediente da equipe (${descreverExpediente(cfg)})`;
  }
}

const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "hoje às 18:00", "amanhã às 08:00", "segunda-feira às 08:00". */
export function textoQuando(em, agora = Date.now()) {
  const hora = fmtHora.format(new Date(em));
  const diaEm = fmtDia.format(new Date(em));
  if (diaEm === fmtDia.format(new Date(agora))) return `hoje às ${hora}`;
  if (diaEm === fmtDia.format(new Date(agora + 86400000))) return `amanhã às ${hora}`;
  return `${NOMES_DIA[partesLocal(em).dia]} às ${hora}`;
}

export { NOMES_DIA };
