import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, validarConfig, recursosConfigurados } from './config.js';
import { DATA_DIR } from './registro.js';
import { estadoPausa, pausar, retomar, horasDe } from './comandos/pausa.js';
import { horarioComercial } from './horario.js';
import { carregarCatalogo } from './catalogo.js';
import { responder, resumirConversa } from './claude.js';
import { enviarRelatorio, montarRelatorio, resumoCompacto, detalheConversa } from './relatorio.js';
import { verificarAssinatura, extrairMensagens, enviarTexto, marcarComoLida, baixarMidia } from './whatsapp.js';
import { transcreverAudio, transcricaoDisponivel } from './transcricao.js';
import { agregarCustos, exportarAtendimentos } from './custos.js';
import { paginaDashboard } from './dashboard.js';
import { reportarAnomalia, classificarErro, listarAnomalias, resumoAnomalias } from './alertas/anomalias.js';
import { verificarTudo, ultimoEstado, textoSaude, agendarSupervisor } from './saude/supervisor.js';
import { tratarMensagemAdmin, avisoSilencioAdmin } from './comandos/comandos.js';
import { rotacionarEEnviar, estadoChave, precisaRotacionar } from './comandos/chave.js';
import { montarRelatorioSocios, enviarRelatorioSocios } from './relatorios/socios.js';
import * as agenda from './agenda.js';

const NUMERO_LOJA = process.env.WA_BUSINESS_NUMBER || '5541984151085';

const app = express();
app.set('trust proxy', 1); // Railway fica atrás de proxy — req.ip = X-Forwarded-For
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
  const saude = ultimoEstado();
  const pausa = estadoPausa();
  res.json({ ok: true, horarioComercial: horarioComercial(), pausada: pausa.ativa, pausaAte: pausa.ate || null, saude: saude?.geral || 'desconhecida', verificadoEm: saude?.ts || null });
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
    processarWhatsApp(msg).catch((e) => {
      console.error('[webhook] erro ao processar:', e);
      reportarAnomalia(classificarErro(e, 'webhook')).catch(() => {});
    });
  }
});

// Dependências dos comandos "/carol" (injetadas para os testes poderem trocar)
const depsComandos = {
  montarRelatorio,
  resumoCompacto,
  detalheConversa,
  verificarTudo,
  textoSaude,
  enviarRelatorioSocios,
  rotacionarChave: rotacionarEEnviar,
};

// Sócio que escreve texto comum enquanto a Carol está em silêncio recebe um
// aviso curto (no máximo um a cada 12h), para não achar que ela quebrou.
async function avisarSilencioAdmin(de, motivo) {
  const aviso = avisoSilencioAdmin(de, motivo);
  if (!aviso) return;
  try {
    await enviarTexto(de, aviso);
    console.log(`[comandos] avisei o administrador ${de} do silêncio (${motivo})`);
  } catch (e) {
    console.warn(`[comandos] aviso de silêncio para ${de} falhou: ${e.message}`);
  }
}

