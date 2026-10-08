# Integração Mercado Livre — APP Agro Peças Padrão

Pipeline que leva os produtos do **Shopify → Mercado Livre** via API, reaproveitando
as fotos do CDN do Shopify (sem re-upload). Pensado para os 144 produtos atuais.

> **Arquitetura:** o Olist/Tiny continua sendo o hub de estoque e pedidos. Este
> pipeline serve para **criar os anúncios em massa** (que é o gargalo do Tiny).
> Depois de criados, mantenha a sincronização de estoque por um lugar só.

---

## 0. Pré-requisitos (uma vez)

```bash
cd util/mercadolivre
pip install -r requirements.txt
cp .env.example ../../.env   # ou edite o .env que já existe na raiz
```

Preencha no `.env` da **raiz** do projeto:

| Chave | Onde conseguir |
|---|---|
| `SHOPIFY_ADMIN_TOKEN` | Shopify Admin → Settings → Apps → Develop apps → criar app → Admin API token (`shpat_…`). Scopes: `read_products, write_products, read_inventory` |
| `ML_APP_ID` / `ML_KEY_SECRET` | Já existem no `.env` (como `ML-APP-ID` / `ML-KEY-SECRET`) |
| `ML_REDIRECT_URI` | Cadastre a **mesma** URL no painel do app ML |
| `GS1_PREFIX` | Prefixo de empresa GS1 Brasil (para EAN globais). Sem ele, `gen_eans` aborta |

---

## 1. Exportar do Shopify

```bash
python3 export_shopify.py
```
Gera `data/produtos_shopify.json` e já reporta quantos estão **sem foto** / **sem dimensão**.

## 2. Corrigir categorias no Shopify (item que você pediu)

```bash
python3 fix_categories.py --discover   # confere a categoria que será usada
python3 fix_categories.py --apply      # grava nos 144 produtos
```

## 3. Gerar EANs e gravar no Shopify

```bash
python3 gen_eans.py            # cria data/ean_map.csv (estável)
python3 gen_eans.py --push     # grava como barcode no Shopify
```

## 4. Montar o CSV-mestre ML-ready

```bash
python3 build_csv.py           # data/ml_produtos.csv  (revise a coluna 'pendencias')
```

## 5. Autorizar o Mercado Livre (uma vez)

```bash
python3 ml_auth.py             # abra a URL, autorize, cole a URL de retorno
```

## 6. Publicar (comece SEMPRE em dry-run)

```bash
python3 ml_publish.py --limit 3        # simula os 3 primeiros
python3 ml_publish.py                  # simula todos
python3 ml_publish.py --publish        # cria de verdade (pausados)
python3 ml_publish.py --publish --status active   # cria já ativos
```
Saída em `data/ml_publish_report.csv` (sku, status, motivo, ml_id).

---

## Limites honestos (leia)

- **Sem foto = não publica.** Vários produtos (BOI/MOTOR MLSW) estão sem imagem no
  Shopify; aparecem como `SEM_FOTO` no relatório. Suba a foto no Shopify e rode de novo.
- **Categoria/atributos do ML são exigentes.** O `domain_discovery` acerta a categoria
  na maioria, mas algumas categorias pedem atributos obrigatórios extras — esses anúncios
  voltam com erro no relatório para ajuste. É iterativo por natureza, não bug.
- **Dimensões** estão como placeholder em quase todos; o ME2 pode pedir medidas reais.
- **Estoque/pedidos**: depois que os anúncios existirem, deixe o Tiny cuidar do estoque
  para não ter dois sistemas brigando.
- **Marca**: o pipeline força marca = "Genérica"; montadora/modelo só como compatibilidade.

---

## Operação dos anúncios existentes (27/09/2026)

| Script | Uso | O que faz |
|---|---|---|
| `ml_precos.py` | `python3 ml_precos.py [--base pcm\|final] [--apply]` | Preço de anúncio que devolve o **líquido da planilha** (comissão por categoria + custo fixo <R$12,51 + frete do vendedor ≥R$79). Rodar DEPOIS de recategorizar. |
| `ml_melhorar.py` | `python3 ml_melhorar.py [--apply] [--only SKU,..] [--step categoria,atributos,descricao,fotos,titulo]` | Categoria certa (ramo Agro > Peças), atributos obrigatórios, descrição a partir do site, fotos do site (branca primeiro), título onde a API deixa. Dry-run gera `relatorios/ml_melhorias_<data>.md`. |
| `ml_fotos_video.py` | `python3 ml_fotos_video.py video.mp4 --sku X [--n 5] [--desc "..."] [--upload MLBxxx] [--manter]` | Vídeo da peça → quadros nítidos → recorte (Vision) → 1200² branco + capa APP → sobe no anúncio. |

Regras que a API impõe (medidas):
- título não muda por API quando o anúncio tem `family_name` (25 dos 37) — só painel web ou relistar;
- `shipping.dimensions` não é editável; medidas vão em `SELLER_PACKAGE_*`;
- comissão muda por categoria (9% Plataforma, 12% Implementos/Bombas, 14% Sementes, 17% Premium);
- 1ª foto: fundo branco, sem texto/logo (a capa APP entra como 2ª).
