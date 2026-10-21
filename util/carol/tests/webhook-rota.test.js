// Rota POST /webhook com assinatura e extração reais: contrato com o
// messenger do SDR (X-SDR-Possuidos fora do HMAC) e dedupe de reentregas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { dataDirTemporario } from './_setup.js';

dataDirTemporario();
process.env.META_APP_SECRET = 'segredo-do-app';
const express = (await import('express')).default;
const { criarRotasWebhook, lerPossuidos } = await import('../src/rotas/webhook.js');
const { verificarAssinatura, extrairMensagens } = await import('../src/whatsapp.js');

const recebidas = [];
let servidor;
let base;
before(async () => {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));
  app.use(
    '/webhook',
    criarRotasWebhook({
      processador: { receber: async (m) => recebidas.push(m) },
      verificarAssinatura,
      extrairMensagens,
      verifyToken: 'x',
      compararSegredo: (a, b) => a === b,
      reportarAnomalia: async () => {},
      classificarErro: () => ({ tipo: 'webhook_erro' }),
    })
  );
  await new Promise((ok) => (servidor = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${servidor.address().port}/webhook`;
});
after(() => servidor.close());

const corpo = (msgs) => JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { messages: msgs } }] }] });
const assinar = (b) => 'sha256=' + crypto.createHmac('sha256', 'segredo-do-app').update(b).digest('hex');
const postar = (b, headers = {}) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': assinar(b), ...headers }, body: b });
const espera = () => new Promise((r) => setTimeout(r, 20));

test('lerPossuidos: lista separada por vírgula, só dígitos; vazio = conjunto vazio', () => {
  assert.deepEqual([...lerPossuidos('5554991139380, +55 41 98888-0000')], ['5554991139380', '5541988880000']);
  assert.equal(lerPossuidos('').size, 0);
  assert.equal(lerPossuidos(undefined).size, 0);
});

test('lote misto: mensagens de quem está em X-SDR-Possuidos são ignoradas (HMAC do corpo original vale)', async () => {
  recebidas.length = 0;
  const b = corpo([
    { id: 'wamid.sdr1', from: '5554991139380', type: 'text', text: { body: 'conversa do SDR' } },
    { id: 'wamid.carol1', from: '5541977770000', type: 'text', text: { body: 'conversa da Carol' } },
  ]);
  const r = await postar(b, { 'x-sdr-possuidos': '5554991139380,5541988880000' });
  assert.equal(r.status, 200);
  await espera();
  assert.deepEqual(recebidas.map((m) => m.id), ['wamid.carol1']);
});

test('sem header: responde tudo; retry com o mesmo corpo não processa de novo (dedupe por id)', async () => {
  recebidas.length = 0;
  const b = corpo([{ id: 'wamid.r1', from: '5541977770001', type: 'text', text: { body: 'oi' } }, { id: 'wamid.r2', from: '5541977770001', type: 'text', text: { body: 'tudo bem?' } }]);
  assert.equal((await postar(b)).status, 200);
  assert.equal((await postar(b)).status, 200, 'retry aceito com 2xx');
  await espera();
  assert.deepEqual(recebidas.map((m) => m.id), ['wamid.r1', 'wamid.r2'], 'cada id uma vez só');
});

test('assinatura inválida: 401 (o header X-SDR-Possuidos não entra no HMAC nem o substitui)', async () => {
  const b = corpo([{ id: 'wamid.z', from: '1', type: 'text', text: { body: 'x' } }]);
  const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': assinar('outro'), 'x-sdr-possuidos': '1' }, body: b });
  assert.equal(r.status, 401);
});
