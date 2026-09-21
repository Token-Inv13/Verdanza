import type { IncomingMessage, ServerResponse } from "node:http";
import { getStripeTestClient, getStripeTestDb, stripeTestOrigin } from "./stripeTestConfig.js";
import { assertTestSession, createTestCheckout, handleTestStripeEvent, readTestOrder, type StripeTestOrder } from "./stripeTestCheckout.js";
import { normalizeTestCheckout } from "./stripeTestCheckout.js";
import { priceCheckout } from "./checkout.js";

// Dependency injection is server-only and used by offline HTTP contract tests.
export function createStripeTestHttp({ getDb = getStripeTestDb, getStripe = getStripeTestClient } = {}) {
return async function stripeTestHttp(req: IncomingMessage, res: ServerResponse) {
  const reply = (status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  };
  try {
    const db = getDb();
    const stripe = getStripe();
    if (req.headers.host !== "127.0.0.1:5195" || (req.headers.origin && req.headers.origin !== stripeTestOrigin)) {
      return reply(403, { error: "local_origin_required" });
    }
    const route = new URL(req.url || "/", stripeTestOrigin).pathname;
    if (route === "/api/stripe-test/catalog" && req.method === "GET") {
      const products = await db.collection("products").get();
      return reply(200, { products: products.docs.filter((doc) => doc.data().isActive === true).map((doc) => {
        const p = doc.data();
        return { id: doc.id, name: p.name, slug: p.slug, category: p.category, isActive: true,
          price: p.price, stock: p.stock, fixedPriceMode: p.fixedPriceMode, fixedPriceOptions: p.fixedPriceOptions,
          shortDescription: p.shortDescription || "Produit CBD Verdanza" };
      }) });
    }
    if (route === "/api/stripe-test/delivery-zones" && req.method === "GET") {
      const snapshot = await db.collection("deliveryZones").get();
      return reply(200, { zones: snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id, adminNote: undefined })) });
    }
    if (req.method !== "POST") return reply(405, { error: "post_required" });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 262144) return reply(413, { error: "body_too_large" });
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);
    if (route === "/api/stripe-test/webhook") {
      const signature = req.headers["stripe-signature"];
      const secret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
      if (!secret?.startsWith("whsec_") || typeof signature !== "string") return reply(400, { error: "signature_required" });
      let event;
      try { event = stripe.webhooks.constructEvent(raw, signature, secret); }
      catch { return reply(400, { error: "invalid_signature" }); }
      try { return reply(200, await handleTestStripeEvent(db, stripe, event)); }
      catch { return reply(500, { error: "webhook_processing_failed" }); }
    }
    let body;
    try { body = JSON.parse(raw.toString("utf8")); }
    catch { return reply(400, { error: "invalid_json" }); }
    const token = String(req.headers["x-test-order-token"] || "");
    if (route === "/api/stripe-test/quote") {
      const priced = await priceCheckout(db, normalizeTestCheckout({
        ...body, checkoutRequestId: "00000000-0000-4000-8000-000000000000", complianceAccepted: true,
        customer: { email: body.email || "checkout-test@example.invalid", phone: "0600000000", firstName: "Client", lastName: "Test",
          address: { firstName: "Client", lastName: "Test", line1: "1 rue du Test", postalCode: "75001", city: "Paris", country: "France", ...body.address } },
      }).body);
      const { subtotal, subtotalBeforeDiscount, deliveryFee, deliveryFeeStatus, deliveryNote, discountAmount,
        couponCode, promoApplied, discountType, discountValue, promotionDiscountTotal, appliedPromotions,
        promotionProgressMessages, subtotalBeforePromotion, subtotalAfterPromotion, postalFreeShippingApplied, total, giftPromotions, promotionConflictMessage } = priced;
      return reply(200, { subtotal, subtotalBeforeDiscount, deliveryFee, deliveryFeeStatus, deliveryNote, discountAmount,
        couponCode, promoApplied, discountType, discountValue, promotionDiscountTotal, appliedPromotions,
        promotionProgressMessages, subtotalBeforePromotion, subtotalAfterPromotion, postalFreeShippingApplied, total, giftPromotions, promotionConflictMessage });
    }
    if (route === "/api/stripe-test/checkout") {
      if (!process.env.STRIPE_TEST_WEBHOOK_SECRET?.startsWith("whsec_")) return reply(503, { error: "webhook_not_configured" });
      const result = await createTestCheckout(db, stripe, body, token);
      return reply(200, { url: result.url });
    }
    if (["/api/stripe-test/status", "/api/stripe-test/cancel", "/api/stripe-test/resume"].includes(route)) {
      const status = await readTestOrder(db, String(body.orderId || ""), token);
      if (route.endsWith("/resume")) {
        const order = (await db.collection("stripeTestOrders").doc(status.orderId).get()).data() as StripeTestOrder;
        if (!order.sessionId || status.paymentStatus === "paid") throw new Error("test_session_not_open");
        const current = await stripe.checkout.sessions.retrieve(order.sessionId);
        assertTestSession(order, current);
        if (current.status !== "open" || !current.url?.startsWith("https://checkout.stripe.com/")) throw new Error("test_session_not_open");
        return reply(200, { url: current.url });
      }
      if (route.endsWith("/cancel") && status.paymentStatus !== "paid") {
        const order = (await db.collection("stripeTestOrders").doc(status.orderId).get()).data() as StripeTestOrder;
        if (order.sessionId) {
          const session = await stripe.checkout.sessions.retrieve(order.sessionId);
          if (session.livemode !== false) throw new Error("live_session_rejected");
          if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
        }
      }
      return reply(200, status);
    }
    return reply(404, { error: "route_missing" });
  } catch (error) {
    // Never serialize SDK errors (request headers/client secrets/customer data).
    const message = error instanceof Error ? error.message : "";
    const allowed = /^(test_[a-z_]+|stripe_test_[a-z_]+|synthetic_email_required)$/.test(message);
    reply(message === "test_order_missing" ? 404 : message === "test_request_conflict" ? 409 : 400,
      { error: allowed ? message : "test_request_failed" });
  }
}

}
export const stripeTestHttp = createStripeTestHttp();
