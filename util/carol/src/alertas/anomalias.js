// Central de anomalias: tudo que dá errado na Carol passa por aqui.
//
// Princípios (SRE): (1) alerta por sintoma com deduplicação por tipo, para
// não afogar a caixa de entrada; (2) mais de um canal, e-mail primeiro e
// WhatsApp dos administradores de reserva; (3) tudo fica registrado em disco,
// mesmo o que foi suprimido, para o relatório dos sócios e o painel /admin.
//
// Severidade define o assunto e a janela de deduplicação:
//   critica → "Urgente Carol: ..."  (repete no máximo a cada 1h)
//   alta    → "Urgente Carol: ..."  (a cada 6h)
//   media   → "Carol: atenção: ..." (a cada 24h)

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { DATA_DIR } from '../registro.js';
import { enviar as enviarEmailPadrao } from '../email/transporte.js';

const ARQUIVO = path.join(DATA_DIR, 'anomalias.json');
const MAX_HISTORICO = 300;

export const JANELA_MS = {
  critica: 60 * 60 * 1000,
  alta: 6 * 60 * 60 * 1000,
  media: 24 * 60 * 60 * 1000,
};

/** Catálogo de tipos conhecidos: severidade padrão e orientação para quem lê. */
export const TIPOS = {
  whatsapp_token_invalido: {
    severidade: 'critica',
    titulo: 'WhatsApp parou de responder (token inválido ou expirado)',
    acao: 'Gerar um token permanente no Meta Business (Usuário do Sistema) e atualizar WA_ACCESS_TOKEN no Railway. Enquanto isso a Carol tenta o token reserva.',
  },
  whatsapp_token_expira: {
    severidade: 'alta',
    titulo: 'Token do WhatsApp expira em breve',
    acao: 'Trocar o token antes da data limite para a Carol não ficar muda.',
  },
  whatsapp_envio_falhou: {
    severidade: 'alta',
    titulo: 'Falha ao enviar mensagem no WhatsApp',
    acao: 'Conferir o token e a saúde da Cloud API no Meta Business.',
  },
  anthropic_chave: {
    severidade: 'critica',
    titulo: 'Chave da API da Anthropic recusada',
    acao: 'Conferir ANTHROPIC_API_KEY no Railway e no console.anthropic.com.',
  },
  anthropic_credito: {
    severidade: 'critica',
    titulo: 'Crédito da Anthropic acabou',
    acao: 'Recarregar em console.anthropic.com > Plans & Billing e atualizar CAROL_CREDITO_USD e CAROL_CREDITO_DESDE.',
  },
  anthropic_api: {
    severidade: 'alta',
    titulo: 'API da Anthropic instável',
    acao: 'Normalmente passa sozinho. Se persistir por mais de 1h, ver status.anthropic.com.',
  },
  anthropic_saldo_baixo: {
    severidade: 'media',
    titulo: 'Saldo de créditos da Anthropic baixo',
    acao: 'Recarregar em console.anthropic.com > Plans & Billing antes que zere. Depois atualizar CAROL_CREDITO_USD e CAROL_CREDITO_DESDE no Railway.',
  },
  meta_token_invalido: {
    severidade: 'alta',
    titulo: 'Token da Meta (Ads e páginas) inválido',
    acao: 'Gerar novo token no Meta Business e atualizar META_ACCESS_TOKEN.',
  },
  google_token_invalido: {
    severidade: 'alta',
    titulo: 'Acesso ao Google Ads expirou',
    acao: 'Refazer a autorização OAuth e atualizar GOOGLE_ADS_REFRESH_TOKEN.',
  },
  catalogo_falha: {
    severidade: 'alta',
    titulo: 'Catálogo da loja não carregou',
    acao: 'A Carol segue com a última cópia boa. Conferir se agropecaspadrao.com.br/products.json responde.',
  },
  email_falha: {
    severidade: 'media',
    titulo: 'Envio de e-mail falhou',
    acao: 'Conferir RESEND_API_KEY ou BREVO_API_KEY e o remetente verificado no provedor.',
  },
  webhook_erro: {
    severidade: 'alta',
    titulo: 'Erro ao processar mensagem do WhatsApp',
    acao: 'Ver o detalhe abaixo e os logs do Railway.',
  },
  site_erro: {
    severidade: 'alta',
    titulo: 'Erro ao atender pelo chat do site',
    acao: 'Ver o detalhe abaixo e os logs do Railway.',
  },
  seguranca_tentativas: {
    severidade: 'alta',
    titulo: 'Tentativas repetidas de usar comandos da Carol com palavra-chave errada',
    acao: 'Se não foi um dos sócios, considerar rotacionar a palavra-chave (/admin/chave/rotacionar).',
  },
  disco_falha: {
    severidade: 'critica',
    titulo: 'Não consigo gravar no disco de dados',
    acao: 'Conferir o volume do Railway montado em /app/data.',
  },
  inventario_desatualizado: {
    severidade: 'media',
    titulo: 'Inventário da loja sem atualização há muitos dias',
    acao: 'Conferir se a sincronização planilha > Shopify está rodando.',
  },
  master_desatualizada: {
    severidade: 'media',
    titulo: 'Planilha master sem edição há muitos dias',
    acao: 'Informativo. Conferir se a rotina de atualização está ativa.',
  },
  agenda_atrasada: {
    severidade: 'media',
    titulo: 'Tarefa agendada rodou com atraso',
    acao: 'O serviço ficou fora do ar na hora prevista. Ver histórico de deploys no Railway.',
  },
  recuperacao_automatica: {
    severidade: 'alta',
    titulo: 'A Carol se recuperou sozinha de uma falha',
    acao: 'Nenhuma ação imediata. Ver o detalhe para corrigir a causa em definitivo.',
  },
  saude_falha: {
    severidade: 'alta',
    titulo: 'Verificação de saúde apontou problema',
    acao: 'Ver o detalhe abaixo.',
  },
};

