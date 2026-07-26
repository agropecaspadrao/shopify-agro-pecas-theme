// Alerta de saldo baixo: quando o saldo estimado do crédito Anthropic cai
// abaixo de CAROL_ALERTA_SALDO_USD (padrão US$ 0,50), envia um e-mail de
// aviso. No máximo um aviso a cada 24h (marca persistida no volume de dados).

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { saldoEstimado } from './custos.js';
import { DATA_DIR } from './registro.js';
import { enviarEmail } from './relatorio.js';

const ARQUIVO_MARCA = path.join(DATA_DIR, 'alerta-saldo.json');
const INTERVALO_MS = 24 * 60 * 60 * 1000;

function usd(v) {
  return 'US$ ' + v.toFixed(2).replace('.', ',');
}

export async function verificarSaldoBaixo() {
  const saldo = saldoEstimado();
  if (!saldo || saldo.restante > config.alertaSaldoUsd) return;

  // no máximo um alerta por dia
  try {
    const marca = JSON.parse(fs.readFileSync(ARQUIVO_MARCA, 'utf8'));
    if (Date.now() - new Date(marca.ultimoEnvio).getTime() < INTERVALO_MS) return;
  } catch {}

  const assunto = `Carol: saldo de créditos baixo (${usd(saldo.restante)} restantes)`;
  const corpo = `Atenção!

O saldo estimado de créditos da Carol na Anthropic está em ${usd(saldo.restante)}, abaixo do limite de aviso de ${usd(config.alertaSaldoUsd)}.

Quando o saldo chegar a zero, a Carol para de responder clientes no WhatsApp e no site.

Para recarregar: https://console.anthropic.com/settings/billing (Comprar créditos). Depois da recarga, atualizar as variáveis CAROL_CREDITO_USD e CAROL_CREDITO_DESDE no Railway para o dashboard voltar a bater com o console.

Este é um valor estimado pelo registro de uso da própria Carol. O saldo oficial está no console da Anthropic.

Carol, atendente virtual`;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ARQUIVO_MARCA, JSON.stringify({ ultimoEnvio: new Date().toISOString() }));
    await enviarEmail(assunto, corpo);
  } catch (e) {
    console.warn('[alerta] saldo baixo detectado, mas o e-mail falhou:', e.message);
  }
}
