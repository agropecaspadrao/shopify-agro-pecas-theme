# Plano — Central de Integrações, Saneamento e Dashboard Executivo

## Contexto

A operação hoje tem 3 sistemas que precisam andar juntos, mas divergem: a **planilha
central no Google Sheets** (onde as áreas de negócio cadastram itens, preços e textos),
a **loja Shopify** (ecom) e o **Olist/Tiny** (ERP/estoque/NF). O objetivo é: (1) sanear
os dados nos 3, (2) tornar a planilha central a fonte da verdade que sobe para o ecom,
(3) dar ao executivo um dashboard branded, seguro e autoatualizável para acompanhar a
saúde das integrações (fotos, descrições, divergências, itens faltantes).

Este plano cobre **todos** os pedidos, agrupados por tema, para conferência.

---

## Descobertas da investigação (estado atual)

- Planilha central `1FoyfpY5E4Z4dYcEk7hiP2Jrg_dts6teu` é **privada** (HTTP 401). Não
  consigo ler sem credencial. Porém `admin@agropecaspadrao.com.br` **já está no gcloud
  desta máquina** (com ADC) — caminho viável para acesso.
- Shopify: 198 produtos ativos. **70 sem foto**, **9 títulos com "BOI"**,
  **12 títulos "APLICACION/APLICATION"**, **12 descrições com "Aplicacion/Aplication"**,
  4 "PROTOTIPO". Motores já tipados como `Bombas Hidráulicas` (53 no total do tipo).
- Coleções ainda **manuais** (não recebem produto novo sozinhas).
- Olist/Tiny: ~110 itens inativos `[OLD]`/`[DUP]`. **API v2 não tem exclusão**
  (`produto.excluir` → 404) — remoção definitiva só pela UI do Tiny ou migrando p/ API v3.
- `clasp` não instalado; `gcloud`, `gh`, `node`, `python3` sim. libs Google Python ausentes.

---

## Parte A — Saneamento Shopify (ecom)

1. **Coleção "Bombas Hidráulicas" recebe bombas + motores.** Converter a coleção manual
   em **automática** por regra `Tipo do produto = Bombas Hidráulicas` (já engloba os
   motores). Idem "Peças Plásticas Injetadas" e "Sensores Agrícolas". ⚠️ destrutivo:
   exige excluir e recriar a coleção preservando handle/URL, descrição, imagem e SEO.
2. **"BOI" → "Bomba Hidráulica"** nos 9 títulos e em descrições onde aparecer, na loja.
3. **"Aplicacion/Aplicación/Aplication" → "Aplicação"** nas 12 descrições (e "APLICACION"
   nos títulos das bombas de aplicação, mantendo o modelo, ex.: "Bomba de Aplicação MF A-026…").
4. **Títulos ecom ↔ planilha**: onde o título do ecom é bom (ex.: "Bomba Hidráulica Massey
   Ferguson MF A-016 - Trator 4299"), levar para a planilha. Onde o título ainda é cru
   (BOI/APLICACION/PROTOTIPO), padronizar com a nomenclatura boa e refletir nos dois.
5. Rechecar os problemas já tratados (variantes, custos, conformidade de marca) para garantir
   que nada regrediu.

## Parte B — Olist/Tiny (limpeza dos inativos)

- Os `[OLD]`/`[DUP]` já estão **inativos** → somem da lista operacional padrão do Tiny
  (que mostra ativos por default). Para **remover de vez** há 2 caminhos, pois a API v2
  não exclui:
  - **(recomendado)** Passo-a-passo de exclusão em massa na UI do Tiny (filtro Situação =
    Inativo → selecionar tudo → excluir). Eu preparo a lista exata de IDs/códigos.
  - Migrar para **API v3 (OAuth)** que tem DELETE — mais setup, faço se preferir automação total.

## Parte C — Planilha central (Google Sheets) como fonte da verdade

1. **Conectar** (ver Decisão 1) e mapear estrutura real das abas.
2. **Repaginar**: padrão visual de marca (cabeçalho verde `#1B4332`, linhas zebradas,
   destaque dourado `#D4AF37`), congelar cabeçalho, filtros, validações, formatação
   condicional (ex.: sem foto = vermelho, sem preço = amarelo), aba "LEIA-ME".
3. **Sincronizar títulos** com os do ecom (bons) e aplicar BOI→Bomba Hidráulica /
   Aplicacion→Aplicação também na planilha.
4. **Definir a planilha como origem do fluxo** "negócio edita → sobe pro ecom/Tiny"
   (substitui o `.xlsx` local como master).

## Parte D — Dashboard executivo (página segura com login Google)

- **Inventário de integrações** Planilha × Site × Olist: contagens, itens em cada sistema,
  divergências de preço, SKUs faltando em cada lado, cobertura 1:1.
- **Estatísticas de conteúdo**: % com/sem foto + **lista dos sem foto**; **score de
  qualidade de descrição** (definido abaixo) com lista das "ruins"; itens importantes
  (curva ABC / bombas) com campos faltando.
- **Score de descrição (0–100)**: penaliza descrição curta (<200 char), título cru
  (BOI/APLICACION/PROTOTIPO), ausência de seções (Compatibilidade/Especificações),
  espanhol residual, sem código OEM, sem foto. Faixas: Boa ≥80, Média 50–79, Ruim <50.
- **Cenários de teste** Planilha vs Site vs Olist (produtiza os scripts de verificação já
  criados): preço bate nos 3, custo presente, cobertura de SKU, foto presente, etc. —
  cada cenário com verde/vermelho e lista de exceções.
- **Marca**: logos, paleta e tipografia da APP; layout limpo para o executivo.
- **Segurança**: login Google restrito a `comercial@`, `admin@`, `socios@agropecaspadrao.com.br`;
  allowlist server-side; rate limiting + lockout por tentativas; segredos (tokens Shopify/Tiny)
  fora do cliente; escape de dados (anti-XSS); log de acesso.

## Parte E — Automação (cron + refresh sob demanda)

- **Cron no Mac** (madrugada, ~3h) roda o pipeline: puxa Shopify + Tiny, lê a planilha,
  calcula auditorias/stats e grava a aba de dados do dashboard. Também um comando
  "atualizar agora" para quando você pedir.
- Dashboard lê os dados já calculados (rápido e barato).

---

## Decisões que preciso de você (ver perguntas)

1. **Como acessar a planilha central** (service account dedicada × usar admin@ já logado).
2. **Arquitetura do dashboard/login** (Google Apps Script × app Node hospedado × página estática).
3. **Confirmar ações destrutivas** (recriar coleções; preparar/exclusão dos inativos no Tiny).

## Ordem de execução (após aprovação)

1. Acesso à planilha → inspeção da estrutura real (destrava Partes C e D).
2. Saneamento Shopify (A) + preparar limpeza Tiny (B).
3. Repaginar + sincronizar planilha (C).
4. Pipeline de dados + cron (E).
5. Dashboard + login + deploy (D).
6. Cenários de teste rodando e verdes; enviar link.

## Verificação (como validar no fim)

- Buscar no site "0565053", "680005", "5.1302.0565053.0" → peça certa no topo.
- Coleção /collections/bombas-hidraulicas → 53 (bombas+motores), e novo cadastro entra sozinho.
- Nenhum título/descrição com BOI/Aplicacion no site nem na planilha.
- Tiny: só ativos na lista operacional; inativos zerados (ou lista de exclusão entregue).
- Dashboard: login só com os 3 e-mails; KPIs batendo com os scripts; refresh noturno gravando dados.
