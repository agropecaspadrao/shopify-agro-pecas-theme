import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, relogio } from './_setup.js';

dataDirTemporario();
const { tratarMensagemAdmin, ehComando, interpretar, fatiar, limparEstados } = await import('../src/comandos/comandos.js');

const ADMIN = '5541999990000';
const CLIENTE = '5541888880000';

function deps(extra = {}) {
  const anomalias = [];
  return {
    anomalias,
    deps: {
      admins: [ADMIN],
      agora: relogio(),
      validarChave: (t) => t === 'agro-trator-42',
      reportarAnomalia: async (a) => anomalias.push(a),
      montarRelatorio: async () => ({ assunto: 'Carol: resumo', corpo: 'Cliente X pediu bomba.' }),
      verificarTudo: async () => ({ geral: 'ok', ts: new Date().toISOString(), resultados: [] }),
      textoSaude: (e) => `Saude geral: ${e.geral}`,
      enviarRelatorioSocios: async () => ({ enviadoPara: ['socios@x.com'] }),
      rotacionarChave: async () => ({ enviadaPara: ['socios@x.com'] }),
      ...extra,
    },
  };
}

beforeEach(() => limparEstados());

test('ehComando e interpretar', () => {
  assert.equal(ehComando('/carol'), true);
  assert.equal(ehComando('  /CAROL saude'), true);
  assert.equal(ehComando('carol'), false);
  assert.equal(ehComando('/carolina'), false);
  assert.equal(interpretar('/carol'), 'relatorio');
  assert.equal(interpretar('/carol SAÚDE'), 'saude');
  assert.equal(interpretar('/carol qualquer'), 'ajuda');
});

test('cliente comum: /carol é ignorado em silêncio; texto normal segue para a Carol', async () => {
  const d = deps();
  const r1 = await tratarMensagemAdmin({ de: CLIENTE, texto: '/carol' }, d.deps);
  assert.deepEqual(r1, { tratado: true, respostas: [] });
  const r2 = await tratarMensagemAdmin({ de: CLIENTE, texto: 'quero uma bomba' }, d.deps);
  assert.equal(r2.tratado, false);
});

test('admin: pede a palavra-chave, valida e entrega o relatório; depois não pede de novo por 15 min', async () => {
  const d = deps();
  const r1 = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol' }, d.deps);
  assert.equal(r1.tratado, true);
  assert.match(r1.respostas[0], /palavra-chave/i);
  const r2 = await tratarMensagemAdmin({ de: ADMIN, texto: 'agro-trator-42' }, d.deps);
  assert.equal(r2.tratado, true);
  assert.match(r2.respostas[0], /Carol: resumo/);
  assert.match(r2.respostas[0], /bomba/);
  const r3 = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol saude' }, d.deps);
  assert.match(r3.respostas[0], /Saude geral: ok/, 'já autenticado, executa direto');
  d.deps.agora.avancar(16 * 60 * 1000);
  const r4 = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol saude' }, d.deps);
  assert.match(r4.respostas[0], /palavra-chave/i, 'autenticação expirou');
});

test('admin: texto sem comando e sem pendência segue para a Carol normal', async () => {
  const d = deps();
  const r = await tratarMensagemAdmin({ de: ADMIN, texto: 'oi, tudo bem?' }, d.deps);
  assert.equal(r.tratado, false);
});

test('três palavras erradas em uma hora bloqueiam e geram anomalia de segurança', async () => {
  const d = deps();
  await tratarMensagemAdmin({ de: ADMIN, texto: '/carol' }, d.deps);
  const e1 = await tratarMensagemAdmin({ de: ADMIN, texto: 'errada1' }, d.deps);
  assert.match(e1.respostas[0], /restantes: 2/);
  const e2 = await tratarMensagemAdmin({ de: ADMIN, texto: 'errada2' }, d.deps);
  assert.match(e2.respostas[0], /restantes: 1/);
  const e3 = await tratarMensagemAdmin({ de: ADMIN, texto: 'errada3' }, d.deps);
  assert.match(e3.respostas[0], /bloqueados/i);
  assert.equal(d.anomalias.length, 1);
  assert.equal(d.anomalias[0].tipo, 'seguranca_tentativas');
  const dep = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol' }, d.deps);
  assert.deepEqual(dep.respostas, [], 'bloqueado: silêncio');
  d.deps.agora.avancar(61 * 60 * 1000);
  const volta = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol' }, d.deps);
  assert.match(volta.respostas[0], /palavra-chave/i, 'após 1h volta a aceitar');
});

test('pendência expira em 5 minutos', async () => {
  const d = deps();
  await tratarMensagemAdmin({ de: ADMIN, texto: '/carol' }, d.deps);
  d.deps.agora.avancar(6 * 60 * 1000);
  const r = await tratarMensagemAdmin({ de: ADMIN, texto: 'agro-trator-42' }, d.deps);
  assert.equal(r.tratado, false, 'palavra chegou tarde: vira mensagem comum');
});

test('subcomandos socios, chave e ajuda; a palavra nova nunca vai pelo WhatsApp', async () => {
  const d = deps();
  await tratarMensagemAdmin({ de: ADMIN, texto: '/carol socios' }, d.deps);
  const s = await tratarMensagemAdmin({ de: ADMIN, texto: 'agro-trator-42' }, d.deps);
  assert.match(s.respostas[0], /enviado por e-mail para socios@x.com/);
  const c = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol chave' }, d.deps);
  assert.match(c.respostas[0], /enviada por e-mail/);
  assert.doesNotMatch(c.respostas[0], /agro-[a-z]+-\d{2}/);
  const a = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol ajuda' }, d.deps);
  assert.match(a.respostas[0], /\/carol saude/);
});

test('falha na execução vira mensagem amigável, não exceção', async () => {
  const d = deps({ montarRelatorio: async () => { throw new Error('IA fora do ar'); } });
  await tratarMensagemAdmin({ de: ADMIN, texto: '/carol' }, d.deps);
  const r = await tratarMensagemAdmin({ de: ADMIN, texto: 'agro-trator-42' }, d.deps);
  assert.match(r.respostas[0], /IA fora do ar/);
});

test('fatiar respeita o limite e numera as partes', () => {
  const linhas = Array.from({ length: 200 }, (_, i) => `linha ${i} ${'x'.repeat(40)}`).join('\n');
  const partes = fatiar(linhas, 1000);
  assert.ok(partes.length > 1);
  for (const p of partes) assert.ok(p.length <= 1000 + 12, `parte com ${p.length} chars`);
  assert.match(partes[0], /^\(1\/\d+\)/);
  assert.equal(fatiar('curto', 1000).length, 1);
  assert.equal(fatiar('curto', 1000)[0], 'curto');
});
