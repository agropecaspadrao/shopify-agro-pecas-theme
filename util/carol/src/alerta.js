// Alerta de saldo baixo do crédito Anthropic (tipo anthropic_saldo_baixo) e
// de saldo desatualizado (anthropic_saldo_desatualizado: o gasto passou da
// base e a API segue aceitando; sem isso o alerta de saldo baixo ficaria mudo
// para sempre). Passa pela central de anomalias (deduplicação por tipo).

import { config } from './config.js';
import { saldoEstimado } from './custos.js';
import { reportarAnomalia as reportarPadrao } from './alertas/anomalias.js';

function usd(v) {
  return 'US$ ' + v.toFixed(2).replace('.', ',');
}

export async function verificarSaldoBaixo({ reportarAnomalia = reportarPadrao } = {}) {
  const saldo = saldoEstimado();
  if (!saldo) return;
  if (saldo.desatualizado) {
    // Sem base válida o alerta de saldo baixo não funciona: avisa (1x a cada 24h)
    await reportarAnomalia({
      tipo: 'anthropic_saldo_desatualizado',
      detalhe: `Gasto registrado desde ${new Date(saldo.desde).toLocaleDateString('pt-BR', { timeZone: config.timezone })}: ${usd(saldo.gasto)}, acima da base de ${usd(saldo.credito)}. A API segue aceitando, então houve recarga não informada.`,
    });
    return;
  }
  if (saldo.restante > config.alertaSaldoUsd) return;
  await reportarAnomalia({
    tipo: 'anthropic_saldo_baixo',
    titulo: `Saldo de créditos da Anthropic baixo (${usd(saldo.restante)} restantes)`,
    detalhe: `Saldo estimado ${usd(saldo.restante)}, abaixo do limite de aviso de ${usd(config.alertaSaldoUsd)}. Quando chegar a zero a Carol para de responder. Este valor é estimado pelo registro de uso; o oficial está em console.anthropic.com.`,
  });
}
