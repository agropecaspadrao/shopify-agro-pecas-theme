// LGPD: exclusão de todos os dados de um cliente a pedido dele.
// Apaga memória de trabalho, episódios e ficha (Postgres e modo local) e
// reescreve os arquivos do registro JSONL sem as linhas da sessão (atômico).
// Usado por POST /admin/cliente/apagar e pelo comando "/carol apagar <telefone>".
// O espelho que já foi para o SDR é apagado lá (fora deste serviço).

import { apagarSessaoDoRegistro } from './registro.js';
import { auditar } from './util/auditoria.js';
import { mascarar } from './util/telefone.js';

const SESSAO_SITE = /^site:[A-Za-z0-9_-]{16,64}$/;

/**
 * Sessões candidatas: telefone brasileiro com e sem o nono dígito (o webhook
 * da Meta pode entregar qualquer um dos dois para o mesmo celular).
 */
export function sessoesDoCliente({ telefone, sessao } = {}) {
  if (sessao) {
    const s = String(sessao).trim();
    if (SESSAO_SITE.test(s)) return [s];
    if (/^wa:\d{10,15}$/.test(s)) return sessoesDoCliente({ telefone: s.slice(3) });
    return [];
  }
  const d = String(telefone || '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 15) return [];
  const lista = new Set([d]);
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') lista.add(d.slice(0, 4) + d.slice(5));
  if (d.length === 12 && d.startsWith('55')) lista.add(d.slice(0, 4) + '9' + d.slice(4));
  return [...lista].map((n) => `wa:${n}`);
}

/**
 * @param {{telefone?:string, sessao?:string}} alvo
 * @param {{memoria:{apagar:Function}, apagarRegistro?:Function, por?:string}} deps
 * @returns {Promise<{ok:boolean, sessoes:string[], registro:number, memoria:object[], erro?:string}>}
 */
export async function apagarCliente(alvo, { memoria, apagarRegistro = apagarSessaoDoRegistro, por = null } = {}) {
  const sessoes = sessoesDoCliente(alvo);
  if (!sessoes.length) return { ok: false, sessoes: [], registro: 0, memoria: [], erro: 'informe um telefone (com DDD) ou uma sessão válida' };
  let registro = 0;
  const mem = [];
  const errosBanco = [];
  for (const s of sessoes) {
    const m = await memoria.apagar(s);
    if (m?.erroBanco) errosBanco.push(m.erroBanco);
    mem.push({ sessao: mascarar(s), local: m?.local || null, banco: m?.banco || null });
    registro += apagarRegistro(s);
  }
  const r = { ok: !errosBanco.length, sessoes: sessoes.map(mascarar), registro, memoria: mem, ...(errosBanco.length ? { erro: `banco indisponível: ${errosBanco[0]}. Repita quando o Postgres voltar.` } : {}) };
  auditar({ evento: 'lgpd_apagar', por: por ? mascarar(por) : null, sessoes: r.sessoes, registro, ok: r.ok });
  console.log(`[lgpd] dados de ${r.sessoes.join(', ')} apagados (${registro} linha(s) do registro)${r.ok ? '' : ' COM ERRO no banco'}`);
  return r;
}

/** Contagens em uma linha, para o WhatsApp e o log. */
export function textoExclusao(r) {
  if (!r.sessoes.length) return `Nada apagado: ${r.erro}`;
  const soma = (campo) => r.memoria.reduce((s, m) => s + (m.local?.[campo] || 0) + (m.banco?.[campo] || 0), 0);
  return `Dados de ${r.sessoes.join(' / ')} apagados: ${r.registro} linha(s) do registro, ${soma('trabalho')} conversa(s) ativa(s), ${soma('episodios')} episódio(s), ${soma('fichas')} ficha(s).${r.ok ? '' : ` ATENÇÃO: ${r.erro}`}`;
}
