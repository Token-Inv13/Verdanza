export function hasOwnProductionFixtureMarker(
  value: unknown,
): value is Record<"productionFixture", unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "productionFixture"),
  );
}

export function assertOrdinaryProductAdminMutationAllowed(value: unknown) {
  if (hasOwnProductionFixtureMarker(value)) {
    throw new Error("production_fixture_product_admin_mutation_forbidden");
  }
}
