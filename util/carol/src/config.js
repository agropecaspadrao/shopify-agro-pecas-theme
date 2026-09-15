import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

// Ordem de carga: .env local do serviço (Railway usa variáveis de ambiente
// direto), depois o .env global da raiz do repositório (padrão dos utilitários).
dotenv.config({ path: path.join(here, '..', '.env') });
dotenv.config({ path: path.join(here, '..', '..', '..', '.env') });

export const config = {
  port: Number(process.env.PORT || 3333),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CAROL_MODEL || 'claude-opus-4-8',

  // WhatsApp Cloud API
  waPhoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
  waAccessToken: process.env.WA_ACCESS_TOKEN || process.env.META_SYSTEM_USER_TOKEN || '',
  waVerifyToken: process.env.WA_VERIFY_TOKEN || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  graphVersion: process.env.GRAPH_VERSION || 'v21.0',

  // Loja
  shopUrl: process.env.CAROL_SHOP_URL || 'https://agropecaspadrao.com.br',

  // Transcrição de áudio do WhatsApp (Groq Whisper, tem camada gratuita)
  groqApiKey: process.env.GROQ_API_KEY || '',

  // Cotação US$ → R$ usada só para EXIBIÇÃO estimada no dashboard de custos
  usdBrl: Number(process.env.CAROL_USD_BRL || 5.6),

  // Crédito carregado na conta Anthropic (para o saldo ESTIMADO do dashboard):
  // valor em US$ e data em que foi carregado (ISO, ex: 2026-07-25)
  creditoUsd: Number(process.env.CAROL_CREDITO_USD || 0),
  creditoDesde: process.env.CAROL_CREDITO_DESDE || '',

  // Alerta por e-mail quando o saldo estimado ficar abaixo deste valor (US$)
  alertaSaldoUsd: Number(process.env.CAROL_ALERTA_SALDO_USD || 0.5),

  // CORS do widget do site (separar múltiplas origens por vírgula)
  allowedOrigins: (process.env.CAROL_ALLOWED_ORIGINS ||
    'https://agropecaspadrao.com.br,https://www.agropecaspadrao.com.br,https://agropecaspadrao-2.myshopify.com')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Horário comercial (fuso de Brasília): seg-sex, 8h às 18h
  timezone: 'America/Sao_Paulo',
  businessHourStart: Number(process.env.CAROL_HORA_INICIO || 8),
  businessHourEnd: Number(process.env.CAROL_HORA_FIM || 18),

  // ── E-mail (transporte HTTP; SMTP fica só de reserva porque o Railway
  //    bloqueia portas SMTP de saída em qualquer plano) ─────────────────────
  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    brevoApiKey: process.env.BREVO_API_KEY || '',
    de: process.env.EMAIL_FROM || process.env.SMTP_USER || 'carol@agropecaspadrao.com.br',
    nomeDe: process.env.EMAIL_FROM_NAME || 'Carol - Agro Peças Padrão',
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: Number(process.env.SMTP_PORT || 465),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
  },

  // Destinatários. Relatório operacional (Dai), relatório executivo (sócios)
  // e alertas de anomalia ("Urgente Carol").
  destinatarios: {
    dai: lista(process.env.REPORT_TO, 'comercial@agropecaspadrao.com.br'),
    socios: lista(process.env.SOCIOS_EMAILS, 'socios@agropecaspadrao.com.br,admin@agropecaspadrao.com.br'),
    alertas: lista(process.env.ALERTA_EMAILS, 'admin@agropecaspadrao.com.br,socios@agropecaspadrao.com.br'),
  },

  // Números de WhatsApp (formato 5541999999999) autorizados a usar comandos
  // "/carol" e a receber alertas por WhatsApp quando o e-mail falhar.
  admins: lista(process.env.CAROL_ADMINS, ''),

  // Token reserva do WhatsApp: se o principal expirar, a Carol troca sozinha
  // (auto-recovery) e avisa. Use um token permanente (System User sem
  // expiração ou token de Página) diferente do principal.
  waAccessTokenFallback: process.env.WA_ACCESS_TOKEN_FALLBACK || '',

  // ── Verificações de saúde (agente supervisor) ─────────────────────────────
  saude: {
    intervaloMin: Number(process.env.SAUDE_INTERVALO_MIN || 30),
    // Token de página/usuário da Meta (Ads + validade) — opcional
    metaAccessToken: process.env.META_ACCESS_TOKEN || '',
    metaAdAccountId: process.env.META_AD_ACCOUNT_ID || '',
    // Google Ads (só valida o refresh token) — opcional
    googleClientId: process.env.GOOGLE_ADS_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
    googleRefreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
    // Conta de serviço do Google (JSON ou base64) com leitura da master no Drive — opcional
    googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
    masterDriveFileId: process.env.MASTER_DRIVE_FILE_ID || '1FoyfpY5E4Z4dYcEk7hiP2Jrg_dts6teu',
    // Inventário do Shopify considerado "parado" depois de N dias sem edição
    inventarioDiasAlerta: Number(process.env.INVENTARIO_DIAS_ALERTA || 30),
  },

  // ── Agenda (horários em Brasília) ─────────────────────────────────────────
  agenda: {
    relatorioDaiHora: Number(process.env.RELATORIO_DAI_HORA || 8),
    relatorioSociosHora: Number(process.env.RELATORIO_SOCIOS_HORA || 8),
    relatorioSociosMinuto: Number(process.env.RELATORIO_SOCIOS_MINUTO || 5),
    chaveDiaSemana: Number(process.env.CHAVE_DIA_SEMANA || 1), // 1 = segunda
    chaveHora: Number(process.env.CHAVE_HORA || 7),
    chaveMinuto: Number(process.env.CHAVE_MINUTO || 55),
    // Tarefa perdida (serviço fora do ar na hora) ainda roda se atrasar menos que isto
    janelaRecuperacaoHoras: Number(process.env.AGENDA_JANELA_RECUPERACAO_H || 6),
  },
};

function lista(valor, padrao) {
  return String(valor ?? padrao ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Troca o token do WhatsApp em tempo de execução (auto-recovery). */
export function definirTokenWhatsApp(token) {
  config.waAccessToken = token;
}

/** Quais recursos opcionais estão configurados — usado no boot e no /admin/saude. */
export function recursosConfigurados() {
  return {
    emailHttp: Boolean(config.email.resendApiKey || config.email.brevoApiKey),
    emailSmtp: Boolean(config.email.smtpUser && config.email.smtpPass),
    admins: config.admins.length,
    tokenReservaWhatsApp: Boolean(config.waAccessTokenFallback),
    metaAds: Boolean(config.saude.metaAccessToken && config.saude.metaAdAccountId),
    googleAds: Boolean(config.saude.googleClientId && config.saude.googleClientSecret && config.saude.googleRefreshToken),
    masterDrive: Boolean(config.saude.googleServiceAccountJson),
  };
}

export function validarConfig({ exigirWhatsApp = false } = {}) {
  const faltando = [];
  if (!config.anthropicApiKey) faltando.push('ANTHROPIC_API_KEY');
  if (exigirWhatsApp) {
    if (!config.waPhoneNumberId) faltando.push('WA_PHONE_NUMBER_ID');
    if (!config.waAccessToken) faltando.push('WA_ACCESS_TOKEN (ou META_SYSTEM_USER_TOKEN)');
    if (!config.waVerifyToken) faltando.push('WA_VERIFY_TOKEN');
  }
  return faltando;
}
