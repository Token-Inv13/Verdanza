import { isDeepStrictEqual } from "node:util";
import type {
  DocumentSnapshot,
  Firestore,
  QuerySnapshot,
  Transaction,
} from "firebase-admin/firestore";
import { calculateCagnotte } from "../../src/lib/cagnotteCalculations.js";
import type { Order } from "../../src/types/index.js";
import type { CheckoutRequestBody, PricedCheckout } from "./checkout.js";
import {
  cagnotteLedgerMovementId,
  readCagnotteRefundBasis,
  readCagnotteWallet,
  validateCagnotteLedgerMovementForRead,
} from "./cagnotteLedger.js";
import {
  cagnotteCalculationForPricedCheckout,
  validateOrderCagnotteEnrollment,
} from "./cagnotteOrders.js";
import { CAGNOTTE_PRODUCTION_PROGRAM_VERSION } from "./cagnotteProgram.js";
import {
  CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT,
  CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS,
  CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT,
  CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_REMAINING_STOCK,
  CAGNOTTE_PRODUCTION_FIXTURE_SIDE_EFFECT_REASON,
  CAGNOTTE_PRODUCTION_FIXTURE_STOCK_MOVEMENT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_UID,
  cagnotteProductionFixtureCheckoutBody,
  cagnotteProductionFixtureCustomerDocument,
  cagnotteProductionFixturePricedCheckout,
  cagnotteProductionFixtureProductDocument,
  cagnotteProductionFixtureStockMovementDocument,
  isExactCagnotteProductionFixtureMarker,
  isExactCagnotteProductionFixtureOrder,
} from "./cagnotteProductionFixture.js";
import { checkoutPayloadFingerprint, orderSideEffectTaskNames } from "./orderSideEffects.js";
import { orderFromSnapshot } from "./orderProtection.js";

export type CagnotteProductionFixtureState = "created" | "paid" | "delivered";
export type CagnotteProductionFixtureExpectedTransition =
  | "existing"
  | "mark-paid"
  | "mark-delivered";

/** Internal references only. This module exposes no HTTP or environment boundary. */
export function cagnotteProductionFixtureReferences(db: Firestore) {
  return {
    customer: db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID),
    admin: db.collection("adminUsers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID),
    product: db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID),
    order: db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID),
    checkoutRequest: db.collection("checkoutRequests").doc(
      CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
    ),
    sideEffects: db.collection("orderSideEffects").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID),
    stockMovement: db.collection("stockMovements").doc(
      CAGNOTTE_PRODUCTION_FIXTURE_STOCK_MOVEMENT_ID,
    ),
    wallet: db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID),
    accrual: db.collection("cagnotteAccruals").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID),
    reservation: db.collection("cagnotteReservations").doc(
      CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
    ),
  };
}

/**
 * Validates one complete persisted fixture state using only reads from the
 * caller's transaction. The caller may stage writes only after this resolves.
 */
