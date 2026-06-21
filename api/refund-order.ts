import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { getStripe } from "./_server/stripe.js";
import { sendRefundNotificationEmail } from "./_server/email.js";
import type { Order } from "../src/types/index.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const rawBody = parseJsonObject(request.body);
    const idToken = rawBody.authToken || bearerToken(request);
    if (!idToken) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }

    const body = parseBody(rawBody);
    const db = getAdminDb();
    const admin = await assertAdminUser(db, idToken);
    const orderRef = db.collection("orders").doc(body.orderId);
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) throw new Error("Commande introuvable.");

    const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
    if (order.paymentStatus === "refunded" || order.orderStatus === "refunded") {
      sendJson(response, { ok: true, refundId: order.refundId ?? null, alreadyRefunded: true });
      return;
    }
    if (order.paymentStatus !== "paid" || !order.stripePaymentIntentId) {
      throw new Error("Seule une commande payee avec payment_intent Stripe est remboursable.");
    }

    const stripe = getStripe();
    const refund = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
      reason: "requested_by_customer",
      metadata: {
        orderId: order.id,
        requestedBy: admin.uid,
      },
    });

    await db.runTransaction(async (transaction) => {
      const freshSnapshot = await transaction.get(orderRef);
      if (!freshSnapshot.exists) throw new Error("Commande introuvable.");
      const freshOrder = { id: freshSnapshot.id, ...freshSnapshot.data() } as Order;
      if (freshOrder.paymentStatus === "refunded") return;

      transaction.update(orderRef, {
        paymentStatus: "refunded",
        orderStatus: "refunded",
        refundId: refund.id,
        refundedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: "refunded",
          previousStatus: freshOrder.orderStatus,
          changedAt: new Date().toISOString(),
          changedBy: "admin",
          changedByUid: admin.uid,
          note: body.reason || "Remboursement Stripe initie.",
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (body.restock) {
        for (const item of freshOrder.items) {
          const productRef = db.collection("products").doc(item.productId);
          transaction.update(productRef, {
            stock: FieldValue.increment(item.quantity),
            updatedAt: FieldValue.serverTimestamp(),
          });
          transaction.set(db.collection("stockMovements").doc(), {
            productId: item.productId,
            productName: item.name,
            type: "return",
            quantity: item.quantity,
            note: `Remboursement Stripe ${refund.id}`,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: admin.uid,
            orderId: freshOrder.id,
          });
        }
      }
    });

    const updatedSnapshot = await orderRef.get();
    const updatedOrder = { id: updatedSnapshot.id, ...updatedSnapshot.data() } as Order;
    const emailResult = await sendRefundNotificationEmail(updatedOrder);
    if (emailResult.status === "sent") {
      await orderRef.update({
        "emails.refundNotificationSentAt": FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    sendJson(response, { ok: true, refundId: refund.id });
  } catch (error) {
    console.error("refund-order failed", error);
    const message =
      error instanceof Error ? error.message : "Remboursement commande impossible.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
}

function parseBody(value: unknown): {
  orderId: string;
  authToken?: string;
  restock?: boolean;
  reason?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  const payload = body as {
    orderId?: string;
    authToken?: string;
    restock?: boolean;
    reason?: string;
  };
  if (!payload.orderId) throw new Error("orderId requis.");
  return {
    ...payload,
    orderId: payload.orderId,
  };
}

function parseJsonObject(value: unknown): {
  orderId?: string;
  authToken?: string;
  restock?: boolean;
  reason?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  return body as {
    orderId?: string;
    authToken?: string;
    restock?: boolean;
    reason?: string;
  };
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}
