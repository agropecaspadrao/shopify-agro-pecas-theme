import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, fetchFalso } from './_setup.js';

dataDirTemporario();
const { enviar, provedoresDisponiveis, ultimoEnvio } = await import('../src/email/transporte.js');

const cfgBase = { de: 'carol@x.com', nomeDe: 'Carol', smtpHost: 'smtp.x', smtpPort: 465 };
const msg = { para: ['a@x.com', 'a@x.com', 'invalido'], assunto: 'Teste', texto: 'corpo' };

test('provedoresDisponiveis segue a ordem Resend, Brevo, SMTP conforme as chaves', () => {
  assert.deepEqual(provedoresDisponiveis({ ...cfgBase }), []);
  assert.deepEqual(provedoresDisponiveis({ ...cfgBase, brevoApiKey: 'b' }), ['brevo']);
  assert.deepEqual(provedoresDisponiveis({ ...cfgBase, resendApiKey: 'r', brevoApiKey: 'b', smtpUser: 'u', smtpPass: 'p' }), ['resend', 'brevo', 'smtp']);
});

test('sem provedor configurado lança erro claro', async () => {
  await assert.rejects(() => enviar(msg, { cfg: cfgBase }), /nenhum provedor/);
});

test('sem destinatário válido lança erro', async () => {
  await assert.rejects(() => enviar({ ...msg, para: ['x'] }, { cfg: { ...cfgBase, resendApiKey: 'r' } }), /destinatário/);
});

test('Resend ok: envia com destinatários únicos e registra o último envio', async () => {
  const f = fetchFalso({ 'api.resend.com': { status: 200, corpo: { id: 'abc' } } });
  const r = await enviar(msg, { cfg: { ...cfgBase, resendApiKey: 'r' }, fetchFn: f });
  assert.deepEqual(r, { provedor: 'resend', id: 'abc' });
  const corpo = JSON.parse(f.chamadas[0].opts.body);
  assert.deepEqual(corpo.to, ['a@x.com']);
  assert.equal(corpo.from, 'Carol <carol@x.com>');
  assert.equal(f.chamadas[0].opts.headers.authorization, 'Bearer r');
  assert.equal(ultimoEnvio().provedor, 'resend');
});

test('Resend falha → cai para Brevo', async () => {
  const f = fetchFalso({
    'api.resend.com': { status: 403, corpo: { message: 'domain not verified' } },
    'api.brevo.com': { status: 201, corpo: { messageId: 'm1' } },
  });
  const r = await enviar(msg, { cfg: { ...cfgBase, resendApiKey: 'r', brevoApiKey: 'b' }, fetchFn: f });
  assert.equal(r.provedor, 'brevo');
  assert.equal(f.chamadas.length, 2);
  assert.equal(f.chamadas[1].opts.headers['api-key'], 'b');
});

test('todos falham → erro agrega as causas', async () => {
  const f = fetchFalso({
    'api.resend.com': { status: 500, corpo: 'x' },
    'api.brevo.com': { status: 401, corpo: { message: 'bad key' } },
  });
  await assert.rejects(
    () => enviar(msg, { cfg: { ...cfgBase, resendApiKey: 'r', brevoApiKey: 'b' }, fetchFn: f, provedores: ['resend', 'brevo'] }),
    (e) => /resend: Resend 500/.test(e.message) && /brevo: Brevo 401/.test(e.message) && e.falhas.length === 2
  );
});
