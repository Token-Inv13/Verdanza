import type { Firestore, Transaction } from "firebase-admin/firestore";
import { isDeepStrictEqual } from "node:util";
import { calculateCagnotte, CAGNOTTE_CALCULATION_VERSION, simulateCagnotteRefund } from "../../src/lib/cagnotteCalculations.js";
import { deriveOrderFinancingAmounts, exactEuroCents } from "../../src/lib/orderFinancing.js";
import type { CagnotteAdvantage, CagnotteCalculationInput, CagnotteOrderEnrollment, ProductDiscount } from "../../src/types/cagnotte.js";
import type { AppliedPromotion, Order } from "../../src/types/index.js";
import type { PricedCheckout } from "./checkout.js";
import type { CagnotteAccrualProgram } from "./cagnotteLedgerTypes.js";
import { CagnotteLedgerError, prepareCagnotteLedgerOperation } from "./cagnotteLedger.js";
import { assertCagnotteProgramFirebaseProject, CAGNOTTE_SERVER_PROGRAM } from "./cagnotteProgram.js";
import { hasCagnotteEnrollment } from "./orderProtection.js";
import {
  CAGNOTTE_RESERVATION_PROGRAM,
  prepareCagnotteCancellationComposition,
  prepareCagnottePaymentComposition,
  validateCagnotteReservationIntent,
} from "./cagnotteReservations.js";
import type { CagnotteReservationProgram } from "./cagnotteReservationTypes.js";

/** Backward-compatible name for the exact conversion now shared with presentation consumers. */
export const eurosToCagnotteCents = exactEuroCents;

type CagnotteOrderSource = Pick<
  Order,
  "items" | "subtotal" | "deliveryFee" | "discountAmount" | "promotionDiscountTotal" |
  "appliedPromotions" | "couponCode" | "contestPrizeId"
>;

/** Uses exactly the order payload to be persisted, not HTTP fields or recomputed unit prices. */
export function buildCagnotteOrderEnrollment(
  payload: Record<string, unknown>, verifiedUid: string | undefined,
  program: CagnotteAccrualProgram | null = CAGNOTTE_SERVER_PROGRAM, nowEpochMs = Date.now(),
  firebaseProjectId?: string | null,
): CagnotteOrderEnrollment | undefined {
  if (!verifiedUid || !canEnrollCagnotteOrder(program, verifiedUid, nowEpochMs, firebaseProjectId)) return undefined;
  const order = payload as unknown as Order;
  if (order.customerId !== verifiedUid) throw new Error("Bénéficiaire serveur incohérent.");
  const snapshot = calculateCagnotte(cagnotteCalculationForOrder(order, 0, 0));
  // discountAmount and promotionDiscountTotal can be aliases; compare, never add them.
  if (snapshot.subtotalCents !== eurosToCagnotteCents(order.subtotal) ||
    snapshot.discountCents !== eurosToCagnotteCents(order.discountAmount ?? 0) ||
    snapshot.discountCents !== eurosToCagnotteCents(order.promotionDiscountTotal ?? 0) ||
    BigInt(snapshot.productsPaidCents) + BigInt(eurosToCagnotteCents(order.deliveryFee)) !== BigInt(eurosToCagnotteCents(order.total))) {
    throw new Error("Instantané cagnotte incompatible avec les montants serveur retenus.");
  }
  return { schemaVersion: 1, beneficiaryId: verifiedUid, programVersion: program.programVersion,
    calculationVersion: CAGNOTTE_CALCULATION_VERSION, createdAtEpochMs: nowEpochMs, snapshot,
    accrualEnrollment: "enrolled" };
}

export function canEnrollCagnotteOrder(
  program: CagnotteAccrualProgram | null,
  verifiedUid: string | undefined,
  createdAtEpochMs: number,
  firebaseProjectId?: string | null,
): program is CagnotteAccrualProgram {
  assertCagnotteProgramFirebaseProject(program, firebaseProjectId);
  return Boolean(program?.newAccrualsEnabled && verifiedUid &&
    (program.mode === "local_test" || program.mode === "production") &&
    program.calculationVersion === CAGNOTTE_CALCULATION_VERSION &&
    Number.isSafeInteger(program.startsAtEpochMs) && program.startsAtEpochMs >= 0 &&
    Number.isSafeInteger(createdAtEpochMs) && createdAtEpochMs >= program.startsAtEpochMs);
}

