import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDirTemporario, relogio } from './_setup.js';

dataDirTemporario();
delete process.env.DATABASE_URL;
const { criarMemoria, limparRegistroAntigo } = await import('../src/memoria/index.js');
const { criarAdaptadorLocal } = await import('../src/memoria/local.js');
const R = await import('../src/memoria/regras.js');
const { montarBlocosSystem } = await import('../src/claude.js');
const { resumoDeEpisodios, combinarResumos, contarRetomadas, agruparConversas, textoEmailDai } = await import('../src/relatorios/atendimentos.js');

const H = 3600 * 1000;
const DIA = 24 * H;

const EPISODIO = {
  assunto: 'bomba hidráulica MF 4275',
  pecas: ['bomba 3774612M91'],
  maquina: 'compatível com MF 4275',
  objecao: 'vai ver com o sócio',
  proximo_passo: 'cliente confirma com o sócio e volta',
  status: 'em_aberto',
  resumo: 'João quer a bomba para a MF 4275. Ficou de falar com o sócio. Custa R$ 1.890,00.',
  fatos_ficha: { nome: 'João', cidade: 'Passo Fundo', uf: 'RS', tipo: 'produtor', maquinas: ['MF 4275'], pecas: [{ item: 'bomba 3774612M91', situacao: 'consultada' }], preferencias: { canal: 'audio', pagamento: 'achou o preço R$ 1.890 alto' } },
};

function iaFalsa(resposta = EPISODIO) {
  const ia = {
    episodios: 0,
    parciais: 0,
    gerarEpisodio: async (p) => {
      ia.episodios++;
      ia.ultimaEntrada = p;
      return typeof resposta === 'function' ? resposta(p) : '```json\n' + JSON.stringify(resposta) + '\n```';
    },
    resumirParcial: async ({ mensagens, resumoAnterior }) => {
      ia.parciais++;
      if (ia.falharParcial) throw new Error('haiku fora');
      return `${resumoAnterior ? resumoAnterior + ' + ' : ''}resumo de ${mensagens.length} mensagens (R$ 99,90)`;
    },
  };
  return ia;
}

function montar({ ia = iaFalsa(), primario = null, listar = () => [], dataDir } = {}) {
  const agora = relogio(Date.parse('2026-10-20T13:00:00Z'));
  const anomalias = [];
  const local = criarAdaptadorLocal({ agora, listar });
  const mem = criarMemoria({ primario, local, ia, agora, dataDir, reportarAnomalia: async (ev) => anomalias.push(ev) });
  return { mem, agora, ia, anomalias, local };
}

async function conversaReal(mem, sessao = 'wa:5554999990001') {
  await mem.registrarTurno(sessao, { mensagem: '[Cliente: João] preciso da bomba hidráulica da MF 4275', resposta: 'Temos a bomba 3774612M91, compatível com MF 4275.' });
  await mem.registrarTurno(sessao, { mensagem: 'vou ver com meu sócio', resposta: 'Combinado! Fico no aguardo.' });
}

// ── Comportamento na conversa ─────────────────────────────────────────────

test('continuação: menos de 12h desde a última mensagem segue com as mensagens cruas', async () => {
  const { mem, agora } = montar();
  await conversaReal(mem);
  agora.avancar(5 * H);
  const ctx = await mem.contextoConversa('wa:5554999990001', 'e o prazo?');
  assert.equal(ctx.modo, 'continuacao');
  assert.equal(ctx.historico.length, 4);
  assert.equal(ctx.historico[0].role, 'user');
  assert.deepEqual(Object.keys(ctx.historico[0]).sort(), ['content', 'role'], 'ts não vai para a API');
  assert.equal(ctx.bloco, '');
});

