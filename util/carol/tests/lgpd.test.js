// LGPD: exclusão por cliente (memória local + registro JSONL reescrito) e
// comando "/carol apagar".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dataDirTemporario, relogio } from './_setup.js';

const dir = dataDirTemporario();
delete process.env.DATABASE_URL;
delete process.env.SDR_SYNC_URL;
const { apagarCliente, sessoesDoCliente, textoExclusao } = await import('../src/lgpd.js');
const { registrarAtendimento, apagarSessaoDoRegistro } = await import('../src/registro.js');
const { criarMemoria } = await import('../src/memoria/index.js');
const { criarAdaptadorLocal } = await import('../src/memoria/local.js');
const { tratarMensagemAdmin, limparEstados } = await import('../src/comandos/comandos.js');

test('sessoesDoCliente: telefone com e sem o nono dígito; sessão do site; inválido vazio', () => {
  assert.deepEqual(sessoesDoCliente({ telefone: '+55 (41) 99999-0001' }), ['wa:5541999990001', 'wa:554199990001']);
  assert.deepEqual(sessoesDoCliente({ telefone: '554199990001' }), ['wa:554199990001', 'wa:5541999990001']);
  assert.deepEqual(sessoesDoCliente({ sessao: 'site:abcdefghijklmnop12' }), ['site:abcdefghijklmnop12']);
  assert.deepEqual(sessoesDoCliente({ sessao: 'site:x' }), []);
  assert.deepEqual(sessoesDoCliente({ telefone: '123' }), []);
});

test('apagarCliente: apaga memória (trabalho, episódios, ficha) e reescreve o JSONL sem a sessão', async () => {
  const agora = relogio(Date.now());
  registrarAtendimento({ canal: 'whatsapp', sessao: 'wa:5541999990001', mensagem: 'tem bomba?', resposta: 'tem' });
  registrarAtendimento({ canal: 'whatsapp', sessao: 'wa:5541999990002', mensagem: 'outro cliente', resposta: 'ok' });
  registrarAtendimento({ canal: 'whatsapp', sessao: 'wa:5541999990001', mensagem: 'quanto custa?', resposta: 'R$ 10' });
  const local = criarAdaptadorLocal({ agora, listar: () => [] });
  const mem = criarMemoria({ local, agora, ia: { gerarEpisodio: async () => '{}', resumirParcial: async () => '' }, reportarAnomalia: async () => {} });
  await mem.registrarTurno('wa:5541999990001', { mensagem: 'tem bomba?', resposta: 'tem' });
  await local.concluirEpisodio({ sessao: 'wa:5541999990001', atualizadoEm: 0, episodio: { id: 'e1', sessao: 'wa:5541999990001', inicio: new Date().toISOString(), fim: new Date().toISOString(), dados: {} }, mesclarFicha: () => ({ nome: { valor: 'João', em: 'x' } }), ultimoContato: new Date().toISOString() });

  const r = await apagarCliente({ telefone: '5541999990001' }, { memoria: mem, por: '5541999990000' });
  assert.equal(r.ok, true);
  assert.equal(r.registro, 2);
  assert.deepEqual(r.sessoes, ['55419****0001', '55419****0001']);
  assert.match(textoExclusao(r), /2 linha\(s\) do registro, 1 conversa\(s\) ativa\(s\), 1 episódio\(s\), 1 ficha\(s\)/);
  assert.equal(await local.obterSessao('wa:5541999990001'), null);
  assert.equal(await local.obterFicha('wa:5541999990001'), null);

  const arq = fs.readdirSync(dir).find((n) => n.startsWith('registro-'));
  const linhas = fs.readFileSync(path.join(dir, arq), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(linhas.map((l) => l.sessao), ['wa:5541999990002'], 'só o outro cliente fica');
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')), 'sem arquivo temporário sobrando');
  const aud = fs.readFileSync(path.join(dir, 'auditoria.jsonl'), 'utf8');
  assert.match(aud, /lgpd_apagar/);
  assert.doesNotMatch(aud, /5541999990001/, 'auditoria sem o telefone completo');
  assert.equal(apagarSessaoDoRegistro('wa:nao-existe'), 0);
});

test('apagarCliente: banco fora → ok:false com aviso para repetir', async () => {
  const mem = { apagar: async () => ({ local: { trabalho: 0, episodios: 0, fichas: 0 }, banco: null, erroBanco: 'ECONNREFUSED' }) };
  const r = await apagarCliente({ telefone: '5541999990003' }, { memoria: mem, apagarRegistro: () => 0 });
  assert.equal(r.ok, false);
  assert.match(textoExclusao(r), /Repita quando o Postgres voltar/);
});

test('/carol apagar <telefone>: só administrador autenticado', async () => {
  limparEstados();
  const chamadas = [];
  const deps = {
    admins: ['5541999990000'],
    validarChave: (t) => t === 'agro-teste-11',
    apagarCliente: async (alvo) => {
      chamadas.push(alvo);
      return { ok: true, sessoes: ['55419****0001'], registro: 3, memoria: [] };
    },
    reportarAnomalia: async () => {},
  };
  // não admin: ignorado em silêncio
  assert.deepEqual(await tratarMensagemAdmin({ de: '5541988887777', texto: '/carol apagar 5541999990001' }, deps), { tratado: true, respostas: [] });
  // admin sem autenticar: pede a palavra-chave; depois executa
  assert.match((await tratarMensagemAdmin({ de: '5541999990000', texto: '/carol apagar 5541999990001' }, deps)).respostas[0], /palavra-chave/);
  const r = await tratarMensagemAdmin({ de: '5541999990000', texto: 'agro-teste-11' }, deps);
  assert.match(r.respostas[0], /3 linha\(s\) do registro/);
  assert.deepEqual(chamadas, [{ telefone: '5541999990001' }]);
});
