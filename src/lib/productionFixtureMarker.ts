import type { Product } from "../types/index.js";

export function hasOwnProductionFixtureMarker(
  value: unknown,
): value is Record<"productionFixture", unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "productionFixture"),
  );
}

export function filterOrdinaryProducts<T>(products: readonly T[]): T[] {
  return products.filter((product) => !hasOwnProductionFixtureMarker(product));
}

export function productionFixtureProductIds(products: readonly unknown[]) {
  return new Set(
    products.flatMap((product) => {
      if (!hasOwnProductionFixtureMarker(product)) return [];
      const id = String((product as { id?: unknown }).id || "").trim();
      return id ? [id] : [];
    }),
  );
}

export function filterOrdinarySupplierPurchases<T>(
  products: readonly unknown[],
  purchases: readonly T[],
): T[] {
  const fixtureProductIds = productionFixtureProductIds(products);
  if (!fixtureProductIds.size) return [...purchases];
  return purchases.filter((purchase) => {
    if (!purchase || typeof purchase !== "object") return true;
    const lines = (purchase as { lines?: unknown }).lines;
    if (!Array.isArray(lines)) return true;
    return !lines.some((line) => (
      line &&
      typeof line === "object" &&
      fixtureProductIds.has(
        String((line as { productId?: unknown }).productId || "").trim(),
      )
    ));
  });
}

export function assertOrdinaryProductAdminMutationAllowed(value: unknown) {
  if (hasOwnProductionFixtureMarker(value)) {
    throw new Error("production_fixture_product_admin_mutation_forbidden");
  }
}

export function assertOrdinaryCustomerAdminMutationAllowed(value: unknown) {
  if (hasOwnProductionFixtureMarker(value)) {
    throw new Error("production_fixture_customer_admin_mutation_forbidden");
  }
}

export function ordinaryProductStockMutation(
  product: Product,
  stock: number,
  lowStockThreshold: number,
) {
  assertOrdinaryProductAdminMutationAllowed(product);
  return {
    productId: product.id,
    stock,
    lowStockThreshold,
  };
}
