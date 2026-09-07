import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { Order, OrderUnpaidReview } from "../../src/types/index.js";
import { paymentLinkRequestDocumentId, paymentLinkRequestsCollection } from "./paymentLinkDelivery.js";

export type UnpaidReviewRequest = {
  action: "record";
  outcome: "unpaid_confirmed" | "payment_uncertain";
  source: string;
  reason: string;
  expectedStateVersion: string;
};

export class UnpaidReviewError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(code);
    this.name = "UnpaidReviewError";
  }
}

export async function readUnpaidOrderContext(input: {
  db: Firestore;
  transaction: Transaction;
  order: Order;
  nowEpochMs: number;
}) {
  const reservationRef = input.db.collection("cagnotteReservations").doc(input.order.id);
  const requestId = input.order.paymentLinkDelivery?.requestId;
  const requestRef = requestId
    ? input.db.collection(paymentLinkRequestsCollection).doc(paymentLinkRequestDocumentId(input.order.id, requestId))
    : null;
  const [reservationDoc, requestDoc] = await Promise.all([
    input.transaction.get(reservationRef),
    requestRef ? input.transaction.get(requestRef) : Promise.resolve(null),
  ]);
  const reservation = reservationDoc.exists ? reservationDoc.data() as Record<string, unknown> : null;
  const deliveryRequest = requestDoc?.exists ? requestDoc.data() as Record<string, unknown> : null;
  const reservationState = stringOrNull(reservation?.state);
  const reservedAtEpochMs = markerEpoch(reservation?.events, "reserved");
  const reservedAmountCents = reservationState === "reserved" && safeNonNegative(reservation?.amountCents)
    ? Number(reservation!.amountCents)
    : 0;
  const summaryStatus = stringOrNull(input.order.paymentLinkDelivery?.status);
  const requestStatus = stringOrNull(deliveryRequest?.status);
  const transportStatus = stringOrNull(input.order.paymentLinkDelivery?.transportStatus) ?? stringOrNull(deliveryRequest?.transportStatus) ?? "not_requested";
  const sendingActive = [summaryStatus, requestStatus].some((status) => status === "pending" || status === "sending");
  const stateFacts = {
    orderId: input.order.id,
    orderStatus: input.order.orderStatus,
    paymentStatus: input.order.paymentStatus,
    paidAt: input.order.paidAt ?? null,
    paymentConfirmedAt: input.order.paymentConfirmedAt ?? null,
    paymentReference: input.order.paymentReference ?? null,
    reservation: reservation ? {
      state: reservationState,
      amountCents: reservation?.amountCents ?? null,
      intentFingerprint: reservation?.intentFingerprint ?? null,
      reservedAtEpochMs,
    } : null,
    delivery: input.order.paymentLinkDelivery ? {
      requestId: requestId ?? null,
      status: summaryStatus,
      transportStatus,
      amount: input.order.paymentLinkDelivery.amount,
      currency: input.order.paymentLinkDelivery.currency,
    } : null,
    request: deliveryRequest ? {
      requestId: deliveryRequest.requestId ?? null,
      status: requestStatus,
      transportStatus: deliveryRequest.transportStatus ?? null,
      payloadFingerprint: deliveryRequest.payloadFingerprint ?? null,
      contentFingerprint: deliveryRequest.contentFingerprint ?? null,
      dispatchStartedAt: timestampEpoch(deliveryRequest.dispatchStartedAt),
      completedAt: timestampEpoch(deliveryRequest.completedAt),
    } : null,
  };
  const stateVersion = hash(stateFacts);
  const ageHours = reservedAtEpochMs === null ? null : Math.max(0, Math.floor((input.nowEpochMs - reservedAtEpochMs) / 3_600_000));
  const review = validStoredReview(input.order.unpaidReview) ? input.order.unpaidReview : null;
  return {
    reservedAmountCents,
    reservationState,
    reservedAt: reservedAtEpochMs === null ? null : new Date(reservedAtEpochMs).toISOString(),
    ageHours,
    reviewRequired: reservationState === "reserved" && ageHours !== null && ageHours >= 72,
    payment: {
      status: input.order.paymentStatus,
      uncertain: input.order.paymentStatus !== "paid" && input.order.paymentStatus !== "cancelled",
      confirmedAt: input.order.paymentConfirmedAt ?? input.order.paidAt ?? null,
    },
    linkTransmission: {
      requestId: requestId ?? null,
      status: summaryStatus ?? requestStatus ?? "not_requested",
      transportStatus,
      sendingActive,
      uncertain: transportStatus === "unknown" || summaryStatus === "unknown" || requestStatus === "unknown",
    },
    stateVersion,
    review: review ? {
      outcome: review.outcome,
      source: review.source,
      reason: review.reason,
      reviewedAt: review.reviewedAt,
      reviewedByEmail: review.reviewedBy.email,
      current: review.stateVersion === stateVersion,
    } : null,
  };
}

