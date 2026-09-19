export const CAGNOTTE_PRODUCTION_FIXTURE_MARKER =
  "verdanza-cagnotte-production-fixture-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID = "verdanza-1f621" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_UID =
  "verdanza-cagnotte-production-fixture-user-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID =
  "verdanza-cagnotte-production-fixture-product-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID =
  "verdanza-cagnotte-production-fixture-order-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID =
  "c011ec7e-0001-4000-8000-000000000001" as const;

export type CagnotteProductionFixtureMarker = Readonly<{
  schemaVersion: 1;
  marker: typeof CAGNOTTE_PRODUCTION_FIXTURE_MARKER;
  projectId: typeof CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID;
  uid: typeof CAGNOTTE_PRODUCTION_FIXTURE_UID;
  productId: typeof CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID;
  orderId: typeof CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID;
  checkoutRequestId: typeof CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID;
}>;

const fixtureMarkerKeys = Object.freeze([
  "schemaVersion",
  "marker",
  "projectId",
  "uid",
  "productId",
  "orderId",
  "checkoutRequestId",
] as const);

export function cagnotteProductionFixtureMarker(): CagnotteProductionFixtureMarker {
  return {
    schemaVersion: 1,
    marker: CAGNOTTE_PRODUCTION_FIXTURE_MARKER,
    projectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
    uid: CAGNOTTE_PRODUCTION_FIXTURE_UID,
    productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
    orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
    checkoutRequestId: CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
  };
}

export function isExactCagnotteProductionFixtureMarker(
  value: unknown,
): value is CagnotteProductionFixtureMarker {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== fixtureMarkerKeys.length ||
    !fixtureMarkerKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  ) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    value.marker === CAGNOTTE_PRODUCTION_FIXTURE_MARKER &&
    value.projectId === CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID &&
    value.uid === CAGNOTTE_PRODUCTION_FIXTURE_UID &&
    value.productId === CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID &&
    value.orderId === CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID &&
    value.checkoutRequestId === CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID
  );
}

export function isExactCagnotteProductionFixtureCustomer(value: unknown): boolean {
  if (!isRecord(value) || value.uid !== CAGNOTTE_PRODUCTION_FIXTURE_UID) return false;
  if (
    Object.prototype.hasOwnProperty.call(value, "id") &&
    value.id !== CAGNOTTE_PRODUCTION_FIXTURE_UID
  ) {
    return false;
  }
  return isExactCagnotteProductionFixtureMarker(value.productionFixture);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