function carregar() {
  try {
    const d = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    return { ultimos: d.ultimos || {}, historico: d.historico || [] };
  } catch {
    return { ultimos: {}, historico: [] };
  }
}

function salvar(estado) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify(estado));
  } catch (e) {
    console.error('[anomalias] não consegui persistir o estado:', e.message);
  }
}

/**
 * Classifica um erro em um tipo de anomalia. Cobre Graph API (WhatsApp/Meta),
 * SDK da Anthropic e falhas genéricas de rede.
 */
export function classificarErro(erro, contexto = 'webhook') {
  const msg = String(erro?.message || erro || '');
  const status = erro?.status || erro?.statusCode || Number((msg.match(/\b(4\d\d|5\d\d)\b/) || [])[1]) || 0;
  const corpo = String(erro?.error?.error?.message || erro?.error?.message || msg).toLowerCase();

  if (/graph api/i.test(msg) || /"code"\s*:\s*190/.test(msg) || /oauthexception/i.test(msg)) {
    if (status === 401 || /code"\s*:\s*190|access token|session has expired|expired on/.test(corpo)) {
      return { tipo: 'whatsapp_token_invalido', detalhe: msg.slice(0, 600) };
    }
    return { tipo: 'whatsapp_envio_falhou', detalhe: msg.slice(0, 600) };
  }
  if (/anthropic|authentication_error|invalid x-api-key|credit balance|overloaded|rate_limit/i.test(corpo) || erro?.constructor?.name?.includes('Anthropic') || erro?.name?.includes('Anthropic')) {
    if (status === 401 || /authentication|invalid x-api-key/.test(corpo)) return { tipo: 'anthropic_chave', detalhe: msg.slice(0, 600) };
    if (/credit balance|billing/.test(corpo)) return { tipo: 'anthropic_credito', detalhe: msg.slice(0, 600) };
    return { tipo: 'anthropic_api', detalhe: msg.slice(0, 600) };
  }
  if (erro?.name === 'BadRequestError' && /credit/.test(corpo)) return { tipo: 'anthropic_credito', detalhe: msg.slice(0, 600) };
  if (erro?.name === 'AuthenticationError') return { tipo: 'anthropic_chave', detalhe: msg.slice(0, 600) };
  if (['RateLimitError', 'InternalServerError', 'APIConnectionError', 'APIConnectionTimeoutError', 'OverloadedError'].includes(erro?.name)) {
    return { tipo: 'anthropic_api', detalhe: msg.slice(0, 600) };
  }
  if (/ENOSPC|EROFS|EACCES/.test(msg)) return { tipo: 'disco_falha', detalhe: msg.slice(0, 600) };
  return { tipo: contexto === 'site' ? 'site_erro' : 'webhook_erro', detalhe: msg.slice(0, 600) };
}

