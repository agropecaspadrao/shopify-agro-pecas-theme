// Agregação dos dados de operação da Carol para a API de administração
// (/admin/api/*, consumida pela seção Carol do SDR): junta pausa + horário
// (quem atende agora), atendimento do dia, máquina, saúde e Railway.
//
// Dois ritmos, para o portal não pesar:
//   estado()   → polling de 5 s; JSON pequeno (< 5 KB), cache de 4 s no
//                servidor para N abas abertas não multiplicarem o trabalho
//   detalhes() → a cada 60 s; picos por hora, heatmap, saúde, Railway 24h

import { DATA_DIR } from '../registro.js';
import { estadoPausa } from '../comandos/pausa.js';
import { obterHorario, carolAtende, emExpediente, proximaMudanca, textoQuando, descreverRegra, descreverExpediente, descreverOrigem } from '../horarioConfig.js';
import { statusCredito } from '../gasto.js';
import { resumoAnomalias as resumoAnomaliasPadrao } from '../alertas/anomalias.js';
import { ultimoEstado as ultimoEstadoPadrao } from '../saude/supervisor.js';
import { criarLeitor, resumoAtendimento, criarPicos } from './atendimento.js';
import { mascararTelefone } from '../util/telefone.js';
import { estadoMaquina, estatisticaRespostas } from './maquina.js';
import { criarMetricasRailway } from './railway.js';

export const CACHE_ESTADO_MS = 4000;
export const CACHE_DETALHES_MS = 55000;

/** Quem atende agora e quando muda. */
export function estadoCarol({ agora = Date.now(), pausa = estadoPausa({ agora: () => agora }), cfg = obterHorario() } = {}) {
  const regra = descreverRegra(cfg);
  const origemRegra = { origem: cfg.origem || 'variavel', modo: cfg.modo, texto: descreverOrigem(cfg) };
  if (pausa.ativa) {
    let proxima = null;
    if (!pausa.indefinida && pausa.ate) {
      const ate = new Date(pausa.ate).getTime();
      proxima = carolAtende(ate, cfg)
        ? { em: ate, texto: `volta a atender ${textoQuando(ate, agora)}` }
        : { em: ate, texto: `o desligamento acaba ${textoQuando(ate, agora)}; nesse horário a regra a deixa em silêncio` };
    }
    return {
      status: 'desligada',
      rotulo: 'DESLIGADA',
      motivo: pausa.indefinida ? 'Desligada até alguém religar.' : 'Desligada por tempo determinado.',
      proxima,
      regra,
      origemRegra,
    };
  }
  const atende = carolAtende(agora, cfg);
  const m = proximaMudanca(agora, { cfg });
  // Fora da regra da Carol E fora do expediente (ex.: modo "só no expediente"
  // à noite): ninguém atende. Não é "silêncio para a Dai".
  const equipe = emExpediente(agora, cfg);
  let rotulo = 'ATENDENDO';
  let motivo = 'A Carol está respondendo os clientes no WhatsApp.';
  if (!atende && equipe) {
    rotulo = 'EM SILÊNCIO (Dai)';
    motivo = `Horário da equipe: a Dai atende o WhatsApp (expediente ${descreverExpediente(cfg)}).`;
  } else if (!atende) {
    rotulo = 'FORA DO HORÁRIO (ninguém atende)';
    motivo = `Fora da regra da Carol e fora do expediente da equipe (${descreverExpediente(cfg)}): as mensagens ficam registradas como pendentes.`;
  }
  return {
    status: atende ? 'atendendo' : 'silencio',
    rotulo,
    motivo,
    proxima: m ? { em: m.em, texto: `${m.valor ? 'volta a atender' : 'fica em silêncio'} ${textoQuando(m.em, agora)}` } : null,
    regra,
    origemRegra,
  };
}

