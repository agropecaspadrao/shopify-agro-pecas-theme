// Área administrativa antiga (/admin/*, fora do painel).
//
// Autenticação (nunca pela URL):
//   - Authorization: Bearer <CAROL_ADMIN_KEY>  → tudo (curl, scripts)
//   - cookie de sessão do painel (/admin/painel/entrar) → tudo (navegador)
//   - Authorization: Bearer <SDR_SYNC_KEY>     → SÓ GET /admin/exportar (o SDR puxa o histórico)
// O antigo ?key= foi removido (vazava em log de proxy e histórico) e o cookie
// carol_key, que guardava a chave em texto puro, não existe mais.
// Todas as respostas: Cache-Control no-store, CSP e X-Frame-Options DENY.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { chaveConfere, verificarToken, lerCookie, origemConfere, headersSeguranca } from '../admin/sessao.js';
import { auditar } from '../util/auditoria.js';
import { chaveIp } from '../util/ip.js';

/**
 * Quem está chamando. @returns {{ok:boolean, escopo?:'admin'|'sdr', via?:'bearer'|'sessao', motivo?:string}}
 */
export function autenticarAdmin(req, { chaveAdmin, chaveSdr, segredo, revogados }) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) {
    const recebida = auth.slice(7).trim();
    if (chaveAdmin && chaveConfere(recebida, chaveAdmin)) return { ok: true, escopo: 'admin', via: 'bearer' };
    if (chaveSdr && chaveConfere(recebida, chaveSdr)) return { ok: true, escopo: 'sdr', via: 'bearer' };
    return { ok: false, motivo: 'chave inválida' };
  }
  if (segredo && verificarToken(lerCookie(req), segredo, { revogados }).ok) return { ok: true, escopo: 'admin', via: 'sessao' };
  if (typeof req.query?.key === 'string') return { ok: false, motivo: '?key= não é mais aceito: use Authorization: Bearer' };
  return { ok: false, motivo: 'sem credencial' };
}

function diasDoQuery(req) {
  const d = Number(req.query.dias || 7);
  return [1, 7, 30, 90].includes(d) ? d : 7;
}

function erroJson(res, contexto, e) {
  console.error(`[${contexto}] erro:`, e.message);
  return res.status(500).json({ erro: 'erro interno' });
}

/**
 * @param {object} d dependências (módulos reais em app.js; falsos nos testes)
 */
