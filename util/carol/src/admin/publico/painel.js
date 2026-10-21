// Painel do administrador da Carol — comportamento do navegador.
// Sem bibliotecas. Atualiza o DOM existente (nunca recria a página):
//   - /api/estado a cada 5 s (pausa quando a aba fica oculta; recua em erro)
//   - /api/detalhes a cada 60 s (picos, saúde, Railway)
//   - gráfico ao vivo da máquina com buffer circular de 120 pontos
'use strict';

(function () {
  const API = '/admin/painel/api/';
  const RAPIDO = 5000;
  const LENTO = 60000;
  const MAX_PONTOS = 120;
  const TZ = 'America/Sao_Paulo';
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  // ── utilidades ───────────────────────────────────────────────────────────
  function texto(el, v) {
    if (typeof el === 'string') el = $(el);
    const s = v == null ? '' : String(v);
    if (el && el.textContent !== s) el.textContent = s;
  }
  function atributo(el, nome, v) {
    if (el && el.getAttribute(nome) !== String(v)) el.setAttribute(nome, v);
  }
  const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const fmtDataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const n = (v) => (v == null ? '–' : Number(v).toLocaleString('pt-BR'));
  function segundos(ms) {
    if (ms == null) return '–';
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
  }
  function duracao(s) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}min`;
    return `${m} min`;
  }

  async function req(caminho, opts) {
    opts = opts || {};
    const headers = { 'X-Carol-Painel': '1' };
    if (opts.corpo !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(API + caminho, {
      method: opts.metodo || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: opts.corpo !== undefined ? JSON.stringify(opts.corpo) : undefined,
    });
    if (r.status === 401) {
      location.href = '/admin/painel/entrar';
      throw new Error('sessão expirada');
    }
    let j = {};
    try { j = await r.json(); } catch (e) { /* corpo vazio */ }
    if (!r.ok) {
      const e = new Error(j.erro || `HTTP ${r.status}`);
      e.dados = j;
      throw e;
    }
    return j;
  }

  function conexao(estado, rotulo) {
    const el = $('conexao');
    atributo(el, 'data-estado', estado);
    texto(el, rotulo);
  }

  // ── estado (5 s) ─────────────────────────────────────────────────────────
  function nivelLimite(usado, max) {
    if (!max) return 'ok';
    const p = usado / max;
    return p >= 0.9 ? 'critico' : p >= 0.7 ? 'atencao' : 'ok';
  }
  function limite(id, l) {
    const barra = $(id);
    if (!l || !l.max) {
      texto(id + '-txt', '–');
      return;
    }
    barra.style.width = `${Math.min(100, (l.usado / l.max) * 100)}%`;
    atributo(barra, 'data-nivel', nivelLimite(l.usado, l.max));
    texto(id + '-txt', `${l.usado}/${l.max}`);
  }

  const listaUltimas = $('ultimas');
  const itensUltimas = [];
  for (let i = 0; i < 10; i++) {
    const li = document.createElement('li');
    li.hidden = true;
    li.innerHTML = '<span class="quando num"></span><span class="quem"><span class="num"></span><span class="canal"></span></span><span class="texto"></span>';
    listaUltimas.appendChild(li);
    itensUltimas.push(li);
  }
  const vazioUltimas = document.createElement('li');
  vazioUltimas.className = 'mini';
  vazioUltimas.textContent = 'Nenhuma conversa ainda hoje.';
  listaUltimas.appendChild(vazioUltimas);

  let ultimoEstado = null;
  function renderEstado(e) {
    ultimoEstado = e;
    const c = e.carol;
    atributo($('hero'), 'data-status', c.status);
    texto('st-rotulo', c.rotulo);
    texto('st-motivo', c.motivo);
    texto('st-proxima', c.proxima ? `Próxima mudança: ${c.proxima.texto}.` : e.pausa.indefinida ? 'Fica desligada até alguém religar.' : '');
    texto('st-regra', c.regra);
    texto('st-origem', c.origemRegra ? `Origem da regra: ${c.origemRegra.texto}.` : '');
    const cred = e.credito || {};
    $('st-credito').hidden = !cred.esgotado;
    texto('st-credito', cred.esgotado ? `Crédito da Anthropic ESGOTADO desde ${fmtDataHora.format(new Date(cred.desde))}: a Carol não consegue responder com IA (os clientes recebem a mensagem de contingência). Recarregue em console.anthropic.com.` : '');
    $('btn-ligar').disabled = !e.pausa.ativa;

    const a = e.atendimento;
    texto('k-ativas', n(a.ativas));
    texto('k-msgs', n(a.mensagensHoje));
    texto('k-clientes', n(a.clientesHoje));
    texto('k-resposta', a.respostaMediaMs == null ? 'sem medição' : segundos(a.respostaMediaMs));
    texto('k-agora', n(a.respondendoAgora));
    const erros = (a.falhasHoje || 0) + (a.anomalias ? a.anomalias.hoje : 0);
    texto('k-erros', n(erros));
    texto('k-semresp', n(a.semRespostaHoje || 0));
    atributo($('k-semresp'), 'data-nivel', a.semRespostaHoje ? 'atencao' : 'ok');
    atributo($('k-erros'), 'data-nivel', a.anomalias && a.anomalias.criticas ? 'critico' : erros ? 'atencao' : 'ok');
    atributo($('k-resposta'), 'data-nivel', a.respostaMediaMs > 30000 ? 'critico' : a.respostaMediaMs > 15000 ? 'atencao' : 'ok');
    texto('k-canais', `WhatsApp ${n(a.porCanal.whatsapp || 0)} · Site ${n(a.porCanal.site || 0)}` + (a.respostaP90Ms ? ` · 9 em cada 10 respostas em até ${segundos(a.respostaP90Ms)}` : ''));

    limite('lim-wa', e.limites && e.limites.whatsapp);
    limite('lim-site', e.limites && e.limites.site);

    const ult = e.ultimas || [];
    itensUltimas.forEach((li, i) => {
      const u = ult[i];
      li.hidden = !u;
      if (!u) return;
      texto(li.children[0], fmtHora.format(new Date(u.t)));
      texto(li.children[1].children[0], u.quem);
      texto(li.children[1].children[1], u.canal === 'site' ? 'site' : 'WhatsApp');
      texto(li.children[2], u.trecho || '(mídia)');
    });
    vazioUltimas.hidden = ult.length > 0;

    renderMaquina(e.maquina);
  }

  // ── máquina ao vivo ──────────────────────────────────────────────────────
  const pontos = []; // [t, cpu, rss, heap, lag] — no máximo MAX_PONTOS
  function adicionarPonto(p) {
    if (pontos.length && pontos[pontos.length - 1][0] >= p[0]) return;
    pontos.push(p);
    if (pontos.length > MAX_PONTOS) pontos.shift();
  }
  function polyline(el, serie, max, w, h) {
    if (!el) return;
    if (!serie.length) return atributo(el, 'points', '');
    const passo = serie.length > 1 ? w / (serie.length - 1) : 0;
    const topo = max > 0 ? max : 1;
    atributo(el, 'points', serie.map((v, i) => `${(i * passo).toFixed(1)},${(h - 2 - (Math.min(v, topo) / topo) * (h - 6)).toFixed(1)}`).join(' '));
  }
  function desenharMaquina() {
    const cpu = pontos.map((p) => p[1]);
    const mem = pontos.map((p) => p[2]);
    polyline($('pl-cpu'), cpu, Math.max(100, ...cpu), 480, 90);
    polyline($('pl-mem'), mem, Math.max(...mem, 1) * 1.15, 480, 90);
  }
  function renderMaquina(m) {
    if (!m) return;
    texto('m-cpu', `${m.cpu.toLocaleString('pt-BR')}%`);
    atributo($('m-cpu'), 'data-nivel', m.cpu > 85 ? 'critico' : m.cpu > 60 ? 'atencao' : 'ok');
    texto('m-mem', `${Math.round(m.rss)} MB`);
    texto('m-heap', `${Math.round(m.heap)} de ${Math.round(m.heapTotal)} MB`);
    texto('m-lag', `${m.lag.toLocaleString('pt-BR')} ms`);
    atributo($('m-lag'), 'data-nivel', m.lag > 200 ? 'critico' : m.lag > 50 ? 'atencao' : 'ok');
    texto('m-uptime', duracao(m.uptimeS));
    texto('m-conexoes', m.conexoes == null ? '–' : n(m.conexoes));
    texto('m-versao', `Versão ${m.versao || 'local'} · Node ${m.node}`);
    adicionarPonto([m.t, m.cpu, m.rss, m.heap, m.lag]);
    desenharMaquina();
  }

  // ── detalhes (60 s) ──────────────────────────────────────────────────────
  const grafHoras = $('graf-horas');
  const barras = [];
  let linhaMedia = null;
  (function montarGrafHoras() {
    const W = 480, H = 150, larg = W / 24;
    const eixo = document.createElementNS(SVG, 'line');
    eixo.setAttribute('class', 'eixo');
    eixo.setAttribute('x1', 0); eixo.setAttribute('x2', W); eixo.setAttribute('y1', H); eixo.setAttribute('y2', H);
    grafHoras.appendChild(eixo);
    for (let h = 0; h < 24; h++) {
      const r = document.createElementNS(SVG, 'rect');
      r.setAttribute('class', 'barra');
      r.setAttribute('x', (h * larg + 2).toFixed(1));
      r.setAttribute('width', (larg - 4).toFixed(1));
      r.setAttribute('y', H); r.setAttribute('height', 0); r.setAttribute('rx', 2);
      const t = document.createElementNS(SVG, 'title');
      r.appendChild(t);
      grafHoras.appendChild(r);
      barras.push(r);
      if (h % 3 === 0) {
        const tx = document.createElementNS(SVG, 'text');
        tx.setAttribute('class', 'rot');
        tx.setAttribute('x', (h * larg + 2).toFixed(1));
        tx.setAttribute('y', 166);
        tx.textContent = `${h}h`;
        grafHoras.appendChild(tx);
      }
    }
    linhaMedia = document.createElementNS(SVG, 'polyline');
    linhaMedia.setAttribute('class', 'linha media');
    grafHoras.appendChild(linhaMedia);
  })();

  function renderPicos(p) {
    if (!p) return;
    const H = 150, larg = 480 / 24;
    const max = Math.max(1, ...p.hoje, ...p.media7);
    p.hoje.forEach((v, h) => {
      const alt = (v / max) * (H - 8);
      atributo(barras[h], 'y', (H - alt).toFixed(1));
      atributo(barras[h], 'height', alt.toFixed(1));
      atributo(barras[h], 'class', p.picoHoje && p.picoHoje.hora === h && v > 0 ? 'barra pico' : 'barra');
      texto(barras[h].firstChild, `${h}h: ${v} hoje · média ${String(p.media7[h]).replace('.', ',')}`);
    });
    atributo(linhaMedia, 'points', p.media7.map((v, h) => `${(h * larg + larg / 2).toFixed(1)},${(H - (v / max) * (H - 8)).toFixed(1)}`).join(' '));
    texto('pico-hoje', p.picoHoje && p.picoHoje.n ? `Pico de hoje: ${p.picoHoje.hora}h, com ${p.picoHoje.n} mensage${p.picoHoje.n === 1 ? 'm' : 'ns'}.` : 'Ainda sem mensagens hoje.');

    let maxHeat = 0;
    p.heatmap.forEach((l) => l.forEach((v) => { if (v > maxHeat) maxHeat = v; }));
    document.querySelectorAll('.heat-cel').forEach((cel) => {
      const v = p.heatmap[cel.dataset.d][cel.dataset.h];
      cel.style.setProperty('--v', maxHeat ? (v / maxHeat).toFixed(2) : '0');
      cel.title = `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][cel.dataset.d]} ${cel.dataset.h}h: média ${String(v).replace('.', ',')}`;
    });
    const ps = p.picoSemana;
    texto('pico-semana', ps && ps.media ? `Horário mais movimentado nos últimos 30 dias: ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][ps.dow]} às ${ps.hora}h (média de ${String(ps.media).replace('.', ',')} mensagens). Total no período: ${n(p.total30d)}.` : 'Sem histórico suficiente nos últimos 30 dias.');
  }

  const NIVEL = { ok: 'ok', aviso: 'atencao', falha: 'critico', nao_configurado: '' };
  const ROTULO = { ok: 'ok', aviso: 'atenção', falha: 'falha', nao_configurado: 'não configurado' };
  const SEV = { critica: 'critico', alta: 'atencao', media: '' };
  function lista(ul, itens, vazio) {
    const frag = document.createDocumentFragment();
    if (!itens.length) {
      const li = document.createElement('li');
      li.className = 'mini';
      li.textContent = vazio;
      frag.appendChild(li);
    }
    for (const it of itens) {
      const li = document.createElement('li');
      const selo = document.createElement('span');
      selo.className = 'selo';
      selo.dataset.nivel = it.nivel;
      selo.textContent = it.selo;
      const t = document.createElement('span');
      t.textContent = it.texto;
      li.append(selo, t);
      frag.appendChild(li);
    }
    ul.replaceChildren(frag);
  }
  function renderSaude(s, anomalias) {
    if (s) {
      texto('saude-quando', `Última verificação: ${fmtDataHora.format(new Date(s.ts))} (a cada 30 min)`);
      lista($('saude'), s.itens.map((i) => ({ nivel: NIVEL[i.estado] || '', selo: ROTULO[i.estado] || i.estado, texto: `${i.nome}: ${i.resumo}` })), 'Sem itens.');
    } else {
      texto('saude-quando', 'Ainda não houve verificação desde que o serviço ligou.');
      lista($('saude'), [], 'Aguardando a primeira verificação.');
    }
    lista($('anomalias'), (anomalias || []).map((a) => ({ nivel: SEV[a.severidade] || '', selo: a.severidade, texto: `${a.titulo} (${a.ocorrencias}x, última ${fmtHora.format(new Date(a.ultima))})` })), 'Nenhum alerta aberto.');
  }

  function renderRailway(r) {
    if (!r || !r.disponivel) {
      texto('rw-msg', (r && r.motivo) || 'métricas do Railway indisponíveis');
      $('rw-dados').hidden = true;
      return;
    }
    $('rw-dados').hidden = false;
    texto('rw-msg', r.desatualizado ? 'Dados da última leitura bem-sucedida (o Railway não respondeu agora).' : `Atualizado ${fmtHora.format(new Date(r.atualizadoEm))}.`);
    const cpu = r.cpu.map((p) => p[1]);
    const mem = r.memoria.map((p) => p[1]);
    polyline($('rw-cpu'), cpu, Math.max(10, ...cpu) * 1.1, 480, 80);
    polyline($('rw-mem'), mem, Math.max(1, ...mem) * 1.1, 480, 80);
    texto('rw-pico-cpu', r.picoCpu ? `${r.picoCpu.valor.toLocaleString('pt-BR')}% às ${fmtDataHora.format(new Date(r.picoCpu.em))}` : '–');
    texto('rw-pico-mem', r.picoMemoria ? `${n(r.picoMemoria.valor)} MB às ${fmtDataHora.format(new Date(r.picoMemoria.em))}` : '–');
    texto('rw-rede', `Rede nas 24h: ${n(r.redeEntradaMB)} MB recebidos · ${n(r.redeSaidaMB)} MB enviados`);
  }

  // ── ciclos de atualização ────────────────────────────────────────────────
  let timerRapido = null;
  let timerLento = null;
  let falhas = 0;

  async function cicloRapido() {
    clearTimeout(timerRapido);
    timerRapido = null;
    let espera = RAPIDO;
    try {
      renderEstado(await req('estado'));
      falhas = 0;
      conexao('ok', 'ao vivo');
    } catch (e) {
      falhas++;
      espera = Math.min(RAPIDO * 2 ** falhas, 60000);
      conexao('erro', `sem conexão · nova tentativa em ${Math.round(espera / 1000)} s`);
    }
    if (!document.hidden) timerRapido = setTimeout(cicloRapido, espera);
  }

  async function cicloLento() {
    clearTimeout(timerLento);
    timerLento = null;
    try {
      const d = await req('detalhes');
      renderPicos(d.picos);
      renderSaude(d.saude, d.anomalias);
      renderRailway(d.railway);
    } catch (e) { /* o ciclo rápido já sinaliza a conexão */ }
    if (!document.hidden) timerLento = setTimeout(cicloLento, LENTO);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(timerRapido);
      clearTimeout(timerLento);
      timerRapido = timerLento = null;
      conexao('pausado', 'pausado (aba oculta)');
    } else {
      cicloRapido();
      cicloLento();
    }
  });

  // ── ações: ligar / desligar ──────────────────────────────────────────────
  function msgAcao(id, t, erro) {
    const el = $(id);
    el.classList.toggle('erro', Boolean(erro));
    texto(el, t);
  }
  $('btn-ligar').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      await req('ligar', { metodo: 'POST', corpo: {} });
      msgAcao('acao-msg', 'Carol religada. Ela segue a regra de horário.');
    } catch (e) {
      msgAcao('acao-msg', `Não consegui religar: ${e.message}`, true);
    }
    cicloRapido();
  });
  $('btn-desligar').addEventListener('click', async (ev) => {
    const v = $('sel-horas').value;
    const rotulo = $('sel-horas').selectedOptions[0].textContent;
    if (!confirm(`Desligar a Carol no WhatsApp ${rotulo}? Os clientes ficam esperando a equipe.`)) return;
    ev.target.disabled = true;
    try {
      await req('desligar', { metodo: 'POST', corpo: v === 'religar' ? { ateReligar: true } : { horas: Number(v) } });
      msgAcao('acao-msg', `Carol desligada ${rotulo}.`);
    } catch (e) {
      msgAcao('acao-msg', `Não consegui desligar: ${e.message}`, true);
    }
    ev.target.disabled = false;
    cicloRapido();
  });

  // ── horário de atendimento ───────────────────────────────────────────────
  const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  let seq = 0;

  function linhaJanela(j, { removivel }) {
    const div = document.createElement('div');
    div.className = 'janela';
    const id = `j${++seq}`;
    const dias = document.createElement('div');
    dias.className = 'dias';
    dias.setAttribute('role', 'group');
    dias.setAttribute('aria-label', 'Dias');
    LETRAS.forEach((l, d) => {
      const lab = document.createElement('label');
      lab.className = 'dia';
      lab.title = NOMES[d];
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = d;
      cb.checked = j.dias.includes(d);
      cb.setAttribute('aria-label', NOMES[d]);
      const s = document.createElement('span');
      s.textContent = l;
      lab.append(cb, s);
      dias.appendChild(lab);
    });
    const inteiro = j.inicio === '00:00' && j.fim === '24:00';
    const horas = document.createElement('div');
    horas.className = 'horas';
    horas.innerHTML = `<input type="time" class="ini" aria-label="Início" required> <span>até</span> <input type="time" class="fim" aria-label="Fim" required>`;
    horas.querySelector('.ini').value = j.inicio;
    horas.querySelector('.fim').value = j.fim === '24:00' ? '00:00' : j.fim;
    const lab = document.createElement('label');
    lab.className = 'inteiro';
    lab.innerHTML = `<input type="checkbox" class="dia-todo" id="${id}"> dia inteiro`;
    const cbInteiro = lab.querySelector('input');
    cbInteiro.checked = inteiro;
    const sincronizar = () => horas.querySelectorAll('input').forEach((i) => { i.disabled = cbInteiro.checked; });
    cbInteiro.addEventListener('change', sincronizar);
    sincronizar();
    div.append(dias, horas, lab);
    if (removivel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-fantasma';
      b.textContent = 'Remover';
      b.addEventListener('click', () => div.remove());
      div.appendChild(b);
    }
    return div;
  }

  function lerJanela(div) {
    const dias = [...div.querySelectorAll('.dias input:checked')].map((c) => Number(c.value));
    if (div.querySelector('.dia-todo').checked) return { dias, inicio: '00:00', fim: '24:00' };
    const inicio = div.querySelector('.ini').value;
    let fim = div.querySelector('.fim').value;
    if (fim === '00:00') fim = '24:00'; // meia-noite = fim do dia
    return { dias, inicio, fim };
  }

  function montarHorario(h) {
    const fs = $('presets');
    fs.querySelectorAll('label').forEach((l) => l.remove());
    h.presets.forEach((p) => {
      const lab = document.createElement('label');
      lab.className = 'preset';
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'modo';
      r.value = p.modo;
      r.checked = h.config.modo === p.modo;
      const t = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = p.rotulo;
      const s = document.createElement('span');
      s.textContent = p.descricao;
      t.append(b, s);
      lab.append(r, t);
      fs.appendChild(lab);
    });
    const jan = $('janelas');
    jan.replaceChildren(...(h.config.janelas.length ? h.config.janelas : [{ dias: [1, 2, 3, 4, 5], inicio: '18:00', fim: '08:00' }]).map((j) => linhaJanela(j, { removivel: true })));
    $('expediente').replaceChildren(linhaJanela(h.config.expediente, { removivel: false }));
    $('expediente').querySelector('.inteiro').hidden = true;
    alternarEditor();
    msgAcao('hor-msg', `Em vigor: ${h.regra}.` + (h.config.atualizadoEm ? ` Alterado em ${fmtDataHora.format(new Date(h.config.atualizadoEm))}.` : ' (padrão do servidor)'));
    texto('hor-origem', `Origem da regra: ${h.origemTexto || ''}.`);
    $('padrao-horario').hidden = h.origem !== 'painel';
  }

  $('padrao-horario').addEventListener('click', async () => {
    if (!confirm('Apagar a regra salva no painel e voltar às variáveis do servidor (CAROL_24H / CAROL_HORA_*)?')) return;
    try {
      montarHorario(await req('horario', { metodo: 'DELETE' }));
      cicloRapido();
    } catch (e) {
      msgAcao('hor-msg', `Não consegui voltar ao padrão: ${e.message}`, true);
    }
  });

  $('btn-chave').addEventListener('click', async (ev) => {
    if (!confirm('Gerar uma nova palavra-chave? A atual continua valendo por mais 24 horas.')) return;
    ev.target.disabled = true;
    try {
      const r = await req('chave', { metodo: 'POST', corpo: {} });
      msgAcao('chave-msg', r.canal === 'email' ? `Enviada por e-mail para ${r.enviadaPara.join(', ')}.` : `${r.aviso} Palavra: ${r.palavra}`);
    } catch (e) {
      msgAcao('chave-msg', `Não consegui gerar: ${e.message}`, true);
    }
    ev.target.disabled = false;
  });

  function alternarEditor() {
    const modo = (document.querySelector('input[name="modo"]:checked') || {}).value;
    $('editor-janelas').hidden = modo !== 'personalizado';
  }
  $('presets').addEventListener('change', alternarEditor);
  $('add-janela').addEventListener('click', () => $('janelas').appendChild(linhaJanela({ dias: [6], inicio: '12:00', fim: '24:00' }, { removivel: true })));

  $('form-horario').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const modo = (document.querySelector('input[name="modo"]:checked') || {}).value;
    const corpo = {
      modo,
      expediente: lerJanela($('expediente').querySelector('.janela')),
      janelas: [...$('janelas').querySelectorAll('.janela')].map(lerJanela),
    };
    $('salvar-horario').disabled = true;
    try {
      montarHorario(await req('horario', { metodo: 'PUT', corpo }));
      msgAcao('hor-msg', `Salvo. ${$('hor-msg').textContent}`);
      cicloRapido();
    } catch (e) {
      msgAcao('hor-msg', e.dados && e.dados.erros ? e.dados.erros.join(' · ') : `Não consegui salvar: ${e.message}`, true);
    }
    $('salvar-horario').disabled = false;
  });

  // ── início ───────────────────────────────────────────────────────────────
  req('maquina').then((m) => {
    for (const p of m.pontos) adicionarPonto(p);
    desenharMaquina();
  }).catch(() => {});
  req('horario').then(montarHorario).catch((e) => msgAcao('hor-msg', `Não consegui carregar o horário: ${e.message}`, true));
  cicloRapido();
  cicloLento();
})();