test('retomada (12h a 7 dias): bloco "Memória do cliente" com ficha + episódio e instrução de retomar', async () => {
  const { mem, agora, ia } = montar();
  await conversaReal(mem);
  agora.avancar(3 * H);
  const r = await mem.fecharEpisodiosOciosos();
  assert.deepEqual(r, { fechados: 1, lixo: 0, falhas: 0 });
  assert.equal(ia.episodios, 1);
  assert.match(ia.ultimaEntrada.mensagens[0].content, /bomba hidráulica/);

  agora.avancar(2 * DIA);
  const ctx = await mem.contextoConversa('wa:5554999990001', 'oi, bom dia');
  assert.equal(ctx.modo, 'retomada');
  assert.deepEqual(ctx.historico, [], 'conversa nova: sem mensagens cruas');
  assert.match(ctx.bloco, /MEMÓRIA DO CLIENTE/);
  assert.match(ctx.bloco, /Nome: João/);
  assert.match(ctx.bloco, /Local: Passo Fundo\/RS/);
  assert.match(ctx.bloco, /bomba hidráulica MF 4275/);
  assert.match(ctx.bloco, /Próximo passo: cliente confirma com o sócio/);
  assert.match(ctx.bloco, /SEMPRE retome o assunto/);
  assert.match(ctx.bloco, /não afirme/);
  assert.doesNotMatch(ctx.bloco, /R\$|1\.890/, 'preço nunca entra na memória');
  assert.ok(ctx.bloco.length <= 1500 * 4, 'teto de ~1.500 tokens');

  // O bloco vai FORA do prefixo cacheado do system prompt
  const blocos = montarBlocosSystem({ canal: 'whatsapp', horario: { texto: 'Agora: terça, 10h.' }, contexto: ctx, prefixo: 'PERSONA' });
  assert.equal(blocos.length, 3);
  assert.deepEqual(blocos[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.equal(blocos[0].text, 'PERSONA');
  assert.equal(blocos[2].cache_control, undefined);
  assert.equal(blocos[2].text, ctx.bloco);
  assert.match(blocos[1].text, /NOVA conversa com um cliente que já falou com você/);
  assert.doesNotMatch(blocos[1].text, /breve apresentação/);
});

test('retomada: mensagem genérica continua de onde parou; específica segue o assunto novo', async () => {
  const { mem, agora } = montar();
  await conversaReal(mem);
  agora.avancar(3 * H);
  await mem.fecharEpisodiosOciosos();
  agora.avancar(20 * H);

  for (const generica of ['oi', 'Bom dia!', 'e aí, tudo bem?', '[Cliente: João] boa tarde']) {
    const ctx = await mem.contextoConversa('wa:5554999990001', generica);
    assert.ok(ctx.bloco.includes(R.INSTRUCAO_GENERICA), `"${generica}" é genérica`);
    assert.ok(!ctx.bloco.includes(R.INSTRUCAO_ESPECIFICA));
  }
  const esp = await mem.contextoConversa('wa:5554999990001', 'tem sensor de plantadeira?');
  assert.ok(esp.bloco.includes(R.INSTRUCAO_ESPECIFICA));
  assert.ok(!esp.bloco.includes(R.INSTRUCAO_GENERICA));
  assert.match(esp.bloco, /só cite a conversa anterior se tiver ligação/);
  // anúncio já traz assunto, mesmo com "oi"
  assert.equal(R.ehGenerica('[Cliente chegou clicando no anúncio "Bombas"] oi'), false);
});

test('mais de 7 dias: só a ficha leve, sem episódios', async () => {
  const { mem, agora } = montar();
  await conversaReal(mem);
  agora.avancar(3 * H);
  await mem.fecharEpisodiosOciosos();
  agora.avancar(10 * DIA);
  const ctx = await mem.contextoConversa('wa:5554999990001', 'oi');
  assert.equal(ctx.modo, 'ficha');
  assert.match(ctx.bloco, /FICHA LEVE/);
  assert.match(ctx.bloco, /Nome: João/);
  assert.doesNotMatch(ctx.bloco, /Últimas conversas|INSTRUÇÕES DE RETOMADA/);
  // cliente desconhecido: nada
  const novo = await mem.contextoConversa('wa:5541000000000', 'oi');
  assert.deepEqual(novo, { modo: 'nova', historico: [], resumoParcial: '', bloco: '' });
});

test('retomada antes do job: sessão ainda não resumida entra crua, sem chamar o Haiku na resposta', async () => {
  const { mem, agora, ia } = montar();
  await conversaReal(mem);
  agora.avancar(13 * H);
  const ctx = await mem.contextoConversa('wa:5554999990001', 'oi');
  assert.equal(ctx.modo, 'retomada');
  assert.match(ctx.bloco, /Trecho final da conversa: .*vou ver com meu sócio/);
  assert.equal(ia.episodios, 0);
  // ao gravar o turno novo, o episódio anterior é fechado antes de sobrescrever
  await mem.registrarTurno('wa:5554999990001', { mensagem: 'oi', resposta: 'Oi João! Conseguiu ver com seu sócio?' });
  assert.equal(ia.episodios, 1);
  const depois = await mem.contextoConversa('wa:5554999990001', 'sim, pode mandar');
  assert.equal(depois.modo, 'continuacao');
  assert.equal(depois.historico.length, 2, 'memória de trabalho recomeçou na conversa nova');
});

test('compactação: acima de 30 mensagens as antigas viram resumo parcial e ficam 20 cruas', async () => {
  const { mem, agora, ia } = montar();
  for (let i = 1; i <= 15; i++) {
    await mem.registrarTurno('site:abcdefghijklmnop', { mensagem: `pergunta ${i}`, resposta: `resposta ${i}` });
    agora.avancar(60 * 1000);
  }
  let ctx = await mem.contextoConversa('site:abcdefghijklmnop', 'x');
  assert.equal(ctx.historico.length, 30);
  assert.equal(ia.parciais, 0);

  await mem.registrarTurno('site:abcdefghijklmnop', { mensagem: 'pergunta 16', resposta: 'resposta 16' });
  ctx = await mem.contextoConversa('site:abcdefghijklmnop', 'x');
  assert.equal(ia.parciais, 1);
  assert.equal(ctx.historico.length, 20);
  assert.equal(ctx.historico[0].role, 'user');
  assert.equal(ctx.historico[0].content, 'pergunta 7');
  assert.equal(ctx.resumoParcial, 'resumo de 12 mensagens ()', 'sem valor em reais');
  const blocos = montarBlocosSystem({ canal: 'site', horario: { texto: '' }, contexto: ctx, prefixo: 'P' });
  assert.match(blocos[1].text, /Resumo do início desta conversa .*resumo de 12 mensagens/);

  // Haiku fora: mantém a janela de 30 e tenta de novo no próximo turno
  ia.falharParcial = true;
  for (let i = 17; i <= 23; i++) await mem.registrarTurno('site:abcdefghijklmnop', { mensagem: `pergunta ${i}`, resposta: `resposta ${i}` });
  ctx = await mem.contextoConversa('site:abcdefghijklmnop', 'x');
  assert.equal(ctx.historico.length, 30);
  assert.equal(ctx.historico.at(-2).content, 'pergunta 23');
});

test('escritas da mesma sessão em sequência não se sobrescrevem', async () => {
  const { mem } = montar();
  await Promise.all([1, 2, 3].map((i) => mem.registrarTurno('wa:5541999990009', { mensagem: `m${i}`, resposta: `r${i}` })));
  const ctx = await mem.contextoConversa('wa:5541999990009', 'x');
  assert.deepEqual(ctx.historico.filter((m) => m.role === 'user').map((m) => m.content), ['m1', 'm2', 'm3']);
});

// ── Anti-lixo ─────────────────────────────────────────────────────────────

test('anti-lixo: só "oi", resposta vazia/contingência e deploy-check não viram episódio', async () => {
  const u = (c) => ({ role: 'user', content: c });
  const a = (c) => ({ role: 'assistant', content: c });
  assert.equal(R.conversaTemTrocaReal('wa:1', [u('oi'), a('Olá! Aqui é a Carol.')]), false);
  assert.equal(R.conversaTemTrocaReal('wa:1', [u('bom dia, tudo bem?'), a('Bom dia!')]), false);
  assert.equal(R.conversaTemTrocaReal('wa:1', [u('tem bomba?'), a('')]), false);
  assert.equal(R.conversaTemTrocaReal('wa:1', [u('tem bomba?'), a('Desculpe, não consegui processar sua mensagem agora.')]), false);
  assert.equal(R.conversaTemTrocaReal('site:deploy-check-123', [u('tem bomba?'), a('Tenho sim.')]), false);
  assert.equal(R.conversaTemTrocaReal('wa:1', [u('oi'), a('Olá!'), u('tem bomba da MF 275?'), a('Tenho sim.')]), true);

  const { mem, agora, ia } = montar();
  await mem.registrarTurno('wa:5541000000001', { mensagem: 'oi', resposta: 'Olá! Aqui é a Carol.' });
  await mem.registrarTurno('site:deploy-check-abcdefgh', { mensagem: 'teste de deploy', resposta: 'ok' });
  agora.avancar(3 * H);
  const r = await mem.fecharEpisodiosOciosos();
  assert.deepEqual(r, { fechados: 0, lixo: 2, falhas: 0 });
  assert.equal(ia.episodios, 0, 'não paga o Haiku por lixo');
  assert.deepEqual(await mem.fecharEpisodiosOciosos(), { fechados: 0, lixo: 0, falhas: 0 }, 'idempotente: não reprocessa');
  agora.avancar(DIA);
  assert.equal((await mem.contextoConversa('wa:5541000000001', 'oi')).modo, 'nova');
});

test('fechamento: Haiku sem JSON conta falha e libera a sessão para a próxima rodada', async () => {
  let ok = false;
  const { mem, agora } = montar({ ia: iaFalsa(() => (ok ? JSON.stringify(EPISODIO) : 'desculpe, não sei')) });
  await conversaReal(mem);
  agora.avancar(3 * H);
  assert.deepEqual(await mem.fecharEpisodiosOciosos(), { fechados: 0, lixo: 0, falhas: 1 });
  ok = true;
  assert.deepEqual(await mem.fecharEpisodiosOciosos(), { fechados: 1, lixo: 0, falhas: 0 });
});

// ── Ficha ─────────────────────────────────────────────────────────────────

test('ficha: o fato mais recente vence, sem preço nem estoque, listas limitadas', () => {
  const ep = R.interpretarEpisodio(JSON.stringify({ ...EPISODIO, preco: 'R$ 10', fatos_ficha: { ...EPISODIO.fatos_ficha, preco_combinado: 'R$ 1.890', pecas: [{ item: 'bomba X', situacao: 'comprada' }, { item: 'estoque de 3 unidades' }] } }));
  assert.doesNotMatch(ep.episodio.resumo, /R\$/);
  assert.equal(ep.episodio.preco, undefined);
  assert.deepEqual(ep.fatos.preferencias, ['canal preferido: áudio'], 'só categorias e valores fixos; texto livre (com preço) é descartado');
  assert.deepEqual(ep.fatos.pecas, [{ valor: 'bomba X', situacao: 'comprada' }]);

  const d1 = '2026-10-01T10:00:00.000Z';
  const d2 = '2026-10-10T10:00:00.000Z';
  let f = R.mesclarFicha(null, ep.fatos, d2);
  assert.equal(f.preco_combinado, undefined);
  assert.deepEqual(f.nome, { valor: 'João', em: d2 });
  // fato mais antigo não sobrescreve o mais novo
  f = R.mesclarFicha(f, { nome: 'Joãozinho', cidade: 'Erechim', tipo: 'revenda', pecas: [{ valor: 'bomba X', situacao: 'consultada' }] }, d1);
  assert.equal(f.nome.valor, 'João');
  assert.equal(f.cidade.valor, 'Passo Fundo');
  assert.equal(f.tipo.valor, 'produtor');
  assert.equal(f.pecas.find((p) => p.valor === 'bomba X').situacao, 'comprada', 'comprada não volta a consultada');
  // mais novo vence; "desconhecido" não apaga o tipo
  const d3 = '2026-10-15T10:00:00.000Z';
  f = R.mesclarFicha(f, { cidade: 'Carazinho', tipo: 'desconhecido', maquinas: ['mf 4275', 'Valtra BH180'] }, d3);
  assert.deepEqual(f.cidade, { valor: 'Carazinho', em: d3 });
  assert.equal(f.tipo.valor, 'produtor');
  assert.equal(f.maquinas.length, 2, '"MF 4275" e "mf 4275" são a mesma máquina');
  assert.equal(f.maquinas[0].em, d3);
  // preço/estoque nunca entram, mesmo passados direto
  f = R.mesclarFicha(f, { preferencias: ['paga R$ 500 à vista', 'sem estoque aceita encomenda', 'retira na loja', 'pagamento preferido: Pix'] }, d3);
  assert.deepEqual(f.preferencias.map((p) => p.valor).sort(), ['canal preferido: áudio', 'pagamento preferido: Pix'], 'texto livre fica de fora');
  // uma por categoria: a mais recente vence
  f = R.mesclarFicha(f, { preferencias: ['canal preferido: ligação'] }, '2026-10-16T10:00:00.000Z');
  assert.deepEqual(f.preferencias.map((p) => p.valor).sort(), ['canal preferido: ligação', 'pagamento preferido: Pix']);
  // listas cortadas em 20
  const muitas = Array.from({ length: 30 }, (_, i) => `peça ${i}`);
  f = R.mesclarFicha(f, { pecas: muitas.map((valor) => ({ valor })) }, d3);
  assert.equal(f.pecas.length, 20);
  assert.ok(JSON.stringify(f).length < 6000);
});

test('bloco de memória respeita o teto tirando episódios antigos e nunca corta as instruções', () => {
  const longo = 'x'.repeat(2500);
  const eps = [1, 2, 3].map((i) => ({ fim: `2026-10-1${i}T10:00:00Z`, dados: { assunto: `assunto ${i}`, resumo: longo } }));
  const b = R.montarBlocoMemoria({ modo: 'retomada', ficha: null, episodios: eps, mensagemAtual: 'oi', tetoTokens: 1500 });
  assert.ok(b.length <= 6000 + 10);
  assert.match(b, /assunto 1/);
  assert.doesNotMatch(b, /assunto 3/);
  assert.ok(b.endsWith(R.INSTRUCAO_GENERICA));
});

// ── Limpeza ───────────────────────────────────────────────────────────────

test('limpeza: cada regra (trabalho expirada, pendente fechada antes, episódio 7d, ficha 180d, teste, JSONL 90d)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carol-limpeza-'));
  for (const nome of ['registro-2026-07-01.jsonl', 'registro-2026-07-21.jsonl', 'registro-2026-07-23.jsonl', 'registro-2026-10-19.jsonl', 'agenda.json']) fs.writeFileSync(path.join(dir, nome), '');
  const { mem, agora, ia, local } = montar({ dataDir: dir });

  // A: conversa real, fechada, depois expira
  await conversaReal(mem, 'wa:5541000000001');
  agora.avancar(3 * H);
  await mem.fecharEpisodiosOciosos();
  // B: conversa real que o job nunca fechou (fica pendente até expirar)
  await conversaReal(mem, 'wa:5541000000002');
  // C: sessão de teste
  await mem.registrarTurno('site:deploy-check-abcdefgh', { mensagem: 'teste', resposta: 'ok' });
  const episodiosAntes = ia.episodios;

  agora.avancar(25 * H);
  const r1 = await mem.limpar();
  assert.equal(ia.episodios, episodiosAntes + 1, 'B foi fechada antes de apagar');
  assert.equal(r1.trabalho, 2, 'A e B saíram da memória de trabalho');
  assert.equal(r1.teste, 1);
  assert.equal(r1.episodios, 0);
  assert.equal(r1.fichas, 0);
  assert.match(r1.resumo, /2 conversa\(s\) expirada\(s\)/);
  assert.equal(await local.obterSessao('wa:5541000000001'), null);
  assert.equal((await local.listarEpisodios('wa:5541000000002', {})).length, 1);

  // JSONL: 2026-10-21 - 90 dias = 2026-07-23 (fica); mais antigos saem; outros arquivos não
  assert.equal(r1.registros, 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['agenda.json', 'registro-2026-07-23.jsonl', 'registro-2026-10-19.jsonl']);

  // Episódios > 7 dias saem; a ficha fica
  agora.avancar(7 * DIA);
  const r2 = await mem.limpar();
  assert.equal(r2.episodios, 2);
  assert.equal(r2.fichas, 0);
  assert.ok(await local.obterFicha('wa:5541000000001'));

  // Ficha > 180 dias sem contato sai
  agora.avancar(175 * DIA);
  const r3 = await mem.limpar();
  assert.equal(r3.fichas, 2);
  assert.equal(await local.obterFicha('wa:5541000000001'), null);
});

