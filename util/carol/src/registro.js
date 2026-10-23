// Registro persistente dos atendimentos da Carol (arquivos JSONL por dia).
// Usado pelo relatório diário, API de administração, memória local e espelho SDR.
//
// Tipos de linha (campo `tipo`):
//   (ausente)  turno normal: mensagem do cliente + resposta da IA
//   sistema    chamada interna paga (resumos, relatório, memória); não é atendimento
//   falha      a IA falhou: `resposta` é a contingência enviada (ou vazia), `erro` o tipo
//   silencio   mensagem recebida sem resposta (motivo: horario | pausa | teto)
//   humano     resposta digitada pela equipe no app (eco do modo coexistência), autor 'humano'
//   aviso      resposta automática fixa, sem IA (ex.: mídia que a Carol não lê)
// `entregue: false` = a resposta foi gerada mas o envio ao cliente falhou.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './util/dados.js';
import { somarGasto } from './gasto.js';

export { DATA_DIR };

export const TIPOS_REGISTRO = ['sistema', 'falha', 'silencio', 'humano', 'aviso'];

/** Linha de atendimento (não é chamada interna). */
export function ehAtendimento(e) {
  return e && e.tipo !== 'sistema' && e.canal !== 'sistema';
}

/** Resposta da IA que chegou ao cliente (conta como "respondida pela Carol"). */
export function ehRespostaIA(e) {
  return ehAtendimento(e) && !e.tipo && e.entregue !== false;
}

/** Cliente ficou sem resposta da Carol: falha, silêncio, aviso fixo ou envio que não saiu. */
export function ehPendente(e) {
  return ehAtendimento(e) && (e.tipo === 'falha' || e.tipo === 'silencio' || e.tipo === 'aviso' || e.entregue === false);
}

function arquivoDoDia(data = new Date()) {
  const dia = data.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return path.join(DATA_DIR, `registro-${dia}.jsonl`);
}

/**
 * Grava um turno. Campos opcionais:
 *   tipo     ver o cabeçalho; ausente = turno normal da IA
 *   memoria  'retomada' | 'ficha' quando a Carol respondeu com memória de conversas anteriores
 *   origem   de onde veio o lead (ver origem.js); só no primeiro turno em que aparece
 *   entregue false quando o envio ao cliente falhou
 *   motivo   do silêncio (horario | pausa | teto)
 *   autor    'humano' nos ecos da equipe
 *   erro     tipo de anomalia que causou a falha
 * Chamada com custo soma no contador de gasto (gasto.js) ANTES de gravar a
 * linha (a migração do contador lê o registro; assim não conta duas vezes).
 */
export function registrarAtendimento({ canal, sessao, mensagem, resposta, uso, custo, modelo, tipo, memoria, origem, entregue, motivo, autor, erro, ts }) {
  try {
    if (typeof custo === 'number' && custo > 0) somarGasto(custo);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const quando = ts ? new Date(ts) : new Date();
    const linha = JSON.stringify({
      ts: quando.toISOString(),
      canal,
      sessao,
      ...(tipo ? { tipo } : {}),
      mensagem: String(mensagem ?? '').slice(0, 2000),
      resposta: String(resposta ?? '').slice(0, 2000),
      ...(uso ? { uso } : {}),
      ...(typeof custo === 'number' ? { custo } : {}),
      ...(modelo ? { modelo } : {}),
      ...(memoria ? { memoria } : {}),
      ...(origem && typeof origem === 'object' ? { origem } : {}),
      ...(entregue === false ? { entregue: false } : {}),
      ...(motivo ? { motivo } : {}),
      ...(autor ? { autor } : {}),
      ...(erro ? { erro } : {}),
    });
    fs.appendFileSync(arquivoDoDia(quando), linha + '\n');
    espelharNoSdr(JSON.parse(linha));
  } catch (e) {
    console.warn('[registro] falha ao gravar:', e.message);
  }
}

