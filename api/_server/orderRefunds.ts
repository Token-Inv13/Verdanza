import { createHash } from "node:crypto";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { simulateCagnotteRefund } from "../../src/lib/cagnotteCalculations.js";
import {
  cagnotteAdminCorrectionBusinessContent,
  cagnotteAdminCorrectionBusinessFingerprint,
  cagnotteAdminRefundBusinessContent,
  cagnotteAdminRefundBusinessFingerprint,
} from "../../src/lib/cagnotteAdminOperationIdentity.js";
import type { CagnotteSnapshot, CumulativeLineReturn } from "../../src/types/cagnotte.js";
import type { Order } from "../../src/types/index.js";
import { cagnotteOrderItemLineId, eurosToCagnotteCents, orderPaymentCents, validateOrderCagnotteEnrollment } from "./cagnotteOrders.js";
import { orderFromSnapshot, hasCagnotteEnrollment } from "./orderProtection.js";
import {
  applyCagnotteWalletDeltas,
  cagnotteLedgerMovementId,
  prepareCagnotteLedgerOperation,
  prepareCagnotteWalletMutation,
  readCagnotteRefundBasis,
  readCagnotteWallet,
  validateCagnotteLedgerMovementForRead,
  writeCagnotteWalletMutation,
} from "./cagnotteLedger.js";
import { CAGNOTTE_REGULARIZATION_VERSION, CAGNOTTE_RESERVATION_VERSION, type CagnotteAccrual, type CagnotteMovement, type CagnotteWallet } from "./cagnotteLedgerTypes.js";
import { prepareCagnotteRefundComposition, readCagnotteConsumedRefundBasis, readCagnotteReservationBasis } from "./cagnotteReservations.js";
import { readUnpaidOrderContext } from "./unpaidOrderReview.js";

export const ORDER_REFUNDS_ENABLED = false;
export const ORDER_REFUND_VERSION = "order-refund-record-v1";
export const ORDER_MIXED_REFUND_VERSION = "order-mixed-refund-record-v1";
export const ORDER_REFUND_CORRECTION_VERSION = "order-refund-correction-v1";
const collection = "cagnotteRefunds";
const historyLimit = 1000;

export type OrderRefundOperationalLog = {
  event: "cagnotte_refund_recorded" | "cagnotte_refund_correction_recorded" | "cagnotte_correction_requires_review";
  orderHash: string;
  eventId: string;
  version: string;
  deltas: Record<string, number>;
  result: string;
  idempotent: boolean;
};

function hasOwn(value: object, property: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function lastItem<T>(values: readonly T[]): T | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
}

export class OrderRefundError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}

export type ReturnLine = { lineId: string; additionalNetCents: number };
type Selection = { orderId: string; currency: "EUR"; additionalReturns: ReturnLine[]; deliveryRefundCents: number };
type Confirmation = Selection & {
  source: "admin" | "provider_reference";
  reference: string;
  declaredFinancialCents: number;
  reason: "product_return" | "order_cancellation" | "delivery_refund";
  confirmedAt: string;
  expectedPreviewVersion: string;
};
type InspectRequest = { action: "inspect"; orderId: string };
type CorrectionBase = {
  orderId: string;
  currency: "EUR";
  targetEventId: string;
  expectedRevision: number;
  replacementReturns: ReturnLine[];
  deliveryRefundCents: number;
  declaredFinancialCents: number;
  correctionReason: string;
  externalVerificationConfirmed: true;
};
type CorrectionSelection = CorrectionBase & { action: "preview_correction" };
type CorrectionConfirmation = CorrectionBase & {
  action: "record_correction";
  correctionReference: string;
  expectedPreviewVersion: string;
};
export type OrderRefundRequest =
  | (Selection & { action: "preview" })
  | (Confirmation & { action: "record_confirmed" })
  | InspectRequest
  | CorrectionSelection
  | CorrectionConfirmation;
type Cumuls = {
  lines: CumulativeLineReturn[];
  returnedProductNetCents: number;
  productFinancialCents: number;
  cagnotteRestitutionCents: number;
  deliveryFinancialCents: number;
  totalFinancialCents: number;
};
type Correction = {
  theoreticalCents: number;
  appliedCents: number;
  pendingDeltaCents: number;
  availableDeltaCents: number;
  regularizationDeltaCents: number;
  remainingGainCents: number;
};
type Restitution = {
  grossCents: number;
  compensationCents: number;
  availableIncreaseCents: number;
  availableAfterCents: number;
  cumulativeCents: number;
  reservationState: "consumed" | "not_applicable";
};
type RefundResult = {
  kind: "refund_preview" | "administrative_refund_recorded";
  orderId: string;
  currency: "EUR";
  additionalReturns: ReturnLine[];
  returnedProductNetCents: number;
  productFinancialCents: number;
  cagnotteRestitutionCents: number;
  deliveryFinancialCents: number;
  totalFinancialCents: number;
  loyaltyAccrualDecision: "attributed" | "not_attributed";
  correction: Correction;
  restitution: Restitution;
  before: Cumuls;
  after: Cumuls;
  previewVersion: string;
  productsFullyRefunded: boolean;
  entirePaymentRefunded: boolean;
  recordedAt?: string;
  confirmedAt?: string;
  alreadyRecorded?: boolean;
};
export type Event = {
  schemaVersion: 1 | 2;
  version: string;
  orderId: string;
  beneficiaryId: string;
  source: string;
  reference: string;
  content: Omit<Confirmation, "expectedPreviewVersion">;
  fingerprint: string;
  sequence: number;
  result: RefundResult;
  movementIds: readonly string[];
  actor: { uid: string; email: string | null };
  recordedAt: string;
  confirmedAt: string;
  calculationVersion: string;
  regularizationVersion: string;
};

type CorrectionEvent = {
  schemaVersion: 3;
  kind: "refund_correction";
  version: typeof ORDER_REFUND_CORRECTION_VERSION;
  orderId: string;
  beneficiaryId: string;
  targetEventId: string;
  revision: number;
  previousRevision: number;
  correctionReference: string;
  content: Omit<CorrectionConfirmation, "action" | "expectedPreviewVersion">;
  fingerprint: string;
  result: CorrectionResult;
  movementIds: readonly string[];
  actor: { uid: string; email: string | null };
  recordedAt: string;
};

type CorrectionResult = {
  kind: "refund_correction_preview" | "administrative_refund_correction_recorded" | "correction_requires_review";
  orderId: string;
  currency: "EUR";
  targetEventId: string;
  previousRevision: number;
  revision: number;
  replacementReturns: ReturnLine[];
  deliveryRefundCents: number;
  declaredFinancialCents: number;
  previousEffective: Cumuls;
  effective: Cumuls;
  differential: {
    returnedProductNetCents: number;
    productFinancialCents: number;
    cagnotteRestitutionCents: number;
    deliveryFinancialCents: number;
    totalFinancialCents: number;
    loyaltyCents: number;
    pendingDeltaCents: number;
    availableDeltaCents: number;
    regularizationDeltaCents: number;
  };
  walletAfter: { pendingCents: number; availableCents: number; reservedCents: number; regularizationCents: number };
  remainingGainCents: number;
  reservationState: "consumed" | "not_applicable";
  previewVersion: string;
  recordedAt?: string;
  alreadyRecorded?: boolean;
  reviewReason?: string;
};

/** Strict application contract. No banking documents, arbitrary metadata, or actor supplied by HTTP. */
export function parseOrderRefundRequest(value: unknown): OrderRefundRequest {
  const raw = object(value);
  if (raw.action === "inspect") {
    exactKeys(raw, ["action", "orderId", "authToken"]);
    return { action: "inspect", orderId: identifier(raw.orderId, 128) };
  }
  if (raw.action === "preview_correction" || raw.action === "record_correction") {
    const keys = ["action", "orderId", "currency", "targetEventId", "expectedRevision", "replacementReturns",
      "deliveryRefundCents", "declaredFinancialCents", "correctionReason", "externalVerificationConfirmed", "authToken"];
    if (raw.action === "record_correction") keys.push("correctionReference", "expectedPreviewVersion");
    exactKeys(raw, keys);
    if (raw.currency !== "EUR") fail("refund_currency_invalid", 400);
    if (!Number.isSafeInteger(raw.expectedRevision) || (raw.expectedRevision as number) < 0) fail("correction_revision_invalid", 400);
    if (raw.externalVerificationConfirmed !== true) fail("correction_external_verification_required", 400);
    if (typeof raw.correctionReason !== "string" || raw.correctionReason.trim().length < 3 || raw.correctionReason.trim().length > 300) {
      fail("correction_reason_invalid", 400);
    }
    const common: CorrectionBase = {
      orderId: identifier(raw.orderId, 128),
      currency: "EUR",
      targetEventId: shaIdentifier(raw.targetEventId, "correction_target_invalid"),
      expectedRevision: raw.expectedRevision as number,
      replacementReturns: normalizeReturns(raw.replacementReturns),
      deliveryRefundCents: cents(raw.deliveryRefundCents),
      declaredFinancialCents: cents(raw.declaredFinancialCents),
      correctionReason: raw.correctionReason.trim(),
      externalVerificationConfirmed: true,
    };
    if (raw.action === "preview_correction") return { action: "preview_correction", ...common };
    if (typeof raw.expectedPreviewVersion !== "string" || !/^[a-f0-9]{64}$/.test(raw.expectedPreviewVersion)) {
      fail("correction_preview_version_required", 400);
    }
    return {
      ...common,
      action: "record_correction",
      correctionReference: identifier(typeof raw.correctionReference === "string" ? raw.correctionReference.trim().toLowerCase() : raw.correctionReference, 80),
      expectedPreviewVersion: raw.expectedPreviewVersion,
    };
  }
  if (raw.action !== "preview" && raw.action !== "record_confirmed") fail("refund_action_invalid", 400);
  const keys = ["action", "orderId", "currency", "additionalReturns", "deliveryRefundCents", "authToken"];
  if (raw.action === "record_confirmed") keys.push("source", "reference", "declaredFinancialCents", "reason", "confirmedAt", "expectedPreviewVersion");
  exactKeys(raw, keys);
  const selection: Selection = {
    orderId: identifier(raw.orderId, 128),
    currency: raw.currency === "EUR" ? "EUR" : fail("refund_currency_invalid", 400),
    additionalReturns: normalizeReturns(raw.additionalReturns),
    deliveryRefundCents: cents(raw.deliveryRefundCents),
  };
  if (!selection.additionalReturns.length && selection.deliveryRefundCents === 0) fail("refund_empty", 400);
  if (raw.action === "preview") return { action: "preview", ...selection };
  if (raw.source !== "admin" && raw.source !== "provider_reference") fail("refund_source_invalid", 400);
  const reference = identifier(typeof raw.reference === "string" ? raw.reference.trim().toLowerCase() : raw.reference, 80);
  if (/^\d{13,19}$/.test(reference) || /^[a-z]{2}\d{2}[a-z0-9]{11,30}$/.test(reference)) fail("refund_reference_not_business_id", 400);
  if (!["product_return", "order_cancellation", "delivery_refund"].includes(String(raw.reason))) fail("refund_reason_invalid", 400);
  if (typeof raw.expectedPreviewVersion !== "string" || !/^[a-f0-9]{64}$/.test(raw.expectedPreviewVersion)) fail("refund_preview_version_required", 400);
  return {
    action: "record_confirmed",
    ...selection,
    source: raw.source,
    reference,
    declaredFinancialCents: cents(raw.declaredFinancialCents),
    reason: raw.reason as Confirmation["reason"],
    confirmedAt: instant(raw.confirmedAt),
    expectedPreviewVersion: raw.expectedPreviewVersion,
  };
}

