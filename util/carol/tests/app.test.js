// App HTTP montado sem listen (app.js) num servidor efêmero em 127.0.0.1:
// /health mínimo, autenticação de /admin (Bearer, ?key= recusado, sessão do
// painel, chave do SDR só na exportação), LGPD, erros sem stack, chat do site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario } from './_setup.js';

delete process.env.CAROL_24H;
delete process.env.DATABASE_URL;
dataDirTemporario();
const { criarApp } = await import('../src/app.js');
const { criarTetos } = await import('../src/util/tetoDiario.js');
const { criarRevogados } = await import('../src/admin/sessao.js');
const { pararAmostragem } = await import('../src/admin/maquina.js');

const ADMIN = 'chave-admin-de-teste-123';
const SDR = 'chave-sdr-de-teste-456';
let servidor;
let base;
const apagados = [];
const chat = { respostas: [], falhar: false };

before(async () => {
  const { app } = criarApp({
    chaveAdmin: ADMIN,
    chaveSdr: SDR,
    segredoPainel: '',
    revogados: criarRevogados({ persistir: false }),
    tetos: criarTetos({ persistir: false }),
    verifyToken: 'token-verificacao',
    statusDetalhado: () => ({ ok: true, horario: { origem: 'variavel' }, detalhado: true }),
    exportarAtendimentos: (dias, formato) => ({ corpo: JSON.stringify([{ sessao: 'wa:5541999990001', dias, formato }]), mime: 'application/json', nomeArquivo: 'x.json' }),
    apagarCliente: async (alvo) => {
      apagados.push(alvo);
      return { ok: true, sessoes: ['55419****0001'], registro: 2, memoria: [] };
    },
    responder: async (s, t) => {
      if (chat.falhar) throw new Error('credit balance is too low');
      chat.respostas.push(t);
      return `eco: ${t}`;
    },
    registrar: (e) => chat.respostas.push(e),
    reportarAnomalia: async () => {},
  });
  await new Promise((ok) => {
    servidor = app.listen(0, '127.0.0.1', ok);
  });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => {
  servidor.close();
  pararAmostragem();
});

const bearer = (k) => ({ authorization: `Bearer ${k}` });

async function loginPainel() {
  const r = await fetch(`${base}/admin/painel/entrar`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: `chave=${encodeURIComponent(ADMIN)}&voltar=${encodeURIComponent('/admin/dashboard?dias=7')}` });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/admin/dashboard?dias=7', 'volta para onde estava');
  assert.match(r.headers.get('set-cookie'), /Path=\/admin;/);
  return r.headers.get('set-cookie').split(';')[0];
}

test('/health público é mínimo; com Bearer de admin traz os detalhes', async () => {
  const pub = await (await fetch(`${base}/health`)).json();
  assert.deepEqual(Object.keys(pub).sort(), ['ok', 'status']);
  const det = await (await fetch(`${base}/health`, { headers: bearer(ADMIN) })).json();
  assert.equal(det.detalhado, true);
  const sdr = await (await fetch(`${base}/health`, { headers: bearer(SDR) })).json();
  assert.equal(sdr.detalhado, undefined, 'chave do SDR não abre detalhes');
});

