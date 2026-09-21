import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import Stripe from "stripe";
import { createStripeTestHttp } from "../api/_server/stripeTestHttp.js";
import { createStripeTestFixtureDb } from "./stripeTestFixtures.js";
import { deliveryZones } from "../src/data/deliveryZones.js";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:18087";
process.env.STRIPE_TEST_WEBHOOK_SECRET = "whsec_fixture";
const db = createStripeTestFixtureDb();
const sdk = new Stripe("sk_test_fixture");
const sessions = new Map<string, Stripe.Checkout.Session>();
let creations = 0;
const stripe = {
  webhooks: sdk.webhooks,
  checkout: { sessions: {
    create: async (params: Stripe.Checkout.SessionCreateParams, options: { idempotencyKey: string }) => {
      let session = sessions.get(options.idempotencyKey);
      if (!session) {
        creations++;
        session = { id: `cs_test_${params.client_reference_id}`, object: "checkout.session", mode: "payment",
          livemode: false, status: "open", payment_status: "unpaid", currency: "eur", metadata: params.metadata,
          client_reference_id: params.client_reference_id, payment_intent: `pi_${params.client_reference_id}`,
          amount_total: params.line_items!.reduce((sum, item) => sum + item.price_data!.unit_amount! * item.quantity!, 0),
          url: "https://checkout.stripe.com/c/pay/cs_test_fixture" } as Stripe.Checkout.Session;
        sessions.set(options.idempotencyKey, session);
      }
      return session;
    },
    retrieve: async (id: string) => {
      const session = [...sessions.values()].find((entry) => entry.id === id);
      assert.ok(session);
      return session;
    },
    expire: async (id: string) => {
      const session = [...sessions.values()].find((entry) => entry.id === id);
      assert.ok(session); session.status = "expired"; return session;
    },
  } },
} as unknown as Stripe;
const handle = createStripeTestHttp({ getDb: () => db, getStripe: () => stripe });
async function request(route: string, body?: unknown, headers: Record<string, string> = {}, raw?: string) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(raw ?? JSON.stringify(body))]) as IncomingMessage;
  req.url = `/api/stripe-test/${route}`;
  req.method = body === undefined ? "GET" : "POST";
  req.headers = { host: "127.0.0.1:5195", ...headers };
  let code = 0; let text = "";
  const res = { writeHead: (value: number) => { code = value; }, end: (value: string) => { text = value; } } as unknown as ServerResponse;
  await handle(req, res);
  return { code, data: JSON.parse(text) };
}
const id = crypto.randomUUID();
const gramId = `http-gram-${id}`; const fixedId = `http-fixed-${id}`;
const refs = [db.collection("products").doc(gramId), db.collection("products").doc(fixedId)];
await refs[0].set({ name: "Golden Static fixture", price: 5.5, stock: 100, category: "resins", isActive: true, fixedPriceMode: "disabled" });
await refs[1].set({ name: "Cookie Kush Indoor fixture", price: 5, stock: 100, category: "flowers", isActive: true, fixedPriceMode: "manual",
  fixedPriceOptions: [{ id: "fixed-30-7g", quantityGrams: 7, totalPrice: 30, isActive: true, source: "manual", sortOrder: 1 }] });
