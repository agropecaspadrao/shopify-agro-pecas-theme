import express from 'express';
import { config, validarConfig } from './config.js';
import { horarioComercial } from './horario.js';
import { carregarCatalogo } from './catalogo.js';
import { responder, resumirConversa } from './claude.js';
import { verificarAssinatura, extrairMensagens, enviarTexto, marcarComoLida } from './whatsapp.js';

const NUMERO_LOJA = process.env.WA_BUSINESS_NUMBER || '5541984151085';

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ── CORS para o widget do site ────────────────────────────────────────────
app.use((req, res, next) => {
  const origem = req.headers.origin;
  if (origem && config.allowedOrigins.includes(origem)) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, horarioComercial: horarioComercial() });
});

// ── Webhook Meta: verificação (GET) ───────────────────────────────────────
app.get('/webhook', (req, res) => {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (modo === 'subscribe' && token === config.waVerifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ── Webhook Meta: mensagens (POST) ────────────────────────────────────────
app.post('/webhook', (req, res) => {
  if (!verificarAssinatura(req.rawBody, req.headers['x-hub-signature-256'])) {
    return res.sendStatus(401);
  }
  // Responde 200 imediatamente; processamento segue em background
  res.sendStatus(200);

  const mensagens = extrairMensagens(req.body);
  for (const msg of mensagens) {
    processarWhatsApp(msg).catch((e) => console.error('[webhook] erro ao processar:', e));
  }
});

async function processarWhatsApp(msg) {
  // Ecos / mensagens do próprio número da loja (modo coexistência): ignorar
  if (!msg.de || msg.de === NUMERO_LOJA) return;

  // Horário comercial: a Dai atende pelo aplicativo, a Carol fica em silêncio
  if (horarioComercial()) {
    console.log(`[whatsapp] ${msg.de}: horário comercial, deixando para a Dai`);
    return;
  }

  await marcarComoLida(msg.id);

  if (msg.tipo !== 'text' || !msg.texto.trim()) {
    await enviarTexto(
      msg.de,
      'Olá! Aqui é a Carol, atendente virtual da APP Agro Peças Padrão. No momento consigo responder apenas mensagens de texto. Pode me escrever o que precisa? Se preferir enviar áudio ou foto, a Dai responde no próximo horário comercial, de segunda a sexta das 8h às 18h.'
    );
    return;
  }

  const entrada = msg.nome ? `[Cliente: ${msg.nome}] ${msg.texto}` : msg.texto;
  const resposta = await responder(`wa:${msg.de}`, entrada, 'whatsapp');
  await enviarTexto(msg.de, resposta);
  console.log(`[whatsapp] respondi ${msg.de} (${resposta.length} chars)`);
}

// ── API do widget do site ─────────────────────────────────────────────────
const limites = new Map(); // sessaoId -> { contagem, janelaInicio }
function dentroDoLimite(sessaoId) {
  const agora = Date.now();
  const reg = limites.get(sessaoId) || { contagem: 0, janelaInicio: agora };
  if (agora - reg.janelaInicio > 10 * 60 * 1000) {
    reg.contagem = 0;
    reg.janelaInicio = agora;
  }
  reg.contagem++;
  limites.set(sessaoId, reg);
  return reg.contagem <= 30; // 30 mensagens a cada 10 min por sessão
}

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body || {};
    if (typeof sessionId !== 'string' || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'sessionId e message são obrigatórios' });
    }
    if (sessionId.length > 64 || message.length > 2000) {
      return res.status(400).json({ error: 'mensagem muito longa' });
    }
    if (!dentroDoLimite(sessionId)) {
      return res.status(429).json({
        reply: 'Recebemos muitas mensagens seguidas. Aguarde alguns minutos e tente novamente, por favor.',
      });
    }
    const reply = await responder(`site:${sessionId}`, message.trim(), 'site');
    res.json({ reply });
  } catch (e) {
    console.error('[api/chat] erro:', e);
    res.status(500).json({
      reply:
        'Tivemos uma instabilidade agora. Tente novamente em instantes ou chame no WhatsApp (41) 98415-1085.',
    });
  }
});

// Resumo da conversa do widget para levar de contexto ao WhatsApp
app.post('/api/resumo', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (typeof sessionId !== 'string' || sessionId.length > 64) {
      return res.status(400).json({ error: 'sessionId inválido' });
    }
    const resumo = await resumirConversa(`site:${sessionId}`);
    res.json({ resumo });
  } catch (e) {
    console.error('[api/resumo] erro:', e);
    res.json({ resumo: null });
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────
const faltando = validarConfig({ exigirWhatsApp: false });
if (faltando.length) {
  console.warn('[config] variáveis ausentes:', faltando.join(', '));
}
if (!config.waPhoneNumberId || !config.waVerifyToken) {
  console.warn('[config] WhatsApp não configurado por completo (WA_PHONE_NUMBER_ID / WA_VERIFY_TOKEN). O widget do site funciona mesmo assim.');
}

carregarCatalogo()
  .catch((e) => console.error('[catalogo] falha na carga inicial:', e.message))
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`Carol no ar na porta ${config.port} (horário comercial agora: ${horarioComercial()})`);
    });
  });
