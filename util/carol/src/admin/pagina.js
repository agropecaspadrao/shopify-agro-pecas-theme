// HTML do painel do administrador. Sem script nem estilo inline (a CSP só
// permite arquivos do próprio serviço): o visual está em publico/painel.css e
// o comportamento em publico/painel.js. Aqui fica só o esqueleto, que o JS
// preenche e atualiza no lugar, sem recriar a página.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONTES = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap';

function cabeca(titulo) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${esc(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTES}">
<link rel="stylesheet" href="/admin/painel/painel.css">
</head>`;
}

export function paginaLogin(erro = '', voltar = '/admin/painel/') {
  return `${cabeca('Carol · Entrar')}
<body class="pg-login">
<main class="login">
  <div class="login-marca"><span class="marca-nome">Carol</span><span class="marca-sub">Painel do administrador</span></div>
  <form method="post" action="/admin/painel/entrar" autocomplete="off">
    <label for="chave">Chave de administrador</label>
    <input id="chave" name="chave" type="password" required autofocus autocomplete="current-password" maxlength="200">
    <input type="hidden" name="voltar" value="${esc(voltar)}">
    ${erro ? `<p class="erro" role="alert">${esc(erro)}</p>` : ''}
    <button type="submit" class="btn btn-primario">Entrar</button>
    <p class="nota">A sessão vale por 12 horas neste aparelho.</p>
  </form>
</main>
</body>
</html>`;
}

const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function kpi(id, rotulo) {
  return `<div class="kpi"><span class="kpi-rot">${rotulo}</span><span class="kpi-val num" id="${id}">–</span></div>`;
}

export function paginaPainel() {
  const linhasHeat = DIAS.map((d, i) => `<span class="heat-dia">${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][i]}</span>${Array.from({ length: 24 }, (_, h) => `<span class="heat-cel" data-d="${i}" data-h="${h}"></span>`).join('')}`).join('');
  return `${cabeca('Carol · Painel')}
<body>
<header class="topo">
  <div class="topo-marca"><span class="marca-nome">Carol</span><span class="marca-sub">Painel do administrador</span></div>
  <div class="topo-dir">
    <span id="conexao" class="conexao" data-estado="carregando">conectando…</span>
    <a class="link-discreto" href="/admin/dashboard">Custos e conversas</a>
    <form method="post" action="/admin/painel/sair"><button class="btn btn-fantasma" type="submit">Sair</button></form>
  </div>
</header>

