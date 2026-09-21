import type { CartItem, Product } from "../types";
import type { CheckoutCart } from "../checkout/checkoutDependencies";
import { cartItemKey, fixedPriceEffectiveUnitPrice, fixedPriceLineTotal, fixedPriceQuantityGrams, resolveFixedPriceOptions } from "../lib/fixedPriceOptions";
import { getCartStockIssues } from "../lib/cartStock";

// Presentation only; the server recalculates all amounts from emulator product documents.
export function testCheckoutCart(items: CartItem[], products: Product[], promotionSelections: CheckoutCart["promotionSelections"] = [], setPromotionSelection: CheckoutCart["setPromotionSelection"] = () => {}): CheckoutCart {
  const lines: CheckoutCart["lines"] = [];
  const cartWarnings: string[] = [];
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    const option = product && resolveFixedPriceOptions(product).find((o) => o.id === item.fixedPriceOptionId);
    if (!product || (item.purchaseMode === "fixed_price" && !option)) {
      cartWarnings.push("Produit ou format indisponible dans le catalogue test.");
      continue;
    }
    const fixed = item.purchaseMode === "fixed_price" ? option : undefined;
    lines.push({ ...item, product, lineKey: cartItemKey(item), fixedPriceOption: fixed,
      quantityGrams: fixed ? fixedPriceQuantityGrams(fixed, item.quantity) : item.quantity,
      lineTotal: fixed ? fixedPriceLineTotal(fixed, item.quantity) : product.price * item.quantity,
      unitPrice: fixed ? fixedPriceEffectiveUnitPrice(fixed) : product.price });
  }
  cartWarnings.push(...getCartStockIssues(lines).map((issue) => issue.message));
  return { items, lines, promotionSelections, setPromotionSelection, cartWarnings, hasBlockingCartIssues: cartWarnings.length > 0,
    itemCount: lines.reduce((sum, line) => sum + line.quantityGrams, 0),
    subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0) };
}
