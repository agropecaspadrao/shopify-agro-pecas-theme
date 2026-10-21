// Integração com Postgres de verdade. Só roda com CAROL_TEST_DATABASE_URL, ex.:
//   CAROL_TEST_DATABASE_URL=postgresql://localhost:5433/carol_memoria_test npm test
// O banco é zerado (DROP das tabelas carol_*) no início.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario, relogio } from './_setup.js';

dataDirTemporario();
delete process.env.DATABASE_URL;
const URL_TESTE = process.env.CAROL_TEST_DATABASE_URL;
const pular = URL_TESTE ? false : 'defina CAROL_TEST_DATABASE_URL para rodar';

const { criarPool, criarAdaptadorPostgres } = await import('../src/memoria/postgres.js');
const { criarMemoria } = await import('../src/memoria/index.js');
const { criarAdaptadorLocal } = await import('../src/memoria/local.js');

const H = 3600 * 1000;
const DIA = 24 * H;
let pool;

before(async () => {
  if (pular) return;
  pool = await criarPool(URL_TESTE);
  await pool.query('DROP TABLE IF EXISTS carol_memoria_trabalho, carol_episodios, carol_fichas');
});
after(async () => {
  await pool?.end();
});

const EPISODIO = JSON.stringify({
  assunto: 'bomba MF 4275',
  pecas: ['3774612M91'],
  status: 'em_aberto',
  resumo: 'Quer a bomba; vai ver com o sócio.',
  proximo_passo: 'cliente volta depois de falar com o sócio',
  fatos_ficha: { nome: 'João', uf: 'RS', tipo: 'produtor', maquinas: ['MF 4275'], pecas: [{ item: '3774612M91', situacao: 'consultada' }] },
});

test('Postgres: migrações idempotentes, índices criados', { skip: pular }, async () => {
  const repo = criarAdaptadorPostgres({ pool });
  await repo.iniciar();
  await Promise.all([repo.iniciar(), repo.iniciar()]); // duas instâncias subindo juntas
  const { rows } = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename LIKE 'carol_%' ORDER BY indexname");
  const nomes = rows.map((r) => r.indexname);
  for (const i of ['carol_mt_expira_idx', 'carol_mt_pendente_idx', 'carol_ep_sessao_fim_idx', 'carol_ep_fim_idx', 'carol_fichas_contato_idx']) assert.ok(nomes.includes(i), i);
});

test('Postgres: ciclo completo (turnos, episódio, retomada, limpeza) pela fachada', { skip: pular }, async () => {
  const agora = relogio(Date.parse('2026-10-20T13:00:00Z'));
  const repo = criarAdaptadorPostgres({ pool, agora });
  let chamadas = 0;
  const ia = { gerarEpisodio: async () => (chamadas++, EPISODIO), resumirParcial: async () => 'resumo' };
  const mem = criarMemoria({ primario: repo, local: criarAdaptadorLocal({ agora, listar: () => [] }), ia, agora, reportarAnomalia: async () => {} });
  assert.equal((await mem.iniciar()).degradado, false);

  const s = 'wa:5554999990001';
  await mem.registrarTurno(s, { mensagem: 'preciso da bomba da MF 4275', resposta: 'Temos a 3774612M91.' });
  await mem.registrarTurno(s, { mensagem: 'vou ver com o sócio', resposta: 'Combinado.' });
  assert.equal((await mem.contextoConversa(s, 'x')).historico.length, 4);

  agora.avancar(3 * H);
  assert.deepEqual(await mem.fecharEpisodiosOciosos(), { fechados: 1, lixo: 0, falhas: 0 });
  assert.deepEqual(await mem.fecharEpisodiosOciosos(), { fechados: 0, lixo: 0, falhas: 0 }, 'idempotente');

  agora.avancar(DIA);
  const ctx = await mem.contextoConversa(s, 'oi');
  assert.equal(ctx.modo, 'retomada');
  assert.match(ctx.bloco, /Nome: João/);
  assert.match(ctx.bloco, /bomba MF 4275/);
  const eps = await mem.episodiosNoPeriodo(agora() - 2 * DIA, agora());
  assert.equal(eps.length, 1);
  assert.equal(eps[0].dados.nome, 'João');

  // Limpeza: memória expirada sai; após 7 dias o episódio; após 180 a ficha
  const r1 = await mem.limpar();
  assert.equal(r1.trabalho, 1);
  agora.avancar(7 * DIA);
  assert.equal((await mem.limpar()).episodios, 1);
  agora.avancar(180 * DIA);
  assert.equal((await mem.limpar()).fichas, 1);
  assert.equal(chamadas, 1);
});

test('Postgres: duas instâncias nunca pegam a mesma sessão ociosa (SKIP LOCKED)', { skip: pular }, async () => {
  const agora = relogio(Date.parse('2026-11-01T13:00:00Z'));
  const a = criarAdaptadorPostgres({ pool, agora });
  const b = criarAdaptadorPostgres({ pool, agora });
  for (let i = 0; i < 10; i++) {
    await a.salvarSessao({ sessao: `wa:55419000000${String(i).padStart(2, '0')}`, mensagens: [], criadoEm: agora() - 5 * H, atualizadoEm: agora() - 3 * H });
  }
  const [la, lb] = await Promise.all([a.reivindicarOciosas({ ate: agora() - 2 * H, limite: 6 }), b.reivindicarOciosas({ ate: agora() - 2 * H, limite: 6 })]);
  const todas = [...la, ...lb].map((s) => s.sessao);
  assert.equal(new Set(todas).size, todas.length, 'sem sessão repetida');
  assert.equal(todas.length, 10);
  assert.equal((await a.reivindicarOciosas({ ate: agora() - 2 * H })).length, 0, 'marcadas como em processamento');
  // mensagem nova durante o processamento: continua pendente
  const s = la[0];
  await a.salvarSessao({ ...s, atualizadoEm: agora() });
  await a.concluirEpisodio({ sessao: s.sessao, atualizadoEm: s.atualizadoEm, episodio: null, mesclarFicha: null });
  assert.equal((await a.obterSessao(s.sessao)).pendente, true);
});

test('Postgres inacessível: fachada cai para o local sem travar (roda sempre: localhost:1 recusa na hora)', async () => {
  const agora = relogio(Date.parse('2026-10-20T13:00:00Z'));
  const ruim = await criarPool('postgresql://localhost:1/nao_existe');
  const anomalias = [];
  const mem = criarMemoria({ primario: criarAdaptadorPostgres({ pool: ruim, agora }), local: criarAdaptadorLocal({ agora, listar: () => [] }), ia: { gerarEpisodio: async () => EPISODIO, resumirParcial: async () => '' }, agora, reportarAnomalia: async (e) => anomalias.push(e) });
  const t0 = Date.now();
  await mem.registrarTurno('wa:1', { mensagem: 'tem bomba?', resposta: 'tenho' });
  const ctx = await mem.contextoConversa('wa:1', 'e aí');
  assert.equal(ctx.modo, 'continuacao');
  assert.ok(Date.now() - t0 < 5000, 'timeouts curtos');
  await new Promise((r) => setImmediate(r));
  assert.equal(anomalias[0]?.tipo, 'memoria_degradada');
  await ruim.end();
});
