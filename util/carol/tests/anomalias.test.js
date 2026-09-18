import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, relogio } from './_setup.js';

dataDirTemporario();
const { reportarAnomalia, classificarErro, listarAnomalias, resumoAnomalias, limparAnomalias, canaisPara, JANELA_MS } = await import('../src/alertas/anomalias.js');

function canais() {
  const emails = [];
  const zaps = [];
  return {
    emails,
    zaps,
    deps: {
      enviarEmail: async (m) => emails.push(m),
      enviarWhatsApp: async (n, t) => zaps.push({ n, t }),
      destinatariosEmail: ['admin@x.com', 'socios@x.com'],
      admins: ['5541999990000'],
    },
  };
}

beforeEach(() => limparAnomalias());

test('anomalia crítica vai por e-mail com "Urgente Carol" e por WhatsApp para os admins', async () => {
  const c = canais();
  const r = await reportarAnomalia({ tipo: 'anthropic_credito', detalhe: 'credit balance is too low' }, c.deps);
  assert.equal(r.enviada, true);
  assert.equal(c.emails.length, 1);
  assert.match(c.emails[0].assunto, /^Urgente Carol: /);
  assert.deepEqual(c.emails[0].para, ['admin@x.com', 'socios@x.com']);
  assert.match(c.emails[0].texto, /O que fazer:/);
  assert.equal(c.zaps.length, 1);
  assert.match(c.zaps[0].t, /Urgente Carol/);
});

test('severidade média não avisa na hora: fica no histórico para o relatório executivo', async () => {
  const c = canais();
  const r = await reportarAnomalia({ tipo: 'email_falha', detalhe: 'x' }, c.deps);
  assert.equal(r.enviada, false);
  assert.equal(r.suprimida, false);
  assert.equal(r.registro.canais.relatorio, true);
  assert.equal(c.emails.length, 0);
  assert.equal(c.zaps.length, 0);
  assert.equal(listarAnomalias(1).length, 1, 'registrada para o relatório das 8h05');
});

test('severidade alta vai só por e-mail, sem WhatsApp', async () => {
  const c = canais();
  const r = await reportarAnomalia({ tipo: 'catalogo_falha', detalhe: 'x' }, c.deps);
  assert.equal(r.enviada, true);
  assert.equal(c.emails.length, 1);
  assert.match(c.emails[0].assunto, /^Urgente Carol: /);
  assert.equal(c.zaps.length, 0);
});

test('"Resolvido:" (recuperado) vai só por e-mail, mesmo forçado', async () => {
  const c = canais();
  await reportarAnomalia({ tipo: 'catalogo_falha', titulo: 'Resolvido: catálogo voltou', severidade: 'media', recuperado: true, forcar: true }, c.deps);
  assert.equal(c.emails.length, 1);
  assert.match(c.emails[0].texto, /Boa notícia/);
  assert.equal(c.zaps.length, 0);
});

test('canaisPara: crítica = e-mail + WhatsApp, alta = e-mail, média = nada', () => {
  assert.deepEqual(canaisPara('critica'), { email: true, whatsapp: true });
  assert.deepEqual(canaisPara('alta'), { email: true, whatsapp: false });
  assert.deepEqual(canaisPara('media'), { email: false, whatsapp: false });
  assert.deepEqual(canaisPara('media', true), { email: true, whatsapp: false });
});

test('deduplica pelo tipo dentro da janela e volta a avisar depois', async () => {
  const c = canais();
  const agora = relogio(Date.now()); // listarAnomalias corta pelas últimas 48h reais
  const deps = { ...c.deps, agora };
  assert.equal((await reportarAnomalia({ tipo: 'webhook_erro', detalhe: '1' }, deps)).enviada, true);
  assert.equal((await reportarAnomalia({ tipo: 'webhook_erro', detalhe: '2' }, deps)).suprimida, true);
  assert.equal((await reportarAnomalia({ tipo: 'site_erro', detalhe: '3' }, deps)).enviada, true, 'tipo diferente não é suprimido');
  agora.avancar(JANELA_MS.alta + 1000);
  assert.equal((await reportarAnomalia({ tipo: 'webhook_erro', detalhe: '4' }, deps)).enviada, true);
  assert.equal(c.emails.length, 3);
  const lista = listarAnomalias(48);
  assert.equal(lista.length, 4, 'as suprimidas também ficam no histórico');
  assert.equal(lista.filter((a) => a.suprimida).length, 1);
});

