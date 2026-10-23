// API JSON de administração da Carol (/admin/api/*), consumida pela seção
// "Carol" do SDR comercial — o portal único da operação. Chamada servidor→
// servidor: só `Authorization: Bearer <CAROL_ADMIN_KEY>`, sem sessão nem
// CSRF. A SDR_SYNC_KEY NÃO vale aqui (ela só lê /admin/exportar).
//
// Leitura
//   GET  /admin/api/resumo            agregado leve (< 5 KB) p/ polling de 5 s (cache 4 s)
//   GET  /admin/api/estado            estado ATENDENDO/EM SILÊNCIO/DESLIGADA, pausa, dia, processo
//   GET  /admin/api/detalhes          picos por hora × média 7d, heatmap 30d, saúde, Railway 24h
//   GET  /admin/api/maquina           série recente de CPU/memória/lag do processo
//   GET  /admin/api/horario           regra de horário + presets
//   GET  /admin/api/saude             último quadro do supervisor (+ recursos e agenda)
//   GET  /admin/api/anomalias         abertas + histórico (?horas=24)
//   GET  /admin/api/agenda            tarefas, última e próxima execução
//   GET  /admin/api/custos            ?dias=1|7|30|90 (&completo=1 traz tudo)
//   GET  /admin/api/saldo             saldo estimado do crédito Anthropic
//   GET  /admin/api/chave             validade da palavra-chave (sem a palavra)
//   GET  /admin/api/relatorio         prévia do relatório da Dai
//   GET  /admin/api/relatorio-socios  prévia do relatório executivo
//   GET  /admin/api/auditoria         últimas ações (?linhas=100)
// Escrita (header opcional X-Ator: login de quem fez no SDR → auditoria.jsonl)
//   PUT    /admin/api/horario                 { modo, expediente, janelas }
//   DELETE /admin/api/horario                 volta ao padrão das variáveis
//   POST   /admin/api/ligar                   encerra o desligamento
//   POST   /admin/api/desligar                { horas } ou { ateReligar: true }
//   POST   /admin/api/saude/verificar         roda os verificadores agora
//   POST   /admin/api/anomalias/teste         { canal: 'email'|'whatsapp' }
//   POST   /admin/api/agenda/executar/:tarefa
//   POST   /admin/api/saldo                   { usd }
//   POST   /admin/api/chave/rotacionar        gera a palavra-chave (mostra UMA vez se o e-mail falhar)
//   POST   /admin/api/cliente/apagar          { telefone } ou { sessao } (LGPD)
//   POST   /admin/api/relatorio               envia agora o relatório da Dai
//   POST   /admin/api/relatorio-socios        envia agora o relatório dos sócios
//
// Erros sempre em JSON { erro, detalhes? }: 400 validação, 401 sem Bearer ou
// Bearer errado, 404 rota/tarefa inexistente, 429 limite, 500 interno.

import express from 'express';
import { pausar, retomar, estadoPausa, HORAS_MIN, HORAS_MAX_PAINEL } from '../comandos/pausa.js';
import { obterHorario, salvarHorario, restaurarPadraoHorario, descreverRegra, descreverExpediente, descreverOrigem, PRESETS, MODOS } from '../horarioConfig.js';
import { config } from '../config.js';
import { criarLimite } from '../util/limite.js';
import { chaveIp } from '../util/ip.js';
import { auditar as auditarBase, lerAuditoria } from '../util/auditoria.js';
import { chaveConfere, headersSeguranca } from './seguranca.js';
import { criarAgregador } from './agregador.js';
import { iniciarAmostragem, serieMaquina, INTERVALO_MS } from './maquina.js';

export const CACHE_RESUMO_MS = 4000;
const DEZ_MIN = 10 * 60 * 1000;
// O SDR faz polling de 5 s por aba e todas as abas saem do mesmo IP (o
// backend do SDR). 10 abas × (resumo + estado a cada 5 s + detalhes/máquina
// a cada 60 s) ≈ 2.600 em 10 min: 3.000 dá folga sem abrir a porta.
export const LIMITE_10MIN = Number(process.env.CAROL_API_LIMITE_10MIN || 3000);
// Tentativas com chave errada por IP antes de bloquear por 10 min
export const LIMITE_FALHAS_10MIN = 20;

const SEVERIDADE = { critica: 0, alta: 1, media: 2, baixa: 3 };