export async function validateCagnotteProductionFixtureState({
  db,
  transaction,
  orderSnapshot,
  expectedTransition,
}: {
  db: Firestore;
  transaction: Transaction;
  orderSnapshot: DocumentSnapshot;
  expectedTransition: CagnotteProductionFixtureExpectedTransition;
}): Promise<CagnotteProductionFixtureState> {
  if (!orderSnapshot.exists) fixtureOrderCollision();

  const refs = cagnotteProductionFixtureReferences(db);
  const movementRefs = fixtureMovementReferences(db);
  const [
    customer,
    admin,
    product,
    checkoutRequest,
    sideEffects,
    stockMovement,
    wallet,
    accrual,
    reservation,
    paymentMovement,
    deliveryMovement,
    releaseMovement,
    cancellationMovement,
  ] = await transaction.getAll(
    refs.customer,
    refs.admin,
    refs.product,
    refs.checkoutRequest,
    refs.sideEffects,
    refs.stockMovement,
    refs.wallet,
    refs.accrual,
    refs.reservation,
    movementRefs.payment,
    movementRefs.delivery,
    movementRefs.release,
    movementRefs.cancellation,
  );
  const movements = await transaction.get(
    db.collection("cagnotteMovements")
      .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID),
  );
  await validateCagnotteProductionFixtureExternalArtifacts({ db, transaction });

  assertFixtureDocuments({
    customer,
    admin,
    product,
    orderSnapshot,
    checkoutRequest,
    sideEffects,
    stockMovement,
    reservation,
  });
  const order = orderFromSnapshot(orderSnapshot);
  const state = fixtureState(order);
  await assertFixtureLedger({
    db,
    transaction,
    order,
    state,
    wallet,
    accrual,
    movements,
    movementSnapshots: {
      payment: paymentMovement,
      delivery: deliveryMovement,
      release: releaseMovement,
      cancellation: cancellationMovement,
    },
  });
  assertTransitionPrecondition(state, expectedTransition);
  return state;
}

/** The fixture contract requires that no external-delivery artifact exists. */
export async function validateCagnotteProductionFixtureExternalArtifacts({
  db,
  transaction,
}: {
  db: Firestore;
  transaction: Transaction;
}) {
  const [invoices, analyticsOutbox, paymentLinkRequests, refunds] = await Promise.all([
    transaction.get(
      db.collection("invoices")
        .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
        .limit(1),
    ),
    transaction.get(
      db.collection("analyticsOutbox")
        .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
        .limit(1),
    ),
    transaction.get(
      db.collection("paymentLinkRequests")
        .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
        .limit(1),
    ),
    transaction.get(
      db.collection("cagnotteRefunds")
        .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
        .limit(1),
    ),
  ]);
  if (!invoices.empty) throw new Error("production_fixture_invoice_collision");
  if (!analyticsOutbox.empty) {
    throw new Error("production_fixture_analytics_outbox_collision");
  }
  if (!paymentLinkRequests.empty) {
    throw new Error("production_fixture_payment_link_collision");
  }
  if (!refunds.empty) {
    throw new Error("production_fixture_refund_collision");
  }
}

function assertFixtureDocuments(input: {
  customer: DocumentSnapshot;
  admin: DocumentSnapshot;
  product: DocumentSnapshot;
  orderSnapshot: DocumentSnapshot;
  checkoutRequest: DocumentSnapshot;
  sideEffects: DocumentSnapshot;
  stockMovement: DocumentSnapshot;
  reservation: DocumentSnapshot;
}) {
  if (!isDeepStrictEqual(
    input.customer.data(),
    cagnotteProductionFixtureCustomerDocument(),
  )) {
    throw new Error("production_fixture_customer_collision");
  }
  if (input.admin.exists) {
    throw new Error("production_fixture_admin_collision");
  }
  if (!isDeepStrictEqual(
    input.product.data(),
    cagnotteProductionFixtureProductDocument(CAGNOTTE_PRODUCTION_FIXTURE_REMAINING_STOCK),
  )) {
    throw new Error("production_fixture_product_collision");
  }

  assertStoredFixtureOrder(orderFromSnapshot(input.orderSnapshot));

  const request = input.checkoutRequest.data() || {};
  if (
    request.orderId !== CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID ||
    request.cagnotteBeneficiaryId !== CAGNOTTE_PRODUCTION_FIXTURE_UID ||
    request.payloadFingerprint !== checkoutPayloadFingerprint(
      cagnotteProductionFixtureCheckoutBody() as CheckoutRequestBody,
    ) ||
    !isExactCagnotteProductionFixtureMarker(request.productionFixture)
  ) {
    throw new Error("production_fixture_checkout_request_collision");
  }

  const outbox = input.sideEffects.data() || {};
  const tasks = outbox.tasks as Record<string, Record<string, unknown>> | undefined;
  if (
    !isExactCagnotteProductionFixtureMarker(outbox.productionFixture) ||
    !tasks ||
    !isDeepStrictEqual(
      Object.keys(tasks).sort(),
      [...orderSideEffectTaskNames].sort(),
    )
  ) {
    throw new Error("production_fixture_outbox_collision");
  }
  for (const task of orderSideEffectTaskNames) {
    const taskState = tasks[task];
    if (
      taskState?.status !== "skipped" ||
      taskState.attempts !== 0 ||
      taskState.lastErrorCode !== CAGNOTTE_PRODUCTION_FIXTURE_SIDE_EFFECT_REASON ||
      taskState.skipReason !== CAGNOTTE_PRODUCTION_FIXTURE_SIDE_EFFECT_REASON
    ) {
      throw new Error("production_fixture_outbox_collision");
    }
  }

  if (!isDeepStrictEqual(
    input.stockMovement.data(),
    cagnotteProductionFixtureStockMovementDocument(),
  )) {
    throw new Error("production_fixture_stock_movement_collision");
  }
  if (input.reservation.exists) {
    throw new Error("production_fixture_reservation_collision");
  }
}