test('limparRegistroAntigo: diretório inexistente não quebra', () => {
  assert.deepEqual(limparRegistroAntigo('/caminho/que/nao/existe', 90), []);
});

// ── Fallback ──────────────────────────────────────────────────────────────

test('Postgres fora: responde pelo adaptador local, reporta anomalia e devolve as sessões quando volta', async () => {
  const agora = relogio(Date.parse('2026-10-20T13:00:00Z'));
  const banco = criarAdaptadorLocal({ agora, listar: () => [] });
  let fora = true;
  let iniciou = 0;
  const primario = new Proxy(banco, {
    get(alvo, prop) {
      if (prop === 'iniciar') return async () => { if (fora) throw new Error('ECONNREFUSED 127.0.0.1:5432'); iniciou++; };
      const v = alvo[prop];
      if (typeof v !== 'function') return v;
      return async (...a) => {
        if (fora) throw new Error('connection terminated');
        return v.apply(alvo, a);
      };
    },
  });
  const anomalias = [];
  const ia = iaFalsa();
  const mem = criarMemoria({ primario, local: criarAdaptadorLocal({ agora, listar: () => [] }), ia, agora, reportarAnomalia: async (ev) => anomalias.push(ev) });

  const estado = await mem.iniciar();
  assert.equal(estado.degradado, true);
  await conversaReal(mem);
  const ctx = await mem.contextoConversa('wa:5554999990001', 'e aí?');
  assert.equal(ctx.modo, 'continuacao', 'continua lembrando pelo adaptador local');
  assert.equal(ctx.historico.length, 4);
  await new Promise((r) => setImmediate(r));
  assert.equal(anomalias.length, 1, 'uma anomalia por degrade');
  assert.equal(anomalias[0].tipo, 'memoria_degradada');

  // Banco volta: depois da pausa tenta de novo, migra e devolve a sessão
  fora = false;
  agora.avancar(2 * 60 * 1000);
  const ctx2 = await mem.contextoConversa('wa:5554999990001', 'e aí?');
  assert.equal(iniciou, 1);
  assert.equal(mem.estado().degradado, false);
  assert.equal(ctx2.modo, 'continuacao');
  assert.equal((await banco.obterSessao('wa:5554999990001')).mensagens.length, 4, 'sessão do modo local devolvida ao banco');
  await new Promise((r) => setImmediate(r));
  assert.equal(anomalias.length, 2);
  assert.equal(anomalias[1].recuperado, true);
  assert.match(anomalias[1].titulo, /^Resolvido/);

  // Erro inesperado no meio de tudo: nunca lança para o atendimento
  const quebrada = criarMemoria({ primario: null, local: { obterSessao: async () => { throw new Error('boom'); } }, ia, agora, reportarAnomalia: async () => {} });
  assert.deepEqual(await quebrada.contextoConversa('wa:1', 'oi'), { modo: 'nova', historico: [], resumoParcial: '', bloco: '' });
});

