import { config } from './config.js';

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

const DIAS_UTEIS = new Set(['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira']);

// "Horário comercial" aqui significa "a Dai está atendendo e a Carol deve
// ficar em silêncio". Com CAROL_24H=1 esse intervalo deixa de existir: a Carol
// responde sempre, e a Dai acompanha pelo SDR os atendimentos que esquentam.
export function horarioComercial(data = new Date()) {
  if (config.atende24h) return false;
  const { diaSemana, hora } = partes(data);
  return DIAS_UTEIS.has(diaSemana) && hora >= config.businessHourStart && hora < config.businessHourEnd;
}

/** Janela de expediente da equipe humana, independente de quem responde. */
export function expedienteDai(data = new Date()) {
  const { diaSemana, hora } = partes(data);
  return DIAS_UTEIS.has(diaSemana) && hora >= config.businessHourStart && hora < config.businessHourEnd;
}

export function contextoHorario(data = new Date()) {
  const { texto, hora } = partes(data);
  const dentro = horarioComercial(data);
  const saudacao = hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite';
  let situacao;
  if (config.atende24h) {
    situacao = expedienteDai(data)
      ? `Agora é ${texto}. A Carol atende o WhatsApp em qualquer horário; a equipe comercial (Dai) está em expediente (segunda a sexta, 8h às 18h) e assume os atendimentos que precisarem de negociação ou orçamento.`
      : `Agora é ${texto}. A Carol atende o WhatsApp em qualquer horário; a equipe comercial (Dai) retorna no próximo dia útil a partir das 8h para negociação e orçamentos.`;
  } else {
    situacao = dentro
      ? `Agora é ${texto}. Estamos DENTRO do horário comercial (segunda a sexta, 8h às 18h): a atendente humana Dai está disponível no WhatsApp.`
      : `Agora é ${texto}. Estamos FORA do horário comercial (segunda a sexta, 8h às 18h): a Carol é quem atende. A Dai retorna no próximo dia útil a partir das 8h.`;
  }
  return {
    dentro,
    saudacao,
    texto: `${situacao} Saudação correta para este horário: "${saudacao}".`,
  };
}
