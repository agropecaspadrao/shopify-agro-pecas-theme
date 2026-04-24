/**
 * Sincroniza produtos Shopify:
 *  1. Faz upload da imagem local para cada produto (via SKU)
 *  2. Adiciona o produto à coleção correta
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const ASSETS_DIR = process.env.ASSETS_DIR;
const CSV_PATH = process.env.CSV_PATH;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET || !ASSETS_DIR || !CSV_PATH) {
  console.error('Variáveis necessárias: SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, ASSETS_DIR, CSV_PATH');
  process.exit(1);
}

const BASE_URL = `https://${SHOP}.myshopify.com/admin/api/2025-01`;

// ─── Auth ────────────────────────────────────────────────────────────────────

let _token = null;
let _tokenExpiresAt = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiresAt - 60_000) return _token;

  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) throw new Error(`Falha ao obter token: ${res.status} ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  _token = access_token;
  _tokenExpiresAt = Date.now() + expires_in * 1000;
  return _token;
}

async function headers(extra = {}) {
  return { 'X-Shopify-Access-Token': await getToken(), ...extra };
}

// ─── Helpers de API ──────────────────────────────────────────────────────────

async function getProductByHandle(handle) {
  const res = await fetch(`${BASE_URL}/products.json?handle=${handle}&fields=id,title,handle`, {
    headers: await headers(),
  });
  const { products } = await res.json();
  return products?.[0] ?? null;
}

async function getCollections() {
  const res = await fetch(`${BASE_URL}/custom_collections.json?fields=id,title,handle`, {
    headers: await headers(),
  });
  const { custom_collections } = await res.json();
  return custom_collections ?? [];
}

async function addProductToCollection(collectionId, productId) {
  const res = await fetch(`${BASE_URL}/collects.json`, {
    method: 'POST',
    headers: await headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ collect: { collection_id: collectionId, product_id: productId } }),
  });
  const data = await res.json();
  if (data.errors) {
    // ignora "já existe"
    const msg = JSON.stringify(data.errors);
    if (msg.includes('taken')) return 'ja_existe';
    throw new Error(msg);
  }
  return 'adicionado';
}

async function uploadImageToProduct(productId, imagePath, altText) {
  const imageBytes = readFileSync(imagePath);
  const base64 = imageBytes.toString('base64');
  const filename = parse(imagePath).base;

  const res = await fetch(`${BASE_URL}/products/${productId}/images.json`, {
    method: 'POST',
    headers: await headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      image: {
        attachment: base64,
        filename,
        alt: altText,
      },
    }),
  });

  const data = await res.json();
  if (data.image) return data.image.src;
  throw new Error(JSON.stringify(data.errors ?? data));
}

// ─── Mapeamento SKU → arquivo de imagem ──────────────────────────────────────

function buildSkuToImageMap(assetsDir) {
  const files = readdirSync(assetsDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
  const map = {};

  for (const file of files) {
    // extrai o código numérico do nome do arquivo
    // ex: "Livenza_5.0220.0547201-CT_REV._0_p1.png" → "5.0220.0547201"
    // ex: "5.1301.0565008_p1.png"                  → "5.1301.0565008"
    // ex: "sensor_SFLX2.jpg"                        → "SFLX2"
    const match = file.match(/(\d\.\d{4}\.\d{7}(?:-\d)?)|SFLX2|PUL-?2/i);
    if (match) {
      const key = match[0].toUpperCase();
      // prefere p1 sobre p2
      if (!map[key] || file.includes('_p1')) {
        map[key] = join(assetsDir, file);
      }
    }
  }

  return map;
}

// ─── Parse CSV simples ───────────────────────────────────────────────────────

function parseCSV(csvPath) {
  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ─── Mapeamento Type → handle da coleção ─────────────────────────────────────

const TYPE_TO_COLLECTION_HANDLE = {
  'Bombas Hidráulicas': 'bombas-hidraulicas',
  'Sensores Agrícolas': 'sensores-agricolas',
  'Peças Plásticas Injetadas': 'pecas-plasticas-injetadas',
};

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n📦  Carregando dados...\n');

  const rows = parseCSV(CSV_PATH);
  const skuToImage = buildSkuToImageMap(ASSETS_DIR);
  const collections = await getCollections();

  const collectionByHandle = Object.fromEntries(collections.map(c => [c.handle, c]));

  console.log(`   Produtos no CSV : ${rows.length}`);
  console.log(`   Imagens mapeadas: ${Object.keys(skuToImage).length}`);
  console.log(`   Coleções na loja: ${collections.map(c => c.title).join(', ')}\n`);

  for (const row of rows) {
    const handle = row['Handle'];
    const sku = row['Variant SKU']?.toUpperCase();
    const type = row['Type'];
    const title = row['Title'];

    if (!handle) continue;

    process.stdout.write(`🔍  ${title}... `);

    const product = await getProductByHandle(handle);
    if (!product) {
      console.log('❌ não encontrado na Shopify');
      continue;
    }

    // 1. Upload de imagem
    const imagePath = skuToImage[sku];
    if (imagePath) {
      try {
        await uploadImageToProduct(product.id, imagePath, title);
        process.stdout.write('🖼️  imagem ok | ');
      } catch (e) {
        process.stdout.write(`⚠️  imagem erro (${e.message.slice(0, 40)}) | `);
      }
    } else {
      process.stdout.write('📷 sem imagem | ');
    }

    // 2. Categorizar na coleção
    const colHandle = TYPE_TO_COLLECTION_HANDLE[type];
    const collection = colHandle ? collectionByHandle[colHandle] : null;

    if (collection) {
      try {
        const status = await addProductToCollection(collection.id, product.id);
        console.log(`📂  ${status === 'ja_existe' ? 'já na coleção' : `adicionado a "${collection.title}"`}`);
      } catch (e) {
        console.log(`❌  erro coleção: ${e.message.slice(0, 60)}`);
      }
    } else {
      console.log(`⚠️  tipo "${type}" sem coleção mapeada`);
    }

    // respeita rate limit Shopify (2 req/s)
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n✨  Concluído!\n');
})();
