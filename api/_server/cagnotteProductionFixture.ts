import { isDeepStrictEqual } from "node:util";
import { hasOwnProductionFixtureMarker } from "../../src/lib/productionFixtureMarker.js";
import { orderPayload, type CheckoutRequestBody, type PricedCheckout } from "./checkout.js";

export const CAGNOTTE_PRODUCTION_FIXTURE_MARKER =
  "verdanza-cagnotte-production-fixture-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID = "verdanza-1f621" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_UID =
  "verdanza-cagnotte-production-fixture-user-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_EMAIL =
  "cagnotte.production.fixture@verdanza.test" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_TOOL_UID =
  "verdanza-cagnotte-production-fixture-tool-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID =
  "verdanza-cagnotte-production-fixture-product-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID =
  "verdanza-cagnotte-production-fixture-order-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID =
  "c011ec7e-0001-4000-8000-000000000001" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_STOCK_MOVEMENT_ID =
  "verdanza-cagnotte-production-fixture-stock-v1" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_FIXED_PRICE_OPTION_ID =
  "production-fixture-100-eur" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS =
  Date.parse("2026-09-18T12:00:00.000Z");
export const CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT =
  "2026-09-18T13:00:00.000Z" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT =
  "2026-09-18T14:00:00.000Z" as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_HISTORY_NOTE =
  "Commande transmise. Client a contacter pour confirmer disponibilites, livraison et reglement." as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_PAID_HISTORY_NOTE =
  "Paiement synthetique fixture confirme par l outil interne." as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_HISTORY_NOTE =
  "Livraison synthetique fixture confirmee par l outil interne." as const;
export const CAGNOTTE_PRODUCTION_FIXTURE_SIDE_EFFECT_REASON =
  "production_fixture" as const;

export const CAGNOTTE_PRODUCTION_FIXTURE_CHALLENGE = Object.freeze({
  projectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
  uid: CAGNOTTE_PRODUCTION_FIXTURE_UID,
  productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
  orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
});

export const CAGNOTTE_PRODUCTION_FIXTURE_WRITE_CHALLENGE =
  `projectId=${CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID};` +
  `uid=${CAGNOTTE_PRODUCTION_FIXTURE_UID};` +
  `productId=${CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID};` +
  `orderId=${CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID}`;

export type CagnotteProductionFixtureMarker = Readonly<{
  schemaVersion: 1;
  marker: typeof CAGNOTTE_PRODUCTION_FIXTURE_MARKER;
  projectId: typeof CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID;
  uid: typeof CAGNOTTE_PRODUCTION_FIXTURE_UID;
  productId: typeof CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID;
  orderId: typeof CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID;
  checkoutRequestId: typeof CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID;
}>;

const capabilityBrand: unique symbol = Symbol("cagnotte-production-fixture-capability");
const issuedCapabilities = new WeakSet<object>();

export type CagnotteProductionFixtureCapability = Readonly<{
  execution: "production" | "emulator_test";
  marker: CagnotteProductionFixtureMarker;
  [capabilityBrand]: true;
}>;

export function createCagnotteProductionFixtureCapability(input: {
  challenge: Readonly<Record<string, string>>;
  assertExecutionEnvironment: () => void;
}): CagnotteProductionFixtureCapability {
  assertExactChallenge(input.challenge);
  assertEnvironmentCallback(input.assertExecutionEnvironment);
  return issueCapability("production");
}

/** Test-only issuance remains tied to the already isolated Firestore harness. */
export function createCagnotteProductionFixtureTestCapability(
  assertIsolatedTestEnvironment: () => void,
): CagnotteProductionFixtureCapability {
  assertEnvironmentCallback(assertIsolatedTestEnvironment);
  return issueCapability("emulator_test");
}

