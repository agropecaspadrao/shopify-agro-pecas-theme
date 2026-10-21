// responder()/gerarResposta() com cliente Anthropic falso: saudação, origem,
// registro só depois de confirmar, memória (inclusive resposta da equipe).
// Catálogo: carga única com timeout e montarLinkCarrinho.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, fetchFalso, relogio } from './_setup.js';

dataDirTemporario();
delete process.env.DATABASE_URL;
const { gerarResposta, responder } = await import('../src/claude.js');
const { definirClienteAnthropic } = await import('../src/ia/anthropic.js');
const { criarMemoria } = await import('../src/memoria/index.js');
const { criarAdaptadorLocal } = await import('../src/memoria/local.js');
const C = await import('../src/catalogo.js');

const agora = relogio(Date.parse('2026-10-20T13:00:00Z')); // 10h em Brasília (bom dia)

function clienteFalso(textos) {
  const chamadas = [];
  const fila = [...textos];
  definirClienteAnthropic({
    beta: {
      messages: {
        toolRunner: (params) => {
          chamadas.push(params);
          const texto = fila.shift() ?? 'ok';
          return (async function* () {
            yield { content: [{ type: 'text', text: texto }], usage: { input_tokens: 100, output_tokens: 20 } };
          })();
        },
      },
    },
  });
  return chamadas;
}

function deps() {
  const registros = [];
  const memoria = criarMemoria({ local: criarAdaptadorLocal({ agora, listar: () => [] }), agora, ia: { gerarEpisodio: async () => '{}', resumirParcial: async () => '' }, reportarAnomalia: async () => {} });
  return { registros, memoria, d: { memoria, registrar: (e) => registros.push(e), garantirCatalogo: async () => false, agora } };
}

test('primeira mensagem: saudação do horário + apresentação; origem no primeiro turno; registro só no confirmar', async () => {
  clienteFalso(['Temos a bomba sim. Qual o modelo do trator?']);
  const { registros, memoria, d } = deps();
  const r = await gerarResposta('wa:5541999990001', 'tem bomba hidráulica?', 'whatsapp', { origem: { anuncio: { titulo: 'Bombas', url: 'https://fb.me/x' } } }, d);
  assert.match(r.texto, /^Bom dia! Aqui é a Carol, da APP Agro Peças Padrão/);
  assert.equal(registros.length, 0, 'nada registrado antes da entrega');
  await r.confirmar({ entregue: true });
  await r.confirmar({ entregue: true }); // idempotente
  assert.equal(registros.length, 1);
  assert.equal(registros[0].origem.tipo, 'anuncio');
  assert.equal(registros[0].custo > 0, true);
  await memoria.aguardarEscritas();
  const h = await memoria.historicoAtual('wa:5541999990001');
  assert.deepEqual(h.mensagens.map((m) => m.role), ['user', 'assistant']);
});

test('saudação errada do modelo é corrigida; cliente que cumprimenta é espelhado', async () => {
  clienteFalso(['Boa noite! Posso ajudar?']);
  const { d } = deps();
  const r = await gerarResposta('site:abcdefghijklmnop1', 'boa tarde, tudo bem?', 'site', {}, d);
  assert.match(r.texto, /^Boa tarde! Posso ajudar\?/);
});

test('resposta não entregue: registra entregue:false e a memória guarda só o cliente', async () => {
  clienteFalso(['Temos sim.']);
  const { registros, memoria, d } = deps();
  const r = await gerarResposta('wa:5541999990002', 'tem dedo retrátil?', 'whatsapp', {}, d);
  await r.confirmar({ entregue: false });
  assert.equal(registros[0].entregue, false);
  await memoria.aguardarEscritas();
  const h = await memoria.historicoAtual('wa:5541999990002');
  assert.deepEqual(h.mensagens.map((m) => m.role), ['user']);
});

