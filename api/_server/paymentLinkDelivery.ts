import crypto from "node:crypto";
import { eurosToCagnotteCents, orderPaymentAmount, orderPaymentCents, validateOrderCagnotteEnrollment } from "./cagnotteOrders.js";
import { preparePaymentLinkStatusTransition } from "./orderStatusTransition.js";
import { hasCagnotteEnrollment, orderFromSnapshot } from "./orderProtection.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { EmailResult } from "./email.js";
import type {
  Order,
  PaymentLinkDeliveryIntent,
  PaymentLinkDeliveryStatus,
  PaymentLinkDeliverySummary,
} from "../../src/types/index.js";

export const paymentLinkRequestsCollection = "paymentLinkRequests";

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const leaseDurationMs = 60_000;
const historyLimit = 20;

export class PaymentLinkConflictError extends Error {
  constructor() {
    super("payment_link_request_conflict");
    this.name = "PaymentLinkConflictError";
  }
}

export class PaymentLinkOrderStateError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PaymentLinkOrderStateError";
  }
}

export type PaymentLinkDeliveryRequest = {
  orderId: string;
  paymentLinkRequestId: string;
  intent: PaymentLinkDeliveryIntent;
  paymentLinkUrl: string;
  paymentLinkLabel: string;
  paymentLinkAmount: number;
  paymentLinkCurrency: "EUR";
  channel: "email";
};

export type PaymentLinkDeliveryResult = {
  status: PaymentLinkDeliveryStatus;
  requestId: string;
  attempts: number;
  providerId?: string;
  errorCode?: string;
  existing: boolean;
  transportStatus?: PaymentLinkDeliverySummary["transportStatus"];
};

type DeliveryClaim = {
  claimed: boolean;
  requestRef: FirebaseFirestore.DocumentReference;
  leaseToken?: string;
  order?: Order;
  contentFingerprint?: string;
  result: PaymentLinkDeliveryResult;
};

export function validatePaymentLinkRequestId(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("payment_link_request_id_invalid");
  }
  const normalized = value.trim().toLowerCase();
  if (!requestIdPattern.test(normalized)) {
    throw new Error("payment_link_request_id_invalid");
  }
  return normalized;
}

export function paymentLinkPayloadFingerprint(
  input: Pick<
    PaymentLinkDeliveryRequest,
    "paymentLinkUrl" | "paymentLinkLabel" | "paymentLinkAmount" | "paymentLinkCurrency" | "channel"
  >,
) {
  return sha256(
    JSON.stringify({
      linkFingerprint: paymentLinkUrlFingerprint(input.paymentLinkUrl),
      label: input.paymentLinkLabel,
      amount: input.paymentLinkAmount,
      currency: input.paymentLinkCurrency,
      channel: input.channel,
    }),
  );
}

export function paymentLinkUrlFingerprint(url: string) {
  return sha256(url.trim());
}

export function paymentLinkIdempotencyKey(orderId: string, requestId: string) {
  return `payment-link-${orderId}-${requestId}`;
}

/** Three phases: reserve, recheck/dispatch outside callbacks, finalize current state.
 * Never reclaim a possibly dispatched intent merely because its lease expired. */
export async function executePaymentLinkDelivery(input: {
  db: FirebaseFirestore.Firestore;
  request: PaymentLinkDeliveryRequest;
  admin: { uid: string; email: string | null };
  send: (order: Order, request: PaymentLinkDeliveryRequest) => Promise<EmailResult>;
  now?: () => number;
}) {
  const request = { ...input.request, paymentLinkRequestId: validatePaymentLinkRequestId(input.request.paymentLinkRequestId) };
  const now = input.now || Date.now;
  const claim = await reservePaymentLinkDelivery(input.db, request, input.admin, now());
  if (!claim.claimed || !claim.order || !claim.leaseToken) return claim.result;

  // Re-read just before transport. The unavoidable commit-to-call gap is not atomic.
  const dispatchError = await checkBeforeDispatch(input.db, request, claim);
  if (dispatchError) return finalizePaymentLinkDelivery({ ...input, request, claim,
    providerResult: { status: "skipped", reason: dispatchError }, beforeDispatchError: dispatchError, now: now() });
  let providerResult: EmailResult;
  try { providerResult = await input.send(claim.order, request); }
  catch { providerResult = { status: "failed", reason: "network_error" }; }
  // If this transaction fails, the persisted sending intent is NEVER blindly resent.
  try { return await finalizePaymentLinkDelivery({ ...input, request, claim, providerResult, now: now() }); }
  catch {
    // The commit itself may have succeeded with a lost acknowledgement. Report
    // uncertainty to this caller; the persisted intent still prevents re-dispatch.
    return { ...claim.result, status: "unknown" as const, providerId: emailProviderId(providerResult),
      transportStatus: providerResult.status === "sent" ? "accepted" as const : "unknown" as const,
      errorCode: "delivery_finalization_requires_verification" };
  }
}