export function criarRotasAdmin(d) {
  const router = express.Router();
  const credenciais = { chaveAdmin: d.chaveAdmin, chaveSdr: d.chaveSdr, segredo: d.segredo, revogados: d.revogados };

  router.use(headersSeguranca);
  router.use((req, res, next) => {
    if (!d.limiteIp(chaveIp(req.ip))) return res.status(429).json({ erro: 'muitas requisições' });
    const a = autenticarAdmin(req, credenciais);
    // Dashboard no navegador sem sessão: manda para o login do painel e volta
    if (!a.ok && req.method === 'GET' && req.path === '/dashboard') {
      return res.redirect(303, `/admin/painel/entrar?voltar=${encodeURIComponent(`/admin/dashboard?dias=${diasDoQuery(req)}`)}`);
    }
    if (!a.ok) return res.status(403).json({ erro: 'não autorizado', ...(a.motivo?.startsWith('?key=') ? { detalhe: a.motivo } : {}) });
    // Chave do SDR: escopo limitado à leitura do histórico
    if (a.escopo === 'sdr' && !(req.method === 'GET' && req.path === '/exportar')) return res.status(403).json({ erro: 'escopo da chave não permite esta rota' });
    // Escrita com cookie de sessão: exige mesma origem (CSRF)
    if (a.via === 'sessao' && req.method !== 'GET' && !origemConfere(req, { exigirHeader: false })) return res.status(403).json({ erro: 'origem não autorizada' });
    req.auth = a;
    next();
  });

  // Detalhes de saúde (o /health público só diz ok)
  router.get('/status', (_req, res) => res.json(d.statusDetalhado()));

  // Relatório da Dai:  GET mostra sem enviar · POST envia agora
  router.get('/relatorio', async (_req, res) => {
    try {
      const { assunto, corpo } = await d.montarRelatorio();
      res.type('text/plain').send(`ASSUNTO: ${assunto}\n\n${corpo}`);
    } catch (e) {
      erroJson(res, 'admin/relatorio', e);
    }
  });
  router.post('/relatorio', async (_req, res) => {
    try {
      res.json(await d.enviarRelatorio());
    } catch (e) {
      erroJson(res, 'admin/relatorio', e);
    }
  });

  // Relatório executivo dos sócios:  GET prévia · POST envia agora
  router.get('/relatorio-socios', async (_req, res) => {
    try {
      const { assunto, corpo } = await d.montarRelatorioSocios();
      res.type('text/plain').send(`ASSUNTO: ${assunto}\n\n${corpo}`);
    } catch (e) {
      erroJson(res, 'admin/relatorio-socios', e);
    }
  });
  router.post('/relatorio-socios', async (_req, res) => {
    try {
      res.json(await d.enviarRelatorioSocios());
    } catch (e) {
      erroJson(res, 'admin/relatorio-socios', e);
    }
  });

  // Saúde:  GET último quadro · POST roda os verificadores agora
  router.get('/saude', (req, res) => {
    const estado = d.ultimoEstado();
    if (req.query.formato === 'txt') return res.type('text/plain').send(d.textoSaude(estado));
    res.json({ ...(estado || { geral: 'desconhecida', resultados: [] }), recursos: d.recursosConfigurados(), agenda: d.agenda.listar() });
  });
  router.post('/saude', async (_req, res) => {
    try {
      res.json(await d.verificarTudo());
    } catch (e) {
      erroJson(res, 'admin/saude', e);
    }
  });

  // Anomalias:  GET histórico (?horas=24) · POST /teste dispara uma de teste
  router.get('/anomalias', (req, res) => {
    const horas = Math.min(Math.max(Number(req.query.horas || 24), 1), 24 * 30);
    res.json({ resumo: d.resumoAnomalias(horas), lista: d.listarAnomalias(horas) });
  });
  router.post('/anomalias/teste', async (req, res) => {
    try {
      const severidade = req.query.canal === 'whatsapp' ? 'critica' : 'alta';
      res.json(await d.reportarAnomalia({ tipo: 'saude_falha', titulo: 'Teste do canal de alertas', detalhe: 'Disparo manual pelo /admin/anomalias/teste. Se você recebeu este e-mail ou WhatsApp, os alertas estão funcionando.', severidade, forcar: true }));
    } catch (e) {
      erroJson(res, 'admin/anomalias/teste', e);
    }
  });

  // Palavra-chave:  GET estado · POST /rotacionar gera nova e envia por e-mail
  // (?exibir=1: se o e-mail falhar, devolve a palavra nesta resposta autenticada)
  router.get('/chave', (_req, res) => res.json(d.estadoChave()));
  router.post('/chave/rotacionar', async (req, res) => {
    try {
      res.json(await d.rotacionarChave({ exibir: req.query.exibir === '1' }));
    } catch (e) {
      erroJson(res, 'admin/chave/rotacionar', e);
    }
  });

  // Pausa manual:  GET estado · POST pausa (?horas=2) · DELETE encerra
  router.get('/pausa', (_req, res) => res.json(d.estadoPausa()));
  router.post('/pausa', (req, res) => res.json(d.pausar({ horas: d.horasDe(req.query.horas), por: 'painel' })));
  router.delete('/pausa', (_req, res) => res.json({ antes: d.retomar(), agora: d.estadoPausa() }));

  // Saldo Anthropic: GET estimado · POST ?usd=25 informa o saldo do console
  router.get('/saldo', (_req, res) => res.json({ ...(d.saldoEstimado() || { configurado: false }), credito: d.statusCredito() }));
  router.post('/saldo', (req, res) => {
    try {
      d.definirSaldo(req.query.usd, { por: 'painel' });
      res.json(d.saldoEstimado());
    } catch (e) {
      res.status(400).json({ erro: String(e.message).slice(0, 100) });
    }
  });

  // Auditoria (últimas N linhas, mais recentes primeiro)
  router.get('/auditoria', (req, res) => {
    try {
      const n = Math.min(Math.max(Number(req.query.linhas || 100), 1), 1000);
      let linhas = [];
      try {
        linhas = fs.readFileSync(path.join(d.dataDir, 'auditoria.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
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
  router.get('/agenda', (_req, res) => res.json(d.agenda.listar()));
  router.post('/agenda/executar/:nome', async (req, res) => {
    try {
      res.json(await d.agenda.executarAgora(req.params.nome));
    } catch (e) {
      res.status(404).json({ erro: String(e.message).slice(0, 100) });
    }
  });

  // LGPD: apaga todos os dados de um cliente. Corpo { telefone } ou { sessao }.
  router.post('/cliente/apagar', async (req, res) => {
    try {
      const { telefone, sessao } = req.body || {};
      const r = await d.apagarCliente({ telefone, sessao }, { por: req.auth.via === 'sessao' ? 'painel' : 'api' });
      auditar({ evento: 'lgpd_apagar_http', ip: chaveIp(req.ip), via: req.auth.via, ok: r.ok, sessoes: r.sessoes });
      res.status(r.sessoes.length ? (r.ok ? 200 : 207) : 400).json(r);
    } catch (e) {
      erroJson(res, 'admin/cliente/apagar', e);
    }
  });

  // Dashboard de custos (HTML com scripts inline: CSP com nonce próprio)
  router.get('/dashboard', (req, res) => {
    try {
      const nonce = crypto.randomBytes(16).toString('base64');
      const html = d.paginaDashboard(d.agregarCustos(diasDoQuery(req))).replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
      res.setHeader(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
      );
      res.type('html').send(html);
    } catch (e) {
      console.error('[admin/dashboard] erro:', e.message);
      res.status(500).type('text/plain').send('Erro interno');
    }
  });
  router.get('/custos', (req, res) => {
    try {
      res.json(d.agregarCustos(diasDoQuery(req)));
    } catch (e) {
      erroJson(res, 'admin/custos', e);
    }
  });

  // Exportação das conversas (o SDR puxa formato=json com a SDR_SYNC_KEY).
  // Aqui o telefone vai completo: é necessário para a integração e o CSV.
  //   GET /admin/exportar?dias=7&formato=csv|txt|json
  router.get('/exportar', (req, res) => {
    try {
      const formato = ['csv', 'txt', 'json'].includes(req.query.formato) ? req.query.formato : 'csv';
      const { corpo, mime, nomeArquivo } = d.exportarAtendimentos(diasDoQuery(req), formato);
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
      res.type(mime).send(corpo);
    } catch (e) {
      console.error('[admin/exportar] erro:', e.message);
      res.status(500).type('text/plain').send('Erro interno');
    }
  });

  return router;
}