export async function executeOrderRefund(input: {
  db: Firestore;
  request: OrderRefundRequest;
  actor: { uid: string; email: string | null };
  now?: () => string;
  log?: (entry: OrderRefundOperationalLog) => void;
}) {
  const request = parseOrderRefundRequest(input.request);
  if (request.action === "inspect") return inspectOrderRefunds(input.db, request.orderId);
  if (request.action === "preview_correction" || request.action === "record_correction") {
    return executeOrderRefundCorrection({ ...input, request });
  }
  const recordedAt = instant((input.now ?? (() => new Date().toISOString()))());
  const confirmed = request.action === "record_confirmed" ? request : null;
  const content = confirmed ? businessContent(confirmed) : null;
  const key = confirmed ? eventKey(confirmed.source, confirmed.reference) : null;
  const eventRef = key ? input.db.collection(collection).doc(key) : null;
  const result = await input.db.runTransaction(async (tx) => {
    const orderRef = input.db.collection("orders").doc(request.orderId);
    const orderDoc = await tx.get(orderRef);
    const prior = eventRef ? await tx.get(eventRef) : null;
    // A committed event is authoritative even when its restored credit has since been used.
    if (prior?.exists) {
      const event = prior.data() as Event;
      if (!content || event.orderId !== request.orderId || event.fingerprint !== cagnotteAdminRefundBusinessFingerprint(content) || stable(event.content) !== stable(content)) fail("refund_event_conflict");
      validateStoredEvent(event, prior.id);
      const linked = await tx.get(input.db.collection(collection).where("orderId", "==", request.orderId).limit(historyLimit + 1));
      if (linked.size > historyLimit) fail("refund_history_requires_verification");
      const latestCorrection = linked.docs.filter((doc) => doc.data().kind === "refund_correction" && doc.data().targetEventId === prior.id)
        .map((doc) => doc.data() as CorrectionEvent).sort((a, b) => b.revision - a.revision)[0];
      if (latestCorrection) validateStoredCorrectionEvent(latestCorrection, hash(["refund-correction", latestCorrection.correctionReference]));
      return {
        ...publicResult(event.result, true),
        ...(latestCorrection ? { corrected: true, currentRevision: latestCorrection.revision, effective: latestCorrection.result.effective } : {}),
      };
    }
    if (!orderDoc.exists) fail("refund_order_missing", 404);
    const order = orderFromSnapshot(orderDoc);
    if (!hasCagnotteEnrollment(order)) fail("refund_historical_order_not_supported");
    let enrollment;
    try { enrollment = validateOrderCagnotteEnrollment(order); } catch { fail("refund_enrollment_invalid"); }
    if (!enrollment.beneficiaryId || !enrollment.programVersion || !Number.isSafeInteger(enrollment.createdAtEpochMs) || enrollment.createdAtEpochMs < 0) fail("refund_enrollment_invalid");
    let paidAt: string;
    try {
      paidAt = instant(order.paidAt);
      if (paidAt !== instant(order.paymentConfirmedAt) || !hasOwn(order, "paymentConfirmedBy") ||
        (order.paymentConfirmedBy !== null && typeof order.paymentConfirmedBy !== "string") ||
        !["card_payment_link", "cash_on_delivery", "bank_transfer", "other"].includes(order.finalPaymentMethod ?? "")) throw new Error();
    } catch { fail("refund_prior_payment_requires_verification"); }
    if (paidAt > recordedAt) fail("refund_prior_payment_requires_verification");
    if (confirmed && (confirmed.confirmedAt < paidAt || confirmed.confirmedAt > recordedAt)) fail("refund_confirmation_date_invalid", 400);

    const mixed = enrollment.snapshot.appliedCagnotteCents > 0;
    const recordVersion = mixed ? ORDER_MIXED_REFUND_VERSION : ORDER_REFUND_VERSION;
    const deliveryCharged = eurosToCagnotteCents(order.deliveryFee);
    if (sum(enrollment.snapshot.eligibleCents, deliveryCharged) !== eurosToCagnotteCents(order.total)) fail("refund_original_amounts_require_verification");
    try {
      const paymentCents = orderPaymentCents(order);
      if (mixed && (!hasOwn(order, "paymentAmount") || paymentCents !== sum(enrollment.snapshot.productsPaidCents, deliveryCharged))) throw new Error();
    } catch { fail("refund_original_amounts_require_verification"); }
    const internalOrder = {
      orderId: order.id,
      beneficiaryId: enrollment.beneficiaryId,
      programVersion: enrollment.programVersion,
      createdAtEpochMs: enrollment.createdAtEpochMs,
      snapshot: enrollment.snapshot,
    };
    const decision = mixed ? validatePaymentEvidence(order.cagnottePaymentEvidence, paidAt) : "attributed";
    const basis = await readCagnotteRefundBasis({
      db: input.db,
      transaction: tx,
      order: internalOrder,
      allowMissingAccrual: decision === "not_attributed",
    });
    const cancelled = order.orderStatus === "cancelled" || order.paymentStatus === "cancelled" || Boolean(order.cancelledAt);
    if (decision === "attributed") {
      if (!basis.state?.paymentConfirmed) fail("refund_right_requires_verification");
      if (basis.state.cancelled !== cancelled) fail("refund_cancellation_requires_verification");
    } else if (basis.state) {
      if (basis.state.paymentConfirmed || basis.state.credited || basis.state.remainingGainCents !== 0 ||
        basis.state.compartment !== "none" || !basis.state.cancelled || !cancelled) fail("refund_right_requires_verification");
    } else if (cancelled) {
      fail("refund_cancellation_requires_verification");
    }
    const reservationBasis = mixed
      ? await readConsumedReservation(order.cagnotteReservationIntent, input.db, tx)
      : null;

    const history = await tx.get(input.db.collection(collection).where("orderId", "==", order.id).limit(historyLimit + 1));
    if (history.size > historyLimit) fail("refund_history_requires_verification");
    const refundMovements = await tx.get(input.db.collection("cagnotteMovements").where("orderId", "==", order.id));
    const reconstruction = reconstructOrderRefundHistory({
      orderId: order.id,
      beneficiaryId: enrollment.beneficiaryId,
      snapshot: enrollment.snapshot,
      recordVersion,
      decision,
      deliveryCharged,
      accrual: basis.state,
      reservationBasis,
      historyDocs: history.docs,
      movementDocs: refundMovements.docs,
      movementFailureCode: "refund_history_requires_verification",
    });
    const events = reconstruction.originals.map((entry) => entry.event);
    const correctionEvents = reconstruction.corrections.map((entry) => entry.event);
    const reconstructed = reconstruction.effective;

    const nextLines = addReturns(reconstructed.lines, request.additionalReturns);
    const simulation = simulateCagnotteRefund(enrollment.snapshot, reconstructed.lines, nextLines);
    const nextDelivery = sum(reconstructed.deliveryFinancialCents, request.deliveryRefundCents);
    if (nextDelivery > deliveryCharged) fail("refund_delivery_exceeds_remaining", 400);
    const returnedProductNetCents = simulation.delta.returnedNetCents;
    const productFinancialCents = simulation.delta.financialRefundCents;
    const cagnotteRestitutionCents = simulation.delta.cagnotteRestitutionCents;
    const totalFinancialCents = sum(productFinancialCents, request.deliveryRefundCents);
    const version = hash({
      version: recordVersion,
      order: internalOrder,
      paidAt,
      deliveryCharged,
      before: reconstructed,
      events: [...events.map((event) => event.fingerprint), ...correctionEvents.map((event) => event.fingerprint)],
      loyaltyAccrualDecision: decision,
    });
    if (confirmed?.expectedPreviewVersion !== undefined && confirmed.expectedPreviewVersion !== version) fail("refund_preview_stale");
    if (confirmed && confirmed.declaredFinancialCents !== totalFinancialCents) fail("refund_declared_amount_requires_verification");

    const refundId = key ?? hash(["preview", order.id, version, request.additionalReturns, request.deliveryRefundCents]);
    let writePlan: (() => void) | null = null;
    let planMovementIds: readonly string[] = [];
    let effect = {
      pendingDeltaCents: 0,
      availableDeltaCents: 0,
      regularizationDeltaCents: 0,
      remainingGainCents: basis.state?.remainingGainCents ?? 0,
    };
    let restitution: Restitution = {
      grossCents: cagnotteRestitutionCents,
      compensationCents: 0,
      availableIncreaseCents: cagnotteRestitutionCents,
      availableAfterCents: basis.wallet.availableCents,
      cumulativeCents: simulation.next.cagnotteRestitutionCents,
      reservationState: mixed ? "consumed" : "not_applicable",
    };
    if (request.additionalReturns.length && mixed) {
      const plan = await prepareCagnotteRefundComposition({
        db: input.db,
        transaction: tx,
        intent: order.cagnotteReservationIntent!,
        refundId,
        additionalReturns: request.additionalReturns,
        grossRestitutionCents: cagnotteRestitutionCents,
        correctLoyalty: decision === "attributed",
        remainingGainCentsWhenSkipped: basis.state?.remainingGainCents ?? 0,
        recordedAtEpochMs: Date.parse(recordedAt),
      });
      if (plan.restitution.cumulativeRestitutedCents !== simulation.next.cagnotteRestitutionCents) fail("refund_journal_requires_verification");
      effect = plan.loyaltyEffect;
      restitution = {
        grossCents: plan.restitution.grossRestitutionCents,
        compensationCents: plan.restitution.compensationCents,
        availableIncreaseCents: plan.restitution.availableIncreaseCents,
        availableAfterCents: plan.walletAfter.availableCents,
        cumulativeCents: plan.restitution.cumulativeRestitutedCents,
        reservationState: "consumed",
      };
      planMovementIds = plan.movementIds;
      writePlan = plan.write;
    } else if (request.additionalReturns.length) {
      const plan = await prepareCagnotteLedgerOperation({
        db: input.db,
        transaction: tx,
        program: null,
        recordedAtEpochMs: Date.parse(recordedAt),
        command: { order: internalOrder, event: "refund_confirmed", refundId, additionalReturns: request.additionalReturns },
      });
      if (!plan.refundEffect || plan.result.status !== "applied") fail("refund_journal_requires_verification");
      effect = plan.refundEffect;
      planMovementIds = plan.result.movementIds;
      writePlan = plan.write;
      restitution.availableAfterCents = basis.wallet.availableCents + effect.availableDeltaCents;
    }
    const after = cumulative(nextLines, simulation.next.financialRefundCents, simulation.next.cagnotteRestitutionCents, nextDelivery);
    const productsFullyRefunded = after.returnedProductNetCents === enrollment.snapshot.eligibleCents &&
      after.productFinancialCents === enrollment.snapshot.productsPaidCents &&
      after.cagnotteRestitutionCents === enrollment.snapshot.appliedCagnotteCents;
    const result: RefundResult = {
      kind: confirmed ? "administrative_refund_recorded" : "refund_preview",
      orderId: order.id,
      currency: "EUR",
      additionalReturns: request.additionalReturns,
      returnedProductNetCents,
      productFinancialCents,
      cagnotteRestitutionCents,
      deliveryFinancialCents: request.deliveryRefundCents,
      totalFinancialCents,
      loyaltyAccrualDecision: decision,
      correction: {
        theoreticalCents: simulation.delta.loyaltyCorrectionCents,
        appliedCents: sum(-effect.pendingDeltaCents, -effect.availableDeltaCents, effect.regularizationDeltaCents),
        ...effect,
      },
      restitution,
      before: reconstructed,
      after,
      previewVersion: version,
      productsFullyRefunded,
      entirePaymentRefunded: productsFullyRefunded && nextDelivery === deliveryCharged,
      ...(confirmed ? { recordedAt, confirmedAt: confirmed.confirmedAt } : {}),
    };
    if (!confirmed || !eventRef || !content) return publicResult(result);
    const event: Event = {
      schemaVersion: mixed ? 2 : 1,
      version: recordVersion,
      orderId: order.id,
      beneficiaryId: enrollment.beneficiaryId,
      source: confirmed.source,
      reference: confirmed.reference,
      content,
      fingerprint: cagnotteAdminRefundBusinessFingerprint(content),
      sequence: events.length + 1,
      result,
      movementIds: planMovementIds,
      actor: input.actor,
      recordedAt,
      confirmedAt: confirmed.confirmedAt,
      calculationVersion: enrollment.calculationVersion,
      regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION,
    };
    tx.create(eventRef, event);
    writePlan?.();
    tx.update(orderRef, {
      refundSummary: {
        version: recordVersion,
        returnedProductNetCents: result.after.returnedProductNetCents,
        productFinancialCents: result.after.productFinancialCents,
        cagnotteRestitutionCents: result.after.cagnotteRestitutionCents,
        deliveryFinancialCents: result.after.deliveryFinancialCents,
        totalFinancialCents: result.after.totalFinancialCents,
        productsFullyRefunded: result.productsFullyRefunded,
        entirePaymentRefunded: result.entirePaymentRefunded,
        kind: "administrative_confirmation",
        recordedAt,
      },
    });
    return publicResult(result, false);
  });
  if (confirmed && key) {
    emitOperationalLog(input.log, {
      event: "cagnotte_refund_recorded",
      orderHash: hash(["order", request.orderId]),
      eventId: key,
      version: result.restitution.reservationState === "consumed" ? ORDER_MIXED_REFUND_VERSION : ORDER_REFUND_VERSION,
      deltas: {
        returnedProductNetCents: result.returnedProductNetCents,
        financialCents: result.totalFinancialCents,
        cagnotteRestitutionCents: result.cagnotteRestitutionCents,
        pendingCents: result.correction.pendingDeltaCents,
        availableCents: result.correction.availableDeltaCents,
        regularizationCents: result.correction.regularizationDeltaCents,
      },
      result: result.kind,
      idempotent: result.alreadyRecorded === true,
    });
  }
  return result;
}

