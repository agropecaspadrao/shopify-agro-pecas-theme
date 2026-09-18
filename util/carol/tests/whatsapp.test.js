import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario } from './_setup.js';

dataDirTemporario();
// Intervalos curtos para o teste não demorar; os padrões de produção são 2 s e 6 s.
process.env.WA_ESPACO_MS = '80';
process.env.WA_ESPERA_LIMITE_MS = '40';
process.env.WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || '123';
process.env.WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN || 'x';

const { enviarTexto, ehLimiteDeRajada } = await import('../src/whatsapp.js');

const ERRO_131056 = JSON.stringify({ error: { message: '(#131056) (Business Account, Consumer Account) pair rate limit hit', code: 131056 } });

function fetchContador(respostas) {
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ t: Date.now(), corpo: JSON.parse(opts.body) });
    const r = respostas.shift() || { status: 200, corpo: { messages: [{ id: 'wamid.ok' }] } };
    return {
      ok: r.status < 300,
      status: r.status,
      json: async () => r.corpo,
      text: async () => (typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo)),
    };
  };
  return chamadas;
}

test('ehLimiteDeRajada reconhece o erro 131056 da Meta', () => {
  assert.equal(ehLimiteDeRajada(new Error(`Graph API 400: ${ERRO_131056}`)), true);
  assert.equal(ehLimiteDeRajada(new Error('Graph API 401: token')), false);
});

test('envios para o mesmo número saem espaçados; para números diferentes, não', async () => {
  const chamadas = fetchContador([]);
  const inicio = Date.now();
  await Promise.all([enviarTexto('5541999990001', 'a'), enviarTexto('5541999990001', 'b'), enviarTexto('5541999990002', 'c')]);
  const mesmo = chamadas.filter((c) => c.corpo.to === '5541999990001').map((c) => c.t - inicio);
  assert.equal(mesmo.length, 2);
  assert.ok(Math.abs(mesmo[1] - mesmo[0]) >= 70, `segundo envio deveria esperar ~80ms, esperou ${Math.abs(mesmo[1] - mesmo[0])}ms`);
  const outro = chamadas.find((c) => c.corpo.to === '5541999990002');
  assert.ok(outro.t - inicio < 60, 'outro número não espera a fila do primeiro');
});

test('ao bater o limite 131056, espera e repete uma vez; outros erros sobem direto', async () => {
  const chamadas = fetchContador([{ status: 400, corpo: ERRO_131056 }]);
  const r = await enviarTexto('5541999990003', 'oi');
  assert.equal(chamadas.length, 2, 'uma tentativa + uma repetição');
  assert.equal(r.messages[0].id, 'wamid.ok');

  fetchContador([{ status: 400, corpo: { error: { message: 'outro erro', code: 100 } } }]);
  await assert.rejects(() => enviarTexto('5541999990004', 'oi'), /Graph API 400/);
});
