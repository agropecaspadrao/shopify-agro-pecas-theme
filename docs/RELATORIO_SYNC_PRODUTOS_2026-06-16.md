# Relatório de Sincronização de Produtos — 16/06/2026

Fonte: `util/APP_Master_Produtos_Shopify.xlsx` × loja `agropecaspadrao.com.br` (144 produtos ativos).

## ✅ Executado na loja

| Ação | Qtde | Detalhe |
|------|------|---------|
| Correção de preço | 1 | `5.0209.0547219` estava **R$ 0,00** → corrigido para **R$ 1.819,36** |
| Peso (frete) | 113 | Peso real da peça gravado na variante (`inventoryItem.measurement.weight`) |
| Dimensões | 109 | Gravadas no metafield `agro.dimensoes_cm` (texto, formato `C × L × A cm`) |
| Imagens duplicadas removidas | 75 (em 38 produtos) | Mantida a versão padronizada `vendor_SKU` (ex: `agco_…`); duplicatas por UUID descartadas |

**Preços:** os 143 produtos casados já estavam com o preço correto da planilha — só houve o 1 ajuste acima.

## ⚠️ Pendências (precisam de ação humana)

### Dimensões suspeitas (provável medida de caixa master, não unidade)
Peso real foi usado no frete (seguro). Mas estas dimensões dariam peso cubado absurdo — revisar:
`GR141207, GR141165, GR140682, GR140012, GR142226, GR142227, GR142228, GR142229, H-102724, A56254, 8031-4009, IPCX03009065, IPCX03009064, IPCX05009034, IPCX03006056, IPCX03006047`

### Códigos divergentes (SKU loja ≠ SKU planilha) — não alterei o SKU
- Loja `5.0220.0548824-2` ↔ planilha `5.0220.0548824.0`
- Loja `5.0209.0547219` ↔ planilha `5.0220.0547219.0` (prefixo 0209 vs 0220)

### 29 produtos SEM peso na planilha (frete impreciso até preencher)
Maioria peças plásticas STARA + a bomba `5.0209.0547219`. Lista completa no fim.

### 64 produtos SEM imagem
Nenhum tem arquivo de foto correspondente em `assets/` nem na pasta de saída local — precisam de fotografia. Lista completa no fim.

---

## Anexo — 64 produtos sem imagem
5.0203.0540803, 5.0220.0547207, 5.0220.0548817, 5.1301.0565029, ACX3473430, ACX2719210, ACX2865730, 6424-4005, 6117-4170, 6424-4004, 6426-1113, 6445-4035, 6445-4041, 7310-5946, 7920-4426, 1084-4162, 6445-4040, 6445-4042, 6039-4130, 6123-4506, 7310-4832, 6424-4008, 6112-4193, 6117-4294, 6424-4092, 10110-4158, 6112-4192, 6117-4251, 6123-4126, 6424-4003, 6435-3320, 6424-4006, 6424-4009, 6424-4022, 6424-4027, 5.1621.0680005.0, 5.1302.0565122.0, 5.1302.0565120.0, 5.0220.0548917.0, 5.0220.L026997.0, 5.5211.L026234.0, 5.5210.L011190.0, 5.0220.0548911.0, 5.0211.L026819.0, 5.0211.L026849.0, 5.0211.L027018.0, 5.1301.0565055.0, 5.1301.0565054.0, 5.0210.L026250.0, 5.0209.L026780.0, 5.1621.0670036.1, 5.1621.0670037.1, 5.1621.0670038.1, 5.1621.0670039.1, 5.1621.0670040.1, 5.1305.0565094.0, 5.1305.0565032.0, 5.1305.0565115.0, 5.1302.0565086.0, 5.1302.0565087.0, 5.1302.0565088.0, 5.1302.0565089.0, 5.1302.L027041.0, 5.0220.L025598.0

## Anexo — 29 produtos sem peso na planilha
10110-4158, 1084-4162, 5.0209.0547219, 6039-4130, 6112-4192, 6112-4193, 6117-4142, 6117-4170, 6117-4251, 6117-4294, 6123-4126, 6123-4506, 6424-4003, 6424-4004, 6424-4006, 6424-4008, 6424-4009, 6424-4022, 6424-4027, 6424-4092, 6426-1113, 6435-3320, 6445-4035, 6445-4040, 6445-4041, 6445-4042, 7310-4832, 7310-5946, 7920-4426
