// Webhook do WhatsApp (Meta Cloud API): verificação (GET) e mensagens (POST).
//
// Ordem de decisão para cada mensagem recebida:
//   eco da equipe (modo coexistência) → registra como resposta humana, NUNCA responde
//   comando /carol (admin)            → executa na hora, sem IA
//   pausa / horário / teto diário     → registra como 'silencio' (cliente fica pendente)
//   senão                             → fila do telefone (agrupa mensagens seguidas) → IA
//
// Fila por telefone: mensagens que chegam em CAROL_AGRUPAR_MS (padrão 4 s)
// viram uma entrada só, e cada telefone tem no máximo uma resposta em
// andamento; o que chega enquanto a Carol responde vai no próximo lote.
//
// Entrega antes do registro: o turno só é registrado como respondido depois
// que o envio pelo WhatsApp deu certo; envio que falha fica com entregue:false
// e não entra na memória como dito. IA fora (crédito, chave, instabilidade):
// o cliente recebe uma contingência curta (no máximo 1 a cada 30 min por
// telefone) e o turno é registrado como 'falha' (pendente para a equipe).

import express from 'express';
import { sanitizarEntrada } from '../util/marcadores.js';
import { mascararTelefone } from '../util/telefone.js';
import { montarOrigem } from '../origem.js';

export const AGRUPAR_MS_PADRAO = 4000;
export const AGRUPAR_MAX_MS = 15000; // cliente que não para de digitar: responde mesmo assim
export const CONTINGENCIA_INTERVALO_MS = 30 * 60 * 1000;

const ROTULO_MIDIA = { image: 'foto', video: 'vídeo', document: 'documento', sticker: 'figurinha', location: 'localização', contacts: 'contato', audio: 'áudio' };

/** Textos fixos ao cliente, com a regra de horário em vigor. */
export function textosCliente(quando) {
  return {
    contingencia: `Recebi sua mensagem. Nossa equipe vai te responder ${quando}.`,
    audio: `Olá! Aqui é a Carol, da APP Agro Peças Padrão. Não consegui ouvir seu áudio agora. Pode me escrever em texto o que precisa? Se preferir, a equipe responde seu áudio ${quando}.`,
    midia: `Olá! Aqui é a Carol, da APP Agro Peças Padrão. No momento consigo responder mensagens de texto e áudio. Pode me escrever o que precisa? Se preferir enviar foto ou documento, a equipe responde ${quando}.`,
  };
}

/** Marcadores de contexto (nome, anúncio, catálogo, áudio) + texto do cliente sem marcadores falsos. */
export function montarEntrada({ nome, anuncio, produtoCatalogo, veioDeAudio, texto }) {
  let origem = '';
  if (anuncio) {
    origem += `[Cliente chegou clicando no anúncio "${String(anuncio.titulo || '').replace(/["\[\]]/g, '')}"${anuncio.corpo ? `, texto do anúncio: "${String(anuncio.corpo).replace(/["\[\]]/g, '').slice(0, 200)}"` : ''}. Já procure essa peça no catálogo e atenda com base nela.] `;
  }
  if (produtoCatalogo) origem += `[Cliente consultou o produto de código ${String(produtoCatalogo).replace(/[\[\]]/g, '')} na vitrine do WhatsApp.] `;
  // Nome do perfil e texto são controlados pelo remetente: sem colchetes e sem
  // marcadores, para não falsificarem os campos dos relatórios.
  const nomeLimpo = String(nome || '').replace(/[\[\]]/g, '').trim();
  return (nomeLimpo ? `[Cliente: ${nomeLimpo}] ` : '') + origem + (veioDeAudio ? '[Mensagem de voz do cliente, transcrita automaticamente] ' : '') + sanitizarEntrada(texto);
}

/**
 * @param {object} d dependências (todas injetáveis nos testes)
 */
