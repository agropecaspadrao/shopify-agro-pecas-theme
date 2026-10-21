// Adaptador Postgres da memória (DATABASE_URL). Três tabelas:
//   carol_memoria_trabalho  mensagens cruas da conversa ativa, 1 linha por sessão, expira 24h após a última
//   carol_episodios         resumo estruturado de cada conversa fechada (7 dias)
//   carol_fichas            1 linha por cliente, fatos com data (180 dias sem contato)
//
// Escala (~100 mil clientes): toda leitura do atendimento é por chave primária
// ou pelo índice (sessao, fim); o custo por mensagem não cresce com a idade do
// cliente porque a memória de trabalho é compactada (máx. 30 mensagens) e só
// os 3 episódios mais recentes são lidos. Limpeza usa índices por expira_em,
// fim e ultimo_contato.
//
// Pool pequeno (máx. 5) e timeouts curtos: o banco nunca pode travar o
// atendimento; quem chama (index.js) cai para o adaptador local se der erro.

import { MEMORIA, TEMPO } from './config.js';

export const MIGRACOES = [
  `CREATE TABLE IF NOT EXISTS carol_memoria_trabalho (
    sessao            text PRIMARY KEY,
    mensagens         jsonb NOT NULL DEFAULT '[]'::jsonb,
    resumo_parcial    text NOT NULL DEFAULT '',
    criado_em         timestamptz NOT NULL,
    atualizado_em     timestamptz NOT NULL,
    expira_em         timestamptz NOT NULL,
    pendente_episodio boolean NOT NULL DEFAULT true,
    processando_ate   timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS carol_mt_expira_idx ON carol_memoria_trabalho (expira_em)`,
  `CREATE INDEX IF NOT EXISTS carol_mt_pendente_idx ON carol_memoria_trabalho (atualizado_em) WHERE pendente_episodio`,
  `CREATE TABLE IF NOT EXISTS carol_episodios (
    id            text PRIMARY KEY,
    sessao        text NOT NULL,
    inicio        timestamptz NOT NULL,
    fim           timestamptz NOT NULL,
    dados         jsonb NOT NULL,
    atualizado_em timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS carol_ep_sessao_fim_idx ON carol_episodios (sessao, fim DESC)`,
  `CREATE INDEX IF NOT EXISTS carol_ep_fim_idx ON carol_episodios (fim)`,
  `CREATE TABLE IF NOT EXISTS carol_fichas (
    sessao         text PRIMARY KEY,
    dados          jsonb NOT NULL,
    ultimo_contato timestamptz NOT NULL,
    atualizado_em  timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS carol_fichas_contato_idx ON carol_fichas (ultimo_contato)`,
];

// Trava de migração entre instâncias (número arbitrário e fixo)
const TRAVA_MIGRACAO = 4271987;

/** Pool do node-postgres com os limites da Carol. Import dinâmico: sem DATABASE_URL, `pg` nem carrega. */
export async function criarPool(url = process.env.DATABASE_URL) {
  const { default: pg } = await import('pg');
  const ssl = ['1', 'true', 'sim'].includes(String(process.env.DATABASE_SSL || '').toLowerCase()) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    statement_timeout: 3000,
    query_timeout: 4000,
    ssl,
    application_name: 'carol',
  });
  // Erro em conexão ociosa não pode derrubar o processo
  pool.on('error', (e) => console.warn('[memoria] erro em conexão ociosa do Postgres:', e.message));
  return pool;
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);
const ms = (v) => (v ? new Date(v).getTime() : 0);

function linhaParaSessao(r) {
  return {
    sessao: r.sessao,
    mensagens: Array.isArray(r.mensagens) ? r.mensagens : [],
    resumoParcial: r.resumo_parcial || '',
    criadoEm: ms(r.criado_em),
    atualizadoEm: ms(r.atualizado_em),
    pendente: Boolean(r.pendente_episodio),
    processandoAte: ms(r.processando_ate),
  };
}

function linhaParaEpisodio(r) {
  return { id: r.id, sessao: r.sessao, inicio: iso(r.inicio), fim: iso(r.fim), dados: r.dados || {} };
}

/**
 * @param {{pool:{query:Function, connect:Function, end?:Function}, agora?:()=>number}} deps
 */
