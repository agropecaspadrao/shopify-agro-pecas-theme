/**
 * Atualiza preços e zera estoque dos produtos via Shopify Admin GraphQL API
 *
 * Fonte: planilha "Lista de aplicações completa_revisada" — coluna "Preço"
 * Lógica: zerar inventário (estoque = 0) para forçar venda apenas via cotação/WhatsApp
 *
 * Uso:
 *   SHOPIFY_SHOP=agropecas-padrao-2 \
 *   SHOPIFY_CLIENT_ID=xxx \
 *   SHOPIFY_CLIENT_SECRET=xxx \
 *   node util/atualizar-precos.js
 */

const SHOP          = process.env.SHOPIFY_SHOP;
const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Configure SHOPIFY_SHOP, SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET');
  process.exit(1);
}

const GQL = `https://${SHOP}.myshopify.com/admin/api/2025-01/graphql.json`;

// ── PREÇOS DA PLANILHA ─────────────────────────────────────────────────────
// Formato: { codigoReduzido: precoEmCentavos }
// Extraído da coluna "Preço comercial para o site" da planilha fornecida
const PRICE_MAP = {
  // AGCO
  '680005':  72454,
  '565122':  119000,
  '565120':  89244,
  // AGCO - Massey Ferguson
  '548836':  133000,
  '548817':  111700,
  '565053':  144100,
  // AGCO - Valtra
  '548824':  111500,
  '548917':  121000,
  'L026997': 113500,
  '547201':  78000,
  '547202':  128500,
  // Agrale / Valtra
  '547205':  127100,
  // Case
  'L026234': 176500,
  // Case / New Holland
  'L011190': 57420,
  // CNH
  '548911':  97900,
  'L026819': 75500,
  'L026849': 95000,
  'L027018': 88000,
  '565055':  278000,
  '565054':  95000,
  '565008':  129900,
  '565017':  129900,
  '565004':  170400,
  '565001':  386300,
  '565002':  186500,
  '565035':  80500,
  '565029':  252338,
  'L026250': 72500,
  'L026780': 51700,
  // John Deere
  '670036':  120443,
  '670037':  178750,
  '670038':  151470,
  '670039':  172370,
  '670040':  173000,
  '565077':  215000,
  '565071':  137390,
  '565094':  620000,
  '565036':  153600,
  '565032':  129900,
  '565115':  86000,
  // Maxxion / Massey Ferguson
  '565086':  164500,
  '565087':  164500,
  '565088':  164500,
  '565089':  129900,
  'L027041': 90530,
  '547207':  118910,
  '547216':  188500,
  '547844':  88900,
  '547820':  87000,
  '540803':  95000,
  // Valtra / Valmet
  'L025598': 76546,
  '547206':  122800,
};

// ── HELPERS ────────────────────────────────────────────────────────────────

let _token = null;

async function getToken() {
  if (_token) return _token;
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  _token = data.access_token;
  return _token;
}

async function gql(query, variables = {}) {
  const token = await getToken();
  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// Busca todos os produtos paginados
async function fetchAllProducts() {
  const products = [];
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const data = await gql(`
      query($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            variants(first: 5) {
              nodes {
                id
                sku
                price
                inventoryQuantity
                inventoryItem { id }
              }
            }
          }
        }
      }
    `, { cursor });

    const page = data.products;
    products.push(...page.nodes);
    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }
  return products;
}

// Busca o locationId padrão
async function getDefaultLocation() {
  const data = await gql(`{
    locations(first: 1) {
      nodes { id name }
    }
  }`);
  return data.locations.nodes[0]?.id;
}

// Atualiza preço de uma variante
async function updatePrice(variantId, price) {
  return gql(`
    mutation($input: ProductVariantInput!) {
      productVariantUpdate(input: $input) {
        productVariant { id price }
        userErrors { field message }
      }
    }
  `, {
    input: {
      id: variantId,
      price: (price / 100).toFixed(2),
    },
  });
}

// Zera estoque de um inventoryItem num location
async function zeroInventory(inventoryItemId, locationId) {
  return gql(`
    mutation($input: InventoryAdjustQuantityInput!) {
      inventoryAdjustQuantity(input: $input) {
        inventoryLevel { available }
        userErrors { field message }
      }
    }
  `, {
    input: {
      inventoryItemId,
      locationId,
      availableDelta: -9999,
    },
  });
}

// Extrai código reduzido do SKU (últimos 6 dígitos ou parte alfanumérica após ponto)
function extractReducedCode(sku) {
  if (!sku) return null;
  // Tenta padrão "5.XXXX.YYYYYY.0" → pega YYYYYY
  const m = sku.match(/5\.\d{4}\.([A-Z0-9]+)\.\d/i);
  if (m) return m[1];
  // Fallback: retorna o próprio SKU limpo
  return sku.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

// ── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔑 Autenticando...');
  await getToken();

  console.log('📦 Buscando produtos...');
  const products = await fetchAllProducts();
  console.log(`   ${products.length} produtos encontrados.`);

  console.log('📍 Buscando location...');
  const locationId = await getDefaultLocation();
  console.log(`   Location: ${locationId}`);

  let updated = 0;
  let zeroed = 0;
  let notFound = [];

  for (const product of products) {
    for (const variant of product.variants.nodes) {
      const code = extractReducedCode(variant.sku);
      const price = code ? (PRICE_MAP[code] ?? null) : null;

      if (price !== null) {
        // Atualiza preço
        const res = await updatePrice(variant.id, price);
        const errors = res.productVariantUpdate?.userErrors;
        if (errors?.length) {
          console.warn(`  ⚠️  ${product.title} — erro preço:`, errors);
        } else {
          console.log(`  ✅ ${product.title} (${code}) → R$ ${(price/100).toFixed(2)}`);
          updated++;
        }

        // Zera estoque
        if (variant.inventoryItem?.id && locationId) {
          if (variant.inventoryQuantity > 0) {
            const invRes = await zeroInventory(variant.inventoryItem.id, locationId);
            const invErr = invRes.inventoryAdjustQuantity?.userErrors;
            if (!invErr?.length) zeroed++;
          }
        }
      } else {
        notFound.push(`${product.title} (SKU: ${variant.sku}, code: ${code})`);
      }
    }
  }

  console.log('\n─────────────────────────────────────');
  console.log(`✅ Preços atualizados: ${updated}`);
  console.log(`🔢 Estoques zerados:   ${zeroed}`);
  if (notFound.length) {
    console.log(`\n⚠️  SKUs sem preço na planilha (${notFound.length}):`);
    notFound.forEach(s => console.log('   -', s));
  }
}

main().catch(err => { console.error('❌', err); process.exit(1); });
