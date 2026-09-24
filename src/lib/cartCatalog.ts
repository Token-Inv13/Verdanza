import type { CartItem, Product } from "../types";
import { isProductOrderable } from "./cartStock";
import { resolveFixedPriceOptions } from "./fixedPriceOptions";

export type CartCatalogState = {
  products: Product[];
  commerceAvailable: boolean;
};

export const emptyCartCatalog: CartCatalogState = {
  products: [],
  commerceAvailable: false,
};

export function findOrderableCartProduct(
  catalog: CartCatalogState,
  productId: string,
) {
  if (!catalog.commerceAvailable) return undefined;
  const product = catalog.products.find((entry) => entry.id === productId);
  return isProductOrderable(product) ? product : undefined;
}

export function getCartCatalogWarnings(
  catalog: CartCatalogState,
  items: CartItem[],
) {
  if (items.length === 0) return [];
  if (!catalog.commerceAvailable) {
    return [
      "La disponibilité des produits ne peut pas être vérifiée. Le panier reste temporairement non commandable.",
    ];
  }

  return items.flatMap((item) => {
    const product = catalog.products.find((entry) => entry.id === item.productId);
    if (!product) return ["Un produit de votre panier n'est plus disponible."];
    if (item.purchaseMode !== "fixed_price") return [];
    const fixedPriceOption = resolveFixedPriceOptions(product).find(
      (entry) => entry.id === item.fixedPriceOptionId,
    );
    return fixedPriceOption
      ? []
      : [
          `Le format choisi pour ${product.name} n'est plus disponible. Retirez la ligne et selectionnez a nouveau un format.`,
        ];
  });
}
