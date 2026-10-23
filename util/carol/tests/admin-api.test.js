// API de administração (/admin/api/*) de ponta a ponta, no app real (app.js)
// num servidor efêmero em 127.0.0.1, com as dependências pesadas falsas
// (e-mail, verificadores, relatórios). Horário, pausa e auditoria são reais,
// gravando na pasta temporária de dados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dataDirTemporario } from './_setup.js';

delete process.env.CAROL_24H;
delete process.env.DATABASE_URL;
const dir = dataDirTemporario();
const { criarApp } = await import('../src/app.js');
const { criarTetos } = await import('../src/util/tetoDiario.js');
const { criarLimite } = await import('../src/util/limite.js');
const { pararAmostragem } = await import('../src/admin/maquina.js');
const { retomar } = await import('../src/comandos/pausa.js');
const { LIMITE_10MIN, CACHE_RESUMO_MS, statusSaldo } = await import('../src/admin/api.js');

const ADMIN = 'chave-admin-de-teste-123';
const SDR = 'chave-sdr-de-teste-456';
const chamadas = { apagar: [], saldo: [], executar: [], relatorio: 0, rotacionar: 0 };
let saldoUsd = 30;

const admin = {
  ultimoEstado: () => ({ geral: 'aviso', ts: '2026-10-23T12:00:00.000Z', resultados: [{ nome: 'whatsapp', estado: 'ok', resumo: 'token ok' }, { nome: 'email', estado: 'aviso', resumo: 'provedor reserva' }] }),
  verificarTudo: async () => ({ geral: 'ok', resultados: [] }),
  recursosConfigurados: () => ({ emailHttp: true }),
  agenda: {
    listar: () => [{ nome: 'relatorio_dai', quando: { hora: 8 }, proxima: '2026-10-24T11:00:00.000Z' }],
    executarAgora: async (nome) => {
      chamadas.executar.push(nome);
      return { ok: true, resumo: 'feito', motivo: 'manual' };
    },
  },
  resumoAnomalias: () => ({
    total: 3,
    criticas: 1,
    altas: 1,
    medias: 0,
    tipos: [
      { tipo: 'email_falha', titulo: 'E-mail falhou', severidade: 'alta', ocorrencias: 2, ultima: '2026-10-23T11:00:00.000Z', recuperado: false },
      { tipo: 'whatsapp_token', titulo: 'Token do WhatsApp expirado', severidade: 'critica', ocorrencias: 1, ultima: '2026-10-23T10:00:00.000Z', recuperado: false },
      { tipo: 'catalogo_falha', titulo: 'Catálogo', severidade: 'critica', ocorrencias: 1, ultima: '2026-10-23T09:00:00.000Z', recuperado: true },
    ],
  }),
  listarAnomalias: () => [{ tipo: 'email_falha', ts: '2026-10-23T11:00:00.000Z' }],
  reportarAnomalia: async (a) => ({ enviado: true, severidade: a.severidade }),
  saldoEstimado: () => ({ credito: 50, desde: '2026-10-01T00:00:00.000Z', gasto: 50 - saldoUsd, restante: saldoUsd, desatualizado: false, origem: 'painel' }),
  definirSaldo: (usd, o) => {
    const v = Number(usd);
    if (!Number.isFinite(v) || v < 0) throw new Error('valor de saldo inválido');
    chamadas.saldo.push({ usd: v, por: o.por });
    saldoUsd = v;
  },
  statusCredito: () => ({ esgotado: false, desde: null }),
  agregarCustos: (dias) => ({ periodo: { dias }, totais: { custo: 1.5 }, porDia: [], porCanal: {}, projecao: { mensal: 6 }, saldo: { restante: saldoUsd }, conversasCompletas: [{ msgs: [] }], mensagensCaras: [] }),
  estadoChave: () => ({ validaAte: '2026-10-30T00:00:00.000Z' }),
  rotacionarChave: async (o) => {
    chamadas.rotacionar++;
    assert.equal(o.exibir, true);
    return { canal: 'tela', palavra: 'agro-trator-42', validaAte: '2026-10-30T00:00:00.000Z', enviadaPara: [] };
  },
  apagarCliente: async (alvo, o) => {
    chamadas.apagar.push({ alvo, por: o.por });
    return { ok: true, sessoes: ['55419****0001'], registro: 2, memoria: [] };
  },
  montarRelatorio: async () => ({ assunto: 'Carol: relatório', corpo: 'corpo do relatório', resumo: { conversas: [{ telefone: '5541999990001' }] } }),
  enviarRelatorio: async () => {
    chamadas.relatorio++;
    return { enviado: true, canal: 'email' };
  },
  montarRelatorioSocios: async () => ({ assunto: 'Carol: executivo', corpo: 'corpo executivo', status: 'OK' }),
  enviarRelatorioSocios: async () => ({ enviado: true, canal: 'email' }),
};

