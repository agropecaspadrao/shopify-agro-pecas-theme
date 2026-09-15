import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dataDirTemporario, relogio } from './_setup.js';

const dir = dataDirTemporario();
const agenda = await import('../src/agenda.js');

const H = 3600 * 1000;

beforeEach(() => {
  agenda.limparTarefas();
  try {
    fs.unlinkSync(path.join(dir, 'agenda.json'));
  } catch {}
});

test('proximaOcorrencia: 8h de Brasília é 11h UTC, hoje ou amanhã', () => {
  const t = Date.parse('2026-09-15T10:00:00Z'); // 07:00 BRT
  assert.equal(agenda.proximaOcorrencia({ hora: 8, minuto: 0 }, t), Date.parse('2026-09-15T11:00:00Z'));
  const t2 = Date.parse('2026-09-15T12:00:00Z'); // 09:00 BRT, já passou
  assert.equal(agenda.proximaOcorrencia({ hora: 8, minuto: 0 }, t2), Date.parse('2026-09-16T11:00:00Z'));
  assert.equal(agenda.proximaOcorrencia({ hora: 8, minuto: 0 }, t2, { anterior: true }), Date.parse('2026-09-15T11:00:00Z'));
});

test('proximaOcorrencia semanal: segunda 07:55 BRT', () => {
  const quarta = Date.parse('2026-09-16T15:00:00Z');
  const prox = agenda.proximaOcorrencia({ diaSemana: 1, hora: 7, minuto: 55 }, quarta);
  assert.equal(prox, Date.parse('2026-09-21T10:55:00Z'));
  const ant = agenda.proximaOcorrencia({ diaSemana: 1, hora: 7, minuto: 55 }, quarta, { anterior: true });
  assert.equal(ant, Date.parse('2026-09-14T10:55:00Z'));
});

test('iniciar: tarefa perdida dentro da janela roda agora e reporta atraso; fora da janela não roda', async () => {
  const exec = [];
  const anomalias = [];
  agenda.registrarTarefa({ nome: 'dai', quando: { hora: 8, minuto: 0 }, executar: async () => { exec.push('dai'); return 'ok'; } });
  agenda.registrarTarefa({ nome: 'tarde', quando: { hora: 20, minuto: 0 }, executar: async () => { exec.push('tarde'); return 'ok'; } });
  // 10:00 BRT: a das 8h atrasou 2h (dentro de 6h); a das 20h de ontem atrasou 14h (fora)
  const agora = relogio(Date.parse('2026-09-15T13:00:00Z'));
  const rec = await agenda.iniciar({ agora, reportarAnomalia: async (a) => anomalias.push(a), janelaHoras: 6, semTimers: true });
  assert.deepEqual(exec, ['dai']);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].atrasoMin, 120);
  assert.equal(anomalias[0].tipo, 'agenda_atrasada');
  const lista = agenda.listar({ agora });
  assert.match(lista.find((t) => t.nome === 'dai').motivo, /recuperada/);
  assert.equal(lista.find((t) => t.nome === 'tarde').ultimaExecucao, undefined);
});

test('iniciar: tarefa já executada hoje não roda de novo', async () => {
  let n = 0;
  agenda.registrarTarefa({ nome: 'dai', quando: { hora: 8, minuto: 0 }, executar: async () => { n++; } });
  const agora = relogio(Date.parse('2026-09-15T13:00:00Z'));
  await agenda.iniciar({ agora, janelaHoras: 6, semTimers: true });
  assert.equal(n, 1);
  agora.avancar(H);
  await agenda.iniciar({ agora, janelaHoras: 6, semTimers: true });
  assert.equal(n, 1, 'segundo boot no mesmo dia: já rodou');
});

test('executarAgora registra falha sem derrubar e listar mostra próxima', async () => {
  agenda.registrarTarefa({ nome: 'quebra', quando: { hora: 8 }, executar: async () => { throw new Error('boom'); } });
  const r = await agenda.executarAgora('quebra');
  assert.equal(r.ok, false);
  assert.match(r.resumo, /boom/);
  const l = agenda.listar()[0];
  assert.equal(l.motivo, 'manual');
  assert.ok(l.proxima);
  await assert.rejects(() => agenda.executarAgora('nao-existe'), /desconhecida/);
});
