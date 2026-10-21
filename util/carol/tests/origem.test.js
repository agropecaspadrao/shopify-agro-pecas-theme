import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dataDirTemporario } from './_setup.js';

const dir = dataDirTemporario();
process.env.SDR_SYNC_URL = 'https://sdr.exemplo/turno';
process.env.CAROL_ADMIN_KEY = 'chave-teste';
const { montarOrigem, plataformaDe } = await import('../src/origem.js');
const { registrarAtendimento } = await import('../src/registro.js');
const { extrairMensagens } = await import('../src/whatsapp.js');

test('montarOrigem: anúncio (plataforma pela URL), catálogo, site e orgânico, só campos presentes', () => {
  assert.deepEqual(
    montarOrigem({ canal: 'whatsapp', anuncio: { titulo: 'Bombas', url: 'https://www.instagram.com/p/abc', sourceType: 'ad', sourceId: '120', ctwaClid: 'clid1' } }),
    { tipo: 'anuncio', plataforma: 'instagram', source_type: 'ad', source_id: '120', source_url: 'https://www.instagram.com/p/abc', headline: 'Bombas', ctwa_clid: 'clid1' }
  );
  assert.deepEqual(montarOrigem({ canal: 'whatsapp', anuncio: { titulo: 'Bombas', url: 'https://fb.me/xyz' } }), { tipo: 'anuncio', plataforma: 'facebook', source_url: 'https://fb.me/xyz', headline: 'Bombas' });
  assert.deepEqual(montarOrigem({ canal: 'whatsapp', anuncio: { titulo: 'Bombas', url: '' } }), { tipo: 'anuncio', plataforma: 'facebook', headline: 'Bombas' }, 'anúncio sem URL = facebook');
  assert.equal(plataformaDe('https://m.facebook.com/story'), 'facebook');
  assert.equal(plataformaDe('https://agropecaspadrao.com.br'), null);
  assert.deepEqual(montarOrigem({ canal: 'whatsapp', produtoCatalogo: 'H-102724' }), { tipo: 'catalogo', produto: 'H-102724' });
  assert.deepEqual(montarOrigem({ canal: 'site' }), { tipo: 'site' });
  assert.deepEqual(montarOrigem({ canal: 'whatsapp' }), { tipo: 'organico' });
});

test('webhook: extrai source_type, source_id e ctwa_clid do referral', () => {
  const [m] = extrairMensagens({
    entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'wamid.origem1', from: '5541999990001', type: 'text', text: { body: 'oi' }, referral: { headline: 'Bombas', body: 'texto', source_url: 'https://fb.me/x', source_type: 'ad', source_id: '120', ctwa_clid: 'clid9' } }] } }] }],
  });
  assert.deepEqual(m.anuncio, { titulo: 'Bombas', corpo: 'texto', url: 'https://fb.me/x', sourceType: 'ad', sourceId: '120', ctwaClid: 'clid9' });
});

test('registro e espelho no SDR levam `origem` quando o turno tem; sem origem, payload antigo', async () => {
  const corpos = [];
  globalThis.fetch = async (url, opts) => {
    corpos.push({ url, corpo: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true, status: 200 };
  };
  const origem = { tipo: 'anuncio', plataforma: 'facebook', headline: 'Bombas', ctwa_clid: 'c1' };
  registrarAtendimento({ canal: 'whatsapp', sessao: 'wa:5541999990001', mensagem: 'oi', resposta: 'Olá', origem });
  registrarAtendimento({ canal: 'whatsapp', sessao: 'wa:5541999990001', mensagem: 'e o prazo?', resposta: '5 dias' });
  registrarAtendimento({ canal: 'site', sessao: 'site:abc', mensagem: 'oi', resposta: 'Olá', origem: { tipo: 'site' } });
  await new Promise((r) => setImmediate(r));

  assert.equal(corpos.length, 2, 'site não vai para o SDR');
  assert.equal(corpos[0].url, 'https://sdr.exemplo/turno');
  assert.equal(corpos[0].headers['x-carol-key'], 'chave-teste');
  assert.deepEqual(corpos[0].corpo.origem, origem);
  assert.deepEqual(Object.keys(corpos[1].corpo).sort(), ['canal', 'mensagem', 'resposta', 'sessao', 'ts'], 'turno sem origem mantém o contrato antigo');

  const arq = fs.readdirSync(dir).find((n) => n.startsWith('registro-'));
  const linhas = fs.readFileSync(path.join(dir, arq), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(linhas[0].origem, origem);
  assert.equal(linhas[1].origem, undefined);
  assert.deepEqual(linhas[2].origem, { tipo: 'site' });
});
