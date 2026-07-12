import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Order } from "../../src/types/index.js";
import { isPurchaseEligible, sendGa4Purchase, type Ga4PurchaseResult } from "./ga4MeasurementProtocol.js";

const outboxCollection = "analyticsOutbox";

type AnalyticsOutboxStatus = "pending" | "sending" | "sent" | "failed" | "not_eligible";

export type PurchaseAnalyticsProcessResult = {
  status: AnalyticsOutboxStatus | "skipped";
  code?: string;
};

export async function enqueuePurchaseAnalyticsForPaidTransition(input: {
  db: FirebaseFirestore.Firestore;
  transaction: FirebaseFirestore.Transaction;
  order: Order;
  update: Record<string, unknown>;
}) {
  const { db, transaction, order, update } = input;
  if (order.paymentStatus === "paid") return false;
  const nextOrder = {
    ...order,
    paymentStatus: "paid",
    paidAt:
      typeof update.paidAt === "string"
        ? update.paidAt
        : order.paidAt || new Date().toISOString(),
  } as Order;

  if (!isPurchaseEligible(nextOrder)) {
    if (order.analytics) update["analytics.purchaseStatus"] = "not_eligible";
    return false;
  }

  const outboxRef = db.collection(outboxCollection).doc(outboxId(order.id));
  update["analytics.purchaseStatus"] = "pending";
  transaction.set(
    outboxRef,
    {
      type: "purchase",
      orderId: order.id,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}

export async function ensurePurchaseAnalyticsRetryQueued(
  db: FirebaseFirestore.Firestore,
  order: Order,
) {
  if (!isPurchaseEligible(order)) return false;
  const ref = db.collection(outboxCollection).doc(outboxId(order.id));
  await ref.set(
    {
      type: "purchase",
      orderId: order.id,
      status: "pending",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await db.collection("orders").doc(order.id).update({
    "analytics.purchaseStatus": "pending",
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
}

export async function processPurchaseAnalyticsOutbox(
  db: FirebaseFirestore.Firestore,
  orderId: string,
): Promise<PurchaseAnalyticsProcessResult> {
  const claimed = await claimOutbox(db, orderId);
  if (!claimed) return { status: "skipped", code: "outbox_not_claimed" };

  const orderRef = db.collection("orders").doc(orderId);
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) {
    await markOutbox(db, orderId, { status: "failed", code: "order_missing" });
    return { status: "failed", code: "order_missing" };
  }

  const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
  if (!isPurchaseEligible(order)) {
    const status = order.analytics?.purchaseStatus === "sent" ? "sent" : "not_eligible";
    await markOutbox(db, orderId, { status, code: "purchase_not_eligible" });
    await orderRef.update({
      "analytics.purchaseStatus": status,
      "analytics.purchaseLastErrorCode": status === "sent" ? FieldValue.delete() : "purchase_not_eligible",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { status, code: status === "sent" ? undefined : "purchase_not_eligible" };
  }

  const result = await sendGa4Purchase(order);
  await persistSendResult(db, orderId, result);
  return result.status === "sent"
    ? { status: "sent" }
    : { status: "failed", code: result.code };
}

async function claimOutbox(db: FirebaseFirestore.Firestore, orderId: string) {
  const ref = db.collection(outboxCollection).doc(outboxId(orderId));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const data = snapshot.data() || {};
    if (data.status === "sent") return false;
    const leaseUntil = timestampToMs(data.leaseUntil);
    if (data.status === "sending" && leaseUntil > Date.now()) return false;
    transaction.set(
      ref,
      {
        status: "sending",
        attempts: FieldValue.increment(1),
        lastAttemptAt: FieldValue.serverTimestamp(),
        leaseUntil: Timestamp.fromMillis(Date.now() + 60_000),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
}

async function persistSendResult(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  result: Ga4PurchaseResult,
) {
  const orderRef = db.collection("orders").doc(orderId);
  const outboxRef = db.collection(outboxCollection).doc(outboxId(orderId));
  if (result.status === "sent") {
    await Promise.all([
      outboxRef.set(
        {
          status: "sent",
          sentAt: FieldValue.serverTimestamp(),
          leaseUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
      orderRef.update({
        "analytics.purchaseStatus": "sent",
        "analytics.purchaseSentAt": new Date().toISOString(),
        "analytics.purchaseAttempts": FieldValue.increment(1),
        "analytics.purchaseLastAttemptAt": new Date().toISOString(),
        "analytics.purchaseLastErrorCode": FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);
    return;
  }

  await Promise.all([
    outboxRef.set(
      {
        status: "failed",
        lastErrorCode: result.code,
        leaseUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    ),
    orderRef.update({
      "analytics.purchaseStatus": "failed",
      "analytics.purchaseAttempts": FieldValue.increment(1),
      "analytics.purchaseLastAttemptAt": new Date().toISOString(),
      "analytics.purchaseLastErrorCode": result.code,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);
}

async function markOutbox(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  input: { status: AnalyticsOutboxStatus; code?: string },
) {
  await db.collection(outboxCollection).doc(outboxId(orderId)).set(
    {
      status: input.status,
      lastErrorCode: input.code || FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

function timestampToMs(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toMillis" in value) {
    return Number((value as { toMillis: () => number }).toMillis());
  }
  return 0;
}

function outboxId(orderId: string) {
  return `purchase_${orderId}`;
}
