// Rotas do painel do administrador (/admin/painel). Montado no server.js
// ANTES do middleware geral de /admin, porque tem autenticação própria
// (login + cookie de sessão assinado) em vez da chave na URL.
//
//   GET  /admin/painel/entrar        tela de login
//   POST /admin/painel/entrar        confere a chave → cookie de sessão (12 h)
//   POST /admin/painel/sair          encerra a sessão
//   GET  /admin/painel/              painel
//   GET  /admin/painel/api/estado    polling de 5 s (pequeno)
//   GET  /admin/painel/api/detalhes  a cada 60 s (picos, saúde, Railway)
//   GET  /admin/painel/api/maquina   série de CPU/memória para semear o gráfico
//   GET  /admin/painel/api/horario   regra de horário + presets
//   PUT  /admin/painel/api/horario   salva a regra de horário
//   POST /admin/painel/api/ligar     encerra o desligamento
//   POST /admin/painel/api/desligar  { horas } ou { ateReligar: true }

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pausar, retomar, estadoPausa, HORAS_MIN, HORAS_MAX_PAINEL } from '../comandos/pausa.js';
import { obterHorario, salvarHorario, restaurarPadraoHorario, descreverRegra, descreverExpediente, descreverOrigem, PRESETS, MODOS } from '../horarioConfig.js';
import { criarLimite } from '../util/limite.js';
import { auditar as auditarBase } from '../util/auditoria.js';
import { segredoDe, chaveConfere, criarToken, verificarToken, lerCookie, cookieSessao, cookieSaida, origemConfere, headersSeguranca, revogadosDoServico, revogarToken } from './sessao.js';
import { criarPainel } from './painel.js';
import { iniciarAmostragem, serieMaquina } from './maquina.js';
import { paginaLogin, paginaPainel } from './pagina.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(here, 'publico');

const auditar = (evento) => auditarBase({ origem: 'painel', ...evento });

function horarioParaApi() {
  const cfg = obterHorario();
  return { config: cfg, regra: descreverRegra(cfg), expediente: descreverExpediente(cfg), origem: cfg.origem || 'variavel', origemTexto: descreverOrigem(cfg), presets: MODOS.map((m) => ({ modo: m, ...PRESETS[m] })) };
}

/** Destino depois do login: só caminhos internos de /admin (evita open redirect). */
export function destinoSeguro(v) {
  const s = String(v || '');
  return /^\/admin\/[A-Za-z0-9/_\-?=&.]*$/.test(s) && !s.includes('//') ? s : '/admin/painel/';
}

/**
 * @param {{limites?:Function, chaveAdmin?:string, segredo?:string, painel?:object, limiteLogin?:Function, revogados?:object, rotacionarChave?:Function}} deps
 */
