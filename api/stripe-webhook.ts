import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { getAdminDb } from "./_server/firebaseAdmin";
import { assertMethod, jsonResponse } from "./_server/http";
import { getStripe } from "./_server/stripe";
import type { Order } from "../src/types";

export default async function handler(request: Request) {
  const methodError = assertMethod(request, "POST");
  if (methodError) return methodError;

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return jsonResponse({ error: "Missing STRIPE_WEBHOOK_SECRET." }, 500);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse({ error: "Missing Stripe signature." }, 400);
  }

  const stripe = getStripe();
  const rawBody = await request.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("Invalid Stripe webhook signature", error);
    return jsonResponse({ error: "Invalid Stripe signature." }, 400);
  }

  if (event.type !== "checkout.session.completed") {
    return jsonResponse({ received: true });
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
    return jsonResponse({ error: "Order not found for Stripe session." }, 400);
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

    return jsonResponse({ received: true });
  } catch (error) {
    console.error("stripe-webhook failed", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Webhook processing failed." },
      500,
    );
  }
}