test('adaptador local reidrata do JSONL (7 dias): cadeia ativa vira memória, anteriores viram episódio cru', async () => {
  const agora = relogio(Date.parse('2026-10-20T13:00:00Z'));
  const s = 'wa:5541999990005';
  const entradas = [
    { ts: '2026-10-15T10:00:00.000Z', canal: 'whatsapp', sessao: s, mensagem: 'tem bomba da MF 275?', resposta: 'Tenho, custa R$ 900,00.' },
    { ts: '2026-10-15T10:05:00.000Z', canal: 'whatsapp', sessao: s, mensagem: 'vou pensar', resposta: 'Fico no aguardo.' },
    { ts: '2026-10-20T11:00:00.000Z', canal: 'whatsapp', sessao: s, mensagem: 'voltei', resposta: 'Que bom!' },
    { ts: '2026-10-20T11:01:00.000Z', canal: 'sistema', sessao: 'sistema:memoria', tipo: 'sistema', mensagem: 'x', resposta: 'y' },
  ];
  const local = criarAdaptadorLocal({ agora, listar: () => entradas });
  const sessao = await local.obterSessao(s);
  assert.equal(sessao.mensagens.length, 2);
  assert.equal(sessao.mensagens[0].content, 'voltei');
  const eps = await local.listarEpisodios(s, {});
  assert.equal(eps.length, 1);
  assert.match(eps[0].dados.resumo, /vou pensar/);
  assert.doesNotMatch(eps[0].dados.resumo, /900/);

  // 14h depois: retomada com o episódio cru (sem banco, sem Haiku)
  agora.avancar(14 * H);
  const mem = criarMemoria({ primario: null, local, ia: iaFalsa(), agora, reportarAnomalia: async () => {} });
  const ctx = await mem.contextoConversa(s, 'oi');
  assert.equal(ctx.modo, 'retomada');
  assert.match(ctx.bloco, /Trecho final da conversa/);
});

