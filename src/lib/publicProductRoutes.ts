import { products } from "../data/products.js";

export const publicProductRoutes = products.filter((product) => product.isActive).map(({ id, slug }) => ({ id, slug }));

export function publicProductRoute(slug: string) {
  return publicProductRoutes.find((product) => product.slug === slug);
}
