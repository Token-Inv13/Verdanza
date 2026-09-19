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