// ── Relatório de 24h ──────────────────────────────────────────────────────

test('relatório: usa os episódios fechados quando cobrem a conversa e conta retomadas', () => {
  const entradas = [
    { ts: '2026-10-20T09:00:00.000Z', canal: 'whatsapp', sessao: 'wa:1', mensagem: 'bomba?', resposta: 'tenho', memoria: 'retomada' },
    { ts: '2026-10-20T09:05:00.000Z', canal: 'whatsapp', sessao: 'wa:1', mensagem: 'ok', resposta: 'ok' },
    { ts: '2026-10-20T10:00:00.000Z', canal: 'whatsapp', sessao: 'wa:2', mensagem: 'sensor?', resposta: 'tenho' },
    { ts: '2026-10-20T11:00:00.000Z', canal: 'site', sessao: 'site:x', mensagem: 'dedo?', resposta: 'tenho', memoria: 'ficha' },
  ];
  const conversas = agruparConversas(entradas);
  const episodios = [
    { sessao: 'wa:1', fim: '2026-10-20T09:05:00.000Z', dados: { assunto: 'bomba MF', resumo: 'Quer a bomba.', proximo_passo: 'mandar orçamento', status: 'em_aberto', nome: 'João', tipo: 'revenda' } },
    { sessao: 'wa:2', fim: '2026-10-20T08:00:00.000Z', dados: { assunto: 'antigo', status: 'fechou' } }, // não cobre a conversa de 10h
  ];
  const { cobertas, pendencias, faltando } = resumoDeEpisodios(conversas, episodios);
  assert.equal(cobertas.length, 1);
  assert.equal(cobertas[0].assunto, 'bomba MF');
  assert.equal(cobertas[0].perfil, 'revenda');
  assert.deepEqual(pendencias, ['João: mandar orçamento']);
  assert.deepEqual(faltando.map((c) => c.sessao), ['wa:2', 'site:x']);
  assert.equal(contarRetomadas(entradas), 1, '"ficha" não é retomada');

  const resumo = combinarResumos({ cobertas, pendencias, resumoIA: { pendencias: [], conversas: faltando.map((c) => ({ ...c, mensagens: c.mensagens.length, assunto: 'x' })), textoLivre: '' }, retomadas: 1 });
  assert.deepEqual(resumo.conversas.map((c) => c.numero), [1, 2, 3]);
  assert.equal(resumo.totais.retomadas, 1);
  assert.equal(resumo.totais.deEpisodios, 1);
  assert.match(textoEmailDai(resumo, 'ontem até hoje'), /Retomadas: 1 cliente voltou e a Carol lembrou da conversa anterior/);
});
