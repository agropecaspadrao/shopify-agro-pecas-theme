// Chat local com a Carol no terminal, sem WhatsApp e sem servidor.
// Uso: npm run conversar
// Comandos: /sair encerra, /hora simula fora/dentro do horário (informativo apenas)

import readline from 'node:readline';
import { responder } from '../src/claude.js';
import { horarioComercial } from '../src/horario.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const sessao = `teste:${Date.now()}`;

console.log('Chat de teste com a Carol. Digite sua mensagem (/sair para encerrar).');
console.log(`Horário comercial agora: ${horarioComercial() ? 'SIM (no WhatsApp real a Carol ficaria em silêncio)' : 'não, a Carol atende'}`);
console.log('');

function perguntar() {
  rl.question('Você: ', async (linha) => {
    const texto = linha.trim();
    if (!texto) return perguntar();
    if (texto === '/sair') {
      rl.close();
      process.exit(0);
    }
    try {
      const inicio = Date.now();
      const resposta = await responder(sessao, texto, 'whatsapp');
      console.log(`\nCarol (${((Date.now() - inicio) / 1000).toFixed(1)}s):\n${resposta}\n`);
    } catch (e) {
      console.error('Erro:', e.message);
    }
    perguntar();
  });
}

perguntar();
