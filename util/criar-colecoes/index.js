import { URLSearchParams } from 'node:url';

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('Variáveis de ambiente não configuradas no .env');
}

let token = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;

  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }
  );

  if (!response.ok) throw new Error(`Falha ao obter token: ${response.status}`);
  const { access_token, expires_in } = await response.json();
  token = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  return token;
}

async function criarColecao(nome) {
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2025-01/custom_collections.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': await getToken(),
      },
      body: JSON.stringify({ custom_collection: { title: nome } }),
    }
  );

  const data = await response.json();
  if (data.custom_collection) {
    console.log(`✅ Criada: ${data.custom_collection.title}`);
  } else {
    console.error(`❌ Erro: ${JSON.stringify(data)}`);
  }
}

const colecoes = [
  'Bombas Hidráulicas',
  'Peças Plásticas Injetadas',
  'Sensores Agrícolas',
];

(async () => {
  for (const c of colecoes) await criarColecao(c);
})();