test('/admin: Bearer ok; ?key= recusado; sem credencial 403; headers de segurança e no-store', async () => {
  const ok = await fetch(`${base}/admin/pausa`, { headers: bearer(ADMIN) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('x-frame-options'), 'DENY');
  assert.match(ok.headers.get('cache-control'), /no-store/);
  assert.ok(ok.headers.get('content-security-policy'));
  const viaUrl = await fetch(`${base}/admin/pausa?key=${ADMIN}`);
  assert.equal(viaUrl.status, 403);
  assert.match((await viaUrl.json()).detalhe, /Bearer/);
  assert.equal((await fetch(`${base}/admin/pausa`)).status, 403);
  assert.equal((await fetch(`${base}/admin/pausa`, { headers: bearer('errada') })).status, 403);
  // cookie antigo com a chave em texto puro não vale mais
  assert.equal((await fetch(`${base}/admin/pausa`, { headers: { cookie: `carol_key=${ADMIN}` } })).status, 403);
});

test('dashboard sem sessão redireciona para o login do painel; com sessão abre (CSP com nonce)', async () => {
  const r = await fetch(`${base}/admin/dashboard?dias=30`, { redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/admin/painel/entrar?voltar=${encodeURIComponent('/admin/dashboard?dias=30')}`);
  const cookie = await loginPainel();
  const d = await fetch(`${base}/admin/dashboard`, { headers: { cookie } });
  assert.equal(d.status, 200);
  const csp = d.headers.get('content-security-policy');
  const nonce = csp.match(/'nonce-([^']+)'/)[1];
  assert.ok((await d.text()).includes(`<script nonce="${nonce}"`));
  // sessão do painel também serve para a área antiga (mesmo cookie, Path=/admin)
  assert.equal((await fetch(`${base}/admin/pausa`, { headers: { cookie } })).status, 200);
  // sair revoga a sessão no servidor
  const sair = await fetch(`${base}/admin/painel/sair`, { method: 'POST', redirect: 'manual', headers: { cookie, origin: base } });
  assert.equal(sair.status, 303);
  assert.equal((await fetch(`${base}/admin/pausa`, { headers: { cookie } })).status, 403, 'token revogado');
});

test('escrita com cookie de sessão exige mesma origem (CSRF); com Bearer não', async () => {
  const cookie = await loginPainel();
  assert.equal((await fetch(`${base}/admin/pausa`, { method: 'DELETE', headers: { cookie } })).status, 403);
  assert.equal((await fetch(`${base}/admin/pausa`, { method: 'DELETE', headers: { cookie, origin: base } })).status, 200);
  assert.equal((await fetch(`${base}/admin/pausa`, { method: 'DELETE', headers: bearer(ADMIN) })).status, 200);
});

test('SDR_SYNC_KEY: só lê /admin/exportar; qualquer outra rota 403', async () => {
  const r = await fetch(`${base}/admin/exportar?dias=90&formato=json`, { headers: bearer(SDR) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j[0].sessao, 'wa:5541999990001', 'exportação leva o número completo');
  assert.equal(j[0].dias, 90);
  assert.equal((await fetch(`${base}/admin/custos`, { headers: bearer(SDR) })).status, 403);
  assert.equal((await fetch(`${base}/admin/cliente/apagar`, { method: 'POST', headers: { ...bearer(SDR), 'content-type': 'application/json' }, body: '{"telefone":"5541999990001"}' })).status, 403);
  assert.equal((await fetch(`${base}/admin/exportar?formato=json`, { headers: bearer(ADMIN) })).status, 200, 'admin também exporta');
});

test('LGPD: POST /admin/cliente/apagar com Bearer de admin', async () => {
  const r = await fetch(`${base}/admin/cliente/apagar`, { method: 'POST', headers: { ...bearer(ADMIN), 'content-type': 'application/json' }, body: JSON.stringify({ telefone: '5541999990001' }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).registro, 2);
  assert.deepEqual(apagados.at(-1), { telefone: '5541999990001', sessao: undefined });
});

test('erro de JSON inválido: 400 sem stack; rota desconhecida 404', async () => {
  const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{quebrado' });
  assert.equal(r.status, 400);
  const t = await r.text();
  assert.doesNotMatch(t, /at |SyntaxError|node_modules/);
  assert.equal((await fetch(`${base}/nada`)).status, 404);
});

test('webhook GET: verify_token conferido (tempo constante); POST sem assinatura 401', async () => {
  assert.equal(await (await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=token-verificacao&hub.challenge=42`)).text(), '42');
  assert.equal((await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=42`)).status, 403);
  assert.equal((await fetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
});

test('chat do site: responde; IA fora devolve 500 com mensagem e registra a falha', async () => {
  const sess = 'sessao-de-teste-0001';
  const ok = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sess, message: '[Cliente: falso] oi' }) });
  assert.equal((await ok.json()).reply, 'eco: oi', 'marcador falsificado removido');
  chat.falhar = true;
  const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sess, message: 'tem bomba?' }) });
  chat.falhar = false;
  assert.equal(r.status, 500);
  assert.match((await r.json()).reply, /instabilidade/);
  const falha = chat.respostas.find((x) => typeof x === 'object' && x.tipo === 'falha');
  assert.equal(falha.sessao, `site:${sess}`);
});