function assuntoPara(severidade, titulo) {
  return severidade === 'media' ? `Carol: atenção: ${titulo}` : `Urgente Carol: ${titulo}`;
}

function corpoEmail({ tipo, titulo, detalhe, severidade, quando, recuperado }) {
  const info = TIPOS[tipo] || {};
  const quandoTxt = new Date(quando).toLocaleString('pt-BR', { timeZone: config.timezone });
  return [
    recuperado ? 'Boa notícia: um problema anterior foi resolvido.' : 'A Carol detectou um problema e precisa de atenção.',
    '',
    `O que aconteceu: ${titulo}`,
    `Gravidade: ${severidade}`,
    `Quando: ${quandoTxt} (Brasília)`,
    `Código do evento: ${tipo}`,
    '',
    detalhe ? `Detalhe técnico:\n${detalhe}` : '',
    '',
    info.acao ? `O que fazer: ${info.acao}` : '',
    '',
    'Painel: /admin/saude e /admin/anomalias no serviço da Carol (com a chave de administrador).',
    '',
    'Esta mensagem é automática. Anomalias do mesmo tipo são agrupadas para não repetir o aviso a cada minuto.',
    'Carol, agente de monitoramento',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

function textoWhatsApp({ titulo, severidade, detalhe, tipo }) {
  const info = TIPOS[tipo] || {};
  return (
    `*${severidade === 'media' ? 'Carol: atenção' : 'Urgente Carol'}*\n\n` +
    `${titulo}\n` +
    (detalhe ? `\nDetalhe: ${detalhe.slice(0, 500)}\n` : '') +
    (info.acao ? `\nO que fazer: ${info.acao}` : '')
  ).slice(0, 3900);
}

/**
 * Reporta uma anomalia. Deduplica por tipo dentro da janela da severidade,
 * grava no histórico e envia por e-mail e WhatsApp.
 * @param {{tipo:string, titulo?:string, detalhe?:string, severidade?:'critica'|'alta'|'media', forcar?:boolean, recuperado?:boolean}} ev
 * @param {{enviarEmail?:Function, enviarWhatsApp?:Function, agora?:()=>number}} deps injeção para testes
 */
export async function reportarAnomalia(ev, deps = {}) {
  const agora = deps.agora ? deps.agora() : Date.now();
  const info = TIPOS[ev.tipo] || {};
  const severidade = ev.severidade || info.severidade || 'alta';
  const titulo = ev.titulo || info.titulo || ev.tipo;
  const detalhe = String(ev.detalhe || '').slice(0, 2000);

  const estado = carregar();
  const ultimo = estado.ultimos[ev.tipo] || 0;
  const suprimida = !ev.forcar && agora - ultimo < (JANELA_MS[severidade] || JANELA_MS.alta);

  const registro = { ts: new Date(agora).toISOString(), tipo: ev.tipo, severidade, titulo, detalhe, suprimida, recuperado: Boolean(ev.recuperado), canais: {} };
  estado.historico.push(registro);
  if (estado.historico.length > MAX_HISTORICO) estado.historico.splice(0, estado.historico.length - MAX_HISTORICO);

  if (suprimida) {
    salvar(estado);
    console.warn(`[anomalias] ${ev.tipo} (suprimida, já avisada há menos de ${Math.round((JANELA_MS[severidade] || 0) / 3600000)}h): ${titulo}`);
    return { enviada: false, suprimida: true, registro };
  }

  estado.ultimos[ev.tipo] = agora;
  salvar(estado);
  console.error(`[anomalias] ${severidade.toUpperCase()} ${ev.tipo}: ${titulo}${detalhe ? ' | ' + detalhe.slice(0, 200) : ''}`);

  const enviarEmail = deps.enviarEmail || enviarEmailPadrao;
  const enviarWhatsApp = deps.enviarWhatsApp || (async (numero, texto) => {
    const { enviarTexto } = await import('../whatsapp.js');
    return enviarTexto(numero, texto);
  });
  const destinatariosEmail = deps.destinatariosEmail || config.destinatarios.alertas;
  const admins = deps.admins || config.admins;

  const payload = { tipo: ev.tipo, titulo, detalhe, severidade, quando: agora, recuperado: ev.recuperado };

  try {
    if (!destinatariosEmail.length) throw new Error('sem destinatários de alerta');
    await enviarEmail({ para: destinatariosEmail, assunto: assuntoPara(severidade, titulo), texto: corpoEmail(payload) });
    registro.canais.email = true;
  } catch (e) {
    registro.canais.email = false;
    registro.canais.emailErro = e.message.slice(0, 300);
    console.warn('[anomalias] e-mail de alerta falhou:', e.message);
  }

  // WhatsApp para os administradores. Se o próprio WhatsApp é a falha, isto
  // também vai falhar; o histórico fica com o registro e o e-mail já foi.
  if (admins.length && ev.tipo !== 'whatsapp_token_invalido') {
    let ok = 0;
    for (const numero of admins) {
      try {
        await enviarWhatsApp(numero, textoWhatsApp(payload));
        ok++;
      } catch (e) {
        console.warn(`[anomalias] WhatsApp para ${numero} falhou:`, e.message);
      }
    }
    registro.canais.whatsapp = ok > 0;
  }

  // atualiza o registro com o resultado dos canais
  const est2 = carregar();
  const idx = est2.historico.findIndex((h) => h.ts === registro.ts && h.tipo === registro.tipo);
  if (idx >= 0) est2.historico[idx] = registro;
  salvar(est2);

  return { enviada: Boolean(registro.canais.email || registro.canais.whatsapp), suprimida: false, registro };
}

/** Anomalias das últimas N horas (mais recentes primeiro). */
export function listarAnomalias(horas = 24) {
  const corte = Date.now() - horas * 3600000;
  return carregar()
    .historico.filter((h) => new Date(h.ts).getTime() >= corte)
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

/** Resumo para relatórios: contagem por severidade e lista dos tipos abertos. */
export function resumoAnomalias(horas = 24) {
  const lista = listarAnomalias(horas);
  const porTipo = new Map();
  for (const a of lista) {
    const t = porTipo.get(a.tipo) || { tipo: a.tipo, titulo: a.titulo, severidade: a.severidade, ocorrencias: 0, ultima: a.ts, recuperado: false };
    t.ocorrencias++;
    if (a.recuperado) t.recuperado = true;
    porTipo.set(a.tipo, t);
  }
  const tipos = [...porTipo.values()];
  return {
    total: lista.length,
    criticas: tipos.filter((t) => t.severidade === 'critica' && !t.recuperado).length,
    altas: tipos.filter((t) => t.severidade === 'alta' && !t.recuperado).length,
    medias: tipos.filter((t) => t.severidade === 'media' && !t.recuperado).length,
    tipos,
  };
}

/** Só para testes e manutenção: apaga o estado persistido. */
export function limparAnomalias() {
  try {
    fs.unlinkSync(ARQUIVO);
  } catch {}
}
