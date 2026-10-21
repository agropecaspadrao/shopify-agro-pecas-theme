// Limite de uso por chave em janela fixa (anti-abuso / controle de custo).
// Devolve uma função `(chave) => boolean` (true = dentro do limite) que conta
// a tentativa. `.uso(chave)` consulta sem contar, para o painel mostrar
// quanto do teto já foi consumido.

export function criarLimite(max, janelaMs, { agora = Date.now } = {}) {
  const mapa = new Map(); // chave -> { n, inicio }
  const fn = (chave) => {
    const t = agora();
    let reg = mapa.get(chave);
    if (!reg || t - reg.inicio > janelaMs) {
      reg = { n: 0, inicio: t };
      mapa.set(chave, reg);
    }
    reg.n++;
    if (mapa.size > 50000) mapa.clear(); // proteção de memória contra flood de chaves
    return reg.n <= max;
  };
  fn.max = max;
  fn.uso = (chave) => {
    const reg = mapa.get(chave);
    if (!reg || agora() - reg.inicio > janelaMs) return 0;
    return reg.n;
  };
  fn.limpar = (chave) => mapa.delete(chave);
  return fn;
}