async function inspectOrderRefunds(db: Firestore, orderId: string) {
  return db.runTransaction(async (tx) => {
    const orderRef = db.collection("orders").doc(orderId);
    const [orderDoc, history] = await Promise.all([
      tx.get(orderRef),
      tx.get(db.collection(collection).where("orderId", "==", orderId).limit(historyLimit + 1)),
    ]);
    if (!orderDoc.exists) fail("refund_order_missing", 404);
    if (history.size > historyLimit) fail("refund_history_requires_verification");
    const order = orderFromSnapshot(orderDoc);
    if (!hasCagnotteEnrollment(order)) fail("refund_historical_order_not_supported");
    const enrollment = validateOrderCagnotteEnrollment(order);
    const accrualEnrollment = enrollment.accrualEnrollment ?? "enrolled";
    const internalOrder = {
      orderId: order.id,
      beneficiaryId: enrollment.beneficiaryId,
      programVersion: enrollment.programVersion,
      createdAtEpochMs: enrollment.createdAtEpochMs,
      snapshot: enrollment.snapshot,
    };
    const [accrualDoc, walletDoc, movementDocs] = await Promise.all([
      tx.get(db.collection("cagnotteAccruals").doc(order.id)),
      tx.get(db.collection("cagnotteWallets").doc(enrollment.beneficiaryId)),
      tx.get(db.collection("cagnotteMovements").where("orderId", "==", order.id).limit(historyLimit + 1)),
    ]);
    if (movementDocs.size > historyLimit) fail("refund_history_requires_verification");
    let accrual: CagnotteAccrual | null = null;
    let wallet: CagnotteWallet | null = null;
    try {
      wallet = walletDoc.exists ? readCagnotteWallet(walletDoc.data(), enrollment.beneficiaryId) : null;
    } catch {
      fail("refund_journal_requires_verification");
    }
    if (accrualDoc.exists) {
      try {
        const basis = await readCagnotteRefundBasis({ db, transaction: tx, order: internalOrder });
        accrual = basis.state;
        wallet = basis.wallet;
      } catch {
        fail("refund_journal_requires_verification");
      }
    }
    if (accrualEnrollment === "enrolled" && !accrual && orderRequiresAccrualJournal(order)) {
      fail("refund_journal_requires_verification");
    }
    if (accrualEnrollment === "not_enrolled" && accrual && !isZeroCreditCancellationTombstone(accrual)) {
      fail("refund_journal_requires_verification");
    }
    let reservationBasis: Awaited<ReturnType<typeof readCagnotteReservationBasis>> | null = null;
    try {
      reservationBasis = enrollment.snapshot.appliedCagnotteCents > 0
        ? await readCagnotteReservationBasis({ db, transaction: tx, intent: order.cagnotteReservationIntent! })
        : null;
    } catch {
      fail("refund_journal_requires_verification");
    }
    if (reservationBasis && !wallet) fail("refund_right_requires_verification");
    const orderItemsByLineId = refundOrderItemsByLineId(order, enrollment.snapshot);
    const mixed = enrollment.snapshot.appliedCagnotteCents > 0;
    const hasOriginalHistory = history.docs.some((doc) => doc.data().kind !== "refund_correction");
    const decision = mixed && hasOriginalHistory
      ? validatePaymentEvidence(order.cagnottePaymentEvidence, instant(order.paidAt))
      : "attributed";
    const reconstruction = reconstructOrderRefundHistory({
      orderId: order.id,
      beneficiaryId: enrollment.beneficiaryId,
      snapshot: enrollment.snapshot,
      recordVersion: mixed ? ORDER_MIXED_REFUND_VERSION : ORDER_REFUND_VERSION,
      decision,
      deliveryCharged: eurosToCagnotteCents(order.deliveryFee),
      accrual,
      reservationBasis,
      historyDocs: history.docs,
      movementDocs: movementDocs.docs,
      movementFailureCode: "refund_journal_requires_verification",
    });
    const { originals, corrections, effective } = reconstruction;
    const lastOriginal = lastItem(originals);
    const inspectedMovements = validateAdminMovementJournal({
      order: internalOrder,
      deliveryCharged: eurosToCagnotteCents(order.deliveryFee),
      accrual,
      reservationBasis,
      originals,
      corrections,
      movementDocs: movementDocs.docs,
    });
    const movements = inspectedMovements.flatMap((entry) => entry.kind === "displayable" ? [entry.movement] : [])
      .sort((a, b) => b.recordedAtEpochMs - a.recordedAtEpochMs || a.id.localeCompare(b.id));
    const omittedLegacyUndatedCount = inspectedMovements.filter((entry) => entry.kind === "legacy_undated").length;
    const unpaid = await readUnpaidOrderContext({ db, transaction: tx, order, nowEpochMs: Date.now() });
    const cancelled = accrual?.cancelled ?? (order.orderStatus === "cancelled" || order.paymentStatus === "cancelled" || Boolean(order.cancelledAt));
    const accrualView = {
      present: accrual !== null,
      initialGainCents: accrualEnrollment === "not_enrolled" ? 0 : accrual?.initialGainCents ?? enrollment.snapshot.loyaltyCents,
      remainingGainCents: accrual?.remainingGainCents ?? 0,
      paymentConfirmed: accrual?.paymentConfirmed ?? false,
      deliveryConfirmed: accrual?.deliveryConfirmed ?? false,
      credited: accrual?.credited ?? false,
      compartment: accrual?.compartment ?? "none" as const,
      cancelled,
    };
    const refundHistory = [
      ...originals.map(({ id, event }) => ({ id, type: "initial_declaration" as const, revision: 0, recordedAt: event.recordedAt,
        source: event.source as "admin" | "provider_reference", businessFingerprint: event.fingerprint,
        reference: event.reference, declaredFinancialCents: event.content.declaredFinancialCents,
        returnedProductNetCents: event.result.returnedProductNetCents,
        financialCents: event.result.totalFinancialCents,
        cagnotteRestitutionCents: event.result.cagnotteRestitutionCents,
        resultingAvailableCents: event.result.restitution.availableAfterCents,
        effective: corrections.every((entry) => entry.event.targetEventId !== id) })),
      ...corrections.map(({ id, event }) => ({ id, type: "correction" as const, revision: event.revision, recordedAt: event.recordedAt,
        reference: event.correctionReference, businessFingerprint: event.fingerprint, targetEventId: event.targetEventId, declaredFinancialCents: event.content.declaredFinancialCents,
        targetReference: originals.find((entry) => entry.id === event.targetEventId)?.event.reference,
        returnedProductNetCents: event.result.effective.returnedProductNetCents,
        financialCents: event.result.effective.totalFinancialCents,
        cagnotteRestitutionCents: event.result.effective.cagnotteRestitutionCents,
        resultingAvailableCents: event.result.walletAfter.availableCents,
        effective: event.targetEventId === lastOriginal?.id && event.revision === corrections.filter((entry) => entry.event.targetEventId === event.targetEventId).length })),
    ].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.revision - a.revision ||
      Number(b.type === "correction") - Number(a.type === "correction"));
    const operationalState = adminOperationalState({ accrualEnrollment, accrual: accrualView, hasRefund: refundHistory.length > 0 });
    return {
      kind: "administrative_refund_inspection" as const,
      order: {
        id: order.id,
        customer: { id: order.customerId ?? enrollment.beneficiaryId, name: order.customerName ?? "Client", email: order.customerEmail ?? "" },
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        totalCents: eurosToCagnotteCents(order.total),
        paymentAmountCents: orderPaymentCents(order),
        deliveryCents: eurosToCagnotteCents(order.deliveryFee),
      },
      financing: {
        productsNetCents: enrollment.snapshot.eligibleCents,
        cagnotteCents: enrollment.snapshot.appliedCagnotteCents,
        externalProductsCents: enrollment.snapshot.productsPaidCents,
        externalTotalCents: orderPaymentCents(order),
        deliveryCents: eurosToCagnotteCents(order.deliveryFee),
      },
      operationalState,
      enrollment: {
        enrolled: accrualEnrollment === "enrolled",
        accrualEnrollment,
        beneficiaryId: enrollment.beneficiaryId,
        programVersion: enrollment.programVersion,
        calculationVersion: enrollment.calculationVersion,
        createdAtEpochMs: enrollment.createdAtEpochMs,
      },
      accrual: accrualView,
      wallet: wallet ? {
        pendingCents: wallet.pendingCents, availableCents: wallet.availableCents,
        reservedCents: wallet.reservedCents, regularizationCents: wallet.regularizationCents,
      } : null,
      reservation: {
        applicable: reservationBasis !== null,
        amountCents: reservationBasis?.reservation.amountCents ?? 0,
        state: reservationBasis?.reservation.state ?? null,
        requiresReview: Boolean(reservationBasis && unpaid.reviewRequired),
        cumulativeRestitutedCents: reservationBasis?.cumulativeRestitutedCents ?? 0,
      },
      refund: {
        history: refundHistory.map((entry) => ({ id: entry.id, type: entry.type, revision: entry.revision, recordedAt: entry.recordedAt, effective: entry.effective })),
        latest: refundHistory[0] ? { id: refundHistory[0].id, type: refundHistory[0].type, revision: refundHistory[0].revision, recordedAt: refundHistory[0].recordedAt } : null,
        latestRevision: refundHistory[0]?.revision ?? 0,
        requiresReview: false,
      },
      movements,
      movementHistory: {
        complete: omittedLegacyUndatedCount === 0,
        omittedLegacyUndatedCount,
      },
      lines: enrollment.snapshot.lines.map((line, index) => ({
        lineId: line.lineId,
        label: orderItemsByLineId.get(line.lineId)?.name ?? `Ligne ${index + 1}`,
        initialNetCents: line.netCents,
        returnedNetCents: effective.lines.find((entry) => entry.lineId === line.lineId)?.returnedNetCents ?? 0,
        remainingNetCents: line.netCents - (effective.lines.find((entry) => entry.lineId === line.lineId)?.returnedNetCents ?? 0),
      })),
      effective,
      history: refundHistory,
      correctionTarget: lastOriginal ? {
        eventId: lastOriginal.id,
        revision: corrections.filter((entry) => entry.event.targetEventId === lastOriginal.id).length,
        effective,
      } : null,
      unpaid,
    };
  });
}

