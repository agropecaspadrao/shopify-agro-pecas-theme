#!/usr/bin/env node
/**
 * Cria os metacampos do namespace "agro" usados pelo tema nos produtos.
 *
 * Metacampos criados (product):
 *   agro.sku_livenza        — SKU oficial LIVENZA (single_line_text_field)
 *   agro.part_number        — Referência OEM / part number (single_line_text_field)
 *   agro.specs              — Especificações técnicas (pipe-separated "Label:Valor") (multi_line_text_field)
 *   agro.application        — Aplicação / uso (pipe-separated) (multi_line_text_field)
 *   agro.compatibility      — Compatibilidade com máquinas (pipe-separated) (multi_line_text_field)
 *   agro.ficha_tecnica      — URL do PDF da ficha técnica (url)
 *
 * Metacampos criados (shop / marca):
 *   brand.logo_url          — URL pública do logo principal (url)
 *   brand.logo_white_url    — URL do logo versão branca (url)
 *   brand.primary_color     — Cor primária hex (single_line_text_field)
 *   brand.accent_color      — Cor de destaque hex (single_line_text_field)
 *   brand.tagline           — Tagline principal da marca (single_line_text_field)
 *   brand.distributor       — Nome do distribuidor oficial (single_line_text_field)
 *   brand.iso_cert          — Certificações ISO (single_line_text_field)
 *
 * Uso:
 *   node criar-metacampos.js <ACCESS_TOKEN>
 *
 * Como obter o ACCESS_TOKEN:
 *   1. Shopify Admin → Settings → Apps and sales channels → Develop apps
 *   2. Create an app → nomeie "CLI Setup"
 *   3. Configure Admin API scopes: write_metaobjects, write_products, read_products
 *   4. Install app → copie o "Admin API access token"
 *   5. Execute: node criar-metacampos.js shpat_xxxxxxxxxxxx
 */

const STORE = 'agro-pecas-padrao-2.myshopify.com';
const TOKEN = process.argv[2];

if (!TOKEN) {
  console.error('❌  Passe o access token como argumento:');
  console.error('   node criar-metacampos.js shpat_xxxxxxxxxxxx');
  process.exit(1);
}

const API_URL = `https://${STORE}/admin/api/2024-10/metafield_definitions.json`;

const headers = {
  'Content-Type': 'application/json',
  'X-Shopify-Access-Token': TOKEN,
};

// ─── Definições ──────────────────────────────────────────────────────────────

const productMetafields = [
  {
    name: 'SKU Livenza',
    namespace: 'agro',
    key: 'sku_livenza',
    type: 'single_line_text_field',
    description: 'SKU oficial do produto na linha LIVENZA (ex: 5.0220.0548824-2). Exibido como código principal na PDP.',
    ownerType: 'PRODUCT',
  },
  {
    name: 'Referência OEM / Part Number',
    namespace: 'agro',
    key: 'part_number',
    type: 'single_line_text_field',
    description: 'Referência do fabricante original (OEM). Ex: FONN600BB, 82983657. Exibida na seção de códigos da PDP.',
    ownerType: 'PRODUCT',
  },
  {
    name: 'Especificações Técnicas',
    namespace: 'agro',
    key: 'specs',
    type: 'multi_line_text_field',
    description: 'Especificações técnicas separadas por pipe. Formato: "Caudal Bomba I: 22,5 l/min|Deslocamento: 32 cm³/rev|Sentido de Giro: Esquerdo"',
    ownerType: 'PRODUCT',
  },
  {
    name: 'Aplicação',
    namespace: 'agro',
    key: 'application',
    type: 'multi_line_text_field',
    description: 'Lista de aplicações do produto separadas por pipe. Ex: "Sistema hidráulico|Sistema de direção|Levante traseiro"',
    ownerType: 'PRODUCT',
  },
  {
    name: 'Compatibilidade',
    namespace: 'agro',
    key: 'compatibility',
    type: 'multi_line_text_field',
    description: 'Máquinas e modelos compatíveis separados por pipe. Ex: "VALTRA BH160|NEW HOLLAND T6.110|FORD 7610"',
    ownerType: 'PRODUCT',
  },
  {
    name: 'Ficha Técnica (PDF)',
    namespace: 'agro',
    key: 'ficha_tecnica',
    type: 'url',
    description: 'URL pública do PDF com ficha técnica LIVENZA do produto. Exibida na aba Documentos da PDP.',
    ownerType: 'PRODUCT',
  },
];

