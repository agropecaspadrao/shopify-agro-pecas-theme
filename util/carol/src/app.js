// Aplicação HTTP da Carol (Express) SEM listen: o boot.js sobe o servidor e
// os testes montam o app com dependências falsas.
//
//   /health        público, mínimo (ok + status); com Bearer de admin, detalhes
//   /webhook       WhatsApp (rotas/webhook.js)
//   /api/*         widget do site (rotas/chat.js)
//   /admin/api/*   API JSON de administração, só Bearer (admin/api.js),
//                  consumida pela seção Carol do SDR (portal único da operação)
//   /admin/painel, /admin/dashboard  desligados: redirecionam para o SDR
//   /admin/*       rotas antigas com Bearer (rotas/admin.js), inclusive /admin/exportar

import express from 'express';
import { config, recursosConfigurados } from './config.js';
import { DATA_DIR } from './util/dados.js';
import { estadoPausa, pausar, retomar, horasDe } from './comandos/pausa.js';
import { carolAtende, obterHorario, descreverRegra, descreverOrigem } from './horarioConfig.js';
import { quandoEquipeResponde } from './horario.js';
import { estadoCatalogo } from './catalogo.js';
import { gerarResposta, responder, resumirConversa } from './claude.js';
import { enviarRelatorio, montarRelatorio, resumoCompacto, detalheConversa } from './relatorio.js';
import { verificarAssinatura, extrairMensagens, enviarTexto, marcarComoLida, baixarMidia } from './whatsapp.js';
import { transcreverAudio, transcricaoDisponivel } from './transcricao.js';
import { agregarCustos, exportarAtendimentos, definirSaldo, saldoEstimado } from './custos.js';
import { statusCredito } from './gasto.js';
import { reportarAnomalia, classificarErro, listarAnomalias, resumoAnomalias } from './alertas/anomalias.js';
import { verificarTudo, ultimoEstado, textoSaude } from './saude/supervisor.js';
import { tratarMensagemAdmin, avisoSilencioAdmin, normalizarNumero } from './comandos/comandos.js';
import { rotacionarEEnviar, estadoChave } from './comandos/chave.js';
import { montarRelatorioSocios, enviarRelatorioSocios } from './relatorios/socios.js';
import * as agenda from './agenda.js';
import { memoria } from './memoria/index.js';
import { registrarAtendimento } from './registro.js';
import { apagarCliente } from './lgpd.js';
import { criarLimite } from './util/limite.js';
import { criarTetos } from './util/tetoDiario.js';
import { mascararTelefone } from './util/telefone.js';
import { criarRotasApi } from './admin/api.js';
import { medirResposta } from './admin/maquina.js';
import { chaveConfere, urlPortal } from './admin/seguranca.js';
import { criarProcessadorWhatsApp, criarRotasWebhook } from './rotas/webhook.js';
import { criarRotasChat } from './rotas/chat.js';
import { criarRotasAdmin, autenticarAdmin } from './rotas/admin.js';

const MIN10 = 10 * 60 * 1000;

export const MAXIMOS = {
  waDia: Number(process.env.CAROL_MAX_MSGS_WA_DIA || 300),
  waTelefoneDia: Number(process.env.CAROL_MAX_MSGS_WA_TEL_DIA || 40),
  siteDia: Number(process.env.CAROL_MAX_MSGS_SITE_DIA || 400),
  siteIpDia: Number(process.env.CAROL_MAX_MSGS_SITE_IP_DIA || 60),
  siteSessaoDia: Number(process.env.CAROL_MAX_MSGS_SITE_SESSAO_DIA || 40),
};

/**
 * @param {object} over substitui qualquer dependência (testes)
 * @returns {{app:import('express').Express, processador:object, tetos:object, estado:object}}
 */