function refundOrderItemsByLineId(order: Pick<Order, "items">, snapshot: CagnotteSnapshot) {
  if (!Array.isArray(order.items) || order.items.length !== snapshot.lines.length) {
    fail("refund_order_lines_require_verification");
  }
  const snapshotById = new Map<string, CagnotteSnapshot["lines"][number]>();
  for (const line of snapshot.lines) {
    if (snapshotById.has(line.lineId)) fail("refund_order_lines_require_verification");
    snapshotById.set(line.lineId, line);
  }
  const itemsById = new Map<string, Order["items"][number]>();
  for (const [index, item] of order.items.entries()) {
    const lineId = cagnotteOrderItemLineId(item, index);
    const line = snapshotById.get(lineId);
    if (!line || itemsById.has(lineId)) fail("refund_order_lines_require_verification");
    try {
      if (eurosToCagnotteCents(item.lineTotal) !== line.initialCents || Boolean(item.isGift) !== Boolean(line.isGift)) {
        fail("refund_order_lines_require_verification");
      }
    } catch (error) {
      if (error instanceof OrderRefundError) throw error;
      fail("refund_order_lines_require_verification");
    }
    itemsById.set(lineId, item);
  }
  if (itemsById.size !== snapshotById.size) fail("refund_order_lines_require_verification");
  return itemsById;
}

function reconstructOrderRefundHistory(input: {
  orderId: string;
  beneficiaryId: string;
  snapshot: CagnotteSnapshot;
  recordVersion: string;
  decision: "attributed" | "not_attributed";
  deliveryCharged: number;
  accrual: CagnotteAccrual | null;
  reservationBasis: Awaited<ReturnType<typeof readCagnotteReservationBasis>> | null;
  historyDocs: readonly QueryDocumentSnapshot[];
  movementDocs: readonly QueryDocumentSnapshot[];
  movementFailureCode: "refund_history_requires_verification" | "refund_journal_requires_verification";
}) {
  const failMovement = (): never => fail(input.movementFailureCode);
  const movementById = new Map(input.movementDocs.map((doc) => [doc.id, doc.data()]));
  const corrections = input.historyDocs.filter((doc) => doc.data().kind === "refund_correction").map((doc) => {
    const event = doc.data() as CorrectionEvent;
    validateStoredCorrectionEvent(event, doc.id);
    if (event.orderId !== input.orderId || event.beneficiaryId !== input.beneficiaryId) fail("refund_history_requires_verification");
    return { id: doc.id, event };
  }).sort((a, b) => a.event.recordedAt.localeCompare(b.event.recordedAt) || a.event.revision - b.event.revision);
  const originals = input.historyDocs.filter((doc) => doc.data().kind !== "refund_correction").map((doc) => {
    const event = doc.data() as Event;
    validateStoredEvent(event, doc.id);
    return { id: doc.id, event };
  }).sort((a, b) => a.event.sequence - b.event.sequence);
  let effective = cumulative(
    input.snapshot.lines.map((line) => ({ lineId: line.lineId, returnedNetCents: 0 })).sort(byLine),
    0, 0, 0,
  );
  const referencedMovements = new Set<string>();
  const linkedCorrectionIds = new Set<string>();
  for (const [index, { id: originalId, event }] of originals.entries()) {
    const result = normalizeResult(event.result);
    if (event.orderId !== input.orderId || event.beneficiaryId !== input.beneficiaryId || event.sequence !== index + 1 ||
      stable(result.before) !== stable(effective) || event.version !== input.recordVersion ||
      result.loyaltyAccrualDecision !== input.decision) fail("refund_history_requires_verification");
    const lines = addReturns(effective.lines, event.content.additionalReturns);
    const simulation = simulateCagnotteRefund(input.snapshot, effective.lines, lines);
    const next = cumulative(lines, simulation.next.financialRefundCents, simulation.next.cagnotteRestitutionCents,
      sum(effective.deliveryFinancialCents, event.content.deliveryRefundCents));
    if (next.deliveryFinancialCents > input.deliveryCharged || stable(next) !== stable(result.after) ||
      result.returnedProductNetCents !== simulation.delta.returnedNetCents ||
      result.productFinancialCents !== simulation.delta.financialRefundCents ||
      result.cagnotteRestitutionCents !== simulation.delta.cagnotteRestitutionCents ||
      result.correction.theoreticalCents !== simulation.delta.loyaltyCorrectionCents ||
      result.restitution.grossCents !== simulation.delta.cagnotteRestitutionCents ||
      result.restitution.cumulativeCents !== simulation.next.cagnotteRestitutionCents) fail("refund_history_requires_verification");
    const expectedLedgerMovement = event.content.additionalReturns.length > 0 && input.decision === "attributed";
    const expectedRestitutionMovement = simulation.delta.cagnotteRestitutionCents > 0;
    if (event.movementIds.length !== Number(expectedLedgerMovement) + Number(expectedRestitutionMovement)) failMovement();
    for (const movementId of event.movementIds) {
      if (referencedMovements.has(movementId)) failMovement();
      const movement = movementById.get(movementId);
      if (!movement) fail(input.movementFailureCode);
      if (movement.orderId !== input.orderId || movement.beneficiaryId !== input.beneficiaryId) failMovement();
      if (movement.businessEvent === "refund_confirmed") {
        const payload = JSON.parse(String(movement.payload)) as Record<string, unknown>;
        if (!expectedLedgerMovement || payload.refundId !== originalId ||
          stable(payload.additionalReturns) !== stable(event.content.additionalReturns) ||
          movement.pendingDeltaCents !== result.correction.pendingDeltaCents || movement.availableDeltaCents !== result.correction.availableDeltaCents ||
          (movement.regularizationDeltaCents ?? 0) !== result.correction.regularizationDeltaCents) failMovement();
      } else if (movement.businessEvent === "credit_refunded_after_return") {
        const payload = JSON.parse(String(movement.payload)) as Record<string, unknown>;
        if (!expectedRestitutionMovement || payload.refundId !== originalId ||
          payload.grossRestitutionCents !== result.restitution.grossCents || payload.compensationCents !== result.restitution.compensationCents ||
          movement.pendingDeltaCents !== 0 || movement.availableDeltaCents !== result.restitution.availableIncreaseCents ||
          movement.reservedDeltaCents !== 0 || movement.regularizationDeltaCents !== -result.restitution.compensationCents) failMovement();
      } else {
        failMovement();
      }
      referencedMovements.add(movementId);
    }
    effective = next;
    const linkedCorrections = corrections.filter((entry) => entry.event.targetEventId === originalId)
      .sort((a, b) => a.event.revision - b.event.revision);
    for (const [correctionIndex, { id: correctionId, event: correctionEvent }] of linkedCorrections.entries()) {
      if (linkedCorrectionIds.has(correctionId) || correctionEvent.previousRevision !== correctionIndex ||
        correctionEvent.revision !== correctionIndex + 1 || stable(correctionEvent.result.previousEffective) !== stable(effective)) {
        fail("refund_history_requires_verification");
      }
      validateCorrectionResult(correctionEvent, event, input.snapshot, input.deliveryCharged);
      let correctionPending = 0, correctionAvailable = 0, correctionRegularization = 0;
      for (const movementId of correctionEvent.movementIds) {
        if (referencedMovements.has(movementId)) failMovement();
        const movement = movementById.get(movementId);
        if (!movement) fail(input.movementFailureCode);
        if (movement.orderId !== input.orderId || movement.beneficiaryId !== input.beneficiaryId ||
          !["refund_declaration_corrected", "credit_refund_corrected"].includes(movement.businessEvent)) {
          failMovement();
        }
        const payload = JSON.parse(String(movement.payload)) as Record<string, unknown>;
        if (payload.correctionId !== correctionId || payload.targetEventId !== correctionEvent.targetEventId ||
          payload.revision !== correctionEvent.revision || payload.event !== movement.businessEvent || movement.reservedDeltaCents !== 0) {
          failMovement();
        }
        correctionPending += Number(movement.pendingDeltaCents);
        correctionAvailable += Number(movement.availableDeltaCents);
        correctionRegularization += Number(movement.regularizationDeltaCents ?? 0);
        referencedMovements.add(movementId);
      }
      if (correctionPending !== correctionEvent.result.differential.pendingDeltaCents ||
        correctionAvailable !== correctionEvent.result.differential.availableDeltaCents ||
        correctionRegularization !== correctionEvent.result.differential.regularizationDeltaCents) {
        failMovement();
      }
      linkedCorrectionIds.add(correctionId);
      effective = correctionEvent.result.effective;
    }
  }
  const unexpectedRefundMovement = input.movementDocs.some((doc) =>
    ["refund_confirmed", "credit_refunded_after_return", "refund_declaration_corrected", "credit_refund_corrected"].includes(doc.data().businessEvent) &&
    !referencedMovements.has(doc.id));
  const projectedRefundKeys = [
    ...(input.reservationBasis?.reservation.refundProjection?.events.map((event) => event.eventKey) ?? []),
    ...(input.reservationBasis?.reservation.refundProjection?.corrections?.flatMap((correction) => correction.eventKey ? [correction.eventKey] : []) ?? []),
  ];
  const confirmedRefundKeys = [
    ...originals.flatMap(({ event }) => event.movementIds.filter((movementId) =>
      movementById.get(movementId)?.businessEvent === "credit_refunded_after_return")),
    ...corrections.flatMap(({ event }) => event.movementIds.filter((movementId) =>
      movementById.get(movementId)?.businessEvent === "credit_refund_corrected")),
  ];
  if (linkedCorrectionIds.size !== corrections.length ||
    (input.accrual && stable([...input.accrual.cumulativeReturns].sort(byLine)) !== stable(effective.lines)) ||
    (input.reservationBasis && input.reservationBasis.cumulativeRestitutedCents !== effective.cagnotteRestitutionCents)) {
    fail("refund_history_requires_verification");
  }
  if (unexpectedRefundMovement || stable(projectedRefundKeys) !== stable(confirmedRefundKeys)) failMovement();
  return { originals, corrections, effective, referencedMovementIds: [...referencedMovements].sort() };
}

type InspectedMovementProjection =
  | { kind: "displayable"; movement: {
      id: string;
      event: string;
      pendingDeltaCents: number;
      availableDeltaCents: number;
      reservedDeltaCents: number;
      regularizationDeltaCents: number;
      recordedAtEpochMs: number;
    } }
  | { kind: "legacy_undated" };

type AdminMovementFamily = "ledger" | "reservation" | "refund_correction";

