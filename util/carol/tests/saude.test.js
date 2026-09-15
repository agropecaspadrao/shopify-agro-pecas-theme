import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, fetchFalso, relogio } from './_setup.js';

dataDirTemporario();
process.env.WA_PHONE_NUMBER_ID = '111';
process.env.WA_ACCESS_TOKEN = 'tok-principal';
process.env.WA_ACCESS_TOKEN_FALLBACK = 'tok-reserva';
process.env.ANTHROPIC_API_KEY = 'sk-teste';
process.env.META_ACCESS_TOKEN = 'meta-tok';

const { config } = await import('../src/config.js');
const V = await import('../src/saude/verificadores.js');
const { recuperarWhatsApp, recuperarCatalogo } = await import('../src/saude/recuperacao.js');
const { verificarTudo, ultimoEstado, textoSaude } = await import('../src/saude/supervisor.js');
const { limparAnomalias } = await import('../src/alertas/anomalias.js');

const DIA = 24 * 3600 * 1000;

test('verificarWhatsApp: 401 → falha token inválido; expiração próxima → aviso; permanente → ok', async () => {
  const f401 = fetchFalso({ '/111?': { status: 401, corpo: { error: { message: 'expired', code: 190 } } } });
  const r = await V.verificarWhatsApp({ fetchFn: f401 });
  assert.equal(r.estado, 'falha');
  assert.equal(r.tipoAnomalia, 'whatsapp_token_invalido');

  const agora = relogio();
  const fExp = fetchFalso({
    '/111?': { corpo: { display_phone_number: '+55 41 8415-1085' } },
    'debug_token': { corpo: { data: { expires_at: Math.floor((agora() + 3 * DIA) / 1000) } } },
  });
  const r2 = await V.verificarWhatsApp({ fetchFn: fExp, agora });
  assert.equal(r2.estado, 'aviso');
  assert.equal(r2.tipoAnomalia, 'whatsapp_token_expira');

  const fOk = fetchFalso({ '/111?': { corpo: { display_phone_number: '+55' } }, 'debug_token': { corpo: { data: { expires_at: 0 } } } });
  const r3 = await V.verificarWhatsApp({ fetchFn: fOk, agora });
  assert.equal(r3.estado, 'ok');
  assert.match(r3.resumo, /permanente/);
});

test('verificarAnthropic: 401 chave; 400 crédito; 200 ok', async () => {
  assert.equal((await V.verificarAnthropic({ fetchFn: fetchFalso({ count_tokens: { status: 401, corpo: { error: { message: 'invalid x-api-key' } } } }) })).tipoAnomalia, 'anthropic_chave');
  assert.equal((await V.verificarAnthropic({ fetchFn: fetchFalso({ count_tokens: { status: 400, corpo: { error: { message: 'Your credit balance is too low' } } } }) })).tipoAnomalia, 'anthropic_credito');
  const ok = await V.verificarAnthropic({ fetchFn: fetchFalso({ count_tokens: { corpo: { input_tokens: 3 } } }) });
  assert.equal(ok.estado, 'ok');
});

test('verificarMeta: inválido → falha; válido permanente → ok', async () => {
  const inv = await V.verificarMeta({ fetchFn: fetchFalso({ debug_token: { corpo: { data: { is_valid: false, error: { message: 'logged out' } } } } }) });
  assert.equal(inv.tipoAnomalia, 'meta_token_invalido');
  const ok = await V.verificarMeta({ fetchFn: fetchFalso({ debug_token: { corpo: { data: { is_valid: true, expires_at: 0, scopes: ['ads_read'] } } } }) });
  assert.equal(ok.estado, 'ok');
});

test('verificarInventario: acha a última edição e avisa quando parado há muitos dias', async () => {
  const agora = relogio();
  const produtos = [
    { title: 'A', handle: 'a', updated_at: new Date(agora() - 2 * DIA).toISOString(), variants: [{ available: true }] },
    { title: 'B', handle: 'b', updated_at: new Date(agora() - 40 * DIA).toISOString(), variants: [{ available: false }] },
  ];
  const ok = await V.verificarInventario({ fetchFn: fetchFalso({ 'products.json': { corpo: { products: produtos } } }), agora });
  assert.equal(ok.estado, 'ok');
  assert.equal(ok.dados.produtos, 2);
  assert.equal(ok.dados.semEstoque, 1);
  assert.equal(ok.dados.ultimoProduto, 'A');
  agora.avancar(35 * DIA);
  const parado = await V.verificarInventario({ fetchFn: fetchFalso({ 'products.json': { corpo: { products: produtos } } }), agora });
  assert.equal(parado.estado, 'aviso');
  assert.equal(parado.tipoAnomalia, 'inventario_desatualizado');
});