test('forcar ignora a deduplicação', async () => {
  const c = canais();
  await reportarAnomalia({ tipo: 'saude_falha', detalhe: 'a' }, c.deps);
  const r = await reportarAnomalia({ tipo: 'saude_falha', detalhe: 'b', forcar: true }, c.deps);
  assert.equal(r.enviada, true);
});

test('se o e-mail falhar, o WhatsApp ainda sai e o registro guarda o erro', async () => {
  const c = canais();
  const deps = { ...c.deps, enviarEmail: async () => { throw new Error('todos os provedores falharam'); } };
  const r = await reportarAnomalia({ tipo: 'catalogo_falha', detalhe: 'x' }, deps);
  assert.equal(r.enviada, true);
  assert.equal(r.registro.canais.email, false);
  assert.match(r.registro.canais.emailErro, /provedores/);
  assert.equal(r.registro.canais.whatsapp, true);
});

test('token do WhatsApp inválido não tenta avisar pelo próprio WhatsApp', async () => {
  const c = canais();
  await reportarAnomalia({ tipo: 'whatsapp_token_invalido', detalhe: '401' }, c.deps);
  assert.equal(c.zaps.length, 0);
  assert.equal(c.emails.length, 1);
});

test('resumo agrupa por tipo e conta severidades', async () => {
  const c = canais();
  const agora = relogio(Date.now()); // resumoAnomalias corta pelas últimas 24h reais
  const deps = { ...c.deps, agora };
  await reportarAnomalia({ tipo: 'anthropic_credito', detalhe: '1' }, deps);
  await reportarAnomalia({ tipo: 'anthropic_credito', detalhe: '2' }, deps);
  await reportarAnomalia({ tipo: 'email_falha', detalhe: '3' }, deps);
  const r = resumoAnomalias(24);
  assert.equal(r.total, 3);
  assert.equal(r.criticas, 1);
  assert.equal(r.medias, 1);
  assert.equal(r.tipos.find((t) => t.tipo === 'anthropic_credito').ocorrencias, 2);
});

test('classificarErro reconhece Graph 401, crédito da Anthropic, chave inválida, disco e genérico', () => {
  const g = new Error('Graph API 401: {"error":{"message":"Error validating access token","code":190,"type":"OAuthException"}}');
  assert.equal(classificarErro(g).tipo, 'whatsapp_token_invalido');
  const g2 = new Error('Graph API 400: {"error":{"message":"(#131030) Recipient phone number not in allowed list","code":131030}}');
  assert.equal(classificarErro(g2).tipo, 'whatsapp_envio_falhou');
  const cred = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), { name: 'BadRequestError', status: 400 });
  assert.equal(classificarErro(cred).tipo, 'anthropic_credito');
  const auth = Object.assign(new Error('401 authentication_error: invalid x-api-key'), { name: 'AuthenticationError', status: 401 });
  assert.equal(classificarErro(auth).tipo, 'anthropic_chave');
  const rl = Object.assign(new Error('429 rate_limit_error'), { name: 'RateLimitError', status: 429 });
  assert.equal(classificarErro(rl).tipo, 'anthropic_api');
  assert.equal(classificarErro(new Error('ENOSPC: no space left on device')).tipo, 'disco_falha');
  assert.equal(classificarErro(new Error('boom'), 'site').tipo, 'site_erro');
  assert.equal(classificarErro(new Error('boom')).tipo, 'webhook_erro');
});
