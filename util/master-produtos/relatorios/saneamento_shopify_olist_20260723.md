# Saneamento Shopify × Olist — 22-23/07/2026

## Resultado final (verificado)

| Checagem | Resultado |
|---|---|
| Produtos Shopify | 198 — todos simples (variante única `Default Title`) |
| Itens ativos no Olist/Tiny | 198 — todos simples (tipo N), todos com SKU |
| Cobertura Shopify ↔ Olist | 1:1 — zero faltando, zero sobrando, zero SKU duplicado |
| Travessão (—) em títulos/descrições/nomes | 0 (era 190 títulos + 130 descrições + 56 nomes no Tiny) |
| Emojis | 0 |
| Violações de conformidade de marca ("peça original AGCO/LIVENZA" etc.) | 0 (eram 43) |
| Custo (unitCost) na Shopify | 191/198 (os 7 restantes não têm custo em nenhuma fonte) |
| Preço/custo Olist × Shopify (amostra via `produto.obter`) | 100% após correções |

## O que foi feito

### Shopify
1. **45 produtos** com variante única "Padrão" (`Título: Padrão`) convertidos para `Title: Default Title` — era isso que fazia a integração criar pai+filho no Olist.
2. **Kit Ponta de Cerca** (único com 2 variantes reais) desmembrado em 2 produtos simples: `GR140990-30M` e `GR140990-20M` (preço R$ 1.830,32, custo R$ 1.097, estoque 10 cada, descrições específicas por metragem).
3. **197 descrições + títulos padronizados**: travessão → traço simples, sem emoji, template único (intro → Conteúdo do kit → Aplicação → Compatibilidade + disclaimer → Especificações → bloco padrão "Por que comprar na APP Agro Peças?"), correção de 43 textos que afirmavam "peça original AGCO/LIVENZA/John Deere" → "peça no padrão original (OEM), de fornecedor com certificação ISO".
4. **27 custos STARA** preenchidos a partir da planilha master (estavam vazios).

### Olist/Tiny
1. **Pai/filho eliminados**: 49 pais + 50 variações renomeados `[OLD]`, recodificados (`SKU-OLD`) e **inativados** (API v2 não tem exclusão) — histórico de pedidos/NF preservado nos itens antigos.
2. **48 itens simples recriados** com nome limpo, preço da Shopify, custo, NCM, origem, peso e imagens.
3. **Kits sincronizados**: a integração criou 44 na madrugada de 22/07; criei os 7 restantes via API. Custo real (`preco_custo`) gravado nos 52 kits (a integração criava com custo 0 no campo real).
4. **70 SKUs restaurados**: os registros antigos do Tiny estavam com o campo código vazio (defeito de dados anterior à intervenção — a listagem mostrava um índice antigo). Restaurados a partir do backup de 21/07.
5. **11 duplicatas/lixo inativados**: 9 kits sem código duplicados + 2 duplicatas antigas pré-existentes (`BOMBA APLICACION MF A-028 PROTOTIPO`, `MLR 160`) + 2 sensores Agral órfãos (SFLX2/PUL-2, preço zero, sem par na Shopify).
6. **27 custos STARA** preenchidos + travessão removido de 52 nomes.

## Pendências / observações

- **7 SKUs sem custo em nenhuma fonte** (master vazia): `5.0209.0547219`, `ACX2865730`, `CQ73378`, `IPCX03007010`, `KK31823`, `KK31824`, `KK31825`. Obs.: o kit `ACX2865730-KIT60` tem custo 601,20 → custo unitário implícito ~10,02; os kits KK/CQ/IPCX também têm custo no kit — se quiser, dá para derivar o unitário e preencher.
- **Master inconsistente em `ACW0551840`**: custo 228,75 na planilha é do kit de 25 (unitário real 9,15, já correto na Shopify).
- **Limpeza opcional na UI do Olist**: ~110 itens inativos com sufixo `[OLD]`/`[DUP]` podem ser excluídos em massa (Produtos → filtro situação Inativo). Não é obrigatório.
- **Pedido faturado nº 5** (Tampa Módulo SRM, 60 un) e o saldo −60 ficaram no item antigo inativo — correto para rastreabilidade; o item novo `ACX2865730` nasce com saldo 0.
- **Monitorar a próxima sync da integração**: conferir se ela vincula os itens novos por SKU e não recria nada (se recriar, vincular manualmente por SKU no painel da integração).
- A listagem da API do Tiny (`produtos.pesquisa`) exibe preço/custo defasados — para conferência use sempre a tela do produto ou `produto.obter`.
