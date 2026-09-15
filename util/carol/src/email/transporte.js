// Transporte de e-mail com cadeia de provedores.
//
// Ordem: Resend (HTTPS) → Brevo (HTTPS) → SMTP (nodemailer). O Railway bloqueia
// portas SMTP de saída em todos os planos, então em produção só os provedores
// HTTP funcionam; o SMTP fica como reserva para desenvolvimento local.
//
// Contrato: enviar({ para, assunto, texto }) resolve com { provedor, id } ou
// lança um Error agregando a falha de cada provedor tentado. Quem chama decide
// o que fazer (o módulo de anomalias cai para WhatsApp, por exemplo).

import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { DATA_DIR } from '../registro.js';

const ARQUIVO_MARCA = path.join(DATA_DIR, 'email-ultimo.json');

/** Lista de provedores disponíveis, na ordem de tentativa. */
export function provedoresDisponiveis(cfg = config.email) {
  const lista = [];
  if (cfg.resendApiKey) lista.push('resend');
  if (cfg.brevoApiKey) lista.push('brevo');
  if (cfg.smtpUser && cfg.smtpPass) lista.push('smtp');
  return lista;
}

async function viaResend({ para, assunto, texto }, cfg, fetchFn) {
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: `${cfg.nomeDe} <${cfg.de}>`, to: para, subject: assunto, text: texto }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const corpo = await res.json().catch(() => ({}));
  return { provedor: 'resend', id: corpo.id || null };
}

async function viaBrevo({ para, assunto, texto }, cfg, fetchFn) {
  const res = await fetchFn('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': cfg.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: cfg.de, name: cfg.nomeDe },
      to: para.map((email) => ({ email })),
      subject: assunto,
      textContent: texto,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const corpo = await res.json().catch(() => ({}));
  return { provedor: 'brevo', id: corpo.messageId || null };
}

async function viaSmtp({ para, assunto, texto }, cfg) {
  const { default: nodemailer } = await import('nodemailer');
  // Sem rota IPv6 de saída no Railway: conecta pelo IPv4 e valida o TLS pelo hostname.
  let host = cfg.smtpHost;
  try {
    [host] = await dns.resolve4(cfg.smtpHost);
  } catch {}
  const transporte = nodemailer.createTransport({
    host,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    tls: { servername: cfg.smtpHost },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });
  const info = await transporte.sendMail({
    from: `"${cfg.nomeDe}" <${cfg.smtpUser}>`,
    to: para.join(', '),
    subject: assunto,
    text: texto,
  });
  return { provedor: 'smtp', id: info.messageId || null };
}

const PROVEDORES = { resend: viaResend, brevo: viaBrevo, smtp: viaSmtp };

function normalizarDestinatarios(para) {
  const lista = (Array.isArray(para) ? para : String(para || '').split(','))
    .map((s) => String(s).trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  return [...new Set(lista)];
}

/**
 * Envia um e-mail tentando cada provedor configurado, na ordem.
 * @param {{para:string|string[], assunto:string, texto:string}} msg
 * @param {{cfg?:object, fetchFn?:Function, provedores?:string[]}} deps injeção para testes
 */
export async function enviar(msg, deps = {}) {
  const cfg = deps.cfg || config.email;
  const fetchFn = deps.fetchFn || fetch;
  const para = normalizarDestinatarios(msg.para);
  if (!para.length) throw new Error('e-mail sem destinatário válido');
  if (!msg.assunto || !msg.texto) throw new Error('e-mail sem assunto ou corpo');

  const ordem = deps.provedores || provedoresDisponiveis(cfg);
  if (!ordem.length) throw new Error('nenhum provedor de e-mail configurado (RESEND_API_KEY, BREVO_API_KEY ou SMTP_USER/SMTP_PASS)');

  const falhas = [];
  for (const nome of ordem) {
    try {
      const r = await PROVEDORES[nome]({ ...msg, para }, cfg, fetchFn);
      registrarSucesso(nome, msg.assunto);
      console.log(`[email] enviado via ${nome} para ${para.join(', ')}: ${msg.assunto}`);
      return r;
    } catch (e) {
      falhas.push(`${nome}: ${e.message}`);
      console.warn(`[email] ${nome} falhou: ${e.message}`);
    }
  }
  const erro = new Error(`todos os provedores falharam: ${falhas.join(' | ')}`);
  erro.falhas = falhas;
  throw erro;
}

function registrarSucesso(provedor, assunto) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ARQUIVO_MARCA, JSON.stringify({ ts: new Date().toISOString(), provedor, assunto }));
  } catch {}
}

/** Último envio bem-sucedido (para o painel de saúde). */
export function ultimoEnvio() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_MARCA, 'utf8'));
  } catch {
    return null;
  }
}
