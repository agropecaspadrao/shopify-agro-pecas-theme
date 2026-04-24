/**
 * Cria/atualiza as políticas da loja no Shopify via GraphQL Admin API
 *
 * Uso: node util/criar-politicas.js
 */

const SHOP          = process.env.SHOPIFY_SHOP;
const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Configure SHOPIFY_SHOP, SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET');
  process.exit(1);
}

const GQL = `https://${SHOP}.myshopify.com/admin/api/2025-01/graphql.json`;

const STORE = {
  name:     'APP Agro Peças Padrão',
  cnpj:     '66.316.831/0001-85',
  address:  'R. José Benedito Cottolengo, 901 — Casa 19, Cond. Jardim de Monet, Campo Comprido, Curitiba – PR, CEP 81.220-310',
  phone:    '(41) 9833-3338',
  whatsapp: '(41) 99721-7541',
  email:    'comercial@agropecaspadrao.com.br',
};

const TODAY = new Date().toLocaleDateString('pt-BR');

// ─── POLÍTICAS ───────────────────────────────────────────────────────────────

const PRIVACY = `
<h1>Política de Privacidade</h1>
<p><em>Última atualização: ${TODAY}</em></p>

<p>${STORE.name}, inscrita no CNPJ ${STORE.cnpj}, com endereço em ${STORE.address}, é responsável pelo tratamento dos seus dados pessoais conforme esta política e a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).</p>

<h2>1. Dados que coletamos</h2>
<ul>
  <li><strong>Dados de cadastro:</strong> nome, CPF/CNPJ, e-mail, telefone e endereço informados no pedido.</li>
  <li><strong>Dados de navegação:</strong> endereço IP, dispositivo, páginas acessadas e tempo de sessão, coletados via cookies e Google Analytics 4.</li>
  <li><strong>Dados de comunicação:</strong> mensagens enviadas via formulário de contato ou WhatsApp.</li>
</ul>

<h2>2. Finalidade do tratamento</h2>
<ul>
  <li>Processar e entregar pedidos.</li>
  <li>Emitir nota fiscal e cumprir obrigações fiscais e contábeis.</li>
  <li>Prestar suporte técnico e pós-venda.</li>
  <li>Enviar atualizações sobre o pedido (status, rastreamento).</li>
  <li>Melhorar a experiência de navegação e identificar falhas no site.</li>
  <li>Cumprir obrigações legais e regulatórias.</li>
</ul>

<h2>3. Compartilhamento de dados</h2>
<p>Seus dados podem ser compartilhados com:</p>
<ul>
  <li><strong>Transportadoras parceiras</strong> — exclusivamente para entrega do pedido.</li>
  <li><strong>Shopify Inc.</strong> — plataforma de e-commerce que hospeda nossa loja.</li>
  <li><strong>Órgãos públicos</strong> — quando exigido por lei.</li>
</ul>
<p>Não vendemos nem alugamos seus dados a terceiros para fins comerciais.</p>

<h2>4. Cookies</h2>
<p>Utilizamos cookies essenciais (necessários para o funcionamento da loja) e cookies analíticos (Google Analytics 4). Você pode desativar cookies analíticos nas configurações do seu navegador sem prejuízo à navegação.</p>

<h2>5. Seus direitos (LGPD)</h2>
<p>Você tem direito a confirmar a existência do tratamento, acessar, corrigir ou excluir seus dados, revogar consentimento, solicitar portabilidade e ser informado sobre compartilhamentos. Para exercer seus direitos, entre em contato pelo e-mail <a href="mailto:${STORE.email}">${STORE.email}</a> ou WhatsApp ${STORE.whatsapp}. Responderemos em até 15 dias úteis.</p>

<h2>6. Segurança e retenção</h2>
<p>Adotamos medidas técnicas e administrativas para proteger seus dados. As transações são processadas com criptografia SSL. Mantemos seus dados pelo prazo necessário para cumprir as finalidades descritas e as obrigações legais (mínimo de 5 anos para fins fiscais).</p>

<h2>7. Contato</h2>
<p>${STORE.name} · CNPJ: ${STORE.cnpj}<br>
${STORE.address}<br>
E-mail: <a href="mailto:${STORE.email}">${STORE.email}</a> · Tel: ${STORE.phone}</p>
`.trim();

