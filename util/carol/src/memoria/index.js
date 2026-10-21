// Memória de conversa da Carol: fachada única usada por claude.js, server.js
// e relatorio.js. Três camadas (ver ARQUITETURA.md, seção 2.7):
//   1. memória de trabalho  mensagens cruas da conversa ativa (expira 24h após a última)
//   2. episódios            resumo do Haiku quando a conversa fica ociosa (7 dias)
//   3. ficha do cliente     fatos com data, o mais recente vence (180 dias sem contato)
//
// Robustez: o repositório primário é o Postgres (DATABASE_URL). Qualquer erro
// do banco cai, na mesma chamada, para o adaptador local (memória + registro
// JSONL), reporta a anomalia 'memoria_degradada' e tenta o banco de novo depois
// de MEMORIA.pausaDegradeMs. Quando o banco volta, as sessões, episódios e
// fichas gravados no modo local são devolvidos a ele. A Carol nunca para de responder por causa da
// memória: toda leitura tem fallback e toda escrita roda depois da resposta.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../registro.js';
import { MEMORIA, TEMPO } from './config.js';
import { criarAdaptadorLocal } from './local.js';
import { conversaTemTrocaReal, interpretarEpisodio, mesclarFicha, montarBlocoMemoria, episodioBruto, juntarFichas } from './regras.js';
import { mascarar } from '../util/telefone.js';

// Falhas seguidas do job de fechamento (Haiku fora) antes de virar anomalia
export const FALHAS_FECHAMENTO_ALERTA = 3;

const isoDe = (msOuIso) => new Date(msOuIso).toISOString();

/**
 * Apaga os arquivos registro-AAAA-MM-DD.jsonl mais velhos que `dias`.
 * @returns {string[]} nomes apagados
 */