export function criarAgregador({
  dir = DATA_DIR,
  agora = Date.now,
  limites = () => ({}),
  resumoAnomalias = resumoAnomaliasPadrao,
  ultimoEstadoSaude = ultimoEstadoPadrao,
  metricasRailway = criarMetricasRailway(),
} = {}) {
  const leitor = criarLeitor();
  const picos = criarPicos({ dir });
  let cacheEstado = null;
  let cacheDetalhes = null;
  let ultimoResumo = null;

  function atendimento(t) {
    ultimoResumo = resumoAtendimento({ leitor, dir, agora: t });
    return ultimoResumo;
  }

  function estado() {
    const t = agora();
    if (cacheEstado && t - cacheEstado.em < CACHE_ESTADO_MS) return cacheEstado.valor;
    const pausa = estadoPausa({ agora: () => t });
    const at = atendimento(t);
    const resp = estatisticaRespostas(at.inicioDia);
    let anomalias = { abertas: 0, criticas: 0, hoje: 0 };
    try {
      const r = resumoAnomalias(24);
      const abertas = r.tipos.filter((x) => !x.recuperado);
      anomalias = {
        abertas: abertas.length,
        criticas: abertas.filter((x) => x.severidade === 'critica').length,
        hoje: r.tipos.filter((x) => Date.parse(x.ultima) >= at.inicioDia).reduce((s, x) => s + x.ocorrencias, 0),
      };
    } catch {}
    const valor = {
      ts: t,
      carol: estadoCarol({ agora: t, pausa }),
      pausa: { ativa: pausa.ativa, indefinida: Boolean(pausa.indefinida), ate: pausa.ate || null, desde: pausa.desde || null, por: pausa.por ? (/^\d+$/.test(pausa.por) ? mascararTelefone(pausa.por) : String(pausa.por).slice(0, 30)) : null },
      atendimento: {
        ativas: at.ativas,
        mensagensHoje: at.mensagensHoje,
        clientesHoje: at.clientesHoje,
        porCanal: at.porCanal,
        respostaMediaMs: resp.mediaMs,
        respostaP90Ms: resp.p90Ms,
        respostasMedidas: resp.medidas,
        respondendoAgora: resp.emAndamento,
        falhasHoje: resp.falhas,
        semRespostaHoje: at.semRespostaHoje,
        respostasEquipeHoje: at.respostasEquipeHoje,
        anomalias,
      },
      ultimas: at.ultimas,
      limites: limites(),
      credito: statusCredito(),
      maquina: estadoMaquina(),
    };
    cacheEstado = { em: t, valor };
    return valor;
  }

  async function detalhes() {
    const t = agora();
    if (cacheDetalhes && t - cacheDetalhes.em < CACHE_DETALHES_MS) return cacheDetalhes.valor;
    const at = ultimoResumo && t - (cacheEstado?.em || 0) < CACHE_ESTADO_MS ? ultimoResumo : atendimento(t);
    let p = null;
    try {
      p = picos({ porHoraHoje: at.porHora, agora: t });
    } catch (e) {
      console.warn('[admin] picos indisponíveis:', e.message);
    }
    let saude = null;
    try {
      const s = ultimoEstadoSaude();
      if (s) saude = { geral: s.geral, ts: s.ts, itens: (s.resultados || []).map((r) => ({ nome: r.nome, estado: r.estado, resumo: String(r.resumo || '').slice(0, 140) })) };
    } catch {}
    let anomalias = [];
    try {
      anomalias = resumoAnomalias(24)
        .tipos.filter((x) => !x.recuperado)
        .slice(0, 8)
        .map((x) => ({ titulo: x.titulo, severidade: x.severidade, ocorrencias: x.ocorrencias, ultima: x.ultima }));
    } catch {}
    let railway;
    try {
      railway = await metricasRailway();
    } catch {
      railway = { disponivel: false, motivo: 'métricas do Railway indisponíveis' };
    }
    const valor = { ts: t, picos: p, saude, anomalias, railway };
    cacheDetalhes = { em: t, valor };
    return valor;
  }

  /** Depois de uma ação (ligar/desligar/horário), o próximo polling vem fresco. */
  function invalidar() {
    cacheEstado = null;
  }

  return { estado, detalhes, invalidar, leitor };
}
