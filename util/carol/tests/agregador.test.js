import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dataDirTemporario, fetchFalso, relogio } from './_setup.js';

delete process.env.CAROL_24H;
const dir = dataDirTemporario();
const S = await import('../src/admin/seguranca.js');
const A = await import('../src/admin/atendimento.js');
const { criarMetricasRailway, resumirMetricas } = await import('../src/admin/railway.js');
const { criarLimite } = await import('../src/util/limite.js');
const { criarBuffer, medirResposta, estatisticaRespostas } = await import('../src/admin/maquina.js');
const { criarAgregador, estadoCarol } = await import('../src/admin/agregador.js');
const { pausar, retomar, estadoPausa, HORAS_MAX_PAINEL } = await import('../src/comandos/pausa.js');

// ── Segurança ─────────────────────────────────────────────────────────────
test('chave comparada em tempo constante, sem quebrar com tamanhos diferentes', () => {
  assert.equal(S.chaveConfere('abc', 'abc'), true);
  assert.equal(S.chaveConfere('abcd', 'abc'), false);
  assert.equal(S.chaveConfere('', 'abc'), false);
  assert.equal(S.chaveConfere('abc', ''), false, 'sem chave configurada nada confere');
  assert.equal(S.chaveConfere(undefined, 'abc'), false);
});

test('portal: CAROL_PORTAL_URL só http(s); qualquer outra coisa cai no padrão', () => {
  assert.equal(S.urlPortal('https://sdr.exemplo.com/sdr/admin/carol'), 'https://sdr.exemplo.com/sdr/admin/carol');
  assert.equal(S.urlPortal(''), S.PORTAL_PADRAO);
  assert.equal(S.urlPortal('javascript:alert(1)'), S.PORTAL_PADRAO);
  assert.equal(S.urlPortal('/relativo'), S.PORTAL_PADRAO);
  assert.equal(S.PORTAL_PADRAO, 'https://sdr-backend-production.up.railway.app/sdr/admin/carol');
});

test('rate limit por IP: bloqueia após o teto e libera depois da janela', () => {
  const agora = relogio();
  const lim = criarLimite(3, 60000, { agora });
  assert.deepEqual([lim('ip'), lim('ip'), lim('ip'), lim('ip')], [true, true, true, false]);
  assert.equal(lim('outro-ip'), true, 'por IP');
  assert.equal(lim.uso('ip'), 4);
  agora.avancar(60001);
  assert.equal(lim.uso('ip'), 0);
  assert.equal(lim('ip'), true);
});

// ── Mascaramento ──────────────────────────────────────────────────────────
test('mascaramento de telefone e sessão', () => {
  assert.equal(A.mascararTelefone('5541984151085'), '55419****1085');
  assert.equal(A.mascararTelefone('+55 (41) 98415-1085'), '55419****1085');
  assert.equal(A.mascararTelefone('123'), '****');
  assert.equal(A.mascararTelefone(''), '');
  assert.equal(A.mascararSessao('wa:5541984151085'), '55419****1085');
  assert.equal(A.mascararSessao('site:abcdef1234567890'), 'site abcd…');
  assert.equal(A.mascararSessao('sistema:resumo'), 'sistema');
  assert.equal(A.trecho('[Cliente: João] [Mensagem de voz do cliente, transcrita automaticamente]  Oi,   tudo bem?'), 'Oi, tudo bem?');
  assert.equal(A.trecho('x'.repeat(100)).length, 60);
});

// ── Agregação e leitura incremental ───────────────────────────────────────
function linha(iso, sessao, mensagem, extra = {}) {
  return JSON.stringify({ ts: iso, canal: sessao.startsWith('site:') ? 'site' : 'whatsapp', sessao, mensagem, resposta: 'resposta longa da Carol', ...extra }) + '\n';
}

