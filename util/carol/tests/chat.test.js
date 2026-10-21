// Chat do site: tetos por IP (/64) e por sessão; acima de 80% do teto global
// só sessões que já conversaram hoje continuam.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario } from './_setup.js';

dataDirTemporario();
const express = (await import('express')).default;
const { criarRotasChat } = await import('../src/rotas/chat.js');
const { criarTetos } = await import('../src/util/tetoDiario.js');
const { criarLimite } = await import('../src/util/limite.js');

let servidor;
let base;
before(async () => {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(
    '/api',
    criarRotasChat({
      responder: async (_s, t) => `ok ${t}`,
      resumirConversa: async () => null,
      limites: { sessao10min: criarLimite(100, 60000), ip10min: criarLimite(100, 60000), resumoIp: criarLimite(10, 60000) },
      tetos: criarTetos({ persistir: false }),
      maximos: { global: 10, ipDia: 4, sessaoDia: 3 },
      registrar: () => {},
      reportarAnomalia: async () => {},
      classificarErro: () => ({ tipo: 'site_erro' }),
    })
  );
  await new Promise((ok) => (servidor = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${servidor.address().port}/api/chat`;
});
after(() => servidor.close());

const enviar = (sessionId, ip) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ sessionId, message: 'oi' }) });

test('teto por sessão e por IP; IPv6 do mesmo /64 conta junto', async () => {
  const s = 'sessao-aaaaaaaaaaaa1';
  for (let i = 0; i < 3; i++) assert.equal((await enviar(s, '2804:14c:65a1:4b2a::1')).status, 200);
  assert.equal((await enviar(s, '2804:14c:65a1:4b2a::1')).status, 429, 'sessão passou de 3');
  // outra sessão, outro endereço do MESMO /64: o IP já usou 4 (3 ok + 1 recusada)
  assert.equal((await enviar('sessao-aaaaaaaaaaaa2', '2804:14c:65a1:4b2a::99')).status, 429);
});

test('acima de 80% do teto global: sessão nova recusada, sessão que já conversou continua', async () => {
  const antiga = 'sessao-bbbbbbbbbbbb1';
  assert.equal((await enviar(antiga, '10.0.0.1')).status, 200);
  // enche até 8 de 10 (80%) com outras sessões/IPs
  let n = 4; // 3 + 1 do teste anterior já contaram no global (as recusadas por sessão/IP não)
  for (let i = 0; n < 8; i++, n++) assert.equal((await enviar(`sessao-cccccccccccc${i}`, `10.0.1.${i}`)).status, 200);
  const nova = await enviar('sessao-dddddddddddd1', '10.0.2.1');
  assert.equal(nova.status, 429);
  assert.match((await nova.json()).reply, /limite de hoje/);
  assert.equal((await enviar(antiga, '10.0.0.1')).status, 200, 'quem já conversou termina o atendimento');
});