function assertStoredFixtureOrder(order: Order) {
  if (!isExactCagnotteProductionFixtureOrder(order)) fixtureOrderCollision();
  const enrollment = fixtureOrderEnrollment(order);
  const expectedSnapshot = calculateCagnotte(
    cagnotteCalculationForPricedCheckout(
      cagnotteProductionFixturePricedCheckout() as PricedCheckout,
      0,
      0,
    ),
  );
  if (
    enrollment.programVersion !== CAGNOTTE_PRODUCTION_PROGRAM_VERSION ||
    enrollment.calculationVersion !== "cagnotte-math-v1" ||
    enrollment.createdAtEpochMs !== CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS ||
    enrollment.accrualEnrollment !== "enrolled" ||
    !isDeepStrictEqual(enrollment.snapshot, expectedSnapshot) ||
    enrollment.snapshot.loyaltyCents !== 500 ||
    enrollment.snapshot.appliedCagnotteCents !== 0 ||
    order.finalPaymentMethod !== "other" ||
    order.subtotal !== 100 ||
    order.deliveryFee !== 0 ||
    order.total !== 100 ||
    order.couponCode !== null ||
    order.contestPrizeId !== null ||
    (order.appliedPromotions?.length ?? 0) !== 0 ||
    order.cagnotteReservationIntent !== undefined ||
    !isDeepStrictEqual(
      order.items.map(stripPurchaseCost),
      cagnotteProductionFixturePricedCheckout().orderItems,
    )
  ) {
    fixtureOrderCollision();
  }
}

function fixtureOrderEnrollment(order: Order) {
  try {
    return validateOrderCagnotteEnrollment(order);
  } catch {
    return fixtureOrderCollision();
  }
}

function fixtureState(order: Order): CagnotteProductionFixtureState {
  if (
    order.paymentStatus === "to_confirm" &&
    order.orderStatus === "contact_required"
  ) return "created";
  if (
    order.paymentStatus === "paid" &&
    order.orderStatus === "contact_required"
  ) return "paid";
  if (
    order.paymentStatus === "paid" &&
    order.orderStatus === "delivered"
  ) return "delivered";
  return fixtureOrderCollision();
}

