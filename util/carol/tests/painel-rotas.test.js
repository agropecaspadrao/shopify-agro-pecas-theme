// Rotas do painel de ponta a ponta, num servidor local efêmero (127.0.0.1,
// porta aleatória; nada sai da máquina).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario } from './_setup.js';

delete process.env.CAROL_24H;
dataDirTemporario();
const express = (await import('express')).default;
const { criarRotasPainel } = await import('../src/admin/rotas.js');
const { criarLimite } = await import('../src/util/limite.js');
const { pararAmostragem } = await import('../src/admin/maquina.js');

let servidor;
let base;
const CHAVE = 'chave-de-teste-123';

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/admin/painel', criarRotasPainel({ chaveAdmin: CHAVE, segredo: '', limiteLogin: criarLimite(3, 60000), limites: () => ({}) }));
  await new Promise((ok) => {
    servidor = app.listen(0, '127.0.0.1', ok);
  });
  base = `http://127.0.0.1:${servidor.address().port}/admin/painel`;
});
after(() => {
  servidor.close();
  pararAmostragem();
});

const origem = () => base.replace('/admin/painel', '');
async function login(chave) {
  return fetch(`${base}/entrar`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: origem() }, body: `chave=${encodeURIComponent(chave)}` });
}

test('sem sessão: API 401 e página redireciona para o login; headers de segurança presentes', async () => {
  const r = await fetch(`${base}/api/estado`);
  assert.equal(r.status, 401);
  for (const h of ['content-security-policy', 'x-frame-options', 'x-content-type-options']) assert.ok(r.headers.get(h), h);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('cache-control'), /no-store/);
  const p = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(p.status, 303);
  assert.equal(p.headers.get('location'), '/admin/painel/entrar');
});

test('login: chave errada 401, certa gera cookie; ações exigem CSRF; telefone não vaza', async () => {
  assert.equal((await login('errada')).status, 401);
  const ok = await login(CHAVE);
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);

  const estado = await fetch(`${base}/api/estado`, { headers: { cookie } });
  assert.equal(estado.status, 200);
  const j = await estado.json();
  assert.ok(['atendendo', 'silencio', 'desligada'].includes(j.carol.status));

  const semCsrf = await fetch(`${base}/api/desligar`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: origem() }, body: '{"horas":2}' });
  assert.equal(semCsrf.status, 403);
  const h = { cookie, 'content-type': 'application/json', origin: origem(), 'x-carol-painel': '1' };
  const outraOrigem = await fetch(`${base}/api/desligar`, { method: 'POST', headers: { ...h, origin: 'https://mal.example' }, body: '{"horas":2}' });
  assert.equal(outraOrigem.status, 403);
  assert.equal((await fetch(`${base}/api/desligar`, { method: 'POST', headers: h, body: '{"horas":999}' })).status, 400);
  const des = await (await fetch(`${base}/api/desligar`, { method: 'POST', headers: h, body: '{"ateReligar":true}' })).json();
  assert.equal(des.pausa.indefinida, true);
  assert.equal((await (await fetch(`${base}/api/estado`, { headers: { cookie } })).json()).carol.status, 'desligada');
  await fetch(`${base}/api/ligar`, { method: 'POST', headers: h, body: '{}' });
  assert.notEqual((await (await fetch(`${base}/api/estado`, { headers: { cookie } })).json()).carol.status, 'desligada');

  const ruim = await fetch(`${base}/api/horario`, { method: 'PUT', headers: h, body: '{"modo":"nunca"}' });
  assert.equal(ruim.status, 400);
  assert.ok((await ruim.json()).erros.length);
  const bom = await fetch(`${base}/api/horario`, { method: 'PUT', headers: h, body: JSON.stringify({ modo: '24h', expediente: { dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' }, janelas: [] }) });
  assert.equal(bom.status, 200);
  assert.equal((await bom.json()).config.modo, '24h');
});

test('rate limit do login bloqueia após 3 tentativas (contando as anteriores)', async () => {
  assert.equal((await login('errada')).status, 401, '3ª tentativa ainda é avaliada');
  const r = await login(CHAVE);
  assert.equal(r.status, 429, 'na 4ª, mesmo com a chave certa, o IP está bloqueado');
});