function validateAdminMovementJournal(input: {
  order: {
    orderId: string;
    beneficiaryId: string;
    programVersion: string;
    snapshot: CagnotteSnapshot;
  };
  deliveryCharged: number;
  accrual: CagnotteAccrual | null;
  reservationBasis: Awaited<ReturnType<typeof readCagnotteReservationBasis>> | null;
  originals: readonly { id: string; event: Event }[];
  corrections: readonly { id: string; event: CorrectionEvent }[];
  movementDocs: readonly QueryDocumentSnapshot[];
}): InspectedMovementProjection[] {
  try {
    const movementById = new Map(input.movementDocs.map((doc) => [doc.id, doc.data()]));
    const expectedFamilies = new Map<string, AdminMovementFamily>();
    const reservationMovementIds = new Set(input.reservationBasis?.validatedMovementIds ?? []);
    const expect = (id: string, family: AdminMovementFamily) => {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("movement_id_invalid");
      const current = expectedFamilies.get(id);
      if (current && current !== family) throw new Error("movement_family_conflict");
      expectedFamilies.set(id, family);
    };
    const movement = (id: string) => {
      const value = movementById.get(id);
      if (!value) throw new Error("movement_missing");
      return value;
    };

    for (const id of reservationMovementIds) expect(id, "reservation");
    if (input.accrual) {
      if (input.accrual.credited) expect(cagnotteLedgerMovementId(input.order.orderId, "payment_confirmed"), "ledger");
      if (input.accrual.deliveryConfirmed) expect(cagnotteLedgerMovementId(input.order.orderId, "delivery_confirmed"), "ledger");
      if (input.accrual.compartment === "available") expect(cagnotteLedgerMovementId(input.order.orderId, "made_available"), "ledger");
      if (input.accrual.cancelled) expect(cagnotteLedgerMovementId(input.order.orderId, "cancelled"), "ledger");
    }

    const linkedReservationRefunds: string[] = [];
    for (const { event } of input.originals) {
      const result = normalizeResult(event.result);
      const expectsLedger = event.content.additionalReturns.length > 0 && result.loyaltyAccrualDecision === "attributed";
      const expectsRestitution = result.restitution.grossCents > 0;
      let ledgerSeen = false;
      let restitutionSeen = false;
      for (const movementId of event.movementIds) {
        const value = movement(movementId);
        if (value.businessEvent === "refund_confirmed") {
          if (!expectsLedger || ledgerSeen || !input.accrual) throw new Error("ledger_refund_unexpected");
          const payload = JSON.parse(String(value.payload)) as Record<string, unknown>;
          if (payload.refundId !== eventKey(event.source, event.reference) ||
            stable(payload.additionalReturns) !== stable(event.content.additionalReturns) ||
            value.pendingDeltaCents !== result.correction.pendingDeltaCents ||
            value.availableDeltaCents !== result.correction.availableDeltaCents ||
            (value.regularizationDeltaCents ?? 0) !== result.correction.regularizationDeltaCents) {
            throw new Error("ledger_refund_mismatch");
          }
          ledgerSeen = true;
          expect(movementId, "ledger");
        } else if (value.businessEvent === "credit_refunded_after_return") {
          if (!expectsRestitution || restitutionSeen || !reservationMovementIds.has(movementId)) throw new Error("reservation_refund_unexpected");
          const payload = JSON.parse(String(value.payload)) as Record<string, unknown>;
          if (payload.refundId !== eventKey(event.source, event.reference) ||
            payload.grossRestitutionCents !== result.restitution.grossCents ||
            payload.compensationCents !== result.restitution.compensationCents ||
            value.pendingDeltaCents !== 0 || value.availableDeltaCents !== result.restitution.availableIncreaseCents ||
            value.reservedDeltaCents !== 0 || value.regularizationDeltaCents !== -result.restitution.compensationCents) {
            throw new Error("reservation_refund_mismatch");
          }
          restitutionSeen = true;
          linkedReservationRefunds.push(movementId);
          expect(movementId, "reservation");
        } else {
          throw new Error("refund_movement_family_invalid");
        }
      }
      if (ledgerSeen !== expectsLedger || restitutionSeen !== expectsRestitution) throw new Error("refund_movement_missing");
    }

    const linkedReservationCorrections: string[] = [];
    const projectedCorrections = input.reservationBasis?.reservation.refundProjection?.corrections ?? [];
    for (const { id: correctionId, event } of input.corrections) {
      const target = input.originals.find((entry) => entry.id === event.targetEventId)?.event;
      if (!target) throw new Error("correction_target_missing");
      validateCorrectionResult(event, target, input.order.snapshot, input.deliveryCharged);
      const differential = event.result.differential;
      const projected = projectedCorrections.find((entry) => entry.correctionId === correctionId);
      if (Boolean(input.reservationBasis) !== Boolean(projected) ||
        event.result.reservationState !== (input.reservationBasis ? "consumed" : "not_applicable")) {
        throw new Error("correction_projection_missing");
      }
      const restitutionDelta = projected?.restitutionDeltaCents ?? 0;
      const compensation = projected?.compensationCents ?? 0;
      if (projected && (projected.targetRefundId !== event.targetEventId || projected.revision !== event.revision ||
        restitutionDelta !== differential.cagnotteRestitutionCents || differential.regularizationDeltaCents !== -compensation ||
        projected.recordedAtEpochMs !== Date.parse(event.recordedAt))) {
        throw new Error("correction_projection_mismatch");
      }
      if (!projected && (differential.cagnotteRestitutionCents !== 0 || differential.regularizationDeltaCents !== 0)) {
        throw new Error("correction_restitution_unexpected");
      }
      const restitutionAvailable = restitutionDelta > 0 ? restitutionDelta - compensation : restitutionDelta;
      const loyaltyAvailable = differential.availableDeltaCents - restitutionAvailable;
      if (!Number.isSafeInteger(loyaltyAvailable)) throw new Error("correction_delta_invalid");
      const expectedIds: string[] = [];
      if (differential.pendingDeltaCents !== 0 || loyaltyAvailable !== 0) {
        const id = hash(["refund-correction-movement", event.targetEventId, event.revision, "loyalty"]);
        expectedIds.push(id);
        const expected = correctionMovement(input.order, id, "refund_declaration_corrected", event.recordedAt,
          { correctionId, targetEventId: event.targetEventId, revision: event.revision },
          differential.pendingDeltaCents, loyaltyAvailable, 0);
        if (stable(movement(id)) !== stable(expected)) throw new Error("loyalty_correction_mismatch");
        expect(id, "refund_correction");
      }
      if (restitutionDelta !== 0) {
        const id = hash(["refund-correction-movement", event.targetEventId, event.revision, "restitution"]);
        if (projected?.eventKey !== id || !reservationMovementIds.has(id)) throw new Error("restitution_correction_key_invalid");
        expectedIds.push(id);
        const expected = correctionMovement(input.order, id, "credit_refund_corrected", event.recordedAt,
          { correctionId, targetEventId: event.targetEventId, revision: event.revision, restitutionDeltaCents: restitutionDelta, compensationCents: compensation },
          0, restitutionAvailable, -compensation);
        if (stable(movement(id)) !== stable(expected)) throw new Error("restitution_correction_mismatch");
        linkedReservationCorrections.push(id);
        expect(id, "reservation");
      }
      if (stable(event.movementIds) !== stable(expectedIds)) throw new Error("correction_movement_ids_invalid");
    }

    const projectedRefundIds = input.reservationBasis?.reservation.refundProjection?.events.map((event) => event.eventKey) ?? [];
    const projectedCorrectionIds = projectedCorrections.map((correction) => correction.correctionId);
    if (stable([...linkedReservationRefunds].sort()) !== stable([...projectedRefundIds].sort()) ||
      stable([...linkedReservationCorrections].sort()) !== stable(projectedCorrections.flatMap((correction) => correction.eventKey ? [correction.eventKey] : []).sort()) ||
      (input.reservationBasis && stable(input.corrections.map((entry) => entry.id).sort()) !== stable([...projectedCorrectionIds].sort()))) {
      throw new Error("reservation_refund_projection_unlinked");
    }

    for (const [id, family] of expectedFamilies) {
      const value = movement(id);
      if (family === "ledger") {
        if (!input.accrual) throw new Error("ledger_state_missing");
        validateCagnotteLedgerMovementForRead(value, id, input.accrual);
      }
    }
    if (movementById.size !== expectedFamilies.size || [...movementById.keys()].some((id) => !expectedFamilies.has(id))) {
      throw new Error("movement_unexpected");
    }
    return input.movementDocs.map((doc) => projectValidatedMovement(doc.id, doc.data()));
  } catch {
    fail("refund_journal_requires_verification");
  }
}

function projectValidatedMovement(id: string, raw: Record<string, unknown>): InspectedMovementProjection {
  const schema = raw.schemaVersion;
  const legacy = schema === 1 || schema === 2;
  const hasRecordedAt = hasOwn(raw, "recordedAtEpochMs");
  if (legacy && !hasRecordedAt) return { kind: "legacy_undated" };
  return { kind: "displayable", movement: {
    id,
    event: raw.businessEvent as string,
    pendingDeltaCents: raw.pendingDeltaCents as number,
    availableDeltaCents: raw.availableDeltaCents as number,
    reservedDeltaCents: (raw.reservedDeltaCents ?? 0) as number,
    regularizationDeltaCents: (raw.regularizationDeltaCents ?? 0) as number,
    recordedAtEpochMs: raw.recordedAtEpochMs as number,
  } };
}

function adminOperationalState(input: {
  accrualEnrollment: "enrolled" | "not_enrolled";
  accrual: {
    remainingGainCents: number;
    paymentConfirmed: boolean;
    deliveryConfirmed: boolean;
    cancelled: boolean;
  };
  hasRefund: boolean;
}) {
  if (input.accrual.cancelled) return { code: "cancelled" as const, label: "ANNULÉE", detail: "Le gain de cette commande est annulé." };
  if (input.hasRefund) return { code: "refund_recorded" as const, label: "REMBOURSEMENT/CORRECTION ENREGISTRÉ", detail: "Consultez l’historique administratif effectif." };
  if (input.accrualEnrollment === "not_enrolled") {
    return { code: "accrual_not_enrolled" as const, label: "AUCUN GAIN POUR CETTE COMMANDE",
      detail: "La commande utilise éventuellement la cagnotte, mais l’acquisition fidélité n’était pas active lors de sa création." };
  }
  if (input.accrual.deliveryConfirmed && input.accrual.paymentConfirmed) return { code: "delivered_available" as const, label: "LIVRÉE", detail: "GAIN DISPONIBLE POUR CETTE COMMANDE" };
  if (input.accrual.paymentConfirmed) return { code: "payment_confirmed_pending" as const, label: "PAIEMENT CONFIRMÉ", detail: "5 % EN ATTENTE" };
  return { code: "enrolled_payment_pending" as const, label: "INSCRITE", detail: "PAIEMENT À CONFIRMER" };
}

function isZeroCreditCancellationTombstone(accrual: CagnotteAccrual) {
  return accrual.cancelled && !accrual.paymentConfirmed && !accrual.deliveryConfirmed && !accrual.credited &&
    accrual.compartment === "none" && accrual.remainingGainCents === 0 &&
    accrual.cumulativeReturns.every((line) => line.returnedNetCents === 0);
}

function orderRequiresAccrualJournal(order: Order) {
  if (order.orderStatus === "delivered") return true;
  if (order.paymentStatus !== "paid") return false;
  try {
    const paidAt = instant(order.paidAt);
    return paidAt === instant(order.paymentConfirmedAt) && hasOwn(order, "paymentConfirmedBy") &&
      (order.paymentConfirmedBy === null || typeof order.paymentConfirmedBy === "string") &&
      ["card_payment_link", "cash_on_delivery", "bank_transfer", "other"].includes(order.finalPaymentMethod ?? "");
  } catch {
    return false;
  }
}

