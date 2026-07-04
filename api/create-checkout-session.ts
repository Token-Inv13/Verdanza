import { FieldValue } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import {
  cents,
  orderPayload,
  parseCheckoutBody,
  priceCheckout,
} from "./_server/checkout.js";
import { getStripe } from "./_server/stripe.js";
import { verifyFirebaseIdToken } from "./_server/adminAuth.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const requestBody =
      typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const body = parseCheckoutBody(requestBody);
    const db = getAdminDb();
    const stripe = getStripe();
    const priced = await priceCheckout(db, body);
    const verifiedCustomer = body.authToken
      ? await verifyFirebaseIdToken(body.authToken)
      : null;
    const appUrl = process.env.VITE_APP_URL || process.env.APP_URL;

    if (!appUrl) {
      sendJson(response, { error: "Missing VITE_APP_URL server variable." }, 500);
      return;
    }

    const orderRef = db.collection("orders").doc();
    await orderRef.set(orderPayload(body, priced, verifiedCustomer?.uid));

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
      priced.orderItems.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "eur",
        unit_amount: cents(item.unitPrice),
        product_data: {
          name: item.name,
          metadata: {
            productId: item.productId,
          },
        },
      },
    }));

    if (priced.deliveryFee > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: cents(priced.deliveryFee),
          product_data: {
            name: "Livraison Verdanza",
            metadata: {
              deliveryMethod: body.deliveryMethod,
            },
          },
        },
      });
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: lineItems,
        customer_email: body.customer.email,
        phone_number_collection: { enabled: true },
        billing_address_collection: "required",
        success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/checkout/cancel`,
        metadata: {
          orderId: orderRef.id,
          deliveryMethod: body.deliveryMethod,
        },
        payment_intent_data: {
          metadata: {
            orderId: orderRef.id,
          },
        },
      });
    } catch (stripeError) {
      await orderRef.update({
        paymentStatus: "failed",
        orderStatus: "cancelled",
        internalNote: "Creation Stripe Checkout impossible.",
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw sanitizeStripeError(stripeError);
    }

    await orderRef.update({
      stripeSessionId: session.id,
      updatedAt: FieldValue.serverTimestamp(),
    });

    sendJson(response, {
      url: session.url,
      orderId: orderRef.id,
    });
  } catch (error) {
    console.error("create-checkout-session failed", error);
    sendJson(
      response,
      { error: error instanceof Error ? error.message : "Checkout impossible." },
      400,
    );
  }
}

function sanitizeStripeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const stripeType =
    typeof error === "object" && error !== null && "type" in error
      ? String((error as { type?: unknown }).type)
      : "";

  if (
    stripeType.toLowerCase().includes("stripe") ||
    message.toLowerCase().includes("api key") ||
    message.toLowerCase().includes("stripe")
  ) {
    return new Error("Configuration Stripe invalide. Paiement temporairement indisponible.");
  }

  return error;
}