/** Login de quem agiu no SDR (header X-Ator), limpo e curto. null se ausente. */
export function atorDe(req) {
  const bruto = String(req.get('x-ator') || '');
  const limpo = bruto
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._@+\- ]/gu, '')
    .trim()
    .slice(0, 60);
  return limpo || null;
}

function horarioParaApi() {
  const cfg = obterHorario();
  return { config: cfg, regra: descreverRegra(cfg), expediente: descreverExpediente(cfg), origem: cfg.origem || 'variavel', origemTexto: descreverOrigem(cfg), presets: MODOS.map((m) => ({ modo: m, ...PRESETS[m] })) };
}

function diasDe(v) {
  const d = Number(v || 7);
  return [1, 7, 30, 90].includes(d) ? d : 7;
}

/** Situação do saldo em uma palavra, para o semáforo do portal. */
export function statusSaldo(saldo, credito = {}, limiteAviso = config.alertaSaldoUsd) {
  if (credito?.esgotado) return 'esgotado';
  if (!saldo) return 'nao_configurado';
  if (saldo.desatualizado) return 'desatualizado';
  if (saldo.restante <= limiteAviso) return 'baixo';
  return 'ok';
}

/** Versão compacta do agregado de custos (sem conversas e mensagens). */
function custosCompactos(c) {
  return {
    periodo: c.periodo,
    modelo: c.modelo,
    cotacaoBRL: c.cotacaoBRL,
    totais: c.totais,
    porDia: c.porDia,
    porCanal: c.porCanal,
    projecao: c.projecao,
    saldo: c.saldo,
    anuncios: c.anuncios,
    resumoExecutivo: c.resumoExecutivo,
  };
}

/**
 * @param {object} d dependências (módulos reais em app.js; falsos nos testes):
 *   chaveAdmin, agregador?, limites?, limiteIp?, limiteFalhas?, semAmostragem?,
 *   ultimoEstado, verificarTudo, recursosConfigurados, agenda {listar, executarAgora},
 *   resumoAnomalias, listarAnomalias, reportarAnomalia, saldoEstimado, definirSaldo,
 *   statusCredito, agregarCustos, estadoChave, rotacionarChave, apagarCliente,
 *   montarRelatorio, enviarRelatorio, montarRelatorioSocios, enviarRelatorioSocios
 */