export function assertCagnotteProductionFixtureCapability(
  value: unknown,
): asserts value is CagnotteProductionFixtureCapability {
  if (!value || typeof value !== "object" || !issuedCapabilities.has(value as object)) {
    throw new Error("production_fixture_capability_required");
  }
  const capability = value as CagnotteProductionFixtureCapability;
  if (!isExactCagnotteProductionFixtureMarker(capability.marker)) {
    throw new Error("production_fixture_capability_invalid");
  }
}

export function cagnotteProductionFixturePaidStatusChange() {
  return {
    paymentStatus: "paid" as const,
    finalPaymentMethod: "other" as const,
    historyNote: CAGNOTTE_PRODUCTION_FIXTURE_PAID_HISTORY_NOTE,
  };
}

export function cagnotteProductionFixtureDeliveredStatusChange() {
  return {
    orderStatus: "delivered" as const,
    historyNote: CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_HISTORY_NOTE,
  };
}

export function assertCagnotteProductionFixtureStatusTransition(input: {
  capability: unknown;
  order: unknown;
  body: object;
  operationTime: string;
}): "mark-paid" | "mark-delivered" {
  if (!isExactCagnotteProductionFixtureOrder(input.order)) {
    throw new Error("production_fixture_marker_invalid");
  }
  if (input.capability === undefined) {
    throw new Error("production_fixture_status_mutation_forbidden");
  }
  assertCagnotteProductionFixtureCapability(input.capability);

  const paid = isDeepStrictEqual(input.body, {
    orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
    ...cagnotteProductionFixturePaidStatusChange(),
  }) && input.operationTime === CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT;
  const delivered = isDeepStrictEqual(input.body, {
    orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
    ...cagnotteProductionFixtureDeliveredStatusChange(),
  }) && input.operationTime === CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT;

  if (paid) return "mark-paid";
  if (delivered) return "mark-delivered";
  throw new Error("production_fixture_status_transition_invalid");
}

export function assertCagnotteProductionFixtureCheckout(input: {
  capability: unknown;
  firebaseProjectId?: string | null;
  customerId?: string;
  orderId: string;
  checkoutRequestId: string;
  body: Record<string, unknown>;
  priced: Record<string, unknown>;
}): CagnotteProductionFixtureMarker {
  assertCagnotteProductionFixtureCapability(input.capability);
  if (
    input.firebaseProjectId !== CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID ||
    input.customerId !== CAGNOTTE_PRODUCTION_FIXTURE_UID ||
    input.orderId !== CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID ||
    input.checkoutRequestId !== CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID ||
    !isDeepStrictEqual(input.body, cagnotteProductionFixtureCheckoutBody()) ||
    !isDeepStrictEqual(input.priced, cagnotteProductionFixturePricedCheckout())
  ) {
    throw new Error("production_fixture_checkout_contract_invalid");
  }
  return input.capability.marker;
}

export function assertCagnotteProductionFixtureProduct(
  marker: CagnotteProductionFixtureMarker,
  productId: string,
  value: Record<string, unknown> | undefined,
) {
  if (
    !isExactCagnotteProductionFixtureMarker(marker) ||
    productId !== CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID ||
    !value ||
    value.isActive !== false ||
    !isExactCagnotteProductionFixtureMarker(value.productionFixture) ||
    !isDeepStrictEqual(
      value,
      cagnotteProductionFixtureProductDocument(CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK),
    )
  ) {
    throw new Error("production_fixture_product_invalid");
  }
}

export function assertCagnotteProductionFixtureOrderItem(
  marker: CagnotteProductionFixtureMarker,
  value: unknown,
) {
  const expected = cagnotteProductionFixturePricedCheckout().orderItems[0];
  if (
    !isExactCagnotteProductionFixtureMarker(marker) ||
    !isDeepStrictEqual(value, expected)
  ) {
    throw new Error("production_fixture_order_item_invalid");
  }
}