async function executeOrderRefundCorrection(input: {
  db: Firestore;
  request: CorrectionSelection | CorrectionConfirmation;
  actor: { uid: string; email: string | null };
  now?: () => string;
  log?: (entry: OrderRefundOperationalLog) => void;
}) {
  const request = input.request;
  const recordedAt = instant((input.now ?? (() => new Date().toISOString()))());
  const confirmed = request.action === "record_correction" ? request : null;
  const correctionKey = confirmed ? hash(["refund-correction", confirmed.correctionReference]) : null;
  const correctionRef = correctionKey ? input.db.collection(collection).doc(correctionKey) : null;
  const result = await input.db.runTransaction(async (tx) => {
    const orderRef = input.db.collection("orders").doc(request.orderId);
    const targetRef = input.db.collection(collection).doc(request.targetEventId);
    const [orderDoc, targetDoc, history, priorCorrection] = await Promise.all([
      tx.get(orderRef),
      tx.get(targetRef),
      tx.get(input.db.collection(collection).where("orderId", "==", request.orderId).limit(historyLimit + 1)),
      correctionRef ? tx.get(correctionRef) : Promise.resolve(null),
    ]);
    const content = confirmed ? correctionBusinessContent(confirmed) : null;
    if (!orderDoc.exists) fail("refund_order_missing", 404);
    if (history.size > historyLimit) fail("refund_history_requires_verification");
    const order = orderFromSnapshot(orderDoc);
    if (!hasCagnotteEnrollment(order)) fail("refund_historical_order_not_supported");
    if (!targetDoc.exists || targetDoc.data()?.kind === "refund_correction") fail("correction_target_missing", 404);
    const enrollment = validateOrderCagnotteEnrollment(order);
    const deliveryCharged = eurosToCagnotteCents(order.deliveryFee);
    const internalOrder = { orderId: order.id, beneficiaryId: enrollment.beneficiaryId, programVersion: enrollment.programVersion,
      createdAtEpochMs: enrollment.createdAtEpochMs, snapshot: enrollment.snapshot };
    const mixed = enrollment.snapshot.appliedCagnotteCents > 0;
    const recordVersion = mixed ? ORDER_MIXED_REFUND_VERSION : ORDER_REFUND_VERSION;
    const paidAt = instant(order.paidAt);
    const decision = mixed ? validatePaymentEvidence(order.cagnottePaymentEvidence, paidAt) : "attributed";
    const basis = await readCagnotteRefundBasis({ db: input.db, transaction: tx, order: internalOrder, allowMissingAccrual: decision === "not_attributed" });
    const reservationBasis = mixed ? await readConsumedReservation(order.cagnotteReservationIntent, input.db, tx) : null;
    const walletMutation = await prepareCagnotteWalletMutation({ db: input.db, transaction: tx,
      beneficiaryId: enrollment.beneficiaryId, allowMissing: false, missingCode: "CONFLICT" });
    const beneficiaryMovements = await tx.get(input.db.collection("cagnotteMovements").where("beneficiaryId", "==", enrollment.beneficiaryId));
    const reconstruction = reconstructOrderRefundHistory({
      orderId: order.id,
      beneficiaryId: enrollment.beneficiaryId,
      snapshot: enrollment.snapshot,
      recordVersion,
      decision,
      deliveryCharged,
      accrual: basis.state,
      reservationBasis,
      historyDocs: history.docs,
      movementDocs: beneficiaryMovements.docs.filter((doc) => doc.data().orderId === order.id),
      movementFailureCode: "refund_history_requires_verification",
    });
    const targetEntry = reconstruction.originals.find((entry) => entry.id === targetDoc.id);
    if (!targetEntry) fail("correction_target_conflict");
    if (lastItem(reconstruction.originals)?.id !== targetDoc.id) fail("correction_target_not_latest_effective");
    const target = targetEntry.event;
    const corrections = reconstruction.corrections
      .filter((entry) => entry.event.targetEventId === targetDoc.id)
      .sort((a, b) => a.event.revision - b.event.revision)
      .map((entry) => entry.event);
    const previousEffective = reconstruction.effective;
    if (priorCorrection?.exists) {
      const prior = priorCorrection.data() as CorrectionEvent;
      validateStoredCorrectionEvent(prior, priorCorrection.id);
      if (!content || prior.orderId !== request.orderId || prior.fingerprint !== cagnotteAdminCorrectionBusinessFingerprint(content) || stable(prior.content) !== stable(content)) {
        fail("correction_event_conflict");
      }
      return publicCorrectionResult(prior.result, true);
    }
    if (request.expectedRevision !== corrections.length) fail("correction_preview_stale");
    const replacementLines = addReturns(target.result.before.lines, request.replacementReturns);
    const simulation = simulateCagnotteRefund(enrollment.snapshot, target.result.before.lines, replacementLines);
    const correctedDelivery = sum(target.result.before.deliveryFinancialCents, request.deliveryRefundCents);
    if (correctedDelivery > deliveryCharged) fail("refund_delivery_exceeds_remaining", 400);
    const effective = cumulative(replacementLines, simulation.next.financialRefundCents, simulation.next.cagnotteRestitutionCents, correctedDelivery);
    const correctedDeclaredFinancial = sum(simulation.delta.financialRefundCents, request.deliveryRefundCents);
    if (request.declaredFinancialCents !== correctedDeclaredFinancial) fail("refund_declared_amount_requires_verification");
    const revision = corrections.length + 1;
    const previewVersion = hash({ version: ORDER_REFUND_CORRECTION_VERSION, order: internalOrder, target: target.fingerprint,
      corrections: corrections.map((event) => event.fingerprint), previousEffective, wallet: walletMutation.original,
      accrual: basis.state, reservation: reservationBasis?.reservation.refundProjection ?? null });
    if (confirmed && confirmed.expectedPreviewVersion !== previewVersion) fail("correction_preview_stale");

    const cancelled = order.orderStatus === "cancelled" || order.paymentStatus === "cancelled" || Boolean(order.cancelledAt);
    const desiredRemaining = decision === "attributed" && !cancelled ? simulation.next.theoreticalLoyaltyCents : 0;
    const currentRemaining = basis.state?.remainingGainCents ?? 0;
    const loyaltyDelta = desiredRemaining - currentRemaining;
    let loyaltyPendingDelta = 0;
    let loyaltyAvailableDelta = 0;
    if (loyaltyDelta !== 0 && basis.state?.credited) {
      if (basis.state.compartment === "pending") loyaltyPendingDelta = loyaltyDelta;
      else if (basis.state.compartment === "available") loyaltyAvailableDelta = loyaltyDelta;
      else fail("refund_right_requires_verification");
    } else if (loyaltyDelta !== 0) fail("refund_right_requires_verification");
    const restitutionDelta = effective.cagnotteRestitutionCents - previousEffective.cagnotteRestitutionCents;
    const previousCompensation = target.result.restitution.compensationCents + corrections.reduce((total, event) =>
      total + Math.max(0, -event.result.differential.regularizationDeltaCents), 0);
    const laterReservationExists = restitutionDelta < 0 && beneficiaryMovements.docs.some((doc) => {
      const movement = doc.data();
      return movement.businessEvent === "credit_reserved" && Number(movement.recordedAtEpochMs) > Date.parse(target.recordedAt);
    });
    const compensation = restitutionDelta > 0 ? Math.min(walletMutation.original.regularizationCents, restitutionDelta) : 0;
    const restitutionAvailableDelta = restitutionDelta > 0 ? restitutionDelta - compensation : restitutionDelta;
    const regularizationDelta = -compensation;
    const totalAvailableDelta = loyaltyAvailableDelta + restitutionAvailableDelta;
    const requiresReview = (loyaltyPendingDelta < 0 && walletMutation.original.pendingCents < -loyaltyPendingDelta) ||
      (totalAvailableDelta < 0 && walletMutation.original.availableCents < -totalAvailableDelta) || laterReservationExists ||
      (restitutionDelta < 0 && previousCompensation > 0);
    const reviewReason = laterReservationExists ? "Le crédit restitué a été réservé ou utilisé après la déclaration."
      : restitutionDelta < 0 && previousCompensation > 0 ? "La restitution a déjà compensé une régularisation ; aucune nouvelle dette ne peut être créée."
        : "Le compartiment à corriger ne contient plus le montant nécessaire.";
    const walletAfter = {
      pendingCents: walletMutation.original.pendingCents + loyaltyPendingDelta,
      availableCents: walletMutation.original.availableCents + totalAvailableDelta,
      reservedCents: walletMutation.original.reservedCents,
      regularizationCents: walletMutation.original.regularizationCents + regularizationDelta,
    };
    const result: CorrectionResult = {
      kind: requiresReview ? "correction_requires_review" : confirmed ? "administrative_refund_correction_recorded" : "refund_correction_preview",
      orderId: order.id, currency: "EUR", targetEventId: targetDoc.id, previousRevision: corrections.length, revision,
      replacementReturns: request.replacementReturns, deliveryRefundCents: request.deliveryRefundCents,
      declaredFinancialCents: request.declaredFinancialCents, previousEffective, effective,
      differential: {
        returnedProductNetCents: effective.returnedProductNetCents - previousEffective.returnedProductNetCents,
        productFinancialCents: effective.productFinancialCents - previousEffective.productFinancialCents,
        cagnotteRestitutionCents: restitutionDelta,
        deliveryFinancialCents: effective.deliveryFinancialCents - previousEffective.deliveryFinancialCents,
        totalFinancialCents: effective.totalFinancialCents - previousEffective.totalFinancialCents,
        loyaltyCents: loyaltyDelta,
        pendingDeltaCents: loyaltyPendingDelta,
        availableDeltaCents: totalAvailableDelta,
        regularizationDeltaCents: regularizationDelta,
      },
      walletAfter, remainingGainCents: desiredRemaining, reservationState: mixed ? "consumed" : "not_applicable",
      previewVersion, ...(confirmed ? { recordedAt } : {}), ...(requiresReview ? { reviewReason } : {}),
    };
    if (requiresReview) {
      if (confirmed) fail("CORRECTION_REQUIRES_REVIEW");
      return publicCorrectionResult(result);
    }
    if (!confirmed || !correctionRef || !content || !correctionKey) return publicCorrectionResult(result);

    applyCagnotteWalletDeltas(walletMutation, {
      pendingCents: loyaltyPendingDelta,
      availableCents: totalAvailableDelta,
      regularizationCents: regularizationDelta,
    });
    const movementIds: string[] = [];
    const movementWrites: Array<{ id: string; value: CagnotteMovement }> = [];
    if (loyaltyPendingDelta !== 0 || loyaltyAvailableDelta !== 0) {
      const id = hash(["refund-correction-movement", targetDoc.id, revision, "loyalty"]);
      movementIds.push(id);
      movementWrites.push({ id, value: correctionMovement(internalOrder, id, "refund_declaration_corrected", recordedAt,
        { correctionId: correctionKey, targetEventId: targetDoc.id, revision }, loyaltyPendingDelta, loyaltyAvailableDelta, 0) });
    }
    if (restitutionDelta !== 0) {
      const id = hash(["refund-correction-movement", targetDoc.id, revision, "restitution"]);
      movementIds.push(id);
      movementWrites.push({ id, value: correctionMovement(internalOrder, id, "credit_refund_corrected", recordedAt,
        { correctionId: correctionKey, targetEventId: targetDoc.id, revision, restitutionDeltaCents: restitutionDelta, compensationCents: compensation },
        0, restitutionAvailableDelta, regularizationDelta) });
    }
    const correctionEvent: CorrectionEvent = {
      schemaVersion: 3, kind: "refund_correction", version: ORDER_REFUND_CORRECTION_VERSION,
      orderId: order.id, beneficiaryId: enrollment.beneficiaryId, targetEventId: targetDoc.id,
      revision, previousRevision: corrections.length, correctionReference: confirmed.correctionReference,
      content, fingerprint: cagnotteAdminCorrectionBusinessFingerprint(content), result, movementIds, actor: input.actor, recordedAt,
    };
    validateStoredCorrectionEvent(correctionEvent, correctionKey);
    tx.create(correctionRef, correctionEvent);
    for (const movement of movementWrites) tx.create(input.db.collection("cagnotteMovements").doc(movement.id), movement.value);
    if (basis.state) tx.set(input.db.collection("cagnotteAccruals").doc(order.id), {
      ...basis.state, cumulativeReturns: effective.lines, remainingGainCents: desiredRemaining,
    });
    if (reservationBasis) {
      const reservation = reservationBasis.reservation;
      const correctionProjection = {
        correctionId: correctionKey, targetRefundId: targetDoc.id, revision,
        restitutionDeltaCents: restitutionDelta, compensationCents: compensation,
        ...(movementWrites.find((entry) => entry.value.businessEvent === "credit_refund_corrected") ?
          { eventKey: movementWrites.find((entry) => entry.value.businessEvent === "credit_refund_corrected")!.id } : {}),
        recordedAtEpochMs: Date.parse(recordedAt),
      };
      tx.set(input.db.collection("cagnotteReservations").doc(order.id), {
        ...reservation,
        state: "consumed",
        refundProjection: {
          ...reservation.refundProjection,
          schemaVersion: 1,
          version: "cagnotte-consumed-refund-v1",
          cumulativeRestitutedCents: effective.cagnotteRestitutionCents,
          events: reservation.refundProjection?.events ?? [],
          corrections: [...(reservation.refundProjection?.corrections ?? []), correctionProjection],
        },
      });
    }
    if (movementWrites.length) writeCagnotteWalletMutation(walletMutation);
    tx.update(orderRef, {
      refundSummary: {
        version: ORDER_REFUND_CORRECTION_VERSION,
        returnedProductNetCents: effective.returnedProductNetCents,
        productFinancialCents: effective.productFinancialCents,
        cagnotteRestitutionCents: effective.cagnotteRestitutionCents,
        deliveryFinancialCents: effective.deliveryFinancialCents,
        totalFinancialCents: effective.totalFinancialCents,
        productsFullyRefunded: effective.returnedProductNetCents === enrollment.snapshot.eligibleCents,
        entirePaymentRefunded: effective.returnedProductNetCents === enrollment.snapshot.eligibleCents && effective.deliveryFinancialCents === deliveryCharged,
        kind: "administrative_correction",
        targetEventId: targetDoc.id,
        revision,
        recordedAt,
      },
    });
    return publicCorrectionResult(result, false);
  });
  if (result.kind === "correction_requires_review" || confirmed) {
    emitOperationalLog(input.log, {
      event: result.kind === "correction_requires_review" ? "cagnotte_correction_requires_review" : "cagnotte_refund_correction_recorded",
      orderHash: hash(["order", request.orderId]),
      eventId: correctionKey ?? request.targetEventId,
      version: ORDER_REFUND_CORRECTION_VERSION,
      deltas: {
        financialCents: result.differential.totalFinancialCents,
        cagnotteRestitutionCents: result.differential.cagnotteRestitutionCents,
        loyaltyCents: result.differential.loyaltyCents,
        pendingCents: result.differential.pendingDeltaCents,
        availableCents: result.differential.availableDeltaCents,
        regularizationCents: result.differential.regularizationDeltaCents,
      },
      result: result.kind,
      idempotent: result.alreadyRecorded === true,
    });
  }
  return result;
}

