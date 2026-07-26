// Dashboard de custos da Carol: página HTML autocontida servida em
// /admin/dashboard?key=CAROL_ADMIN_KEY. Mostra custo por mensagem processada,
// custo por dia e quais conversas gastaram mais.

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

export function paginaDashboard(dados) {
  const { totais, porDia, conversas, mensagensCaras, periodo, modelo, cotacaoBRL, saldo, detalhe } = dados;
  const maxDia = Math.max(...porDia.map((d) => d.custo), 0.000001);
  const idxMax = porDia.findIndex((d) => d.custo === maxDia && maxDia > 0);
  const maisCara = conversas[0] || null;
  const muitosDias = porDia.length > 10;

  const tiles = [
    ...(saldo
      ? [{
          rotulo: 'Saldo estimado do crédito',
          valor: usd(saldo.restante),
          sub: `de ${usd(saldo.credito)} carregados · gasto ${usd(saldo.gasto)} desde ${diaCurto(saldo.desde.slice(0, 10))}`,
        }]
      : []),
    { rotulo: `Custo total (${periodo.dias} dia${periodo.dias > 1 ? 's' : ''})`, valor: usd(totais.custo), sub: `${brl(totais.custo, cotacaoBRL)} estimado${totais.custoSistema ? ` · inclui ${usd(totais.custoSistema)} de sistema` : ''}` },
    { rotulo: 'Mensagens processadas', valor: String(totais.mensagens), sub: `${totais.conversas} conversa${totais.conversas === 1 ? '' : 's'}` },
    { rotulo: 'Custo médio por mensagem', valor: usd(totais.custoMedioMsg), sub: `${brl(totais.custoMedioMsg, cotacaoBRL)} estimado` },
    { rotulo: 'Conversa que mais gastou', valor: maisCara ? usd(maisCara.custo) : 'US$ 0,00', sub: maisCara ? esc(maisCara.cliente) : 'sem conversas no período' },
  ];

  const barras = porDia
    .map((d, i) => {
      const h = Math.max(d.custo > 0 ? 6 : 2, Math.round((d.custo / maxDia) * 150));
      const rotulo = muitosDias ? (i % 5 === 0 || i === porDia.length - 1 ? diaCurto(d.dia) : '') : diaCurto(d.dia);
      const label = i === idxMax ? `<span class="valor-topo">${usd(d.custo)}</span>` : '';
      return `<div class="col" data-tip="${diaCurto(d.dia)}: ${usd(d.custo)} · ${d.mensagens} msg${d.mensagens === 1 ? '' : 's'}">
        ${label}<div class="barra${d.custo > 0 ? '' : ' vazia'}" style="height:${h}px"></div><span class="dia">${rotulo}</span></div>`;
    })
    .join('');

  const linhasConversas = conversas
    .map((c) => {
      const pct = totais.custo > 0 ? (c.custo / totais.custo) * 100 : 0;
      return `<tr>
        <td>${esc(c.cliente)}</td>
        <td>${c.canal === 'whatsapp' ? 'WhatsApp' : 'Site'}</td>
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

  const filtros = [1, 7, 30]
    .map((d) => `<a class="filtro${d === periodo.dias ? ' ativo' : ''}" href="?key=__KEY__&dias=${d}">${d === 1 ? 'Hoje' : `${d} dias`}</a>`)
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Carol · Custos</title>
<style>
:root{--fundo:#fafaf9;--card:#ffffff;--borda:#e7e5e4;--ink:#1c1917;--ink2:#57534e;--ink3:#a8a29e;--verde:#2F6B4F;--verde-claro:#e3efe8}
@media (prefers-color-scheme: dark){:root{--fundo:#171412;--card:#211d1a;--borda:#3a352f;--ink:#f5f5f4;--ink2:#c9c4bd;--ink3:#7d766d;--verde:#5f9e7f;--verde-claro:#28382f}}
*{box-sizing:border-box;margin:0}
body{font:15px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;background:var(--fundo);color:var(--ink);padding:24px;max-width:1100px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}
h2{font-size:15px;margin:28px 0 10px;color:var(--ink)}
.sub{color:var(--ink2);font-size:13px;margin-bottom:16px}
.filtros{display:flex;gap:8px;margin:14px 0 18px}
.filtro{padding:5px 14px;border:1px solid var(--borda);border-radius:999px;background:var(--card);color:var(--ink2);text-decoration:none;font-size:13px}
.filtro.ativo{background:var(--verde);border-color:var(--verde);color:#fff}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--borda);border-radius:10px;padding:14px 16px}
.tile .rotulo{font-size:12px;color:var(--ink2);text-transform:uppercase;letter-spacing:.04em}
.tile .valor{font-size:26px;font-weight:700;margin:2px 0}
.tile .subtile{font-size:12px;color:var(--ink3)}
.grafico{background:var(--card);border:1px solid var(--borda);border-radius:10px;padding:18px 16px 10px;position:relative}
.cols{display:flex;align-items:flex-end;gap:6px;height:196px;border-bottom:1px solid var(--borda)}
.col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:0;min-width:8px;position:relative;padding-bottom:0}
.barra{width:min(60%,26px);background:var(--verde);border-radius:4px 4px 0 0}
.barra.vazia{background:var(--borda)}
.col .dia{font-size:11px;color:var(--ink3);height:18px;margin-top:4px;white-space:nowrap}
.valor-topo{font-size:11px;color:var(--ink2);margin-bottom:3px}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--fundo);font-size:12px;padding:5px 9px;border-radius:6px;opacity:0;transition:opacity .12s;white-space:nowrap;z-index:9}
.tabela-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--borda);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink2);padding:10px 12px;border-bottom:1px solid var(--borda);white-space:nowrap}
td{padding:9px 12px;border-bottom:1px solid var(--borda);vertical-align:top}
tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
th.num{text-align:right}
td.assunto{color:var(--ink2);max-width:340px}
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
</style>
</head>
<body>
<h1>Carol · Dashboard de custos</h1>
<p class="sub">Modelo ${esc(modelo)} · período: ${dataBR(periodo.inicio)} até ${dataBR(periodo.fim)} (Brasília) · cotação exibida: US$ 1 = R$ ${cotacaoBRL.toFixed(2).replace('.', ',')}</p>
<div class="filtros">${filtros}</div>

<div class="tiles">
${tiles.map((t) => `<div class="tile"><div class="rotulo">${t.rotulo}</div><div class="valor">${t.valor}</div><div class="subtile">${t.sub}</div></div>`).join('\n')}
</div>

<h2>Custo por dia</h2>
<div class="grafico"><div class="cols">${barras}</div></div>

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

<p class="nota">Custos calculados por mensagem a partir dos tokens reais de cada chamada (entrada, saída e cache de prompt). Não inclui o relatório diário por e-mail nem os resumos de transferência para o WhatsApp, que custam centavos por dia.${totais.semCusto ? ` ${totais.semCusto} registro${totais.semCusto === 1 ? '' : 's'} antigo${totais.semCusto === 1 ? '' : 's'} sem medição de custo aparece${totais.semCusto === 1 ? '' : 'm'} com custo zero.` : ''}</p>

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