/** URL do espelho aceita: https, ou http só para a própria máquina (desenvolvimento). */
export function urlEspelhoValida(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

let avisouChaveAntiga = false;
let avisouUrl = false;

/** Chave do espelho: SDR_SYNC_KEY; na transição cai para CAROL_ADMIN_KEY (com aviso). */
export function chaveEspelho(env = process.env) {
  if (env.SDR_SYNC_KEY) return env.SDR_SYNC_KEY;
  if (env.CAROL_ADMIN_KEY) {
    if (!avisouChaveAntiga) {
      avisouChaveAntiga = true;
      console.warn('[sdr] SDR_SYNC_KEY ausente: usando CAROL_ADMIN_KEY no espelho (transição). Configure SDR_SYNC_KEY igual na Carol e no SDR.');
    }
    return env.CAROL_ADMIN_KEY;
  }
  return '';
}

// Espelho em tempo real no SDR comercial (app-agente-sdr): cada turno do
// WhatsApp vai para a conversa do mesmo telefone no painel do SDR. Fogo e
// esquece: nunca atrasa nem derruba o atendimento; se falhar, o SDR puxa o
// registro sozinho a cada 10 minutos (idempotente pela data do turno).
// Contrato: header X-Carol-Key = SDR_SYNC_KEY; corpo { ts, canal, sessao,
// mensagem, resposta, origem?, tipo?, entregue?, motivo?, autor? }. Campos
// opcionais vão só quando existem; o SDR ignora o que não conhece.
export function espelharNoSdr(entrada, { env = process.env, fetchFn = (...a) => fetch(...a) } = {}) {
  const url = env.SDR_SYNC_URL;
  if (!url || entrada.tipo === 'sistema' || !String(entrada.sessao || '').startsWith('wa:')) return null;
  if (!urlEspelhoValida(url)) {
    if (!avisouUrl) {
      avisouUrl = true;
      console.error('[sdr] SDR_SYNC_URL recusada: precisa ser https:// (http só para localhost). Espelho desligado.');
    }
    return null;
  }
  const chave = chaveEspelho(env);
  if (!chave) return null;
  const { ts, canal, sessao, mensagem, resposta, origem, tipo, entregue, motivo, autor } = entrada;
  const corpo = { ts, canal, sessao, mensagem, resposta, ...(origem ? { origem } : {}), ...(tipo ? { tipo } : {}), ...(entregue === false ? { entregue } : {}), ...(motivo ? { motivo } : {}), ...(autor ? { autor } : {}) };
  return Promise.resolve()
    .then(() =>
      fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-carol-key': chave },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(15000),
      })
    )
    .then((r) => {
      if (!r.ok) console.warn(`[sdr] espelho respondeu ${r.status}`);
    })
    .catch((e) => console.warn('[sdr] espelho falhou:', e.message));
}

/** Retorna as entradas com ts entre inicio e fim (objetos Date). */
export function listarPeriodo(inicio, fim) {
  const entradas = [];
  // varre os arquivos dos dias que o período pode tocar
  for (let d = new Date(inicio); d <= new Date(fim.getTime() + 86400000); d = new Date(d.getTime() + 86400000)) {
    const arq = arquivoDoDia(d);
    if (!fs.existsSync(arq)) continue;
    for (const linha of fs.readFileSync(arq, 'utf8').split('\n')) {
      if (!linha.trim()) continue;
      try {
        const e = JSON.parse(linha);
        const ts = new Date(e.ts);
        if (ts >= inicio && ts < fim) entradas.push(e);
      } catch {}
    }
  }
  return entradas.sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * LGPD: reescreve os arquivos do registro sem as linhas da sessão (gravação
 * atômica: arquivo temporário + rename). @returns {number} linhas removidas
 */
export function apagarSessaoDoRegistro(sessao, { dir = DATA_DIR } = {}) {
  let removidas = 0;
  let nomes = [];
  try {
    nomes = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const nome of nomes) {
    if (!/^registro-\d{4}-\d{2}-\d{2}\.jsonl$/.test(nome)) continue;
    const arq = path.join(dir, nome);
    const linhas = fs.readFileSync(arq, 'utf8').split('\n');
    const ficam = linhas.filter((l) => {
      if (!l.trim()) return false;
      try {
        if (JSON.parse(l).sessao === sessao) {
          removidas++;
          return false;
        }
      } catch {}
      return true;
    });
    if (ficam.length === linhas.filter((l) => l.trim()).length) continue;
    // tudo síncrono: nenhuma gravação do registro intercala com a reescrita
    const tmp = path.join(dir, `.${nome}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, ficam.length ? ficam.join('\n') + '\n' : '');
    fs.renameSync(tmp, arq);
  }
  return removidas;
}