export function criarAdaptadorPostgres({ pool, agora = Date.now }) {
  async function transacao(fn) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  return {
    nome: 'postgres',

    /** Migrações idempotentes; com trava para duas instâncias subindo juntas. */
    async iniciar() {
      await transacao(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock($1)', [TRAVA_MIGRACAO]);
        for (const sql of MIGRACOES) await c.query(sql);
      });
    },

    /** `incluirExpirada`: devolve também a sessão vencida que ainda não virou episódio. */
    async obterSessao(sessao, { incluirExpirada = false } = {}) {
      const { rows } = await pool.query(
        `SELECT * FROM carol_memoria_trabalho WHERE sessao = $1 AND (expira_em > $2${incluirExpirada ? ' OR pendente_episodio' : ''})`,
        [sessao, new Date(agora())]
      );
      return rows[0] ? linhaParaSessao(rows[0]) : null;
    },

    async salvarSessao({ sessao, mensagens, resumoParcial = '', criadoEm, atualizadoEm }) {
      await pool.query(
        `INSERT INTO carol_memoria_trabalho (sessao, mensagens, resumo_parcial, criado_em, atualizado_em, expira_em, pendente_episodio)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, true)
         ON CONFLICT (sessao) DO UPDATE SET mensagens = EXCLUDED.mensagens, resumo_parcial = EXCLUDED.resumo_parcial,
           criado_em = EXCLUDED.criado_em, atualizado_em = EXCLUDED.atualizado_em, expira_em = EXCLUDED.expira_em, pendente_episodio = true`,
        [sessao, JSON.stringify(mensagens), resumoParcial, new Date(criadoEm), new Date(atualizadoEm), new Date(atualizadoEm + MEMORIA.trabalhoTtlMs)]
      );
    },

    /**
     * Pega conversas ociosas para fechar. SKIP LOCKED + marca processando_ate:
     * duas instâncias nunca pegam a mesma sessão, e uma instância que morrer
     * no meio libera a sessão sozinha quando a marca vence.
     */
    async reivindicarOciosas({ ate, limite = 20 }) {
      const t = new Date(agora());
      const { rows } = await pool.query(
        `UPDATE carol_memoria_trabalho SET processando_ate = $3
         WHERE sessao IN (
           SELECT sessao FROM carol_memoria_trabalho
           WHERE pendente_episodio AND atualizado_em < $1 AND (processando_ate IS NULL OR processando_ate < $4)
           ORDER BY atualizado_em LIMIT $2
           FOR UPDATE SKIP LOCKED)
         RETURNING *`,
        [new Date(ate), limite, new Date(agora() + MEMORIA.travaFechamentoMs), t]
      );
      return rows.map(linhaParaSessao);
    },

    /** Grava episódio + ficha e tira a pendência, tudo numa transação. */
    async concluirEpisodio({ sessao, atualizadoEm, episodio, mesclarFicha, ultimoContato }) {
      await transacao(async (c) => {
        if (episodio) {
          await c.query(
            `INSERT INTO carol_episodios (id, sessao, inicio, fim, dados, atualizado_em) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
             ON CONFLICT (id) DO UPDATE SET fim = EXCLUDED.fim, dados = EXCLUDED.dados, atualizado_em = EXCLUDED.atualizado_em`,
            [episodio.id, sessao, new Date(episodio.inicio), new Date(episodio.fim), JSON.stringify(episodio.dados), new Date(agora())]
          );
        }
        if (mesclarFicha) {
          const { rows } = await c.query('SELECT dados FROM carol_fichas WHERE sessao = $1 FOR UPDATE', [sessao]);
          const dados = mesclarFicha(rows[0]?.dados || null);
          await c.query(
            `INSERT INTO carol_fichas (sessao, dados, ultimo_contato, atualizado_em) VALUES ($1, $2::jsonb, $3, $4)
             ON CONFLICT (sessao) DO UPDATE SET dados = EXCLUDED.dados,
               ultimo_contato = GREATEST(carol_fichas.ultimo_contato, EXCLUDED.ultimo_contato), atualizado_em = EXCLUDED.atualizado_em`,
            [sessao, JSON.stringify(dados), new Date(ultimoContato), new Date(agora())]
          );
        }
        // Se chegou mensagem nova enquanto o Haiku resumia, continua pendente
        await c.query(
          `UPDATE carol_memoria_trabalho SET processando_ate = NULL, pendente_episodio = (atualizado_em <> $2) WHERE sessao = $1`,
          [sessao, new Date(atualizadoEm)]
        );
      });
    },

    async liberar(sessao) {
      await pool.query('UPDATE carol_memoria_trabalho SET processando_ate = NULL WHERE sessao = $1', [sessao]);
    },

    async obterFicha(sessao) {
      const { rows } = await pool.query('SELECT sessao, dados, ultimo_contato FROM carol_fichas WHERE sessao = $1', [sessao]);
      return rows[0] ? { sessao, dados: rows[0].dados, ultimoContato: iso(rows[0].ultimo_contato) } : null;
    },

    async listarEpisodios(sessao, { desde, limite = MEMORIA.episodiosNoContexto } = {}) {
      const { rows } = await pool.query(
        'SELECT * FROM carol_episodios WHERE sessao = $1 AND fim >= $2 ORDER BY fim DESC LIMIT $3',
        [sessao, new Date(desde || 0), limite]
      );
      return rows.map(linhaParaEpisodio);
    },

    async episodiosNoPeriodo(inicio, fim) {
      const { rows } = await pool.query('SELECT * FROM carol_episodios WHERE fim >= $1 AND fim < $2 ORDER BY fim LIMIT 2000', [new Date(inicio), new Date(fim)]);
      return rows.map(linhaParaEpisodio);
    },

    async limpar({ agora: t = agora() } = {}) {
      const corteEpisodio = new Date(t - MEMORIA.contextoDias * TEMPO.DIA);
      const r = { trabalho: 0, episodios: 0, fichas: 0, teste: 0 };
      // expirada: apaga se o episódio já foi fechado; pendente há mais de 7 dias apaga de qualquer jeito
      r.trabalho = (await pool.query('DELETE FROM carol_memoria_trabalho WHERE expira_em <= $1 AND (NOT pendente_episodio OR atualizado_em < $2)', [new Date(t), corteEpisodio])).rowCount;
      r.episodios = (await pool.query('DELETE FROM carol_episodios WHERE fim < $1', [corteEpisodio])).rowCount;
      r.fichas = (await pool.query('DELETE FROM carol_fichas WHERE ultimo_contato < $1', [new Date(t - MEMORIA.fichaDias * TEMPO.DIA)])).rowCount;
      for (const tabela of ['carol_memoria_trabalho', 'carol_episodios', 'carol_fichas']) {
        r.teste += (await pool.query(`DELETE FROM ${tabela} WHERE sessao LIKE '%deploy-check%'`)).rowCount;
      }
      return r;
    },

    /**
     * Devolve ao banco episódios e fichas criados no modo local durante uma
     * queda. Episódio já existente não é sobrescrito; ficha é juntada com a do
     * banco por `juntar(atual, local)` (o fato mais recente vence).
     */
    async importarMemoria({ episodios = [], fichas = [], juntar }) {
      await transacao(async (c) => {
        for (const e of episodios) {
          await c.query(
            `INSERT INTO carol_episodios (id, sessao, inicio, fim, dados, atualizado_em) VALUES ($1, $2, $3, $4, $5::jsonb, $6) ON CONFLICT (id) DO NOTHING`,
            [e.id, e.sessao, new Date(e.inicio), new Date(e.fim), JSON.stringify(e.dados), new Date(agora())]
          );
        }
        for (const f of fichas) {
          const { rows } = await c.query('SELECT dados FROM carol_fichas WHERE sessao = $1 FOR UPDATE', [f.sessao]);
          const dados = rows[0] ? juntar(rows[0].dados, f.dados) : f.dados;
          await c.query(
            `INSERT INTO carol_fichas (sessao, dados, ultimo_contato, atualizado_em) VALUES ($1, $2::jsonb, $3, $4)
             ON CONFLICT (sessao) DO UPDATE SET dados = EXCLUDED.dados,
               ultimo_contato = GREATEST(carol_fichas.ultimo_contato, EXCLUDED.ultimo_contato), atualizado_em = EXCLUDED.atualizado_em`,
            [f.sessao, JSON.stringify(dados), new Date(f.ultimoContato), new Date(agora())]
          );
        }
      });
    },

    /** LGPD: apaga memória de trabalho, episódios e ficha do cliente. */
    async apagar(sessao) {
      return transacao(async (c) => ({
        trabalho: (await c.query('DELETE FROM carol_memoria_trabalho WHERE sessao = $1', [sessao])).rowCount,
        episodios: (await c.query('DELETE FROM carol_episodios WHERE sessao = $1', [sessao])).rowCount,
        fichas: (await c.query('DELETE FROM carol_fichas WHERE sessao = $1', [sessao])).rowCount,
      }));
    },

    async encerrar() {
      await pool.end?.();
    },
  };
}
