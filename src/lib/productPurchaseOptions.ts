import type { CartItem, Product } from "../types";
import { availableProductStock, isProductOrderable } from "./cartStock";
import {
  cartItemKey,
  fixedPriceQuantityGrams,
  positiveInteger,
  resolveFixedPriceOptions,
} from "./fixedPriceOptions";

export type ProductPurchaseOption = {
  id: string;
  fixedPriceOptionId?: string;
  quantityGrams: number;
  totalPrice: number;
  available: boolean;
};

export function cartProductQuantityGrams(
  product: Product,
  cartItems: CartItem[],
  excludedLineKey?: string,
) {
  const fixedPriceOptions = resolveFixedPriceOptions(product);

  return cartItems.reduce((total, item) => {
    if (item.productId !== product.id || cartItemKey(item) === excludedLineKey) return total;

    const quantity = positiveInteger(item.quantity);
    if (item.purchaseMode !== "fixed_price") return total + quantity;

    const option = fixedPriceOptions.find((entry) => entry.id === item.fixedPriceOptionId);
    // An obsolete fixed-price line already blocks checkout. Reserving the whole
    // stock here also prevents the storefront from offering additional grams.
    if (!option) return total + availableProductStock(product);
    return total + fixedPriceQuantityGrams(option, quantity);
  }, 0);
}

export function remainingProductStock(
  product: Product,
  cartItems: CartItem[],
  excludedLineKey?: string,
) {
  return Math.max(
    0,
    availableProductStock(product) -
      cartProductQuantityGrams(product, cartItems, excludedLineKey),
  );
}

export function resolveProductPurchaseOptions(
  product: Product,
  cartItems: CartItem[] = [],
): ProductPurchaseOption[] {
  if (product.isActive === false) return [];

  const availableStock = remainingProductStock(product, cartItems);
  const baseOption: ProductPurchaseOption = {
    id: "gram",
    quantityGrams: 1,
    totalPrice: Number(product.price || 0),
    available: isProductOrderable(product) && availableStock >= 1,
  };
  const fixedPriceOptions = resolveFixedPriceOptions(product).map((option) => ({
    id: `fixed-price-${option.id}`,
    fixedPriceOptionId: option.id,
    quantityGrams: option.quantityGrams,
    totalPrice: option.totalPrice,
    available: isProductOrderable(product) && availableStock >= option.quantityGrams,
  }));

  return [baseOption, ...fixedPriceOptions];
}

export function productPurchaseOptionLabel(option: ProductPurchaseOption) {
  return `${option.quantityGrams} g · ${formatProductPrice(option.totalPrice)}`;
}

export function productPurchaseCtaLabel(option: ProductPurchaseOption) {
  return `${option.quantityGrams} g — ${formatProductPrice(option.totalPrice)}`;
}

export function formatProductPrice(value: number) {
  return `${Number(value || 0).toFixed(2).replace(".", ",")} €`;
}
