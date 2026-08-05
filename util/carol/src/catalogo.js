import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPECS_PATH = path.join(here, '..', 'knowledge', 'specs.json');

const REFRESH_MS = 30 * 60 * 1000; // 30 min, mesmo TTL do índice de busca do site

let produtos = [];        // itens normalizados
let porCodigo = new Map(); // código normalizado -> produto
let indiceTexto = '';      // listagem compacta injetada no system prompt
let specsPorSku = new Map();
let ultimaCarga = 0;

const normalizar = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizarCodigo = (s) => normalizar(s).replace(/\s+/g, '');

function limparHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function precoBRL(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function carregarSpecs() {
  try {
    const bruto = JSON.parse(fs.readFileSync(SPECS_PATH, 'utf8'));
    specsPorSku = new Map(Object.entries(bruto));
    console.log(`[catalogo] specs técnicas carregadas: ${specsPorSku.size} SKUs`);
  } catch {
    specsPorSku = new Map();
    console.warn('[catalogo] knowledge/specs.json não encontrado (rode: npm run conhecimento). Seguindo sem specs extras.');
  }
}

function buscarSpecs(skus) {
  for (const sku of skus) {
    const chave = normalizarCodigo(sku);
    if (specsPorSku.has(chave)) return specsPorSku.get(chave);
  }
  return null;
}

async function baixarProdutos() {
  const todos = [];
  for (let page = 1; page <= 6; page++) {
    const url = `${config.shopUrl}/products.json?limit=250&page=${page}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Falha ao baixar catálogo (${res.status}) em ${url}`);
    const { products = [] } = await res.json();
    todos.push(...products);
    if (products.length < 250) break;
  }
  return todos;
}

export async function carregarCatalogo({ forcar = false } = {}) {
  if (!forcar && produtos.length && Date.now() - ultimaCarga < REFRESH_MS) return;
  carregarSpecs();

  const brutos = await baixarProdutos();
  const itens = [];
  const mapa = new Map();

  for (const p of brutos) {
    const variantes = p.variants || [];
    const skus = variantes.map((v) => v.sku).filter(Boolean);
    const barcodes = variantes.map((v) => v.barcode).filter(Boolean);
    const disponivel = variantes.some((v) => v.available !== false);
    const precos = variantes.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
    const specs = buscarSpecs(skus);

    const item = {
      variantes: variantes.map((v) => ({
        id: v.id,
        sku: v.sku || '',
        disponivel: v.available !== false,
        preco: Number(v.price),
      })),
      handle: p.handle,
      titulo: p.title,
      url: `${config.shopUrl}/products/${p.handle}`,
      tipo: p.product_type || '',
      vendor: p.vendor || '',
      tags: p.tags || [],
      skus,
      barcodes,
      codigosEquivalentes: specs?.especificacoes?.codigos_equivalentes || [],
      disponivel,
      preco: precos.length ? precoBRL(Math.min(...precos)) : null,
      descricao: limparHtml(p.body_html).slice(0, 900),
      specs,
    };
    itens.push(item);

    for (const cod of [...skus, ...barcodes, ...item.codigosEquivalentes, p.handle]) {
      const chave = normalizarCodigo(cod);
      if (chave && !mapa.has(chave)) mapa.set(chave, item);
    }
  }

  produtos = itens;
  porCodigo = mapa;
  indiceTexto = itens
    .map((i) => {
      const cod = i.skus[0] || i.handle;
      const preco = i.disponivel && i.preco ? i.preco : 'Sob Consulta';
      return `- ${cod} | ${i.titulo} | ${preco}`;
    })
    .join('\n');
  ultimaCarga = Date.now();
  console.log(`[catalogo] catálogo carregado: ${itens.length} produtos`);
}

export function catalogoResumo() {
  return indiceTexto;
}

function detalheParaTexto(i) {
  const linhas = [
    `Produto: ${i.titulo}`,
    `Código (SKU): ${i.skus.join(', ') || '-'}`,
    i.codigosEquivalentes.length ? `Códigos equivalentes/cruzados: ${i.codigosEquivalentes.join(', ')}` : null,
    `Situação: ${i.disponivel ? `Em estoque | Preço: ${i.preco || 'consultar no site'}` : 'Sob Consulta (sem estoque no momento; a equipe confirma prazo e valor)'}`,
    i.tipo ? `Categoria: ${i.tipo}` : null,
    `Link: ${i.url}`,
    i.descricao ? `Descrição: ${i.descricao}` : null,
  ];
  const s = i.specs;
  if (s) {
    if (s.funcao) linhas.push(`Função: ${s.funcao}`);
    if (s.descricao_tecnica) linhas.push(`Detalhes técnicos: ${s.descricao_tecnica}`);
    if (s.especificacoes) {
      const esp = Object.entries(s.especificacoes)
        .filter(([k]) => k !== 'codigos_equivalentes')
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('; ');
      if (esp) linhas.push(`Especificações: ${esp}`);
    }
    if (Array.isArray(s.compatibilidade) && s.compatibilidade.length) {
      linhas.push(`Compatível com: ${s.compatibilidade.join('; ')}`);
    }
  }
  return linhas.filter(Boolean).join('\n');
}

export function detalharProduto(consulta) {
  const chave = normalizarCodigo(consulta);
  if (chave && porCodigo.has(chave)) return detalheParaTexto(porCodigo.get(chave));

  // fallback: melhor correspondência por título
  const resultados = buscarProdutos(consulta, 1);
  if (resultados.length) return detalheParaTexto(resultados[0]);
  return 'Nenhum produto encontrado com esse código ou nome. Se o cliente já passou um código, foto ou modelo de máquina que você não reconhece, avise que vai encaminhar ao setor técnico e que a Dai entra em contato o mais rápido possível no horário comercial. Senão, peça código da peça ou foto, sem narrar a busca.';
}

