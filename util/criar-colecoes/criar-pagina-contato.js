/**
 * Cria (ou garante que exista) a página "Contato" no Shopify
 * com handle "contato" e template "page.contact"
 */

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Configure SHOPIFY_SHOP, SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET no .env');
  process.exit(1);
}

const BASE = `https://${SHOP}.myshopify.com/admin/api/2025-01`;

async function getToken() {
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const { access_token } = await res.json();
  return access_token;
}

(async () => {
  const token = await getToken();
  const h = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

  // Verificar se já existe
  const listRes = await fetch(`${BASE}/pages.json?handle=contato`, { headers: h });
  const { pages, errors: listErr } = await listRes.json();

  if (listErr) {
    console.error('❌ Sem permissão para acessar páginas.');
    console.error('   No Shopify Admin → Settings → Apps → seu app → Admin API access scopes');
    console.error('   Adicione: read_content, write_content');
    process.exit(1);
  }

  if (pages?.length > 0) {
    const p = pages[0];
    // Garantir template correto
    if (p.template_suffix !== 'contact') {
      const upd = await fetch(`${BASE}/pages/${p.id}.json`, {
        method: 'PUT',
        headers: h,
        body: JSON.stringify({ page: { id: p.id, template_suffix: 'contact' } }),
      });
      const { page } = await upd.json();
      console.log(`✅ Página já existia — template atualizado para "page.contact"`);
      console.log(`   URL: https://${SHOP}.myshopify.com/pages/${page.handle}`);
    } else {
      console.log(`✅ Página "Contato" já existe e está correta.`);
      console.log(`   URL: https://${SHOP}.myshopify.com/pages/${p.handle}`);
    }
    return;
  }

  // Criar
  const createRes = await fetch(`${BASE}/pages.json`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      page: {
        title: 'Contato',
        handle: 'contato',
        body_html: '<p>Entre em contato com nossa equipe comercial.</p>',
        template_suffix: 'contact',
        published: true,
      },
    }),
  });

  const { page, errors } = await createRes.json();

  if (errors) {
    console.error('❌ Erro ao criar página:', JSON.stringify(errors));
    process.exit(1);
  }

  console.log(`✅ Página criada: "${page.title}"`);
  console.log(`   Handle   : ${page.handle}`);
  console.log(`   Template : page.${page.template_suffix}`);
  console.log(`   URL      : https://${SHOP}.myshopify.com/pages/${page.handle}`);
})();