test('agregação do dia (fuso de Brasília) e leitura incremental do JSONL', () => {
  const d = fs.mkdtempSync(path.join(dir, 'agr-'));
  // 21/10 13:00 BRT = 16:00Z. O dia local começa 21/10 03:00Z: o arquivo de 21/10 UTC
  // tem uma mensagem de ontem (02:00Z = 23:00 BRT do dia 20).
  fs.writeFileSync(path.join(d, 'registro-2026-10-21.jsonl'),
    linha('2026-10-21T02:00:00.000Z', 'wa:5541999990001', 'ontem à noite') +
    linha('2026-10-21T12:10:00.000Z', 'wa:5541999990001', '[Cliente: Ana] Tem a bomba?') +
    linha('2026-10-21T12:20:00.000Z', 'wa:5541999990001', 'e o preço?') +
    linha('2026-10-21T15:40:00.000Z', 'site:abcdefghijklmnop', 'oi pelo site') +
    linha('2026-10-21T15:41:00.000Z', 'sistema:resumo', 'resumo', { tipo: 'sistema', canal: 'sistema' }));
  const leitor = A.criarLeitor();
  const agora = Date.parse('2026-10-21T16:00:00.000Z');
  const r = A.resumoAtendimento({ leitor, dir: d, agora });
  assert.equal(r.mensagensHoje, 3, 'ignora ontem e o sistema');
  assert.equal(r.clientesHoje, 2);
  assert.equal(r.ativas, 1, 'só o site falou nos últimos 30 min');
  assert.deepEqual(r.porCanal, { whatsapp: 2, site: 1 });
  assert.equal(r.porHora[9], 2, '12:10Z = 9h BRT');
  assert.equal(r.porHora[12], 1);
  assert.equal(r.ultimas[0].quem, 'site abcd…');
  assert.equal(r.ultimas[0].trecho, 'oi pelo site');
  assert.ok(!JSON.stringify(r).includes('5541999990001'), 'telefone completo não sai');
  assert.ok(!JSON.stringify(r).includes('resposta longa'), 'resposta da Carol não sai');

  const lidosAntes = leitor.stats.bytesLidos;
  A.resumoAtendimento({ leitor, dir: d, agora });
  assert.equal(leitor.stats.bytesLidos, lidosAntes, 'sem novidade, não lê nada');

  // linha nova, gravada em duas partes (a primeira sem \n ainda)
  const nova = linha('2026-10-21T15:59:00.000Z', 'wa:5541988887777', 'chegou agora');
  fs.appendFileSync(path.join(d, 'registro-2026-10-21.jsonl'), nova.slice(0, 20));
  let r2 = A.resumoAtendimento({ leitor, dir: d, agora });
  assert.equal(r2.mensagensHoje, 3, 'linha incompleta espera');
  fs.appendFileSync(path.join(d, 'registro-2026-10-21.jsonl'), nova.slice(20));
  r2 = A.resumoAtendimento({ leitor, dir: d, agora });
  assert.equal(r2.mensagensHoje, 4);
  assert.equal(r2.ativas, 2);
  assert.equal(leitor.stats.bytesLidos - lidosAntes, Buffer.byteLength(nova), 'leu só o acrescentado');

  // arquivo recriado menor: relê do zero
  fs.writeFileSync(path.join(d, 'registro-2026-10-21.jsonl'), linha('2026-10-21T15:50:00.000Z', 'wa:5541911112222', 'novo'));
  assert.equal(A.resumoAtendimento({ leitor, dir: d, agora }).mensagensHoje, 1);
});

test('picos: hoje x média de 7 dias, pico do dia e heatmap por dia da semana', () => {
  const d = fs.mkdtempSync(path.join(dir, 'pic-'));
  // 7 dias anteriores com 7 mensagens às 10h BRT (13Z) → média 7 nessa hora
  for (let i = 1; i <= 7; i++) {
    const dia = new Date(Date.parse('2026-10-21T13:00:00.000Z') - i * 86400000).toISOString().slice(0, 10);
    let txt = '';
    for (let k = 0; k < 7; k++) txt += linha(`${dia}T13:0${k}:00.000Z`, `wa:55419000000${k}`, 'x');
    fs.writeFileSync(path.join(d, `registro-${dia}.jsonl`), txt);
  }
  const picos = A.criarPicos({ dir: d });
  const hoje = new Array(24).fill(0);
  hoje[14] = 5;
  hoje[9] = 2;
  const p = picos({ porHoraHoje: hoje, agora: Date.parse('2026-10-21T18:00:00.000Z') });
  assert.equal(p.media7[10], 7);
  assert.equal(p.media7[9], 0);
  assert.deepEqual(p.picoHoje, { hora: 14, n: 5 });
  assert.equal(p.total30d, 49);
  // cada dia da semana aparece ~4x em 30 dias; o pico é às 10h
  assert.equal(p.picoSemana.hora, 10);
  assert.ok(p.heatmap.every((l) => l.length === 24) && p.heatmap.length === 7);
});