async function processarWhatsApp(msg) {
  // Ecos / mensagens do próprio número da loja (modo coexistência): ignorar
  if (!msg.de || msg.de === NUMERO_LOJA) return;

  // Comandos de administrador ("/carol ...") valem a qualquer hora, inclusive
  // no horário comercial, e nunca passam pela IA.
  if (msg.tipo === 'text' && msg.texto) {
    const cmd = await tratarMensagemAdmin({ de: msg.de, texto: msg.texto.trim() }, depsComandos);
    if (cmd.tratado) {
      await marcarComoLida(msg.id);
      for (const r of cmd.respostas) await enviarTexto(msg.de, r);
      if (cmd.respostas.length) console.log(`[comandos] respondi ${msg.de} (${cmd.respostas.length} msg)`);
      return;
    }
  }

  // Pausa manual ("/carol pausar"): um sócio assumiu o WhatsApp por um tempo
  const pausa = estadoPausa();
  if (pausa.ativa) {
    console.log(`[whatsapp] ${msg.de}: Carol pausada ate ${pausa.ate}, deixando para a equipe`);
    await avisarSilencioAdmin(msg.de, 'pausa');
    return;
  }

  // Horário comercial: a Dai atende pelo aplicativo, a Carol fica em silêncio
  if (horarioComercial()) {
    console.log(`[whatsapp] ${msg.de}: horário comercial, deixando para a Dai`);
    await avisarSilencioAdmin(msg.de, 'horario');
    return;
  }

  // Teto diário por telefone e global — protege o crédito contra loops/flood.
  // Silêncio ao exceder: a Dai responde no próximo horário comercial.
  if (!limiteWaTelefoneDia(msg.de) || !limiteWaDiaGlobal('wa')) {
    console.warn(`[whatsapp] ${msg.de}: teto diário atingido, mensagem ignorada`);
    return;
  }

  await marcarComoLida(msg.id);

  let texto = msg.tipo === 'text' ? msg.texto.trim() : '';
  let veioDeAudio = false;

  // Mensagem de voz: baixa a mídia da Cloud API e transcreve via Groq
  if (msg.tipo === 'audio' && msg.midiaId && transcricaoDisponivel()) {
    try {
      const { buffer, mime } = await baixarMidia(msg.midiaId);
      texto = (await transcreverAudio(buffer, mime)) || '';
      veioDeAudio = Boolean(texto);
      if (veioDeAudio) console.log(`[whatsapp] áudio de ${msg.de} transcrito (${texto.length} chars)`);
    } catch (e) {
      console.error('[whatsapp] falha na transcrição:', e.message);
    }
  }

  if (!texto) {
    const aviso =
      msg.tipo === 'audio'
        ? 'Olá! Aqui é a Carol, da APP Agro Peças Padrão. Não consegui ouvir seu áudio agora. Pode me escrever em texto o que precisa? Se preferir, a Dai responde seu áudio no próximo horário comercial, de segunda a sexta das 8h às 18h.'
        : 'Olá! Aqui é a Carol, da APP Agro Peças Padrão. No momento consigo responder mensagens de texto e áudio. Pode me escrever o que precisa? Se preferir enviar foto ou documento, a Dai responde no próximo horário comercial, de segunda a sexta das 8h às 18h.';
    await enviarTexto(msg.de, aviso);
    return;
  }

  // Contexto de origem: cliente que chegou por anúncio ou por um produto do
  // catálogo já chega "falando" da peça, mesmo que o texto seja genérico.
  let origem = '';
  if (msg.anuncio) {
    origem += `[Cliente chegou clicando no anúncio "${msg.anuncio.titulo}"${msg.anuncio.corpo ? `, texto do anúncio: "${msg.anuncio.corpo.slice(0, 200)}"` : ''}. Já procure essa peça no catálogo e atenda com base nela.] `;
  }
  if (msg.produtoCatalogo) {
    origem += `[Cliente consultou o produto de código ${msg.produtoCatalogo} na vitrine do WhatsApp.] `;
  }

  // Nome do perfil e texto são controlados pelo remetente — remove colchetes e
  // marcadores de contexto para que não falsifiquem os campos dos relatórios.
  const nomeLimpo = (msg.nome || '').replace(/[\[\]]/g, '').trim();
  const entrada =
    (nomeLimpo ? `[Cliente: ${nomeLimpo}] ` : '') +
    origem +
    (veioDeAudio ? `[Mensagem de voz do cliente, transcrita automaticamente] ` : '') +
    sanitizarMensagemSite(texto);
  const resposta = await responder(`wa:${msg.de}`, entrada, 'whatsapp');
  await enviarTexto(msg.de, resposta);
  console.log(`[whatsapp] respondi ${msg.de} (${resposta.length} chars)`);
}

// ── Limites de uso (anti-abuso / controle de custo) ───────────────────────
function criarLimite(max, janelaMs) {
  const mapa = new Map(); // chave -> { n, inicio }
  return (chave) => {
    const agora = Date.now();
    let reg = mapa.get(chave);
    if (!reg || agora - reg.inicio > janelaMs) {
      reg = { n: 0, inicio: agora };
      mapa.set(chave, reg);
    }
    reg.n++;
    if (mapa.size > 50000) mapa.clear(); // proteção de memória contra flood de chaves
    return reg.n <= max;
  };
}
const DIA_MS = 24 * 60 * 60 * 1000;
const limiteSessao10min = criarLimite(30, 10 * 60 * 1000);
const limiteIp10min = criarLimite(40, 10 * 60 * 1000);
const limiteIpDia = criarLimite(120, DIA_MS);
const limiteResumoIp = criarLimite(10, 10 * 60 * 1000);
const limiteSiteDiaGlobal = criarLimite(Number(process.env.CAROL_MAX_MSGS_SITE_DIA || 400), DIA_MS);
const limiteWaTelefoneDia = criarLimite(Number(process.env.CAROL_MAX_MSGS_WA_TEL_DIA || 40), DIA_MS);
const limiteWaDiaGlobal = criarLimite(Number(process.env.CAROL_MAX_MSGS_WA_DIA || 300), DIA_MS);
const limiteAdminIp = criarLimite(60, 10 * 60 * 1000);

