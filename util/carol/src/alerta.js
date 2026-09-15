// Alerta de saldo baixo do crédito Anthropic. Passa pela central de
// anomalias (tipo anthropic_saldo_baixo, severidade média, no máximo um
// aviso a cada 24h pela deduplicação padrão).

import { config } from './config.js';
import { saldoEstimado } from './custos.js';
import { reportarAnomalia } from './alertas/anomalias.js';

function usd(v) {
  return 'US$ ' + v.toFixed(2).replace('.', ',');
}

export async function verificarSaldoBaixo() {
  const saldo = saldoEstimado();
  if (!saldo || saldo.restante > config.alertaSaldoUsd) return;
  await reportarAnomalia({
    tipo: 'anthropic_saldo_baixo',
    titulo: `Saldo de créditos da Anthropic baixo (${usd(saldo.restante)} restantes)`,
    detalhe: `Saldo estimado ${usd(saldo.restante)}, abaixo do limite de aviso de ${usd(config.alertaSaldoUsd)}. Quando chegar a zero a Carol para de responder. Este valor é estimado pelo registro de uso; o oficial está em console.anthropic.com.`,
  });
}
