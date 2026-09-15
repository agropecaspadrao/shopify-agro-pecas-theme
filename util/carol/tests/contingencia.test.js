import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario } from './_setup.js';

dataDirTemporario();
const { enviarOuContingencia } = await import('../src/email/contingencia.js');

const msg = { para: ['socios@x.com'], assunto: 'Carol: teste', texto: 'linha\n'.repeat(900) };

test('e-mail ok → canal email, sem WhatsApp', async () => {
  const zaps = [];
  const r = await enviarOuContingencia(msg, { enviarEmail: async () => ({}), enviarWhatsApp: async (n, t) => zaps.push(t), admins: ['5541'] });
  assert.equal(r.canal, 'email');
  assert.equal(zaps.length, 0);
});

test('e-mail falha → WhatsApp dos admins, fatiado e marcado como contingência; anomalia email_falha reportada', async () => {
  const zaps = [];
  const anomalias = [];
  const r = await enviarOuContingencia(msg, {
    enviarEmail: async () => { throw new Error('Gmail 403: delegação não autorizada'); },
    enviarWhatsApp: async (n, t) => zaps.push({ n, t }),
    admins: ['5541a', '5541b'],
    reportarAnomalia: async (a) => anomalias.push(a),
  });
  assert.equal(r.canal, 'whatsapp');
  assert.equal(r.entreguesWhatsApp, 2);
  assert.match(r.erroEmail, /Gmail 403/);
  assert.ok(zaps.length >= 4, 'texto longo fatiado para cada admin');
  assert.match(zaps[0].t, /^\(1\/\d+\)\n\*Carol: teste\*\n_\(contingencia/);
  for (const z of zaps) assert.ok(z.t.length <= 3600);
  assert.equal(anomalias[0].tipo, 'email_falha');
});

test('e-mail falha sem admins → nenhum canal', async () => {
  const r = await enviarOuContingencia(msg, { enviarEmail: async () => { throw new Error('x'); }, admins: [], reportarAnomalia: async () => {} });
  assert.equal(r.canal, 'nenhum');
});

test('permitirWhatsApp=false não cai para o WhatsApp', async () => {
  const zaps = [];
  const r = await enviarOuContingencia(msg, { enviarEmail: async () => { throw new Error('x'); }, enviarWhatsApp: async (n, t) => zaps.push(t), admins: ['1'], permitirWhatsApp: false, reportarAnomalia: async () => {} });
  assert.equal(r.canal, 'nenhum');
  assert.equal(zaps.length, 0);
});
