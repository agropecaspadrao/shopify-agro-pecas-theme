// Espelho do SDR (SDR_SYNC_KEY, https), IPv6 /64, tetos diários persistentes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dataDirTemporario, relogio } from './_setup.js';

const dir = dataDirTemporario();
const { espelharNoSdr, urlEspelhoValida, chaveEspelho } = await import('../src/registro.js');
const { chaveIp } = await import('../src/util/ip.js');
const { criarTetos } = await import('../src/util/tetoDiario.js');
const { mascararTelefone, mascarar } = await import('../src/util/telefone.js');

test('espelho: header X-Carol-Key = SDR_SYNC_KEY; leva tipo/entregue/motivo/autor; site e sistema não vão', async () => {
  const envios = [];
  const fetchFn = async (url, opts) => {
    envios.push({ url, headers: opts.headers, corpo: JSON.parse(opts.body), signal: opts.signal });
    return { ok: true, status: 200 };
  };
  const env = { SDR_SYNC_URL: 'https://sdr.exemplo/turno', SDR_SYNC_KEY: 'chave-sdr', CAROL_ADMIN_KEY: 'chave-admin' };
  await espelharNoSdr({ ts: 't', canal: 'whatsapp', sessao: 'wa:1', tipo: 'silencio', motivo: 'horario', mensagem: 'oi', resposta: '' }, { env, fetchFn });
  await espelharNoSdr({ ts: 't', canal: 'whatsapp', sessao: 'wa:1', tipo: 'humano', autor: 'humano', mensagem: '', resposta: 'ok' }, { env, fetchFn });
  await espelharNoSdr({ ts: 't', canal: 'whatsapp', sessao: 'wa:1', mensagem: 'oi', resposta: 'olá', entregue: false }, { env, fetchFn });
  assert.equal(espelharNoSdr({ ts: 't', canal: 'site', sessao: 'site:x', mensagem: 'a', resposta: 'b' }, { env, fetchFn }), null);
  assert.equal(espelharNoSdr({ ts: 't', canal: 'sistema', sessao: 'wa:1', tipo: 'sistema' }, { env, fetchFn }), null);
  assert.equal(envios.length, 3);
  assert.equal(envios[0].headers['x-carol-key'], 'chave-sdr');
  assert.deepEqual([envios[0].corpo.tipo, envios[0].corpo.motivo], ['silencio', 'horario']);
  assert.equal(envios[1].corpo.autor, 'humano');
  assert.equal(envios[2].corpo.entregue, false);
  assert.ok(envios.every((e) => e.signal), 'com timeout');
});

test('espelho: sem SDR_SYNC_KEY cai para CAROL_ADMIN_KEY (transição); URL sem https é recusada (exceto localhost)', async () => {
  assert.equal(chaveEspelho({ CAROL_ADMIN_KEY: 'adm' }), 'adm');
  assert.equal(chaveEspelho({ SDR_SYNC_KEY: 'sdr', CAROL_ADMIN_KEY: 'adm' }), 'sdr');
  assert.equal(urlEspelhoValida('https://sdr.exemplo/x'), true);
  assert.equal(urlEspelhoValida('http://sdr.exemplo/x'), false);
  assert.equal(urlEspelhoValida('http://localhost:3000/x'), true);
  assert.equal(urlEspelhoValida('não é url'), false);
  let chamou = false;
  const r = espelharNoSdr({ ts: 't', canal: 'whatsapp', sessao: 'wa:1', mensagem: 'a', resposta: 'b' }, { env: { SDR_SYNC_URL: 'http://sdr.exemplo/x', SDR_SYNC_KEY: 'k' }, fetchFn: async () => { chamou = true; } });
  assert.equal(r, null);
  assert.equal(chamou, false);
});

test('chaveIp: IPv6 agrupado por /64; IPv4 e IPv4 mapeado ficam como estão', () => {
  assert.equal(chaveIp('2804:14c:65a1:4b2a:1111:2222:3333:4444'), '2804:14c:65a1:4b2a::/64');
  assert.equal(chaveIp('2804:14c:65a1:4b2a::9'), '2804:14c:65a1:4b2a::/64', 'mesmo /64');
  assert.equal(chaveIp('2804:14c::1'), '2804:14c:0:0::/64');
  assert.equal(chaveIp('::ffff:200.1.2.3'), '200.1.2.3');
  assert.equal(chaveIp('200.1.2.3'), '200.1.2.3');
  assert.equal(chaveIp(''), 'sem-ip');
});

test('tetos diários: persistem (sobrevivem a reinício) e zeram na virada do dia em São Paulo', () => {
  const arquivo = path.join(dir, 'tetos.json');
  const agora = relogio(Date.parse('2026-10-21T02:30:00Z')); // 23h30 do dia 20 em SP
  const t1 = criarTetos({ arquivo, agora });
  assert.equal(t1.contar('wa', '*', 2), true);
  assert.equal(t1.contar('wa', '*', 2), true);
  assert.equal(t1.contar('wa', '*', 2), false, 'terceira estoura');
  assert.equal(t1.dia(), '2026-10-20');
  const t2 = criarTetos({ arquivo, agora }); // "deploy": novo processo, mesmo arquivo
  assert.equal(t2.uso('wa'), 3);
  agora.avancar(60 * 60 * 1000); // 00h30 do dia 21 em SP
  assert.equal(t2.uso('wa'), 0, 'novo dia do calendário');
  assert.equal(t2.dia(), '2026-10-21');
});

test('mascaramento único', () => {
  assert.equal(mascararTelefone('5541984151085'), '55419****1085');
  assert.equal(mascarar('wa:5541984151085'), '55419****1085');
  assert.equal(mascarar('site:abcdef1234567890'), 'site abcd…');
});
