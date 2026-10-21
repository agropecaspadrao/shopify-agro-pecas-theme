// Tetos diários persistentes (DATA_DIR/tetos.json): contam por dia do
// calendário no fuso da loja (America/Sao_Paulo) e sobrevivem a deploy e
// reinício, ao contrário dos limites em memória (util/limite.js), que zeravam
// a cada deploy e contavam 24h a partir do primeiro uso.
//
// Grupos: 'wa' e 'site' (globais), 'wa_tel' (por telefone), 'site_sessao' e
// 'site_ip' (por sessão do widget e por IP/prefixo /64).

import path from 'node:path';
import { DATA_DIR } from './dados.js';
import { gravarJsonAtomico, lerJson } from './arquivo.js';

const MAX_CHAVES = 20000; // proteção contra flood de chaves novas

export function diaLocal(t, fuso = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/**
 * @param {{arquivo?:string, agora?:()=>number, fuso?:string, persistir?:boolean}} opts
 */
export function criarTetos({ arquivo = path.join(DATA_DIR, 'tetos.json'), agora = Date.now, fuso = 'America/Sao_Paulo', persistir = true } = {}) {
  let estado = null;
  let chaves = 0;

  function atual() {
    const dia = diaLocal(agora(), fuso);
    if (!estado) {
      const salvo = persistir ? lerJson(arquivo) : null;
      estado = salvo && salvo.dia === dia && salvo.contagens ? salvo : { dia, contagens: {} };
      chaves = Object.values(estado.contagens).reduce((s, g) => s + Object.keys(g).length, 0);
    }
    if (estado.dia !== dia) {
      estado = { dia, contagens: {} };
      chaves = 0;
    }
    return estado;
  }

  function gravar() {
    if (!persistir) return;
    try {
      gravarJsonAtomico(arquivo, estado);
    } catch (e) {
      console.warn('[tetos] não consegui gravar:', e.message);
    }
  }

  /** Quanto já foi usado hoje. */
  function uso(grupo, chave = '*') {
    return atual().contagens[grupo]?.[chave] || 0;
  }

  /** Conta uma tentativa; true = ainda dentro do teto (a tentativa que estoura conta). */
  function contar(grupo, chave = '*', max = Infinity) {
    const e = atual();
    const g = (e.contagens[grupo] ||= {});
    if (!(chave in g)) {
      if (chaves >= MAX_CHAVES) return true; // flood de chaves novas: não registra (o teto global continua valendo)
      chaves++;
    }
    g[chave] = (g[chave] || 0) + 1;
    gravar();
    return g[chave] <= max;
  }

  return { contar, uso, dia: () => atual().dia };
}
