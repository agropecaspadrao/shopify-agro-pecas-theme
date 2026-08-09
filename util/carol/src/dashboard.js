// Dashboard analytics da Carol: página HTML autocontida servida em
// /admin/dashboard?key=CAROL_ADMIN_KEY. Resumo executivo, operação (conversas,
// leads de anúncio, horários de pico), custos com projeção e runway do saldo,
// e exportação das conversas para análise (CSV, TXT, JSON).

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function usd(v) {
  if (!v) return 'US$ 0,00';
  const casas = v < 0.1 ? 4 : 2;
  return 'US$ ' + v.toFixed(casas).replace('.', ',');
}

function brl(v, cotacao) {
  const r = v * cotacao;
  const casas = r < 0.5 ? 3 : 2;
  return 'R$ ' + r.toFixed(casas).replace('.', ',');
}

function dataBR(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function diaCurto(diaISO) {
  const [, m, d] = diaISO.split('-');
  return `${d}/${m}`;
}

// Gráfico de barras genérico (série única na cor da marca): cada item vira uma
// coluna com tooltip; só o maior valor ganha rótulo direto em cima da barra.
function graficoBarras(itens, { valor, rotulo, tip, fmt, passo = 5 }) {
  const max = Math.max(...itens.map(valor), 0.000001);
  const idxMax = itens.findIndex((it) => valor(it) === max && max > 0);
  const muitos = itens.length > 12;
  return itens
    .map((it, i) => {
      const v = valor(it);
      const h = Math.max(v > 0 ? 6 : 2, Math.round((v / max) * 150));
      const rot = muitos ? (i % passo === 0 || i === itens.length - 1 ? rotulo(it, i) : '') : rotulo(it, i);
      const label = i === idxMax ? `<span class="valor-topo">${fmt(v)}</span>` : '';
      return `<div class="col" data-tip="${esc(tip(it))}">
        ${label}<div class="barra${v > 0 ? '' : ' vazia'}" style="height:${h}px"></div><span class="dia">${rot}</span></div>`;
    })
    .join('');
}

export function paginaDashboard(dados) {
  const {
    totais, porDia, porHora, porCanal, anuncios, acompanhar, projecao,
    conversas, mensagensCaras, periodo, modelo, cotacaoBRL, saldo, detalhe,
    extrato, resumoExecutivo, conversasCompletas = [], totalConversas = 0,
  } = dados;
  const totalLeads = (anuncios || []).reduce((s, a) => s + a.leads, 0);
  const runway = projecao?.runwayDias;

  // Métricas da aba "Conversas": sinais de possível perda de contexto
  const totalResets = conversasCompletas.reduce((s, c) => s + c.sinais.resets, 0);
  const convsComReset = conversasCompletas.filter((c) => c.sinais.resets > 0).length;
  const convsJanela = conversasCompletas.filter((c) => c.sinais.janelaCheia).length;

  // ── Tiles ────────────────────────────────────────────────────────────────
  const tilesOperacao = [
    {
      rotulo: 'Conversas de clientes',
      valor: String(totais.conversasClientes || 0),
      sub: `${porCanal.whatsapp.conversas} no WhatsApp · ${porCanal.site.conversas} no site`,
    },
    {
      rotulo: 'Mensagens respondidas',
      valor: String(totais.mensagens),
      sub: `${porCanal.whatsapp.mensagens} no WhatsApp · ${porCanal.site.mensagens} no site`,
    },
    {
      rotulo: 'Leads de anúncio',
      valor: String(totalLeads),
      sub: anuncios.length ? esc(anuncios[0].titulo).slice(0, 60) : 'nenhum lead de anúncio no período',
    },
    {
      rotulo: 'Áudios transcritos',
      valor: String(totais.audios || 0),
      sub: 'mensagens de voz viradas em texto',
    },
    {
      rotulo: 'Conversas a retomar',
      valor: String(acompanhar.length),
      sub: 'pararam nas primeiras mensagens',
    },
  ];

  const tilesCustos = [
    ...(saldo
      ? [{
          rotulo: 'Saldo estimado do crédito',
          valor: usd(saldo.restante),
          sub: runway
            ? runway > 365
              ? 'dura mais de um ano no ritmo atual'
              : `dura ~${Math.round(runway)} dia${Math.round(runway) === 1 ? '' : 's'} no ritmo atual`
            : `de ${usd(saldo.credito)} carregados`,
        }]
      : []),
    {
      rotulo: `Custo total (${periodo.dias} dia${periodo.dias > 1 ? 's' : ''})`,
      valor: usd(totais.custo),
      sub: `${brl(totais.custo, cotacaoBRL)} estimado${totais.custoSistema ? ` · inclui ${usd(totais.custoSistema)} de sistema` : ''}`,
    },
    {
      rotulo: 'Custo médio por mensagem',
      valor: usd(totais.custoMedioMsg),
      sub: `${brl(totais.custoMedioMsg, cotacaoBRL)} estimado`,
    },
    {
      rotulo: 'Projeção mensal',
      valor: usd(projecao?.mensal || 0),
      sub: `${usd(projecao?.custoMedioDia || 0)}/dia no ritmo do período`,
    },
  ];

  const tile = (t) =>
    `<div class="tile"><div class="rotulo">${t.rotulo}</div><div class="valor">${t.valor}</div><div class="subtile">${t.sub}</div></div>`;

  // ── Gráficos ─────────────────────────────────────────────────────────────
  const passoDias = periodo.dias > 30 ? 7 : 5;
  const barrasMsgs = graficoBarras(porDia, {
    valor: (d) => d.mensagens,
    rotulo: (d) => diaCurto(d.dia),
    tip: (d) => `${diaCurto(d.dia)}: ${d.mensagens} msg${d.mensagens === 1 ? '' : 's'}`,
    fmt: (v) => String(v),
    passo: passoDias,
  });
  const barrasCusto = graficoBarras(porDia, {
    valor: (d) => d.custo,
    rotulo: (d) => diaCurto(d.dia),
    tip: (d) => `${diaCurto(d.dia)}: ${usd(d.custo)} · ${d.mensagens} msg${d.mensagens === 1 ? '' : 's'}`,
    fmt: usd,
    passo: passoDias,
  });
  const barrasHora = graficoBarras(porHora, {
    valor: (h) => h.mensagens,
    rotulo: (h) => (h.hora % 3 === 0 || h.hora === 23 ? `${h.hora}h` : ''),
    tip: (h) => `${h.hora}h às ${(h.hora + 1) % 24}h: ${h.mensagens} msg${h.mensagens === 1 ? '' : 's'}`,
    fmt: (v) => String(v),
    passo: 1,
  });

  // ── Tabelas ──────────────────────────────────────────────────────────────
  const tabelaAnuncios = anuncios.length
    ? `<h2>Origem dos leads: anúncios click-to-WhatsApp</h2>
<div class="tabela-wrap"><table>
<thead><tr><th>Anúncio</th><th class="num">Leads</th><th class="num">Msgs</th><th class="num">Custo Carol</th></tr></thead>
<tbody>${anuncios
        .map((a) => `<tr><td>${esc(a.titulo)}</td><td class="num">${a.leads}</td><td class="num">${a.mensagens}</td><td class="num">${usd(a.custo)}</td></tr>`)
        .join('')}</tbody>
</table></div>`
    : '';

  const tabelaAcompanhar = acompanhar.length
    ? `<h2>Conversas para a equipe retomar</h2>
<p class="sub">Clientes que pararam nas primeiras mensagens: vale a Dai dar sequência no horário comercial.</p>
<div class="tabela-wrap"><table>
<thead><tr><th>Cliente</th><th>Canal</th><th class="num">Msgs</th><th>Última atividade</th><th>Último assunto</th></tr></thead>
<tbody>${acompanhar
        .slice(0, 12)
        .map(
          (c) => `<tr>
        <td>${esc(c.cliente)}${c.nome ? `<br><span class="mini">${esc(c.nome)}</span>` : ''}${c.origemAnuncio ? `<br><span class="mini">via anúncio: ${esc(c.origemAnuncio)}</span>` : ''}<br><a class="ver-conv mini" href="#conversas" data-sessao="${esc(c.sessao)}">ver conversa</a></td>
        <td>${c.canal === 'whatsapp' ? 'WhatsApp' : 'Site'}</td>
        <td class="num">${c.mensagens}</td>
        <td>${dataBR(c.ultimaTs)}</td>
        <td class="assunto">${esc(c.ultimaMensagem)}</td>
      </tr>`
        )
        .join('')}</tbody>
</table></div>`
    : '';

  const linhasConversas = conversas
    .map((c) => {
      const pct = totais.custo > 0 ? (c.custo / totais.custo) * 100 : 0;
      return `<tr>
        <td>${esc(c.cliente)}${c.nome ? `<br><span class="mini">${esc(c.nome)}</span>` : ''}${c.origemAnuncio ? `<br><span class="mini">via anúncio: ${esc(c.origemAnuncio)}</span>` : ''}${c.canal !== 'sistema' ? `<br><a class="ver-conv mini" href="#conversas" data-sessao="${esc(c.sessao)}">ver conversa</a>` : ''}</td>
        <td>${c.canal === 'whatsapp' ? 'WhatsApp' : c.canal === 'site' ? 'Site' : 'Sistema'}</td>
        <td class="num">${c.mensagens}</td>
        <td class="num">${c.tokens.toLocaleString('pt-BR')}</td>
        <td class="num">${usd(c.custo)}</td>
        <td><div class="share"><div class="share-fill" style="width:${pct.toFixed(1)}%"></div><span>${pct.toFixed(1)}%</span></div></td>
        <td>${dataBR(c.ultimaTs)}</td>
        <td class="assunto">${esc(c.ultimaMensagem)}</td>
      </tr>`;
    })
    .join('');

  const linhasMsgs = mensagensCaras
    .map(
      (m) => `<tr>
        <td>${dataBR(m.ts)}</td>
        <td>${esc(m.cliente)}</td>
        <td class="num">${usd(m.custo)}</td>
        <td class="num">${m.uso ? `${(m.uso.entrada + m.uso.cacheLeitura + m.uso.cacheEscrita).toLocaleString('pt-BR')} entr. / ${m.uso.saida.toLocaleString('pt-BR')} saída` : ''}</td>
        <td class="assunto">${esc(m.mensagem)}</td>
      </tr>`
    )
    .join('');

  // Extrato do crédito: linhas manuais do extrato.json + linha dinâmica do
  // gasto medido desde a sincronização, com saldo acumulado.
  let extratoHtml = '';
  if (saldo && (extrato || []).length) {
    let acumulado = 0;
    const linhas = (extrato || []).map((l) => {
      acumulado += l.valor;
      return `<tr><td>${diaCurto(l.data)}</td><td class="assunto">${esc(l.descricao)}</td><td class="num">${l.valor >= 0 ? '+' : '-'}${usd(Math.abs(l.valor))}</td><td class="num">${usd(acumulado)}</td></tr>`;
    });
    acumulado -= saldo.gasto;
    linhas.push(
      `<tr><td>desde ${diaCurto(saldo.desde.slice(0, 10))}</td><td class="assunto">Atendimentos da Carol medidos automaticamente (${dataBR(saldo.desde)} em diante)</td><td class="num">-US$ ${saldo.gasto.toFixed(4).replace('.', ',')}</td><td class="num"><strong>${usd(acumulado)}</strong></td></tr>`
    );
    extratoHtml = `<h2>Extrato do crédito</h2>
<div class="tabela-wrap"><table>
<thead><tr><th>Quando</th><th>Movimento</th><th class="num">Valor</th><th class="num">Saldo</th></tr></thead>
<tbody>${linhas.join('')}</tbody>
</table></div>`;
  }

  const filtros = [1, 7, 30, 90]
    .map((d) => `<a class="filtro${d === periodo.dias ? ' ativo' : ''}" href="?dias=${d}">${d === 1 ? 'Hoje' : `${d} dias`}</a>`)
    .join('');

  const exportar = [
    ['csv', 'Exportar CSV', 'planilha para Excel/Numbers'],
    ['txt', 'Exportar conversas (TXT)', 'transcrição por conversa, boa para colar numa IA e analisar'],
    ['json', 'JSON', 'dados brutos'],
  ]
    .map(
      ([f, nome, titulo]) =>
        `<a class="botao" title="${titulo}" href="/admin/exportar?dias=${periodo.dias}&formato=${f}">${nome}</a>`
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Carol · Analytics</title>
<style>
:root{--fundo:#fafaf9;--card:#ffffff;--borda:#e7e5e4;--ink:#1c1917;--ink2:#57534e;--ink3:#a8a29e;--verde:#2F6B4F;--verde-claro:#e3efe8}
@media (prefers-color-scheme: dark){:root{--fundo:#171412;--card:#211d1a;--borda:#3a352f;--ink:#f5f5f4;--ink2:#c9c4bd;--ink3:#7d766d;--verde:#5f9e7f;--verde-claro:#28382f}}
*{box-sizing:border-box;margin:0}
body{font:15px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;background:var(--fundo);color:var(--ink);padding:24px;max-width:1100px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}
h2{font-size:15px;margin:28px 0 10px;color:var(--ink)}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink2);margin:18px 0 8px}
.sub{color:var(--ink2);font-size:13px;margin-bottom:10px}
.barra-acoes{display:flex;gap:8px;margin:14px 0 18px;flex-wrap:wrap;align-items:center}
.filtro{padding:5px 14px;border:1px solid var(--borda);border-radius:999px;background:var(--card);color:var(--ink2);text-decoration:none;font-size:13px}
.filtro.ativo{background:var(--verde);border-color:var(--verde);color:#fff}
.sep{flex:1}
.botao{padding:5px 14px;border:1px solid var(--verde);border-radius:8px;background:var(--card);color:var(--verde);text-decoration:none;font-size:13px;font-weight:600}
.botao:hover{background:var(--verde);color:#fff}
.resumo{background:var(--card);border:1px solid var(--borda);border-left:4px solid var(--verde);border-radius:10px;padding:14px 18px;margin-bottom:6px}
.resumo .titulo{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink2);margin-bottom:8px}
.resumo ul{margin:0;padding-left:18px}
.resumo li{margin:4px 0;font-size:14px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--borda);border-radius:10px;padding:14px 16px}
.tile .rotulo{font-size:12px;color:var(--ink2);text-transform:uppercase;letter-spacing:.04em}
.tile .valor{font-size:26px;font-weight:700;margin:2px 0}
.tile .subtile{font-size:12px;color:var(--ink3)}
.graficos{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.grafico{background:var(--card);border:1px solid var(--borda);border-radius:10px;padding:14px 16px 8px;overflow-x:auto}
.grafico .titulo{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink2);margin-bottom:10px}
.cols{display:flex;align-items:flex-end;gap:4px;height:196px;border-bottom:1px solid var(--borda);min-width:min-content}
.col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:7px;position:relative}
.barra{width:min(70%,26px);background:var(--verde);border-radius:4px 4px 0 0}
.barra.vazia{background:var(--borda)}
.col .dia{font-size:10px;color:var(--ink3);height:16px;margin-top:4px;white-space:nowrap}
.valor-topo{font-size:11px;color:var(--ink2);margin-bottom:3px;white-space:nowrap}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--fundo);font-size:12px;padding:5px 9px;border-radius:6px;opacity:0;transition:opacity .12s;white-space:nowrap;z-index:9}
.tabela-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--borda);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink2);padding:10px 12px;border-bottom:1px solid var(--borda);white-space:nowrap}
td{padding:9px 12px;border-bottom:1px solid var(--borda);vertical-align:top}
tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
th.num{text-align:right}
td.assunto{color:var(--ink2);max-width:340px}
.mini{color:var(--ink3);font-size:11px}
.share{position:relative;background:var(--verde-claro);border-radius:4px;min-width:110px;height:20px}
.share-fill{position:absolute;inset:0 auto 0 0;background:var(--verde);border-radius:4px}
.share span{position:relative;font-size:11px;padding-left:6px;line-height:20px;color:var(--ink)}
.nota{font-size:12px;color:var(--ink3);margin-top:18px}
.filtros-msgs{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.filtros-msgs input,.filtros-msgs select{background:var(--card);border:1px solid var(--borda);border-radius:8px;color:var(--ink);font:inherit;font-size:13px;padding:7px 12px}
.filtros-msgs input{flex:1;min-width:220px}
.contagem{font-size:12px;color:var(--ink2);white-space:nowrap}
.scroll{max-height:440px;overflow-y:auto}
.scroll th{position:sticky;top:0;background:var(--card);z-index:1}
td.resposta{color:var(--ink3);font-size:12px;max-width:300px}
.abas{display:flex;gap:6px;border-bottom:1px solid var(--borda);margin:4px 0 18px}
.aba{appearance:none;background:none;border:none;border-bottom:2px solid transparent;padding:8px 14px;font:inherit;font-size:14px;font-weight:600;color:var(--ink2);cursor:pointer}
.aba.ativa{color:var(--verde);border-bottom-color:var(--verde)}
.aba .pill{background:var(--verde-claro);color:var(--verde);border-radius:999px;font-size:11px;padding:1px 8px;margin-left:4px}
.conv{background:var(--card);border:1px solid var(--borda);border-radius:10px;margin-bottom:10px;overflow:hidden}
.conv-cab{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;width:100%;text-align:left;background:none;border:none;font:inherit;color:var(--ink);padding:12px 16px;cursor:pointer}
.conv-cab:hover{background:var(--verde-claro)}
.conv-quem{font-weight:600}
.conv-meta{color:var(--ink3);font-size:12px}
.badge{font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap}
.badge.alerta{background:#fef3c7;color:#92400e}
.badge.erro{background:#fee2e2;color:#991b1b}
.badge.info{background:var(--verde-claro);color:var(--verde)}
.conv-corpo{border-top:1px solid var(--borda);padding:14px 16px;display:flex;flex-direction:column;gap:10px;max-height:560px;overflow-y:auto}
.conv-corpo[hidden]{display:none}
.balao{max-width:78%;border-radius:12px;padding:8px 12px;font-size:13.5px;white-space:pre-wrap;overflow-wrap:break-word}
.balao.cliente{align-self:flex-start;background:var(--verde-claro)}
.balao.carol{align-self:flex-end;background:var(--fundo);border:1px solid var(--borda)}
.balao .meta{display:block;font-size:11px;color:var(--ink3);margin-top:4px;white-space:normal}
.aviso-contexto{align-self:stretch;text-align:center;font-size:12px;border-radius:8px;padding:6px 10px;background:#fef3c7;color:#92400e}
.aviso-contexto.erro{background:#fee2e2;color:#991b1b}
.aviso-contexto.info{background:var(--verde-claro);color:var(--verde)}
@media (prefers-color-scheme: dark){
.badge.alerta,.aviso-contexto{background:#452c07;color:#fcd34d}
.badge.erro,.aviso-contexto.erro{background:#450a0a;color:#fca5a5}
.aviso-contexto.info{background:var(--verde-claro);color:var(--verde)}
}
.ver-conv{color:var(--verde)}
</style>
</head>
<body>
<h1>Carol · Analytics</h1>
<p class="sub">Modelo ${esc(modelo)} · período: ${dataBR(periodo.inicio)} até ${dataBR(periodo.fim)} (Brasília) · cotação exibida: US$ 1 = R$ ${cotacaoBRL.toFixed(2).replace('.', ',')}</p>
<div class="barra-acoes">${filtros}<span class="sep"></span>${exportar}</div>

<nav class="abas">
<button class="aba ativa" data-aba="geral" type="button">Visão geral</button>
<button class="aba" data-aba="conversas" type="button">Conversas <span class="pill">${conversasCompletas.length}</span></button>
</nav>

<section id="aba-geral">
<div class="resumo">
  <div class="titulo">Resumo executivo</div>
  <ul>${(resumoExecutivo || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
</div>

<h3>Operação</h3>
<div class="tiles">${tilesOperacao.map(tile).join('\n')}</div>

<h3>Custos</h3>
<div class="tiles">${tilesCustos.map(tile).join('\n')}</div>

<h2>Movimento e custo</h2>
<div class="graficos">
  <div class="grafico"><div class="titulo">Mensagens por dia</div><div class="cols">${barrasMsgs}</div></div>
  <div class="grafico"><div class="titulo">Custo por dia (US$)</div><div class="cols">${barrasCusto}</div></div>
  <div class="grafico"><div class="titulo">Mensagens por hora do dia (Brasília)</div><div class="cols">${barrasHora}</div></div>
</div>

${tabelaAnuncios}

${tabelaAcompanhar}

${extratoHtml}

<h2>Conversas que mais gastaram</h2>
<div class="tabela-wrap"><table>
<thead><tr><th>Cliente</th><th>Canal</th><th class="num">Msgs</th><th class="num">Tokens</th><th class="num">Custo</th><th>% do período</th><th>Última atividade</th><th>Último assunto</th></tr></thead>
<tbody>${linhasConversas || '<tr><td colspan="8" style="color:var(--ink3)">Sem conversas no período.</td></tr>'}</tbody>
</table></div>

<h2>Cada centavo, mensagem a mensagem</h2>
<div class="filtros-msgs">
  <input id="busca" type="search" placeholder="Filtrar por número, nome, peça ou palavra (ex: bomba, 4198..., João)">
  <select id="fcanal"><option value="">Todos os canais</option><option value="whatsapp">WhatsApp</option><option value="site">Site</option></select>
  <span class="contagem" id="contagem"></span>
</div>
<div class="tabela-wrap scroll"><table>
<thead><tr><th>Quando</th><th>Cliente</th><th>Canal</th><th class="num">Custo</th><th>Cliente disse</th><th>Carol respondeu</th></tr></thead>
<tbody id="corpo-msgs"></tbody>
</table></div>

<h2>Mensagens mais caras</h2>
<div class="tabela-wrap"><table>
<thead><tr><th>Quando</th><th>Cliente</th><th class="num">Custo</th><th class="num">Tokens (entrada / saída)</th><th>Mensagem do cliente</th></tr></thead>
<tbody>${linhasMsgs || '<tr><td colspan="5" style="color:var(--ink3)">Sem mensagens com custo medido no período.</td></tr>'}</tbody>
</table></div>
</section>

<section id="aba-conversas" hidden>
<h3>Conversas do período</h3>
<div class="tiles">
  <div class="tile"><div class="rotulo">Conversas agrupadas</div><div class="valor">${totalConversas}</div><div class="subtile">${conversasCompletas.length < totalConversas ? `mostrando as ${conversasCompletas.length} mais recentes` : 'todas as conversas do período'}</div></div>
  <div class="tile"><div class="rotulo">Possíveis perdas de contexto</div><div class="valor">${totalResets}</div><div class="subtile">${totalResets ? `em ${convsComReset} conversa${convsComReset === 1 ? '' : 's'} · sessão expirada ou reapresentação` : 'nenhum sinal no período'}</div></div>
  <div class="tile"><div class="rotulo">Conversas além da janela</div><div class="valor">${convsJanela}</div><div class="subtile">passaram de 30 mensagens; as antigas saem do contexto</div></div>
</div>
<p class="sub" style="margin-top:14px">Clique numa conversa para abrir a interação completa. Os avisos coloridos marcam os pontos onde a Carol pode ter perdido o contexto: sessão expirada (mais de 12h parada), reapresentação no meio da conversa (histórico vazio por reinício do serviço) e janela de 30 mensagens cheia.</p>
<div class="filtros-msgs">
  <input id="busca-conv" type="search" placeholder="Filtrar por número, nome, peça ou palavra">
  <select id="fcanal-conv"><option value="">Todos os canais</option><option value="whatsapp">WhatsApp</option><option value="site">Site</option></select>
  <select id="fsinal"><option value="">Todas as conversas</option><option value="sinais">Só com sinais de perda de contexto</option></select>
  <span class="contagem" id="contagem-conv"></span>
</div>
<div id="lista-conversas"></div>
</section>

<p class="nota">Custos calculados por mensagem a partir dos tokens reais de cada chamada (entrada, saída e cache de prompt). Projeções e runway do saldo usam o ritmo médio do período selecionado. Saldo oficial: console.anthropic.com.${totais.semCusto ? ` ${totais.semCusto} registro${totais.semCusto === 1 ? '' : 's'} antigo${totais.semCusto === 1 ? '' : 's'} sem medição de custo aparece${totais.semCusto === 1 ? '' : 'm'} com custo zero.` : ''}</p>

<div id="tip"></div>
<script type="application/json" id="dados-msgs">${JSON.stringify(detalhe || []).replace(/</g, '\\u003c')}</script>
<script>
const MSGS = JSON.parse(document.getElementById('dados-msgs').textContent);
const fmtUsd = (v) => v == null ? 'n/d' : 'US$ ' + v.toFixed(v < 0.1 ? 4 : 2).replace('.', ',');
const fmtData = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const busca = document.getElementById('busca');
const fcanal = document.getElementById('fcanal');
function desenharMsgs() {
  const termo = busca.value.trim().toLowerCase();
  const canal = fcanal.value;
  const filtradas = MSGS.filter((m) => {
    if (canal && m.canal !== canal) return false;
    if (!termo) return true;
    return (m.cliente + ' ' + (m.nome || '') + ' ' + m.mensagem + ' ' + m.resposta).toLowerCase().includes(termo);
  });
  const total = filtradas.reduce((s, m) => s + (m.custo || 0), 0);
  document.getElementById('contagem').textContent = filtradas.length + ' mensagem' + (filtradas.length === 1 ? '' : 's') + ' · ' + fmtUsd(total);
  document.getElementById('corpo-msgs').innerHTML = filtradas.map((m) => '<tr>'
    + '<td>' + fmtData(m.ts) + '</td>'
    + '<td>' + escHtml(m.cliente) + (m.nome ? '<br><span style="color:var(--ink3);font-size:11px">' + escHtml(m.nome) + '</span>' : '') + '</td>'
    + '<td>' + (m.canal === 'whatsapp' ? 'WhatsApp' : 'Site') + '</td>'
    + '<td class="num">' + fmtUsd(m.custo) + '</td>'
    + '<td class="assunto">' + escHtml(m.mensagem) + '</td>'
    + '<td class="resposta">' + escHtml(m.resposta) + '</td>'
    + '</tr>').join('') || '<tr><td colspan="6" style="color:var(--ink3)">Nenhuma mensagem com esse filtro.</td></tr>';
}
busca.addEventListener('input', desenharMsgs);
fcanal.addEventListener('change', desenharMsgs);
desenharMsgs();
</script>
<script type="application/json" id="dados-conversas">${JSON.stringify(conversasCompletas).replace(/</g, '\\u003c')}</script>
<script>
// ── Aba Conversas: lista agrupada + transcrição completa ao clicar ─────────
const CONVS = JSON.parse(document.getElementById('dados-conversas').textContent);
const AVISOS = {
  sessao_expirada: ['alerta', 'Mais de 12h desde a mensagem anterior: a sessão expirou e a Carol respondeu SEM memória do que veio antes.'],
  reapresentacao: ['erro', 'A Carol se reapresentou no meio da conversa: o histórico estava vazio nesta resposta (reinício do serviço ou sessão expirada).'],
  janela_cheia: ['info', 'A partir daqui a janela de 30 mensagens está cheia: as mensagens mais antigas vão saindo do contexto da Carol.'],
  falha: ['erro', 'Resposta de contingência: a chamada à API falhou ou veio vazia.'],
};
const temSinais = (c) => c.sinais.resets > 0 || c.sinais.janelaCheia || c.msgs.some((m) => m.flags.includes('falha'));
const buscaConv = document.getElementById('busca-conv');
const fcanalConv = document.getElementById('fcanal-conv');
const fsinal = document.getElementById('fsinal');
const listaConv = document.getElementById('lista-conversas');

function corpoConversa(c) {
  return c.msgs.map((m) => {
    const avisos = m.flags.filter((f) => AVISOS[f]).map((f) => '<div class="aviso-contexto ' + AVISOS[f][0] + '">' + AVISOS[f][1] + '</div>').join('');
    const voz = m.flags.includes('audio') ? ' · mensagem de voz transcrita' : '';
    return avisos
      + '<div class="balao cliente">' + escHtml(m.mensagem) + '<span class="meta">' + fmtData(m.ts) + voz + '</span></div>'
      + '<div class="balao carol">' + escHtml(m.resposta) + '<span class="meta">Carol · ' + fmtUsd(m.custo) + '</span></div>';
  }).join('');
}

function cabConversa(c) {
  const badges = []
    .concat(c.sinais.resets ? ['<span class="badge erro">' + c.sinais.resets + ' perda' + (c.sinais.resets === 1 ? '' : 's') + ' de contexto</span>'] : [])
    .concat(c.sinais.janelaCheia ? ['<span class="badge alerta">janela de 30 msgs cheia</span>'] : [])
    .concat(c.msgs.some((m) => m.flags.includes('falha')) ? ['<span class="badge erro">falha de API</span>'] : [])
    .concat(c.origemAnuncio ? ['<span class="badge info">anúncio</span>'] : [])
    .join(' ');
  return '<span class="conv-quem">' + escHtml(c.cliente) + (c.nome ? ' · ' + escHtml(c.nome) : '') + '</span> ' + badges
    + '<span class="conv-meta">' + (c.canal === 'whatsapp' ? 'WhatsApp' : 'Site') + ' · ' + c.msgs.length + ' interaç' + (c.msgs.length === 1 ? 'ão' : 'ões') + ' · ' + fmtUsd(c.custo) + ' · ' + fmtData(c.primeiraTs) + ' até ' + fmtData(c.ultimaTs) + '</span>';
}

function desenharConversas() {
  const termo = buscaConv.value.trim().toLowerCase();
  const canal = fcanalConv.value;
  const soSinais = fsinal.value === 'sinais';
  const visiveis = CONVS.filter((c) => {
    if (canal && c.canal !== canal) return false;
    if (soSinais && !temSinais(c)) return false;
    if (!termo) return true;
    return (c.cliente + ' ' + c.nome + ' ' + c.msgs.map((m) => m.mensagem + ' ' + m.resposta).join(' ')).toLowerCase().includes(termo);
  });
  const pares = visiveis.reduce((s, c) => s + c.msgs.length, 0);
  document.getElementById('contagem-conv').textContent = visiveis.length + ' de ' + CONVS.length + ' conversas · ' + pares + ' interaç' + (pares === 1 ? 'ão' : 'ões');
  listaConv.innerHTML = visiveis.map((c) => {
    const i = CONVS.indexOf(c);
    return '<div class="conv" data-sessao="' + escHtml(c.sessao) + '">'
      + '<button class="conv-cab" type="button" data-i="' + i + '">' + cabConversa(c) + '</button>'
      + '<div class="conv-corpo" hidden></div></div>';
  }).join('') || '<p class="sub">Nenhuma conversa com esse filtro.</p>';
}

listaConv.addEventListener('click', (ev) => {
  const cab = ev.target.closest('.conv-cab');
  if (!cab) return;
  const corpo = cab.nextElementSibling;
  if (corpo.hidden && !corpo.innerHTML) corpo.innerHTML = corpoConversa(CONVS[Number(cab.dataset.i)]);
  corpo.hidden = !corpo.hidden;
});

buscaConv.addEventListener('input', desenharConversas);
fcanalConv.addEventListener('change', desenharConversas);
fsinal.addEventListener('change', desenharConversas);
desenharConversas();

// ── Troca de abas (persistida no hash da URL) ──────────────────────────────
function ativarAba(nome) {
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === nome));
  document.getElementById('aba-geral').hidden = nome !== 'geral';
  document.getElementById('aba-conversas').hidden = nome !== 'conversas';
  history.replaceState(null, '', nome === 'conversas' ? '#conversas' : location.pathname + location.search);
  // filtros de período preservam a aba ativa
  document.querySelectorAll('.filtro').forEach((a) => { a.href = a.href.split('#')[0] + (nome === 'conversas' ? '#conversas' : ''); });
}
document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => ativarAba(b.dataset.aba)));
if (location.hash === '#conversas') ativarAba('conversas');

// Links "ver conversa" das tabelas da visão geral abrem a conversa na aba
document.querySelectorAll('.ver-conv').forEach((a) => a.addEventListener('click', (ev) => {
  ev.preventDefault();
  buscaConv.value = ''; fcanalConv.value = ''; fsinal.value = '';
  desenharConversas();
  ativarAba('conversas');
  const alvo = listaConv.querySelector('.conv[data-sessao="' + CSS.escape(a.dataset.sessao) + '"]');
  if (alvo) {
    const cab = alvo.querySelector('.conv-cab');
    const corpo = cab.nextElementSibling;
    if (corpo.hidden && !corpo.innerHTML) corpo.innerHTML = corpoConversa(CONVS[Number(cab.dataset.i)]);
    corpo.hidden = false;
    alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}));
</script>
<script>
const tip = document.getElementById('tip');
document.querySelectorAll('.col').forEach((el) => {
  el.addEventListener('mousemove', (e) => {
    tip.textContent = el.dataset.tip;
    tip.style.opacity = 1;
    tip.style.left = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY - 34) + 'px';
  });
  el.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
});
</script>
</body>
</html>`;
}