export function criarProcessadorWhatsApp(d) {
  const agora = d.agora || Date.now;
  const agruparMs = d.agruparMs ?? AGRUPAR_MS_PADRAO;
  const agruparMaxMs = d.agruparMaxMs ?? AGRUPAR_MAX_MS;
  const intervaloContingencia = d.contingenciaIntervaloMs ?? CONTINGENCIA_INTERVALO_MS;
  const log = d.log || console;
  const filas = new Map(); // telefone -> { pendentes, timer, ocupado, primeiraEm }
  const ultimaContingencia = new Map(); // telefone -> ms
  const quando = () => d.quandoEquipeResponde();

  function registrar(entrada) {
    try {
      d.registrar(entrada);
    } catch (e) {
      log.warn(`[whatsapp] registro falhou: ${e.message}`);
    }
  }
  function lembrar(sessao, turno) {
    Promise.resolve()
      .then(() => d.memoria.registrarTurno(sessao, turno))
      .catch((e) => log.warn(`[memoria] não gravei o turno de ${mascararTelefone(sessao.slice(3))}: ${e.message}`));
  }

  // ── Eco da equipe: só registra ──────────────────────────────────────────
  function registrarEco(msg) {
    if (!msg.para || !msg.texto) return;
    const sessao = `wa:${msg.para}`;
    registrar({ canal: 'whatsapp', sessao, tipo: 'humano', autor: 'humano', mensagem: '', resposta: msg.texto, ...(msg.timestamp ? { ts: msg.timestamp } : {}) });
    lembrar(sessao, { mensagem: '', resposta: msg.texto, autor: 'humano', ...(msg.timestamp ? { ts: msg.timestamp } : {}) });
    log.log(`[whatsapp] resposta da equipe para ${mascararTelefone(msg.para)} registrada (eco do app)`);
  }

  function textoSemIa(msg) {
    if (msg.texto) return msg.texto.trim();
    return `(${ROTULO_MIDIA[msg.tipo] || msg.tipo || 'mensagem'} sem texto)`;
  }

  // ── Silêncio: registra a mensagem recebida, sem resposta ─────────────────
  function registrarSilencio(msg, motivo) {
    const sessao = `wa:${msg.de}`;
    const mensagem = montarEntrada({ nome: msg.nome, anuncio: msg.anuncio, produtoCatalogo: msg.produtoCatalogo, texto: textoSemIa(msg) });
    const origem = msg.anuncio || msg.produtoCatalogo ? montarOrigem({ canal: 'whatsapp', anuncio: msg.anuncio, produtoCatalogo: msg.produtoCatalogo }) : null;
    registrar({ canal: 'whatsapp', sessao, tipo: 'silencio', motivo, mensagem, resposta: '', ...(origem ? { origem } : {}) });
    lembrar(sessao, { mensagem, resposta: '' });
    log.log(`[whatsapp] ${mascararTelefone(msg.de)}: em silêncio (${motivo}), mensagem registrada como pendente`);
  }

  /** Porta de entrada: uma mensagem extraída do webhook. */
  async function receber(msg) {
    if (msg.eco) return registrarEco(msg);
    // Mensagem do próprio número da loja que não veio como eco: ignora
    if (!msg.de || msg.de === d.numeroLoja) return;

    // Comandos de administrador ("/carol ...") valem a qualquer hora e nunca passam pela IA
    if (msg.tipo === 'text' && msg.texto) {
      const cmd = await d.tratarComando({ de: msg.de, texto: msg.texto.trim() });
      if (cmd.tratado) {
        await d.marcarComoLida(msg.id);
        for (const r of cmd.respostas) await d.enviarTexto(msg.de, r);
        if (cmd.respostas.length) log.log(`[comandos] respondi ${mascararTelefone(msg.de)} (${cmd.respostas.length} msg)`);
        return;
      }
    }

    let motivo = null;
    if (d.estadoPausa().ativa) motivo = 'pausa';
    else if (!d.carolAtende()) motivo = 'horario';
    // Teto diário por telefone e global: protege o crédito contra loops/flood
    else if (!d.limiteTelefone(msg.de) || !d.limiteGlobal()) motivo = 'teto';
    if (motivo) {
      registrarSilencio(msg, motivo);
      if (motivo !== 'teto') await d.avisarSilencioAdmin(msg.de, motivo);
      return;
    }
    enfileirar(msg);
  }

  // ── Fila por telefone com agrupamento ──────────────────────────────────
  function armar(de, f) {
    clearTimeout(f.timer);
    const espera = Math.max(0, Math.min(agruparMs, f.primeiraEm + agruparMaxMs - agora()));
    f.timer = setTimeout(() => drenar(de), espera);
    f.timer.unref?.();
  }

  function enfileirar(msg) {
    let f = filas.get(msg.de);
    if (!f) {
      f = { pendentes: [], timer: null, ocupado: false, primeiraEm: agora() };
      filas.set(msg.de, f);
    }
    if (!f.pendentes.length) f.primeiraEm = agora();
    f.pendentes.push(msg);
    if (!f.ocupado) armar(msg.de, f);
  }

  async function drenar(de) {
    const f = filas.get(de);
    if (!f) return;
    f.timer = null;
    if (f.ocupado || !f.pendentes.length) return;
    f.ocupado = true;
    const lote = f.pendentes.splice(0);
    try {
      await processarLote(de, lote);
    } catch (e) {
      log.error(`[webhook] erro ao processar ${mascararTelefone(de)}:`, e.message);
      d.reportarAnomalia(d.classificarErro(e, 'webhook')).catch(() => {});
    } finally {
      f.ocupado = false;
      if (f.pendentes.length) {
        f.primeiraEm = agora();
        armar(de, f);
      } else filas.delete(de);
    }
  }

  async function processarLote(de, lote) {
    const sessao = `wa:${de}`;
    await d.marcarComoLida(lote[lote.length - 1].id);

    const partes = [];
    const semTexto = [];
    let veioDeAudio = false;
    let audioFalhou = false;
    for (const m of lote) {
      let t = (m.texto || '').trim();
      if (!t && m.tipo === 'audio' && m.midiaId && d.transcricaoDisponivel()) {
        try {
          const { buffer, mime } = await d.baixarMidia(m.midiaId);
          t = ((await d.transcreverAudio(buffer, mime)) || '').trim();
          if (t) {
            veioDeAudio = true;
            log.log(`[whatsapp] áudio de ${mascararTelefone(de)} transcrito (${t.length} chars)`);
          }
        } catch (e) {
          log.error('[whatsapp] falha na transcrição:', e.message);
        }
      }
      if (t) partes.push(t);
      else {
        semTexto.push(ROTULO_MIDIA[m.tipo] || m.tipo || 'mensagem');
        if (m.tipo === 'audio') audioFalhou = true;
      }
    }
    const nome = lote.find((m) => m.nome)?.nome;
    const anuncio = lote.find((m) => m.anuncio)?.anuncio || null;
    const produtoCatalogo = lote.find((m) => m.produtoCatalogo)?.produtoCatalogo || null;
    const origem = anuncio || produtoCatalogo ? { anuncio, produtoCatalogo } : {};

    // Só mídia que a Carol não lê: resposta fixa, sem IA
    if (!partes.length) {
      const t = textosCliente(quando());
      const aviso = audioFalhou ? t.audio : t.midia;
      const mensagem = montarEntrada({ nome, anuncio, produtoCatalogo, texto: `(${semTexto.join(', ')} sem texto)` });
      let entregue = true;
      try {
        await d.enviarTexto(de, aviso);
      } catch (e) {
        entregue = false;
        d.reportarAnomalia(d.classificarErro(e, 'webhook')).catch(() => {});
      }
      registrar({ canal: 'whatsapp', sessao, tipo: 'aviso', mensagem, resposta: aviso, ...(entregue ? {} : { entregue: false }) });
      lembrar(sessao, { mensagem, resposta: entregue ? aviso : '' });
      return;
    }

    const texto = partes.join('\n') + (semTexto.length ? `\n(o cliente também enviou: ${semTexto.join(', ')}, que a Carol não consegue ver)` : '');
    const entrada = montarEntrada({ nome, anuncio, produtoCatalogo, veioDeAudio, texto });

    let r;
    try {
      r = await d.medir('whatsapp', () => d.gerarResposta(sessao, entrada, 'whatsapp', { origem }));
    } catch (e) {
      return falhaIA(de, sessao, entrada, origem, e);
    }

    try {
      await d.enviarTexto(de, r.texto);
      await r.confirmar({ entregue: true });
      log.log(`[whatsapp] respondi ${mascararTelefone(de)} (${r.texto.length} chars${lote.length > 1 ? `, ${lote.length} mensagens agrupadas` : ''})`);
    } catch (e) {
      await r.confirmar({ entregue: false });
      log.error(`[whatsapp] resposta para ${mascararTelefone(de)} NÃO entregue: ${e.message}`);
      d.reportarAnomalia(d.classificarErro(e, 'webhook')).catch(() => {});
    }
  }

  // ── IA fora: contingência + registro de falha ─────────────────────────
  async function falhaIA(de, sessao, entrada, origem, erro) {
    const cls = d.classificarErro(erro, 'webhook');
    log.error(`[whatsapp] IA falhou para ${mascararTelefone(de)} (${cls.tipo}): ${String(erro?.message || erro).slice(0, 200)}`);
    d.reportarAnomalia(cls).catch(() => {});
    let resposta = '';
    let entregue = true;
    const t = agora();
    if (t - (ultimaContingencia.get(de) || 0) >= intervaloContingencia) {
      ultimaContingencia.set(de, t);
      if (ultimaContingencia.size > 5000) ultimaContingencia.clear();
      resposta = textosCliente(quando()).contingencia;
      try {
        await d.enviarTexto(de, resposta);
      } catch (e) {
        entregue = false;
        log.error(`[whatsapp] contingência para ${mascararTelefone(de)} também falhou: ${e.message}`);
      }
    }
    const o = origem.anuncio || origem.produtoCatalogo ? montarOrigem({ canal: 'whatsapp', ...origem }) : null;
    registrar({ canal: 'whatsapp', sessao, tipo: 'falha', erro: cls.tipo, mensagem: entrada, resposta, ...(entregue ? {} : { entregue: false }), ...(o ? { origem: o } : {}) });
    lembrar(sessao, { mensagem: entrada, resposta: entregue ? resposta : '' });
  }

  /** Só para testes: espera todas as filas esvaziarem. */
  async function ocioso(limiteMs = 5000) {
    const fim = Date.now() + limiteMs;
    while (filas.size && Date.now() < fim) await new Promise((r) => setTimeout(r, 5));
  }

  return { receber, ocioso, filas };
}

