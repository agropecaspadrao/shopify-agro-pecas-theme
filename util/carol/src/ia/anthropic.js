// Cliente único da API da Anthropic (atendimento, relatórios e memória).
// Timeout de 60 s e uma única nova tentativa: o cliente do WhatsApp não pode
// ficar minutos esperando, e a contingência cobre o resto.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export const TIMEOUT_MS = 60000;
export const MAX_RETRIES = 1;

let cliente = null;
let fabricaTeste = null;

export function clienteAnthropic() {
  if (fabricaTeste) return fabricaTeste();
  if (!cliente) cliente = new Anthropic({ apiKey: config.anthropicApiKey, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });
  return cliente;
}

/** Só para testes: troca o cliente por um falso (null volta ao real). */
export function definirClienteAnthropic(falso) {
  fabricaTeste = falso ? () => falso : null;
}