<main class="grade">
  <section class="card hero" id="hero" data-status="carregando" aria-live="polite">
    <p class="eyebrow">Agora a Carol está</p>
    <h1 id="st-rotulo" class="status-rotulo">–</h1>
    <p id="st-motivo" class="status-motivo"></p>
    <p id="st-proxima" class="status-proxima"></p>
    <p class="status-regra">Regra de horário: <span id="st-regra"></span></p>
    <p class="mini" id="st-origem"></p>
    <p class="erro" id="st-credito" role="alert" hidden></p>
    <div class="acoes">
      <button id="btn-ligar" class="btn btn-primario" type="button">Ligar agora</button>
      <div class="desligar">
        <label for="sel-horas" class="sr">Desligar por</label>
        <select id="sel-horas">
          <option value="1">por 1 hora</option>
          <option value="2" selected>por 2 horas</option>
          <option value="4">por 4 horas</option>
          <option value="8">por 8 horas</option>
          <option value="12">por 12 horas</option>
          <option value="24">por 24 horas</option>
          <option value="48">por 2 dias</option>
          <option value="72">por 3 dias</option>
          <option value="religar">até eu religar</option>
        </select>
        <button id="btn-desligar" class="btn btn-perigo" type="button">Desligar</button>
      </div>
    </div>
    <p id="acao-msg" class="acao-msg" role="status"></p>
    <p class="nota">Ligar e desligar vale para o WhatsApp. O chat do site atende 24 horas.</p>
  </section>

  <section class="card">
    <h2>Atendimento hoje</h2>
    <div class="kpis">
      ${kpi('k-ativas', 'Conversas ativas (30 min)')}
      ${kpi('k-msgs', 'Mensagens hoje')}
      ${kpi('k-clientes', 'Clientes hoje')}
      ${kpi('k-resposta', 'Tempo médio de resposta')}
      ${kpi('k-agora', 'Respondendo agora')}
      ${kpi('k-erros', 'Erros hoje')}
      ${kpi('k-semresp', 'Sem resposta da Carol hoje')}
    </div>
    <p class="mini" id="k-canais"></p>
    <h3>Limites diários</h3>
    <div class="limite"><span>WhatsApp</span><div class="trilho"><div class="enchimento" id="lim-wa"></div></div><span class="num" id="lim-wa-txt">–</span></div>
    <div class="limite"><span>Site</span><div class="trilho"><div class="enchimento" id="lim-site"></div></div><span class="num" id="lim-site-txt">–</span></div>
  </section>

  <section class="card">
    <h2>Últimas interações</h2>
    <ol class="ultimas" id="ultimas"></ol>
  </section>

  <section class="card largo">
    <h2>Picos de atendimento</h2>
    <p class="mini"><span class="leg leg-hoje"></span>Hoje, por hora <span class="leg leg-media"></span>Média dos últimos 7 dias</p>
    <svg id="graf-horas" class="graf" viewBox="0 0 480 170" preserveAspectRatio="none" role="img" aria-label="Mensagens por hora hoje e média dos últimos 7 dias"></svg>
    <p id="pico-hoje" class="destaque"></p>
    <h3>Dia da semana × hora (média dos últimos 30 dias)</h3>
    <div class="heat" id="heat">${linhasHeat}<span></span>${Array.from({ length: 24 }, (_, h) => `<span class="heat-hora">${h % 6 === 0 ? h + 'h' : ''}</span>`).join('')}</div>
    <p id="pico-semana" class="mini"></p>
  </section>

  <section class="card">
    <h2>Máquina agora</h2>
    <div class="kpis">
      ${kpi('m-cpu', 'Processador')}
      ${kpi('m-mem', 'Memória usada')}
      ${kpi('m-heap', 'Memória do programa')}
      ${kpi('m-lag', 'Atraso interno')}
      ${kpi('m-uptime', 'Ligada há')}
      ${kpi('m-conexoes', 'Conexões abertas')}
    </div>
    <p class="mini">Últimos 10 minutos <span class="leg leg-hoje"></span>Processador <span class="leg leg-media"></span>Memória</p>
    <svg id="graf-maquina" class="graf graf-baixo" viewBox="0 0 480 90" preserveAspectRatio="none" role="img" aria-label="Processador e memória nos últimos 10 minutos">
      <polyline id="pl-cpu" class="linha serie1" points=""></polyline>
      <polyline id="pl-mem" class="linha serie2" points=""></polyline>
    </svg>
    <p class="mini" id="m-versao"></p>
  </section>

  <section class="card">
    <h2>Verificações automáticas</h2>
    <p class="mini" id="saude-quando"></p>
    <ul class="saude" id="saude"></ul>
    <h3>Alertas abertos (24h)</h3>
    <ul class="saude" id="anomalias"></ul>
  </section>

  <section class="card">
    <h2>Servidor no Railway (24h)</h2>
    <p class="mini" id="rw-msg">carregando…</p>
    <div id="rw-dados" hidden>
      <p class="mini">Processador (% de um núcleo) · pico <span class="num" id="rw-pico-cpu"></span></p>
      <svg class="graf graf-baixo" viewBox="0 0 480 80" preserveAspectRatio="none" role="img" aria-label="Processador nas últimas 24 horas"><polyline id="rw-cpu" class="linha serie1" points=""></polyline></svg>
      <p class="mini">Memória (MB) · pico <span class="num" id="rw-pico-mem"></span></p>
      <svg class="graf graf-baixo" viewBox="0 0 480 80" preserveAspectRatio="none" role="img" aria-label="Memória nas últimas 24 horas"><polyline id="rw-mem" class="linha serie2" points=""></polyline></svg>
      <p class="mini" id="rw-rede"></p>
    </div>
  </section>

  <section class="card largo" id="horario">
    <h2>Horário de atendimento no WhatsApp</h2>
    <form id="form-horario">
      <fieldset class="presets" id="presets"><legend class="sr">Quando a Carol atende</legend></fieldset>
      <div id="editor-janelas" hidden>
        <h3>Janelas em que a Carol atende</h3>
        <p class="mini">Se o fim for antes do início, a janela atravessa a meia-noite (ex.: 18:00 até 08:00 do dia seguinte).</p>
        <div id="janelas"></div>
        <button type="button" class="btn btn-fantasma" id="add-janela">+ Adicionar janela</button>
      </div>
      <h3>Expediente da equipe (Dai)</h3>
      <p class="mini">Usado no preset padrão e para a Carol dizer ao cliente quando a equipe volta.</p>
      <div id="expediente"></div>
      <div class="acoes">
        <button type="submit" class="btn btn-primario" id="salvar-horario">Salvar horário</button>
        <button type="button" class="btn btn-fantasma" id="padrao-horario">Voltar ao padrão do servidor</button>
        <span id="hor-msg" class="acao-msg" role="status"></span>
      </div>
      <p class="mini" id="hor-origem"></p>
    </form>
  </section>

  <section class="card" id="card-chave">
    <h2>Palavra-chave dos comandos /carol</h2>
    <p class="mini">Gera uma palavra nova e manda por e-mail aos sócios. Se o e-mail estiver fora, ela aparece aqui uma única vez (nunca sai pelo WhatsApp).</p>
    <div class="acoes">
      <button type="button" class="btn btn-fantasma" id="btn-chave">Gerar nova palavra-chave</button>
      <span id="chave-msg" class="acao-msg" role="status"></span>
    </div>
  </section>
</main>
<script src="/admin/painel/painel.js" defer></script>
</body>
</html>`;
}
