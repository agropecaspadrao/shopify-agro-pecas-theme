import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dataDirTemporario } from './_setup.js';

const dir = dataDirTemporario();
const { definirSaldo, saldoEstimado } = await import('../src/custos.js');
const { gastoTotal, statusCredito, marcarErroCredito } = await import('../src/gasto.js');
const { limparRegistroAntigo } = await import('../src/memoria/index.js');
const { verificarSaldoBaixo } = await import('../src/alerta.js');
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
});

test('contador persistente: a limpeza de registros antigos NÃO faz o saldo subir', () => {
  // registro antigo (100 dias atrás) com gasto; o contador nasce dele na migração
  const antigo = new Date(Date.now() - 100 * 86400000);
  fs.writeFileSync(`${dir}/registro-${antigo.toISOString().slice(0, 10)}.jsonl`, JSON.stringify({ ts: antigo.toISOString(), canal: 'site', sessao: 's', mensagem: 'm', resposta: 'r', custo: 2 }) + '\n');
  assert.equal(gastoTotal(), 2, 'migração soma o registro existente uma vez');
  definirSaldo(10, { agora: umaHoraAtras });
  gastar(1);
  assert.equal(saldoEstimado().restante, 9);
  assert.deepEqual(limparRegistroAntigo(dir, 90), [`registro-${antigo.toISOString().slice(0, 10)}.jsonl`]);
  assert.equal(saldoEstimado().restante, 9, 'não sobe depois da limpeza');
  assert.equal(gastoTotal(), 3);
});

test('saldo.json antigo (sem gastoNaBase) é migrado uma vez pelo registro desde a base', () => {
  gastar(0.4); // antes da base: não conta
  const base = new Date(Date.now() + 1000).toISOString();
  fs.writeFileSync(`${dir}/saldo.json`, JSON.stringify({ usd: 5, desde: base }));
  const s = saldoEstimado();
  assert.equal(s.gasto, 0);
  assert.equal(JSON.parse(fs.readFileSync(`${dir}/saldo.json`, 'utf8')).gastoNaBase, 0.4);
});

test('crédito esgotado visto pela API aparece no saldo; desatualizado não alerta como saldo baixo, alerta como desatualizado', async () => {
  definirSaldo(0.5, { agora: umaHoraAtras });
  gastar(0.6);
  marcarErroCredito();
  let s = saldoEstimado();
  assert.equal(s.creditoEsgotado, true);
  assert.equal(s.desatualizado, false, 'esgotado de verdade não é recarga não informada');
  assert.equal(statusCredito().esgotado, true);
  await new Promise((r) => setTimeout(r, 5));
  gastar(0.01); // chamada paga com sucesso: há crédito de novo
  s = saldoEstimado();
  assert.equal(s.creditoEsgotado, false);
  assert.equal(s.desatualizado, true);
  const alertas = [];
  await verificarSaldoBaixo({ reportarAnomalia: async (ev) => alertas.push(ev) });
  assert.equal(alertas[0]?.tipo, 'anthropic_saldo_desatualizado');
});
