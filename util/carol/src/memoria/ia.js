// Chamadas ao Claude Haiku para a memória: fechar episódio (resumo + fatos da
// ficha numa chamada só) e compactar conversa longa (resumo parcial). Cada
// chamada entra no registro como tipo 'sistema', igual aos outros resumos,
// para o custo aparecer no painel e no saldo estimado.

import { clienteAnthropic } from '../ia/anthropic.js';
import { usoDe } from '../util/uso.js';
import { registrarAtendimento } from '../registro.js';
import { custoUSD } from '../custos.js';
import { limparMarcadores } from '../util/marcadores.js';
import { MEMORIA } from './config.js';
import { PROMPT_EPISODIO, montarEntradaEpisodio } from './regras.js';

async function chamar({ system, conteudo, maxTokens, rotulo }) {
  const resposta = await clienteAnthropic().messages.create(
    { model: MEMORIA.modelo, max_tokens: maxTokens, system, messages: [{ role: 'user', content: conteudo }] },
    { timeout: 30000 }
  );
  const texto = resposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const uso = usoDe(resposta.usage);
  registrarAtendimento({
    canal: 'sistema',
    sessao: 'sistema:memoria',
    tipo: 'sistema',
    mensagem: rotulo,
    resposta: texto.slice(0, 300),
    uso,
    custo: custoUSD(uso, MEMORIA.modelo),
    modelo: MEMORIA.modelo,
  });
  return texto;
}

/** Texto JSON do episódio (interpretar com regras.interpretarEpisodio). */
export function gerarEpisodio({ sessao, mensagens, resumoParcial, fichaAtual }) {
  return chamar({
    system: PROMPT_EPISODIO,
    conteudo: montarEntradaEpisodio({ sessao, mensagens, resumoParcial, fichaAtual }),
    maxTokens: 700,
    rotulo: 'Memória: fechamento de episódio',
  });
}

const PROMPT_PARCIAL =
  'Você compacta o início de uma conversa longa da Carol (atendente virtual da APP Agro Peças Padrão, peças agrícolas) para ela continuar o atendimento sem reler tudo. Escreva em português, no máximo 6 frases curtas, sem travessão e sem emoji: quem é o cliente, peças/códigos e máquina (só como compatibilidade), o que já foi respondido, o que ficou combinado e o que está em aberto. Não inclua preço nem estoque (mudam e vêm do catálogo). Não invente. Responda só com o resumo.';

/** Resumo parcial das mensagens antigas, somando o resumo parcial anterior. */
export function resumirParcial({ mensagens, resumoAnterior }) {
  const transcricao = mensagens.map((m) => `${m.role === 'user' ? 'Cliente' : 'Carol'}: ${limparMarcadores(m.content)}`).join('\n');
  return chamar({
    system: PROMPT_PARCIAL,
    conteudo: `${resumoAnterior ? `Resumo anterior: ${resumoAnterior}\n\n` : ''}Mensagens a compactar:\n${transcricao}`.slice(-20000),
    maxTokens: 400,
    rotulo: 'Memória: compactação de conversa longa',
  });
}
