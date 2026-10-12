import type { Product } from "../types";

export const homeFeaturedProductIds = [
  "flower-cookie-kush-indoor",
  "resin-black-afghan",
  "flower-skittlez-plus",
] as const;

export function selectHomeFeaturedProducts(products: Product[]): Product[] {
  return homeFeaturedProductIds.flatMap((id) => {
    const product = products.find((candidate) => candidate.id === id && candidate.isActive);
    return product ? [product] : [];
  });
}
