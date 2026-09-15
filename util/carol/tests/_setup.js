// Preparação comum: cada arquivo de teste roda em processo próprio (node --test),
// então basta apontar o diretório de dados para uma pasta temporária ANTES de
// importar qualquer módulo que leia CAROL_DATA_DIR.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function dataDirTemporario(prefixo = 'carol-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  process.env.CAROL_DATA_DIR = dir;
  return dir;
}

/** fetch falso: recebe um mapa { trechoDaUrl: resposta | função(url, opts) } */
export function fetchFalso(rotas) {
  const chamadas = [];
  const fn = async (url, opts = {}) => {
    chamadas.push({ url, opts });
    for (const [trecho, resp] of Object.entries(rotas)) {
      if (url.includes(trecho)) {
        const r = typeof resp === 'function' ? await resp(url, opts) : resp;
        const status = r.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => r.corpo ?? {},
          text: async () => (typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo ?? {})),
        };
      }
    }
    throw new Error(`fetchFalso: rota não prevista: ${url}`);
  };
  fn.chamadas = chamadas;
  return fn;
}

/** Relógio controlável. */
export function relogio(inicio = Date.parse('2026-09-15T12:00:00Z')) {
  let t = inicio;
  const agora = () => t;
  agora.avancar = (ms) => (t += ms);
  agora.definir = (iso) => (t = Date.parse(iso));
  return agora;
}