/**
 * Header X-SDR-Possuidos (contrato com o messenger do SDR, fora do HMAC):
 * lista de `from` (com 55, como a Meta mandou) cujas conversas pertencem ao
 * SDR. Vazio/ausente = a Carol responde tudo.
 */
export function lerPossuidos(valor) {
  return new Set(
    String(valor || '')
      .split(',')
      .map((x) => x.replace(/\D/g, ''))
      .filter(Boolean)
  );
}

/**
 * Rotas /webhook. `processador` vem de criarProcessadorWhatsApp.
 * @param {{processador:object, verificarAssinatura:Function, extrairMensagens:Function, verifyToken:string, compararSegredo:Function, reportarAnomalia:Function, classificarErro:Function}} d
 */
export function criarRotasWebhook(d) {
  const router = express.Router();

  // Verificação (GET): token comparado em tempo constante
  router.get('/', (req, res) => {
    const modo = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (modo === 'subscribe' && typeof token === 'string' && d.compararSegredo(token, d.verifyToken)) {
      return res.status(200).type('text/plain').send(String(challenge ?? ''));
    }
    return res.sendStatus(403);
  });

  // Mensagens (POST): responde 200 na hora; processamento segue em segundo plano
  router.post('/', (req, res) => {
    if (!d.verificarAssinatura(req.rawBody, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
    res.sendStatus(200);
    // Conversas do SDR (lote misto encaminhado pelo messenger): ignora sem
    // responder nem registrar como atendimento da Carol
    const possuidos = lerPossuidos(req.headers['x-sdr-possuidos']);
    for (const msg of d.extrairMensagens(req.body)) {
      const cliente = String((msg.eco ? msg.para : msg.de) || '').replace(/\D/g, '');
      if (cliente && possuidos.has(cliente)) {
        console.log(`[webhook] ${mascararTelefone(cliente)}: conversa do SDR (X-SDR-Possuidos), ignorada`);
        continue;
      }
      d.processador.receber(msg).catch((e) => {
        console.error('[webhook] erro ao processar:', e.message);
        d.reportarAnomalia(d.classificarErro(e, 'webhook')).catch(() => {});
      });
    }
  });

  return router;
}