let servidor;
let base;
let servidorFalhas;
let baseFalhas;

function subir(over) {
  const { app } = criarApp({ chaveAdmin: ADMIN, chaveSdr: SDR, tetos: criarTetos({ persistir: false }), portalUrl: 'https://sdr.exemplo.com/sdr/admin/carol', reportarAnomalia: async () => {}, admin, ...over });
  return new Promise((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
}

before(async () => {
  retomar();
  servidor = await subir();
  base = `http://127.0.0.1:${servidor.address().port}/admin/api`;
  servidorFalhas = await subir({ admin: { ...admin, limiteFalhas: criarLimite(3, 60000) } });
  baseFalhas = `http://127.0.0.1:${servidorFalhas.address().port}/admin/api`;
});
after(() => {
  servidor.close();
  servidorFalhas.close();
  pararAmostragem();
  retomar();
});

const h = (extra = {}) => ({ authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json', ...extra });
const get = (c, extra) => fetch(`${base}${c}`, { headers: h(extra) });
const enviar = (metodo, c, corpo, extra) => fetch(`${base}${c}`, { method: metodo, headers: h(extra), body: corpo === undefined ? undefined : JSON.stringify(corpo) });

function auditoria() {
  try {
    return fs.readFileSync(path.join(dir, 'auditoria.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

test('autenticação: sem Bearer 401, Bearer errado 401, chave do SDR 401, ?key= 401; Bearer certo 200', async () => {
  const sem = await fetch(`${base}/estado`);
  assert.equal(sem.status, 401);
  assert.equal(sem.headers.get('www-authenticate'), 'Bearer');
  const j = await sem.json();
  assert.equal(j.erro, 'não autorizado');
  assert.ok(j.detalhes);
  assert.equal((await fetch(`${base}/estado`, { headers: { authorization: 'Bearer errada' } })).status, 401);
  assert.equal((await fetch(`${base}/estado`, { headers: { authorization: `Bearer ${SDR}` } })).status, 401, 'SDR_SYNC_KEY só vale para /admin/exportar');
  assert.equal((await fetch(`${base}/estado?key=${ADMIN}`)).status, 401);
  assert.equal((await fetch(`${base}/estado`, { headers: { cookie: 'carol_painel=v1.9999999999999.a.b' } })).status, 401, 'sessão por cookie não existe mais');
  assert.equal((await fetch(`${base}/ligar`, { method: 'POST' })).status, 401, 'escrita sem Bearer');
  const ok = await get('/estado');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control'), /no-store/);
  assert.equal(ok.headers.get('x-frame-options'), 'DENY');
  assert.ok(ok.headers.get('content-security-policy'));
});

test('chave errada repetida bloqueia o IP (429) por 10 min, inclusive com a chave certa', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${baseFalhas}/estado`, { headers: { authorization: 'Bearer errada' } })).status, 401);
  const r = await fetch(`${baseFalhas}/estado`, { headers: h() });
  assert.equal(r.status, 429);
  assert.ok((await r.json()).erro);
  assert.ok(auditoria().some((e) => e.evento === 'api_chave_invalida' && e.origem === 'sdr'));
});

test('limite por IP dimensionado para ~10 abas com polling de 5 s', () => {
  // 10 abas × (resumo + estado) a cada 5 s = 2.400 em 10 min, mais detalhes/máquina
  assert.ok(LIMITE_10MIN >= 2600, `limite ${LIMITE_10MIN}`);
});

test('estado: mesmo JSON do antigo painel (carol, pausa, atendimento, limites, crédito, máquina)', async () => {
  const e = await (await get('/estado')).json();
  for (const k of ['ts', 'carol', 'pausa', 'atendimento', 'ultimas', 'limites', 'credito', 'maquina']) assert.ok(k in e, k);
  assert.ok(['atendendo', 'silencio', 'desligada'].includes(e.carol.status));
  assert.ok(e.carol.rotulo && e.carol.regra && e.carol.origemRegra);
  assert.equal(e.limites.whatsapp.max > 0, true);
  assert.equal(typeof e.atendimento.mensagensHoje, 'number');
});

test('detalhes e máquina', async () => {
  const d = await (await get('/detalhes')).json();
  for (const k of ['ts', 'picos', 'saude', 'anomalias', 'railway']) assert.ok(k in d, k);
  assert.equal(d.railway.disponivel, false, 'sem RAILWAY_API_TOKEN não chama a API');
  const m = await (await get('/maquina')).json();
  assert.equal(m.intervaloMs, 5000);
  assert.ok(Array.isArray(m.pontos) && m.pontos.length >= 1);
});

test('resumo: pequeno (< 5 KB), com saúde, anomalias, saldo; cache de 4 s invalidado por ação', async () => {
  const r = await get('/resumo');
  assert.equal(r.status, 200);
  const texto = await r.text();
  assert.ok(Buffer.byteLength(texto) < 5 * 1024, `${Buffer.byteLength(texto)} bytes`);
  const j = JSON.parse(texto);
  assert.ok(['atendendo', 'silencio', 'desligada'].includes(j.carol.status));
  assert.equal(j.saude.geral, 'aviso');
  assert.deepEqual(j.saude.problemas.map((p) => p.nome), ['email'], 'só os que não estão ok');
  assert.equal(j.anomalias.abertas, 2, 'recuperada não conta');
  assert.equal(j.anomalias.criticas, 1);
  assert.equal(j.anomalias.maisGrave.tipo, 'whatsapp_token', 'crítica antes de alta');
  assert.equal(j.saldo.status, 'ok');
  assert.equal(j.saldo.restante, saldoUsd);
  assert.ok('ultimas' in j === false, 'sem a lista de conversas');
  assert.equal(CACHE_RESUMO_MS, 4000);
  const de2 = await (await get('/resumo')).json();
  assert.equal(de2.ts, j.ts, 'dentro de 4 s devolve o cache');
  // ação invalida o cache: o próximo polling já mostra DESLIGADA
  assert.equal((await enviar('POST', '/desligar', { horas: 1 })).status, 200);
  const depois = await (await get('/resumo')).json();
  assert.equal(depois.carol.status, 'desligada');
  assert.equal(depois.pausa.ativa, true);
  await enviar('POST', '/ligar');
});

test('statusSaldo: esgotado > não configurado > desatualizado > baixo > ok', () => {
  assert.equal(statusSaldo({ restante: 10 }, { esgotado: true }), 'esgotado');
  assert.equal(statusSaldo(null, {}), 'nao_configurado');
  assert.equal(statusSaldo({ restante: 10, desatualizado: true }, {}), 'desatualizado');
  assert.equal(statusSaldo({ restante: 2 }, {}, 5), 'baixo');
  assert.equal(statusSaldo({ restante: 20 }, {}, 5), 'ok');
});

test('ligar/desligar: horas, até religar, validação 400 e X-Ator na auditoria', async () => {
  const d = await enviar('POST', '/desligar', { horas: 48 }, { 'x-ator': 'guilherme' });
  assert.equal(d.status, 200);
  const jd = await d.json();
  assert.equal(jd.ok, true);
  assert.equal(jd.pausa.ativa, true);
  assert.equal(jd.pausa.horas, 48, 'pela API vale até 72 h');
  assert.equal(jd.pausa.por, 'sdr:guilherme');
  const ev = auditoria().at(-1);
  assert.equal(ev.evento, 'desligar');
  assert.equal(ev.origem, 'sdr');
  assert.equal(ev.ator, 'guilherme');
  assert.equal(ev.horas, 48);

  for (const corpo of [{}, { horas: 0.1 }, { horas: 100 }, { horas: 'abc' }, { ateReligar: 'sim' }]) {
    const r = await enviar('POST', '/desligar', corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.ok((await r.json()).erro);
  }

  const ind = await (await enviar('POST', '/desligar', { ateReligar: true }, { 'x-ator': 'dai' })).json();
  assert.equal(ind.pausa.indefinida, true);
  assert.equal((await (await get('/estado')).json()).carol.status, 'desligada');

  const l = await (await enviar('POST', '/ligar', undefined, { 'x-ator': 'dai' })).json();
  assert.equal(l.ok, true);
  assert.equal(l.pausa.ativa, false);
  const ultimo = auditoria().at(-1);
  assert.equal(ultimo.evento, 'ligar');
  assert.equal(ultimo.ator, 'dai');
  assert.equal(ultimo.estavaDesligada, true);
});

test('X-Ator é limpo (sem HTML, até 60 caracteres); ausente vira null', async () => {
  await enviar('POST', '/ligar', undefined, { 'x-ator': '<b>gui</b>"; drop' });
  assert.equal(auditoria().at(-1).ator, 'bguib drop');
  await enviar('POST', '/ligar', undefined, { 'x-ator': 'x'.repeat(200) });
  assert.equal(auditoria().at(-1).ator.length, 60);
  await enviar('POST', '/ligar');
  assert.equal(auditoria().at(-1).ator, null);
});

test('horário: GET, PUT válido (atualizadoPor sdr:<ator>), PUT inválido 400, DELETE volta ao padrão', async () => {
  const g = await (await get('/horario')).json();
  for (const k of ['config', 'regra', 'expediente', 'origem', 'origemTexto', 'presets']) assert.ok(k in g, k);
  assert.equal(g.origem, 'variavel');

  const corpo = { modo: 'personalizado', expediente: { dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' }, janelas: [{ dias: [6], inicio: '12:00', fim: '24:00' }] };
  const p = await enviar('PUT', '/horario', corpo, { 'x-ator': 'guilherme' });
  assert.equal(p.status, 200);
  const jp = await p.json();
  assert.equal(jp.origem, 'painel', 'regra salva (identificador mantido por compatibilidade)');
  assert.equal(jp.config.modo, 'personalizado');
  assert.equal(jp.config.atualizadoPor, 'sdr:guilherme');
  assert.match(jp.origemTexto, /SDR/);
  const ev = auditoria().at(-1);
  assert.equal(ev.evento, 'horario');
  assert.equal(ev.ator, 'guilherme');
  assert.ok(ev.antes && ev.depois);

  const inv = await enviar('PUT', '/horario', { modo: 'qualquer' });
  assert.equal(inv.status, 400);
  const ji = await inv.json();
  assert.equal(ji.erro, 'configuração inválida');
  assert.ok(Array.isArray(ji.detalhes) && ji.detalhes.length);

  const del = await enviar('DELETE', '/horario', undefined, { 'x-ator': 'guilherme' });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).origem, 'variavel');
  assert.equal(auditoria().at(-1).evento, 'horario_padrao');
});

test('agenda: lista; executar tarefa existente; inexistente 404 com as disponíveis', async () => {
  const l = await (await get('/agenda')).json();
  assert.equal(l[0].nome, 'relatorio_dai');
  const ok = await enviar('POST', '/agenda/executar/relatorio_dai', undefined, { 'x-ator': 'guilherme' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  assert.deepEqual(chamadas.executar, ['relatorio_dai']);
  assert.equal(auditoria().at(-1).tarefa, 'relatorio_dai');
  const nao = await enviar('POST', '/agenda/executar/nao_existe');
  assert.equal(nao.status, 404);
  const jn = await nao.json();
  assert.equal(jn.erro, 'tarefa inexistente');
  assert.deepEqual(jn.detalhes.disponiveis, ['relatorio_dai']);
  assert.deepEqual(chamadas.executar, ['relatorio_dai'], 'não tentou executar');
});

test('saldo: POST { usd } registra (por sdr:<ator>), valida e devolve o saldo; GET mostra status', async () => {
  const r = await enviar('POST', '/saldo', { usd: 25 }, { 'x-ator': 'guilherme' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.restante, 25);
  assert.equal(j.status, 'ok');
  assert.deepEqual(chamadas.saldo.at(-1), { usd: 25, por: 'sdr:guilherme' });
  assert.equal(auditoria().at(-1).evento, 'saldo');
  assert.equal(auditoria().at(-1).usd, 25);
  assert.equal((await enviar('POST', '/saldo', {})).status, 400, 'sem valor');
  const inv = await enviar('POST', '/saldo', { usd: -3 });
  assert.equal(inv.status, 400);
  assert.match((await inv.json()).erro, /inválido/);
  const g = await (await get('/saldo')).json();
  assert.equal(g.restante, 25);
  assert.equal(g.credito.esgotado, false);
});

test('custos: compacto por padrão (sem conversas), completo=1 traz tudo; dias fora da lista vira 7', async () => {
  const c = await (await get('/custos?dias=30')).json();
  assert.equal(c.periodo.dias, 30);
  assert.equal(c.conversasCompletas, undefined);
  assert.equal(c.statusSaldo, 'ok');
  assert.ok(c.credito);
  const t = await (await get('/custos?dias=30&completo=1')).json();
  assert.ok(Array.isArray(t.conversasCompletas));
  assert.equal((await (await get('/custos?dias=5')).json()).periodo.dias, 7);
});

test('LGPD: apagar cliente por telefone (auditado); sem telefone 400', async () => {
  const r = await enviar('POST', '/cliente/apagar', { telefone: '5541999990001' }, { 'x-ator': 'guilherme' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).registro, 2);
  assert.deepEqual(chamadas.apagar.at(-1), { alvo: { telefone: '5541999990001', sessao: undefined }, por: 'sdr:guilherme' });
  const ev = auditoria().at(-1);
  assert.equal(ev.evento, 'lgpd_apagar');
  assert.equal(ev.ator, 'guilherme');
  assert.equal(JSON.stringify(ev).includes('5541999990001'), false, 'auditoria sem o telefone completo');
  assert.equal((await enviar('POST', '/cliente/apagar', {})).status, 400);
});

test('palavra-chave: rotacionar devolve a palavra UMA vez quando o e-mail falha; GET sem a palavra', async () => {
  const r = await (await enviar('POST', '/chave/rotacionar', undefined, { 'x-ator': 'guilherme' })).json();
  assert.equal(r.canal, 'tela');
  assert.equal(r.palavra, 'agro-trator-42');
  assert.match(r.aviso, /não será mostrada de novo/);
  const ev = auditoria().at(-1);
  assert.equal(ev.evento, 'chave_rotacionar');
  assert.equal(JSON.stringify(ev).includes('agro-trator-42'), false, 'palavra fora da auditoria');
  const g = await (await get('/chave')).json();
  assert.equal(g.palavra, undefined);
});

test('saúde, anomalias, relatórios e auditoria', async () => {
  const s = await (await get('/saude')).json();
  assert.equal(s.geral, 'aviso');
  assert.ok(s.recursos && Array.isArray(s.agenda));
  const v = await enviar('POST', '/saude/verificar', undefined, { 'x-ator': 'guilherme' });
  assert.equal((await v.json()).geral, 'ok');
  assert.equal(auditoria().at(-1).evento, 'saude_verificar');

  const a = await (await get('/anomalias?horas=48')).json();
  assert.equal(a.horas, 48);
  assert.equal(a.abertas.length, 2);
  assert.ok(Array.isArray(a.lista));
  const t = await (await enviar('POST', '/anomalias/teste', { canal: 'whatsapp' })).json();
  assert.equal(t.severidade, 'critica');

  const rel = await (await get('/relatorio')).json();
  assert.deepEqual(Object.keys(rel).sort(), ['assunto', 'corpo'], 'prévia sem os dados brutos');
  assert.equal((await enviar('POST', '/relatorio')).status, 200);
  assert.equal(chamadas.relatorio, 1);
  const soc = await (await get('/relatorio-socios')).json();
  assert.equal(soc.status, 'OK');
  assert.equal((await enviar('POST', '/relatorio-socios')).status, 200);

  const aud = await (await get('/auditoria?linhas=2')).json();
  assert.equal(aud.eventos.length, 2);
  assert.equal(aud.eventos[0].evento, 'relatorio_socios_enviar', 'mais recente primeiro');
});

test('rota desconhecida em /admin/api: 404 em JSON (não cai nas rotas antigas)', async () => {
  const r = await get('/nao-existe');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).erro, 'não encontrado');
  const semAuth = await fetch(`${base}/nao-existe`);
  assert.equal(semAuth.status, 401, 'nem revela o que existe sem a chave');
});

test('JSON inválido no corpo: 400 sem stack', async () => {
  const r = await fetch(`${base}/desligar`, { method: 'POST', headers: h(), body: '{quebrado' });
  assert.equal(r.status, 400);
  assert.doesNotMatch(await r.text(), /at |SyntaxError|node_modules/);
});
