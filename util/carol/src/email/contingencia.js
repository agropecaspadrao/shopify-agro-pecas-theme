// Contingência de entrega: tenta o e-mail; se todos os provedores falharem e
// houver administradores cadastrados, entrega o mesmo conteúdo pelo WhatsApp
// deles, fatiado, com um cabeçalho dizendo que é contingência. Usado pelos
// relatórios e pela palavra-chave. As anomalias têm lógica própria.

import { config } from '../config.js';
import { enviar as enviarEmailPadrao } from './transporte.js';
import { fatiar } from '../util/texto.js';
import { reportarAnomalia as reportarPadrao } from '../alertas/anomalias.js';

/**
 * @param {{para:string[], assunto:string, texto:string}} msg
 * @param {{enviarEmail?:Function, enviarWhatsApp?:Function, admins?:string[], permitirWhatsApp?:boolean}} deps
 * @returns {{canal:'email'|'whatsapp'|'nenhum', erroEmail?:string, entreguesWhatsApp?:number}}
 */
export async function enviarOuContingencia(msg, deps = {}) {
  const enviarEmail = deps.enviarEmail || enviarEmailPadrao;
  const admins = deps.admins || config.admins;
  let erroEmail = '';
  try {
    await enviarEmail(msg);
    return { canal: 'email' };
  } catch (e) {
    erroEmail = String(e.message || e).slice(0, 300);
    console.warn(`[contingencia] e-mail falhou (${msg.assunto}): ${erroEmail}`);
    const reportar = deps.reportarAnomalia || reportarPadrao;
    reportar({ tipo: 'email_falha', detalhe: `"${msg.assunto}" não saiu por e-mail: ${erroEmail}` }).catch(() => {});
  }
  if (deps.permitirWhatsApp === false || !admins.length) return { canal: 'nenhum', erroEmail };

  const enviarWhatsApp = deps.enviarWhatsApp || (async (n, t) => {
    const { enviarTexto } = await import('../whatsapp.js');
    return enviarTexto(n, t);
  });
  const partes = fatiar(`*${msg.assunto}*\n_(contingencia: e-mail indisponivel, entregue pelo WhatsApp)_\n\n${msg.texto}`);
  let entregues = 0;
  for (const numero of admins) {
    try {
      for (const p of partes) await enviarWhatsApp(numero, p);
      entregues++;
    } catch (e) {
      console.warn(`[contingencia] WhatsApp para ${numero} falhou: ${e.message}`);
    }
  }
  return { canal: entregues ? 'whatsapp' : 'nenhum', erroEmail, entreguesWhatsApp: entregues };
}
