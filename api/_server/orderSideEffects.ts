import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { CheckoutRequestBody } from "./checkout.js";
import type { EmailResult } from "./email.js";
import type { Order } from "../../src/types/index.js";

export const checkoutRequestsCollection = "checkoutRequests";
export const orderSideEffectsCollection = "orderSideEffects";

export const orderSideEffectTaskNames = [
  "draft_invoice",
  "customer_confirmation_email",
  "admin_notification_email",
  "admin_sms",
  "admin_whatsapp",
] as const;

export type OrderSideEffectTaskName = (typeof orderSideEffectTaskNames)[number];
export type OrderSideEffectStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "skipped";

export type SideEffectResult =
  | { status: "sent"; id?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; statusCode?: number };

const checkoutRequestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sideEffectLeaseMs = 60_000;

export class CheckoutRequestConflictError extends Error {
  constructor() {
    super("checkout_request_conflict");
    this.name = "CheckoutRequestConflictError";
  }
}

export function validateCheckoutRequestId(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("checkout_request_id_invalid");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length !== 36 || !checkoutRequestIdPattern.test(normalized)) {
    throw new Error("checkout_request_id_invalid");
  }
  return normalized;
}

export function checkoutPayloadFingerprint(body: CheckoutRequestBody) {
  const commercialPayload = {
    items: body.items
      .map((item) => ({
        productId: cleanText(item.productId),
        quantity: Number(item.quantity),
        purchaseMode: item.purchaseMode === "fixed_price" ? "fixed_price" : "gram",
        fixedPriceOptionId: cleanText(item.fixedPriceOptionId),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    deliveryMethod: body.deliveryMethod,
    deliveryZone: cleanText(body.deliveryZone),
    deliverySlot: cleanText(body.deliverySlot),
    couponCode: cleanText(body.couponCode).toLowerCase(),
    promotionSelections: (body.promotionSelections || [])
      .map((selection) => ({
        promotionId: cleanText(selection.promotionId),
        giftProductId: cleanText(selection.giftProductId),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    preferredPaymentMethod: body.preferredPaymentMethod || "",
    customerMessage: cleanText(body.customerMessage),
    customer: {
      email: cleanText(body.customer.email).toLowerCase(),
      phone: cleanText(body.customer.phone),
      firstName: cleanText(body.customer.firstName),
      lastName: cleanText(body.customer.lastName),
      address: {
        firstName: cleanText(body.customer.address.firstName),
        lastName: cleanText(body.customer.address.lastName),
        line1: cleanText(body.customer.address.line1),
        line2: cleanText(body.customer.address.line2),
        postalCode: cleanText(body.customer.address.postalCode),
        city: cleanText(body.customer.address.city),
        country: cleanText(body.customer.address.country),
      },
    },
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(commercialPayload))
    .digest("hex");
}

export function checkoutRequestDocument(
  orderId: string,
  payloadFingerprint: string,
) {
  return {
    orderId,
    payloadFingerprint,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function orderSideEffectsDocument(orderId: string) {
  return {
    orderId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    tasks: Object.fromEntries(
      orderSideEffectTaskNames.map((task) => [
        task,
        {
          status: "pending",
          attempts: 0,
          createdAt: FieldValue.serverTimestamp(),
          lastAttemptAt: null,
          completedAt: null,
          lastErrorCode: null,
          leaseUntil: null,
        },
      ]),
    ),
  };
}

export async function findCheckoutRequest(
  db: FirebaseFirestore.Firestore,
  checkoutRequestId: string,
  payloadFingerprint: string,
) {
  const snapshot = await db
    .collection(checkoutRequestsCollection)
    .doc(checkoutRequestId)
    .get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  if (data.payloadFingerprint !== payloadFingerprint) {
    throw new CheckoutRequestConflictError();
  }
  const orderId = typeof data.orderId === "string" ? data.orderId : "";
  if (!orderId) throw new CheckoutRequestConflictError();
  return { orderId };
}

export async function ensureOrderSideEffectsOutbox(
  db: FirebaseFirestore.Firestore,
  orderId: string,
) {
  const ref = db.collection(orderSideEffectsCollection).doc(orderId);
  const snapshot = await ref.get();
  if (snapshot.exists) return;
  await ref.set(orderSideEffectsDocument(orderId), { merge: true });
}

export async function resetOrderSideEffectTask(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  task: OrderSideEffectTaskName,
) {
  await ensureOrderSideEffectsOutbox(db, orderId);
  await db.collection(orderSideEffectsCollection).doc(orderId).update({
    [`tasks.${task}.status`]: "pending",
    [`tasks.${task}.leaseUntil`]: FieldValue.delete(),
    [`tasks.${task}.completedAt`]: FieldValue.delete(),
    [`tasks.${task}.lastErrorCode`]: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function claimOrderSideEffectTask(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  task: OrderSideEffectTaskName,
) {
  const ref = db.collection(orderSideEffectsCollection).doc(orderId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const taskState = snapshot.data()?.tasks?.[task] || {};
    if (taskState.status === "sent" || taskState.status === "skipped") return false;
    if (
      taskState.status === "processing" &&
      timestampToMs(taskState.leaseUntil) > Date.now()
    ) {
      return false;
    }
    transaction.update(ref, {
      [`tasks.${task}.status`]: "processing",
      [`tasks.${task}.attempts`]: FieldValue.increment(1),
      [`tasks.${task}.lastAttemptAt`]: FieldValue.serverTimestamp(),
      [`tasks.${task}.leaseUntil`]: Timestamp.fromMillis(Date.now() + sideEffectLeaseMs),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function persistOrderSideEffectResult(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  task: OrderSideEffectTaskName,
  result: SideEffectResult | EmailResult,
  orderUpdate: Record<string, unknown> = {},
) {
  const batch = db.batch();
  if (Object.keys(orderUpdate).length) {
    batch.update(db.collection("orders").doc(orderId), {
      ...orderUpdate,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  const status = sideEffectStatus(result);
  const errorCode = sideEffectErrorCode(result);
  batch.update(db.collection(orderSideEffectsCollection).doc(orderId), {
    [`tasks.${task}.status`]: status,
    [`tasks.${task}.leaseUntil`]: FieldValue.delete(),
    [`tasks.${task}.completedAt`]:
      status === "sent" || status === "skipped"
        ? FieldValue.serverTimestamp()
        : FieldValue.delete(),
    [`tasks.${task}.lastErrorCode`]: errorCode || FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

export function emailResultUpdate(
  prefix: "orderConfirmation" | "adminNotification",
  result: EmailResult,
) {
  const errorCode = sideEffectErrorCode(result);
  const update: Record<string, unknown> = {
    [`emails.${prefix}Status`]: result.status,
    "emails.lastAttemptedAt": FieldValue.serverTimestamp(),
  };
  if (result.recipients) {
    update[`emails.${prefix}Recipients`] = result.recipients;
  }
  if (result.status === "sent") {
    update[`emails.${prefix}SentAt`] = FieldValue.serverTimestamp();
    if (result.id) update[`emails.${prefix}ProviderId`] = result.id;
    update[`emails.${prefix}Error`] = FieldValue.delete();
    update[`emails.${prefix}FailedAt`] = FieldValue.delete();
    update[`emails.${prefix}SkippedAt`] = FieldValue.delete();
    return update;
  }
  if (result.status === "partial" || result.status === "failed") {
    update[`emails.${prefix}FailedAt`] = FieldValue.serverTimestamp();
    update[`emails.${prefix}Error`] = errorCode || "email_delivery_failed";
    if (result.status === "failed" && result.statusCode) {
      update[`emails.${prefix}StatusCode`] = result.statusCode;
    }
    return update;
  }
  update[`emails.${prefix}SkippedAt`] = FieldValue.serverTimestamp();
  update[`emails.${prefix}Error`] = errorCode || "config_missing";
  return update;
}

export async function runEmailSideEffect(input: {
  db: FirebaseFirestore.Firestore;
  orderId: string;
  task: "customer_confirmation_email" | "admin_notification_email";
  prefix: "orderConfirmation" | "adminNotification";
  send: (order: Order) => Promise<EmailResult>;
}) {
  const claimed = await claimOrderSideEffectTask(input.db, input.orderId, input.task);
  if (!claimed) {
    return { status: "skipped", reason: "task_not_claimed" } satisfies EmailResult;
  }
  const snapshot = await input.db.collection("orders").doc(input.orderId).get();
  if (!snapshot.exists) {
    const result = { status: "failed", reason: "order_missing" } satisfies EmailResult;
    await persistOrderSideEffectResult(input.db, input.orderId, input.task, result);
    return result;
  }
  const order = { id: snapshot.id, ...snapshot.data() } as Order;
  let result: EmailResult;
  try {
    result = await input.send(order);
  } catch {
    result = { status: "failed", reason: "network_error" };
  }
  await persistOrderSideEffectResult(
    input.db,
    input.orderId,
    input.task,
    result,
    emailResultUpdate(input.prefix, result),
  );
  return result;
}

export function notificationSummary(
  client?: EmailResult,
  admin?: EmailResult,
): "pending" | "completed" | "partial" | "failed" {
  const results = [client, admin].filter(Boolean) as EmailResult[];
  if (!results.length) return "pending";
  const sent = results.filter((result) => result.status === "sent").length;
  const partial = results.some((result) => result.status === "partial");
  if (sent === results.length) return "completed";
  if (sent > 0 || partial) return "partial";
  return "failed";
}

export function sideEffectErrorCode(result: SideEffectResult | EmailResult) {
  if (result.status === "sent") return undefined;
  const reason = result.reason.toLowerCase();
  if (reason.includes("timeout") || reason.includes("abort")) return "timeout";
  if (reason.includes("config") || reason.includes("absent") || reason.includes("not_configured")) {
    return "config_missing";
  }
  if (reason.includes("invalid") || reason.includes("invalide")) return "invalid_recipient";
  if (reason.includes("network") || reason.includes("fetch")) return "network_error";
  if ("statusCode" in result && result.statusCode) {
    return result.statusCode >= 400 && result.statusCode < 500
      ? "provider_rejected"
      : "http_error";
  }
  if (result.status === "partial") return "partial_delivery";
  return "provider_rejected";
}

function sideEffectStatus(result: SideEffectResult | EmailResult): OrderSideEffectStatus {
  if (result.status === "partial") return "failed";
  return result.status;
}

function timestampToMs(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toMillis" in value) {
    return Number((value as { toMillis: () => number }).toMillis());
  }
  return 0;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
