import { config } from './config.js';
import { carolAtende, emExpediente, proximaMudanca, descreverExpediente, textoQuando, obterHorario } from './horarioConfig.js';

const fmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: config.timezone,
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function partes(data = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(data).map((x) => [x.type, x.value]));
  return {
    diaSemana: p.weekday, // "segunda-feira" ... "domingo"
    hora: Number(p.hour),
    texto: `${p.weekday}, ${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute} (horário de Brasília)`,
  };
}

// "Horário comercial" aqui significa "a Carol deve ficar em silêncio no
// WhatsApp" (a equipe humana atende). A regra vem do painel (horarioConfig.js):
// 24h, só fora do expediente (padrão antigo), só no expediente ou janelas
// personalizadas. O chat do site não consulta esta função: é 24h sempre.
export function horarioComercial(data = new Date(), cfg = obterHorario()) {
  return !carolAtende(data, cfg);
}

/** Janela de expediente da equipe humana, independente de quem responde. */
export function expedienteDai(data = new Date(), cfg = obterHorario()) {
  return emExpediente(data, cfg);
}

export function contextoHorario(data = new Date(), cfg = obterHorario()) {
  const { texto, hora } = partes(data);
  const dentro = horarioComercial(data, cfg);
  const saudacao = hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite';
  const exp = descreverExpediente(cfg);
  const t = new Date(data).getTime();
  const noExpediente = expedienteDai(data, cfg);
  const retorno = noExpediente ? null : proximaMudanca(data, { cfg, tipo: 'expediente' });
  const quandoVolta = retorno ? textoQuando(retorno.em, t) : 'no próximo dia útil';

  let situacao;
  if (dentro) {
    // Carol em silêncio no WhatsApp: quem responde por lá é a equipe.
    situacao = noExpediente
      ? `Agora é ${texto}. Estamos DENTRO do horário comercial (${exp}): a atendente humana Dai está disponível no WhatsApp.`
      : `Agora é ${texto}. Neste horário o WhatsApp é atendido pela equipe humana (Dai), não pela Carol. Expediente da equipe: ${exp}; a equipe retorna ${quandoVolta}.`;
  } else if (noExpediente) {
    situacao = `Agora é ${texto}. A Carol atende o WhatsApp neste horário; a equipe comercial (Dai) está em expediente (${exp}) e assume os atendimentos que precisarem de negociação ou orçamento.`;
  } else {
    situacao = `Agora é ${texto}. Estamos FORA do horário comercial (${exp}): a Carol é quem atende. A equipe comercial (Dai) retorna ${quandoVolta} para negociação e orçamentos.`;
  }
  return {
    dentro,
    saudacao,
    texto: `${situacao} Saudação correta para este horário: "${saudacao}".`,
  };
}

/**
 * Quando a equipe responde, para as mensagens fixas ao cliente (áudio,
 * mídia, contingência), seguindo a regra em vigor em vez de "seg a sex, 8h
 * às 18h" fixo. Ex.: "em seguida" (no expediente) ou "a partir de amanhã às
 * 08:00 (expediente: segunda a sexta, 8h às 18h)".
 */
export function quandoEquipeResponde(data = new Date(), cfg = obterHorario()) {
  if (expedienteDai(data, cfg)) return 'em seguida';
  const volta = proximaMudanca(data, { cfg, tipo: 'expediente' });
  const exp = descreverExpediente(cfg);
  return volta ? `a partir de ${textoQuando(volta.em, new Date(data).getTime())} (expediente: ${exp})` : `no próximo expediente (${exp})`;
}
