import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, relogio } from './_setup.js';

dataDirTemporario();
const { tratarMensagemAdmin, ehComando, interpretar, argumento, fatiar, limparEstados, normalizarNumero, mesmoNumero, avisoSilencioAdmin } = await import('../src/comandos/comandos.js');
const { pausada, retomar, estadoPausa } = await import('../src/comandos/pausa.js');

const ADMIN = '5541999990000';
const ADMIN_SEM_NONO_DIGITO = '554199990000'; // como chega no webhook para números antigos
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
      resumoCompacto: async () => '*Atendimentos das ultimas 24h*\n1. WhatsApp 5541999990001: pediu bomba. Aguarda orcamento.',
      detalheConversa: (ref) => `*Conversa ${ref}*\n[10:00] Cliente: quero uma bomba\nCarol: qual modelo?`,
      verificarTudo: async () => ({ geral: 'ok', ts: new Date().toISOString(), resultados: [] }),
      textoSaude: (e) => `Saude geral: ${e.geral}`,
      enviarRelatorioSocios: async () => ({ enviadoPara: ['socios@x.com'] }),
      rotacionarChave: async () => ({ enviadaPara: ['socios@x.com'] }),
      ...extra,
    },
  };
}

beforeEach(() => {
  limparEstados();
  retomar();
});

test('ehComando e interpretar', () => {
  assert.equal(ehComando('/carol'), true);
  assert.equal(ehComando('  /CAROL saude'), true);
  assert.equal(ehComando('carol'), false);
  assert.equal(ehComando('/carolina'), false);
  assert.equal(interpretar('/carol'), 'relatorio');
  assert.equal(interpretar('/carol SAÚDE'), 'saude');
  assert.equal(interpretar('/carol qualquer'), 'ajuda');
  assert.equal(interpretar('/carol pausar'), 'pausar');
  assert.equal(interpretar('/carol Pausa 4'), 'pausar', 'apelido');
  assert.equal(interpretar('/carol voltar'), 'voltar');
  assert.equal(interpretar('/carol retomar'), 'voltar', 'apelido');
});

test('nono dígito: número antigo (12 dígitos) é reconhecido como o mesmo administrador', async () => {
  assert.equal(normalizarNumero('5541999990000'), '554199990000');
  assert.equal(normalizarNumero('554199990000'), '554199990000');
  assert.equal(normalizarNumero('5541 99999-0000'), '554199990000');
  assert.equal(mesmoNumero('5541999990000', '554199990000'), true);
  assert.equal(mesmoNumero('5541999990000', '5541999990001'), false);
  assert.equal(normalizarNumero('5554991133403'), '555491133403');
  assert.equal(mesmoNumero('5554991133403', '555491139380'), false, 'número parecido mas diferente não passa');
  const d = deps();
  const r = await tratarMensagemAdmin({ de: ADMIN_SEM_NONO_DIGITO, texto: '/carol' }, d.deps);
  assert.equal(r.tratado, true);
  assert.match(r.respostas[0], /palavra-chave/i, 'pede a palavra em vez de ignorar como cliente');
});

test('/carol pausar: 2 horas por padrão, número de horas opcional, e /carol voltar encerra', async () => {
  const d = deps();
  await tratarMensagemAdmin({ de: ADMIN, texto: '/carol pausar' }, d.deps);
  const r = await tratarMensagemAdmin({ de: ADMIN, texto: 'agro-trator-42' }, d.deps);
  assert.match(r.respostas[0], /Carol pausada no WhatsApp ate as \d{2}:\d{2} \(2 horas\)/);
  assert.match(r.respostas[0], /\/carol voltar/);
  assert.equal(pausada({ agora: d.deps.agora }), true);
  assert.equal(estadoPausa({ agora: d.deps.agora }).por, ADMIN, 'registra quem pausou');

  const s = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol status' }, d.deps);
  assert.match(s.respostas[0], /Pausa manual: ATIVA/);

  const r4 = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol pausar 4' }, d.deps);
  assert.match(r4.respostas[0], /Pausa renovada ate as \d{2}:\d{2} \(4 horas\)/);
  assert.equal(estadoPausa({ agora: d.deps.agora }).restanteMin, 240);

  const v = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol voltar' }, d.deps);
  assert.match(v.respostas[0], /de volta ao atendimento/);
  assert.equal(pausada({ agora: d.deps.agora }), false);

  const v2 = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol voltar' }, d.deps);
  assert.match(v2.respostas[0], /nao estava pausada/);

  const c = await tratarMensagemAdmin({ de: CLIENTE, texto: '/carol pausar' }, d.deps);
  assert.deepEqual(c.respostas, [], 'cliente não pausa nada');
  assert.equal(pausada({ agora: d.deps.agora }), false);
});

test('pausa expira sozinha depois do prazo', async () => {
  const d = deps();
  await tratarMensagemAdmin({ de: ADMIN, texto: '/carol pausar' }, d.deps);
  await tratarMensagemAdmin({ de: ADMIN, texto: 'agro-trator-42' }, d.deps);
  d.deps.agora.avancar(2 * 60 * 60 * 1000 + 1000);
  assert.equal(pausada({ agora: d.deps.agora }), false);
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
  assert.match(r2.respostas[0], /Atendimentos das ultimas 24h/);
  assert.match(r2.respostas[0], /bomba/);
  assert.equal(r2.respostas.length, 1, 'lista compacta cabe em uma mensagem');
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

test('/carol detalhe N mostra as mensagens da conversa; sem número, pergunta qual', async () => {
  const d = deps();
  assert.equal(interpretar('/carol detalhe 2'), 'detalhe');
  assert.equal(argumento('/carol detalhe 2'), '2');
  assert.equal(argumento('/carol'), '');
  await tratarMensagemAdmin({ de: ADMIN, texto: '/carol detalhe 2' }, d.deps);
  const r = await tratarMensagemAdmin({ de: ADMIN, texto: 'agro-trator-42' }, d.deps);
  assert.match(r.respostas[0], /Conversa 2/, 'o argumento sobrevive à pergunta da palavra-chave');
  assert.match(r.respostas[0], /quero uma bomba/);
  const sem = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol detalhe' }, d.deps);
  assert.match(sem.respostas[0], /Qual conversa/);
  const ajuda = await tratarMensagemAdmin({ de: ADMIN, texto: '/carol ajuda' }, d.deps);
  assert.match(ajuda.respostas[0], /\/carol detalhe/);
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
  const d = deps({ resumoCompacto: async () => { throw new Error('IA fora do ar'); } });
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

test('aviso de silêncio: só para administrador, reconhece sem o nono dígito, no máximo um a cada 12h', () => {
  limparEstados();
  const agora = relogio();
  const admins = ['5554996874757'];
  assert.equal(avisoSilencioAdmin('5541900001111', 'horario', { agora, admins }), null, 'cliente comum não recebe aviso');
  const a = avisoSilencioAdmin('555496874757', 'horario', { agora, admins });
  assert.match(a, /horario comercial/);
  assert.match(a, /\/carol/);
  assert.equal(avisoSilencioAdmin('5554996874757', 'horario', { agora, admins }), null, 'mesmo número (com o 9) dentro das 12h não repete');
  agora.avancar(12 * 60 * 60 * 1000 + 1000);
  assert.match(avisoSilencioAdmin('555496874757', 'pausa', { agora, admins }), /pausada/);
});