export function criarApp(over = {}) {
  const chaveAdmin = over.chaveAdmin ?? process.env.CAROL_ADMIN_KEY ?? '';
  const chaveSdr = over.chaveSdr ?? process.env.SDR_SYNC_KEY ?? '';
  const portal = urlPortal(over.portalUrl ?? process.env.CAROL_PORTAL_URL);
  const tetos = over.tetos || criarTetos();
  const estado = over.estado || { pronto: false, iniciadoEm: Date.now() };

  const app = express();
  app.set('trust proxy', 1); // Railway fica atrás de proxy — req.ip = X-Forwarded-For
  app.disable('x-powered-by');
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // ── CORS para o widget do site ────────────────────────────────────────────
  const origens = over.allowedOrigins || config.allowedOrigins;
  app.use((req, res, next) => {
    const origem = req.headers.origin;
    if (origem && origens.includes(origem) && req.path.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', origem);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  function statusDetalhado() {
    const saude = ultimoEstado();
    const pausa = estadoPausa();
    const mem = memoria.estado();
    const h = obterHorario();
    return {
      ok: true,
      pronto: estado.pronto,
      carolAtendeAgora: carolAtende(),
      pausada: pausa.ativa,
      pausaAte: pausa.ate || null,
      horario: { modo: h.modo, origem: h.origem, regra: descreverRegra(h), origemTexto: descreverOrigem(h) },
      saude: saude?.geral || 'desconhecida',
      verificadoEm: saude?.ts || null,
      memoria: mem.degradado ? `${mem.adaptador} (degradada: local)` : mem.adaptador,
      catalogo: estadoCatalogo().produtos,
      credito: statusCredito(),
      tetos: { whatsapp: { usado: tetos.uso('wa'), max: MAXIMOS.waDia }, site: { usado: tetos.uso('site'), max: MAXIMOS.siteDia } },
    };
  }

  // Público e mínimo (healthcheck do Railway). Detalhes só com Bearer de admin.
  app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const a = autenticarAdmin(req, { chaveAdmin, chaveSdr: '' });
    if (a.ok && a.escopo === 'admin') return res.json(over.statusDetalhado ? over.statusDetalhado() : statusDetalhado());
    res.json({ ok: true, status: estado.pronto ? 'pronto' : 'iniciando' });
  });

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  const depsComandos = { montarRelatorio, resumoCompacto, detalheConversa, verificarTudo, textoSaude, enviarRelatorioSocios, rotacionarChave: rotacionarEEnviar, apagarCliente: (alvo, o) => apagarCliente(alvo, { ...o, memoria }) };
  const processador =
    over.processador ||
    criarProcessadorWhatsApp({
      numeroLoja: process.env.WA_BUSINESS_NUMBER || '5541984151085',
      tratarComando: (m) => tratarMensagemAdmin(m, depsComandos),
      estadoPausa,
      carolAtende: () => carolAtende(),
      limiteTelefone: (de) => tetos.contar('wa_tel', normalizarNumero(de), MAXIMOS.waTelefoneDia),
      limiteGlobal: () => tetos.contar('wa', '*', MAXIMOS.waDia),
      marcarComoLida,
      enviarTexto,
      baixarMidia,
      transcreverAudio,
      transcricaoDisponivel,
      gerarResposta,
      registrar: registrarAtendimento,
      memoria,
      reportarAnomalia,
      classificarErro,
      medir: medirResposta,
      quandoEquipeResponde: () => quandoEquipeResponde(),
      agruparMs: Number(process.env.CAROL_AGRUPAR_MS ?? 4000),
      // Sócio que escreve texto comum enquanto a Carol está em silêncio recebe
      // um aviso curto (no máximo um a cada 12h), para não achar que ela quebrou.
      avisarSilencioAdmin: async (de, motivo) => {
        const aviso = avisoSilencioAdmin(de, motivo);
        if (!aviso) return;
        try {
          await enviarTexto(de, aviso);
          console.log(`[comandos] avisei o administrador ${mascararTelefone(de)} do silêncio (${motivo})`);
        } catch (e) {
          console.warn(`[comandos] aviso de silêncio para ${mascararTelefone(de)} falhou: ${e.message}`);
        }
      },
    });
  app.use(
    '/webhook',
    criarRotasWebhook({
      processador,
      verificarAssinatura: over.verificarAssinatura || verificarAssinatura,
      extrairMensagens: over.extrairMensagens || extrairMensagens,
      verifyToken: over.verifyToken ?? config.waVerifyToken,
      compararSegredo: chaveConfere,
      reportarAnomalia,
      classificarErro,
    })
  );

  // ── Chat do site ─────────────────────────────────────────────────────────
  app.use(
    '/api',
    criarRotasChat({
      responder: over.responder || ((s, t, c) => responder(s, t, c)),
      resumirConversa: over.resumirConversa || resumirConversa,
      limites: { sessao10min: criarLimite(30, MIN10), ip10min: criarLimite(40, MIN10), resumoIp: criarLimite(10, MIN10) },
      tetos,
      maximos: { global: MAXIMOS.siteDia, ipDia: MAXIMOS.siteIpDia, sessaoDia: MAXIMOS.siteSessaoDia },
      registrar: over.registrar || registrarAtendimento,
      reportarAnomalia: over.reportarAnomalia || reportarAnomalia,
      classificarErro,
      medir: medirResposta,
    })
  );

  // ── Administração ────────────────────────────────────────────────────────
  const limites = () => ({
    whatsapp: { usado: tetos.uso('wa'), max: MAXIMOS.waDia },
    site: { usado: tetos.uso('site'), max: MAXIMOS.siteDia },
  });
  const depsAdmin = {
    chaveAdmin,
    chaveSdr,
    dataDir: DATA_DIR,
    statusDetalhado,
    montarRelatorio,
    enviarRelatorio,
    montarRelatorioSocios,
    enviarRelatorioSocios,
    ultimoEstado,
    textoSaude,
    verificarTudo,
    recursosConfigurados,
    agenda,
    resumoAnomalias,
    listarAnomalias,
    reportarAnomalia,
    estadoChave,
    rotacionarChave: rotacionarEEnviar,
    estadoPausa,
    pausar,
    retomar,
    horasDe,
    saldoEstimado,
    definirSaldo,
    statusCredito,
    agregarCustos,
    exportarAtendimentos: over.exportarAtendimentos || exportarAtendimentos,
    apagarCliente: over.apagarCliente || ((alvo, o) => apagarCliente(alvo, { ...o, memoria })),
    ...(over.admin || {}),
  };

  // Portal próprio desligado: a administração fica no SDR (seção Carol).
  // Antes do middleware de /admin, sem autenticação (não expõe nada).
  const portalEsc = portal.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const paginaPortal = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Carol · administração no SDR</title></head><body><p>A administração da Carol agora fica no SDR, na seção Carol.</p><p><a href="${portalEsc}">Abrir o SDR → Carol</a></p></body></html>`;
  const portalDesligado = (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (req.method === 'GET' || req.method === 'HEAD') return res.status(302).location(portal).type('html').send(paginaPortal);
    res.status(410).json({ erro: 'a administração da Carol agora fica no SDR (seção Carol)', detalhes: { portal } });
  };
  app.use('/admin/painel', portalDesligado);
  app.use('/admin/dashboard', portalDesligado);

  app.use('/admin/api', criarRotasApi({ ...depsAdmin, limites, agregador: over.agregador, limiteIp: over.limiteApi, semAmostragem: over.semAmostragem }));

  app.use('/admin', criarRotasAdmin({ ...depsAdmin, limiteIp: criarLimite(60, MIN10) }));

  // 404 sem detalhes
  app.use((_req, res) => res.status(404).json({ erro: 'não encontrado' }));

  // Erros: nunca devolve stack (independe de NODE_ENV)
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode) || 500;
    if (status >= 500) console.error('[http] erro:', err?.message || err);
    res.status(status >= 400 && status < 600 ? status : 500).json({ erro: status < 500 ? 'requisição inválida' : 'erro interno' });
  });

  return { app, processador, tetos, estado };
}