const shopMetafields = [
  {
    name: 'Logo Principal (URL)',
    namespace: 'brand',
    key: 'logo_url',
    type: 'url',
    description: 'URL do logo principal da marca APP Agro Peças Padrão (com fundo transparente).',
    ownerType: 'SHOP',
  },
  {
    name: 'Logo Branco (URL)',
    namespace: 'brand',
    key: 'logo_white_url',
    type: 'url',
    description: 'URL do logo versão branca para uso em fundos escuros.',
    ownerType: 'SHOP',
  },
  {
    name: 'Cor Primária',
    namespace: 'brand',
    key: 'primary_color',
    type: 'single_line_text_field',
    description: 'Cor primária da marca em hexadecimal. Padrão: #1B5E20 (Verde Floresta).',
    ownerType: 'SHOP',
  },
  {
    name: 'Cor de Destaque',
    namespace: 'brand',
    key: 'accent_color',
    type: 'single_line_text_field',
    description: 'Cor de destaque (accent) em hexadecimal. Padrão: #F57F17 (Âmbar).',
    ownerType: 'SHOP',
  },
  {
    name: 'Tagline',
    namespace: 'brand',
    key: 'tagline',
    type: 'single_line_text_field',
    description: 'Tagline principal da marca. Ex: Peças originais. Entrega ágil. Confiança de verdade.',
    ownerType: 'SHOP',
  },
  {
    name: 'Distribuidor Oficial',
    namespace: 'brand',
    key: 'distributor',
    type: 'single_line_text_field',
    description: 'Nome do distribuidor/marca principal. Ex: LIVENZA.',
    ownerType: 'SHOP',
  },
  {
    name: 'Certificações ISO',
    namespace: 'brand',
    key: 'iso_cert',
    type: 'single_line_text_field',
    description: 'Certificações ISO da linha de produtos. Ex: ISO 9001, ISO 14001, ISO 18001.',
    ownerType: 'SHOP',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createMetafieldDefinition(def) {
  const body = {
    metafield_definition: {
      name: def.name,
      namespace: def.namespace,
      key: def.key,
      type: def.type,
      description: def.description,
      owner_type: def.ownerType,
    },
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (res.ok) {
    console.log(`  ✅  ${def.ownerType} · ${def.namespace}.${def.key}`);
  } else {
    const msg = data?.errors || data?.error || JSON.stringify(data);
    // Já existe = aviso, não erro
    if (JSON.stringify(msg).includes('already')) {
      console.log(`  ⚠️   ${def.ownerType} · ${def.namespace}.${def.key} — já existe, pulando`);
    } else {
      console.error(`  ❌  ${def.ownerType} · ${def.namespace}.${def.key} — ${JSON.stringify(msg)}`);
    }
  }
}

async function run() {
  console.log('\n🌿  APP Agro Peças Padrão — Criando metacampos\n');

  console.log('📦  Metacampos de Produto (namespace: agro)');
  for (const def of productMetafields) {
    await createMetafieldDefinition(def);
  }

  console.log('\n🏷️   Metacampos da Loja (namespace: brand)');
  for (const def of shopMetafields) {
    await createMetafieldDefinition(def);
  }

  console.log('\n✔   Concluído. Acesse Shopify Admin → Settings → Custom data para confirmar.\n');
  console.log('💡  Dica: Para preencher os metacampos nos produtos, acesse cada produto no');
  console.log('    Admin → Products → [produto] → Metafields (seção no final da página).\n');
}

run().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