test('histórico vai normalizado: resposta da equipe com prefixo, papéis seguidos juntados, começa pelo cliente', async () => {
  const chamadas = clienteFalso(['Combinado, a Dai te liga amanhã.']);
  const { memoria, d } = deps();
  await memoria.registrarTurno('wa:5541999990003', { mensagem: '', resposta: 'Te ligo amanhã', autor: 'humano', ts: agora() - 60000 });
  await memoria.registrarTurno('wa:5541999990003', { mensagem: 'ok, fico no aguardo', resposta: '', ts: agora() - 30000 });
  await responder('wa:5541999990003', 'e aí?', 'whatsapp', {}, d);
  const msgs = chamadas[0].messages;
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[1].role, 'assistant');
  assert.match(msgs[1].content, /^\[Resposta da equipe \(Dai\) pelo aplicativo/);
  assert.equal(msgs[2].role, 'user');
  assert.equal(msgs[2].content, 'ok, fico no aguardo\ne aí?', 'mensagem sem resposta + a atual viram um turno só');
  assert.equal(msgs.length, 3);
  assert.ok(chamadas[0].system.some((b) => /digitadas pela equipe humana/.test(b.text)));
});

test('erro da API sobe (quem chama faz a contingência) e nada é registrado', async () => {
  definirClienteAnthropic({ beta: { messages: { toolRunner: () => (async function* () { throw Object.assign(new Error('credit balance is too low'), { status: 400 }); })() } } });
  const { registros, d } = deps();
  await assert.rejects(() => gerarResposta('wa:5541999990004', 'oi', 'whatsapp', {}, d), /credit/);
  assert.equal(registros.length, 0);
});

// ── Catálogo ──────────────────────────────────────────────────────────────

const PRODUTOS = {
  products: [
    { handle: 'bomba-x', title: 'Bomba Hidráulica X', body_html: '<p>bomba</p>', product_type: 'Bomba', vendor: 'APP', tags: [], variants: [{ id: 111, sku: 'BX-100', price: '890.00', available: true }] },
    { handle: 'dedo-y', title: 'Dedo Retrátil Y', body_html: '', product_type: 'Dedo', vendor: 'APP', tags: [], variants: [{ id: 222, sku: 'DY-200', price: '35.00', available: false }] },
  ],
};

test('catálogo: duas chamadas simultâneas = uma carga só; falha não lança no atendimento e só tenta 1x por minuto', async () => {
  C._zerarCatalogo();
  const t = relogio(Date.parse('2026-10-20T13:00:00Z'));
  const ruim = fetchFalso({ 'products.json': { status: 503, corpo: 'fora' } });
  const reportes = [];
  assert.equal(await C.garantirCatalogo({ fetchFn: ruim, agora: t, reportar: async (e) => reportes.push(e) }), false);
  assert.equal(await C.garantirCatalogo({ fetchFn: ruim, agora: t, reportar: async (e) => reportes.push(e) }), false);
  assert.equal(ruim.chamadas.length, 1, 'segunda tentativa dentro de 1 min não baixa de novo');
  assert.equal(reportes[0].tipo, 'catalogo_falha');
  t.avancar(61000);
  const bom = fetchFalso({ 'products.json': { corpo: PRODUTOS } });
  const [a, b] = await Promise.all([C.carregarCatalogo({ fetchFn: bom, agora: t }), C.carregarCatalogo({ fetchFn: bom, agora: t })]);
  assert.equal(a, b);
  assert.equal(bom.chamadas.length, 1, 'carga única em andamento');
  assert.ok(bom.chamadas[0].opts.signal, 'download com timeout');
  assert.equal(C.estadoCatalogo().produtos, 2);
});

test('montarLinkCarrinho: link com variante e quantidade; Sob Consulta e desconhecido ficam de fora', () => {
  const t = C.montarLinkCarrinho([{ codigo: 'BX-100', quantidade: 2 }, { codigo: 'DY-200' }, { codigo: 'ZZZ-999' }]);
  assert.match(t, /\/cart\/111:2/);
  assert.match(t, /Dedo Retrátil Y .*Sob Consulta/);
  assert.match(t, /"ZZZ-999": não encontrado/);
  assert.match(C.montarLinkCarrinho([]), /Nenhum item informado/);
  assert.match(C.montarLinkCarrinho([{ codigo: 'DY-200' }]), /Não foi possível montar o link/);
});