export async function prepareUnpaidReviewControl(input: {
  db: Firestore;
  transaction: Transaction;
  order: Order;
  request?: UnpaidReviewRequest;
  cancellationRequested: boolean;
  actor: { uid: string; email: string | null };
  now: string;
}) {
  const context = await readUnpaidOrderContext({
    db: input.db,
    transaction: input.transaction,
    order: input.order,
    nowEpochMs: Date.parse(input.now),
  });
  let reviewToStore: OrderUnpaidReview | null = null;
  if (input.request) {
    if (input.request.expectedStateVersion !== context.stateVersion) throw new UnpaidReviewError("unpaid_review_stale");
    if (context.reservationState !== "reserved" || context.reservedAmountCents <= 0) throw new UnpaidReviewError("unpaid_review_no_active_reservation");
    if (input.request.outcome === "unpaid_confirmed") {
      if (context.linkTransmission.sendingActive) throw new UnpaidReviewError("payment_link_delivery_active");
      if (input.order.paymentStatus === "paid" || input.order.paidAt || input.order.paymentConfirmedAt) {
        throw new UnpaidReviewError("payment_already_confirmed");
      }
    }
    reviewToStore = {
      schemaVersion: 1,
      version: "order-unpaid-review-v1",
      outcome: input.request.outcome,
      source: input.request.source,
      reason: input.request.reason,
      stateVersion: context.stateVersion,
      reviewedAt: input.now,
      reviewedBy: input.actor,
    };
  }
  const storedReview = validStoredReview(input.order.unpaidReview) ? input.order.unpaidReview : null;
  if (input.cancellationRequested && input.order.orderStatus !== "cancelled" && storedReview && storedReview.stateVersion !== context.stateVersion) {
    throw new UnpaidReviewError("unpaid_review_stale");
  }
  if (input.cancellationRequested && context.reservationState === "reserved" && context.reservedAmountCents > 0) {
    if (context.linkTransmission.sendingActive) throw new UnpaidReviewError("payment_link_delivery_active");
    const review = reviewToStore ?? storedReview;
    if (!review || review.outcome !== "unpaid_confirmed") throw new UnpaidReviewError("unpaid_review_required");
    if (review.stateVersion !== context.stateVersion) throw new UnpaidReviewError("unpaid_review_stale");
    if (input.order.paymentStatus === "paid" || input.order.paidAt || input.order.paymentConfirmedAt) {
      throw new UnpaidReviewError("payment_already_confirmed");
    }
  }
  return { context, reviewToStore };
}

function validStoredReview(value: unknown): value is OrderUnpaidReview {
  if (!value || typeof value !== "object") return false;
  const review = value as OrderUnpaidReview;
  return review.schemaVersion === 1 && review.version === "order-unpaid-review-v1" &&
    (review.outcome === "unpaid_confirmed" || review.outcome === "payment_uncertain") &&
    typeof review.source === "string" && typeof review.reason === "string" && /^[a-f0-9]{64}$/.test(review.stateVersion) &&
    typeof review.reviewedAt === "string" && Number.isFinite(Date.parse(review.reviewedAt)) &&
    Boolean(review.reviewedBy && typeof review.reviewedBy.uid === "string");
}

function markerEpoch(events: unknown, marker: string) {
  if (!events || typeof events !== "object") return null;
  const value = (events as Record<string, unknown>)[marker];
  if (!value || typeof value !== "object") return null;
  const epoch = (value as Record<string, unknown>).recordedAtEpochMs;
  return safeNonNegative(epoch) ? Number(epoch) : null;
}

function safeNonNegative(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function timestampEpoch(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof candidate.toMillis === "function") return candidate.toMillis();
  const seconds = candidate.seconds ?? candidate._seconds;
  return typeof seconds === "number" && Number.isFinite(seconds) ? Math.trunc(seconds * 1000) : null;
}

function hash(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
