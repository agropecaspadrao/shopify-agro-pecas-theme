// Ações de recuperação automática. Cada uma recebe o resultado de um
// verificador em falha e tenta resolver sem intervenção humana. Devolve
// { recuperou: boolean, descricao } para o supervisor registrar e avisar.
//
// Regra de ouro: só recuperar o que é seguro e reversível. Trocar token por
// um reserva já validado é seguro; "reiniciar" algo às cegas não é.

import { config, definirTokenWhatsApp } from '../config.js';
import { carregarCatalogo } from '../catalogo.js';
import { verificarWhatsApp } from './verificadores.js';

/** WhatsApp: se o token principal falhou, valida e ativa o token reserva. */
export async function recuperarWhatsApp(resultado, deps = {}) {
  const reserva = deps.tokenReserva ?? config.waAccessTokenFallback;
  if (!reserva || reserva === config.waAccessToken) {
    return { recuperou: false, descricao: 'sem token reserva configurado (WA_ACCESS_TOKEN_FALLBACK)' };
  }
  const teste = await verificarWhatsApp({ ...deps, token: reserva });
  if (teste.estado === 'falha') {
    return { recuperou: false, descricao: `token reserva também inválido: ${teste.resumo}` };
  }
  definirTokenWhatsApp(reserva);
  console.warn('[recuperacao] token do WhatsApp trocado pelo reserva em tempo de execução');
  return {
    recuperou: true,
    descricao: 'Token principal do WhatsApp inválido. Ativei o token reserva (WA_ACCESS_TOKEN_FALLBACK) e a Carol voltou a responder. Atualize WA_ACCESS_TOKEN no Railway com um token permanente para não depender do reserva.',
  };
}

/** Catálogo: recarrega com até 3 tentativas e espera crescente. */
export async function recuperarCatalogo(_resultado, deps = {}) {
  const carregar = deps.carregarCatalogo || carregarCatalogo;
  const esperar = deps.esperar || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let ultimoErro = '';
  for (let i = 1; i <= 3; i++) {
    try {
      await carregar({ forcar: true });
      return { recuperou: true, descricao: `catálogo recarregado na tentativa ${i}` };
    } catch (e) {
      ultimoErro = e.message;
      await esperar(2000 * i);
    }
  }
  return { recuperou: false, descricao: `catálogo não recarregou após 3 tentativas: ${ultimoErro}. Seguindo com a última cópia em memória.` };
}

/** Mapa verificador → ação de recuperação. O que não está aqui só alerta. */
export const RECUPERACOES = {
  whatsapp: recuperarWhatsApp,
  catalogo: recuperarCatalogo,
};
