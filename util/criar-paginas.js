/**
 * Cria/atualiza páginas do site no Shopify via GraphQL Admin API
 * Uso: node util/criar-paginas.js
 */

const SHOP          = process.env.SHOPIFY_SHOP;
const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Configure SHOPIFY_SHOP, SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET');
  process.exit(1);
}

const GQL   = `https://${SHOP}.myshopify.com/admin/api/2025-01/graphql.json`;
const TODAY = new Date().toLocaleDateString('pt-BR');

const STORE = {
  name:     'APP Agro Peças Padrão',
  cnpj:     '66.316.831/0001-85',
  address:  'R. José Benedito Cottolengo, 901 — Casa 19, Cond. Jardim de Monet, Campo Comprido, Curitiba – PR, CEP 81.220-310',
  phone:    '(41) 9833-3338',
  whatsapp: '5541983333338',
  email:    'comercial@agropecaspadrao.com.br',
};

// ─── CONTEÚDO DAS PÁGINAS ────────────────────────────────────────────────────

const PAGES = [
  {
    title:    'Quem Somos Nós',
    handle:   'quem-somos',
    template: 'page.quem-somos',
    body:     `<p>Conteúdo gerenciado pelo template <strong>page.quem-somos</strong>.</p>`,
  },
  {
    title:  'Política de Devolução',
    handle: 'politica-de-devolucao',
    body: `
<h1>Política de Devolução e Reembolso</h1>
<p><em>Última atualização: ${TODAY}</em></p>

<h2>1. Direito de arrependimento</h2>
<p>Compras pela internet podem ser canceladas em até <strong>7 dias corridos</strong> a partir do recebimento do produto, sem necessidade de justificativa (art. 49 do CDC — Lei nº 8.078/1990). O produto deve ser devolvido na embalagem original, sem uso e sem avarias.</p>

<h2>2. Prazo para reclamação de defeitos</h2>
<p>Produtos com defeito de fabricação podem ser reclamados em até <strong>90 (noventa) dias</strong> a contar da <strong>data de faturamento</strong> constante na nota fiscal (art. 26, II do CDC). Em caso de defeito comprovado, providenciaremos a troca ou reembolso integral.</p>

<h2>3. Condições para devolução</h2>
<ul>
  <li>Produto na embalagem original, sem sinais de uso indevido ou instalação incorreta.</li>
  <li>Nota fiscal de compra.</li>
  <li>Descrição detalhada do defeito ou motivo da devolução.</li>
</ul>
<p><strong>Não são aceitas devoluções</strong> de peças com danos por mau uso, instalação incorreta, fluido inadequado ou desgaste natural.</p>

<h2>4. Como solicitar a devolução</h2>
<ol>
  <li>Entre em contato pelo e-mail <a href="mailto:${STORE.email}">${STORE.email}</a> ou WhatsApp <a href="https://wa.me/${STORE.whatsapp}">${STORE.phone}</a> informando número do pedido e motivo.</li>
  <li>Aguarde aprovação e instruções de envio (até 3 dias úteis).</li>
  <li>Envie o produto conforme orientação recebida.</li>
  <li>Após recebimento e análise técnica, processaremos o reembolso ou troca em até 10 dias úteis.</li>
</ol>

<h2>5. Reembolso e frete de retorno</h2>
<p>O reembolso será feito pelo mesmo meio de pagamento utilizado na compra. O frete de devolução é por <strong>nossa conta</strong> em caso de defeito de fabricação ou erro nosso; por conta do <strong>cliente</strong> em caso de arrependimento.</p>

<h2>6. Contato</h2>
<p>${STORE.name} · CNPJ: ${STORE.cnpj}<br>
${STORE.address}<br>
E-mail: <a href="mailto:${STORE.email}">${STORE.email}</a> · Tel: ${STORE.phone}</p>
    `.trim(),
  },
  {
    title:  'Política de Envio',
    handle: 'politica-de-envio',
    body: `
<h1>Política de Envio</h1>
<p><em>Última atualização: ${TODAY}</em></p>

<h2>1. Área de entrega</h2>
<p>Realizamos entregas para todo o território nacional, despachando de Curitiba – PR.</p>

<h2>2. Prazo de despacho</h2>
<p>Os pedidos são preparados e despachados em até <strong>2 dias úteis</strong> após a confirmação do pagamento.</p>

<h2>3. Estimativa de entrega após o despacho</h2>
<ul>
  <li><strong>Curitiba e Região Metropolitana:</strong> 1 a 3 dias úteis</li>
  <li><strong>Sul e Sudeste:</strong> 3 a 7 dias úteis</li>
  <li><strong>Centro-Oeste e Nordeste:</strong> 5 a 10 dias úteis</li>
  <li><strong>Norte:</strong> 7 a 15 dias úteis</li>
</ul>
<p>Esses prazos são estimativas e podem variar por fatores externos (greves, condições climáticas, pico de demanda).</p>

<h2>4. Rastreamento</h2>
<p>Após o despacho, você receberá por e-mail o código de rastreamento dos Correios ou da transportadora. Em caso de dúvidas, entre em contato pelo WhatsApp <a href="https://wa.me/${STORE.whatsapp}">${STORE.phone}</a>.</p>

<h2>5. Frete</h2>
<p>Calculado automaticamente no checkout com base no CEP de entrega e peso total do pedido. Promoções de frete grátis são anunciadas em destaque no site.</p>

<h2>6. Produtos frágeis e volumosos</h2>
<p>Bombas hidráulicas e componentes de maior porte são embalados com material anti-impacto e fita de segurança. Ao receber, verifique a integridade da embalagem antes de assinar o recebimento.</p>

<h2>7. Problemas na entrega</h2>
<p>Em caso de produto errado, avariado em trânsito ou não entregue no prazo estimado, entre em contato:<br>
E-mail: <a href="mailto:${STORE.email}">${STORE.email}</a><br>
WhatsApp: <a href="https://wa.me/${STORE.whatsapp}">${STORE.phone}</a><br>
Resolveremos em até 5 dias úteis.</p>

<h2>8. Contato</h2>
<p>${STORE.name} · CNPJ: ${STORE.cnpj}<br>
${STORE.address}<br>
E-mail: <a href="mailto:${STORE.email}">${STORE.email}</a> · Tel: ${STORE.phone}</p>
    `.trim(),
  },
];

