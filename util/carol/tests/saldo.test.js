import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dataDirTemporario } from './_setup.js';

const dir = dataDirTemporario();
const { definirSaldo, saldoEstimado } = await import('../src/custos.js');
const { registrarAtendimento } = await import('../src/registro.js');

const umaHoraAtras = () => Date.now() - 60 * 60 * 1000;
const gastar = (custo) => registrarAtendimento({ canal: 'site', sessao: 's', mensagem: 'm', resposta: 'r', custo });

beforeEach(() => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(`${dir}/${f}`, { recursive: true, force: true });
});

test('saldo com folga: restante = base - gasto, não desatualizado', () => {
  definirSaldo(1, { agora: umaHoraAtras });
  gastar(0.3);
  const s = saldoEstimado();
  assert.equal(s.restante.toFixed(2), '0.70');
  assert.equal(s.desatualizado, false);
});

test('gasto bate exatamente no crédito: zerado, ainda não desatualizado', () => {
  definirSaldo(0.5, { agora: umaHoraAtras });
  gastar(0.25);
  gastar(0.25);
  const s = saldoEstimado();
  assert.equal(s.restante, 0);
  assert.equal(s.desatualizado, false);
});

test('chamada paga com sucesso depois de esgotar = recarga não informada', () => {
  definirSaldo(0.5, { agora: umaHoraAtras });
  gastar(0.5);
  gastar(0.01);
  const s = saldoEstimado();
  assert.equal(s.restante, 0);
  assert.equal(s.desatualizado, true);
  assert.ok(s.esgotouEm);
});
