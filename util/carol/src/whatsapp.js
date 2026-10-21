import crypto from 'node:crypto';
import { config } from './config.js';
import { mascararTelefone } from './util/telefone.js';

const GRAPH = `https://graph.facebook.com/${config.graphVersion}`;
const TIMEOUT_MS = 20000;

// Dedupe de entregas do webhook por id da mensagem (a Meta reenvia em caso de
// timeout e o messenger do SDR repete o mesmo corpo quando recebe 5xx/408/429).
// Memória com TTL de 24h e teto de chaves; feito na extração, antes da fila
// por telefone, então vale também para mensagens agrupadas.
export const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VISTOS = 20000;
const vistos = new Map(); // id -> visto em (ms)
function jaProcessada(id, agora = Date.now()) {
  if (!id) return false;
  const t = vistos.get(id);
  if (t && agora - t < DEDUPE_TTL_MS) return true;
  vistos.set(id, agora);
  if (vistos.size > MAX_VISTOS) {
    for (const [k, v] of vistos) {
      if (agora - v >= DEDUPE_TTL_MS || vistos.size > MAX_VISTOS / 2) vistos.delete(k);
      else break;
    }
  }
  return false;
}

export function verificarAssinatura(rawBody, assinatura) {
  if (!config.metaAppSecret) {
    // Fail-closed: sem o app secret não há como validar a origem — rejeita tudo
    console.error('[whatsapp] META_APP_SECRET ausente — webhook rejeitado (fail-closed)');
    return false;
  }
  // Corpo cru obrigatório: sem ele (ou corpo vazio) não há o que assinar
  if (!Buffer.isBuffer(rawBody) || !rawBody.length) return false;
  if (typeof assinatura !== 'string' || !assinatura.startsWith('sha256=')) return false;
  const esperada = crypto.createHmac('sha256', config.metaAppSecret).update(rawBody).digest('hex');
  const recebida = assinatura.slice('sha256='.length);
  try {
    return crypto.timingSafeEqual(Buffer.from(esperada, 'hex'), Buffer.from(recebida, 'hex'));
  } catch {
    return false;
  }
}

/** Texto de uma mensagem, conforme o tipo (texto, botão, resposta de lista). */
function textoDe(msg) {
  if (msg.type === 'text') return msg.text?.body || '';
  if (msg.type === 'button') return msg.button?.text || '';
  if (msg.type === 'interactive') return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
  return '';
}

/** Eco de mensagem que a equipe digitou no app (modo coexistência). */
function eco(msg, numeroLoja) {
  return {
    eco: true,
    id: msg.id,
    de: msg.from || numeroLoja || '',
    para: msg.to || '',
    tipo: msg.type,
    texto: textoDe(msg) || (msg.type && msg.type !== 'text' ? `(${msg.type} enviado pela equipe)` : ''),
    timestamp: Number(msg.timestamp || 0) * 1000,
  };
}

/**
 * Extrai do payload do webhook:
 *   - mensagens recebidas de clientes (field "messages");
 *   - ecos das respostas que a equipe digita no app do WhatsApp Business no
 *     modo coexistência (field "smb_message_echoes", value.message_echoes[]
 *     com from = número da loja e to = cliente). Ecos vêm com `eco: true` e
 *     NUNCA podem disparar resposta da Carol. Tolerante: mensagem em
 *     "messages" vinda do próprio número da loja também é tratada como eco.
 */
export function extrairMensagens(body, { numeroLoja = process.env.WA_BUSINESS_NUMBER || '', agora = Date.now() } = {}) {
  const saida = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const loja = String(value.metadata?.display_phone_number || numeroLoja || '').replace(/\D/g, '');
      if (change.field === 'smb_message_echoes' || Array.isArray(value.message_echoes)) {
        for (const msg of value.message_echoes || value.messages || []) {
          if (jaProcessada(msg.id, agora)) continue;
          saida.push(eco(msg, loja));
        }
        continue;
      }
      if (change.field !== 'messages') continue;
      const nomes = new Map((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const msg of value.messages || []) {
        if (jaProcessada(msg.id, agora)) continue;
        if (loja && msg.from === loja && msg.to) {
          saida.push(eco(msg, loja));
          continue;
        }
        saida.push({
          id: msg.id,
          de: msg.from,
          nome: nomes.get(msg.from) || null,
          tipo: msg.type,
          texto: textoDe(msg),
          midiaId: msg.audio?.id || null,
          midiaMime: msg.audio?.mime_type || null,
          // Anúncio click-to-WhatsApp: a Meta manda título/corpo do anúncio
          anuncio: msg.referral
            ? {
                titulo: msg.referral.headline || '',
                corpo: msg.referral.body || '',
                url: msg.referral.source_url || '',
                // identificação do anúncio para a origem do lead no SDR
                sourceType: msg.referral.source_type || '',
                sourceId: msg.referral.source_id || '',
                ctwaClid: msg.referral.ctwa_clid || '',
              }
            : null,
          // Consulta vinda de um produto do catálogo (vitrine do WhatsApp)
          produtoCatalogo: msg.context?.referred_product?.product_retailer_id || null,
          timestamp: Number(msg.timestamp || 0) * 1000,
        });
      }
    }
  }
  return saida;
}