async function assertFixtureLedger(input: {
  db: Firestore;
  transaction: Transaction;
  order: Order;
  state: CagnotteProductionFixtureState;
  wallet: DocumentSnapshot;
  accrual: DocumentSnapshot;
  movements: QuerySnapshot;
  movementSnapshots: Record<
    "payment" | "delivery" | "release" | "cancellation",
    DocumentSnapshot
  >;
}) {
  const expectedMovements = fixtureMovementExpectations(input.state);
  assertExactMovementSet(input.movements, input.movementSnapshots, expectedMovements);

  if (input.state === "created") {
    if (input.wallet.exists || input.accrual.exists) fixtureWalletCollision();
    return;
  }
  if (!input.wallet.exists || !input.accrual.exists) fixtureWalletCollision();

  const expectedPendingCents = input.state === "paid" ? 500 : 0;
  const expectedAvailableCents = input.state === "delivered" ? 500 : 0;
  let persistedWallet: ReturnType<typeof readCagnotteWallet>;
  try {
    persistedWallet = readCagnotteWallet(
      input.wallet.data(),
      CAGNOTTE_PRODUCTION_FIXTURE_UID,
    );
  } catch {
    return fixtureWalletCollision();
  }
  if (
    !isDeepStrictEqual(input.wallet.data(), persistedWallet) ||
    persistedWallet.pendingCents !== expectedPendingCents ||
    persistedWallet.availableCents !== expectedAvailableCents ||
    persistedWallet.reservedCents !== 0 ||
    persistedWallet.regularizationCents !== 0
  ) {
    fixtureWalletCollision();
  }

  const enrollment = validateOrderCagnotteEnrollment(input.order);
  let basis: Awaited<ReturnType<typeof readCagnotteRefundBasis>>;
  try {
    basis = await readCagnotteRefundBasis({
      db: input.db,
      transaction: input.transaction,
      order: {
        orderId: input.order.id,
        beneficiaryId: enrollment.beneficiaryId,
        programVersion: enrollment.programVersion,
        createdAtEpochMs: enrollment.createdAtEpochMs,
        snapshot: enrollment.snapshot,
      },
    });
  } catch {
    return fixtureLedgerCollision();
  }

  const state = basis.state;
  if (
    !state ||
    state.schemaVersion !== 1 ||
    state.calculationVersion !== "cagnotte-math-v1" ||
    state.currency !== "EUR" ||
    state.orderId !== CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID ||
    state.beneficiaryId !== CAGNOTTE_PRODUCTION_FIXTURE_UID ||
    state.programVersion !== CAGNOTTE_PRODUCTION_PROGRAM_VERSION ||
    !isDeepStrictEqual(state.initialSnapshot, enrollment.snapshot) ||
    state.initialGainCents !== 500 ||
    state.paymentConfirmed !== true ||
    state.deliveryConfirmed !== (input.state === "delivered") ||
    state.cancelled !== false ||
    state.credited !== true ||
    state.compartment !== (input.state === "delivered" ? "available" : "pending") ||
    state.remainingGainCents !== 500 ||
    !isDeepStrictEqual(
      state.cumulativeReturns,
      enrollment.snapshot.lines.map((line) => ({
        lineId: line.lineId,
        returnedNetCents: 0,
      })),
    ) ||
    !isDeepStrictEqual(input.accrual.data(), state) ||
    !isDeepStrictEqual(input.wallet.data(), basis.wallet)
  ) {
    fixtureLedgerCollision();
  }

  for (const movement of input.movements.docs) {
    const expected = expectedMovements.get(movement.id);
    if (!expected) fixtureMovementCollision();
    try {
      validateCagnotteLedgerMovementForRead(movement.data(), movement.id, state);
    } catch {
      return fixtureMovementCollision();
    }
    const value = movement.data();
    if (
      value.schemaVersion !== 3 ||
      value.orderId !== CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID ||
      value.beneficiaryId !== CAGNOTTE_PRODUCTION_FIXTURE_UID ||
      value.programVersion !== CAGNOTTE_PRODUCTION_PROGRAM_VERSION ||
      value.calculationVersion !== "cagnotte-math-v1" ||
      value.currency !== "EUR" ||
      value.origin !== "internal_server" ||
      value.businessEvent !== expected.event ||
      value.eventKey !== movement.id ||
      value.payload !== JSON.stringify({ event: expected.event }) ||
      value.pendingDeltaCents !== expected.pendingCents ||
      value.availableDeltaCents !== expected.availableCents ||
      value.reservedDeltaCents !== 0 ||
      value.regularizationDeltaCents !== 0 ||
      value.recordedAtEpochMs !== expected.recordedAtEpochMs
    ) {
      fixtureMovementCollision();
    }
  }
}