const SESSAO_RE = /^[A-Za-z0-9_-]{16,64}$/;

// Remove marcadores de contexto que o backend usa internamente ("[Cliente: X]",
// "[Cliente chegou clicando no anúncio ...]") — impede que um visitante do site
// falsifique nome/origem nos relatórios e no dashboard.
function sanitizarMensagemSite(m) {
  return m
    .replace(/\[(Cliente:|Cliente chegou clicando no anúncio|Cliente consultou o produto|Mensagem de voz do cliente)[^\]]*\]/gi, '')
    .trim();
}

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body || {};
    if (typeof sessionId !== 'string' || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'sessionId e message são obrigatórios' });
    }
    if (!SESSAO_RE.test(sessionId)) {
      return res.status(400).json({ error: 'sessionId inválido' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'mensagem muito longa' });
    }
    const ip = req.ip || 'sem-ip';
    if (!limiteSessao10min(sessionId) || !limiteIp10min(ip) || !limiteIpDia(ip)) {
      return res.status(429).json({
        reply: 'Recebemos muitas mensagens seguidas. Aguarde alguns minutos e tente novamente, por favor.',
      });
    }
    if (!limiteSiteDiaGlobal('site')) {
      console.error('[api/chat] teto diário global do site atingido — recusando novas mensagens');
      return res.status(429).json({
        reply: 'Nosso atendimento automático atingiu o limite de hoje. Chame a gente no WhatsApp (41) 98415-1085 que respondemos por lá!',
      });
    }
    const texto = sanitizarMensagemSite(message);
    if (!texto) return res.status(400).json({ error: 'mensagem vazia' });
    const reply = await responder(`site:${sessionId}`, texto, 'site');
    res.json({ reply });
  } catch (e) {
    console.error('[api/chat] erro:', e);
    reportarAnomalia(classificarErro(e, 'site')).catch(() => {});
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
    if (typeof sessionId !== 'string' || !SESSAO_RE.test(sessionId)) {
      return res.status(400).json({ error: 'sessionId inválido' });
    }
    if (!limiteResumoIp(req.ip || 'sem-ip')) {
      return res.status(429).json({ resumo: null });
    }
    const resumo = await resumirConversa(`site:${sessionId}`);
    res.json({ resumo });
  } catch (e) {
    console.error('[api/resumo] erro:', e);
    res.json({ resumo: null });
  }
});

// ── Área administrativa (chave CAROL_ADMIN_KEY) ───────────────────────────
// A chave pode vir por header (Authorization: Bearer), cookie (setado no
// primeiro acesso ao dashboard) ou query string (compatibilidade/curl).
const ADMIN_KEY = process.env.CAROL_ADMIN_KEY || '';
function chaveDe(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)carol_key=([^;]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return '';
    }
  }
  return typeof req.query.key === 'string' ? req.query.key : '';
}
function autorizado(req) {
  if (!ADMIN_KEY) return false;
  const recebida = Buffer.from(String(chaveDe(req)));
  const esperada = Buffer.from(ADMIN_KEY);
  return recebida.length === esperada.length && crypto.timingSafeEqual(recebida, esperada);
}
// Middleware: autenticação + limite por IP para toda a área /admin
app.use('/admin', (req, res, next) => {
  if (!limiteAdminIp(req.ip || 'sem-ip')) return res.status(429).json({ erro: 'muitas requisições' });
  if (!autorizado(req)) return res.sendStatus(403);
  next();
});
function erroInterno(res, contexto, e) {
  console.error(`[${contexto}] erro:`, e);
  return res.status(500).type('text/plain').send('Erro interno');
}
function erroJson(res, contexto, e) {
  console.error(`[${contexto}] erro:`, e);
  return res.status(500).json({ erro: 'erro interno', detalhe: String(e?.message || '').slice(0, 200) });
}

// Relatório da Dai:  GET mostra sem enviar · POST envia agora
app.get('/admin/relatorio', async (req, res) => {
  try {
    const { assunto, corpo } = await montarRelatorio();
    res.type('text/plain').send(`ASSUNTO: ${assunto}\n\n${corpo}`);
  } catch (e) {
    erroInterno(res, 'admin/relatorio', e);
  }
});
app.post('/admin/relatorio', async (req, res) => {
  try {
    res.json(await enviarRelatorio());
  } catch (e) {
    erroJson(res, 'admin/relatorio', e);
  }
});

