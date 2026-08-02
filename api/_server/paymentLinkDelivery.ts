import crypto from "node:crypto";
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
};

type DeliveryClaim = {
  claimed: boolean;
  requestRef: FirebaseFirestore.DocumentReference;
  leaseToken?: string;
  order?: Order;
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
    "paymentLinkUrl" | "paymentLinkAmount" | "paymentLinkCurrency" | "channel"
  >,
) {
  return sha256(
    JSON.stringify({
      linkFingerprint: paymentLinkUrlFingerprint(input.paymentLinkUrl),
      amount: normalizeAmount(input.paymentLinkAmount),
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

export async function executePaymentLinkDelivery(input: {
  db: FirebaseFirestore.Firestore;
  request: PaymentLinkDeliveryRequest;
  admin: { uid: string; email: string | null };
  send: (
    order: Order,
    request: PaymentLinkDeliveryRequest,
  ) => Promise<EmailResult>;
  now?: () => number;
}) {
  const request = {
    ...input.request,
    paymentLinkRequestId: validatePaymentLinkRequestId(
      input.request.paymentLinkRequestId,
    ),
  };
  const now = input.now || Date.now;
  const claim = await reservePaymentLinkDelivery(
    input.db,
    request,
    input.admin,
    now(),
  );
  if (!claim.claimed || !claim.order || !claim.leaseToken) {
    return claim.result;
  }

  let providerResult: EmailResult;
  try {
    providerResult = await input.send(claim.order, request);
  } catch {
    providerResult = { status: "failed", reason: "network_error" };
  }

  return finalizePaymentLinkDelivery({
    db: input.db,
    request,
    admin: input.admin,
    requestRef: claim.requestRef,
    leaseToken: claim.leaseToken,
    providerResult,
    now: now(),
  });
}

async function reservePaymentLinkDelivery(
  db: FirebaseFirestore.Firestore,
  request: PaymentLinkDeliveryRequest,
  admin: { uid: string; email: string | null },
  now: number,
): Promise<DeliveryClaim> {
  const requestRef = db
    .collection(paymentLinkRequestsCollection)
    .doc(paymentLinkRequestDocumentId(request.orderId, request.paymentLinkRequestId));
  const orderRef = db.collection("orders").doc(request.orderId);
  const fingerprint = paymentLinkPayloadFingerprint(request);

  return db.runTransaction(async (transaction) => {
    const [requestSnapshot, orderSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(orderRef),
    ]);
    if (!orderSnapshot.exists) {
      throw new PaymentLinkOrderStateError("order_missing");
    }
    const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
    assertOrderCanReceivePaymentLink(order);

    const previous = requestSnapshot.data() || {};
    if (requestSnapshot.exists) {
      if (
        previous.orderId !== request.orderId ||
        previous.requestId !== request.paymentLinkRequestId ||
        previous.payloadFingerprint !== fingerprint ||
        previous.intent !== request.intent
      ) {
        throw new PaymentLinkConflictError();
      }
      const previousStatus = normalizeStatus(previous.status);
      const previousResult = deliveryResult(previous, true);
      if (previousStatus === "sent") {
        return { claimed: false, requestRef, result: previousResult };
      }
      if (
        previousStatus === "sending" &&
        timestampToMs(previous.leaseUntil) > now
      ) {
        return { claimed: false, requestRef, result: previousResult };
      }
    } else {
      const hasPreviousEmailDelivery = hasConfirmedEmailDelivery(order);
      if (hasPreviousEmailDelivery && request.intent !== "resend") {
        throw new PaymentLinkOrderStateError("resend_confirmation_required");
      }
      if (!hasPreviousEmailDelivery && request.intent === "resend") {
        throw new PaymentLinkOrderStateError("initial_send_required");
      }
    }

    const leaseToken = crypto.randomUUID();
    const attempts = Number(previous.attempts || 0) + 1;
    const createdAt = previous.createdAt || FieldValue.serverTimestamp();
    transaction.set(
      requestRef,
      {
        orderId: request.orderId,
        requestId: request.paymentLinkRequestId,
        intent: request.intent,
        status: "sending",
        payloadFingerprint: fingerprint,
        linkFingerprint: paymentLinkUrlFingerprint(request.paymentLinkUrl),
        amount: normalizeAmount(request.paymentLinkAmount),
        currency: request.paymentLinkCurrency,
        channel: request.channel,
        idempotencyKey: paymentLinkIdempotencyKey(
          request.orderId,
          request.paymentLinkRequestId,
        ),
        attempts,
        leaseToken,
        leaseUntil: Timestamp.fromMillis(now + leaseDurationMs),
        createdAt,
        createdBy: previous.createdBy || admin.uid,
        lastAttemptAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.delete(),
        providerId: previous.providerId || FieldValue.delete(),
        lastErrorCode: FieldValue.delete(),
      },
      { merge: true },
    );
    const attemptAt = new Date(now).toISOString();
    const sendingSummary = paymentLinkSummary({
      request,
      status: "sending",
      attempts,
      errorCode: "",
      createdAt: timestampToIso(previous.createdAt, attemptAt),
      lastAttemptAt: attemptAt,
      completedAt: "",
    });
    transaction.update(orderRef, {
      paymentLinkUrl: request.paymentLinkUrl,
      paymentLinkLabel: request.paymentLinkLabel,
      paymentLinkAmount: request.paymentLinkAmount,
      paymentLinkCurrency: request.paymentLinkCurrency,
      paymentLinkDelivery: sendingSummary,
      paymentLinkDeliveryHistory: upsertHistory(
        order.paymentLinkDeliveryHistory,
        sendingSummary,
      ),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      claimed: true,
      requestRef,
      leaseToken,
      order,
      result: {
        status: "sending",
        requestId: request.paymentLinkRequestId,
        attempts,
        existing: requestSnapshot.exists,
      },
    };
  });
}

async function finalizePaymentLinkDelivery(input: {
  db: FirebaseFirestore.Firestore;
  request: PaymentLinkDeliveryRequest;
  admin: { uid: string; email: string | null };
  requestRef: FirebaseFirestore.DocumentReference;
  leaseToken: string;
  providerResult: EmailResult;
  now: number;
}) {
  const orderRef = input.db.collection("orders").doc(input.request.orderId);
  const analyticsRef = input.db
    .collection("analyticsOperationalEvents")
    .doc();

  return input.db.runTransaction(async (transaction) => {
    const [requestSnapshot, orderSnapshot] = await Promise.all([
      transaction.get(input.requestRef),
      transaction.get(orderRef),
    ]);
    const state = requestSnapshot.data() || {};
    if (!requestSnapshot.exists || state.leaseToken !== input.leaseToken) {
      return deliveryResult(state, true);
    }

    const attempts = Number(state.attempts || 1);
    const providerId = emailProviderId(input.providerResult);
    const providerSucceeded = input.providerResult.status === "sent";
    let status = providerSucceeded
      ? ("sent" as const)
      : classifyDeliveryFailure(input.providerResult);
    let errorCode = providerSucceeded
      ? ""
      : emailErrorCode(input.providerResult);
    let order: Order | null = null;

    if (!orderSnapshot.exists) {
      status = "unknown";
      errorCode = "order_missing_after_provider_call";
    } else {
      order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
      if (providerSucceeded) {
        const stateError = orderStateError(order);
        if (stateError) {
          status = "unknown";
          errorCode = `${stateError}_after_provider_call`;
        }
      }
    }

    const completedAt = new Date(input.now).toISOString();
    transaction.update(input.requestRef, {
      status,
      leaseToken: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
      providerId: providerId || FieldValue.delete(),
      lastErrorCode: errorCode || FieldValue.delete(),
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (order) {
      const summary = paymentLinkSummary({
        request: input.request,
        status,
        attempts,
        providerId,
        errorCode,
        createdAt: timestampToIso(state.createdAt, completedAt),
        lastAttemptAt: completedAt,
        completedAt,
      });
      const history = upsertHistory(order.paymentLinkDeliveryHistory, summary);
      const orderUpdate: Record<string, unknown> = {
        paymentLinkDelivery: summary,
        paymentLinkDeliveryHistory: history,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (status === "sent") {
        Object.assign(orderUpdate, {
          paymentLinkUrl: input.request.paymentLinkUrl,
          paymentLinkLabel: input.request.paymentLinkLabel,
          paymentLinkAmount: input.request.paymentLinkAmount,
          paymentLinkCurrency: input.request.paymentLinkCurrency,
          paymentLinkSent: true,
          paymentLinkSentAt: FieldValue.serverTimestamp(),
          paymentLinkSentBy: input.admin.email,
          paymentLinkChannel: input.request.channel,
          paymentStatus: "payment_link_sent",
          "emails.paymentLinkSentAt": FieldValue.serverTimestamp(),
          "emails.paymentLinkProviderId": providerId || null,
        });
      }
      transaction.update(
        orderRef,
        orderUpdate as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
      );

      if (status === "sent") {
        transaction.set(
          analyticsRef,
          {
            event: "payment_link_sent",
            orderId: order.id,
            transaction_id: order.id,
            payment_method: "card_payment_link",
            delivery_method: order.deliveryMethod,
            value: Number(order.total || 0),
            currency: "EUR",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: input.admin.uid,
          },
          { merge: false },
        );
      }
    }

    return {
      status,
      requestId: input.request.paymentLinkRequestId,
      attempts,
      providerId,
      errorCode: errorCode || undefined,
      existing: false,
    } satisfies PaymentLinkDeliveryResult;
  });
}

function assertOrderCanReceivePaymentLink(order: Order) {
  const errorCode = orderStateError(order);
  if (errorCode) throw new PaymentLinkOrderStateError(errorCode);
}

function orderStateError(order: Order) {
  if (order.deletedAt) return "order_deleted";
  if (order.orderStatus === "cancelled" || order.paymentStatus === "cancelled") {
    return "order_cancelled";
  }
  if (order.paymentStatus === "paid") return "order_already_paid";
  return "";
}

function hasConfirmedEmailDelivery(order: Order) {
  return Boolean(
    order.paymentLinkDeliveryHistory?.some(
      (entry) => entry.channel === "email" && entry.status === "sent",
    ) ||
      order.paymentLinkDelivery?.status === "sent" ||
      (order.paymentLinkSent && order.paymentLinkChannel === "email"),
  );
}

function paymentLinkRequestDocumentId(orderId: string, requestId: string) {
  return sha256(`${orderId}:${requestId}`);
}

function normalizeAmount(value: number) {
  return Math.round(Number(value) * 100) / 100;
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
  };
}

function classifyDeliveryFailure(result: EmailResult): "failed" | "unknown" {
  const code = emailErrorCode(result);
  return code === "timeout" || code === "network_error" || code === "http_error"
    ? "unknown"
    : "failed";
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
