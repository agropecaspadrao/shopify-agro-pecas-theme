// Adaptador local da memória: tudo em mapas na memória do processo, com
// reidratação a partir do registro JSONL (data/registro-*.jsonl).
//
// É o modo sem DATABASE_URL e o fallback automático quando o Postgres cai.
// Depois de um reinício, a sessão de um cliente é reconstruída do disco
// olhando até MEMORIA.contextoDias (7) dias para trás: a cadeia ativa (sem
// intervalo de 12h, última mensagem há menos de 24h) volta como memória de
// trabalho e as cadeias anteriores voltam como episódios "crus" (trecho final
// da conversa), já que os resumos do Haiku só existem no banco.
//
// Mesma interface do adaptador Postgres (ver postgres.js). Horários das
// sessões em ms; inicio/fim de episódio e ultimoContato da ficha em ISO.

import { listarPeriodo } from '../registro.js';
import { MEMORIA, TEMPO } from './config.js';
import { episodioBruto, mensagensDoRegistro } from './regras.js';
import { mascarar } from '../util/telefone.js';

export function criarAdaptadorLocal({ listar = listarPeriodo, agora = Date.now } = {}) {
  const sessoes = new Map();
  const episodios = new Map(); // sessao -> [episodio]
  const fichas = new Map();
  const reidratadas = new Set();
  // Quando cada episódio/ficha foi gravado aqui (para devolver ao Postgres
  // o que foi criado durante uma queda do banco)
  const gravadosEm = new Map(); // 'ep:<id>' | 'ficha:<sessao>' -> ms

  function reidratar(sessao) {
    if (reidratadas.has(sessao)) return;
    reidratadas.add(sessao);
    if (reidratadas.size > 50000) reidratadas.clear(); // proteção de memória contra flood de sessões
    let entradas;
    try {
      const fim = new Date(agora() + 1000);
      const inicio = new Date(agora() - MEMORIA.contextoDias * TEMPO.DIA);
      entradas = listar(inicio, fim).filter((e) => e.sessao === sessao && mensagensDoRegistro(e).length);
    } catch (e) {
      console.warn('[memoria] falha ao reidratar do registro:', e.message);
      return;
    }
    if (!entradas.length) return;

    // Cadeias separadas por intervalos de 12h ou mais
    const cadeias = [[]];
    for (let i = 0; i < entradas.length; i++) {
      if (i > 0 && new Date(entradas[i].ts) - new Date(entradas[i - 1].ts) >= MEMORIA.gapNovaConversaMs) cadeias.push([]);
      cadeias[cadeias.length - 1].push(entradas[i]);
    }
    const paraMensagens = (cadeia) => cadeia.flatMap(mensagensDoRegistro);

    const ultima = cadeias[cadeias.length - 1];
    const ultimaTs = new Date(ultima[ultima.length - 1].ts).getTime();
    const anteriores = agora() - ultimaTs < MEMORIA.trabalhoTtlMs ? cadeias.slice(0, -1) : cadeias;
    if (anteriores !== cadeias && !sessoes.has(sessao)) {
      const mensagens = paraMensagens(ultima).slice(-MEMORIA.maxMensagens);
      sessoes.set(sessao, {
        sessao,
        mensagens,
        resumoParcial: '',
        criadoEm: new Date(ultima[0].ts).getTime(),
        atualizadoEm: ultimaTs,
        pendente: true,
        processandoAte: 0,
      });
      console.log(`[memoria] histórico de ${mascarar(sessao)} reidratado do registro (${mensagens.length} mensagens)`);
    }
    if (!episodios.has(sessao) && anteriores.length) {
      episodios.set(
        sessao,
        anteriores.map((c) => episodioBruto(sessao, paraMensagens(c))).reverse()
      );
    }
  }

  function vigente(s, incluirExpirada = false) {
    if (!s) return null;
    if (agora() - s.atualizadoEm < MEMORIA.trabalhoTtlMs) return s;
    return incluirExpirada && s.pendente ? s : null;
  }

  return {
    nome: 'local',

    async iniciar() {},

    /** `incluirExpirada`: devolve também a sessão vencida que ainda não virou episódio. */
    async obterSessao(sessao, { incluirExpirada = false } = {}) {
      reidratar(sessao);
      const s = vigente(sessoes.get(sessao), incluirExpirada);
      return s ? structuredClone(s) : null;
    },

    async salvarSessao({ sessao, mensagens, resumoParcial = '', criadoEm, atualizadoEm }) {
      reidratadas.add(sessao); // o que está na memória já é mais novo que o disco
      const antes = sessoes.get(sessao);
      sessoes.set(sessao, { sessao, mensagens: structuredClone(mensagens), resumoParcial, criadoEm, atualizadoEm, pendente: true, processandoAte: antes?.processandoAte || 0 });
    },

    async reivindicarOciosas({ ate, limite = 20 }) {
      const t = agora();
      const lista = [...sessoes.values()]
        .filter((s) => s.pendente && s.atualizadoEm < ate && (!s.processandoAte || s.processandoAte < t))
        .sort((a, b) => a.atualizadoEm - b.atualizadoEm)
        .slice(0, limite);
      for (const s of lista) s.processandoAte = t + MEMORIA.travaFechamentoMs;
      return lista.map((s) => structuredClone(s));
    },

    async concluirEpisodio({ sessao, atualizadoEm, episodio, mesclarFicha, ultimoContato }) {
      if (episodio) {
        const lista = (episodios.get(sessao) || []).filter((e) => e.id !== episodio.id);
        lista.push(structuredClone(episodio));
        lista.sort((a, b) => String(b.fim).localeCompare(String(a.fim)));
        episodios.set(sessao, lista);
        gravadosEm.set(`ep:${episodio.id}`, agora());
      }
      if (mesclarFicha) {
        const atual = fichas.get(sessao);
        const dados = mesclarFicha(atual?.dados || null);
        const contato = atual && atual.ultimoContato > ultimoContato ? atual.ultimoContato : ultimoContato;
        fichas.set(sessao, { sessao, dados, ultimoContato: contato });
        gravadosEm.set(`ficha:${sessao}`, agora());
      }
      const s = sessoes.get(sessao);
      if (s) {
        s.processandoAte = 0;
        if (s.atualizadoEm === atualizadoEm) s.pendente = false; // chegou mensagem nova no meio: continua pendente
      }
    },

    async liberar(sessao) {
      const s = sessoes.get(sessao);
      if (s) s.processandoAte = 0;
    },

    async obterFicha(sessao) {
      reidratar(sessao);
      const f = fichas.get(sessao);
      return f ? structuredClone(f) : null;
    },

    async listarEpisodios(sessao, { desde, limite = MEMORIA.episodiosNoContexto } = {}) {
      reidratar(sessao);
      return (episodios.get(sessao) || [])
        .filter((e) => !desde || new Date(e.fim).getTime() >= desde)
        .slice(0, limite)
        .map((e) => structuredClone(e));
    },

    async episodiosNoPeriodo(inicio, fim) {
      const lista = [];
      for (const eps of episodios.values()) {
        for (const e of eps) {
          const t = new Date(e.fim).getTime();
          if (!e.dados?.bruto && t >= inicio && t < fim) lista.push(structuredClone(e));
        }
      }
      return lista.sort((a, b) => String(a.fim).localeCompare(String(b.fim)));
    },

    async limpar({ agora: t = agora() } = {}) {
      const r = { trabalho: 0, episodios: 0, fichas: 0, teste: 0 };
      const corteEpisodio = t - MEMORIA.contextoDias * TEMPO.DIA;
      for (const [id, s] of sessoes) {
        if (/deploy-check/i.test(id)) {
          sessoes.delete(id);
          r.teste++;
          continue;
        }
        // expirada: apaga se o episódio já foi fechado; pendente há mais de 7 dias apaga de qualquer jeito
        if (t - s.atualizadoEm >= MEMORIA.trabalhoTtlMs && (!s.pendente || s.atualizadoEm < corteEpisodio)) {
          sessoes.delete(id);
          r.trabalho++;
        }
      }
      for (const [id, eps] of episodios) {
        if (/deploy-check/i.test(id)) {
          r.teste += eps.length;
          episodios.delete(id);
          continue;
        }
        const ficam = eps.filter((e) => new Date(e.fim).getTime() >= corteEpisodio);
        r.episodios += eps.length - ficam.length;
        if (ficam.length) episodios.set(id, ficam);
        else episodios.delete(id);
      }
      const corteFicha = t - MEMORIA.fichaDias * TEMPO.DIA;
      for (const [id, f] of fichas) {
        if (/deploy-check/i.test(id)) {
          fichas.delete(id);
          r.teste++;
        } else if (new Date(f.ultimoContato).getTime() < corteFicha) {
          fichas.delete(id);
          r.fichas++;
        }
      }
      return r;
    },

    /** Sessões gravadas depois de `desde` (para devolver ao Postgres quando ele voltar). */
    sessoesDesde(desde) {
      return [...sessoes.values()].filter((s) => s.atualizadoEm >= desde).map((s) => structuredClone(s));
    },

    /** Episódios (não crus) gravados aqui depois de `desde`. */
    episodiosDesde(desde) {
      const r = [];
      for (const eps of episodios.values()) for (const e of eps) if (!e.dados?.bruto && (gravadosEm.get(`ep:${e.id}`) || 0) >= desde) r.push(structuredClone(e));
      return r;
    },

    /** Fichas gravadas aqui depois de `desde`. */
    fichasDesde(desde) {
      return [...fichas.values()].filter((f) => (gravadosEm.get(`ficha:${f.sessao}`) || 0) >= desde).map((f) => structuredClone(f));
    },

    /** LGPD: apaga tudo do cliente neste processo. */
    async apagar(sessao) {
      const r = { trabalho: sessoes.delete(sessao) ? 1 : 0, episodios: (episodios.get(sessao) || []).length, fichas: fichas.delete(sessao) ? 1 : 0 };
      for (const e of episodios.get(sessao) || []) gravadosEm.delete(`ep:${e.id}`);
      episodios.delete(sessao);
      gravadosEm.delete(`ficha:${sessao}`);
      reidratadas.add(sessao); // o registro dele também é apagado; não reidratar sobra
      return r;
    },
  };
}
