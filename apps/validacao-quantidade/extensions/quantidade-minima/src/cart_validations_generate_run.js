// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

// ── Regra de negócio ──────────────────────────────────────────────
// Peças com preço unitário ABAIXO deste valor (em R$) exigem um
// pedido mínimo. Peças de PRICE_THRESHOLD ou mais não têm mínimo.
const PRICE_THRESHOLD = 200; // R$
const MIN_QUANTITY = 50; // unidades
// ──────────────────────────────────────────────────────────────────

/**
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const errors = [];

  for (const line of input.cart.lines) {
    // Só valida variantes de produto (ignora gift cards etc.)
    if (line.merchandise.__typename !== "ProductVariant") {
      continue;
    }

    // Preço unitário da linha (string tipo "129.90") → número
    const unitPrice = parseFloat(line.cost.amountPerQuantity.amount);

    if (unitPrice < PRICE_THRESHOLD && line.quantity < MIN_QUANTITY) {
      const nome = line.merchandise.product?.title ?? "Este item";
      errors.push({
        message:
          `${nome}: para peças abaixo de R$${PRICE_THRESHOLD} o pedido mínimo é ` +
          `${MIN_QUANTITY} unidades. Ajuste a quantidade para continuar.`,
        // "$.cart" faz a mensagem aparecer no carrinho/checkout como um todo.
        target: "$.cart",
      });
    }
  }

  return {
    operations: [
      {
        validationAdd: { errors },
      },
    ],
  };
}