export function buscarProdutos(termos, limite = 5) {
  const tokens = normalizar(termos).split(' ').filter((t) => t.length > 1);
  if (!tokens.length) return [];
  const pontuados = produtos
    .map((i) => {
      const alvo = normalizar(
        [i.titulo, i.tipo, i.vendor, i.tags.join(' '), i.skus.join(' '), i.codigosEquivalentes.join(' '), i.descricao,
          i.specs?.funcao, (i.specs?.compatibilidade || []).join(' ')].join(' ')
      );
      const alvoCompacto = alvo.replace(/\s+/g, '');
      let pontos = 0;
      for (const t of tokens) {
        if (alvo.includes(` ${t} `) || alvo.startsWith(`${t} `) || alvo.endsWith(` ${t}`)) pontos += 3;
        else if (alvoCompacto.includes(t)) pontos += 1;
      }
      const codigoDigitado = normalizarCodigo(termos);
      if (codigoDigitado.length >= 4 && [...i.skus, ...i.barcodes, ...i.codigosEquivalentes].some((c) => normalizarCodigo(c) === codigoDigitado)) {
        pontos += 50;
      }
      return { i, pontos };
    })
    .filter((r) => r.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite);
  return pontuados.map((r) => r.i);
}

/**
 * Monta o link de carrinho pré-carregado do Shopify (/cart/{variant_id}:{qtd},...)
 * a partir de códigos/nomes de produto e quantidades. Retorna texto pronto para
 * a Carol usar: link quando possível, avisos quando algum item não entrar.
 */
export function montarLinkCarrinho(itens) {
  if (!Array.isArray(itens) || !itens.length) {
    return 'Nenhum item informado. Informe pelo menos um produto (código ou nome) e a quantidade.';
  }

  const pares = [];
  const incluidos = [];
  const problemas = [];

  for (const pedido of itens) {
    const consulta = String(pedido?.codigo || '').trim();
    const qtd = Math.max(1, Math.floor(Number(pedido?.quantidade) || 1));
    if (!consulta) continue;

    const chave = normalizarCodigo(consulta);
    let produto = chave ? porCodigo.get(chave) : null;
    if (!produto) {
      // Fallback por nome, mas só com correspondência forte: todos os termos
      // precisam aparecer no título. Produto errado no carrinho é pior que
      // pedir o código de novo.
      const candidato = buscarProdutos(consulta, 1)[0];
      if (candidato) {
        const titulo = normalizar(candidato.titulo).replace(/\s+/g, '');
        const tokens = normalizar(consulta).split(' ').filter(Boolean);
        if (tokens.length && tokens.every((t) => titulo.includes(t))) produto = candidato;
      }
    }
    if (!produto) {
      problemas.push(`- "${consulta}": não encontrado no catálogo. Confirme o código com o cliente antes de montar o link.`);
      continue;
    }

    // Prioriza a variante cujo SKU bate com o código pedido; senão, a primeira disponível.
    const porSku = produto.variantes.find((v) => normalizarCodigo(v.sku) === chave && v.disponivel);
    const variante = porSku || produto.variantes.find((v) => v.disponivel);
    if (!variante) {
      problemas.push(`- ${produto.titulo} (${produto.skus[0] || produto.handle}): Sob Consulta, não pode entrar no link de compra. Ofereça encaminhar orçamento com a equipe.`);
      continue;
    }

    pares.push(`${variante.id}:${qtd}`);
    const preco = precoBRL(variante.preco);
    incluidos.push(`- ${qtd}x ${produto.titulo} | SKU: ${variante.sku || produto.skus[0] || produto.handle}${preco ? ` | ${preco} cada` : ''}`);
  }

  if (!pares.length) {
    return ['Não foi possível montar o link de carrinho:', ...problemas].join('\n');
  }

  const linhas = [
    `Link do carrinho pronto (leva o cliente direto ao carrinho com os itens já adicionados, é só finalizar a compra): ${config.shopUrl}/cart/${pares.join(',')}`,
    'Itens incluídos:',
    ...incluidos,
  ];
  if (problemas.length) {
    linhas.push('Itens que NÃO entraram no link:', ...problemas);
  }
  linhas.push('Lembre o cliente de informar o CEP no site para calcular o frete.');
  return linhas.join('\n');
}

export function buscarProdutosTexto(termos, limite = 5) {
  const achados = buscarProdutos(termos, limite);
  if (!achados.length) {
    return 'Nenhum produto do catálogo corresponde a essa busca. O cliente pode estar usando um nome regional ou gíria para a peça. NÃO narre a busca ("a busca retornou...") nem conclua que não trabalhamos com o item: diga que verificou o catálogo e os sistemas e não encontrou uma peça com essa descrição, e peça o código da peça ou uma foto para encaminhar à equipe técnica verificar a compatibilidade.';
  }
  return achados
    .map((i) => {
      const preco = i.disponivel && i.preco ? i.preco : 'Sob Consulta';
      const compat = (i.specs?.compatibilidade || []).slice(0, 3).join('; ');
      return `- ${i.titulo} | SKU: ${i.skus[0] || i.handle} | ${preco} | ${i.url}${compat ? ` | Compatível: ${compat}` : ''}`;
    })
    .join('\n');
}
