import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStripeTestDb, getStripeTestClient } from "../api/_server/stripeTestConfig.js";

// Explicit local-only checks. Real Stripe is used only by the opt-in replay command.
process.env.STRIPE_TEST_ENABLED = "true";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
process.env.STRIPE_TEST_SECRET_KEY ||= "sk_test_fixture";
const db = getStripeTestDb();
const [mode, directory, label = "check"] = process.argv.slice(2);
if (!directory) throw new Error("A local evidence directory is required");
const baselinePath = resolve(directory, "protected-collections.json");
const collections = ["products", "deliveryZones", "orders", "invoices", "stockMovements", "orderSideEffects", "counters", "coupons", "contestPrizes", "emails", "notifications", "customers", "mail", "orderAlerts"];
async function snapshot() {
  return Object.fromEntries(await Promise.all(collections.map(async (name) => {
    const docs = (await db.collection(name).get()).docs.map((doc) => [doc.id, doc.data()]);
    return [name, { count: docs.length, sha256: crypto.createHash("sha256").update(JSON.stringify(docs)).digest("hex") }];
  })));
}
async function unchanged(scenario: string) {
  const current = await snapshot();
  assert.deepEqual(current, JSON.parse(readFileSync(baselinePath, "utf8")), "Protected emulator collections changed");
  writeFileSync(resolve(directory, `evidence-${scenario}.json`), JSON.stringify({ scenario, time: new Date().toISOString(), unchanged: true, collections: current }, null, 2));
  console.log(`PASS ${scenario}: protected emulator collections unchanged; demo project only`);
}
async function post(route: string, body: unknown, token?: string) {
  const response = await fetch(`http://127.0.0.1:5195/api/stripe-test/${route}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-test-order-token": token } : {}) }, body: JSON.stringify(body) });
  return { code: response.status, data: await response.json() };
}
try {
  if (mode === "baseline") {
    writeFileSync(baselinePath, JSON.stringify(await snapshot(), null, 2));
    console.log("Protected collection baseline saved (emulator only)");
  } else if (mode === "check") await unchanged(label);
  else if (mode === "http") {
    const items = [{ productId: "resin-golden-static", quantity: 3, unitPrice: 0.01 }];
    const customer = { firstName: "Client", lastName: "Test", phone: "0600000000", email: "checkout-test@example.invalid", address: { firstName: "Client", lastName: "Test", line1: "1 rue du Test", postalCode: "75001", city: "Paris", country: "France" } };
    const quote = await post("quote", { items, deliveryMethod: "postal", total: 0.01 });
    assert.equal(quote.code, 200); assert.equal(quote.data.total, 21.99);
    await unchanged("I-J-grammes-colissimo");
    const localAddress = { ...customer.address, line1: "1 rue du Test local", postalCode: "13100", city: "Aix-en-Provence", latitude: 43.529649, longitude: 5.447913, verificationProvider: "geoplateforme_ban", verifiedAt: new Date().toISOString() };
    const fixed = await post("quote", { items: [{ productId: "flower-cookie-kush-indoor", quantity: 1, purchaseMode: "fixed_price", fixedPriceOptionId: "fixed-30-7g", totalPrice: 0.01 }], deliveryMethod: "local_express", deliveryZone: "local-aix-radius-15km", address: localAddress });
    assert.equal(fixed.code, 200); assert.equal(fixed.data.total, 30); assert.equal(fixed.data.deliveryFee, 0);
    await unchanged("H-K-format-local");
    const token = crypto.randomBytes(32).toString("hex");
    const input = { items, customer, deliveryMethod: "postal", complianceAccepted: true, checkoutRequestId: crypto.randomUUID(), total: 0.01, paymentStatus: "paid", isTestOrder: false };
    const [a, b] = await Promise.all([post("checkout", input, token), post("checkout", input, token)]);
    assert.equal(a.code, 200); assert.deepEqual(a.data, b.data); assert.match(a.data.url, /^https:\/\/checkout.stripe.com\/c\/pay\/cs_test_/);
    const status = await post("status", { orderId: input.checkoutRequestId }, token);
    assert.equal(status.data.amountCents, 2199); assert.equal(status.data.paymentStatus, "payment_pending");
    const order = (await db.collection("stripeTestOrders").doc(input.checkoutRequestId).get()).data()!;
    assert.equal(order.isTestOrder, true); assert.ok(order.sessionId.startsWith("cs_test_"));
    await unchanged("F-double-clic"); await unchanged("G-montant-manipule"); await unchanged("L-webhook-absent");
    assert.equal((await post("checkout", { ...input, items: [{ ...items[0], quantity: 4 }] }, token)).code, 409);
    assert.equal((await post("status", { orderId: crypto.randomUUID() }, token)).code, 404);
    assert.equal((await post("status", { orderId: input.checkoutRequestId }, "invalid")).code, 404);
    await unchanged("M-commande-invalide");
    const resume = await post("resume", { orderId: input.checkoutRequestId }, token);
    assert.equal(resume.data.url, a.data.url);
    await post("cancel", { orderId: input.checkoutRequestId }, token);
    assert.equal((await post("resume", { orderId: input.checkoutRequestId }, token)).code, 400);
    for (const path of ["create-order", "quote-order"]) assert.equal((await fetch(`http://127.0.0.1:5195/api/${path}`, { method: "POST" })).status, 404);
    const foreign = await fetch("http://127.0.0.1:5195/api/stripe-test/catalog", { headers: { Origin: "https://verdanza.fr" } });
    assert.equal(foreign.status, 403);
    assert.equal((await post("webhook", {})).code, 400);
    await unchanged("HTTP-guards-cancel-resume");
    console.log("PASS local HTTP: server prices, fixed/grams, local/postal, concurrency, tampering, tokens, missing orders, signed webhook required, origin and production route rejection");
  } else if (mode === "replay") {
    if (!process.env.STRIPE_TEST_SECRET_DIRECTORY) throw new Error("Explicit private key directory required for real TEST replay");
    process.env.STRIPE_TEST_SECRET_KEY = readFileSync(resolve(process.env.STRIPE_TEST_SECRET_DIRECTORY, "stripe-test.key"), "utf8").trim();
    const secret = readFileSync(resolve(process.env.STRIPE_TEST_SECRET_DIRECTORY, "webhook-test.key"), "utf8").trim();
    const stripe = getStripeTestClient();
    const events = await stripe.events.list({ type: "checkout.session.completed", limit: 30 });
    const event = events.data.find((entry) => (entry.data.object as { metadata?: { orderId?: string } }).metadata?.orderId === label);
    assert.ok(event); assert.equal(event.livemode, false);
    const raw = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload: raw, secret });
    for (let i = 0; i < 2; i++) {
      const response = await fetch("http://127.0.0.1:5195/api/stripe-test/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: raw });
      assert.equal(response.status, 200);
    }
    const order = (await db.collection("stripeTestOrders").doc(label).get()).data()!;
    assert.equal(order.paymentStatus, "paid"); assert.equal(order.paidTransitions, 1);
    await unchanged("E-double-webhook");
    console.log(JSON.stringify({ orderId: label, eventId: event.id, paymentStatus: order.paymentStatus, paidTransitions: order.paidTransitions }));
  } else throw new Error("Unknown evidence command");
} finally { await db.terminate(); }
