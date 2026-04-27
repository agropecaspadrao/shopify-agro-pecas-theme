#!/usr/bin/env node
/**
 * Faz upload do logo e logo branco para a loja via Shopify Admin GraphQL API
 * e atualiza as configurações do tema ativo com os IDs das imagens.
 *
 * Uso:
 *   node util/upload-logo.js
 *
 * Requer: util/criar-colecoes/.env com SHOPIFY_SHOP / CLIENT_ID / CLIENT_SECRET
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── Carregar .env ────────────────────────────────────────────────────────────
const envPath = resolve(__dirname, 'criar-colecoes/.env');
const env     = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => l.split('=').map(s => s.trim()))
);

const SHOP          = env.SHOPIFY_SHOP;          // ex: agro-pecas-padrao-2
const CLIENT_ID     = env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = env.SHOPIFY_CLIENT_SECRET;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌  Variáveis faltando no .env');
  process.exit(1);
}

const GQL = `https://${SHOP}.myshopify.com/admin/api/2025-01/graphql.json`;

// ── Logos a enviar ────────────────────────────────────────────────────────────
const LOGOS = [
  {
    label:    'Logo principal (sem fundo)',
    filePath: resolve(ROOT, 'assets/APP - LOGO - SEM FUNDO V3.svg'),
    mimeType: 'image/svg+xml',
    alt:      'APP Agro Peças Padrão — Logo oficial',
    settingKey: 'logo',
  },
  {
    label:    'Logo branca',
    filePath: resolve(ROOT, 'assets/logo-branca.png'),
    mimeType: 'image/png',
    alt:      'APP Agro Peças Padrão — Logo branca',
    settingKey: 'logo_white',
  },
];

// ── Auth ─────────────────────────────────────────────────────────────────────
let _token;
async function getToken() {
  if (_token) return _token;
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) { console.error('❌  Erro ao obter token:', data); process.exit(1); }
  _token = data.access_token;
  return _token;
}

async function gql(query, variables = {}) {
  const token = await getToken();
  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      'Content-Type':          'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// ── Staged upload → criar file no Shopify ────────────────────────────────────
async function uploadFile(logo) {
  const fileBytes = readFileSync(logo.filePath);
  const fileSize  = fileBytes.byteLength.toString();

  // 1. Pedir URL de staged upload
  const stageRes = await gql(`
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `, {
    input: [{
      resource:   'FILE',
      filename:   logo.filePath.split('/').pop(),
      mimeType:   logo.mimeType,
      fileSize,
      httpMethod: 'PUT',
    }],
  });

  const target = stageRes?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) {
    console.error('❌  stagedUploadsCreate falhou:', JSON.stringify(stageRes));
    return null;
  }

  // 2. Fazer PUT direto no URL staged
  const putRes = await fetch(target.url, {
    method:  'PUT',
    headers: { 'Content-Type': logo.mimeType, 'Content-Length': fileSize },
    body:    fileBytes,
  });
  if (!putRes.ok) {
    console.error(`❌  PUT falhou: ${putRes.status} ${putRes.statusText}`);
    return null;
  }

  // 3. Criar o File no Shopify Files
  const createRes = await gql(`
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          alt
          ... on MediaImage { image { url } }
          ... on GenericFile { url }
        }
        userErrors { field message }
      }
    }
  `, {
    files: [{
      originalSource: target.resourceUrl,
      alt:            logo.alt,
      contentType:    'IMAGE',
    }],
  });

  const file = createRes?.data?.fileCreate?.files?.[0];
  const errs = createRes?.data?.fileCreate?.userErrors;
  if (errs?.length) { console.error('❌  fileCreate errors:', errs); return null; }
  return file;
}

// ── Atualizar settings do tema ativo ─────────────────────────────────────────
async function getActiveThemeId() {
  const token = await getToken();
  const res = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2025-01/themes.json`,
    { headers: { 'X-Shopify-Access-Token': token } }
  );
  const { themes } = await res.json();
  return themes.find(t => t.role === 'main')?.id;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n🌿  APP Agro Peças Padrão — Upload de Logos\n');

  const uploaded = {};

  for (const logo of LOGOS) {
    process.stdout.write(`  ⏳  ${logo.label} … `);
    const file = await uploadFile(logo);
    if (file) {
      const url = file?.image?.url || file?.url || '';
      console.log(`✅  ${url}`);
      uploaded[logo.settingKey] = { id: file.id, url };
    } else {
      console.log('❌  falhou');
    }
  }

  if (Object.keys(uploaded).length === 0) {
    console.log('\n⚠️   Nenhum arquivo enviado com sucesso.\n');
    return;
  }

  console.log('\n📋  Logos enviados para Shopify Files:');
  for (const [key, val] of Object.entries(uploaded)) {
    console.log(`  settings.${key} → ${val.url}`);
  }

  console.log('\n💡  Próximo passo:');
  console.log('    Acesse Shopify Admin → Online Store → Themes → Customize → Logo');
  console.log('    e selecione as imagens enviadas — ou use a API de Theme Settings.\n');

  // Informar IDs para referência
  console.log('📎  IDs Shopify para referência:');
  for (const [key, val] of Object.entries(uploaded)) {
    console.log(`    ${key}: ${val.id}`);
  }
  console.log('');
}

run().catch(err => { console.error('Erro:', err); process.exit(1); });