/** Só para testes: esquece os ids já vistos. */
export function _limparVistos() {
  vistos.clear();
}

let reservaTentada = false;

async function graphPost(caminho, payload, { tentativa = 1 } = {}) {
  const res = await fetch(`${GRAPH}/${caminho}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.waAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const erro = await res.text().catch(() => '');
    // Auto-recovery no primeiro 401: se há token reserva e ainda não foi
    // usado, troca em tempo de execução e repete uma vez. O supervisor de
    // saúde faz o mesmo a cada meia hora; aqui é para não perder a mensagem
    // que está na mão.
    if (res.status === 401 && tentativa === 1 && !reservaTentada && config.waAccessTokenFallback && config.waAccessTokenFallback !== config.waAccessToken) {
      reservaTentada = true;
      const { definirTokenWhatsApp } = await import('./config.js');
      definirTokenWhatsApp(config.waAccessTokenFallback);
      console.warn('[whatsapp] 401 no token principal; tentando o token reserva');
      const r = await graphPost(caminho, payload, { tentativa: 2 });
      import('./alertas/anomalias.js')
        .then(({ reportarAnomalia }) =>
          reportarAnomalia({ tipo: 'recuperacao_automatica', titulo: 'Recuperação automática: WhatsApp', detalhe: 'Token principal recusado (401). A Carol ativou o token reserva e a mensagem foi entregue. Atualize WA_ACCESS_TOKEN no Railway.' })
        )
        .catch(() => {});
      return r;
    }
    const e = new Error(`Graph API ${res.status}: ${erro.slice(0, 500)}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// Espaçamento por destinatário. A Meta recusa rajadas de mensagens para o
// mesmo telefone (erro 131056, "pair rate limit hit"): aconteceu com clientes
// que mandam muitas mensagens seguidas e com relatórios fatiados para os
// administradores. Cada número tem uma "vez" reservada em sequência; se
// mesmo assim a Meta recusar, espera e repete uma única vez.
const ESPACO_MS = Number(process.env.WA_ESPACO_MS || 2000);
const ESPERA_LIMITE_MS = Number(process.env.WA_ESPERA_LIMITE_MS || 6000);
const proximaVez = new Map(); // numero -> timestamp em que o próximo envio pode sair
// Relógio injetável (testes determinísticos, sem depender do tempo real)
const relogio = { agora: () => Date.now(), dormir: (ms) => new Promise((r) => setTimeout(r, ms)) };
const dormir = (ms) => relogio.dormir(ms);

/** Só para testes: troca o relógio ({ agora, dormir }); sem argumento volta ao real. */
export function _definirRelogio(r) {
  relogio.agora = r?.agora || (() => Date.now());
  relogio.dormir = r?.dormir || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  proximaVez.clear();
}

async function aguardarVez(para) {
  const agora = relogio.agora();
  const vez = Math.max(proximaVez.get(para) || 0, agora);
  proximaVez.set(para, vez + ESPACO_MS);
  if (proximaVez.size > 5000) proximaVez.clear();
  if (vez > agora) await dormir(vez - agora);
}

export function ehLimiteDeRajada(erro) {
  return /131056/.test(String(erro?.message || erro || ''));
}

export async function enviarTexto(para, corpo) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'text',
    text: { preview_url: true, body: corpo.slice(0, 4000) },
  };
  await aguardarVez(para);
  try {
    return await graphPost(`${config.waPhoneNumberId}/messages`, payload);
  } catch (e) {
    if (!ehLimiteDeRajada(e)) throw e;
    console.warn(`[whatsapp] limite de rajada da Meta para ${mascararTelefone(para)} (131056); repetindo em ${ESPERA_LIMITE_MS / 1000}s`);
    await dormir(ESPERA_LIMITE_MS);
    proximaVez.set(para, relogio.agora() + ESPACO_MS);
    return graphPost(`${config.waPhoneNumberId}/messages`, payload);
  }
}

/**
 * Baixa uma mídia recebida (áudio) da Cloud API: primeiro busca a URL
 * temporária pelo id da mídia, depois baixa o binário autenticado.
 */
export async function baixarMidia(midiaId) {
  const meta = await fetch(`${GRAPH}/${midiaId}`, {
    headers: { authorization: `Bearer ${config.waAccessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!meta.ok) throw new Error(`Graph mídia ${meta.status}: ${(await meta.text().catch(() => '')).slice(0, 300)}`);
  const { url, mime_type: mime } = await meta.json();

  const arquivo = await fetch(url, {
    headers: { authorization: `Bearer ${config.waAccessToken}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!arquivo.ok) throw new Error(`download mídia ${arquivo.status}`);
  return { buffer: Buffer.from(await arquivo.arrayBuffer()), mime: mime || 'audio/ogg' };
}

export async function marcarComoLida(mensagemId) {
  try {
    await graphPost(`${config.waPhoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: mensagemId,
    });
  } catch (e) {
    console.warn('[whatsapp] falha ao marcar como lida:', e.message);
  }
}