export function cagnotteCalculationForPricedCheckout(
  priced: PricedCheckout,
  requestedCagnotteCents: number,
  availableCagnotteCents: number,
): CagnotteCalculationInput {
  return cagnotteCalculationForOrder(
    {
      items: priced.orderItems,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      discountAmount: priced.discountAmount,
      promotionDiscountTotal: priced.promotionDiscountTotal,
      appliedPromotions: priced.appliedPromotions,
      couponCode: priced.couponCode,
      contestPrizeId: priced.contestPrizeId,
    },
    requestedCagnotteCents,
    availableCagnotteCents,
  );
}

function cagnotteCalculationForOrder(
  order: CagnotteOrderSource,
  requestedCagnotteCents: number,
  availableCagnotteCents: number,
): CagnotteCalculationInput {
  const lines = order.items.map((item, index) => ({
    lineId: item.lineId || `order-line-${index}`,
    initialCents: eurosToCagnotteCents(item.lineTotal),
    ...(item.isGift ? { isGift: true } : {}),
  }));
  const codeAdvantage: CagnotteAdvantage = order.contestPrizeId
    ? "contest_prize"
    : "promotion_code";
  const discounts: ProductDiscount[] = (order.appliedPromotions || [])
    .filter((entry) => entry.type !== "tiered_product_gift" && entry.discountAmount !== 0)
    .map((entry) => ({
      discountId: entry.couponId || entry.id,
      amountCents: eurosToCagnotteCents(entry.discountAmount),
      kind: entry.applicationMode === "code" ? codeAdvantage : "automatic_promotion",
      lineIds: order.items.flatMap((item, index) =>
        !item.isGift && promotionCoversLine(entry, item) ? [lines[index].lineId] : [],
      ),
    }));
  const advantages: CagnotteAdvantage[] = [];
  for (const entry of order.appliedPromotions || []) {
    if (entry.type === "tiered_product_gift") continue;
    advantages.push(entry.applicationMode === "code" ? codeAdvantage : "automatic_promotion");
  }
  if (order.couponCode) advantages.push(codeAdvantage);
  if (order.items.some((item) => item.isGift)) advantages.push("promotional_gift");
  return {
    lines,
    discounts,
    requestedCagnotteCents,
    availableCagnotteCents,
    advantages,
  };
}

function promotionCoversLine(promotion: AppliedPromotion, item: Order["items"][number]) {
  if (promotion.productIds?.length) return promotion.productIds.includes(item.productId);
  if (["fixed_category_discount", "percentage_category_discount", "threshold_extra_discount"].includes(promotion.type)) {
    const categories = promotion.eligibleCategories?.length ? promotion.eligibleCategories : promotion.eligibleCategory ? [promotion.eligibleCategory] : [];
    return item.category !== undefined && categories.includes(item.category);
  }
  return true;
}