test('agregador: estado pequeno, com cache curto e invalidação após ação', () => {
  const d = fs.mkdtempSync(path.join(dir, 'pnl-'));
  const agora = relogio(Date.parse('2026-10-21T16:00:00.000Z'));
  fs.writeFileSync(path.join(d, 'registro-2026-10-21.jsonl'), linha('2026-10-21T15:59:00.000Z', 'wa:5541984151085', 'oi'));
  const painel = criarAgregador({ dir: d, agora, limites: () => ({ whatsapp: { usado: 3, max: 300 } }), resumoAnomalias: () => ({ tipos: [] }), ultimoEstadoSaude: () => null, metricasRailway: async () => ({ disponivel: false }) });
  retomar();
  const e1 = painel.estado();
  assert.ok(Buffer.byteLength(JSON.stringify(e1)) < 5 * 1024, 'menos de 5 KB');
  assert.equal(e1.atendimento.mensagensHoje, 1);
  assert.equal(e1.limites.whatsapp.usado, 3);
  assert.equal(e1.ultimas[0].quem, '55419****1085');
  fs.appendFileSync(path.join(d, 'registro-2026-10-21.jsonl'), linha('2026-10-21T15:59:30.000Z', 'wa:5541984151086', 'oi2'));
  agora.avancar(1000);
  assert.equal(painel.estado(), e1, 'dentro de 4 s devolve o cache');
  painel.invalidar();
  assert.equal(painel.estado().atendimento.mensagensHoje, 2);
});