export function assertCagnotteProductionFixtureCustomer(
  marker: CagnotteProductionFixtureMarker,
  customerId: string,
  value: Record<string, unknown> | undefined,
) {
  if (
    !isExactCagnotteProductionFixtureMarker(marker) ||
    customerId !== CAGNOTTE_PRODUCTION_FIXTURE_UID ||
    !value ||
    !isDeepStrictEqual(value, cagnotteProductionFixtureCustomerDocument())
  ) {
    throw new Error("production_fixture_customer_invalid");
  }
}

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
  return isDeepStrictEqual(value, cagnotteProductionFixtureMarker());
}

/** Presence is deliberately sufficient for outbound fail-closed checks. */
export function hasPersistedCagnotteProductionFixtureMarker(value: unknown): boolean {
  return hasOwnProductionFixtureMarker(value);
}

export function isExactCagnotteProductionFixtureOrder(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const order = value as Record<string, unknown>;
  return (
    isExactCagnotteProductionFixtureMarker(order.productionFixture) &&
    order.id === CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID &&
    order.checkoutRequestId === CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID &&
    order.customerId === CAGNOTTE_PRODUCTION_FIXTURE_UID &&
    order.customerEmail === CAGNOTTE_PRODUCTION_FIXTURE_EMAIL
  );
}

export const CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK = 20;
export const CAGNOTTE_PRODUCTION_FIXTURE_REMAINING_STOCK = 10;

export function cagnotteProductionFixtureProductDocument(
  stock = CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK,
) {
  return {
    internalReference: "CAGNOTTE-PRODUCTION-FIXTURE-V1",
    slug: "cagnotte-production-fixture-v1",
    name: "Produit synthetique cagnotte Production",
    category: "flowers",
    price: 10,
    fixedPriceMode: "manual",
    fixedPriceOptions: [{
      id: CAGNOTTE_PRODUCTION_FIXTURE_FIXED_PRICE_OPTION_ID,
      totalPrice: 100,
      quantityGrams: 10,
      isActive: true,
      sortOrder: 1,
      source: "manual",
    }],
    shortDescription: "Fixture interne non commercialisable.",
    longDescription: "Produit synthetique inactif reserve a une recette interne bornee.",
    image: "/images/placeholder-product.webp",
    imageAlt: "Fixture interne Verdanza",
    cbdRate: "Fixture",
    cbgRate: "Fixture",
    thcRate: "0,0 % fictif",
    origin: "Fixture interne",
    cultureType: "Autre",
    aromas: ["Fixture"],
    tags: ["production-fixture", "non-commercial"],
    stock,
    lowStockThreshold: 0,
    isActive: false,
    isFeatured: false,
    seoTitle: "Fixture interne inactive",
    seoDescription: "Fixture interne inactive et absente du catalogue public.",
    productionFixture: cagnotteProductionFixtureMarker(),
    createdAt: new Date(CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS).toISOString(),
    updatedAt: new Date(CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS).toISOString(),
  };
}

export function cagnotteProductionFixtureCustomerDocument() {
  return {
    uid: CAGNOTTE_PRODUCTION_FIXTURE_UID,
    email: CAGNOTTE_PRODUCTION_FIXTURE_EMAIL,
    displayName: "Client synthetique cagnotte Production",
    role: "customer",
    isAdmin: false,
    providers: [] as string[],
    productionFixture: cagnotteProductionFixtureMarker(),
    createdAt: new Date(CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS).toISOString(),
    updatedAt: new Date(CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS).toISOString(),
  };
}

export function cagnotteProductionFixtureCheckoutBody() {
  return {
    checkoutRequestId: CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
    items: [{
      productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
      quantity: 1,
      purchaseMode: "fixed_price",
      fixedPriceOptionId: CAGNOTTE_PRODUCTION_FIXTURE_FIXED_PRICE_OPTION_ID,
    }],
    deliveryMethod: "postal",
    deliveryZone: "postal-france",
    complianceAccepted: true,
    preferredPaymentMethod: "card_payment_link",
    customerMessage: "Fixture interne sans traitement externe.",
    customer: {
      firstName: "Client",
      lastName: "Fixture",
      email: CAGNOTTE_PRODUCTION_FIXTURE_EMAIL,
      phone: "0600000000",
      address: {
        firstName: "Client",
        lastName: "Fixture",
        line1: "1 rue de la Fixture",
        line2: "",
        postalCode: "75001",
        city: "Paris",
        country: "FR",
      },
    },
    promotionSelections: [] as unknown[],
    cagnotteUse: { requestedCents: 0 },
  };
}

