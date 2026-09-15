import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, fetchFalso } from './_setup.js';

dataDirTemporario();
const { enviar, provedoresDisponiveis, ultimoEnvio } = await import('../src/email/transporte.js');

const cfgBase = { de: 'carol@x.com', nomeDe: 'Carol', smtpHost: 'smtp.x', smtpPort: 465 };
const msg = { para: ['a@x.com', 'a@x.com', 'invalido'], assunto: 'Teste', texto: 'corpo' };

test('provedoresDisponiveis segue a ordem Gmail, Resend, Brevo, SMTP conforme as chaves', () => {
  assert.deepEqual(provedoresDisponiveis({ ...cfgBase }), []);
  assert.deepEqual(provedoresDisponiveis({ ...cfgBase, brevoApiKey: 'b' }), ['brevo']);
  assert.deepEqual(provedoresDisponiveis({ ...cfgBase, googleServiceAccountJson: '{}' }), [], 'Gmail exige também o remetente');
  assert.deepEqual(provedoresDisponiveis({ ...cfgBase, googleServiceAccountJson: '{}', gmailSender: 'carol@x.com', resendApiKey: 'r', brevoApiKey: 'b', smtpUser: 'u', smtpPass: 'p' }), ['gmail', 'resend', 'brevo', 'smtp']);
});

test('Gmail: assina JWT com sub (impersonação), envia MIME base64url e devolve o id', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { client_email: 'carol-monitor@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const f = fetchFalso({
    'oauth2.googleapis.com/token': (url, opts) => {
      const jwt = new URLSearchParams(opts.body.toString()).get('assertion');
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      assert.equal(claims.iss, sa.client_email);
      assert.equal(claims.sub, 'carol@x.com');
      assert.match(claims.scope, /gmail\.send/);
      return { corpo: { access_token: 'tok', expires_in: 3600 } };
    },
    'gmail.googleapis.com': (url, opts) => {
      assert.equal(opts.headers.authorization, 'Bearer tok');
      const raw = Buffer.from(JSON.parse(opts.body).raw, 'base64url').toString();
      assert.match(raw, /^From: =\?UTF-8\?B\?.+\?= <carol@x\.com>\r\nTo: a@x\.com\r\nSubject: =\?UTF-8\?B\?/);
      assert.match(raw, /Content-Type: text\/plain; charset=UTF-8/);
      const corpoB64 = raw.split('\r\n\r\n')[1];
      assert.equal(Buffer.from(corpoB64, 'base64').toString(), 'corpo');
      return { corpo: { id: 'gm-1' } };
    },
  });
  const cfg = { ...cfgBase, googleServiceAccountJson: Buffer.from(JSON.stringify(sa)).toString('base64'), gmailSender: 'carol@x.com' };
  const r = await enviar(msg, { cfg, fetchFn: f });
  assert.deepEqual(r, { provedor: 'gmail', id: 'gm-1' });
});

test('Gmail sem delegação (403) → cai para o próximo provedor', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { client_email: 'x@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const { limparCacheTokens } = await import('../src/google/auth.js');
  limparCacheTokens();
  const f = fetchFalso({
    'oauth2.googleapis.com/token': { status: 401, corpo: { error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method' } },
    'api.resend.com': { corpo: { id: 'r1' } },
  });
  const r = await enviar(msg, { cfg: { ...cfgBase, googleServiceAccountJson: JSON.stringify(sa), gmailSender: 'c@x.com', resendApiKey: 'r' }, fetchFn: f });
  assert.equal(r.provedor, 'resend');
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
