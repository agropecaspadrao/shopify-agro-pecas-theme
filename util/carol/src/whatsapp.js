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

async function graphPost(caminho, payload) {
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
    throw new Error(`Graph API ${res.status}: ${erro.slice(0, 500)}`);
  }
  return res.json();
}

export async function enviarTexto(para, corpo) {
  return graphPost(`${config.waPhoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'text',
    text: { preview_url: true, body: corpo.slice(0, 4000) },
  });
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