// Relatório executivo dos sócios:  GET prévia · POST envia agora
app.get('/admin/relatorio-socios', async (req, res) => {
  try {
    const { assunto, corpo } = await montarRelatorioSocios();
    res.type('text/plain').send(`ASSUNTO: ${assunto}\n\n${corpo}`);
  } catch (e) {
    erroInterno(res, 'admin/relatorio-socios', e);
  }
});
app.post('/admin/relatorio-socios', async (req, res) => {
  try {
    res.json(await enviarRelatorioSocios());
  } catch (e) {
    erroJson(res, 'admin/relatorio-socios', e);
  }
});

// Saúde:  GET último quadro · POST roda os verificadores agora
app.get('/admin/saude', (req, res) => {
  const estado = ultimoEstado();
  if (req.query.formato === 'txt') return res.type('text/plain').send(textoSaude(estado));
  res.json({ ...(estado || { geral: 'desconhecida', resultados: [] }), recursos: recursosConfigurados(), agenda: agenda.listar() });
});
app.post('/admin/saude', async (req, res) => {
  try {
    res.json(await verificarTudo());
  } catch (e) {
    erroJson(res, 'admin/saude', e);
  }
});

// Anomalias:  GET histórico (?horas=24) · POST /teste dispara uma de teste
// (severidade alta = só e-mail; ?canal=whatsapp usa crítica = e-mail + WhatsApp)
app.get('/admin/anomalias', (req, res) => {
  const horas = Math.min(Math.max(Number(req.query.horas || 24), 1), 24 * 30);
  res.json({ resumo: resumoAnomalias(horas), lista: listarAnomalias(horas) });
});
app.post('/admin/anomalias/teste', async (req, res) => {
  try {
    const severidade = req.query.canal === 'whatsapp' ? 'critica' : 'alta';
    const r = await reportarAnomalia({ tipo: 'saude_falha', titulo: 'Teste do canal de alertas', detalhe: 'Disparo manual pelo /admin/anomalias/teste. Se você recebeu este e-mail ou WhatsApp, os alertas estão funcionando.', severidade, forcar: true });
    res.json(r);
  } catch (e) {
    erroJson(res, 'admin/anomalias/teste', e);
  }
});

// Palavra-chave:  GET estado · POST /rotacionar gera nova e envia por e-mail
app.get('/admin/chave', (_req, res) => {
  res.json(estadoChave());
});
app.post('/admin/chave/rotacionar', async (req, res) => {
  try {
    res.json(await rotacionarEEnviar());
  } catch (e) {
    erroJson(res, 'admin/chave/rotacionar', e);
  }
});

// Pausa manual:  GET estado · POST pausa (?horas=2) · DELETE encerra
app.get('/admin/pausa', (_req, res) => {
  res.json(estadoPausa());
});
app.post('/admin/pausa', (req, res) => {
  res.json(pausar({ horas: horasDe(req.query.horas), por: 'painel' }));
});
app.delete('/admin/pausa', (_req, res) => {
  res.json({ antes: retomar(), agora: estadoPausa() });
});

// Auditoria dos comandos /carol (últimas N linhas, mais recentes primeiro)
app.get('/admin/auditoria', (req, res) => {
  try {
    const n = Math.min(Math.max(Number(req.query.linhas || 100), 1), 1000);
    let linhas = [];
    try {
      linhas = fs.readFileSync(path.join(DATA_DIR, 'auditoria.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
    } catch {}
    const eventos = linhas
      .slice(-n)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { bruto: l };
        }
      });
    res.json({ total: linhas.length, eventos });
  } catch (e) {
    erroJson(res, 'admin/auditoria', e);
  }
});

// Agenda:  GET tarefas · POST /executar/:nome roda uma agora
app.get('/admin/agenda', (_req, res) => {
  res.json(agenda.listar());
});
app.post('/admin/agenda/executar/:nome', async (req, res) => {
  try {
    res.json(await agenda.executarAgora(req.params.nome));
  } catch (e) {
    res.status(404).json({ erro: e.message });
  }
});

// Dashboard de custos:
//   GET /admin/dashboard?key=X&dias=7   → página HTML
//   GET /admin/custos?key=X&dias=7      → mesmos dados em JSON
function diasDoQuery(req) {
  const d = Number(req.query.dias || 7);
  return [1, 7, 30, 90].includes(d) ? d : 7;
}
app.get('/admin/dashboard', (req, res) => {
  try {
    // Se a chave veio pela URL, migra para cookie HttpOnly e some com ela da
    // barra de endereço (query string vaza em logs de proxy e histórico).
    if (typeof req.query.key === 'string') {
      res.setHeader(
        'Set-Cookie',
        `carol_key=${encodeURIComponent(req.query.key)}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=43200`
      );
      return res.redirect(`/admin/dashboard?dias=${diasDoQuery(req)}`);
    }
    res.type('html').send(paginaDashboard(agregarCustos(diasDoQuery(req))));
  } catch (e) {
    erroInterno(res, 'admin/dashboard', e);
  }
});
app.get('/admin/custos', (req, res) => {
  try {
    res.json(agregarCustos(diasDoQuery(req)));
  } catch (e) {
    erroJson(res, 'admin/custos', e);
  }
});

