import { createStripeTestFixtureDb } from "./stripeTestFixtures.js";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Stripe from "stripe";
import { createTestCheckout, handleTestStripeEvent, readTestOrder } from "../api/_server/stripeTestCheckout.js";
import { assertStripeTestEnvironment } from "../api/_server/stripeTestConfig.js";

// Emulator + Stripe mock only. This test never sends a request to Stripe.
process.env.STRIPE_TEST_ENABLED = "true";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
process.env.STRIPE_TEST_SECRET_KEY = "sk_test_fixture";
assert.throws(() => assertStripeTestEnvironment({ ...process.env, STRIPE_TEST_SECRET_KEY: "sk_live_fixture" }));
assert.throws(() => assertStripeTestEnvironment({ ...process.env, FIRESTORE_EMULATOR_HOST: undefined }));
assert.throws(() => assertStripeTestEnvironment({ ...process.env, VERCEL: "1" }));
assert.throws(() => assertStripeTestEnvironment({ ...process.env, VERCEL_ENV: "preview" }));
assert.throws(() => assertStripeTestEnvironment({ ...process.env, NODE_ENV: "production" }));
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:18087";
const db = createStripeTestFixtureDb();
const productId = `test-fixture-${crypto.randomUUID()}`;
await db.collection("products").doc(productId).set({ name: "Résine CBD fixture", price: 10, stock: 100, isActive: true, slug: "test-cbd", category: "resins", fixedPriceMode: "disabled" });
try {
const sessions = new Map<string, Stripe.Checkout.Session>();
let creations = 0;
const fakeStripe = {
  checkout: { sessions: {
    create: async (params: Stripe.Checkout.SessionCreateParams, options: { idempotencyKey: string }) => {
      let session = sessions.get(options.idempotencyKey);
      if (!session) {
        creations++;
        session = { id: `cs_test_${params.client_reference_id}`, object: "checkout.session", livemode: false,
          mode: "payment", status: "open", payment_status: "unpaid", currency: "eur",
          metadata: params.metadata, client_reference_id: params.client_reference_id,
          amount_total: params.line_items!.reduce((sum, item) => sum + (item.price_data?.unit_amount || 0) * (item.quantity || 1), 0),
          url: "https://checkout.stripe.com/c/pay/cs_test_fixture", payment_intent: `pi_${params.client_reference_id}`,
        } as Stripe.Checkout.Session;
        sessions.set(options.idempotencyKey, session);
      }
      return session;
    },
    retrieve: async (id: string) => {
      const session = [...sessions.values()].find((entry) => entry.id === id);
      if (!session) throw new Error("missing_mock_session");
      return session;
    },
  } },
} as unknown as Stripe;
const token = crypto.randomBytes(32).toString("hex");
const body = {
  checkoutRequestId: crypto.randomUUID(), items: [{ productId, quantity: 3, unitPrice: 0.01 }],
  amount: 1, total: 0.01, paymentStatus: "paid", isTestOrder: false,
  deliveryMethod: "postal", complianceAccepted: true,
  customer: { firstName: "Client", lastName: "Test", email: "test@example.invalid", phone: "0600000000", address: { line1: "1 rue du Test", postalCode: "75001", city: "Paris", country: "FR" } },
};
const protectedCollections = ["orders", "invoices", "stockMovements", "orderSideEffects", "counters", "coupons"];
const before = await Promise.all(protectedCollections.map(async (name) => JSON.stringify((await db.collection(name).get()).docs.map((d) => [d.id, d.data()]))));
const [first, second] = await Promise.all([createTestCheckout(db, fakeStripe, body, token), createTestCheckout(db, fakeStripe, body, token)]);
assert.equal(first.orderId, second.orderId);
assert.equal(creations, 1, "double click must have one Stripe session");
const initial = await readTestOrder(db, first.orderId, token);
assert.equal(initial.paymentStatus, "payment_pending", "client paid claim and missing webhook must not confirm payment");
assert(initial.amountCents >= 3000, "frontend price ignored");
await assert.rejects(() => createTestCheckout(db, fakeStripe, { ...body, items: [{ productId, quantity: 4 }] }, token), /test_request_conflict/);
await assert.rejects(() => readTestOrder(db, first.orderId, "wrong"), /test_order_missing/);
await assert.rejects(() => readTestOrder(db, crypto.randomUUID(), token), /test_order_missing/);
const session = sessions.get(`verdanza-test-${body.checkoutRequestId}`)!;
const event = (type: string, object: unknown, id = `evt_${crypto.randomUUID()}`) => ({ id, type, livemode: false, data: { object } }) as Stripe.Event;
const completed = event("checkout.session.completed", session);
session.amount_total = initial.amountCents + 1;
await assert.rejects(() => handleTestStripeEvent(db, fakeStripe, completed), /test_session_mismatch/);
session.amount_total = initial.amountCents;
await assert.rejects(() => handleTestStripeEvent(db, fakeStripe, { ...completed, livemode: true }), /live_event_rejected/);
session.status = "complete"; session.payment_status = "paid";
await Promise.all([handleTestStripeEvent(db, fakeStripe, completed), handleTestStripeEvent(db, fakeStripe, completed)]);
await handleTestStripeEvent(db, fakeStripe, event("checkout.session.completed", session));
const paid = await readTestOrder(db, first.orderId, token);
assert.equal(paid.paymentStatus, "paid"); assert.equal(paid.paidTransitions, 1);
assert.deepEqual(await readTestOrder(db, first.orderId, token), paid, "refresh must be read-only");
await handleTestStripeEvent(db, fakeStripe, event("payment_intent.payment_failed", { object: "payment_intent", id: session.payment_intent, livemode: false, metadata: session.metadata, amount: session.amount_total, currency: "eur" }));
assert.equal((await readTestOrder(db, first.orderId, token)).paymentStatus, "paid", "late failure cannot regress paid");
const cancelBody = { ...body, checkoutRequestId: crypto.randomUUID() };
await createTestCheckout(db, fakeStripe, cancelBody, token);
const cancelSession = sessions.get(`verdanza-test-${cancelBody.checkoutRequestId}`)!;
await handleTestStripeEvent(db, fakeStripe, event("payment_intent.payment_failed", { object: "payment_intent", id: cancelSession.payment_intent, livemode: false, metadata: cancelSession.metadata, amount: cancelSession.amount_total, currency: "eur" }));
assert.equal((await readTestOrder(db, cancelBody.checkoutRequestId, token)).paymentStatus, "payment_failed");
cancelSession.status = "expired";
await handleTestStripeEvent(db, fakeStripe, event("checkout.session.expired", cancelSession));
assert.equal((await readTestOrder(db, cancelBody.checkoutRequestId, token)).paymentStatus, "cancelled");
await assert.rejects(() => handleTestStripeEvent(db, fakeStripe, event("checkout.session.completed", { ...session, metadata: { isTestOrder: "true", orderId: crypto.randomUUID() } })), /test_order_missing/);
const sdk = new Stripe("sk_test_fixture");
const raw = JSON.stringify(completed);
const signature = sdk.webhooks.generateTestHeaderString({ payload: raw, secret: "whsec_fixture" });
assert.equal(sdk.webhooks.constructEvent(raw, signature, "whsec_fixture").id, completed.id);
assert.throws(() => sdk.webhooks.constructEvent(raw + " ", signature, "whsec_fixture"));
assert.throws(() => sdk.webhooks.constructEvent(raw, "", "whsec_fixture"));
assert.throws(() => sdk.webhooks.constructEvent(raw, signature, "whsec_wrong"));
assert.equal((await db.collection("products").doc(productId).get()).data()?.stock, 100);
// A synthetic coupon exercises the same server promotion engine without consuming it.
const couponCode = `TEST${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const couponRef = db.collection("coupons").doc(couponCode.toLowerCase());
try {
  await couponRef.set({ code: couponCode, label: "Remise fictive test", discountType: "percent", discountValue: 10,
    minimumOrder: 0, usedCount: 0, isActive: true, isArchived: false, autoApply: false });
  const discounted = await createTestCheckout(db, fakeStripe, { ...body, checkoutRequestId: crypto.randomUUID(), couponCode }, token);
  const discountedOrder = (await db.collection("stripeTestOrders").doc(discounted.orderId).get()).data()!;
  assert.equal(discountedOrder.priced.discountAmount, 3);
  assert.equal(discountedOrder.amountCents, 3249);
  assert.equal((await couponRef.get()).data()?.usedCount, 0);
  await assert.rejects(() => createTestCheckout(db, fakeStripe, { ...body, checkoutRequestId: crypto.randomUUID(), preferredPaymentMethod: "cash_on_delivery", deliveryMethod: "local_express" }, token), /test_card_required/);
} finally { await couponRef.delete(); }
const after = await Promise.all(protectedCollections.map(async (name) => JSON.stringify((await db.collection(name).get()).docs.map((d) => [d.id, d.data()]))));
assert.deepEqual(after, before, "no stock, invoice, notification, coupon or normal order mutations");
console.log("Stripe emulator checks passed: concurrent checkout, server amount, conflicts, access token, missing order, missing/invalid signature, signed replay, distinct duplicate event, late failure, cancel, refresh, isolated side effects, live guards.");
} finally {
  await db.collection("products").doc(productId).delete();
  await db.terminate();
}