// ─── API ─────────────────────────────────────────────────────────────────────

async function getToken() {
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) { console.error('Erro token:', data); process.exit(1); }
  return data.access_token;
}

async function gql(token, query, variables = {}) {
  const res = await fetch(GQL, {
    method:  'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function findPageByHandle(token, handle) {
  const query = `
    query($handle: String!) {
      pageByHandle(handle: $handle) {
        id title handle
      }
    }
  `;
  const result = await gql(token, query, { handle });
  return result?.data?.pageByHandle ?? null;
}

async function createPage(token, page) {
  const mutation = `
    mutation pageCreate($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page { id title handle }
        userErrors { field message }
      }
    }
  `;
  const input = {
    title:           page.title,
    handle:          page.handle,
    body:            page.body,
    isPublished:     true,
    templateSuffix:  page.template ? page.template.replace(/^page\./, '') : null,
  };
  // Remove null fields
  Object.keys(input).forEach(k => input[k] == null && delete input[k]);

  const result = await gql(token, mutation, { page: input });
  const errors = result?.data?.pageCreate?.userErrors;
  if (errors && errors.length) {
    console.error(`  ✗ Erro criando "${page.title}":`, JSON.stringify(errors));
    return null;
  }
  return result?.data?.pageCreate?.page;
}

async function updatePage(token, id, page) {
  const mutation = `
    mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
      pageUpdate(id: $id, page: $page) {
        page { id title handle }
        userErrors { field message }
      }
    }
  `;
  const input = {
    title:           page.title,
    body:            page.body,
    isPublished:     true,
    templateSuffix:  page.template ? page.template.replace(/^page\./, '') : null,
  };
  Object.keys(input).forEach(k => input[k] == null && delete input[k]);

  const result = await gql(token, mutation, { id, page: input });
  const errors = result?.data?.pageUpdate?.userErrors;
  if (errors && errors.length) {
    console.error(`  ✗ Erro atualizando "${page.title}":`, JSON.stringify(errors));
    return null;
  }
  return result?.data?.pageUpdate?.page;
}

async function main() {
  console.log('🔐 Obtendo token...');
  const token = await getToken();

  console.log('\n📄 Criando/atualizando páginas...\n');

  for (const page of PAGES) {
    process.stdout.write(`  → ${page.title} (/${page.handle})... `);
    const existing = await findPageByHandle(token, page.handle);

    let result;
    if (existing) {
      result = await updatePage(token, existing.id, page);
      if (result) console.log(`atualizada ✓`);
    } else {
      result = await createPage(token, page);
      if (result) console.log(`criada ✓`);
    }
  }

  console.log('\n✅ Páginas concluídas!');
  console.log('   Acesse: Admin > Loja Online > Páginas');
}

main();