const zone = deliveryZones.find((entry) => entry.id === "local-aix-radius-15km")!;
assert.ok(zone);
const zoneRef = db.collection("deliveryZones").doc(zone.id);
await zoneRef.set({ ...zone, isActive: true, isOpen: true, status: "open" });
async function protectedSnapshot() {
  const collections = (await db.listCollections()).filter((ref) => !["stripeTestOrders", "stripeTestEvents"].includes(ref.id));
  return Object.fromEntries(await Promise.all(collections.map(async (ref) => [ref.id, (await ref.get()).docs.map((doc) => [doc.id, doc.data()])])));
}
const before = await protectedSnapshot();
try {
  const customer = { firstName: "Client", lastName: "Test", email: "checkout-test@example.invalid", phone: "0600000000",
    address: { line1: "1 rue du Test", postalCode: "75001", city: "Paris", country: "FR" } };
  const body = { checkoutRequestId: id, items: [{ productId: gramId, quantity: 3, unitPrice: 0.01 }], customer,
    deliveryMethod: "postal", complianceAccepted: true, total: 0.01, paymentStatus: "paid" };
  const quote = await request("quote", body);
  assert.equal(quote.code, 200); assert.equal(quote.data.total, 21.99); assert.equal(quote.data.deliveryFee, 5.49);
  const local = await request("quote", { items: [{ productId: fixedId, quantity: 1, purchaseMode: "fixed_price", fixedPriceOptionId: "fixed-30-7g", totalPrice: 0.01 }],
    deliveryMethod: "local_express", deliveryZone: zone.id, address: { line1: "1 rue du Test local", postalCode: "13100", city: "Aix-en-Provence", country: "FR",
      latitude: 43.529649, longitude: 5.447913, verificationProvider: "geoplateforme_ban", verifiedAt: new Date().toISOString() } });
  assert.equal(local.code, 200); assert.equal(local.data.total, 30); assert.equal(local.data.deliveryFee, 0);
  assert.equal((await request("quote", { ...body, cagnotteUse: { requestedCents: 100 } })).code, 400);
  const headers = { "x-test-order-token": crypto.randomBytes(32).toString("hex") };
  const [first, second] = await Promise.all([request("checkout", body, headers), request("checkout", body, headers)]);
  assert.equal(first.code, 200); assert.deepEqual(first, second); assert.equal(creations, 1);
  const pending = await request("status", { orderId: id }, headers);
  assert.equal(pending.data.paymentStatus, "payment_pending"); assert.equal(pending.data.amountCents, 2199);
  assert.equal((await request("status", { orderId: id })).code, 404);
  assert.equal((await request("checkout", { ...body, items: [{ productId: gramId, quantity: 4 }] }, headers)).code, 409);
  assert.equal((await request("catalog", undefined, { origin: "https://verdanza.fr" })).code, 403);
  assert.equal((await request("catalog", undefined, { host: "verdanza.fr" })).code, 403);
  assert.equal((await request("webhook", {})).code, 400);
  const session = [...sessions.values()][0];
  session.status = "complete"; session.payment_status = "paid";
  const event = { id: `evt_${id}`, type: "checkout.session.completed", livemode: false, data: { object: session } };
  const raw = JSON.stringify(event);
  const signature = sdk.webhooks.generateTestHeaderString({ payload: raw, secret: "whsec_fixture" });
  assert.equal((await request("webhook", event, { "stripe-signature": signature }, raw + " ")).code, 400);
  const accepted = await request("webhook", event, { "stripe-signature": signature }, raw);
  assert.equal(accepted.code, 200); assert.equal(accepted.data.processed, true);
  assert.equal((await request("webhook", event, { "stripe-signature": signature }, raw)).data.duplicate, true);
  const paid = await request("status", { orderId: id }, headers);
  assert.equal(paid.data.paymentStatus, "paid"); assert.equal(paid.data.paidTransitions, 1);
  assert.deepEqual(await request("status", { orderId: id }, headers), paid);
  assert.equal((await request("resume", { orderId: id }, headers)).code, 400);
  const cancelId = crypto.randomUUID();
  assert.equal((await request("checkout", { ...body, checkoutRequestId: cancelId }, headers)).code, 200);
  assert.equal((await request("resume", { orderId: cancelId }, headers)).code, 200);
  assert.equal((await request("cancel", { orderId: cancelId }, headers)).code, 200);
  assert.equal((await request("resume", { orderId: cancelId }, headers)).code, 400);
  assert.deepEqual(await protectedSnapshot(), before);
  console.log("PASS offline HTTP: 21.99 EUR postal, 30 EUR fixed/local, signature rejection/acceptance, duplicate webhook, pending/paid, refresh, cancel/resume, amount tampering, tokens, origins, no business side effects.");
} finally {
  await Promise.all(refs.map((ref) => ref.delete())); await zoneRef.delete(); await db.terminate();
}