// Exportação das conversas para análise:
//   GET /admin/exportar?key=X&dias=7&formato=csv|txt|json
app.get('/admin/exportar', (req, res) => {
  try {
    const formato = ['csv', 'txt', 'json'].includes(req.query.formato) ? req.query.formato : 'csv';
    const { corpo, mime, nomeArquivo } = exportarAtendimentos(diasDoQuery(req), formato);
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.type(mime).send(corpo);
  } catch (e) {
    erroInterno(res, 'admin/exportar', e);
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
if (config.waPhoneNumberId && !config.metaAppSecret) {
  console.error('[config] META_APP_SECRET ausente com WhatsApp configurado — o webhook rejeitará TODAS as entregas (fail-closed). Configure a variável no Railway.');
}
{
  const r = recursosConfigurados();
  if (!r.emailHttp) console.warn('[config] nenhum provedor de e-mail HTTP (GOOGLE_SERVICE_ACCOUNT_JSON+GMAIL_SENDER, RESEND_API_KEY ou BREVO_API_KEY). No Railway o SMTP é bloqueado: e-mails NÃO vão sair; relatórios e palavra-chave caem para o WhatsApp dos admins.');
  if (!r.admins) console.warn('[config] CAROL_ADMINS vazio: comandos /carol desativados e alertas por WhatsApp sem destinatário.');
  if (!r.tokenReservaWhatsApp) console.warn('[config] WA_ACCESS_TOKEN_FALLBACK vazio: sem auto-recovery de token do WhatsApp.');
  console.log(`[config] recursos: e-mail HTTP=${r.emailHttp} admins=${r.admins} tokenReserva=${r.tokenReservaWhatsApp} metaAds=${r.metaAds} googleAds=${r.googleAds} masterDrive=${r.masterDrive}`);
}

// Rotinas automáticas (horários em Brasília)
agenda.registrarTarefa({
  nome: 'relatorio_dai',
  descricao: 'Resumo operacional das últimas 24h para a Dai',
  quando: { hora: config.agenda.relatorioDaiHora, minuto: 0 },
  executar: enviarRelatorio,
});
agenda.registrarTarefa({
  nome: 'relatorio_socios',
  descricao: 'Relatório executivo diário para os sócios',
  quando: { hora: config.agenda.relatorioSociosHora, minuto: config.agenda.relatorioSociosMinuto },
  executar: enviarRelatorioSocios,
});
agenda.registrarTarefa({
  nome: 'chave_semanal',
  descricao: 'Rotação da palavra-chave dos comandos, enviada por e-mail',
  quando: { diaSemana: config.agenda.chaveDiaSemana, hora: config.agenda.chaveHora, minuto: config.agenda.chaveMinuto },
  executar: async () => {
    const r = await rotacionarEEnviar();
    return `enviada para ${r.enviadaPara.join(', ')}`;
  },
});

async function boot() {
  try {
    await carregarCatalogo();
  } catch (e) {
    console.error('[catalogo] falha na carga inicial:', e.message);
    reportarAnomalia({ tipo: 'catalogo_falha', detalhe: `Carga inicial falhou: ${e.message}` }).catch(() => {});
  }

  // Primeira palavra-chave (ou expirada): gera e manda agora, sem esperar segunda-feira
  if (precisaRotacionar()) {
    try {
      const r = await rotacionarEEnviar();
      console.log(`[chave] palavra-chave inicial enviada por ${r.canal}${r.canal === 'email' ? ` para ${r.enviadaPara.join(', ')}` : ` para ${config.admins.length} administrador(es) (contingência)`}`);
    } catch (e) {
      console.warn('[chave] não consegui enviar a palavra-chave inicial:', e.message);
    }
  }

  try {
    const recuperadas = await agenda.iniciar({ reportarAnomalia });
    if (recuperadas.length) console.warn(`[agenda] ${recuperadas.length} tarefa(s) recuperada(s) no boot`);
  } catch (e) {
    console.error('[agenda] falha ao iniciar:', e.message);
  }

  agendarSupervisor();

  app.listen(config.port, () => {
    console.log(`Carol no ar na porta ${config.port} (horário comercial agora: ${horarioComercial()})`);
  });
}

boot();
