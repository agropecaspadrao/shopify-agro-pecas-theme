import crypto from 'node:crypto';
import { config } from './config.js';

const GRAPH = `https://graph.facebook.com/${config.graphVersion}`;

// Dedupe de entregas do webhook (a Meta reenvia em caso de timeout)
const vistos = new Set();
function jaProcessada(id) {
  if (!id) return false;
  if (vistos.has(id)) return true;
  vistos.add(id);
  if (vistos.size > 2000) {
    for (const v of vistos) {
      vistos.delete(v);
      if (vistos.size <= 1000) break;
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
  if (!assinatura || !assinatura.startsWith('sha256=')) return false;
  const esperada = crypto.createHmac('sha256', config.metaAppSecret).update(rawBody).digest('hex');
  const recebida = assinatura.slice('sha256='.length);
  try {
    return crypto.timingSafeEqual(Buffer.from(esperada, 'hex'), Buffer.from(recebida, 'hex'));
  } catch {
    return false;
  }
}

/** Extrai mensagens de texto recebidas do payload do webhook. */
export function extrairMensagens(body) {
  const saida = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      const nomes = new Map((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const msg of value.messages || []) {
        if (jaProcessada(msg.id)) continue;
        saida.push({
          id: msg.id,
          de: msg.from,
          nome: nomes.get(msg.from) || null,
          tipo: msg.type,
          texto: msg.type === 'text' ? msg.text?.body || '' : '',
          midiaId: msg.audio?.id || null,
          midiaMime: msg.audio?.mime_type || null,
          // Anúncio click-to-WhatsApp: a Meta manda título/corpo do anúncio
          anuncio: msg.referral
            ? {
                titulo: msg.referral.headline || '',
                corpo: msg.referral.body || '',
                url: msg.referral.source_url || '',
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

let reservaTentada = false;

async function graphPost(caminho, payload, { tentativa = 1 } = {}) {
  const res = await fetch(`${GRAPH}/${caminho}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.waAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
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
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function aguardarVez(para) {
  const agora = Date.now();
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
    console.warn(`[whatsapp] limite de rajada da Meta para ${para} (131056); repetindo em ${ESPERA_LIMITE_MS / 1000}s`);
    await dormir(ESPERA_LIMITE_MS);
    proximaVez.set(para, Date.now() + ESPACO_MS);
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
  });
  if (!meta.ok) throw new Error(`Graph mídia ${meta.status}: ${(await meta.text().catch(() => '')).slice(0, 300)}`);
  const { url, mime_type: mime } = await meta.json();

  const arquivo = await fetch(url, {
    headers: { authorization: `Bearer ${config.waAccessToken}` },
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
