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

export function horarioComercial(data = new Date()) {
  const { diaSemana, hora } = partes(data);
  return DIAS_UTEIS.has(diaSemana) && hora >= config.businessHourStart && hora < config.businessHourEnd;
}

export function contextoHorario(data = new Date()) {
  const { texto, hora } = partes(data);
  const dentro = horarioComercial(data);
  const saudacao = hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite';
  return {
    dentro,
    saudacao,
    texto: (dentro
      ? `Agora é ${texto}. Estamos DENTRO do horário comercial (segunda a sexta, 8h às 18h): a atendente humana Dai está disponível no WhatsApp.`
      : `Agora é ${texto}. Estamos FORA do horário comercial (segunda a sexta, 8h às 18h): a Carol é quem atende. A Dai retorna no próximo dia útil a partir das 8h.`)
      + ` Saudação correta para este horário: "${saudacao}".`,
  };
}