function correctionBusinessContent(request: CorrectionConfirmation): CorrectionEvent["content"] {
  return cagnotteAdminCorrectionBusinessContent(request);
}

function correctionMovement(
  order: { orderId: string; beneficiaryId: string; programVersion: string; snapshot: { calculationVersion: "cagnotte-math-v1" } },
  eventKey: string,
  businessEvent: "refund_declaration_corrected" | "credit_refund_corrected",
  recordedAt: string,
  payload: Record<string, unknown>,
  pendingDeltaCents: number,
  availableDeltaCents: number,
  regularizationDeltaCents: number,
): CagnotteMovement {
  return {
    schemaVersion: 3,
    regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION,
    reservationVersion: CAGNOTTE_RESERVATION_VERSION,
    calculationVersion: order.snapshot.calculationVersion,
    programVersion: order.programVersion,
    currency: "EUR",
    origin: "internal_server",
    orderId: order.orderId,
    beneficiaryId: order.beneficiaryId,
    businessEvent,
    eventKey,
    payload: stable({ event: businessEvent, ...payload }),
    pendingDeltaCents,
    availableDeltaCents,
    reservedDeltaCents: 0,
    regularizationDeltaCents,
    recordedAtEpochMs: Date.parse(recordedAt),
  };
}

function validateStoredCorrectionEvent(event: CorrectionEvent, key: string) {
  try {
    if (!event || event.schemaVersion !== 3 || event.kind !== "refund_correction" ||
      event.version !== ORDER_REFUND_CORRECTION_VERSION || event.orderId !== event.content.orderId ||
      event.targetEventId !== event.content.targetEventId || event.revision !== event.previousRevision + 1 ||
      !Number.isSafeInteger(event.previousRevision) || event.previousRevision < 0 ||
      event.content.expectedRevision !== event.previousRevision || event.content.externalVerificationConfirmed !== true ||
      event.correctionReference !== event.content.correctionReference ||
      key !== hash(["refund-correction", event.correctionReference]) || event.fingerprint !== cagnotteAdminCorrectionBusinessFingerprint(event.content) ||
      event.result.kind !== "administrative_refund_correction_recorded" || event.result.orderId !== event.orderId ||
      event.result.targetEventId !== event.targetEventId || event.result.previousRevision !== event.previousRevision ||
      event.result.revision !== event.revision || event.result.recordedAt !== event.recordedAt ||
      event.result.declaredFinancialCents !== event.content.declaredFinancialCents ||
      event.result.deliveryRefundCents !== event.content.deliveryRefundCents ||
      stable(event.result.replacementReturns) !== stable(event.content.replacementReturns) ||
      !Array.isArray(event.movementIds) || new Set(event.movementIds).size !== event.movementIds.length ||
      event.movementIds.some((id) => !/^[a-f0-9]{64}$/.test(id)) ||
      typeof event.actor?.uid !== "string" || (event.actor.email !== null && typeof event.actor.email !== "string")) throw new Error();
    instant(event.recordedAt);
    for (const cumul of [event.result.previousEffective, event.result.effective]) normalizeCumuls(cumul);
    parseOrderRefundRequest({ action: "record_correction", ...event.content, expectedPreviewVersion: event.result.previewVersion });
  } catch {
    fail("refund_history_requires_verification");
  }
}

