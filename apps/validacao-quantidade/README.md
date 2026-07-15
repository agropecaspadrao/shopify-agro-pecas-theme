# Quantidade mínima por preço — Shopify Function

Bloqueia o checkout quando uma **peça abaixo de R$200** está no carrinho com
**menos de 50 unidades**. Peças de R$200 ou mais não têm mínimo.

A regra fica em [`extensions/quantidade-minima/src/cart_validations_generate_run.js`](extensions/quantidade-minima/src/cart_validations_generate_run.js)
(constantes `PRICE_THRESHOLD` e `MIN_QUANTITY` no topo — mude ali se precisar).

> ⚠️ Isto **não** sobe pelo GitHub → tema. É um app Shopify e sobe pelo Shopify CLI.

## Passo a passo (uma vez só)

Rode a partir da pasta `apps/validacao-quantidade/`:

```bash
cd apps/validacao-quantidade

# 1. Cria/linka um app Shopify (segue o assistente; escolha a loja Agro Peças).
shopify app init --name validacoes-agro
#   → se preferir dentro desta pasta sem criar subpasta nova, use `shopify app config link`

# 2. Gera o scaffold correto da extensão de validação para a sua versão do CLI.
shopify app generate extension
#   Tipo:  Function  →  "Cart and Checkout Validation"
#   Linguagem: JavaScript
#   Nome: quantidade-minima

# 3. Substitua os 2 arquivos gerados pelos desta pasta:
#      src/cart_validations_generate_run.js      (a regra)
#      src/cart_validations_generate_run.graphql (a consulta de entrada)
#    (mantenha o restante do scaffold gerado pelo CLI)

# 4. Publique a function na loja.
shopify app deploy
```

## Ativar a validação

Depois do `deploy`, a function existe mas ainda não está "ligada".
Peça pro Claude ativar via API (ele roda a mutation `validationCreate` pra você),
ou faça manualmente:

```graphql
# 1) Descubra o id da function:
query {
  shopifyFunctions(first: 25) {
    nodes { id title app { title } }
  }
}

# 2) Ative:
mutation {
  validationCreate(validation: { functionId: "COLE_O_ID_AQUI", enable: true }) {
    validation { id }
    userErrors { field message }
  }
}
```

## Testar

Adicione ao carrinho uma peça de menos de R$200 com quantidade 1 e vá pro
checkout: deve aparecer a mensagem de pedido mínimo e travar o "Finalizar compra".
Com 50+ unidades, passa normal.
