// Diretório de dados da Carol (volume do Railway em produção). Módulo sem
// dependências para qualquer outro poder importar sem ciclo de import.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.CAROL_DATA_DIR || path.join(here, '..', '..', 'data');