export function criarRotasApi(d) {
  const router = express.Router();
  const agregador = d.agregador || criarAgregador({ limites: d.limites });
  const limiteIp = d.limiteIp || criarLimite(LIMITE_10MIN, DEZ_MIN);
  const limiteFalhas = d.limiteFalhas || criarLimite(LIMITE_FALHAS_10MIN, DEZ_MIN);
  const agora = d.agora || Date.now;
  if (!d.semAmostragem) iniciarAmostragem();

  let cacheResumo = null;
  function invalidar() {
    agregador.invalidar();
    cacheResumo = null;
  }

  router.use(headersSeguranca);

  // ── Autenticação: só Bearer da CAROL_ADMIN_KEY ──────────────────────────
  router.use((req, res, next) => {
    const ip = chaveIp(req.ip);
    if (limiteFalhas.uso(ip) >= limiteFalhas.max) return res.status(429).json({ erro: 'muitas tentativas com chave inválida', detalhes: 'aguarde 10 minutos' });
    if (!limiteIp(ip)) return res.status(429).json({ erro: 'muitas requisições' });
    if (!d.chaveAdmin) return res.status(503).json({ erro: 'API de administração desativada', detalhes: 'configure CAROL_ADMIN_KEY' });
    const auth = String(req.headers.authorization || '');
    const recebida = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!chaveConfere(recebida, d.chaveAdmin)) {
      if (recebida) {
        limiteFalhas(ip);
        auditarBase({ origem: 'sdr', evento: 'api_chave_invalida', ip, caminho: req.path.slice(0, 80) });
      }
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ erro: 'não autorizado', detalhes: recebida ? 'chave inválida' : 'envie Authorization: Bearer <CAROL_ADMIN_KEY>' });
    }
    req.ator = atorDe(req);
    next();
  });

  /** Registra uma ação de escrita com quem fez no SDR. */
  const auditar = (req, evento, extra = {}) => auditarBase({ origem: 'sdr', ator: req.ator, ip: chaveIp(req.ip), evento, ...extra });
  const por = (req) => (req.ator ? `sdr:${req.ator}` : 'sdr');

  /** Envolve handlers async: erro inesperado vira 500 em JSON, sem stack. */
  const rota = (contexto, fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`[admin/api] ${contexto}:`, e?.message || e);
      if (!res.headersSent) res.status(500).json({ erro: 'erro interno' });
    }
  };

  // ── Resumo para o polling de 5 s ────────────────────────────────────────
  function montarResumo() {
    const t = agora();
    if (cacheResumo && t - cacheResumo.em < CACHE_RESUMO_MS) return cacheResumo.valor;
    const e = agregador.estado();
    let saude = { geral: 'desconhecida', ts: null, problemas: [] };
    try {
      const s = d.ultimoEstado();
      if (s) {
        saude = {
          geral: s.geral,
          ts: s.ts || null,
          problemas: (s.resultados || [])
            .filter((r) => r.estado && r.estado !== 'ok')
            .slice(0, 6)
            .map((r) => ({ nome: r.nome, estado: r.estado, resumo: String(r.resumo || '').slice(0, 100) })),
        };
      }
    } catch {}
    let anomalias = { abertas: 0, criticas: 0, maisGrave: null };
    try {
      const abertas = d.resumoAnomalias(24).tipos.filter((x) => !x.recuperado);
      const g = [...abertas].sort((a, b) => (SEVERIDADE[a.severidade] ?? 9) - (SEVERIDADE[b.severidade] ?? 9) || String(b.ultima).localeCompare(String(a.ultima)))[0];
      anomalias = {
        abertas: abertas.length,
        criticas: abertas.filter((x) => x.severidade === 'critica').length,
        maisGrave: g ? { tipo: g.tipo, titulo: String(g.titulo || '').slice(0, 120), severidade: g.severidade, ocorrencias: g.ocorrencias, ultima: g.ultima } : null,
      };
    } catch {}
    let saldo = { status: 'nao_configurado', restante: null, credito: null };
    try {
      const s = d.saldoEstimado();
      const c = d.statusCredito();
      saldo = { status: statusSaldo(s, c), restante: s ? Math.round(s.restante * 100) / 100 : null, credito: s ? s.credito : null, creditoEsgotado: Boolean(c?.esgotado) };
    } catch {}
    const at = e.atendimento || {};
    const valor = {
      ts: t,
      carol: { status: e.carol.status, rotulo: e.carol.rotulo, motivo: e.carol.motivo, proxima: e.carol.proxima, regra: e.carol.regra },
      pausa: { ativa: e.pausa.ativa, indefinida: e.pausa.indefinida, ate: e.pausa.ate },
      atendimento: {
        ativas: at.ativas,
        mensagensHoje: at.mensagensHoje,
        clientesHoje: at.clientesHoje,
        porCanal: at.porCanal,
        respondendoAgora: at.respondendoAgora,
        respostaMediaMs: at.respostaMediaMs,
        respostaP90Ms: at.respostaP90Ms ?? null,
        falhasHoje: at.falhasHoje,
        semRespostaHoje: at.semRespostaHoje,
        respostasEquipeHoje: at.respostasEquipeHoje,
      },
      limites: e.limites ?? null,
      saude,
      anomalias,
      saldo,
      processo: { versao: e.maquina?.versao ?? null, uptimeS: e.maquina?.uptimeS ?? null, cpu: e.maquina?.cpu ?? null, rss: e.maquina?.rss ?? null },
    };
    cacheResumo = { em: t, valor };
    return valor;
  }

  router.get('/resumo', rota('resumo', (_req, res) => res.json(montarResumo())));
  router.get('/estado', rota('estado', (_req, res) => res.json(agregador.estado())));
  router.get('/detalhes', rota('detalhes', async (_req, res) => res.json(await agregador.detalhes())));
  router.get('/maquina', (_req, res) => res.json({ intervaloMs: INTERVALO_MS, pontos: serieMaquina() }));

  // ── Horário de atendimento ──────────────────────────────────────────────
  router.get('/horario', (_req, res) => res.json(horarioParaApi()));
  router.put('/horario', (req, res) => {
    try {
      const antes = obterHorario();
      const cfg = salvarHorario(req.body, { por: por(req) });
      auditar(req, 'horario', { antes: descreverRegra(antes), depois: descreverRegra(cfg) });
      invalidar();
      res.json(horarioParaApi());
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ erro: 'configuração inválida', detalhes: e.erros });
      console.error('[admin/api] salvar horário:', e.message);
      res.status(500).json({ erro: 'não consegui salvar' });
    }
  });
  router.delete('/horario', (req, res) => {
    const antes = obterHorario();
    const cfg = restaurarPadraoHorario();
    auditar(req, 'horario_padrao', { antes: descreverRegra(antes), depois: descreverRegra(cfg) });
    invalidar();
    res.json(horarioParaApi());
  });

  // ── Ligar / desligar ───────────────────────────────────────────────────
  router.post('/ligar', (req, res) => {
    const antes = retomar();
    auditar(req, 'ligar', { estavaDesligada: Boolean(antes.ativa) });
    invalidar();
    res.json({ ok: true, pausa: estadoPausa() });
  });
  router.post('/desligar', (req, res) => {
    const b = req.body || {};
    let e;
    if (b.ateReligar === true) {
      e = pausar({ indefinida: true, por: por(req) });
      auditar(req, 'desligar', { ateReligar: true });
    } else {
      const horas = Number(b.horas);
      if (b.horas === undefined || b.horas === null || b.horas === '' || !Number.isFinite(horas) || horas < HORAS_MIN || horas > HORAS_MAX_PAINEL) {
        return res.status(400).json({ erro: `horas deve ficar entre ${HORAS_MIN} e ${HORAS_MAX_PAINEL}`, detalhes: 'ou envie { "ateReligar": true }' });
      }
      e = pausar({ horas, por: por(req), maxHoras: HORAS_MAX_PAINEL });
      auditar(req, 'desligar', { horas, ate: e.ate });
    }
    invalidar();
    res.json({ ok: true, pausa: e });
  });

  // ── Saúde ──────────────────────────────────────────────────────────────
  router.get('/saude', (_req, res) => {
    res.json({ ...(d.ultimoEstado() || { geral: 'desconhecida', resultados: [] }), recursos: d.recursosConfigurados(), agenda: d.agenda.listar() });
  });
  router.post(
    '/saude/verificar',
    rota('saude/verificar', async (req, res) => {
      const r = await d.verificarTudo();
      auditar(req, 'saude_verificar', { geral: r?.geral });
      invalidar();
      res.json(r);
    })
  );

  // ── Anomalias ──────────────────────────────────────────────────────────
  router.get('/anomalias', (req, res) => {
    const horas = Math.min(Math.max(Number(req.query.horas) || 24, 1), 24 * 30);
    const resumo = d.resumoAnomalias(horas);
    res.json({ horas, resumo, abertas: resumo.tipos.filter((x) => !x.recuperado), lista: d.listarAnomalias(horas) });
  });
  router.post(
    '/anomalias/teste',
    rota('anomalias/teste', async (req, res) => {
      const canal = (req.body?.canal || req.query.canal) === 'whatsapp' ? 'whatsapp' : 'email';
      const r = await d.reportarAnomalia({
        tipo: 'saude_falha',
        titulo: 'Teste do canal de alertas',
        detalhe: `Disparo manual pelo SDR (seção Carol)${req.ator ? ` por ${req.ator}` : ''}. Se você recebeu este e-mail ou WhatsApp, os alertas estão funcionando.`,
        severidade: canal === 'whatsapp' ? 'critica' : 'alta',
        forcar: true,
      });
      auditar(req, 'anomalia_teste', { canal });
      res.json(r ?? { ok: true });
    })
  );

  // ── Agenda ─────────────────────────────────────────────────────────────
  router.get('/agenda', (_req, res) => res.json(d.agenda.listar()));
  router.post(
    '/agenda/executar/:tarefa',
    rota('agenda/executar', async (req, res) => {
      const nomes = d.agenda.listar().map((t) => t.nome);
      if (!nomes.includes(req.params.tarefa)) return res.status(404).json({ erro: 'tarefa inexistente', detalhes: { disponiveis: nomes } });
      auditar(req, 'agenda_executar', { tarefa: req.params.tarefa });
      res.json(await d.agenda.executarAgora(req.params.tarefa));
    })
  );

  // ── Custos e saldo ─────────────────────────────────────────────────────
  router.get(
    '/custos',
    rota('custos', (req, res) => {
      const c = d.agregarCustos(diasDe(req.query.dias));
      const credito = d.statusCredito();
      const base = req.query.completo === '1' ? c : custosCompactos(c);
      res.json({ ...base, credito, statusSaldo: statusSaldo(c.saldo, credito) });
    })
  );
  const saldoParaApi = () => {
    const s = d.saldoEstimado();
    const credito = d.statusCredito();
    return { ...(s || { configurado: false }), credito, status: statusSaldo(s, credito) };
  };
  router.get('/saldo', (_req, res) => res.json(saldoParaApi()));
  router.post('/saldo', (req, res) => {
    const usd = req.body?.usd ?? req.query.usd;
    if (usd === undefined || usd === null || usd === '') return res.status(400).json({ erro: 'informe usd', detalhes: 'saldo atual do console.anthropic.com, em dólares (ex.: { "usd": 25 })' });
    try {
      d.definirSaldo(usd, { por: por(req) });
    } catch (e) {
      return res.status(400).json({ erro: String(e.message).slice(0, 100) });
    }
    auditar(req, 'saldo', { usd: Number(String(usd).replace(',', '.')) });
    invalidar();
    res.json(saldoParaApi());
  });

  // ── Palavra-chave dos comandos /carol ─────────────────────────────────
  router.get('/chave', (_req, res) => res.json(d.estadoChave()));
  // Gera e manda por e-mail aos sócios; se o e-mail falhar, devolve a palavra
  // UMA vez nesta resposta (chamada autenticada com a chave de administrador).
  router.post('/chave/rotacionar', async (req, res) => {
    try {
      const r = await d.rotacionarChave({ exibir: true });
      auditar(req, 'chave_rotacionar', { canal: r.canal });
      res.json(
        r.canal === 'email'
          ? { ok: true, canal: 'email', enviadaPara: r.enviadaPara, validaAte: r.validaAte }
          : { ok: true, canal: 'tela', palavra: r.palavra, validaAte: r.validaAte, aviso: 'E-mail indisponível: anote a palavra agora, ela não será mostrada de novo.' }
      );
    } catch (e) {
      console.error('[admin/api] palavra-chave:', e.message);
      res.status(500).json({ erro: 'não consegui gerar a palavra-chave' });
    }
  });

  // ── LGPD ───────────────────────────────────────────────────────────────
  router.post(
    '/cliente/apagar',
    rota('cliente/apagar', async (req, res) => {
      const { telefone, sessao } = req.body || {};
      if (!telefone && !sessao) return res.status(400).json({ erro: 'informe telefone (ou sessao)' });
      const r = await d.apagarCliente({ telefone, sessao }, { por: por(req) });
      auditar(req, 'lgpd_apagar', { ok: r.ok, sessoes: r.sessoes });
      if (!r.sessoes?.length) return res.status(400).json({ erro: 'telefone ou sessão inválido', detalhes: r });
      res.status(r.ok ? 200 : 207).json(r);
    })
  );

  // ── Relatórios ─────────────────────────────────────────────────────────
  router.get(
    '/relatorio',
    rota('relatorio', async (_req, res) => {
      const { assunto, corpo } = await d.montarRelatorio();
      res.json({ assunto, corpo });
    })
  );
  router.post(
    '/relatorio',
    rota('relatorio', async (req, res) => {
      const r = await d.enviarRelatorio();
      auditar(req, 'relatorio_enviar');
      res.json(r);
    })
  );
  router.get(
    '/relatorio-socios',
    rota('relatorio-socios', async (_req, res) => {
      const { assunto, corpo, status } = await d.montarRelatorioSocios();
      res.json({ assunto, corpo, status: status ?? null });
    })
  );
  router.post(
    '/relatorio-socios',
    rota('relatorio-socios', async (req, res) => {
      const r = await d.enviarRelatorioSocios();
      auditar(req, 'relatorio_socios_enviar');
      res.json(r);
    })
  );

  // ── Auditoria ──────────────────────────────────────────────────────────
  router.get('/auditoria', (req, res) => {
    const n = Math.min(Math.max(Number(req.query.linhas) || 100, 1), 1000);
    res.json(lerAuditoria(n, d.dataDir ? { dir: d.dataDir } : undefined));
  });

  router.use((_req, res) => res.status(404).json({ erro: 'não encontrado' }));
  return router;
}
