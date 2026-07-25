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
  return 'Nenhum produto encontrado com esse código ou nome. Peça ao cliente mais detalhes (código da peça, máquina/modelo ou foto) e ofereça encaminhar para a equipe confirmar.';
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

export function buscarProdutosTexto(termos, limite = 5) {
  const achados = buscarProdutos(termos, limite);
  if (!achados.length) {
    return 'Nenhum produto do catálogo corresponde a essa busca. Peça mais detalhes (código da peça, máquina, modelo, implemento) antes de concluir que não trabalhamos com o item.';
  }
  return achados
    .map((i) => {
      const preco = i.disponivel && i.preco ? i.preco : 'Sob Consulta';
      const compat = (i.specs?.compatibilidade || []).slice(0, 3).join('; ');
      return `- ${i.titulo} | SKU: ${i.skus[0] || i.handle} | ${preco} | ${i.url}${compat ? ` | Compatível: ${compat}` : ''}`;
    })
    .join('\n');
}
