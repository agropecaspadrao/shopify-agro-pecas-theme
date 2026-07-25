// Consolida as specs técnicas de util/master-produtos/pesquisa/specs_*.json
// em knowledge/specs.json (chaveado por SKU normalizado). Rodar localmente
// sempre que as specs mudarem; o arquivo gerado é versionado e vai no deploy.
//
// Uso: npm run conhecimento

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGEM = path.join(here, '..', '..', 'master-produtos', 'pesquisa');
const DESTINO = path.join(here, '..', 'knowledge', 'specs.json');

const normalizarCodigo = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');

const arquivos = fs
  .readdirSync(ORIGEM)
  .filter((f) => f.startsWith('specs_') && f.endsWith('.json'));

const saida = {};
let total = 0;

for (const arquivo of arquivos) {
  const itens = JSON.parse(fs.readFileSync(path.join(ORIGEM, arquivo), 'utf8'));
  for (const item of itens) {
    if (!item?.sku) continue;
    const chave = normalizarCodigo(item.sku);
    if (!chave) continue;
    saida[chave] = {
      sku: item.sku,
      funcao: item.funcao || null,
      descricao_tecnica: item.descricao_tecnica || null,
      especificacoes: item.especificacoes || null,
      compatibilidade: item.compatibilidade || [],
      confianca: item.confianca || null,
    };
    total++;
  }
  console.log(`- ${arquivo}: ${itens.length} itens`);
}

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
fs.writeFileSync(DESTINO, JSON.stringify(saida, null, 1));
console.log(`OK: ${total} specs consolidadas em ${path.relative(process.cwd(), DESTINO)}`);
