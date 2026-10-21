// Chat do widget do site: POST /api/chat e POST /api/resumo.
//
// Custo/DoS: limites por janela curta (em memória) e tetos diários
// persistentes (util/tetoDiario.js, dia do calendário em São Paulo, valem
// depois de deploy). IPv6 conta por /64. Quando o teto global do dia passa de
// 80%, só sessões que já conversaram hoje continuam (quem começou um
// atendimento termina; poucos IPs não esgotam o dia para todo mundo).

import express from 'express';
import { sanitizarEntrada } from '../util/marcadores.js';
import { chaveIp } from '../util/ip.js';

export const SESSAO_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const RESERVA_GLOBAL = 0.8;

export const TEXTOS_SITE = {
  muitas: 'Recebemos muitas mensagens seguidas. Aguarde alguns minutos e tente novamente, por favor.',
  teto: 'Nosso atendimento automático atingiu o limite de hoje. Chame a gente no WhatsApp (41) 98415-1085 que respondemos por lá!',
  instabilidade: 'Tivemos uma instabilidade agora. Tente novamente em instantes ou chame no WhatsApp (41) 98415-1085.',
};

/**
 * @param {object} d
 * @param {Function} d.responder (sessao, texto, canal) → texto (já registra)
 * @param {Function} d.resumirConversa
 * @param {{sessao10min:Function, ip10min:Function, resumoIp:Function}} d.limites janelas curtas (util/limite.js)
 * @param {{contar:Function, uso:Function}} d.tetos tetos diários persistentes
 * @param {{global:number, ipDia:number, sessaoDia:number}} d.maximos
 */
export function criarRotasChat(d) {
  const router = express.Router();
  const medir = d.medir || ((_c, fn) => fn());

  router.post('/chat', async (req, res) => {
    const { sessionId, message } = req.body || {};
    try {
      if (typeof sessionId !== 'string' || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'sessionId e message são obrigatórios' });
      }
      if (!SESSAO_RE.test(sessionId)) return res.status(400).json({ error: 'sessionId inválido' });
      if (message.length > 2000) return res.status(400).json({ error: 'mensagem muito longa' });
      const ip = chaveIp(req.ip);
      if (!d.limites.sessao10min(sessionId) || !d.limites.ip10min(ip)) return res.status(429).json({ reply: TEXTOS_SITE.muitas });

      // Tetos do dia: sessão já ativa hoje passa na reserva final de 20%
      const jaConversouHoje = d.tetos.uso('site_sessao', sessionId) > 0;
      const usoGlobal = d.tetos.uso('site');
      if (usoGlobal >= d.maximos.global * RESERVA_GLOBAL && !jaConversouHoje) {
        console.warn('[api/chat] teto global acima de 80%: só sessões que já conversaram hoje');
        return res.status(429).json({ reply: TEXTOS_SITE.teto });
      }
      if (!d.tetos.contar('site_ip', ip, d.maximos.ipDia) || !d.tetos.contar('site_sessao', sessionId, d.maximos.sessaoDia)) {
        return res.status(429).json({ reply: TEXTOS_SITE.muitas });
      }
      if (!d.tetos.contar('site', '*', d.maximos.global)) {
        console.error('[api/chat] teto diário global do site atingido — recusando novas mensagens');
        return res.status(429).json({ reply: TEXTOS_SITE.teto });
      }

      const texto = sanitizarEntrada(message);
      if (!texto) return res.status(400).json({ error: 'mensagem vazia' });
      try {
        const reply = await medir('site', () => d.responder(`site:${sessionId}`, texto, 'site'));
        return res.json({ reply });
      } catch (e) {
        // IA fora: o visitante recebe a instabilidade e o turno fica registrado como falha
        const cls = d.classificarErro(e, 'site');
        console.error('[api/chat] erro:', e.message);
        d.reportarAnomalia(cls).catch(() => {});
        d.registrar({ canal: 'site', sessao: `site:${sessionId}`, tipo: 'falha', erro: cls.tipo, mensagem: texto, resposta: TEXTOS_SITE.instabilidade });
        return res.status(500).json({ reply: TEXTOS_SITE.instabilidade });
      }
    } catch (e) {
      console.error('[api/chat] erro:', e.message);
      return res.status(500).json({ reply: TEXTOS_SITE.instabilidade });
    }
  });

  // Resumo da conversa do widget para levar de contexto ao WhatsApp
  router.post('/resumo', async (req, res) => {
    try {
      const { sessionId } = req.body || {};
      if (typeof sessionId !== 'string' || !SESSAO_RE.test(sessionId)) return res.status(400).json({ error: 'sessionId inválido' });
      if (!d.limites.resumoIp(chaveIp(req.ip))) return res.status(429).json({ resumo: null });
      res.json({ resumo: await d.resumirConversa(`site:${sessionId}`) });
    } catch (e) {
      console.error('[api/resumo] erro:', e.message);
      res.json({ resumo: null });
    }
  });

  return router;
}