function assertExactMovementSet(
  movements: QuerySnapshot,
  snapshots: Record<"payment" | "delivery" | "release" | "cancellation", DocumentSnapshot>,
  expected: Map<string, FixtureMovementExpectation>,
) {
  const actualIds = movements.docs.map((entry) => entry.id).sort();
  const expectedIds = [...expected.keys()].sort();
  if (!isDeepStrictEqual(actualIds, expectedIds)) fixtureMovementCollision();

  const fixed = [
    snapshots.payment,
    snapshots.delivery,
    snapshots.release,
    snapshots.cancellation,
  ];
  for (const snapshot of fixed) {
    if (snapshot.exists !== expected.has(snapshot.id)) fixtureMovementCollision();
  }
}

type FixtureMovementExpectation = Readonly<{
  event: "payment_confirmed" | "delivery_confirmed" | "made_available";
  pendingCents: number;
  availableCents: number;
  recordedAtEpochMs: number;
}>;

function fixtureMovementExpectations(state: CagnotteProductionFixtureState) {
  const expected = new Map<string, FixtureMovementExpectation>();
  if (state === "created") return expected;
  expected.set(
    cagnotteLedgerMovementId(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "payment_confirmed"),
    {
      event: "payment_confirmed",
      pendingCents: 500,
      availableCents: 0,
      recordedAtEpochMs: Date.parse(CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT),
    },
  );
  if (state === "paid") return expected;
  expected.set(
    cagnotteLedgerMovementId(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "delivery_confirmed"),
    {
      event: "delivery_confirmed",
      pendingCents: 0,
      availableCents: 0,
      recordedAtEpochMs: Date.parse(CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT),
    },
  );
  expected.set(
    cagnotteLedgerMovementId(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "made_available"),
    {
      event: "made_available",
      pendingCents: -500,
      availableCents: 500,
      recordedAtEpochMs: Date.parse(CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT),
    },
  );
  return expected;
}

function fixtureMovementReferences(db: Firestore) {
  return {
    payment: db.collection("cagnotteMovements").doc(
      cagnotteLedgerMovementId(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "payment_confirmed"),
    ),
    delivery: db.collection("cagnotteMovements").doc(
      cagnotteLedgerMovementId(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "delivery_confirmed"),
    ),
    release: db.collection("cagnotteMovements").doc(
      cagnotteLedgerMovementId(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "made_available"),
    ),
    cancellation: db.collection("cagnotteMovements").doc(
      cagnotteLedgerMovementId(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "cancelled"),
    ),
  };
}

function assertTransitionPrecondition(
  state: CagnotteProductionFixtureState,
  expectedTransition: CagnotteProductionFixtureExpectedTransition,
) {
  if (expectedTransition === "existing" || expectedTransition === "mark-paid") return;
  if (state === "paid" || state === "delivered") return;
  throw new Error("production_fixture_state_transition_invalid");
}

function stripPurchaseCost(item: Order["items"][number]) {
  const copy = { ...item } as Record<string, unknown>;
  delete copy.purchasePricePerGramSnapshot;
  delete copy.purchaseCostTotalSnapshot;
  delete copy.purchaseCostCapturedAt;
  delete copy.purchaseCostSource;
  return copy;
}

function fixtureOrderCollision(): never {
  throw new Error("production_fixture_order_collision");
}

function fixtureWalletCollision(): never {
  throw new Error("production_fixture_wallet_collision");
}

function fixtureLedgerCollision(): never {
  throw new Error("production_fixture_ledger_collision");
}

function fixtureMovementCollision(): never {
  throw new Error("production_fixture_movement_collision");
}