export function cagnotteProductionFixturePricedCheckout() {
  return {
    orderItems: [{
      productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
      productInternalReference: "CAGNOTTE-PRODUCTION-FIXTURE-V1",
      name: "Produit synthetique cagnotte Production",
      quantity: 10,
      unitPrice: 10,
      lineTotal: 100,
      purchaseMode: "fixed_price",
      fixedPriceOptionId: CAGNOTTE_PRODUCTION_FIXTURE_FIXED_PRICE_OPTION_ID,
      fixedPriceQuantity: 1,
      fixedPriceTotal: 100,
      fixedPriceGrams: 10,
      slug: "cagnotte-production-fixture-v1",
      category: "flowers",
      cultureType: "Autre",
    }],
    subtotal: 100,
    deliveryFee: 0,
    discountAmount: 0,
    promoApplied: false,
    promotionDiscountTotal: 0,
    appliedPromotions: [] as unknown[],
    promotionProgressMessages: [] as string[],
    subtotalBeforePromotion: 100,
    subtotalAfterPromotion: 100,
    subtotalBeforeDiscount: 100,
    totalAfterDiscount: 100,
    total: 100,
    deliveryZoneName: "Livraison postale France metropolitaine",
    deliveryZoneId: "postal-france",
    deliveryMinimumApplied: 30,
    postalFreeShippingApplied: true,
    deliveryFeeStatus: "free",
    deliveryNote: "Livraison postale offerte.",
    giftPromotions: [] as unknown[],
  };
}

export function cagnotteProductionFixtureInitialOrderDocument() {
  const controlledInstant = new Date(
    CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS,
  ).toISOString();
  const payload = orderPayload(
    cagnotteProductionFixtureCheckoutBody() as CheckoutRequestBody,
    cagnotteProductionFixturePricedCheckout() as PricedCheckout,
    CAGNOTTE_PRODUCTION_FIXTURE_UID,
  );
  payload.productionFixture = cagnotteProductionFixtureMarker();
  payload.finalPaymentMethod = "other";
  payload.createdAt = controlledInstant;
  payload.updatedAt = controlledInstant;
  payload.statusHistory = (payload.statusHistory as Array<Record<string, unknown>>).map(
    (entry) => ({
      ...entry,
      changedAt: controlledInstant,
    }),
  );
  return payload;
}

export function cagnotteProductionFixtureStockMovementDocument() {
  const item = cagnotteProductionFixturePricedCheckout().orderItems[0];
  return {
    productId: item.productId,
    productName: item.name,
    type: "sale",
    quantity: -item.quantity,
    note: `Commande manuelle ${CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID}`,
    createdAt: new Date(CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS).toISOString(),
    createdBy: "production-fixture",
    orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
    productionFixture: cagnotteProductionFixtureMarker(),
  };
}

function issueCapability(
  execution: CagnotteProductionFixtureCapability["execution"],
): CagnotteProductionFixtureCapability {
  const capability = Object.freeze({
    execution,
    marker: Object.freeze(cagnotteProductionFixtureMarker()),
    [capabilityBrand]: true as const,
  });
  issuedCapabilities.add(capability);
  return capability;
}

function assertExactChallenge(value: Readonly<Record<string, string>>) {
  if (!isDeepStrictEqual(value, CAGNOTTE_PRODUCTION_FIXTURE_CHALLENGE)) {
    throw new Error("production_fixture_challenge_invalid");
  }
}

function assertEnvironmentCallback(value: unknown) {
  if (typeof value !== "function") {
    throw new Error("production_fixture_environment_assertion_required");
  }
  value();
}