test('estado da Carol: atendendo, em silêncio e desligada (com prazo e sem prazo)', () => {
  const exp = { dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' };
  const cfg = { versao: 1, modo: 'fora_expediente', expediente: exp, janelas: [] };
  const meioDia = Date.parse('2026-10-21T15:00:00.000Z'); // quarta 12h BRT
  const s = estadoCarol({ agora: meioDia, pausa: { ativa: false }, cfg });
  assert.equal(s.status, 'silencio');
  assert.equal(s.proxima.texto, 'volta a atender hoje às 18:00');
  const n = estadoCarol({ agora: Date.parse('2026-10-21T23:00:00.000Z'), pausa: { ativa: false }, cfg });
  assert.equal(n.status, 'atendendo');
  assert.equal(n.proxima.texto, 'fica em silêncio amanhã às 08:00');
  const p = estadoCarol({ agora: Date.parse('2026-10-21T22:00:00.000Z'), pausa: { ativa: true, ate: '2026-10-22T00:00:00.000Z' }, cfg });
  assert.equal(p.status, 'desligada');
  assert.equal(p.proxima.texto, 'volta a atender hoje às 21:00');
  const ind = estadoCarol({ agora: meioDia, pausa: { ativa: true, indefinida: true }, cfg });
  assert.equal(ind.status, 'desligada');
  assert.equal(ind.proxima, null);
});

test('desligar pela API (SDR): até religar e por mais de 12h', () => {
  const agora = relogio();
  const e = pausar({ indefinida: true, por: 'sdr:guilherme', agora });
  assert.equal(e.ativa, true);
  assert.equal(e.indefinida, true);
  agora.avancar(30 * 86400000);
  assert.equal(estadoPausa({ agora }).ativa, true, 'não expira sozinha');
  retomar({ agora });
  assert.equal(estadoPausa({ agora }).ativa, false);
  assert.equal(pausar({ horas: 48, maxHoras: HORAS_MAX_PAINEL, agora }).horas, 48);
  assert.equal(pausar({ horas: 500, maxHoras: HORAS_MAX_PAINEL, agora }).horas, HORAS_MAX_PAINEL);
  assert.equal(pausar({ horas: 48, agora }).horas, 12, 'sem maxHoras vale o teto dos comandos');
  retomar({ agora });
});

// ── Máquina ───────────────────────────────────────────────────────────────
test('buffer circular guarda os N mais recentes em ordem', () => {
  const b = criarBuffer(3);
  [1, 2, 3, 4, 5].forEach((x) => b.push(x));
  assert.deepEqual(b.lista(), [3, 4, 5]);
  assert.equal(b.ultimo(), 5);
});

test('tempo de resposta medido em volta da chamada, sem mudar o resultado', async () => {
  assert.equal(await medirResposta('site', async () => 'ok'), 'ok');
  await assert.rejects(medirResposta('site', async () => { throw new Error('falhou'); }), /falhou/);
  const s = estatisticaRespostas(0);
  assert.equal(s.medidas, 1);
  assert.equal(s.falhas, 1);
  assert.equal(s.emAndamento, 0);
  assert.ok(s.mediaMs >= 0);
});

// ── Railway ───────────────────────────────────────────────────────────────
const RESPOSTA_RW = {
  data: {
    metrics: [
      { measurement: 'CPU_USAGE', values: [{ ts: 1792500000, value: 0.05 }, { ts: 1792500600, value: 0.42 }] },
      { measurement: 'MEMORY_USAGE_GB', values: [{ ts: 1792500000, value: 0.1 }, { ts: 1792500600, value: 0.2 }] },
      { measurement: 'NETWORK_RX_GB', values: [{ ts: 1792500000, value: 0.001 }] },
    ],
  },
};
const ENV_RW = { RAILWAY_API_TOKEN: 'tok', RAILWAY_SERVICE_ID: 'svc', RAILWAY_ENVIRONMENT_ID: 'env' };

test('Railway: sem configuração não chama a API', async () => {
  const f = fetchFalso({});
  const r = await criarMetricasRailway({ fetchFn: f, env: {} })();
  assert.equal(r.disponivel, false);
  assert.equal(f.chamadas.length, 0);
});

test('Railway: converte métricas, cacheia 60 s e usa o header do tipo de token', async () => {
  const agora = relogio();
  const f = fetchFalso({ 'backboard.railway.com': { corpo: RESPOSTA_RW } });
  const ler = criarMetricasRailway({ fetchFn: f, agora, env: ENV_RW });
  const r = await ler();
  assert.equal(r.disponivel, true);
  assert.deepEqual(r.picoCpu, { em: 1792500600000, valor: 42 });
  assert.equal(r.picoMemoria.valor, 205);
  assert.equal(f.chamadas[0].opts.headers['project-access-token'], 'tok');
  const corpo = JSON.parse(f.chamadas[0].opts.body);
  assert.equal(corpo.variables.serviceId, 'svc');
  assert.deepEqual(corpo.variables.measurements, ['CPU_USAGE', 'MEMORY_USAGE_GB', 'NETWORK_RX_GB', 'NETWORK_TX_GB']);
  agora.avancar(30000);
  await ler();
  assert.equal(f.chamadas.length, 1, 'cache de 60 s');
  agora.avancar(31000);
  await ler();
  assert.equal(f.chamadas.length, 2);

  const f2 = fetchFalso({ 'backboard.railway.com': { corpo: RESPOSTA_RW } });
  await criarMetricasRailway({ fetchFn: f2, env: { ...ENV_RW, RAILWAY_TOKEN_TIPO: 'conta' } })();
  assert.equal(f2.chamadas[0].opts.headers.authorization, 'Bearer tok');
  assert.equal(f2.chamadas[0].opts.headers['project-access-token'], undefined);
});

test('Railway: falha silenciosa (HTTP, erro GraphQL, rede) e mantém o último dado bom', async () => {
  const agora = relogio();
  let modo = 'ok';
  const f = fetchFalso({
    'backboard.railway.com': () => {
      if (modo === 'rede') throw new Error('ECONNRESET');
      if (modo === 'graphql') return { corpo: { errors: [{ message: 'Not Authorized' }] } };
      if (modo === 'http') return { status: 500, corpo: 'erro' };
      return { corpo: RESPOSTA_RW };
    },
  });
  const sozinho = async (m) => {
    modo = m;
    return criarMetricasRailway({ fetchFn: f, agora, env: ENV_RW })();
  };
  for (const m of ['rede', 'graphql', 'http']) {
    const r = await sozinho(m);
    assert.equal(r.disponivel, false, m);
    assert.equal(r.motivo, 'métricas do Railway indisponíveis');
  }
  const ler = criarMetricasRailway({ fetchFn: f, agora, env: ENV_RW });
  modo = 'ok';
  await ler();
  modo = 'rede';
  agora.avancar(61000);
  const r = await ler();
  assert.equal(r.disponivel, true);
  assert.equal(r.desatualizado, true);
});

test('Railway: resumo tolera ts em ISO e valores inválidos', () => {
  const r = resumirMetricas([{ measurement: 'CPU_USAGE', values: [{ ts: '2026-10-21T00:00:00Z', value: 0.1 }, { ts: 'x', value: 1 }, { ts: 1, value: 'nada' }] }]);
  assert.equal(r.cpu.length, 1);
  assert.equal(r.picoMemoria, null);
});
