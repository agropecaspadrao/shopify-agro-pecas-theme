// Métricas da máquina vistas pelo Railway (CPU e memória do serviço nas
// últimas 24h), pela API GraphQL pública. Opcional: só liga com
// RAILWAY_API_TOKEN; RAILWAY_SERVICE_ID e RAILWAY_ENVIRONMENT_ID o próprio
// Railway injeta no runtime.
//
// Token de projeto → header Project-Access-Token; token de conta/workspace →
// Authorization: Bearer (RAILWAY_TOKEN_TIPO=projeto|conta, padrão projeto).
//
// O Railway agrega por minuto: cache de 60 s no servidor (vale também para
// falha, para não martelar a API) e falha silenciosa — o painel mostra
// "métricas do Railway indisponíveis" e segue funcionando.

export const URL_RAILWAY = 'https://backboard.railway.com/graphql/v2';
export const CACHE_MS = 60 * 1000;
const AMOSTRA_S = 600; // 10 min → 144 pontos em 24h

const QUERY = `query metricas($serviceId: String!, $environmentId: String!, $startDate: DateTime!, $endDate: DateTime, $sampleRateSeconds: Int, $measurements: [MetricMeasurement!]!) {
  metrics(serviceId: $serviceId, environmentId: $environmentId, startDate: $startDate, endDate: $endDate, sampleRateSeconds: $sampleRateSeconds, measurements: $measurements) {
    measurement
    values { ts value }
  }
}`;

export function configRailway(env = process.env) {
  return {
    token: env.RAILWAY_API_TOKEN || '',
    tipo: (env.RAILWAY_TOKEN_TIPO || 'projeto').toLowerCase() === 'conta' ? 'conta' : 'projeto',
    serviceId: env.RAILWAY_SERVICE_ID || '',
    environmentId: env.RAILWAY_ENVIRONMENT_ID || '',
  };
}

function tsMs(ts) {
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : NaN;
}

function pico(pontos) {
  let p = null;
  for (const [t, v] of pontos) if (!p || v > p.valor) p = { em: t, valor: v };
  return p;
}

/** Converte a resposta da API no formato compacto do painel. */
export function resumirMetricas(lista) {
  const por = {};
  for (const m of lista || []) {
    por[m.measurement] = (m.values || [])
      .map((v) => [tsMs(v.ts), Number(v.value)])
      .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
      .sort((a, b) => a[0] - b[0]);
  }
  // CPU vem em vCPU (0,25 = um quarto de núcleo) → % de um núcleo; memória em GB → MB
  const cpu = (por.CPU_USAGE || []).map(([t, v]) => [t, Math.round(v * 1000) / 10]);
  const mem = (por.MEMORY_USAGE_GB || []).map(([t, v]) => [t, Math.round(v * 1024)]);
  const soma = (k) => Math.round((por[k] || []).reduce((s, [, v]) => s + v, 0) * 1024 * 10) / 10;
  return {
    cpu,
    memoria: mem,
    picoCpu: pico(cpu),
    picoMemoria: pico(mem),
    redeEntradaMB: soma('NETWORK_RX_GB'),
    redeSaidaMB: soma('NETWORK_TX_GB'),
  };
}

/**
 * Cria o leitor com cache. @returns {() => Promise<object>} sempre resolve
 * (nunca rejeita): { disponivel, motivo?, ...métricas, atualizadoEm }
 */
export function criarMetricasRailway({ fetchFn = (...a) => fetch(...a), agora = Date.now, env = process.env } = {}) {
  let cache = null; // { em, valor }
  let emVoo = null;

  async function buscar() {
    const cfg = configRailway(env);
    if (!cfg.token || !cfg.serviceId || !cfg.environmentId) {
      return { disponivel: false, motivo: 'métricas do Railway não configuradas (RAILWAY_API_TOKEN)' };
    }
    const fim = agora();
    const headers = { 'content-type': 'application/json' };
    if (cfg.tipo === 'conta') headers.authorization = `Bearer ${cfg.token}`;
    else headers['project-access-token'] = cfg.token;
    try {
      const res = await fetchFn(URL_RAILWAY, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: QUERY,
          variables: {
            serviceId: cfg.serviceId,
            environmentId: cfg.environmentId,
            startDate: new Date(fim - 24 * 3600 * 1000).toISOString(),
            endDate: new Date(fim).toISOString(),
            sampleRateSeconds: AMOSTRA_S,
            measurements: ['CPU_USAGE', 'MEMORY_USAGE_GB', 'NETWORK_RX_GB', 'NETWORK_TX_GB'],
          },
        }),
        signal: AbortSignal.timeout(10000),
      });
      const corpo = await res.json().catch(() => null);
      if (!res.ok || !corpo || corpo.errors?.length || !Array.isArray(corpo.data?.metrics)) {
        const det = corpo?.errors?.[0]?.message || `HTTP ${res.status}`;
        console.warn(`[railway] métricas indisponíveis: ${String(det).slice(0, 200)}`);
        return { disponivel: false, motivo: 'métricas do Railway indisponíveis' };
      }
      return { disponivel: true, ...resumirMetricas(corpo.data.metrics) };
    } catch (e) {
      console.warn(`[railway] métricas indisponíveis: ${e.message}`);
      return { disponivel: false, motivo: 'métricas do Railway indisponíveis' };
    }
  }

  return async function metricasRailway() {
    const t = agora();
    if (cache && t - cache.em < CACHE_MS) return cache.valor;
    if (!emVoo) {
      emVoo = buscar()
        .then((v) => {
          const valor = { ...v, atualizadoEm: new Date(agora()).toISOString() };
          // falha depois de um sucesso: mantém os dados antigos, marcados como desatualizados
          cache = { em: agora(), valor: !v.disponivel && cache?.valor?.disponivel ? { ...cache.valor, desatualizado: true } : valor };
          return cache.valor;
        })
        .finally(() => {
          emVoo = null;
        });
    }
    return emVoo;
  };
}
