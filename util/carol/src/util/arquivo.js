// Gravação atômica de JSON: escreve num arquivo temporário no MESMO diretório
// e troca pelo definitivo com rename (atômico no mesmo sistema de arquivos).
// Um reinício no meio da escrita deixa o arquivo antigo inteiro, nunca pela
// metade — importante para as configurações que o painel edita no volume.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function gravarJsonAtomico(arquivo, dados) {
  const dir = path.dirname(arquivo);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(arquivo)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
    fs.renameSync(tmp, arquivo);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

/** Lê um JSON; devolve `padrao` se não existe ou está corrompido. */
export function lerJson(arquivo, padrao = null) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return padrao;
  }
}
