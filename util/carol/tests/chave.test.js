import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, relogio } from './_setup.js';

dataDirTemporario();
const { gerarPalavra, rotacionar, validar, estadoChave, precisaRotacionar, normalizar, textoEmailChave, rotacionarEEnviar } = await import('../src/comandos/chave.js');

test('gera palavra no formato agro-<palavra>-<NN>', () => {
  for (let i = 0; i < 20; i++) assert.match(gerarPalavra(), /^agro-[a-z]+-\d{2}$/);
});

test('sem chave: precisa rotacionar e nada valida', () => {
  assert.equal(precisaRotacionar(), true);
  assert.equal(validar('agro-trator-42'), false);
  assert.equal(estadoChave().existe, false);
});

test('rotaciona, valida a atual, rejeita errada, tolera caixa e espaços', () => {
  const agora = relogio();
  const { palavra, validaAte } = rotacionar({ agora });
  assert.match(palavra, /^agro-/);
  assert.equal(validar(palavra, { agora }), true);
  assert.equal(validar(palavra.toUpperCase(), { agora }), true);
  assert.equal(validar(palavra.replace(/-/g, ' '), { agora }), true);
  assert.equal(validar('agro-errada-00', { agora }), false);
  assert.equal(validar('', { agora }), false);
  assert.equal(precisaRotacionar({ agora }), false);
  assert.equal(new Date(validaAte).getTime() - agora(), 7 * 24 * 3600 * 1000);
});

test('após nova rotação a anterior vale 24h e depois morre; a atual expira em 7 dias', () => {
  const agora = relogio();
  const { palavra: antiga } = rotacionar({ agora });
  agora.avancar(3600 * 1000);
  const { palavra: nova } = rotacionar({ agora });
  assert.notEqual(antiga, nova);
  assert.equal(validar(antiga, { agora }), true, 'anterior ainda vale na transição');
  assert.equal(validar(nova, { agora }), true);
  agora.avancar(24 * 3600 * 1000 + 1000);
  assert.equal(validar(antiga, { agora }), false, 'anterior morreu após 24h');
  assert.equal(validar(nova, { agora }), true);
  agora.avancar(7 * 24 * 3600 * 1000);
  assert.equal(validar(nova, { agora }), false, 'atual expirou');
  assert.equal(precisaRotacionar({ agora }), true);
});

test('normalizar remove acento, colapsa espaços e hífens', () => {
  assert.equal(normalizar('  Agro   Tráror--42 '), 'agro-traror-42');
});

test('e-mail da chave contém a palavra e as instruções, e rotacionarEEnviar usa o transporte injetado', async () => {
  const txt = textoEmailChave('agro-safra-77', new Date().toISOString());
  assert.match(txt, /agro-safra-77/);
  assert.match(txt, /\/carol/);
  const enviados = [];
  const r = await rotacionarEEnviar({ enviarEmail: async (m) => enviados.push(m), destinatarios: ['a@x.com', 'b@x.com'] });
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].para, ['a@x.com', 'b@x.com']);
  assert.equal(enviados[0].assunto, 'Carol: palavra-chave da semana');
  assert.match(enviados[0].texto, /agro-[a-z]+-\d{2}/);
  assert.deepEqual(r.enviadaPara, ['a@x.com', 'b@x.com']);
});

test('e-mail fora: a palavra NUNCA sai pelo WhatsApp; rotação desfeita e aviso sem o conteúdo', async () => {
  const antes = estadoChave();
  const zaps = [];
  const avisos = [];
  await assert.rejects(
    () => rotacionarEEnviar({ enviarEmail: async () => { throw new Error('todos os provedores falharam'); }, enviarWhatsApp: async (n, t) => zaps.push(t), admins: ['5541999990000'], avisarAdmins: async (t) => avisos.push(t) }),
    /não rotacionada/
  );
  assert.equal(zaps.length, 0, 'nada da palavra pelo WhatsApp');
  assert.deepEqual(estadoChave(), antes, 'a palavra atual continua valendo');
  assert.equal(avisos.length, 1);
  assert.doesNotMatch(avisos[0], /agro-[a-z]+-\d{2}/, 'aviso sem o conteúdo');
  assert.match(avisos[0], /painel/);
});

test('e-mail fora com exibir:true (painel autenticado): mantém a rotação e devolve a palavra uma vez', async () => {
  const r = await rotacionarEEnviar({ enviarEmail: async () => { throw new Error('fora'); }, exibir: true, avisarAdmins: async () => {} });
  assert.equal(r.canal, 'tela');
  assert.match(r.palavra, /^agro-/);
  assert.equal(validar(r.palavra), true);
});
