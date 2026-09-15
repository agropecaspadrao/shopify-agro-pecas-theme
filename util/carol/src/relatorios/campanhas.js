// Resumo das campanhas de Meta Ads (Facebook/Instagram) para o relatório dos
// sócios: investimento, cliques, conversas de WhatsApp iniciadas e leads,
// ontem e nos últimos 7 dias, mais a lista de campanhas ativas.
//
// Requer META_ACCESS_TOKEN com ads_read e META_AD_ACCOUNT_ID (com ou sem o
// prefixo act_). Sem isso, devolve { configurado: false } e o relatório
// informa que o bloco não está ligado.

import { config } from '../config.js';

const GRAPH = () => `https://graph.facebook.com/${config.graphVersion}`;

function contaId() {
  const id = String(config.saude.metaAdAccountId || '').trim();
  return id ? (id.startsWith('act_') ? id : `act_${id}`) : '';
}

function brl(v) {
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
}

function acao(actions, ...tipos) {
  let n = 0;
  for (const a of actions || []) if (tipos.includes(a.action_type)) n += Number(a.value || 0);
  return n;
}

function consolidar(insight) {
  if (!insight) return null;
  const a = insight.actions;
  return {
    gasto: Number(insight.spend || 0),
    impressoes: Number(insight.impressions || 0),
    cliques: Number(insight.clicks || 0),
    ctr: Number(insight.ctr || 0),
    cpc: Number(insight.cpc || 0),
    conversas: acao(a, 'onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'),
    leads: acao(a, 'lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'),
    cliquesLink: acao(a, 'link_click'),
  };
}

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(20000) });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph ${res.status}: ${corpo?.error?.message || ''}`);
  return corpo;
}

export async function resumoCampanhasMeta({ fetchFn = fetch } = {}) {
  const token = config.saude.metaAccessToken;
  const conta = contaId();
  if (!token || !conta) return { configurado: false, motivo: 'META_ACCESS_TOKEN e META_AD_ACCOUNT_ID não configurados' };

  const campos = 'spend,impressions,clicks,ctr,cpc,actions';
  const q = (preset) => `${GRAPH()}/${conta}/insights?fields=${campos}&date_preset=${preset}&access_token=${encodeURIComponent(token)}`;
  try {
    const [ontem, semana, campanhas] = await Promise.all([
      getJson(fetchFn, q('yesterday')),
      getJson(fetchFn, q('last_7d')),
      getJson(fetchFn, `${GRAPH()}/${conta}/campaigns?fields=name,effective_status,daily_budget,insights.date_preset(last_7d){spend,actions,clicks}&effective_status=["ACTIVE"]&limit=25&access_token=${encodeURIComponent(token)}`),
    ]);
    return {
      configurado: true,
      ontem: consolidar(ontem.data?.[0]),
      semana: consolidar(semana.data?.[0]),
      ativas: (campanhas.data || []).map((c) => {
        const i = consolidar(c.insights?.data?.[0]);
        return { nome: c.name, orcamentoDia: c.daily_budget ? Number(c.daily_budget) / 100 : null, gasto7d: i?.gasto || 0, conversas7d: i?.conversas || 0, leads7d: i?.leads || 0, cliques7d: i?.cliques || 0 };
      }),
    };
  } catch (e) {
    return { configurado: true, erro: e.message };
  }
}

export function textoCampanhas(r) {
  if (!r?.configurado) return `Campanhas Meta: bloco não configurado (${r?.motivo || 'sem credenciais'}).`;
  if (r.erro) return `Campanhas Meta: não consegui consultar (${r.erro}).`;
  const linha = (rot, d) =>
    d
      ? `${rot}: investimento ${brl(d.gasto)}, ${d.impressoes} impressões, ${d.cliques} cliques (CTR ${d.ctr.toFixed(2)}%, CPC ${brl(d.cpc)}), ${d.conversas} conversas no WhatsApp, ${d.leads} leads`
      : `${rot}: sem dados`;
  const linhas = [linha('Ontem', r.ontem), linha('Últimos 7 dias', r.semana), ''];
  if (r.ativas.length) {
    linhas.push(`Campanhas ativas (${r.ativas.length}):`);
    for (const c of r.ativas) {
      linhas.push(`- ${c.nome}: ${c.orcamentoDia ? `${brl(c.orcamentoDia)}/dia, ` : ''}${brl(c.gasto7d)} em 7d, ${c.conversas7d} conversas, ${c.leads7d} leads`);
    }
  } else {
    linhas.push('Nenhuma campanha ativa no momento.');
  }
  if (r.semana && r.semana.gasto > 0 && r.semana.conversas + r.semana.leads === 0) {
    linhas.push('', 'ATENÇÃO: houve investimento na semana sem nenhuma conversa ou lead atribuído. Vale revisar segmentação ou criativos.');
  }
  return linhas.join('\n');
}
