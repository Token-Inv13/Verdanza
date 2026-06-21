import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  readRawBody,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { getStripe } from "./_server/stripe.js";
import type { Order } from "../src/types/index.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    sendJson(response, { error: "Missing STRIPE_WEBHOOK_SECRET." }, 500);
    return;
  }

  const signature = request.headers["stripe-signature"];
  if (!signature) {
    sendJson(response, { error: "Missing Stripe signature." }, 400);
    return;
  }

  const stripe = getStripe();
  const rawBody = await readRawBody(request);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("Invalid Stripe webhook signature", error);
    sendJson(response, { error: "Invalid Stripe signature." }, 400);
    return;
  }

  if (event.type !== "checkout.session.completed") {
    sendJson(response, { received: true });
    return;
  }

  const session = event.data.object;
  let orderId = session.metadata?.orderId;
  const db = getAdminDb();
  if (!orderId) {
    const orderBySession = await db
      .collection("orders")
      .where("stripeSessionId", "==", session.id)
      .limit(1)
      .get();
    orderId = orderBySession.docs[0]?.id;
  }

  if (!orderId) {
    sendJson(response, { error: "Order not found for Stripe session." }, 400);
    return;
  }

  try {
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) {
        throw new Error(`Order not found: ${orderId}`);
      }

      const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order & {
        stripeEventIds?: string[];
      };
      if (order.stripeSessionId && order.stripeSessionId !== session.id) {
        throw new Error("Stripe session does not match order.");
      }
      const processedEventIds = order.stripeEventIds ?? [];

      if (order.paymentStatus === "paid" || processedEventIds.includes(event.id)) {
        transaction.update(orderRef, {
          stripeEventIds: FieldValue.arrayUnion(event.id),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      for (const item of order.items) {
        const productRef = db.collection("products").doc(item.productId);
        const productSnapshot = await transaction.get(productRef);
        if (!productSnapshot.exists) {
          throw new Error(`Product not found while processing webhook: ${item.productId}`);
        }

        const currentStock = Number(productSnapshot.data()?.stock ?? 0);
        const nextStock = Math.max(0, currentStock - item.quantity);
        transaction.update(productRef, {
          stock: nextStock,
          updatedAt: FieldValue.serverTimestamp(),
        });

        const movementRef = db.collection("stockMovements").doc();
        transaction.set(movementRef, {
          productId: item.productId,
          productName: item.name,
          type: "sale",
          quantity: -item.quantity,
          note: `Stripe Checkout ${session.id}`,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: "stripe-webhook",
          orderId,
          stripeEventId: event.id,
        });
      }

      transaction.update(orderRef, {
        paymentStatus: "paid",
        orderStatus: "preparing",
        stripeSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        stripeEventIds: FieldValue.arrayUnion(event.id),
        paidAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    sendJson(response, { received: true });
  } catch (error) {
    console.error("stripe-webhook failed", error);
    sendJson(
      response,
      { error: error instanceof Error ? error.message : "Webhook processing failed." },
      500,
    );
  }
}