const REFUND = `
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

<h2>4. Como solicitar</h2>
<ol>
  <li>Entre em contato pelo e-mail <a href="mailto:${STORE.email}">${STORE.email}</a> ou WhatsApp ${STORE.whatsapp} informando número do pedido e motivo.</li>
  <li>Aguarde aprovação e instruções de envio (até 3 dias úteis).</li>
  <li>Envie o produto conforme orientação.</li>
  <li>Após recebimento e análise, processaremos o reembolso ou troca em até 10 dias úteis.</li>
</ol>

<h2>5. Reembolso e frete</h2>
<p>O reembolso será feito pelo mesmo meio de pagamento utilizado na compra. O frete de devolução é por nossa conta em caso de defeito de fabricação ou erro nosso; por conta do cliente em caso de arrependimento.</p>
`.trim();

const TERMS = `
<h1>Termos de Serviço</h1>
<p><em>Última atualização: ${TODAY}</em></p>

<p>Ao realizar uma compra na ${STORE.name} você concorda com os termos abaixo.</p>

<h2>1. Sobre a empresa</h2>
<p>${STORE.name}, CNPJ ${STORE.cnpj}, é distribuidora de peças hidráulicas e sensores agrícolas da marca LIVENZA, com certificação ISO 9001 / 14001 / 18001, para equipamentos John Deere, New Holland, Massey Ferguson, Valtra e Valmet.</p>

<h2>2. Produtos e disponibilidade</h2>
<p>Todos os produtos estão sujeitos à disponibilidade de estoque. Em caso de indisponibilidade após confirmação do pedido, entraremos em contato para oferecer alternativas ou reembolso integral. As especificações técnicas (SKU, referência OEM) são as informações determinantes para compatibilidade.</p>

<h2>3. Preços e pagamento</h2>
<p>Preços em Reais (BRL) com impostos inclusos. Aceitamos cartão de crédito, boleto e Pix conforme disponível no checkout.</p>

<h2>4. Responsabilidade técnica</h2>
<p>A instalação das peças é responsabilidade do comprador. Recomendamos que seja realizada por profissional habilitado. Não nos responsabilizamos por danos decorrentes de instalação incorreta ou uso incompatível.</p>

<h2>5. Propriedade intelectual</h2>
<p>Todo o conteúdo deste site (textos, imagens, logotipos, descrições técnicas) é propriedade da ${STORE.name} ou de seus fornecedores e está protegido por direitos autorais. É proibida a reprodução sem autorização prévia.</p>

<h2>6. Foro</h2>
<p>Fica eleito o foro da Comarca de Curitiba – PR, com renúncia a qualquer outro por mais privilegiado que seja.</p>

<h2>7. Contato</h2>
<p>E-mail: <a href="mailto:${STORE.email}">${STORE.email}</a> · WhatsApp: ${STORE.whatsapp} · Tel: ${STORE.phone}</p>
`.trim();

const SHIPPING = `
<h1>Política de Envio</h1>
<p><em>Última atualização: ${TODAY}</em></p>

<h2>1. Área de entrega</h2>
<p>Realizamos entregas para todo o território nacional, despachando de Curitiba – PR.</p>

<h2>2. Prazo de despacho</h2>
<p>Os pedidos são preparados e despachados em até <strong>2 dias úteis</strong> após a confirmação do pagamento.</p>

<h2>3. Estimativa de entrega após despacho</h2>
<ul>
  <li><strong>Curitiba e Região Metropolitana:</strong> 1 a 3 dias úteis</li>
  <li><strong>Sul e Sudeste:</strong> 3 a 7 dias úteis</li>
  <li><strong>Centro-Oeste e Nordeste:</strong> 5 a 10 dias úteis</li>
  <li><strong>Norte:</strong> 7 a 15 dias úteis</li>
</ul>
<p>Esses prazos são estimativas e podem variar por fatores externos (greves, clima, pico de demanda).</p>

<h2>4. Prazo de garantia</h2>
<p>O prazo para reclamação de defeitos de fabricação é de até <strong>90 (noventa) dias</strong> a contar da <strong>data de faturamento</strong> da nota fiscal.</p>

<h2>5. Rastreamento</h2>
<p>Após o despacho, você receberá por e-mail o código de rastreamento. Em caso de dúvidas, entre em contato pelo WhatsApp ${STORE.whatsapp}.</p>

<h2>6. Frete</h2>
<p>Calculado automaticamente no checkout com base no CEP e peso do pedido. Promoções de frete grátis são anunciadas no site.</p>

<h2>7. Problemas na entrega</h2>
<p>Em caso de produto errado, avariado ou não entregue no prazo, entre em contato pelo e-mail <a href="mailto:${STORE.email}">${STORE.email}</a> ou WhatsApp ${STORE.whatsapp}. Resolveremos em até 5 dias úteis.</p>
`.trim();

