# Alinhamento site × planilha master — 01/08/2026

Auditoria completa (preços, títulos, descrições) entre a loja Shopify e a planilha
master do Drive (cópia de 30/07 — token do Drive sem escopo no dia da auditoria).

## Aplicado no site (01/08)

- **112 títulos padronizados** — padrão: `Peça - Marca SKU | Aplicação` (unitário)
  e `Peça - Kit N Unidades - Marca SKU` (kits). Eliminados: 67 títulos em CAIXA
  ALTA, abreviações (HIDR., P/, CJ, 1POL, JD), falta de acento (Vacuo, Conexao,
  Retratil, Manipulo…), "Hooper"→"Hopper", e marca errada em 5 kits
  (AGCO→Massey Ferguson nas dobradiças 4383xxx e acoplamentos 7038xxx).
- **99 intros de descrição** atualizadas com o nome novo da peça.
- **6 preços corrigidos** (planilha = fonte da verdade):
  | SKU | de | para |
  |---|---|---|
  | KK31824 | 303,10 | 249,07 |
  | KK31825 | 252,58 | 210,62 |
  | KK31824-KIT25 | 249,07 | 5.445,19 |
  | KK31824-KIT50 | 471,08 | 10.863,31 |
  | KK31825-KIT25 | 210,62 | 4.540,72 |
  | 6237989M1 | 45,72 | 41,77 |

  Os kits de dedo de algodão estavam com preço de **1 unidade** no kit inteiro
  (erro de colagem) — risco real de venda com prejuízo de ~95%.
- **3 metafields de compatibilidade** corrigidos ("NEM HOLLAND", "Plantandeira", "CASE" duplicado).

## Para gravar na planilha (bloqueado por token do Drive)

`05_alinhar_titulos_planilha.py` pronto e testado com `--local`:
**132 títulos + 1 SKU** (5.0220.0548824.0 → 5.0220.0548824-2). Rodar:

```bash
gcloud auth login admin@agropecaspadrao.com.br --enable-gdrive-access
cd util/master-produtos && python3 05_alinhar_titulos_planilha.py          # confere
python3 05_alinhar_titulos_planilha.py --push                              # grava
```

## Complemento noite de 01/08 — integrações fechadas

- Planilha master gravada (132 títulos + SKU) e **cache de fórmulas restaurado** via
  round-trip Google Sheets (save do openpyxl apaga o cache — ver docstring do 05).
- Tiny/Olist: 6 preços defasados corrigidos com custo (KK31824/25 unitários e kits,
  6237989M1); campo `codigo` restaurado após incidente do `alterar` (bug corrigido
  no `04_sync_tiny.py`).
- Shopify: unitCost dos kits KK31824-KIT25/50 e KK31825-KIT25 = custo do kit inteiro.
- Dashboard: **0 divergência de preço, 0 de custo, 0 faltando no Olist**.
- LaunchAgent do refresh noturno segue quebrado (TCC) — rodar `integra/atualizar.sh`
  manualmente ou dar Full Disk Access ao bash/mover o script para fora de Documents.

## ⚠️ URGENTE — KK31823 (Dedo Recolhedor Algodão Grande): kits suspeitos

Hoje o site vende **KIT25 por R$ 374,50 — mais barato que 1 unidade (R$ 454,66)**
(KIT50 R$ 723,52). Na master, a linha base do KK31823 tem `Qtde Kit=25` e custo
R$ 180, e as linhas de kit derivam o custo DIVIDINDO por 25 (KIT50 → custo R$ 360).
Se o custo de R$ 180 for **por unidade** (como nos irmãos KK31824 = R$ 120 e
KK31825 = R$ 100), os kits deveriam custar ≈ R$ 8.200 (KIT25) e ≈ R$ 16.300 (KIT50)
— a mesma hemorragia que os irmãos tinham. Se R$ 180 for o custo do lote de 25,
o unitário a R$ 454,66 teria margem ~98%, destoando da família.
**Confirmar com a nota do fornecedor qual é o custo unitário real antes de vender
esses kits.** Nada foi alterado no KK31823.

## Pendências de negócio (`pendencias_planilha_20260801.csv`)

- **35 SKUs ativos no site sem linha ativa/preço na master** — 27 peças Stara em
  rascunho (sem peso/frete), KK31823 unitário, IPCX03007010 unitário, CQ73378,
  ACX2865730 unitário, bomba 5.0209.0547219 sem linha.
- **GR140990-20M e GR140990-30M com o MESMO preço no site (R$ 1.830,32)** e uma
  única linha GR140990 na master — confirmar preço do rolo de 30 m com o fornecedor.
- Linhas ADG111.2 / ADG117.1 na aba John Deere sem Title e com preço 0 — limpar ou completar.

## Estado das descrições (auditadas, sem pendência crítica)

198/198 com Especificações, 193/198 com seção Compatibilidade (5 itens Greco de
kit/eletrônica não precisam), 0 violações de conformidade de marca, nenhuma
descrição curta (<200 caracteres).
