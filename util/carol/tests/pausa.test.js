import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, relogio } from './_setup.js';

dataDirTemporario();
const { pausar, retomar, estadoPausa, pausada, horasDe, textoPausa, HORAS_PADRAO, HORAS_MAX, HORAS_MIN } = await import('../src/comandos/pausa.js');

beforeEach(() => retomar());

test('sem pausa: estado inativo e texto neutro', () => {
  assert.equal(estadoPausa().ativa, false);
  assert.equal(pausada(), false);
  assert.match(textoPausa(), /nenhuma/);
});

test('pausar por padrão vale 2 horas e expira sozinha', () => {
  const agora = relogio();
  const e = pausar({ por: '5541999990000', agora });
  assert.equal(e.ativa, true);
  assert.equal(e.horas, HORAS_PADRAO);
  assert.equal(e.restanteMin, 120);
  assert.equal(new Date(e.ate).getTime() - agora(), 2 * 3600000);
  agora.avancar(119 * 60 * 1000);
  assert.equal(pausada({ agora }), true, 'faltando 1 min ainda esta pausada');
  agora.avancar(2 * 60 * 1000);
  assert.equal(pausada({ agora }), false, 'passou das 2h: volta sozinha');
  assert.equal(estadoPausa({ agora }).ativa, false);
});

test('estado sobrevive a nova leitura do disco (reinício do serviço)', async () => {
  const agora = relogio();
  pausar({ horas: 1, agora });
  const modulo = await import('../src/comandos/pausa.js?reload=' + Date.now());
  assert.equal(modulo.pausada({ agora }), true);
});

test('pausar de novo renova o prazo a partir de agora', () => {
  const agora = relogio();
  pausar({ agora });
  agora.avancar(90 * 60 * 1000);
  const e = pausar({ agora });
  assert.equal(e.restanteMin, 120, 'renovada: 2h a partir do segundo comando');
});

test('voltar encerra a pausa e devolve o estado anterior', () => {
  const agora = relogio();
  pausar({ por: '5541999990000', agora });
  const antes = retomar({ agora });
  assert.equal(antes.ativa, true);
  assert.equal(antes.por, '5541999990000');
  assert.equal(pausada({ agora }), false);
  const nada = retomar({ agora });
  assert.equal(nada.ativa, false, 'voltar sem pausa nao quebra');
});

test('horasDe: vazio/inválido vira padrão; respeita mínimo e máximo', () => {
  assert.equal(horasDe(''), HORAS_PADRAO);
  assert.equal(horasDe('abc'), HORAS_PADRAO);
  assert.equal(horasDe('4'), 4);
  assert.equal(horasDe('1,5'), 1.5);
  assert.equal(horasDe('0.1'), HORAS_MIN);
  assert.equal(horasDe('48'), HORAS_MAX);
  assert.equal(pausar({ horas: 100, agora: relogio() }).horas, HORAS_MAX);
});

test('textoPausa mostra hora de Brasília, minutos restantes e número mascarado', () => {
  const agora = relogio(Date.parse('2026-09-16T21:30:00Z')); // 18:30 em Brasília
  pausar({ por: '5541999990000', agora });
  const t = textoPausa(estadoPausa({ agora }));
  assert.match(t, /ATIVA ate 20:30/);
  assert.match(t, /faltam 120 min/);
  assert.match(t, /5541\*\*\*\*0000/);
  assert.match(t, /\/carol voltar/);
});