const LEGAL = `
<h1>Aviso Legal</h1>
<p><em>Última atualização: ${TODAY}</em></p>

<h2>Identificação da empresa</h2>
<p>
  <strong>${STORE.name}</strong><br>
  CNPJ: ${STORE.cnpj}<br>
  ${STORE.address}<br>
  Tel: ${STORE.phone} · WhatsApp: ${STORE.whatsapp}<br>
  E-mail: <a href="mailto:${STORE.email}">${STORE.email}</a>
</p>

<h2>Natureza da atividade</h2>
<p>Distribuição e comercialização de peças hidráulicas (bombas, motores, cilindros) e sensores agrícolas (sensores de fluxo e sementes) para máquinas das marcas John Deere, New Holland, Massey Ferguson, Valtra e Valmet.</p>

<h2>Marca e certificação</h2>
<p>Os produtos comercializados são fabricados pela LIVENZA sob certificações ISO 9001, ISO 14001 e ISO 18001. ${STORE.name} atua como distribuidora autorizada.</p>

<h2>Limitação de responsabilidade</h2>
<p>As informações técnicas são fornecidas de boa-fé com base nos catálogos dos fabricantes. Recomendamos confirmar a compatibilidade com um técnico especializado antes da instalação. Não nos responsabilizamos por danos resultantes de instalação inadequada ou incompatibilidade não comunicada previamente.</p>

<h2>Legislação aplicável</h2>
<p>Este site e as relações de consumo são regidos pela legislação brasileira, em especial o Código de Defesa do Consumidor (Lei nº 8.078/1990) e a LGPD (Lei nº 13.709/2018).</p>
`.trim();

// ─── API ─────────────────────────────────────────────────────────────────────

async function getToken() {
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
  if (!data.access_token) { console.error('Erro token:', data); process.exit(1); }
  return data.access_token;
}

async function gql(token, query, variables = {}) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function setPolicy(token, type, body) {
  const mutation = `
    mutation shopPolicyUpdate($shopPolicy: ShopPolicyInput!) {
      shopPolicyUpdate(shopPolicy: $shopPolicy) {
        userErrors { field message }
        shopPolicy { type }
      }
    }
  `;
  const result = await gql(token, mutation, { shopPolicy: { type, body } });

  const errors = result?.data?.shopPolicyUpdate?.userErrors;
  if (errors && errors.length > 0) {
    console.error(`  ✗ Erro em ${type}:`, JSON.stringify(errors));
  } else if (result.errors) {
    console.error(`  ✗ GraphQL error em ${type}:`, JSON.stringify(result.errors));
  } else {
    console.log(`  ✓ ${type}`);
  }
}

async function main() {
  console.log('🔐 Obtendo token...');
  const token = await getToken();

  console.log('📋 Atualizando políticas...');

  // Tipos aceitos pela API: PRIVACY_POLICY, REFUND_POLICY, TERMS_OF_SERVICE, SHIPPING_POLICY, LEGAL_NOTICE, SUBSCRIPTION_POLICY, CONTACT_INFORMATION
  await setPolicy(token, 'PRIVACY_POLICY',    PRIVACY);
  await setPolicy(token, 'REFUND_POLICY',     REFUND);
  await setPolicy(token, 'TERMS_OF_SERVICE',  TERMS);
  await setPolicy(token, 'SHIPPING_POLICY',   SHIPPING);
  await setPolicy(token, 'LEGAL_NOTICE',      LEGAL);

  console.log('\n✅ Políticas atualizadas com sucesso!');
  console.log('   Acesse: Admin > Configurações > Políticas');
}

main();
