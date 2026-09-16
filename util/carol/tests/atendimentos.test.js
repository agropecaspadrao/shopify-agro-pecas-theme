import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataDirTemporario } from './_setup.js';

dataDirTemporario();
const { agruparConversas, interpretarRespostaIA, textoCompacto, textoLinhas, textoEmailDai, textoDetalhe, encontrarConversa, montarTranscricao } = await import('../src/relatorios/atendimentos.js');

const ENTRADAS = [
  { ts: '2026-09-16T10:05:00Z', canal: 'whatsapp', sessao: 'wa:5554999990002', mensagem: 'tem dedo de plataforma?', resposta: 'Tenho sim, qual modelo?' },
  { ts: '2026-09-16T09:00:00Z', canal: 'whatsapp', sessao: 'wa:5541999990001', mensagem: '[Cliente chegou clicando no anúncio "Bombas Hidráulicas"] quero uma bomba', resposta: 'Qual máquina?' },
  { ts: '2026-09-16T09:03:00Z', canal: 'whatsapp', sessao: 'wa:5541999990001', mensagem: 'valtra bh180', resposta: 'Temos a 5.1301.0565004.' },
  { ts: '2026-09-16T09:10:00Z', canal: 'sistema', sessao: 'sistema:relatorio', tipo: 'sistema', mensagem: 'x', resposta: 'y' },
  { ts: '2026-09-16T11:00:00Z', canal: 'site', sessao: 'site:abc123', mensagem: 'preço do sensor', resposta: 'R$ 120' },
];

test('agruparConversas numera pela primeira mensagem, ignora sistema e limpa marcadores', () => {
  const c = agruparConversas(ENTRADAS);
  assert.equal(c.length, 3);
  assert.deepEqual(c.map((x) => x.numero), [1, 2, 3]);
  assert.equal(c[0].sessao, 'wa:5541999990001');
  assert.equal(c[0].origemAnuncio, 'Bombas Hidráulicas');
  assert.equal(c[0].mensagens[0].cliente, 'quero uma bomba');
  assert.equal(c[0].mensagens.length, 2);
  assert.equal(c[2].cliente, 'Chat do site');
  assert.match(montarTranscricao(c), /CONVERSA 1: WhatsApp 5541999990001/);
});

test('interpretarRespostaIA casa o JSON pelo número e cai para texto livre se não for JSON', () => {
  const c = agruparConversas(ENTRADAS);
  const json = '```json\n{"pendencias":["Enviar orçamento da bomba"],"conversas":[{"numero":1,"cliente":"João","assunto":"bomba Valtra BH180","ondeParou":"aguarda orçamento","acao":"enviar orçamento"},{"numero":2,"cliente":"","assunto":"dedo de plataforma","ondeParou":"perguntou o modelo","acao":"nenhuma"}]}\n```';
  const r = interpretarRespostaIA(json, c);
  assert.equal(r.textoLivre, '');
  assert.deepEqual(r.pendencias, ['Enviar orçamento da bomba']);
  assert.equal(r.conversas[0].nome, 'João');
  assert.equal(r.conversas[0].assunto, 'bomba Valtra BH180');
  assert.equal(r.conversas[2].assunto, '', 'conversa sem resumo da IA não some da lista');
  assert.deepEqual(r.totais, { conversas: 3, mensagens: 4 });
  const cru = interpretarRespostaIA('PENDÊNCIAS\n- nada', c);
  assert.match(cru.textoLivre, /PENDÊNCIAS/);
  assert.equal(cru.conversas.length, 3);
});

test('textoCompacto: uma linha por conversa, sem transcrição, com dica do /carol detalhe', () => {
  const c = agruparConversas(ENTRADAS);
  const r = interpretarRespostaIA('{"pendencias":[],"conversas":[{"numero":1,"cliente":"João","assunto":"bomba Valtra","ondeParou":"aguarda orçamento","acao":"enviar orçamento"}]}', c);
  const t = textoCompacto(r);
  assert.match(t, /1\. João \(WhatsApp 5541999990001\), via anúncio: bomba Valtra aguarda orçamento Ação: enviar orçamento/);
  assert.match(t, /2\. WhatsApp 5554999990002: 1 mensagens/);
  assert.match(t, /\/carol detalhe <numero>/);
  assert.doesNotMatch(t, /quero uma bomba/, 'mensagens só no detalhe');
  assert.equal(textoLinhas({ conversas: [] }), 'Nenhum atendimento no período.');
});

test('textoEmailDai mantém pendências, blocos por conversa e total', () => {
  const c = agruparConversas(ENTRADAS);
  const r = interpretarRespostaIA('{"pendencias":["Ligar para João"],"conversas":[]}', c);
  const t = textoEmailDai(r, 'ontem até hoje');
  assert.match(t, /PENDÊNCIAS PRIORITÁRIAS\n- Ligar para João/);
  assert.match(t, /1\. Cliente: WhatsApp 5541999990001, via anúncio/);
  assert.match(t, /Total: 3 conversas, 4 mensagens/);
  assert.match(textoEmailDai({ conversas: [], pendencias: [], totais: { conversas: 0, mensagens: 0 } }, 'p'), /nenhum atendimento/);
});

test('encontrarConversa por número ou final do telefone; textoDetalhe traz as mensagens', () => {
  const c = agruparConversas(ENTRADAS);
  assert.equal(encontrarConversa(c, '2').numero, 2);
  assert.equal(encontrarConversa(c, '0001').numero, 1);
  assert.equal(encontrarConversa(c, '+55 41 99999-0001').numero, 1);
  assert.equal(encontrarConversa(c, '9'), null);
  assert.equal(encontrarConversa(c, ''), null);
  const t = textoDetalhe(c[0]);
  assert.match(t, /Conversa 1: WhatsApp 5541999990001/);
  assert.match(t, /Cliente: quero uma bomba\nCarol: Qual máquina\?/);
  assert.match(t, /Cliente: valtra bh180/);
});