async function reservePaymentLinkDelivery(
  db: FirebaseFirestore.Firestore, request: PaymentLinkDeliveryRequest,
  admin: { uid: string; email: string | null }, now: number,
): Promise<DeliveryClaim> {
  const requestRef = db.collection(paymentLinkRequestsCollection).doc(paymentLinkRequestDocumentId(request.orderId, request.paymentLinkRequestId));
  const orderRef = db.collection("orders").doc(request.orderId);
  const fingerprint = paymentLinkPayloadFingerprint(request);
  const leaseToken = crypto.randomUUID(); // One owner token per invocation, outside callback retries.
  return db.runTransaction(async (transaction) => {
    const [requestSnapshot, orderSnapshot] = await Promise.all([transaction.get(requestRef), transaction.get(orderRef)]);
    if (!orderSnapshot.exists) throw new PaymentLinkOrderStateError("order_missing");
    const order = orderFromSnapshot(orderSnapshot);
    const contentFingerprint = paymentLinkContentFingerprint(order, request);
    const previous = requestSnapshot.data() || {};
    if (requestSnapshot.exists) {
      if (previous.orderId !== order.id || previous.requestId !== request.paymentLinkRequestId ||
        previous.payloadFingerprint !== fingerprint || previous.contentFingerprint !== contentFingerprint || previous.intent !== request.intent) {
        throw new PaymentLinkConflictError();
      }
      const result = deliveryResult(previous, true);
      if (result.status === "sending" && timestampToMs(previous.leaseUntil) <= now) {
        result.status = "unknown"; result.errorCode = "delivery_result_requires_verification"; result.transportStatus = "unknown";
        transaction.update(requestRef, { status: "unknown", lastErrorCode: result.errorCode, transportStatus: "unknown", updatedAt: FieldValue.serverTimestamp() });
        if (order.paymentLinkDelivery?.requestId === request.paymentLinkRequestId) transaction.update(orderRef, {
          paymentLinkDelivery: { ...order.paymentLinkDelivery, status: "unknown", errorCode: result.errorCode, transportStatus: "unknown" },
        });
      }
      return { claimed: false, requestRef, result };
    }
    assertOrderCanReceivePaymentLink(order, request);
    if (order.paymentLinkDelivery && ["pending", "sending", "unknown"].includes(order.paymentLinkDelivery.status)) {
      throw new PaymentLinkOrderStateError("delivery_result_requires_verification");
    }
    const confirmed = hasConfirmedEmailDelivery(order);
    if (confirmed && request.intent !== "resend") throw new PaymentLinkOrderStateError("resend_confirmation_required");
    if (!confirmed && request.intent === "resend") throw new PaymentLinkOrderStateError("initial_send_required");
    const attemptAt = new Date(now).toISOString();
    const summary = paymentLinkSummary({ request, status: "sending", attempts: 1, errorCode: "",
      createdAt: attemptAt, lastAttemptAt: attemptAt, completedAt: "" });
    transaction.set(requestRef, {
      schemaVersion: 2, orderId: order.id, requestId: request.paymentLinkRequestId, intent: request.intent,
      status: "sending", payloadFingerprint: fingerprint, contentFingerprint,
      linkFingerprint: paymentLinkUrlFingerprint(request.paymentLinkUrl), recipientFingerprint: sha256(order.customerEmail!),
      amount: request.paymentLinkAmount, currency: request.paymentLinkCurrency, channel: request.channel,
      idempotencyKey: paymentLinkIdempotencyKey(order.id, request.paymentLinkRequestId), attempts: 1, leaseToken,
      leaseUntil: Timestamp.fromMillis(now + leaseDurationMs), createdAt: FieldValue.serverTimestamp(), createdBy: admin.uid,
      lastAttemptAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(orderRef, {
      paymentLinkUrl: request.paymentLinkUrl, paymentLinkLabel: request.paymentLinkLabel,
      paymentLinkAmount: request.paymentLinkAmount, paymentLinkCurrency: request.paymentLinkCurrency,
      paymentLinkSent: false, paymentLinkSentAt: FieldValue.delete(), paymentLinkSentBy: FieldValue.delete(),
      paymentLinkDelivery: summary, paymentLinkDeliveryHistory: upsertHistory(order.paymentLinkDeliveryHistory, summary),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { claimed: true, requestRef, leaseToken, order, contentFingerprint,
      result: { status: "sending", requestId: request.paymentLinkRequestId, attempts: 1, existing: false } };
  });
}

async function checkBeforeDispatch(db: FirebaseFirestore.Firestore, request: PaymentLinkDeliveryRequest, claim: DeliveryClaim) {
  return db.runTransaction(async (transaction) => {
    const [stateSnapshot, orderSnapshot] = await Promise.all([
      transaction.get(claim.requestRef), transaction.get(db.collection("orders").doc(request.orderId)),
    ]);
    const state = stateSnapshot.data();
    if (!state || state.leaseToken !== claim.leaseToken || state.status !== "sending" || state.dispatchStartedAt) {
      throw new PaymentLinkOrderStateError("delivery_result_requires_verification");
    }
    if (!orderSnapshot.exists) return "order_missing";
    const order = orderFromSnapshot(orderSnapshot);
    const error = currentIntentError(order, request, claim);
    if (error) return error;
    transaction.update(claim.requestRef, { dispatchStartedAt: FieldValue.serverTimestamp() });
    return "";
  });
}

async function finalizePaymentLinkDelivery(input: {
  db: FirebaseFirestore.Firestore; request: PaymentLinkDeliveryRequest;
  admin: { uid: string; email: string | null }; claim: DeliveryClaim;
  providerResult: EmailResult; beforeDispatchError?: string; now: number;
}) {
  const { request, claim } = input;
  const orderRef = input.db.collection("orders").doc(request.orderId);
  // Stable event reference across Firestore retries; never a cagnotte movement.
  const analyticsRef = input.db.collection("analyticsOperationalEvents").doc(paymentLinkRequestDocumentId(request.orderId, request.paymentLinkRequestId));
  return input.db.runTransaction(async (transaction) => {
    const [requestSnapshot, orderSnapshot] = await Promise.all([transaction.get(claim.requestRef), transaction.get(orderRef)]);
    const state = requestSnapshot.data() || {};
    if (!requestSnapshot.exists || state.leaseToken !== claim.leaseToken) return deliveryResult(state, true);
    const order = orderSnapshot.exists ? orderFromSnapshot(orderSnapshot) : null;
    const providerSucceeded = input.providerResult.status === "sent";
    const providerId = emailProviderId(input.providerResult);
    const transportStatus: NonNullable<PaymentLinkDeliverySummary["transportStatus"]> = providerSucceeded ? "accepted" : classifyDeliveryFailure(input.providerResult) === "failed" ? "not_sent" : "unknown";
    let status: PaymentLinkDeliveryStatus = providerSucceeded ? "sent" : classifyDeliveryFailure(input.providerResult);
    let errorCode = emailErrorCode(input.providerResult);
    const intentError = order ? currentIntentError(order, request, claim) : "order_missing";
    if (providerSucceeded && intentError) { status = "unknown"; errorCode = intentError + "_after_provider_call"; }
    if (input.beforeDispatchError) { status = "failed"; errorCode = input.beforeDispatchError + "_before_provider_call"; }
    const completedAt = new Date(input.now).toISOString();
    // This is the very same controlled payment status transition as the status route.
    const statusUpdate = status === "sent" && order ? preparePaymentLinkStatusTransition(order) : {};
    const summary = { ...paymentLinkSummary({ request, status, attempts: Number(state.attempts), providerId, errorCode,
      createdAt: timestampToIso(state.createdAt, completedAt), lastAttemptAt: timestampToIso(state.lastAttemptAt, completedAt), completedAt }), transportStatus };
    transaction.update(claim.requestRef, { status, transportStatus, leaseToken: FieldValue.delete(), leaseUntil: FieldValue.delete(),
      providerId: providerId || FieldValue.delete(), lastErrorCode: errorCode || FieldValue.delete(),
      completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    if (order) {
      const update: Record<string, unknown> = {
        paymentLinkDeliveryHistory: upsertHistory(order.paymentLinkDeliveryHistory, summary), updatedAt: FieldValue.serverTimestamp(),
      };
      if (order.paymentLinkDelivery?.requestId === request.paymentLinkRequestId) update.paymentLinkDelivery = summary;
      if (status === "sent") Object.assign(update, statusUpdate, {
        paymentLinkSent: true, paymentLinkSentAt: FieldValue.serverTimestamp(), paymentLinkSentBy: input.admin.email,
        paymentLinkChannel: request.channel, "emails.paymentLinkSentAt": FieldValue.serverTimestamp(), "emails.paymentLinkProviderId": providerId || null,
      });
      transaction.update(orderRef, update as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
      if (status === "sent") transaction.set(analyticsRef, {
        event: "payment_link_sent", orderId: order.id, transaction_id: order.id, payment_method: "card_payment_link",
        delivery_method: order.deliveryMethod, value: orderPaymentAmount(order), currency: "EUR", createdAt: FieldValue.serverTimestamp(), createdBy: input.admin.uid,
      });
    }
    return { status, requestId: request.paymentLinkRequestId, attempts: Number(state.attempts),
      providerId, errorCode: errorCode || undefined, transportStatus, existing: false } satisfies PaymentLinkDeliveryResult;
  });
}

function assertOrderCanReceivePaymentLink(order: Order, request: PaymentLinkDeliveryRequest) {
  const error = orderStateError(order);
  if (error) throw new PaymentLinkOrderStateError(error);
  if (hasCagnotteEnrollment(order)) {
    try {
      const registration = validateOrderCagnotteEnrollment(order);
      if (!registration.beneficiaryId || typeof registration.programVersion !== "string" || !registration.programVersion.trim() ||
        !Number.isSafeInteger(registration.createdAtEpochMs) || registration.createdAtEpochMs < 0 ||
        registration.snapshot.productsPaidCents + eurosToCagnotteCents(order.deliveryFee) !== orderPaymentCents(order)) throw new Error();
    } catch { throw new PaymentLinkOrderStateError("cagnotte_order_invalid"); }
  }
  if (typeof order.customerEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customerEmail)) {
    throw new PaymentLinkOrderStateError("customer_email_invalid");
  }
  try {
    if (request.paymentLinkCurrency !== "EUR" || request.channel !== "email" ||
      eurosToCagnotteCents(request.paymentLinkAmount) !== orderPaymentCents(order) || orderPaymentCents(order) <= 0) throw new Error();
  } catch { throw new PaymentLinkOrderStateError("payment_link_order_amount_mismatch"); }
}

function orderStateError(order: Order) {
  if (order.deletedAt) return "order_deleted";
  if (order.orderStatus === "cancelled" || order.paymentStatus === "cancelled" || order.cancelledAt) return "order_cancelled";
  if (order.paymentStatus === "paid") return "order_already_paid";
  return "";
}

function currentIntentError(order: Order, request: PaymentLinkDeliveryRequest, claim: DeliveryClaim) {
  try { assertOrderCanReceivePaymentLink(order, request); }
  catch (error) { return error instanceof PaymentLinkOrderStateError ? error.code : "order_invalid"; }
  if (order.paymentLinkDelivery?.requestId !== request.paymentLinkRequestId ||
    order.paymentLinkUrl !== request.paymentLinkUrl || order.paymentLinkLabel !== request.paymentLinkLabel ||
    order.paymentLinkAmount !== request.paymentLinkAmount || order.paymentLinkCurrency !== request.paymentLinkCurrency ||
    paymentLinkContentFingerprint(order, request) !== claim.contentFingerprint) return "payment_link_content_changed";
  return "";
}

function paymentLinkContentFingerprint(order: Order, request: PaymentLinkDeliveryRequest) {
  return sha256(JSON.stringify({ orderId: order.id, payload: paymentLinkPayloadFingerprint(request),
    recipient: order.customerEmail, customerName: order.customerName,
    paymentAmount: order.paymentAmount ?? order.total,
    deliveryMethod: order.deliveryMethod, deliveryZone: order.deliveryZone, beneficiaryId: order.customerId,
    enrollment: hasCagnotteEnrollment(order) ? order.cagnotte : "absent" }));
}

function hasConfirmedEmailDelivery(order: Order) {
  return Boolean(
    order.paymentLinkDeliveryHistory?.some(
      (entry) => entry.channel === "email" &&
        (entry.status === "sent" || entry.transportStatus === "accepted" || entry.intent === "resend"),
    ) ||
      order.paymentLinkDelivery?.status === "sent" ||
      (order.paymentLinkSent && order.paymentLinkChannel === "email"),
  );
}

export function paymentLinkRequestDocumentId(orderId: string, requestId: string) {
  return sha256(`${orderId}:${requestId}`);
}

function normalizeStatus(value: unknown): PaymentLinkDeliveryStatus {
  return value === "pending" ||
    value === "sending" ||
    value === "sent" ||
    value === "failed" ||
    value === "unknown"
    ? value
    : "pending";
}

function deliveryResult(
  value: Record<string, unknown>,
  existing: boolean,
): PaymentLinkDeliveryResult {
  return {
    status: normalizeStatus(value.status),
    requestId: typeof value.requestId === "string" ? value.requestId : "",
    attempts: Number(value.attempts || 0),
    providerId:
      typeof value.providerId === "string" ? value.providerId : undefined,
    errorCode:
      typeof value.lastErrorCode === "string" ? value.lastErrorCode : undefined,
    existing,
    transportStatus: value.transportStatus as PaymentLinkDeliverySummary["transportStatus"],
  };
}

function classifyDeliveryFailure(result: EmailResult): "failed" | "unknown" {
  if (result.status === "skipped") return "failed";
  return result.status === "failed" && result.reason === "provider_rejected" ? "failed" : "unknown";
}

function emailErrorCode(result: EmailResult) {
  return result.status === "sent" ? "" : result.reason || "email_delivery_failed";
}

function emailProviderId(result: EmailResult) {
  return result.status === "sent" && typeof result.id === "string"
    ? result.id
    : undefined;
}

function paymentLinkSummary(input: {
  request: PaymentLinkDeliveryRequest;
  status: PaymentLinkDeliveryStatus;
  attempts: number;
  providerId?: string;
  errorCode: string;
  createdAt: string;
  lastAttemptAt: string;
  completedAt: string;
}): PaymentLinkDeliverySummary {
  return {
    requestId: input.request.paymentLinkRequestId,
    intent: input.request.intent,
    status: input.status,
    channel: input.request.channel,
    amount: input.request.paymentLinkAmount,
    currency: input.request.paymentLinkCurrency,
    attempts: input.attempts,
    createdAt: input.createdAt,
    lastAttemptAt: input.lastAttemptAt,
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };
}

function upsertHistory(
  history: PaymentLinkDeliverySummary[] | undefined,
  summary: PaymentLinkDeliverySummary,
) {
  const previous = Array.isArray(history) ? history : [];
  return [
    summary,
    ...previous.filter((entry) => entry.requestId !== summary.requestId),
  ].slice(0, historyLimit);
}

function timestampToMs(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toMillis" in value) {
    return Number((value as { toMillis: () => number }).toMillis());
  }
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

function timestampToIso(value: unknown, fallback: string) {
  const milliseconds = timestampToMs(value);
  return milliseconds ? new Date(milliseconds).toISOString() : fallback;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
