// Supervisor de saúde: orquestra os verificadores (workers), consolida o
// quadro geral, tenta recuperação automática onde existe ação segura e
// reporta anomalias. Guarda o último estado em disco para o painel, o
// relatório dos sócios e a detecção de "voltou ao normal".
//
// Padrão orquestrador-workers: os verificadores não se conhecem e rodam em
// paralelo; só o supervisor decide o que fazer com os resultados.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { DATA_DIR } from '../registro.js';
import { VERIFICADORES } from './verificadores.js';
import { RECUPERACOES } from './recuperacao.js';
import { reportarAnomalia as reportarPadrao } from '../alertas/anomalias.js';

const ARQUIVO = path.join(DATA_DIR, 'saude.json');
const PESO = { falha: 3, aviso: 2, ok: 1, nao_configurado: 0 };

function carregar() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return null;
  }
}

function salvar(estado) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify(estado));
  } catch (e) {
    console.error('[saude] não consegui persistir o estado:', e.message);
  }
}

/** Último quadro consolidado (ou null se nunca rodou). */
export function ultimoEstado() {
  return carregar();
}

/**
 * Roda todos os verificadores, tenta recuperar, reporta e persiste.
 * @param {{verificadores?:Function[], recuperacoes?:object, reportarAnomalia?:Function, agora?:()=>number, fetchFn?:Function}} deps
 */
export async function verificarTudo(deps = {}) {
  const verificadores = deps.verificadores || VERIFICADORES;
  const recuperacoes = deps.recuperacoes || RECUPERACOES;
  const reportarAnomalia = deps.reportarAnomalia || reportarPadrao;
  const agora = deps.agora || Date.now;
  const opts = { fetchFn: deps.fetchFn, agora };

  const anterior = carregar();
  const anteriorPorNome = new Map((anterior?.resultados || []).map((r) => [r.nome, r]));

  const liquidados = await Promise.allSettled(verificadores.map((v) => v(opts)));
  const resultados = liquidados.map((l, i) =>
    l.status === 'fulfilled'
      ? l.value
      : { nome: verificadores[i].name.replace(/^verificar/, '').toLowerCase(), estado: 'falha', tipoAnomalia: 'saude_falha', resumo: 'verificador lançou erro', detalhe: String(l.reason?.message || l.reason) }
  );

  const recuperacoesFeitas = [];
  for (let i = 0; i < resultados.length; i++) {
    let r = resultados[i];
    const antes = anteriorPorNome.get(r.nome);

    if (r.estado === 'falha' && recuperacoes[r.nome]) {
      try {
        const rec = await recuperacoes[r.nome](r, opts);
        recuperacoesFeitas.push({ nome: r.nome, ...rec });
        if (rec.recuperou) {
          await reportarAnomalia({ tipo: 'recuperacao_automatica', titulo: `Recuperação automática: ${r.nome}`, detalhe: `${r.resumo}. ${rec.descricao}`, forcar: true });
          const reexame = await verificadores[i](opts).catch(() => r);
          r = { ...reexame, recuperadoAutomaticamente: true, descricaoRecuperacao: rec.descricao };
          resultados[i] = r;
        } else {
          r.detalhe = `${r.detalhe || ''}\nRecuperação automática tentada: ${rec.descricao}`.trim();
        }
      } catch (e) {
        r.detalhe = `${r.detalhe || ''}\nRecuperação automática falhou: ${e.message}`.trim();
      }
    }

    if ((r.estado === 'falha' || r.estado === 'aviso') && r.tipoAnomalia) {
      await reportarAnomalia({ tipo: r.tipoAnomalia, detalhe: `[${r.nome}] ${r.resumo}${r.detalhe ? '\n' + r.detalhe : ''}`, severidade: r.estado === 'aviso' && r.tipoAnomalia !== 'whatsapp_token_expira' ? 'media' : undefined });
    }

    // Voltou ao normal sem a nossa recuperação: avisa uma vez, em tom de boa notícia.
    if (antes && antes.estado === 'falha' && r.estado === 'ok' && !r.recuperadoAutomaticamente && antes.tipoAnomalia) {
      await reportarAnomalia({ tipo: antes.tipoAnomalia, titulo: `Resolvido: ${antes.resumo}`, detalhe: `[${r.nome}] agora: ${r.resumo}`, severidade: 'media', recuperado: true, forcar: true });
    }
  }

  const pior = resultados.reduce((m, r) => Math.max(m, PESO[r.estado] ?? 0), 0);
  const geral = pior >= 3 ? 'falha' : pior === 2 ? 'aviso' : 'ok';
  const estado = {
    ts: new Date(agora()).toISOString(),
    geral,
    resultados: resultados.map(({ nome, estado, resumo, detalhe, tipoAnomalia, dados, recuperadoAutomaticamente, descricaoRecuperacao }) => ({ nome, estado, resumo, detalhe, tipoAnomalia, dados, recuperadoAutomaticamente, descricaoRecuperacao })),
    recuperacoes: recuperacoesFeitas,
  };
  salvar(estado);
  console.log(`[saude] quadro geral: ${geral.toUpperCase()} (${resultados.map((r) => `${r.nome}=${r.estado}`).join(', ')})`);
  return estado;
}

/** Texto compacto do quadro de saúde (WhatsApp e e-mail). */
export function textoSaude(estado) {
  if (!estado) return 'Ainda não há verificação de saúde registrada.';
  const rotulo = { ok: 'OK', aviso: 'ATENCAO', falha: 'FALHA', nao_configurado: 'nao configurado' };
  const quando = new Date(estado.ts).toLocaleString('pt-BR', { timeZone: config.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const linhas = [`Saude geral: ${rotulo[estado.geral]} (verificado ${quando})`, ''];
  for (const r of estado.resultados) {
    linhas.push(`${rotulo[r.estado].padEnd(15)} ${r.nome}: ${r.resumo}${r.recuperadoAutomaticamente ? ' (recuperado automaticamente)' : ''}`);
  }
  return linhas.join('\n');
}

let timer = null;

/** Agenda a verificação periódica (primeira rodada 60s após o boot). */
export function agendarSupervisor({ intervaloMin = config.saude.intervaloMin, atrasoInicialMs = 60000 } = {}) {
  const rodar = () => verificarTudo().catch((e) => console.error('[saude] falha na verificação:', e.message));
  setTimeout(rodar, atrasoInicialMs).unref();
  timer = setInterval(rodar, intervaloMin * 60000);
  timer.unref();
  console.log(`[saude] supervisor agendado a cada ${intervaloMin} min`);
  return timer;
}