test('verificarMaster: sem conta de serviço → nao_configurado', async () => {
  const r = await V.verificarMaster();
  assert.equal(r.estado, 'nao_configurado');
});

test('recuperarWhatsApp: troca para o reserva se ele for válido, e registra quando não é', async () => {
  const fOk = fetchFalso({ '/111?': { corpo: { display_phone_number: '+55' } }, 'debug_token': { corpo: { data: { expires_at: 0 } } } });
  const r = await recuperarWhatsApp({}, { fetchFn: fOk });
  assert.equal(r.recuperou, true);
  assert.equal(config.waAccessToken, 'tok-reserva');
  const f401 = fetchFalso({ '/111?': { status: 401, corpo: { error: { code: 190 } } } });
  const r2 = await recuperarWhatsApp({}, { fetchFn: f401, tokenReserva: 'outro' });
  assert.equal(r2.recuperou, false);
  assert.match(r2.descricao, /reserva também inválido/);
  const r3 = await recuperarWhatsApp({}, { tokenReserva: '' });
  assert.match(r3.descricao, /sem token reserva/);
});

test('recuperarCatalogo: tenta 3 vezes com espera crescente', async () => {
  let n = 0;
  const esperas = [];
  const r = await recuperarCatalogo({}, { carregarCatalogo: async () => { n++; if (n < 3) throw new Error('rede'); }, esperar: async (ms) => esperas.push(ms) });
  assert.equal(r.recuperou, true);
  assert.deepEqual(esperas, [2000, 4000]);
  const r2 = await recuperarCatalogo({}, { carregarCatalogo: async () => { throw new Error('rede'); }, esperar: async () => {} });
  assert.equal(r2.recuperou, false);
});

test('supervisor: consolida, recupera, reporta anomalias e detecta "voltou ao normal"', async () => {
  limparAnomalias();
  const reportadas = [];
  const reportar = async (a) => reportadas.push(a);
  const okV = async () => ({ nome: 'x', estado: 'ok', resumo: 'tudo certo' });
  let falhaV = async () => ({ nome: 'y', estado: 'falha', tipoAnomalia: 'catalogo_falha', resumo: 'quebrou' });
  const avisoV = async () => ({ nome: 'z', estado: 'aviso', tipoAnomalia: 'inventario_desatualizado', resumo: 'parado' });
  const explode = async () => { throw new Error('bug no verificador'); };

  const e1 = await verificarTudo({ verificadores: [okV, falhaV, avisoV, explode], recuperacoes: { y: async () => ({ recuperou: false, descricao: 'nada' }) }, reportarAnomalia: reportar });
  assert.equal(e1.geral, 'falha');
  assert.equal(e1.resultados.length, 4);
  assert.equal(e1.resultados[3].estado, 'falha');
  assert.match(e1.resultados[3].detalhe, /bug no verificador/);
  assert.deepEqual(reportadas.map((a) => a.tipo).sort(), ['catalogo_falha', 'inventario_desatualizado', 'saude_falha']);
  assert.equal(reportadas.find((a) => a.tipo === 'inventario_desatualizado').severidade, 'media');
  assert.equal(ultimoEstado().geral, 'falha');
  assert.match(textoSaude(e1), /FALHA\s+y: quebrou/);

  // recuperação automática bem-sucedida
  reportadas.length = 0;
  let vezes = 0;
  falhaV = async () => (++vezes === 1 ? { nome: 'y', estado: 'falha', tipoAnomalia: 'catalogo_falha', resumo: 'quebrou' } : { nome: 'y', estado: 'ok', resumo: 'voltou' });
  const e2 = await verificarTudo({ verificadores: [falhaV], recuperacoes: { y: async () => ({ recuperou: true, descricao: 'recarreguei' }) }, reportarAnomalia: reportar });
  assert.equal(e2.geral, 'ok');
  assert.equal(e2.resultados[0].recuperadoAutomaticamente, true);
  assert.equal(reportadas[0].tipo, 'recuperacao_automatica');

  // "voltou ao normal" sem recuperação nossa: avisa uma vez como recuperado
  await verificarTudo({ verificadores: [async () => ({ nome: 'y', estado: 'falha', tipoAnomalia: 'catalogo_falha', resumo: 'caiu' })], recuperacoes: {}, reportarAnomalia: async () => {} });
  reportadas.length = 0;
  await verificarTudo({ verificadores: [async () => ({ nome: 'y', estado: 'ok', resumo: 'ok' })], recuperacoes: {}, reportarAnomalia: reportar });
  assert.equal(reportadas.length, 1);
  assert.equal(reportadas[0].recuperado, true);
  assert.match(reportadas[0].titulo, /^Resolvido:/);
});
