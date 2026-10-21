import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { dataDirTemporario, relogio } from './_setup.js';

dataDirTemporario();
// Intervalos de produção (2 s e 6 s); o relógio é injetado, ninguém espera de verdade.
process.env.WA_ESPACO_MS = '2000';
process.env.WA_ESPERA_LIMITE_MS = '6000';
process.env.WA_PHONE_NUMBER_ID = '123';
process.env.WA_ACCESS_TOKEN = 'x';
process.env.META_APP_SECRET = 'segredo-do-app';

const W = await import('../src/whatsapp.js');
const { enviarTexto, ehLimiteDeRajada, verificarAssinatura, extrairMensagens, _definirRelogio, _limparVistos } = W;

const ERRO_131056 = JSON.stringify({ error: { message: '(#131056) (Business Account, Consumer Account) pair rate limit hit', code: 131056 } });

// Relógio falso: dormir avança o tempo na hora e anota quanto foi pedido
function relogioFalso() {
  const agora = relogio(Date.parse('2026-10-20T13:00:00Z'));
  const esperas = [];
  _definirRelogio({ agora, dormir: async (ms) => { esperas.push(ms); agora.avancar(ms); } });
  return { agora, esperas };
}

function fetchContador(respostas, agora) {
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ t: agora(), corpo: JSON.parse(opts.body), signal: opts.signal });
    const r = respostas.shift() || { status: 200, corpo: { messages: [{ id: 'wamid.ok' }] } };
    return { ok: r.status < 300, status: r.status, json: async () => r.corpo, text: async () => (typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo)) };
  };
  return chamadas;
}

beforeEach(() => _limparVistos());

test('ehLimiteDeRajada reconhece o erro 131056 da Meta', () => {
  assert.equal(ehLimiteDeRajada(new Error(`Graph API 400: ${ERRO_131056}`)), true);
  assert.equal(ehLimiteDeRajada(new Error('Graph API 401: token')), false);
});

test('envios para o mesmo número saem espaçados; para números diferentes, não (relógio injetado)', async () => {
  const { agora, esperas } = relogioFalso();
  const chamadas = fetchContador([], agora);
  await Promise.all([enviarTexto('5541999990001', 'a'), enviarTexto('5541999990001', 'b'), enviarTexto('5541999990002', 'c')]);
  assert.equal(chamadas.filter((c) => c.corpo.to === '5541999990001').length, 2);
  assert.deepEqual(esperas, [2000], 'só o segundo envio para o mesmo número espera o espaçamento; o outro número não espera');
  // terceiro envio seguido para o mesmo número: espera a vez reservada
  await enviarTexto('5541999990001', 'd');
  assert.deepEqual(esperas, [2000, 2000], 'terceiro espera a vez dele (início + 4 s)');
  assert.ok(chamadas.every((c) => c.signal), 'todo envio tem timeout');
});

test('ao bater o limite 131056, espera e repete uma vez; outros erros sobem direto', async () => {
  const { agora, esperas } = relogioFalso();
  const chamadas = fetchContador([{ status: 400, corpo: ERRO_131056 }], agora);
  const r = await enviarTexto('5541999990003', 'oi');
  assert.equal(chamadas.length, 2, 'uma tentativa + uma repetição');
  assert.equal(r.messages[0].id, 'wamid.ok');
  assert.deepEqual(esperas, [6000]);

  fetchContador([{ status: 400, corpo: { error: { message: 'outro erro', code: 100 } } }], agora);
  await assert.rejects(() => enviarTexto('5541999990004', 'oi'), /Graph API 400/);
});

test('verificarAssinatura: válida, inválida, ausente, corpo vazio e rawBody que não é Buffer', () => {
  const corpo = Buffer.from(JSON.stringify({ entry: [] }));
  const assinar = (b) => 'sha256=' + crypto.createHmac('sha256', 'segredo-do-app').update(b).digest('hex');
  assert.equal(verificarAssinatura(corpo, assinar(corpo)), true);
  assert.equal(verificarAssinatura(corpo, assinar(Buffer.from('outro'))), false, 'assinatura de outro corpo');
  assert.equal(verificarAssinatura(corpo, 'sha256=zz'), false, 'hex inválido');
  assert.equal(verificarAssinatura(corpo, undefined), false, 'ausente');
  assert.equal(verificarAssinatura(corpo, 'md5=abc'), false, 'esquema errado');
  assert.equal(verificarAssinatura(Buffer.alloc(0), assinar(Buffer.alloc(0))), false, 'corpo vazio');
  assert.equal(verificarAssinatura(undefined, assinar(corpo)), false, 'sem rawBody');
  assert.equal(verificarAssinatura(JSON.stringify({ entry: [] }), assinar(corpo)), false, 'string não é Buffer');
});

test('extrairMensagens: ecos smb_message_echoes viram eco (from = loja, to = cliente); texto de botão/lista', () => {
  const lista = extrairMensagens({
    entry: [
      {
        changes: [
          { field: 'smb_message_echoes', value: { metadata: { display_phone_number: '5541984151085' }, message_echoes: [{ id: 'wamid.eco1', from: '5541984151085', to: '5541999990009', type: 'text', text: { body: 'Te passo o orçamento amanhã' }, timestamp: '1760000000' }] } },
          { field: 'messages', value: { metadata: { display_phone_number: '5541984151085' }, contacts: [{ wa_id: '5541999990009', profile: { name: 'João' } }], messages: [
            { id: 'wamid.b1', from: '5541999990009', type: 'interactive', interactive: { button_reply: { title: 'Quero orçamento' } } },
            { id: 'wamid.img', from: '5541999990009', type: 'image', image: { id: 'm1' } },
          ] } },
        ],
      },
    ],
  });
  assert.equal(lista.length, 3);
  assert.deepEqual({ eco: lista[0].eco, para: lista[0].para, texto: lista[0].texto }, { eco: true, para: '5541999990009', texto: 'Te passo o orçamento amanhã' });
  assert.equal(lista[0].timestamp, 1760000000000);
  assert.equal(lista[1].texto, 'Quero orçamento');
  assert.equal(lista[1].nome, 'João');
  assert.equal(lista[2].tipo, 'image');
  assert.equal(lista[2].texto, '');
  // reentrega da Meta: deduplicada
  assert.equal(extrairMensagens({ entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: [{ id: 'wamid.eco1', from: '1', to: '2', type: 'text', text: { body: 'x' } }] } }] }] }).length, 0);
});