export function criarRotasPainel(deps = {}) {
  const chaveAdmin = deps.chaveAdmin ?? process.env.CAROL_ADMIN_KEY ?? '';
  const segredo = segredoDe({ chaveAdmin, segredo: deps.segredo ?? process.env.CAROL_PAINEL_SEGREDO ?? '' });
  const painel = deps.painel || criarPainel({ limites: deps.limites });
  const limiteLogin = deps.limiteLogin || criarLimite(8, 15 * 60 * 1000);
  const limiteApi = criarLimite(900, 10 * 60 * 1000);
  const revogados = deps.revogados || revogadosDoServico();
  const router = express.Router();

  router.use(headersSeguranca);
  router.use(express.urlencoded({ extended: false, limit: '2kb' }));

  if (!segredo) {
    router.use((_req, res) => res.status(503).type('text/plain').send('Painel desativado: configure CAROL_ADMIN_KEY.'));
    return router;
  }
  iniciarAmostragem();

  const logado = (req) => verificarToken(lerCookie(req), segredo, { revogados }).ok;

  // Arquivos estáticos do painel (sem segredo nenhum dentro)
  router.get('/painel.css', (_req, res) => res.type('text/css').sendFile(path.join(PUBLICO, 'painel.css')));
  router.get('/painel.js', (_req, res) => res.type('application/javascript').sendFile(path.join(PUBLICO, 'painel.js')));

  router.get('/entrar', (req, res) => {
    const voltar = destinoSeguro(req.query.voltar);
    if (logado(req)) return res.redirect(303, voltar);
    res.type('html').send(paginaLogin('', voltar));
  });

  router.post('/entrar', (req, res) => {
    const ip = req.ip || 'sem-ip';
    if (!origemConfere(req, { exigirHeader: false })) return res.status(403).type('html').send(paginaLogin('Origem da requisição não reconhecida.'));
    if (!limiteLogin(ip)) {
      auditar({ evento: 'painel_login_bloqueado', ip });
      return res.status(429).type('html').send(paginaLogin('Muitas tentativas. Espere 15 minutos e tente de novo.'));
    }
    const chave = typeof req.body?.chave === 'string' ? req.body.chave : '';
    const voltar = destinoSeguro(req.body?.voltar);
    if (!chaveConfere(chave, chaveAdmin)) {
      auditar({ evento: 'painel_login_falhou', ip });
      return res.status(401).type('html').send(paginaLogin('Chave incorreta.', voltar));
    }
    auditar({ evento: 'painel_login', ip });
    res.setHeader('Set-Cookie', cookieSessao(criarToken(segredo)));
    res.redirect(303, voltar);
  });

  // Sair revoga o token no servidor (não só apaga o cookie do navegador)
  router.post('/sair', (req, res) => {
    if (!origemConfere(req, { exigirHeader: false })) return res.sendStatus(403);
    if (revogarToken(lerCookie(req), segredo, revogados)) auditar({ evento: 'painel_sair', ip: req.ip });
    res.setHeader('Set-Cookie', cookieSaida());
    res.redirect(303, '/admin/painel/entrar');
  });

  // ── Daqui para baixo, só com sessão válida ──────────────────────────────
  router.use((req, res, next) => {
    if (!limiteApi(req.ip || 'sem-ip')) return res.status(429).json({ erro: 'muitas requisições' });
    if (logado(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ erro: 'sessão expirada' });
    return res.redirect(303, '/admin/painel/entrar');
  });

  // Escrita: CSRF (header customizado + Origin)
  router.use('/api', (req, res, next) => {
    if (req.method === 'GET') return next();
    if (!origemConfere(req)) return res.status(403).json({ erro: 'origem não autorizada' });
    next();
  });

  router.get('/', (_req, res) => res.type('html').send(paginaPainel()));

  router.get('/api/estado', (_req, res) => {
    try {
      res.json(painel.estado());
    } catch (e) {
      console.error('[painel] estado:', e);
      res.status(500).json({ erro: 'erro interno' });
    }
  });

  router.get('/api/detalhes', async (_req, res) => {
    try {
      res.json(await painel.detalhes());
    } catch (e) {
      console.error('[painel] detalhes:', e);
      res.status(500).json({ erro: 'erro interno' });
    }
  });

  router.get('/api/maquina', (_req, res) => res.json({ intervaloMs: 5000, pontos: serieMaquina() }));

  router.get('/api/horario', (_req, res) => res.json(horarioParaApi()));

  router.put('/api/horario', (req, res) => {
    try {
      const antes = obterHorario();
      const cfg = salvarHorario(req.body, { por: 'painel' });
      auditar({ evento: 'painel_horario', ip: req.ip, antes: descreverRegra(antes), depois: descreverRegra(cfg) });
      painel.invalidar();
      res.json(horarioParaApi());
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ erro: 'configuração inválida', erros: e.erros });
      console.error('[painel] salvar horário:', e);
      res.status(500).json({ erro: 'não consegui salvar' });
    }
  });

  // Volta à regra das variáveis do servidor (CAROL_24H/CAROL_HORA_*)
  router.delete('/api/horario', (req, res) => {
    const antes = obterHorario();
    const cfg = restaurarPadraoHorario();
    auditar({ evento: 'painel_horario_padrao', ip: req.ip, antes: descreverRegra(antes), depois: descreverRegra(cfg) });
    painel.invalidar();
    res.json(horarioParaApi());
  });

  // Palavra-chave dos comandos: gera e manda por e-mail; se o e-mail falhar,
  // mostra UMA vez aqui (sessão autenticada com a chave de administrador).
  router.post('/api/chave', async (req, res) => {
    try {
      const rotacionar = deps.rotacionarChave || (async (o) => (await import('../comandos/chave.js')).rotacionarEEnviar(o));
      const r = await rotacionar({ exibir: true });
      auditar({ evento: 'painel_chave', ip: req.ip, canal: r.canal });
      res.json(r.canal === 'email' ? { ok: true, canal: 'email', enviadaPara: r.enviadaPara, validaAte: r.validaAte } : { ok: true, canal: 'tela', palavra: r.palavra, validaAte: r.validaAte, aviso: 'E-mail indisponível: anote a palavra agora, ela não será mostrada de novo.' });
    } catch (e) {
      console.error('[painel] palavra-chave:', e.message);
      res.status(500).json({ erro: 'não consegui gerar a palavra-chave' });
    }
  });

  router.post('/api/ligar', (req, res) => {
    const antes = retomar();
    auditar({ evento: 'painel_ligar', ip: req.ip, estavaDesligada: antes.ativa });
    painel.invalidar();
    res.json({ ok: true, pausa: estadoPausa() });
  });

  router.post('/api/desligar', (req, res) => {
    const b = req.body || {};
    let e;
    if (b.ateReligar === true) {
      e = pausar({ indefinida: true, por: 'painel' });
      auditar({ evento: 'painel_desligar', ip: req.ip, ateReligar: true });
    } else {
      const horas = Number(b.horas);
      if (!Number.isFinite(horas) || horas < HORAS_MIN || horas > HORAS_MAX_PAINEL) {
        return res.status(400).json({ erro: `horas deve ficar entre ${HORAS_MIN} e ${HORAS_MAX_PAINEL}` });
      }
      e = pausar({ horas, por: 'painel', maxHoras: HORAS_MAX_PAINEL });
      auditar({ evento: 'painel_desligar', ip: req.ip, horas, ate: e.ate });
    }
    painel.invalidar();
    res.json({ ok: true, pausa: e });
  });

  return router;
}