function validateCorrectionResult(correction: CorrectionEvent, target: Event, snapshot: CagnotteSnapshot, deliveryCharged: number) {
  try {
    const replacementLines = addReturns(normalizeResult(target.result).before.lines, correction.content.replacementReturns);
    const simulation = simulateCagnotteRefund(snapshot, normalizeResult(target.result).before.lines, replacementLines);
    const delivery = sum(normalizeResult(target.result).before.deliveryFinancialCents, correction.content.deliveryRefundCents);
    if (delivery > deliveryCharged) throw new Error();
    const effective = cumulative(replacementLines, simulation.next.financialRefundCents, simulation.next.cagnotteRestitutionCents, delivery);
    const previous = correction.result.previousEffective;
    const expectedDifferential = {
      returnedProductNetCents: effective.returnedProductNetCents - previous.returnedProductNetCents,
      productFinancialCents: effective.productFinancialCents - previous.productFinancialCents,
      cagnotteRestitutionCents: effective.cagnotteRestitutionCents - previous.cagnotteRestitutionCents,
      deliveryFinancialCents: effective.deliveryFinancialCents - previous.deliveryFinancialCents,
      totalFinancialCents: effective.totalFinancialCents - previous.totalFinancialCents,
    };
    if (stable(effective) !== stable(correction.result.effective) ||
      correction.content.declaredFinancialCents !== sum(simulation.delta.financialRefundCents, correction.content.deliveryRefundCents) ||
      Object.entries(expectedDifferential).some(([key, value]) => correction.result.differential[key as keyof typeof expectedDifferential] !== value) ||
      ![correction.result.differential.loyaltyCents, correction.result.differential.pendingDeltaCents,
        correction.result.differential.availableDeltaCents, correction.result.differential.regularizationDeltaCents].every(Number.isSafeInteger) ||
      correction.result.differential.regularizationDeltaCents > 0 || correction.result.remainingGainCents < 0 ||
      Object.values(correction.result.walletAfter).some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error();
  } catch {
    fail("refund_history_requires_verification");
  }
}

function publicCorrectionResult(result: CorrectionResult, alreadyRecorded?: boolean): CorrectionResult {
  return {
    kind: result.kind,
    orderId: result.orderId,
    currency: "EUR",
    targetEventId: result.targetEventId,
    previousRevision: result.previousRevision,
    revision: result.revision,
    replacementReturns: result.replacementReturns.map((line) => ({ ...line })),
    deliveryRefundCents: result.deliveryRefundCents,
    declaredFinancialCents: result.declaredFinancialCents,
    previousEffective: normalizeCumuls(result.previousEffective),
    effective: normalizeCumuls(result.effective),
    differential: { ...result.differential },
    walletAfter: { ...result.walletAfter },
    remainingGainCents: result.remainingGainCents,
    reservationState: result.reservationState,
    previewVersion: result.previewVersion,
    ...(result.recordedAt ? { recordedAt: result.recordedAt } : {}),
    ...(result.reviewReason ? { reviewReason: result.reviewReason } : {}),
    ...(alreadyRecorded !== undefined ? { alreadyRecorded } : {}),
  };
}

async function readConsumedReservation(intent: unknown, db: Firestore, transaction: FirebaseFirestore.Transaction) {
  try {
    return await readCagnotteConsumedRefundBasis({
      db,
      transaction,
      intent: intent as Parameters<typeof readCagnotteConsumedRefundBasis>[0]["intent"],
    });
  } catch {
    fail("refund_reservation_requires_verification");
  }
}

function validatePaymentEvidence(value: unknown, paidAt: string): "attributed" | "not_attributed" {
  try {
    const evidence = object(value);
    const decision = evidence.loyaltyAccrualDecision;
    const expectedKeys = decision === "not_attributed"
      ? ["schemaVersion", "version", "reservationState", "loyaltyAccrualDecision", "loyaltyAccrualReason", "recordedAt"]
      : ["schemaVersion", "version", "reservationState", "loyaltyAccrualDecision", "recordedAt"];
    if (Object.keys(evidence).sort().join(",") !== expectedKeys.sort().join(",") || evidence.schemaVersion !== 1 ||
      evidence.version !== "cagnotte-payment-evidence-v1" || evidence.reservationState !== "consumed" ||
      (decision !== "attributed" && decision !== "not_attributed") || evidence.recordedAt !== paidAt ||
      (decision === "not_attributed" && evidence.loyaltyAccrualReason !== "server_program_ineligible")) throw new Error();
    return decision;
  } catch { fail("refund_payment_evidence_requires_verification"); }
}

function validateStoredEvent(event: Event, key: string) {
  try {
    const result = normalizeResult(event.result);
    for (const cumul of [result.before, result.after]) {
      for (const value of [cumul.returnedProductNetCents, cumul.productFinancialCents, cumul.cagnotteRestitutionCents,
        cumul.deliveryFinancialCents, cumul.totalFinancialCents, ...cumul.lines.map((line) => line.returnedNetCents)]) cents(value);
      if (cumul.returnedProductNetCents !== sum(...cumul.lines.map((line) => line.returnedNetCents)) ||
        cumul.returnedProductNetCents !== sum(cumul.productFinancialCents, cumul.cagnotteRestitutionCents) ||
        cumul.totalFinancialCents !== sum(cumul.productFinancialCents, cumul.deliveryFinancialCents) ||
        new Set(cumul.lines.map((line) => line.lineId)).size !== cumul.lines.length) throw new Error();
    }
    for (const value of [result.returnedProductNetCents, result.productFinancialCents, result.cagnotteRestitutionCents,
      result.deliveryFinancialCents, result.totalFinancialCents, result.correction.theoreticalCents,
      result.correction.appliedCents, result.correction.remainingGainCents, result.restitution.grossCents,
      result.restitution.compensationCents, result.restitution.availableIncreaseCents,
      result.restitution.availableAfterCents, result.restitution.cumulativeCents]) cents(value);
    if (![result.correction.pendingDeltaCents, result.correction.availableDeltaCents, result.correction.regularizationDeltaCents]
      .every((value) => Number.isSafeInteger(value)) || result.correction.pendingDeltaCents > 0 ||
      result.correction.availableDeltaCents > 0 || result.correction.regularizationDeltaCents < 0 ||
      result.restitution.compensationCents > result.restitution.grossCents) throw new Error();
    if (stable(addReturns(result.before.lines, event.content.additionalReturns)) !== stable(result.after.lines) ||
      result.after.returnedProductNetCents !== sum(result.before.returnedProductNetCents, result.returnedProductNetCents) ||
      result.after.productFinancialCents !== sum(result.before.productFinancialCents, result.productFinancialCents) ||
      result.after.cagnotteRestitutionCents !== sum(result.before.cagnotteRestitutionCents, result.cagnotteRestitutionCents) ||
      result.after.deliveryFinancialCents !== sum(result.before.deliveryFinancialCents, result.deliveryFinancialCents) ||
      result.restitution.grossCents !== result.cagnotteRestitutionCents ||
      result.restitution.availableIncreaseCents !== result.restitution.grossCents - result.restitution.compensationCents ||
      result.restitution.cumulativeCents !== result.after.cagnotteRestitutionCents ||
      result.correction.appliedCents !== sum(-result.correction.pendingDeltaCents, -result.correction.availableDeltaCents, result.correction.regularizationDeltaCents) ||
      cents(result.correction.appliedCents) > cents(result.correction.theoreticalCents) || cents(result.correction.remainingGainCents) < 0 ||
      event.calculationVersion !== "cagnotte-math-v1" || event.recordedAt !== result.recordedAt || event.confirmedAt !== result.confirmedAt ||
      instant(event.recordedAt) < instant(event.confirmedAt)) throw new Error();
    const mixed = event.version === ORDER_MIXED_REFUND_VERSION;
    const expectedMovementCount = Number(event.content.additionalReturns.length > 0 && result.loyaltyAccrualDecision === "attributed") +
      Number(result.restitution.grossCents > 0);
    if ((mixed ? event.schemaVersion !== 2 : event.schemaVersion !== 1 || event.version !== ORDER_REFUND_VERSION) ||
      key !== eventKey(event.source, event.reference) || event.fingerprint !== cagnotteAdminRefundBusinessFingerprint(event.content) ||
      event.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION || event.orderId !== event.content.orderId ||
      event.source !== event.content.source || event.reference !== event.content.reference ||
      result.kind !== "administrative_refund_recorded" || result.orderId !== event.orderId || result.currency !== "EUR" ||
      result.totalFinancialCents !== event.content.declaredFinancialCents || result.deliveryFinancialCents !== event.content.deliveryRefundCents ||
      result.totalFinancialCents !== sum(result.productFinancialCents, result.deliveryFinancialCents) ||
      stable(result.additionalReturns) !== stable(event.content.additionalReturns) || !Number.isSafeInteger(event.sequence) || event.sequence < 1 ||
      !Array.isArray(event.movementIds) || event.movementIds.length !== expectedMovementCount ||
      event.movementIds.some((movementId) => typeof movementId !== "string" || !/^[a-f0-9]{64}$/.test(movementId)) ||
      new Set(event.movementIds).size !== event.movementIds.length ||
      (result.loyaltyAccrualDecision === "not_attributed" && (result.correction.appliedCents !== 0 ||
        result.correction.pendingDeltaCents !== 0 || result.correction.availableDeltaCents !== 0 ||
        result.correction.regularizationDeltaCents !== 0 || result.correction.remainingGainCents !== 0)) ||
      (mixed && (result.restitution.reservationState !== "consumed" ||
        !hasOwn(event.result, "returnedProductNetCents") || !hasOwn(event.result, "cagnotteRestitutionCents") ||
        !hasOwn(event.result, "loyaltyAccrualDecision") || !hasOwn(event.result, "restitution"))) ||
      (!mixed && (result.cagnotteRestitutionCents !== 0 || result.restitution.reservationState !== "not_applicable"))) throw new Error();
    const normalized = parseOrderRefundRequest({ action: "record_confirmed", ...event.content, expectedPreviewVersion: result.previewVersion });
    if (normalized.action !== "record_confirmed" || stable(businessContent(normalized)) !== stable(event.content)) throw new Error();
  } catch { fail("refund_history_requires_verification"); }
}

function normalizeResult(result: RefundResult): RefundResult {
  const before = normalizeCumuls(result.before);
  const after = normalizeCumuls(result.after);
  const returnedProductNetCents = result.returnedProductNetCents ?? sum(...result.additionalReturns.map((line) => line.additionalNetCents));
  const cagnotteRestitutionCents = result.cagnotteRestitutionCents ?? 0;
  const restitution = result.restitution ?? {
    grossCents: 0,
    compensationCents: 0,
    availableIncreaseCents: 0,
    availableAfterCents: 0,
    cumulativeCents: 0,
    reservationState: "not_applicable" as const,
  };
  return {
    ...result,
    before,
    after,
    returnedProductNetCents,
    cagnotteRestitutionCents,
    loyaltyAccrualDecision: result.loyaltyAccrualDecision ?? "attributed",
    restitution,
  };
}

function normalizeCumuls(cumul: Cumuls): Cumuls {
  return {
    lines: cumul.lines.map((line) => ({ lineId: line.lineId, returnedNetCents: line.returnedNetCents })).sort(byLine),
    returnedProductNetCents: cumul.returnedProductNetCents ?? sum(...cumul.lines.map((line) => line.returnedNetCents)),
    productFinancialCents: cumul.productFinancialCents,
    cagnotteRestitutionCents: cumul.cagnotteRestitutionCents ?? 0,
    deliveryFinancialCents: cumul.deliveryFinancialCents,
    totalFinancialCents: cumul.totalFinancialCents,
  };
}

function publicResult(raw: RefundResult, alreadyRecorded?: boolean): RefundResult {
  const result = normalizeResult(raw);
  const cumuls = (c: Cumuls): Cumuls => ({ ...normalizeCumuls(c) });
  return {
    kind: result.kind,
    orderId: result.orderId,
    currency: result.currency,
    additionalReturns: result.additionalReturns.map((line) => ({ lineId: line.lineId, additionalNetCents: line.additionalNetCents })),
    returnedProductNetCents: result.returnedProductNetCents,
    productFinancialCents: result.productFinancialCents,
    cagnotteRestitutionCents: result.cagnotteRestitutionCents,
    deliveryFinancialCents: result.deliveryFinancialCents,
    totalFinancialCents: result.totalFinancialCents,
    loyaltyAccrualDecision: result.loyaltyAccrualDecision,
    correction: { ...result.correction },
    restitution: { ...result.restitution },
    before: cumuls(result.before),
    after: cumuls(result.after),
    previewVersion: result.previewVersion,
    productsFullyRefunded: result.productsFullyRefunded,
    entirePaymentRefunded: result.entirePaymentRefunded,
    ...(result.recordedAt ? { recordedAt: result.recordedAt, confirmedAt: result.confirmedAt } : {}),
    ...(alreadyRecorded !== undefined ? { alreadyRecorded } : {}),
  };
}

function businessContent(request: Confirmation) {
  return cagnotteAdminRefundBusinessContent(request);
}
function eventKey(source: string, reference: string) { return hash([source, reference]); }
function addReturns(previous: readonly CumulativeLineReturn[], additions: ReturnLine[]) {
  if (additions.some((addition) => !previous.some((prior) => prior.lineId === addition.lineId))) fail("refund_line_unknown", 400);
  return previous.map((prior) => ({
    lineId: prior.lineId,
    returnedNetCents: sum(prior.returnedNetCents, additions.find((addition) => addition.lineId === prior.lineId)?.additionalNetCents ?? 0),
  })).sort(byLine);
}
function cumulative(lines: CumulativeLineReturn[], product: number, cagnotte: number, delivery: number): Cumuls {
  const returnedProductNetCents = sum(...lines.map((line) => line.returnedNetCents));
  if (returnedProductNetCents !== sum(product, cagnotte)) fail("refund_calculation_requires_verification");
  return {
    lines,
    returnedProductNetCents,
    productFinancialCents: product,
    cagnotteRestitutionCents: cagnotte,
    deliveryFinancialCents: delivery,
    totalFinancialCents: sum(product, delivery),
  };
}
function normalizeReturns(value: unknown): ReturnLine[] {
  if (!Array.isArray(value) || value.length > 200) fail("refund_lines_invalid", 400);
  const seen = new Set<string>();
  return value.map((line) => {
    const normalized = object(line);
    exactKeys(normalized, ["lineId", "additionalNetCents"]);
    const lineId = identifier(normalized.lineId, 128);
    const amount = cents(normalized.additionalNetCents);
    if (seen.has(lineId) || amount === 0) fail("refund_line_invalid", 400);
    seen.add(lineId);
    return { lineId, additionalNetCents: amount };
  }).sort(byLine);
}
function byLine(a: { lineId: string }, b: { lineId: string }) { return a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0; }
function identifier(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) fail("refund_identifier_invalid", 400);
  return value;
}
function shaIdentifier(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail(code, 400);
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail("refund_date_invalid", 400);
  const normalized = new Date(value).toISOString();
  if (normalized !== value && normalized.replace(".000Z", "Z") !== value) fail("refund_date_invalid", 400);
  return normalized;
}
function cents(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("refund_cents_invalid", 400);
  return value;
}
function sum(...values: number[]) {
  const total = values.reduce((current, value) => current + BigInt(cents(value)), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail("refund_cents_overflow", 400);
  return Number(total);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("refund_payload_invalid", 400);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("refund_unexpected_field", 400);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: unknown) { return createHash("sha256").update(stable(value)).digest("hex"); }

function emitOperationalLog(log: ((entry: OrderRefundOperationalLog) => void) | undefined, entry: OrderRefundOperationalLog) {
  try {
    if (log) log(entry);
    else console.info(JSON.stringify(entry));
  } catch {
    try {
      console.warn(JSON.stringify({
        event: "cagnotte_operational_log_failed",
        originalEvent: entry.event,
        orderHash: entry.orderHash,
      }));
    } catch {
      // Observability is best-effort and cannot alter an already committed result.
    }
  }
}
function fail(code: string, status = 409): never { throw new OrderRefundError(code, status); }
