// Parâmetros da memória de conversa da Carol (três camadas: memória de
// trabalho, episódios e ficha do cliente). Tudo configurável por variável de
// ambiente; os padrões são a regra combinada com o dono.

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

function num(nome, padrao) {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

export const MEMORIA = {
  // Memória de trabalho (mensagens cruas) some 24h depois da última mensagem
  trabalhoTtlMs: 24 * HORA,
  // A partir deste intervalo a mensagem nova abre OUTRA conversa (retomada)
  gapNovaConversaMs: 12 * HORA,
  // Conversa parada há este tempo vira episódio (resumo do Haiku)
  episodioOciosoMs: num('CAROL_EPISODIO_OCIOSO_MIN', 120) * MIN,
  // Episódios ficam completos por N dias; depois só a ficha
  contextoDias: num('CAROL_CONTEXTO_DIAS', 7),
  // Ficha apagada depois de N dias sem contato
  fichaDias: num('CAROL_FICHA_DIAS', 180),
  // Registro JSONL diário apagado depois de N dias (o painel usa no máximo 90)
  registroDias: num('CAROL_REGISTRO_DIAS', 90),
  // Acima disto, as mensagens antigas viram resumo parcial; ficam as N recentes cruas
  maxMensagens: 30,
  mensagensCruas: 20,
  // Listas da ficha (máquinas, peças, preferências) cortadas neste tamanho
  maxItensLista: 20,
  // Teto do bloco "Memória do cliente" injetado no contexto (~4 caracteres por token)
  tetoTokens: 1500,
  episodiosNoContexto: 3,
  // Modelo barato para resumos de memória
  modelo: process.env.CAROL_MODELO_MEMORIA || 'claude-haiku-4-5',
  // De quanto em quanto tempo o job procura conversas ociosas para fechar
  intervaloFechamentoMs: num('CAROL_EPISODIO_INTERVALO_MIN', 10) * MIN,
  // Banco fora: tenta de novo depois deste tempo (enquanto isso, adaptador local)
  pausaDegradeMs: 60 * 1000,
  // Marca de processamento do fechamento (outra instância pode pegar depois disto)
  travaFechamentoMs: 10 * MIN,
};

export const TEMPO = { MIN, HORA, DIA };
