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
};

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
