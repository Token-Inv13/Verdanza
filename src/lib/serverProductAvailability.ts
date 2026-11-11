import type { Product } from "../types/index.js";

export const SERVER_AVAILABILITY_SCRIPT_ID = "verdanza-server-availability";
export const SERVER_AVAILABILITY_MAX_AGE_MS = 120_000;
export type ProductAvailabilityUrl = "https://schema.org/InStock" | "https://schema.org/OutOfStock";
export type ServerProductAvailability = {
  version: 1;
  productId: string;
  slug: string;
  availability: ProductAvailabilityUrl;
  verifiedAt: string;
};

export function parseServerProductAvailability(value: unknown, product: Pick<Product, "id" | "slug">, elapsedMs: number) {
  if (!value || typeof value !== "object" || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > SERVER_AVAILABILITY_MAX_AGE_MS) return undefined;
  const snapshot = value as Partial<ServerProductAvailability>;
  if (snapshot.version !== 1 || snapshot.productId !== product.id || snapshot.slug !== product.slug) return undefined;
  if (!snapshot.verifiedAt || !Number.isFinite(Date.parse(snapshot.verifiedAt))) return undefined;
  return snapshot.availability === "https://schema.org/InStock" || snapshot.availability === "https://schema.org/OutOfStock"
    ? snapshot.availability : undefined;
}

// This only preserves recently verified public availability during client loading.
// It never supplies quantities or authorizes a cart/checkout operation.
export function serverProductAvailability(product: Pick<Product, "id" | "slug">) {
  if (typeof document === "undefined" || typeof window === "undefined") return undefined;
  if (window.location.pathname.replace(/\/+$/, "") !== `/produits/${product.slug}`) return undefined;
  const script = document.getElementById(SERVER_AVAILABILITY_SCRIPT_ID);
  if (!script?.textContent) return undefined;
  try {
    return parseServerProductAvailability(JSON.parse(script.textContent), product, window.performance.now());
  } catch {
    return undefined;
  }
}