export function limparRegistroAntigo(dir = DATA_DIR, dias = MEMORIA.registroDias, agora = Date.now()) {
  const corte = new Date(agora - dias * TEMPO.DIA).toISOString().slice(0, 10);
  const apagados = [];
  let nomes = [];
  try {
    nomes = fs.readdirSync(dir);
  } catch {
    return apagados;
  }
  for (const nome of nomes) {
    const m = nome.match(/^registro-(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (!m || m[1] >= corte) continue;
    try {
      fs.unlinkSync(path.join(dir, nome));
      apagados.push(nome);
    } catch (e) {
      console.warn(`[memoria] não consegui apagar ${nome}: ${e.message}`);
    }
  }
  return apagados.sort();
}

/**
 * @param {object} deps
 * @param {object|(()=>Promise<object>)|null} deps.primario adaptador Postgres (ou fábrica assíncrona); null = só local
 * @param {object} deps.local adaptador local
 * @param {{gerarEpisodio:Function, resumirParcial:Function}} deps.ia chamadas ao Haiku
 * @param {()=>number} deps.agora relógio
 * @param {Function} deps.reportarAnomalia central de anomalias
 * @param {string} deps.dataDir onde ficam os registros JSONL
 */
export function criarMemoria(deps = {}) {
  const agora = deps.agora || Date.now;
  const local = deps.local || criarAdaptadorLocal({ agora });
  const ia = deps.ia || {
    gerarEpisodio: async (...a) => (await import('./ia.js')).gerarEpisodio(...a),
    resumirParcial: async (...a) => (await import('./ia.js')).resumirParcial(...a),
  };
  const reportar = deps.reportarAnomalia || (async (ev) => (await import('../alertas/anomalias.js')).reportarAnomalia(ev));
  const dataDir = deps.dataDir || DATA_DIR;

  let fabrica = typeof deps.primario === 'function' ? deps.primario : null;
  let primario = typeof deps.primario === 'function' ? null : deps.primario || null;
  let pronto = false; // migrações rodaram
  let degradadoDesde = 0;
  let tentarDeNovoEm = 0;
  let ultimoErro = '';
  let fechando = null;
  let falhasSeguidasFechamento = 0;
  const fila = new Map(); // sessao -> promessa da última escrita (ordem por sessão)

  function degradar(op, e) {
    // AggregateError (conexão recusada em IPv4 e IPv6) vem sem mensagem: usa a do primeiro erro
    ultimoErro = String(e?.message || e?.errors?.[0]?.message || e?.code || e).slice(0, 300);
    tentarDeNovoEm = agora() + MEMORIA.pausaDegradeMs;
    console.warn(`[memoria] Postgres falhou em ${op} (${ultimoErro}); usando a memória local por ${MEMORIA.pausaDegradeMs / 1000}s`);
    if (degradadoDesde) return;
    degradadoDesde = agora();
    Promise.resolve()
      .then(() => reportar({ tipo: 'memoria_degradada', detalhe: `Operação ${op}: ${ultimoErro}. A Carol segue atendendo com a memória local (registro JSONL de 7 dias); resumos e fichas novos ficam só neste processo até o banco voltar.` }))
      .catch(() => {});
  }

  // Sessões que receberam mensagens no modo local voltam para o banco ANTES
  // da primeira operação normal (senão a leitura viria sem essas mensagens).
  // Erro aqui sobe: o banco ainda não voltou de verdade.
  async function devolverSessoes(p) {
    let n = 0;
    for (const s of local.sessoesDesde?.(degradadoDesde) || []) {
      await p.salvarSessao(s);
      n++;
    }
    // Episódios e fichas fechados no modo local também voltam (antes só as sessões voltavam)
    const episodios = local.episodiosDesde?.(degradadoDesde) || [];
    const fichas = local.fichasDesde?.(degradadoDesde) || [];
    if ((episodios.length || fichas.length) && p.importarMemoria) {
      await p.importarMemoria({ episodios, fichas, juntar: juntarFichas });
      console.log(`[memoria] ${episodios.length} episódio(s) e ${fichas.length} ficha(s) do modo local devolvidos ao banco`);
    }
    return n;
  }

  function recuperou(devolvidas) {
    const desde = degradadoDesde;
    degradadoDesde = 0;
    console.log(`[memoria] Postgres de volta; ${devolvidas} sessão(ões) devolvida(s) ao banco`);
    Promise.resolve()
      .then(() => reportar({ tipo: 'memoria_degradada', titulo: 'Resolvido: memória da Carol de volta ao Postgres', detalhe: `Degradada desde ${isoDe(desde)}. ${devolvidas} sessão(ões) devolvida(s) ao banco.`, severidade: 'media', recuperado: true, forcar: true }))
      .catch(() => {});
  }

  async function obterPrimario() {
    if (!primario && fabrica) {
      const f = fabrica;
      fabrica = null;
      primario = await f();
    }
    return primario;
  }

  /** Executa `op` no banco; se falhar (ou estiver em pausa de degrade), no local. */
  async function usar(op, args = []) {
    if (agora() >= tentarDeNovoEm) {
      try {
        const p = await obterPrimario();
        if (p) {
          if (!pronto) {
            await p.iniciar();
            pronto = true;
          }
          const devolvidas = degradadoDesde ? await devolverSessoes(p) : 0;
          const r = await p[op](...args);
          if (degradadoDesde) recuperou(devolvidas);
          return r;
        }
      } catch (e) {
        degradar(op, e);
      }
    }
    return local[op](...args);
  }

  function enfileirar(sessao, fn) {
    const anterior = fila.get(sessao) || Promise.resolve();
    const p = anterior.catch(() => {}).then(fn);
    fila.set(sessao, p);
    p.finally(() => {
      if (fila.get(sessao) === p) fila.delete(sessao);
    }).catch(() => {});
    return p;
  }

  /** Fecha uma sessão: anti-lixo, Haiku (episódio + fatos), grava episódio e ficha. */
  async function fecharSessao(s) {
    if (!conversaTemTrocaReal(s.sessao, s.mensagens)) {
      await usar('concluirEpisodio', [{ sessao: s.sessao, atualizadoEm: s.atualizadoEm, episodio: null, mesclarFicha: null }]);
      return 'lixo';
    }
    const ficha = await usar('obterFicha', [s.sessao]);
    const texto = await ia.gerarEpisodio({ sessao: s.sessao, mensagens: s.mensagens, resumoParcial: s.resumoParcial, fichaAtual: ficha?.dados || null });
    const r = interpretarEpisodio(texto);
    if (!r) throw new Error('o modelo não devolveu JSON de episódio');
    const fim = isoDe(s.atualizadoEm);
    const episodio = { id: `${s.sessao}|${isoDe(s.criadoEm)}`, sessao: s.sessao, inicio: s.mensagens[0]?.ts || isoDe(s.criadoEm), fim, dados: r.episodio };
    await usar('concluirEpisodio', [{ sessao: s.sessao, atualizadoEm: s.atualizadoEm, episodio, mesclarFicha: (atual) => mesclarFicha(atual, r.fatos, fim), ultimoContato: fim }]);
    return 'fechado';
  }

  const api = {
    /** Sobe o banco (migrações). Falha não impede o boot: fica no modo local. */
    async iniciar() {
      try {
        const p = await obterPrimario();
        if (!p) {
          console.log('[memoria] sem DATABASE_URL: memória local (registro JSONL de 7 dias)');
          return api.estado();
        }
        await p.iniciar();
        pronto = true;
        console.log('[memoria] Postgres pronto (migrações ok)');
      } catch (e) {
        degradar('iniciar', e);
      }
      return api.estado();
    },

    estado() {
      return {
        adaptador: primario || fabrica ? 'postgres' : 'local',
        degradado: Boolean(degradadoDesde),
        degradadoDesde: degradadoDesde ? isoDe(degradadoDesde) : null,
        ultimoErro: degradadoDesde ? ultimoErro : '',
      };
    },

    /**
     * Contexto para a próxima resposta da Carol.
     * @returns {Promise<{modo:'continuacao'|'retomada'|'ficha'|'nova', historico:{role:string,content:string}[], resumoParcial:string, bloco:string}>}
     */
    async contextoConversa(sessao, mensagemAtual = '') {
      try {
        const t = agora();
        const s = await usar('obterSessao', [sessao, { incluirExpirada: true }]);
        if (s && s.mensagens.length && t - s.atualizadoEm < MEMORIA.gapNovaConversaMs) {
          return {
            modo: 'continuacao',
            historico: s.mensagens.map(({ role, content, autor }) => ({ role, content, ...(autor ? { autor } : {}) })),
            resumoParcial: s.resumoParcial || '',
            bloco: '',
          };
        }
        // Gap de 12h ou mais (ou cliente sem sessão): nova conversa, com memória se houver
        const desde = t - MEMORIA.contextoDias * TEMPO.DIA;
        const [ficha, eps] = await Promise.all([usar('obterFicha', [sessao]), usar('listarEpisodios', [sessao, { desde, limite: MEMORIA.episodiosNoContexto }])]);
        let episodios = eps || [];
        // Sessão anterior que o job ainda não resumiu: entra crua, sem esperar o Haiku
        if (s && s.pendente && conversaTemTrocaReal(sessao, s.mensagens)) {
          const bruto = episodioBruto(sessao, s.mensagens, { resumoParcial: s.resumoParcial });
          episodios = [bruto, ...episodios.filter((e) => e.id !== bruto.id)].slice(0, MEMORIA.episodiosNoContexto);
        }
        const ultimo = Math.max(s?.atualizadoEm || 0, ficha ? new Date(ficha.ultimoContato).getTime() : 0, episodios[0] ? new Date(episodios[0].fim).getTime() : 0);
        let modo = 'nova';
        if (ultimo && t - ultimo <= MEMORIA.contextoDias * TEMPO.DIA && (ficha || episodios.length)) modo = 'retomada';
        else if (ficha) modo = 'ficha';
        const bloco = modo === 'nova' ? '' : montarBlocoMemoria({ modo, ficha: ficha?.dados, episodios, mensagemAtual });
        return { modo: bloco ? modo : 'nova', historico: [], resumoParcial: '', bloco };
      } catch (e) {
        console.warn(`[memoria] contexto de ${mascarar(sessao)} indisponível, seguindo sem memória: ${e.message}`);
        return { modo: 'nova', historico: [], resumoParcial: '', bloco: '' };
      }
    },

    /** Mensagens da conversa ativa (para o resumo de transferência site → WhatsApp). */
    async historicoAtual(sessao) {
      try {
        const s = await usar('obterSessao', [sessao]);
        return s ? { mensagens: s.mensagens.map(({ role, content, autor }) => ({ role, content, ...(autor ? { autor } : {}) })), resumoParcial: s.resumoParcial || '' } : { mensagens: [], resumoParcial: '' };
      } catch {
        return { mensagens: [], resumoParcial: '' };
      }
    },

    /**
     * Grava o turno depois que a resposta já saiu (ou não: silêncio, falha).
     * `mensagem` vazia = só a resposta (eco da equipe, autor 'humano');
     * `resposta` vazia = só o cliente (silêncio, falha, envio que não saiu).
     * Escritas da mesma sessão são enfileiradas (duas mensagens seguidas não
     * se sobrescrevem). Acima de 30 mensagens, as antigas viram resumo
     * parcial e ficam as 20 mais recentes.
     */
    registrarTurno(sessao, { mensagem, resposta, autor = null, ts = agora() }) {
      return enfileirar(sessao, async () => {
        const tsMs = typeof ts === 'number' ? ts : new Date(ts).getTime();
        const tsIso = isoDe(tsMs);
        // Inclui a sessão vencida que ainda não virou episódio: sem isso a
        // próxima mensagem a sobrescrevia e a conversa sumia da memória.
        const s = await usar('obterSessao', [sessao, { incluirExpirada: true }]);
        let base;
        if (s && tsMs - s.atualizadoEm < MEMORIA.gapNovaConversaMs) {
          base = s;
        } else {
          // Conversa anterior ainda sem episódio: fecha antes de sobrescrever;
          // se o Haiku falhar, guarda o episódio cru (trecho final) para não perder.
          if (s?.pendente && s.mensagens?.length) {
            await fecharSessao(s).catch(async (e) => {
              console.warn(`[memoria] não fechei o episódio anterior de ${mascarar(sessao)} (${e.message}); guardando episódio cru`);
              if (conversaTemTrocaReal(sessao, s.mensagens)) {
                const bruto = episodioBruto(sessao, s.mensagens, { resumoParcial: s.resumoParcial });
                await usar('concluirEpisodio', [{ sessao, atualizadoEm: s.atualizadoEm, episodio: bruto, mesclarFicha: null }]).catch(() => {});
              }
            });
          }
          base = { mensagens: [], resumoParcial: '', criadoEm: tsMs };
        }
        const novas = [];
        if (String(mensagem ?? '').trim()) novas.push({ role: 'user', content: String(mensagem), ts: tsIso });
        if (String(resposta ?? '').trim()) novas.push({ role: 'assistant', content: String(resposta), ts: tsIso, ...(autor === 'humano' ? { autor } : {}) });
        if (!novas.length) return;
        let mensagens = [...base.mensagens, ...novas];
        let resumoParcial = base.resumoParcial || '';
        if (mensagens.length > MEMORIA.maxMensagens) {
          const corte = mensagens.length - MEMORIA.mensagensCruas;
          try {
            const novo = await ia.resumirParcial({ mensagens: mensagens.slice(0, corte), resumoAnterior: resumoParcial });
            resumoParcial = String(novo || '').replace(/R\$\s?[\d.,]+/g, '').trim().slice(0, 2000) || resumoParcial;
            mensagens = mensagens.slice(corte);
          } catch (e) {
            // Sem resumo: mantém a janela de 30 (como antes) e tenta compactar no próximo turno
            console.warn(`[memoria] compactação de ${mascarar(sessao)} falhou: ${e.message}`);
            mensagens = mensagens.slice(-MEMORIA.maxMensagens);
          }
        }
        await usar('salvarSessao', [{ sessao, mensagens, resumoParcial, criadoEm: base.criadoEm, atualizadoEm: tsMs }]);
      });
    },

    /** LGPD: apaga a memória do cliente no banco e no modo local. */
    async apagar(sessao) {
      await api.aguardarEscritas();
      const r = { local: await local.apagar(sessao), banco: null, erroBanco: null };
      try {
        const p = await obterPrimario();
        if (p) {
          if (!pronto) {
            await p.iniciar();
            pronto = true;
          }
          r.banco = await p.apagar(sessao);
        }
      } catch (e) {
        r.erroBanco = String(e.message || e).slice(0, 200);
      }
      return r;
    },

    /** Job: fecha os episódios das conversas paradas há MEMORIA.episodioOciosoMs. */
    async fecharEpisodiosOciosos({ ate = agora() - MEMORIA.episodioOciosoMs, limite = 20, maxRodadas = 25 } = {}) {
      if (fechando) return fechando;
      fechando = (async () => {
        const r = { fechados: 0, lixo: 0, falhas: 0 };
        for (let rodada = 0; rodada < maxRodadas; rodada++) {
          const lote = await usar('reivindicarOciosas', [{ ate, limite }]);
          if (!lote.length) break;
          for (const s of lote) {
            try {
              r[(await fecharSessao(s)) === 'lixo' ? 'lixo' : 'fechados']++;
            } catch (e) {
              r.falhas++;
              r.ultimoErro = String(e.message || e).slice(0, 200);
              console.warn(`[memoria] fechamento de ${mascarar(s.sessao)} falhou: ${e.message}`);
              await usar('liberar', [s.sessao]).catch(() => {});
            }
          }
          if (r.falhas && r.falhas >= lote.length) break; // Haiku fora: tenta no próximo ciclo
        }
        if (r.fechados || r.lixo || r.falhas) console.log(`[memoria] episódios: ${r.fechados} fechado(s), ${r.lixo} descartado(s) sem troca real, ${r.falhas} falha(s)`);
        // Haiku fora por várias rodadas: as conversas ficam sem episódio. Avisa.
        if (r.falhas && !r.fechados && !r.lixo) {
          falhasSeguidasFechamento++;
          if (falhasSeguidasFechamento === FALHAS_FECHAMENTO_ALERTA) {
            const detalhe = `${FALHAS_FECHAMENTO_ALERTA} rodadas seguidas sem conseguir fechar episódios (${r.falhas} conversa(s) na última). Último erro: ${r.ultimoErro || '?'}. As conversas seguem na memória de trabalho e são tentadas de novo a cada ${MEMORIA.intervaloFechamentoMs / 60000} min.`;
            Promise.resolve()
              .then(() => reportar({ tipo: 'memoria_fechamento', detalhe }))
              .catch(() => {});
          }
        } else if (r.fechados || r.lixo) {
          falhasSeguidasFechamento = 0;
        }
        delete r.ultimoErro;
        return r;
      })();
      try {
        return await fechando;
      } finally {
        fechando = null;
      }
    },

    /** Limpeza diária (3h): fecha pendências, apaga expirados, testes e JSONL antigo. */
    async limpar() {
      const fechamento = await api.fecharEpisodiosOciosos().catch((e) => ({ erro: e.message }));
      const banco = await usar('limpar', [{ agora: agora() }]);
      // Sobras do modo local (sessões gravadas durante um degrade) também expiram
      if (primario && !degradadoDesde) await local.limpar({ agora: agora() }).catch(() => {});
      const arquivos = limparRegistroAntigo(dataDir, MEMORIA.registroDias, agora());
      const r = { ...banco, registros: arquivos.length, fechamento };
      const resumo = `memória limpa: ${r.trabalho} conversa(s) expirada(s), ${r.episodios} episódio(s) > ${MEMORIA.contextoDias}d, ${r.fichas} ficha(s) > ${MEMORIA.fichaDias}d, ${r.teste} registro(s) de teste, ${r.registros} arquivo(s) JSONL > ${MEMORIA.registroDias}d`;
      console.log(`[memoria] ${resumo}`);
      return { ...r, resumo };
    },

    /** Episódios fechados no período (relatório diário). [] se a memória estiver indisponível. */
    async episodiosNoPeriodo(inicio, fim) {
      try {
        return await usar('episodiosNoPeriodo', [new Date(inicio).getTime(), new Date(fim).getTime()]);
      } catch {
        return [];
      }
    },

    /** Roda o fechamento a cada MEMORIA.intervaloFechamentoMs (sem segurar o processo). */
    agendarFechamento() {
      const timer = setInterval(() => {
        api.fecharEpisodiosOciosos().catch((e) => console.warn('[memoria] job de episódios falhou:', e.message));
      }, MEMORIA.intervaloFechamentoMs);
      timer.unref();
      return timer;
    },

    /** Só para testes: espera as escritas pendentes. */
    async aguardarEscritas() {
      await Promise.allSettled([...fila.values()]);
    },
  };
  return api;
}

// Instância do serviço: Postgres quando há DATABASE_URL, senão só local.
export const memoria = criarMemoria({
  primario: process.env.DATABASE_URL
    ? async () => {
        const { criarPool, criarAdaptadorPostgres } = await import('./postgres.js');
        return criarAdaptadorPostgres({ pool: await criarPool(process.env.DATABASE_URL) });
      }
    : null,
});