export async function prepareOrderCagnotteTransition(input: {
  db: Firestore; transaction: Transaction; order: Order;
  nextOrderStatus: Order["orderStatus"]; nextPaymentStatus: Order["paymentStatus"];
  paymentConfirmationRequested?: boolean;
  accrualProgram?: CagnotteAccrualProgram | null;
  reservationProgram?: CagnotteReservationProgram | null;
  firebaseProjectId?: string | null;
  recordedAtEpochMs?: number;
}) {
  const { order } = input;
  // Historical/ordinary orders: no new validation and no cagnotte collection access.
  if (!hasCagnotteEnrollment(order)) return null;
  const registration = validateOrderCagnotteEnrollment(order);
  const accrualProgram = registration.accrualEnrollment === "not_enrolled"
    ? null
    : input.accrualProgram === undefined ? CAGNOTTE_SERVER_PROGRAM : input.accrualProgram;
  const cancelled = input.nextOrderStatus === "cancelled" || order.orderStatus === "cancelled" || Boolean(order.cancelledAt);
  const paid = input.nextPaymentStatus === "paid";
  const delivered = input.nextOrderStatus === "delivered";
  if (!cancelled && !paid && !delivered) return null;
  const reservationIntent = order.cagnotteReservationIntent;
  if (registration.snapshot.appliedCagnotteCents > 0) {
    const intent = validateCagnotteReservationIntent(reservationIntent);
    assertReservationMatchesEnrollment(intent, registration);
    if (cancelled) {
      return prepareCagnotteCancellationComposition({
        db: input.db,
        transaction: input.transaction,
        intent,
        accrualProgram,
        reservationProgram: input.reservationProgram === undefined ? CAGNOTTE_RESERVATION_PROGRAM : input.reservationProgram,
        firebaseProjectId: input.firebaseProjectId,
        recordedAtEpochMs: input.recordedAtEpochMs ?? Date.now(),
      });
    }
    if (paid && input.paymentConfirmationRequested) {
      return prepareCagnottePaymentComposition({
        db: input.db,
        transaction: input.transaction,
        intent,
        accrualProgram,
        reservationProgram: input.reservationProgram === undefined ? CAGNOTTE_RESERVATION_PROGRAM : input.reservationProgram,
        firebaseProjectId: input.firebaseProjectId,
        delivered,
        recordedAtEpochMs: input.recordedAtEpochMs ?? Date.now(),
      });
    }
  }
  return prepareCagnotteLedgerOperation({
    db: input.db, transaction: input.transaction,
    program: accrualProgram,
    firebaseProjectId: input.firebaseProjectId,
    recordedAtEpochMs: input.recordedAtEpochMs,
    command: {
      order: { orderId: order.id, beneficiaryId: registration.beneficiaryId, programVersion: registration.programVersion,
        createdAtEpochMs: registration.createdAtEpochMs, snapshot: registration.snapshot },
      event: cancelled ? "cancelled" : paid && delivered ? "payment_and_delivery_confirmed" : paid ? "payment_confirmed" : "delivery_confirmed",
    },
  });
}

/** Shared existing validation, with no database read or monetary plan. */
export function validateOrderCagnotteEnrollment(order: Order) {
  const registration = order.cagnotte;
  if (!registration || typeof registration !== "object" || !registration.snapshot ||
    registration.schemaVersion !== 1 || registration.beneficiaryId !== order.customerId ||
    (registration.accrualEnrollment !== undefined && registration.accrualEnrollment !== "enrolled" && registration.accrualEnrollment !== "not_enrolled") ||
    registration.calculationVersion !== CAGNOTTE_CALCULATION_VERSION ||
    registration.snapshot.calculationVersion !== registration.calculationVersion) {
    throw new CagnotteLedgerError("CONFLICT", "Inscription cagnotte de commande incohérente.");
  }
  simulateCagnotteRefund(registration.snapshot, [], []);
  if (registration.snapshot.appliedCagnotteCents > 0) {
    const intent = validateCagnotteReservationIntent(order.cagnotteReservationIntent);
    assertReservationMatchesEnrollment(intent, registration);
  } else if (order.cagnotteReservationIntent !== undefined) {
    throw new CagnotteLedgerError("CONFLICT", "Intention de réservation inattendue.");
  }
  return registration;
}

export function orderPaymentCents(order: Order) {
  if (!hasCagnotteEnrollment(order)) return eurosToCagnotteCents(order.total);
  validateOrderCagnotteEnrollment(order);
  try {
    return deriveOrderFinancingAmounts(order).paymentCents;
  } catch (error) {
    throw new CagnotteLedgerError(
      "CONFLICT",
      error instanceof Error ? error.message : "Montants de commande cagnotte incohérents.",
    );
  }
}

export function orderPaymentAmount(order: Order) {
  return orderPaymentCents(order) / 100;
}

function assertReservationMatchesEnrollment(
  intent: NonNullable<Order["cagnotteReservationIntent"]>,
  registration: CagnotteOrderEnrollment,
) {
  if (
    intent.order.beneficiaryId !== registration.beneficiaryId ||
    intent.order.programVersion !== registration.programVersion ||
    intent.order.createdAtEpochMs !== registration.createdAtEpochMs ||
    !isDeepStrictEqual(intent.order.snapshot, registration.snapshot)
  ) {
    throw new CagnotteLedgerError("CONFLICT", "Réservation et commande incohérentes.");
  }
}
