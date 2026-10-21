import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dataDirTemporario } from './_setup.js';

delete process.env.CAROL_24H;
const dir = dataDirTemporario();
const H = await import('../src/horarioConfig.js');
const { horarioComercial, contextoHorario, expedienteDai } = await import('../src/horario.js');

// 21/10/2026 é quarta-feira. Brasília = UTC-3.
const brt = (iso) => new Date(`${iso}-03:00`);
const EXP = { dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' };
const cfg = (modo, janelas = []) => ({ versao: 1, modo, expediente: EXP, janelas });

beforeEach(() => {
  try {
    fs.unlinkSync(path.join(dir, 'horario.json'));
  } catch {}
  H.recarregarHorario();
});

test('padrão do ambiente: só fora do expediente (comportamento anterior)', () => {
  const c = H.obterHorario();
  assert.equal(c.modo, 'fora_expediente');
  assert.equal(horarioComercial(brt('2026-10-21T12:00')), true, 'quarta 12h: Dai atende');
  assert.equal(horarioComercial(brt('2026-10-21T18:30')), false, 'quarta 18h30: Carol atende');
  assert.equal(horarioComercial(brt('2026-10-21T07:59')), false);
  assert.equal(horarioComercial(brt('2026-10-24T12:00')), false, 'sábado: Carol atende');
  assert.equal(expedienteDai(brt('2026-10-21T08:00')), true);
  assert.equal(expedienteDai(brt('2026-10-21T18:00')), false, 'fim é exclusivo');
});

test('presets 24h e só no expediente', () => {
  const c24 = cfg('24h');
  assert.equal(H.carolAtende(brt('2026-10-21T12:00'), c24), true);
  assert.equal(H.carolAtende(brt('2026-10-25T03:00'), c24), true);
  const ce = cfg('expediente');
  assert.equal(H.carolAtende(brt('2026-10-21T12:00'), ce), true);
  assert.equal(H.carolAtende(brt('2026-10-21T20:00'), ce), false);
  assert.equal(H.carolAtende(brt('2026-10-24T12:00'), ce), false, 'sábado fora do expediente');
});

test('personalizado: janela que cruza a meia-noite, sábado e domingo inteiro', () => {
  const c = cfg('personalizado', [
    { dias: [1, 2, 3, 4, 5], inicio: '18:00', fim: '08:00' },
    { dias: [6], inicio: '12:00', fim: '24:00' },
    { dias: [0], inicio: '00:00', fim: '24:00' },
  ]);
  assert.equal(H.carolAtende(brt('2026-10-21T19:00'), c), true, 'quarta 19h');
  assert.equal(H.carolAtende(brt('2026-10-22T07:59'), c), true, 'quinta 7h59 (janela de quarta)');
  assert.equal(H.carolAtende(brt('2026-10-22T08:00'), c), false, 'quinta 8h');
  assert.equal(H.carolAtende(brt('2026-10-24T07:00'), c), true, 'sábado 7h ainda é a janela de sexta 18h→8h');
  assert.equal(H.carolAtende(brt('2026-10-24T10:00'), c), false, 'sábado 10h fora');
  assert.equal(H.carolAtende(brt('2026-10-24T23:59'), c), true, 'sábado 23h59');
  assert.equal(H.carolAtende(brt('2026-10-25T13:00'), c), true, 'domingo inteiro');
  assert.equal(H.carolAtende(brt('2026-10-26T03:00'), c), false, 'segunda 3h: o domingo inteiro termina à meia-noite e não cruza');
});

test('segunda de madrugada sem janela de domingo cruzando fica em silêncio', () => {
  const c = cfg('personalizado', [{ dias: [1, 2, 3, 4, 5], inicio: '18:00', fim: '08:00' }]);
  assert.equal(H.carolAtende(brt('2026-10-26T03:00'), c), false, 'segunda 3h: janela de domingo não existe');
  assert.equal(H.carolAtende(brt('2026-10-27T03:00'), c), true, 'terça 3h: janela de segunda');
});

test('próxima mudança: transições do preset e da janela cruzando a meia-noite', () => {
  const c = cfg('fora_expediente');
  const m = H.proximaMudanca(brt('2026-10-21T12:34'), { cfg: c });
  assert.equal(m.valor, true);
  assert.equal(m.em, brt('2026-10-21T18:00').getTime());
  const m2 = H.proximaMudanca(brt('2026-10-23T19:00'), { cfg: c }); // sexta à noite
  assert.equal(m2.valor, false);
  assert.equal(m2.em, brt('2026-10-26T08:00').getTime(), 'segunda 8h');
  assert.equal(H.proximaMudanca(brt('2026-10-21T12:00'), { cfg: cfg('24h') }), null, '24h nunca muda');
  const exp = H.proximaMudanca(brt('2026-10-23T19:00'), { cfg: c, tipo: 'expediente' });
  assert.equal(H.textoQuando(exp.em, brt('2026-10-23T19:00').getTime()), 'segunda-feira às 08:00');
  assert.equal(H.textoQuando(brt('2026-10-22T08:00').getTime(), brt('2026-10-21T19:00').getTime()), 'amanhã às 08:00');
  assert.equal(H.textoQuando(brt('2026-10-21T18:00').getTime(), brt('2026-10-21T12:00').getTime()), 'hoje às 18:00');
});

test('validação: aceita o válido e recusa formatos ruins', () => {
  assert.equal(H.validarHorario(cfg('24h')).ok, true);
  assert.equal(H.validarHorario({ ...cfg('personalizado'), janelas: [] }).ok, false, 'personalizado sem janela');
  const ruins = [
    null,
    { modo: 'sempre', expediente: EXP },
    { modo: '24h' },
    { modo: '24h', expediente: { dias: [], inicio: '08:00', fim: '18:00' } },
    { modo: '24h', expediente: { dias: [7], inicio: '08:00', fim: '18:00' } },
    { modo: '24h', expediente: { dias: [1, 1], inicio: '08:00', fim: '18:00' } },
    { modo: '24h', expediente: { dias: [1], inicio: '8:00', fim: '18:00' } },
    { modo: '24h', expediente: { dias: [1], inicio: '24:00', fim: '08:00' } },
    { modo: '24h', expediente: { dias: [1], inicio: '08:00', fim: '25:00' } },
    { modo: '24h', expediente: { dias: [1], inicio: '08:00', fim: '08:00' } },
    { modo: '24h', expediente: EXP, janelas: 'x' },
    { modo: '24h', expediente: EXP, janelas: Array.from({ length: 15 }, () => EXP) },
  ];
  for (const r of ruins) assert.equal(H.validarHorario(r).ok, false, JSON.stringify(r));
  const v = H.validarHorario({ ...cfg('24h'), extra: 'x', expediente: { ...EXP, dias: [5, 1, 3], lixo: 1 } });
  assert.deepEqual(v.config.expediente, { dias: [1, 3, 5], inicio: '08:00', fim: '18:00' }, 'normaliza e descarta campos');
  assert.equal('extra' in v.config, false);
});

test('persistência atômica: salva, sobrevive a reinício e não deixa temporário', async () => {
  const salvo = H.salvarHorario(cfg('personalizado', [{ dias: [6], inicio: '12:00', fim: '24:00' }]), { por: 'painel' });
  assert.equal(salvo.atualizadoPor, 'painel');
  const arquivos = fs.readdirSync(dir);
  assert.ok(arquivos.includes('horario.json'));
  assert.equal(arquivos.filter((a) => a.endsWith('.tmp')).length, 0);
  const outro = await import('../src/horarioConfig.js?reinicio=' + Date.now());
  assert.equal(outro.obterHorario().modo, 'personalizado');
  assert.throws(() => H.salvarHorario({ modo: 'x' }), (e) => e.status === 400 && e.erros.length > 0);
  assert.equal(H.obterHorario().modo, 'personalizado', 'inválido não sobrescreve');
});

test('arquivo corrompido cai no padrão do ambiente', () => {
  fs.writeFileSync(path.join(dir, 'horario.json'), '{quebrado');
  assert.equal(H.recarregarHorario().modo, 'fora_expediente');
});

test('contexto para o Claude continua coerente', () => {
  const c = cfg('fora_expediente');
  const dia = contextoHorario(brt('2026-10-21T12:00'), c);
  assert.equal(dia.dentro, true);
  assert.match(dia.texto, /DENTRO do horário comercial \(segunda a sexta, 8h às 18h\)/);
  const noite = contextoHorario(brt('2026-10-23T20:00'), c);
  assert.equal(noite.dentro, false);
  assert.match(noite.texto, /a Carol é quem atende/);
  assert.match(noite.texto, /retorna segunda-feira às 08:00/);
  assert.equal(noite.saudacao, 'Boa noite');
  const t24 = contextoHorario(brt('2026-10-21T12:00'), cfg('24h'));
  assert.equal(t24.dentro, false);
  assert.match(t24.texto, /Carol atende o WhatsApp neste horário; a equipe comercial \(Dai\) está em expediente/);
});

test('descrições legíveis', () => {
  assert.equal(H.descreverDias([1, 2, 3, 4, 5]), 'segunda a sexta');
  assert.equal(H.descreverDias([0, 6]), 'sábado e domingo');
  assert.equal(H.descreverDias([0, 1, 2, 3, 4, 5, 6]), 'todos os dias');
  assert.equal(H.descreverJanela({ dias: [1, 2, 3, 4, 5], inicio: '18:00', fim: '08:00' }), 'segunda a sexta, 18h às 8h do dia seguinte');
  assert.equal(H.descreverJanela({ dias: [0], inicio: '00:00', fim: '24:00' }), 'domingo, dia inteiro');
});

test('origem da regra: variável até salvar no painel; painel ignora CAROL_24H; restaurar volta à variável', () => {
  assert.equal(H.obterHorario().origem, 'variavel');
  assert.match(H.descreverOrigem(), /padrão do servidor/);
  H.salvarHorario(cfg('24h'), { por: 'painel' });
  assert.equal(H.obterHorario().origem, 'painel');
  assert.match(H.descreverOrigem(), /definida no painel.*não têm efeito/);
  H.recarregarHorario();
  assert.equal(H.obterHorario().origem, 'painel', 'vale também depois de reiniciar');
  assert.equal(H.restaurarPadraoHorario().origem, 'variavel');
  assert.equal(H.obterHorario().modo, 'fora_expediente');
});

test('painel: "só no expediente" à noite = FORA DO HORÁRIO (ninguém atende), não "silêncio (Dai)"', async () => {
  const { estadoCarol } = await import('../src/admin/painel.js');
  const ce = cfg('expediente');
  const noite = estadoCarol({ agora: brt('2026-10-21T22:00').getTime(), pausa: { ativa: false }, cfg: { ...ce, origem: 'painel' } });
  assert.equal(noite.rotulo, 'FORA DO HORÁRIO (ninguém atende)');
  assert.equal(noite.origemRegra.origem, 'painel');
  const dia = estadoCarol({ agora: brt('2026-10-21T12:00').getTime(), pausa: { ativa: false }, cfg: cfg('fora_expediente') });
  assert.equal(dia.rotulo, 'EM SILÊNCIO (Dai)');
});

test('quandoEquipeResponde segue a regra em vigor (sem "seg a sex 8h às 18h" fixo)', async () => {
  const { quandoEquipeResponde } = await import('../src/horario.js');
  assert.equal(quandoEquipeResponde(brt('2026-10-21T12:00'), cfg('24h')), 'em seguida');
  assert.match(quandoEquipeResponde(brt('2026-10-21T22:00'), cfg('24h')), /^a partir de amanhã às 08:00 \(expediente: segunda a sexta, 8h às 18h\)$/);
  const sabado = { ...cfg('24h'), expediente: { dias: [1, 2, 3, 4, 5, 6], inicio: '07:00', fim: '12:00' } };
  assert.match(quandoEquipeResponde(brt('2026-10-23T20:00'), sabado), /amanhã às 07:00 \(expediente: segunda a sábado, 7h às 12h\)/);
});
