import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { aixRadiusDeliveryZone } from "../src/data/deliveryZones.js";
import { connectCagnotteEmulator, CAGNOTTE_DEMO } from "./cagnotteEmulator.js";
import { commitCheckoutOrder, createOrderHandler } from "../api/create-order.js";
import { createQuoteOrderHandler } from "../api/quote-order.js";
import { FirebaseIdTokenVerificationError } from "../api/_server/adminAuth.js";
import { parseCheckoutBody, priceCheckout } from "../api/_server/checkout.js";
import { checkoutPayloadFingerprint } from "../api/_server/orderSideEffects.js";
import { allocateReferralDiscount, prepareReferralCheckout, readReferralCheckoutContext } from "../api/_server/referralCheckout.js";
import { parseReferralEmailKeyring, referralEmailClaimId } from "../api/_server/referralIdentity.js";
import { REFERRAL_CLOSED_RUNTIME, ReferralConfigurationError } from "../api/_server/referralRuntimeConfig.js";
import { prepareReferralCheckoutReservationRelease } from "../api/_server/referralLedger.js";
import { linkReferral } from "../api/_server/referralService.js";
import type { Order } from "../src/types/index.js";
import { referralRelationIdentityHistoryStatus, ORDER_EMAIL_NORMALIZATION_VERSION } from "../api/_server/referralOrderEmailHistory.js";
import { commitOrderStatusTransition } from "../api/_server/orderStatusTransition.js";
import { executeOrderRefund } from "../api/_server/orderRefunds.js";
import { buildCagnotteOrderEnrollment } from "../api/_server/cagnotteOrders.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import type { CagnotteTestProgram } from "../api/_server/cagnotteLedgerTypes.js";
import type { ReferralRelation } from "../src/types/referral.js";
import type { ReferralCheckoutQuote } from "../src/types/referralCheckout.js";
import { buildAccountingSummary } from "../src/lib/accountingSummary.js";
import { buildGa4PurchasePayload } from "../api/_server/ga4MeasurementProtocol.js";
import { customAccountingPeriodRange } from "../src/lib/accountingPeriods.js";
import { adminOrderRow } from "../src/services/ordersService.js";

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const program = { mode: "active" as const, startsAtEpochMs: 1000, operational: true };
const loyalty: CagnotteTestProgram = { mode: "local_test", programVersion: "referral-checkout-test-v1", calculationVersion: "cagnotte-math-v1", startsAtEpochMs: 1000, newAccrualsEnabled: true };
const secret = "only-local-test-key-material-32-bytes-minimum";
const keyring = JSON.stringify({ activeVersion: "v1", keys: { v1: secret } });
const uid = "checkout-referee";
const actor = { uid: "checkout-admin", email: "admin@example.test" };
const identity = async (id: string) => ({ uid: id, email: `${id}@example.test`, emailVerified: true, disabled: false });
const collections = ["orders", "referralCodes", "products", "coupons", "deliveryZones", "referrals", "referralEmailClaims", "referralPaymentIdentities", "referralMigrations", "cagnotteWallets", "cagnotteMovements", "cagnotteAccruals", "cagnotteRefunds", "orderRefunds", "checkoutRequests", "orderSideEffects", "stockMovements", "productCosts", "analyticsOutbox", "adminUsers"];
let passed = 0;
const transactionDepth = new AsyncLocalStorage<number>();
async function test(name: string, run: () => Promise<void> | void) { await seed(); await run(); console.log(`OK ${++passed} - ${name}`); }
async function capture() {
  return Promise.all(collections.map(async name => [name, (await db.collection(name).get()).docs.map(doc => ({ id: doc.id, value: doc.data(), time: doc.updateTime?.toMillis() }))]));
}
async function settlement() { return (await capture()).filter(([name]) => ["referrals", "referralEmailClaims", "referralPaymentIdentities", "cagnotteWallets", "cagnotteMovements", "cagnotteAccruals", "cagnotteRefunds", "orderRefunds"].includes(String(name))); }
async function seed(cents = 5000) {
  for (const name of collections) for (const doc of (await db.collection(name).get()).docs) await doc.ref.delete();
  await db.collection("products").doc("main").set({ name: "Synthetic", slug: "main", price: cents / 100, stock: 1000, isActive: true, category: "flowers", cultureType: "indoor" });
  await db.collection("referrals").doc(uid).set({ schemaVersion: 1, programVersion: "referral-commercial-policy-v1", refereeUid: uid, sponsorUid: "checkout-sponsor",
    state: "linked", createdAtEpochMs: 2000, linkedAtEpochMs: 2000, qualifyingOrderId: null, deliveredOrderId: null, paymentConfirmed: false,
    deliveryConfirmed: false, rewardCompartment: "none", cumulativeReturnedProductsCents: 0, processedRefunds: {} } satisfies ReferralRelation);
  await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, `${uid}@example.test`)).set({ schemaVersion: 1, programVersion: "referral-commercial-policy-v1", keyVersion: "v1", refereeUid: uid, referralId: uid, createdAtEpochMs: 2000 });
  await db.collection("referralMigrations").doc(ORDER_EMAIL_NORMALIZATION_VERSION).set({ schemaVersion: 1, version: ORDER_EMAIL_NORMALIZATION_VERSION, status: "complete", completedAtEpochMs: 3000,
    verifiedOrders: 0, verifiedPaidProductOrders: 0, verifiedReferralRelations: 1, verifiedUnresolvedIdentityRelations: 0, verifiedLinkedRelationsWithPaidHistory: 0,
    verifiedPaymentIdentityEvidence: 0, verifiedDetachedPaymentIdentityEvidence: 0, verifiedMissingPaymentIdentityEvidence: 0, verifiedUnresolvedPaymentIdentityEvidence: 0, verifiedCorruptPaymentIdentityEvidence: 0 });
  await db.collection("adminUsers").doc(actor.uid).set({ isActive: true });
}
const address = { firstName: "Test", lastName: "Client", line1: "1 rue Test", postalCode: "75001", city: "Paris", country: "FR" };
function body() { return { items: [{ productId: "main", quantity: 1 }], deliveryMethod: "postal" as "postal" | "local_express", authToken: uid, email: "checkout-different@example.test", address,
  checkoutRequestId: randomUUID(), complianceAccepted: true, preferredPaymentMethod: "card_payment_link" as const,
  customer: { firstName: "Test", lastName: "Client", phone: "0600000000", email: "checkout-different@example.test", address },
  referralUse: { requested: true as const }, cagnotteUse: { requestedCents: 0 } }; }
function checkedDb(abort = false) {
  return new Proxy(db, { get(target, key) {
    if (key === "runTransaction") return (callback: (tx: Transaction) => Promise<unknown>) => target.runTransaction(async tx => transactionDepth.run(1, async () => {
      let wrote = false;
      const checked = new Proxy(tx, { get(current, method) {
        const value = Reflect.get(current, method);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (["get", "getAll"].includes(String(method))) equal(wrote, false, "read before write");
          if (["set", "update", "create", "delete"].includes(String(method))) wrote = true;
          return Reflect.apply(value, current, args);
        };
      } });
      const value = await callback(checked); if (abort && wrote) throw new Error("injected abort"); return value;
    }));
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }) as Firestore;
}
function deps(overrides: Partial<Parameters<typeof createOrderHandler>[0]> = {}): Parameters<typeof createOrderHandler>[0] {
  return { getDb: () => checkedDb(), verifyToken: async (token: string) => { equal(transactionDepth.getStore() ?? 0, 0); return { uid: token, email: `${token}@example.test`, emailVerified: true }; },
    accrualProgram: loyalty, reservationProgram: null, now: () => 10000,
    referralRuntime: () => program, referralIdentity: async (id: string) => { equal(transactionDepth.getStore() ?? 0, 0); return identity(id); },
    referralKeyring: () => { equal(transactionDepth.getStore() ?? 0, 0); return keyring; },
    enforceRateLimit: async () => ({ allowed: true, code: "allowed", retryAfterSeconds: 0 }),
    processSideEffects: async () => { equal(transactionDepth.getStore() ?? 0, 0); return { client: { status: "skipped" as const, reason: "fixture" }, admin: { status: "skipped" as const, reason: "fixture" } }; }, ...overrides };
}
async function invoke(handler: ReturnType<typeof createOrderHandler>, request: unknown) {
  let status = 0; let result: unknown; const headers = new Map<string, unknown>();
  const response = { setHeader(name: string, value: unknown) { headers.set(name, value); }, status(value: number) { status = value; return this; }, json(value: unknown) { result = value; } };
  await handler({ method: "POST", headers: {}, body: request } as VercelRequestLike, response as unknown as VercelResponseLike);
  return { status, data: result as Record<string, unknown>, headers };
}
const quote = (request: unknown = body(), overrides: Partial<Parameters<typeof createOrderHandler>[0]> = {}) => invoke(createQuoteOrderHandler(deps(overrides)), request);
const create = (request: unknown, overrides: Partial<Parameters<typeof createOrderHandler>[0]> = {}) => invoke(createOrderHandler(deps(overrides)), request);
function accepted(request: ReturnType<typeof body>, q: ReferralCheckoutQuote) {
  ok(q.applied);
  return { ...request, referralUse: { requested: true as const, acceptance: { quoteVersion: q.quoteVersion, quoteFingerprint: q.quoteFingerprint,
    acceptedReferralDiscountCents: q.referralDiscountCents, acceptedPayableCents: q.payableCents } } };
}
async function proposal(request = body()) { const q = await quote(request); equal(q.status, 200); return q.data.referralUse as ReferralCheckoutQuote; }

await test("postal quote is pure, shipping policy unchanged, loyalty 225", async () => {
  const before = await capture(); const q = await quote(); equal(q.status, 200); const r = q.data.referralUse as ReferralCheckoutQuote; ok(r.applied);
  deepStrictEqual([r.productsBeforeReferralCents, r.referralDiscountCents, r.productsAfterReferralCents, r.deliveryCents, r.payableCents, r.loyaltyEstimateCents], [5000, 500, 4500, 0, 4500, 225]);
  equal(q.headers.get("Cache-Control"), "private, no-store"); equal(q.headers.get("Vary"), "Authorization");
  ok(!JSON.stringify(q.data).includes("sponsor")); ok(!JSON.stringify(q.data).includes(uid)); deepStrictEqual(await capture(), before);
});
await test("canonical charged delivery: 5000 -> 4500 + 549 = 5049, loyalty 225", async () => {
  await db.collection("deliveryZones").doc(aixRadiusDeliveryZone.id).set({ ...aixRadiusDeliveryZone, isActive: true, isOpen: true, status: "open", fee: 5.49 });
  const localAddress = { ...address, postalCode: "13100", city: "Aix-en-Provence", latitude: 43.529649, longitude: 5.447913,
    verifiedAt: "2026-09-27T00:00:00.000Z", verificationProvider: "geoplateforme_ban" as const };
  const request = { ...body(), deliveryMethod: "local_express" as const, deliveryZone: aixRadiusDeliveryZone.id, address: localAddress, customer: { ...body().customer, address: localAddress } };
  const q = await proposal(request); ok(q.applied); deepStrictEqual([q.productsAfterReferralCents, q.deliveryCents, q.payableCents, q.loyaltyEstimateCents], [4500, 549, 5049, 225]);
  const c = await create(accepted(request, q)); equal(c.status, 200); const order = (await db.collection("orders").doc(String(c.data.orderId)).get()).data()!;
  equal(order.total, 50.49); equal(order.deliveryFee, 5.49); equal(order.cagnotte.snapshot.productsPaidCents, 4500);
  await transition({ orderId: String(c.data.orderId), paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const paid = { ...(await db.collection("orders").doc(String(c.data.orderId)).get()).data(), id: String(c.data.orderId) } as Order;
  const row = adminOrderRow(paid); deepStrictEqual(row.referral, paid.referral); equal(row.subtotalAfterPromotion, 50);
  const accounting = buildAccountingSummary([row], [], new Map(), [], new Map(), customAccountingPeriodRange("2000-01-02", "2000-01-04"));
  deepStrictEqual([accounting.collectedRevenue, accounting.productNetRevenue, accounting.deliveryRevenue, accounting.discounts], [50.49, 45, 5.49, 5]);
  equal(accounting.productRows.reduce((sum, item) => sum + item.productNetRevenue, 0), 45);
});
for (const cents of [4999, 5000, 5001]) await test(`threshold ${cents}`, async () => { await seed(cents); equal((await proposal()).applied, cents >= 5000); });
await test("positive cagnotte explicitly requires a new quote; zero compatible", async () => {
  const request = { ...body(), cagnotteUse: { requestedCents: 1 } }; const before = await capture();
  const result = await quote(request); equal(result.status, 409); equal(result.data.code, "REFERRAL_CAGNOTTE_CONFLICT");
  const creation = await create(request); equal(creation.status, 409); equal(creation.data.code, "REFERRAL_CAGNOTTE_CONFLICT"); deepStrictEqual(await capture(), before);
});
await test("acceptance mandatory and monetary/fingerprint forgery refused", async () => {
  equal((await create(body())).data.code, "REFERRAL_ACCEPTANCE_REQUIRED");
  const request = body(); const b = accepted(request, await proposal(request));
  for (const mutation of [{ quoteFingerprint: "0".repeat(64) }, { acceptedPayableCents: 1 }, { acceptedReferralDiscountCents: 1 }, { quoteVersion: "old" }]) {
    const before = await capture(); const r = await create({ ...b, referralUse: { ...b.referralUse, acceptance: { ...b.referralUse.acceptance, ...mutation } } });
    ok(r.status === 400 || r.status === 409); deepStrictEqual(await capture(), before);
  }
});
await test("minimal parser rejects embedded sponsor/snapshot/money fields", async () => {
  for (const field of ["referralId", "sponsorUid", "snapshot", "amountCents", "lines"]) {
    const result = await quote({ ...body(), referralUse: { requested: true, [field]: "forged" } }); equal(result.status, 400);
  }
  const request = body(); const b = accepted(request, await proposal(request));
  const r = await create({ ...b, referral: { referralId: "attacker", refereeDiscountCents: 999999 }, sponsorUid: "attacker", discountAmount: 999999 });
  equal(r.status, 200); const stored = (await db.collection("orders").doc(String(r.data.orderId)).get()).data()!;
  equal(stored.referral.referralId, uid); equal(stored.referral.refereeDiscountCents, 500); equal(stored.discountAmount, 5); equal(stored.promotionDiscountTotal, 0);
});
for (const mode of ["off", "drain", "malformed"] as const) await test(`${mode} requested closes before business/Auth/keyring; exact replay lookup allowed; absent request unchanged`, async () => {
  const runtime = () => { if (mode === "malformed") throw new ReferralConfigurationError(); return mode === "off" ? REFERRAL_CLOSED_RUNTIME : { ...program, mode: "drain" as const }; };
  const fail = () => { throw new Error("must not run"); };
  const closed = { referralRuntime: runtime, getDb: fail, verifyToken: async () => fail(), referralIdentity: async () => fail(), referralKeyring: fail };
  equal((await quote(body(), closed)).status, 503);
  const technicalOnlyDb = new Proxy(db, { get(target, property) {
    if (property === "collection") return (name: string) => { equal(name, "checkoutRequests"); return target.collection(name); };
    throw new Error("closed creation must only look for an existing request");
  } }) as Firestore;
  equal((await create(body(), { ...closed, getDb: () => technicalOnlyDb })).status, 503);
  const request = { ...body(), referralUse: undefined };
  const unchanged = { referralRuntime: fail, referralIdentity: async () => fail(), referralKeyring: fail };
  const normal = await quote(request, unchanged); equal(normal.status, 200); equal(normal.data.referralUse, undefined);
  const creation = await create(request, unchanged); equal(creation.status, 200);
  equal((await db.collection("orders").doc(String(creation.data.orderId)).get()).data()?.referral, undefined);
});
await test("auth/current verified identity/keyring/claim failures close", async () => {
  equal((await quote({ ...body(), authToken: undefined })).status, 401);
  equal((await quote(body(), { verifyToken: async () => ({ uid, email: `${uid}@example.test`, emailVerified: false }) })).status, 401);
  for (const overrides of [{ referralKeyring: () => "{}" }, { referralIdentity: async () => ({ ...(await identity(uid)), disabled: true }) },
    { referralIdentity: async () => { throw new Error("unavailable"); } }]) ok((await quote(body(), overrides)).status >= 400);
  const ref = db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, `${uid}@example.test`));
  await ref.update({ refereeUid: "other", referralId: "other" }); equal((await quote()).data.code, "referral_email_claimed");
  await ref.delete(); equal((await quote()).data.code, "referral_identity_unavailable");
});
await test("old key alias protects current identity without lazy-migration writes", async () => {
  const before = await capture(); const rotated = JSON.stringify({ activeVersion: "v2", keys: { ...parseReferralEmailKeyring(keyring).keys, v2: "second-only-local-test-secret-material-32-bytes" } });
  equal((await quote(body(), { referralKeyring: () => rotated })).status, 200); deepStrictEqual(await capture(), before);
});
for (const kind of ["order", "claimed", "protected_by_existing_claim", "unresolved", "corrupt", "marker_absent", "marker_incomplete"] as const) await test(`qualified history authority: ${kind}`, async () => {
  if (kind === "order") await db.collection("orders").doc("old").set({ customerId: uid, customerEmail: `${uid}@example.test`, customerEmailNormalized: `${uid}@example.test`, paymentStatus: "paid", total: 50, items: [{ productId: "main", quantity: 1 }] });
  else if (kind.startsWith("marker")) {
    const ref = db.collection("referralMigrations").doc(ORDER_EMAIL_NORMALIZATION_VERSION);
    if (kind === "marker_absent") await ref.delete(); else await ref.update({ status: "incomplete" });
  } else await db.collection("referralPaymentIdentities").doc("deleted-order").set({ schemaVersion: kind === "corrupt" ? 99 : 1, version: "referral-payment-identity-v1", orderId: "deleted-order", customerUid: uid, recordedAtEpochMs: 4000,
    ...(kind === "unresolved" ? { status: kind, reason: "runtime_closed" } : { status: kind === "corrupt" ? "claimed" : kind, claimId: "a".repeat(64), keyVersion: "v1" }) });
  if (kind === "claimed") {
    await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, `${uid}@example.test`)).delete();
    await db.collection("referralMigrations").doc(ORDER_EMAIL_NORMALIZATION_VERSION).delete();
  }
  const q = await quote();
  if (["marker_absent", "marker_incomplete", "corrupt"].includes(kind)) { equal(q.status, 409); equal(q.data.code, "referral_history_inconclusive"); }
  else { equal(q.status, 200); equal((q.data.referralUse as ReferralCheckoutQuote).applied, false); }
});
for (const mutation of ["price", "stock", "promotion", "relation", "history", "marker", "cart", "delivery"] as const) await test(`accepted quote changes ${mutation}: conflict without writes`, async () => {
  const request = body(); const b = accepted(request, await proposal(request));
  if (mutation === "price") await db.collection("products").doc("main").update({ price: 50.01 });
  if (mutation === "stock") await db.collection("products").doc("main").update({ stock: 999 });
  if (mutation === "promotion") { await db.collection("coupons").doc("code").set({ code: "PROMO", isActive: true, minimumOrder: 0, discountType: "fixed", discountValue: 1 }); Object.assign(b, { couponCode: "PROMO" }); }
  if (mutation === "relation") await db.collection("referrals").doc(uid).update({ linkedAtEpochMs: 2001 });
  if (mutation === "history") await db.collection("referralPaymentIdentities").doc("prior").set({ schemaVersion: 1, version: "referral-payment-identity-v1", orderId: "prior", customerUid: uid, recordedAtEpochMs: 9999, status: "unresolved", reason: "runtime_closed" });
  if (mutation === "marker") await db.collection("referralMigrations").doc(ORDER_EMAIL_NORMALIZATION_VERSION).update({ status: "incomplete" });
  if (mutation === "cart") b.items[0].quantity = 2;
  if (mutation === "delivery") b.customer.address = { ...address, postalCode: "69001", city: "Lyon" };
  const before = await capture(); const result = await create(b); equal(result.status, 409); equal(result.data.code, "REFERRAL_QUOTE_CONFLICT"); deepStrictEqual(await capture(), before);
});
for (const kind of ["code", "contest", "automatic", "gift", "free_shipping"] as const) await test(`priority ${kind} wins over referral`, async () => {
  const request = parseCheckoutBody(body()); const priced = await priceCheckout(db, request);
  if (kind === "code" || kind === "free_shipping") { priced.couponCode = "PRIORITY"; priced.promoApplied = true; }
  if (kind === "contest") priced.contestPrizeId = "prize";
  if (kind === "automatic") priced.promoApplied = true;
  if (kind === "gift") priced.orderItems.push({ ...priced.orderItems[0], productId: "gift", isGift: true, lineTotal: 0 });
  const context = (await readReferralCheckoutContext(request, deps(), deps().verifyToken, 10000))!;
  const before = await capture(); const result = await db.runTransaction(tx => prepareReferralCheckout({ db, transaction: tx, body: request, priced, context, nowEpochMs: 10000, accrualProgram: loyalty }));
  equal(result.quote.applied, false); equal(result.quote.reason, "priority_advantage"); deepStrictEqual(await capture(), before);
});
await test("HTTP free shipping code takes priority and persists a normal order", async () => {
  await db.collection("coupons").doc("free").set({ code: "FREE", isActive: true, usedCount: 0, minimumOrder: 0, discountType: "free_shipping", discountValue: 0 });
  const request = { ...body(), couponCode: "FREE" }; const q = await quote(request); equal(q.status, 200); equal((q.data.referralUse as ReferralCheckoutQuote).applied, false);
  const c = await create(request); equal(c.status, 200); equal((await db.collection("orders").doc(String(c.data.orderId)).get()).data()?.referral, undefined);
});
await test("no relation or below threshold continues normal checkout without acceptance", async () => {
  await db.collection("referrals").doc(uid).delete(); equal((await create(body())).status, 200);
  await seed(4999); const c = await create(body()); equal(c.status, 200); equal((await db.collection("orders").doc(String(c.data.orderId)).get()).data()?.referral, undefined);
});
await test("allocation deterministic under reversal, one-cent line excluded, exact 500", () => {
  const lines = [{ lineId: "z", eligibleBeforeReferralCents: 1 }, { lineId: "b", eligibleBeforeReferralCents: 2499 }, { lineId: "a", eligibleBeforeReferralCents: 2500 }];
  const a = allocateReferralDiscount(lines); deepStrictEqual(a, allocateReferralDiscount([...lines].reverse())); equal(a.reduce((sum, line) => sum + line.referralDiscountCents, 0), 500);
  equal(a.find(line => line.lineId === "z")?.referralDiscountCents, 0); ok(a.every(line => line.referralDiscountCents < line.eligibleBeforeReferralCents));
  throws(() => allocateReferralDiscount([{ lineId: "tiny", eligibleBeforeReferralCents: 1 }]));
});
await test("multi-line checkout, payment and GA4 retain frozen allocations", async () => {
  await db.collection("products").doc("second").set({ name: "Second", slug: "second", price: 25, stock: 100, isActive: true, category: "flowers" });
  await db.collection("products").doc("main").update({ price: 25 });
  const request = { ...body(), items: [{ productId: "main", quantity: 1 }, { productId: "second", quantity: 1 }],
    analyticsContext: { consentGranted: true as const, consentCapturedAt: "2000-01-02T00:00:00.000Z", clientId: "123456789.987654321", sessionId: "1234567890" } };
  const q = await proposal(request); const reverse = await proposal({ ...request, items: [...request.items].reverse() }); deepStrictEqual(q, reverse);
  const r = await create(accepted(request, q)); equal(r.status, 200); const order = (await db.collection("orders").doc(String(r.data.orderId)).get()).data()!;
  equal(order.referral.lines.reduce((sum: number, line: { referralDiscountCents: number }) => sum + line.referralDiscountCents, 0), 500);
  await transition({ orderId: String(r.data.orderId), paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const paid = { ...(await db.collection("orders").doc(String(r.data.orderId)).get()).data(), id: String(r.data.orderId) } as Order;
  const payload = buildGa4PurchasePayload(paid);
  ok(payload, "paid consented checkout order should produce GA4 purchase payload");
  const ga4Items = payload.events[0].params.items;
  equal(ga4Items.length, paid.referral!.lines.length);
  for (const line of paid.referral!.lines) {
    const orderItem = paid.items.find(item => item.lineId === line.lineId);
    ok(orderItem);
    const ga4Item = ga4Items.find(item => item.item_id === (orderItem.slug || orderItem.productId));
    ok(ga4Item);
    equal(Math.round(ga4Item.price * ga4Item.quantity * 100), line.eligibleBeforeReferralCents - line.referralDiscountCents);
    equal(Math.round((ga4Item.discount ?? 0) * ga4Item.quantity * 100), line.referralDiscountCents);
  }
  equal(Math.round(ga4Items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100), Math.round(payload.events[0].params.value * 100));
});
await test("fixed-price format and zero-cent cagnotte produce 4500 net and 225 loyalty", async () => {
  await db.collection("products").doc("main").update({ price: 5.5, fixedPriceMode: "manual", fixedPriceOptions: [{ id: "fixed50", totalPrice: 50, quantityGrams: 10, isActive: true }] });
  const request = { ...body(), items: [{ productId: "main", quantity: 1, purchaseMode: "fixed_price" as const, fixedPriceOptionId: "fixed50" }] };
  const c = await create(accepted(request, await proposal(request))); equal(c.status, 200); const order = (await db.collection("orders").doc(String(c.data.orderId)).get()).data()!;
  equal(order.items[0].purchaseMode, "fixed_price"); equal(order.cagnotte.snapshot.productsPaidCents, 4500); equal(order.cagnotte.snapshot.loyaltyCents, 225);
});
await test("checkout fingerprint distinguishes referral request/acceptance; normal contract unchanged", () => {
  const a = parseCheckoutBody({ ...body(), referralUse: undefined }); const b = parseCheckoutBody(body());
  ok(checkoutPayloadFingerprint(a) !== checkoutPayloadFingerprint(b));
  const c = { ...b, referralUse: { requested: true as const, acceptance: { quoteVersion: "referral-checkout-quote-v1" as const, quoteFingerprint: "a".repeat(64), acceptedReferralDiscountCents: 500 as const, acceptedPayableCents: 5049 } } };
  ok(checkoutPayloadFingerprint(b) !== checkoutPayloadFingerprint(c));
});
await test("created order binds request UID, replay and other UID conflict", async () => {
  const request = body(); const b = accepted(request, await proposal(request)); const c = await create(b); equal(c.status, 200);
  equal((await db.collection("checkoutRequests").doc(b.checkoutRequestId).get()).data()?.referralBeneficiaryId, uid);
  equal((await db.collection("checkoutRequests").doc(b.checkoutRequestId).get()).data()?.referralApplied, true);
  const before = await capture(); equal((await create(b)).data.orderId, c.data.orderId); deepStrictEqual(await capture(), before);
  equal((await create({ ...b, authToken: "other" })).data.code, "checkout_request_conflict"); deepStrictEqual(await capture(), before);
  equal((await create({ ...b, referralUse: undefined })).data.code, "checkout_request_conflict");
});
await test("aborted transaction leaves stock/order/request/claims/wallet untouched", async () => {
  const request = body(); const b = accepted(request, await proposal(request)); const before = await capture();
  ok((await create(b, { getDb: () => checkedDb(true) })).status >= 400); deepStrictEqual(await capture(), before);
  equal((await db.collection("referrals").doc(uid).get()).data()?.checkoutReservation, undefined); equal((await db.collection("orders").get()).size, 0);
});
await test("cross-snapshot mismatch closes enrollment", async () => {
  const request = body(); const c = await create(accepted(request, await proposal(request))); equal(c.status, 200);
  const order = (await db.collection("orders").doc(String(c.data.orderId)).get()).data()!;
  order.referral.fingerprint = "f".repeat(64); throws(() => buildCagnotteOrderEnrollment(order, uid, loyalty, 10000));
});
await test("real checkout -> payment -> delivery -> refund; sponsor 1000 and referee 225, replay safe", async () => {
  await db.collection("orders").doc("sponsor-order").set({ customerId: "checkout-sponsor", total: 60, items: [{ productId: "main", quantity: 1 }], paymentStatus: "paid", orderStatus: "delivered" });
  const request = body(); const b = accepted(request, await proposal(request)); const c = await create(b); equal(c.status, 200); const id = String(c.data.orderId);
  const common = { db, admin: actor, accrualProgram: loyalty, reservationProgram: null, referralProgram: program, getSponsorIdentity: identity, referralEmailKeyring: () => keyring, now: () => "2000-01-03T00:00:00.000Z" };
  const pay = () => commitOrderStatusTransition({ ...common, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } });
  await pay(); equal((await db.collection("referrals").doc(uid).get()).data()?.state, "pending");
  equal((await db.collection("cagnotteWallets").doc("checkout-sponsor").get()).data()?.pendingCents, 1000);
  equal((await db.collection("cagnotteWallets").doc(uid).get()).data()?.pendingCents, 225);
  const paid = await settlement(); await pay(); deepStrictEqual(await settlement(), paid);
  const deliver = () => commitOrderStatusTransition({ ...common, body: { orderId: id, orderStatus: "delivered" } });
  await deliver(); equal((await db.collection("referrals").doc(uid).get()).data()?.state, "rewarded");
  equal((await db.collection("cagnotteWallets").doc("checkout-sponsor").get()).data()?.availableCents, 1000);
  equal((await db.collection("cagnotteWallets").doc(uid).get()).data()?.availableCents, 225);
  const delivered = await settlement(); await deliver(); deepStrictEqual(await settlement(), delivered);
  const order = (await db.collection("orders").doc(id).get()).data()!;
  await db.collection("products").doc("main").update({ price: 1000 });
  const selection = { action: "preview" as const, orderId: id, currency: "EUR" as const, additionalReturns: [{ lineId: order.referral.lines[0].lineId, additionalNetCents: 900 }], deliveryRefundCents: 0 };
  const refundContext = { db, actor, now: () => "2000-01-04T00:00:00.000Z", referralProgram: program };
  const preview = await executeOrderRefund({ ...refundContext, request: selection }); equal(preview.kind, "refund_preview");
  if (preview.kind !== "refund_preview") throw new Error("preview missing");
  const refund = { ...selection, action: "record_confirmed" as const, source: "admin" as const, reference: "checkout-referral-refund", reason: "product_return" as const,
    confirmedAt: "2000-01-03T00:00:00.000Z", declaredFinancialCents: preview.totalFinancialCents, expectedPreviewVersion: preview.previewVersion };
  await executeOrderRefund({ ...refundContext, request: refund });
  equal((await db.collection("referrals").doc(uid).get()).data()?.state, "reversed"); equal((await db.collection("referrals").doc(uid).get()).data()?.cumulativeReturnedProductsCents, 1000);
  equal((await db.collection("cagnotteWallets").doc("checkout-sponsor").get()).data()?.availableCents, 0);
  equal((await db.collection("cagnotteWallets").doc(uid).get()).data()?.availableCents, 180);
  equal((await db.collection("orders").doc(id).get()).data()?.referral.refereeDiscountCents, 500);
  const after = await settlement(); await executeOrderRefund({ ...refundContext, request: refund }); deepStrictEqual(await settlement(), after);
});


async function candidate() {
  const request = body(); const acceptance = accepted(request, await proposal(request));
  const result = await create(acceptance); equal(result.status, 200);
  return { request: acceptance, id: String(result.data.orderId) };
}
async function transition(change: Parameters<typeof commitOrderStatusTransition>[0]["body"], overrides: Partial<Parameters<typeof commitOrderStatusTransition>[0]> = {}) {
  return commitOrderStatusTransition({ db: checkedDb(), admin: actor, body: change, accrualProgram: loyalty, reservationProgram: null,
    referralProgram: program, getSponsorIdentity: async id => { equal(transactionDepth.getStore() ?? 0, 0); return identity(id); },
    referralEmailKeyring: () => { equal(transactionDepth.getStore() ?? 0, 0); return keyring; },
    now: () => "2000-01-03T00:00:00.000Z", ...overrides });
}
const relationRef = () => db.collection("referrals").doc(uid);
await test("two pure accepted quotes and concurrent distinct requests: exactly one order/reservation/stock/outbox", async () => {
  const before = await capture(); const a = body(), b = body(); const q1 = await proposal(a), q2 = await proposal(b); deepStrictEqual(q1, q2); ok(q1.applied);
  deepStrictEqual(await capture(), before);
  let effects = 0;
  const results = await Promise.all([create(accepted(a, q1), { processSideEffects: async (...args) => { effects++; return deps().processSideEffects!(...args); } }),
    create(accepted(b, q2), { processSideEffects: async (...args) => { effects++; return deps().processSideEffects!(...args); } })]);
  equal(results.filter(r => r.status === 200).length, 1); equal(results.filter(r => r.status === 409 && r.data.code === "REFERRAL_QUOTE_CONFLICT").length, 1);
  equal(effects, 1); const winner = results.find(r => r.status === 200)!;
  equal((await db.collection("orders").get()).size, 1); equal((await db.collection("checkoutRequests").get()).size, 1);
  equal((await db.collection("orderSideEffects").get()).size, 1); equal((await db.collection("stockMovements").get()).size, 1);
  equal((await db.collection("products").doc("main").get()).data()?.stock, 999);
  const r = (await relationRef().get()).data()!; const request = (await db.collection("checkoutRequests").get()).docs[0];
  equal(r.checkoutReservation.orderId, winner.data.orderId); equal(request.data().orderId, winner.data.orderId);
  equal(r.checkoutReservation.checkoutRequestId, request.id); equal((await db.collection("orders").doc(String(winner.data.orderId)).get()).data()?.checkoutRequestId, request.id);
  equal(referralRelationIdentityHistoryStatus(uid, r), "clear");
  const reserved = await quote(); equal(reserved.status, 200); deepStrictEqual(reserved.data.referralUse, { quoteVersion: "referral-checkout-quote-v1", applied: false, reason: "right_reserved" });
});
await test("same request concurrent creates replay one reservation and one side-effect", async () => {
  const request = body(), b = accepted(request, await proposal(request)); let effects = 0;
  const overrides = { processSideEffects: async (...args: Parameters<NonNullable<Parameters<typeof createOrderHandler>[0]["processSideEffects"]>>) => { effects++; return deps().processSideEffects!(...args); } };
  const results = await Promise.all([create(b, overrides), create(b, overrides)]); equal(results[0].status, 200); equal(results[1].status, 200);
  equal(results[0].data.orderId, results[1].data.orderId); equal(effects, 1); equal((await db.collection("orders").get()).size, 1);
});
for (const mode of ["active", "drain"] as const) await test(`reserved payment ${mode}: qualify and remove reservation atomically`, async () => {
  const c = await candidate(); await transition({ orderId: c.id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, { referralProgram: { ...program, mode } });
  const r = (await relationRef().get()).data()!; equal(r.checkoutReservation, undefined); equal(r.qualifyingOrderId, c.id); equal(r.paymentConfirmed, true);
  equal(referralRelationIdentityHistoryStatus(uid, r), "clear"); equal((await db.collection("orders").doc(c.id).get()).data()?.paymentStatus, "paid");
});
await test("other discounted order cannot pay against another reservation", async () => {
  const c = await candidate(); const order = (await db.collection("orders").doc(c.id).get()).data()!;
  await db.collection("orders").doc("other-discounted").set({ ...order, checkoutRequestId: randomUUID() }); const before = await capture();
  await rejects(transition({ orderId: "other-discounted", paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }), { code: "referral_discount_reserved_for_other_order", status: 409 });
  deepStrictEqual(await capture(), before);
});
for (const failure of ["history", "identity", "corrupt", "abort"] as const) await test(`reserved payment failure ${failure} retains reservation and zero partial writes`, async () => {
  const c = await candidate(); let extra: Partial<Parameters<typeof commitOrderStatusTransition>[0]> = {};
  if (failure === "history") await db.collection("referralPaymentIdentities").doc("prior").set({ schemaVersion: 1, version: "referral-payment-identity-v1", orderId: "prior", customerUid: uid, status: "unresolved", reason: "runtime_closed", recordedAtEpochMs: 9999 });
  if (failure === "identity") extra = { getSponsorIdentity: async () => { throw new Error("unavailable"); } };
  if (failure === "corrupt") await relationRef().update({ "checkoutReservation.schemaVersion": 99 });
  if (failure === "abort") extra = { db: checkedDb(true) };
  const before = await capture(); await rejects(transition({ orderId: c.id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, extra));
  deepStrictEqual(await capture(), before); equal((await relationRef().get()).data()?.checkoutReservation.orderId, c.id);
});
await test("off payment never silently releases the reserved engagement", async () => {
  const c = await candidate(); const before = (await relationRef().get()).data();
  await transition({ orderId: c.id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, { referralProgram: REFERRAL_CLOSED_RUNTIME,
    getSponsorIdentity: async () => { throw new Error("must not read Auth"); }, referralEmailKeyring: () => { throw new Error("must not read keyring"); } });
  deepStrictEqual((await relationRef().get()).data(), before); equal((await db.collection("orders").doc(c.id).get()).data()?.paymentStatus, "paid");
  await transition({ orderId: c.id, orderStatus: "cancelled" }, { referralProgram: REFERRAL_CLOSED_RUNTIME });
  deepStrictEqual((await relationRef().get()).data(), before);
});
for (const mode of ["active", "off", "malformed"] as const) for (const event of ["order", "payment"] as const)
await test(`explicit never-paid ${event} cancellation ${mode}: release without Auth/keyring, no TTL, replay safe`, async () => {
  const c = await candidate(); const r = (await relationRef().get()).data()!;
  const fail = () => { throw new Error("cleanup must not resolve runtime/Auth/keyring"); };
  const configuration = { referralProgram: mode === "malformed" ? undefined : mode === "off" ? REFERRAL_CLOSED_RUNTIME : program,
    resolveReferralRuntime: fail, getSponsorIdentity: async () => fail(), referralEmailKeyring: fail };
  const change = event === "order" ? { orderId: c.id, orderStatus: "cancelled" as const } : { orderId: c.id, paymentStatus: "cancelled" as const };
  // Advancing time alone does not release the candidate.
  const later = await quote(body(), { now: () => 10000 + 1000 * 3600 * 24 * 365 }); equal((later.data.referralUse as ReferralCheckoutQuote).applied, false);
  deepStrictEqual((await relationRef().get()).data(), r);
  await transition(change, configuration); equal((await relationRef().get()).data()?.checkoutReservation, undefined);
  const released = await settlement(); await transition(change, configuration); deepStrictEqual(await settlement(), released);
  const beforePay = await capture();
  await rejects(transition({ orderId: c.id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" })); deepStrictEqual(await capture(), beforePay);
  const next = await proposal(); ok(next.applied);
});
for (const marker of ["paidAt", "paymentConfirmedAt"] as const) await test(`historical ${marker} prevents never-paid reservation release`, async () => {
  const c = await candidate(); await db.collection("orders").doc(c.id).update({ [marker]: "2000-01-02T00:00:00.000Z" });
  const raw = (await db.collection("orders").doc(c.id).get()).data()!; const before = await capture();
  await db.runTransaction(async transaction => { const plan = await prepareReferralCheckoutReservationRelease({ db, transaction,
    order: { ...raw, id: c.id } as Order, nextOrderStatus: "cancelled", nextPaymentStatus: "cancelled" }); equal(plan, null); });
  deepStrictEqual(await capture(), before);
});
await test("plain first payment consumes linked reservation and blocks later discounted payment", async () => {
  const c = await candidate(); const plain = await create({ ...body(), referralUse: undefined }); equal(plain.status, 200);
  await transition({ orderId: String(plain.data.orderId), paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const r = (await relationRef().get()).data()!; equal(r.checkoutReservation, undefined); equal(r.state, "cancelled"); equal(r.qualifyingOrderId, plain.data.orderId);
  const before = await capture(); await rejects(transition({ orderId: c.id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }), { code: "referral_discount_already_consumed" });
  deepStrictEqual(await capture(), before);
});
await test("reserved relation rejects other sponsor, allows same sponsor no-op and protects hard deletion", async () => {
  const c = await candidate();
  for (const [sponsor, code] of [["checkout-sponsor", "A".repeat(26)], ["other-sponsor", "B".repeat(26)]]) {
    const mapping = { schemaVersion: 1, programVersion: "referral-commercial-policy-v1", ownerUid: sponsor, code, createdAtEpochMs: 2000 };
    await db.collection("referralCodes").doc(`owner_${sponsor}`).set(mapping); await db.collection("referralCodes").doc(`code_${code}`).set(mapping);
    await db.collection("orders").doc(`delivered-${sponsor}`).set({ customerId: sponsor, total: 50, paymentStatus: "paid", orderStatus: "delivered", items: [{ productId: "main", quantity: 1 }] });
  }
  const input = { db: checkedDb(), user: { uid, email: `${uid}@example.test`, emailVerified: true }, keyring: parseReferralEmailKeyring(keyring), program, nowEpochMs: 10000, getSponsorIdentity: identity };
  const before = await capture(); equal((await linkReferral({ ...input, code: "A".repeat(26) })).changed, false);
  await rejects(linkReferral({ ...input, code: "B".repeat(26) }), { code: "referral_checkout_reserved" }); deepStrictEqual(await capture(), before);
  await transition({ orderId: c.id, orderStatus: "cancelled" }); await rejects(transition({ orderId: c.id, deleteCancelled: true }));
  ok((await db.collection("orders").doc(c.id).get()).exists);
});
await test("V5 accepts optional valid reservation and rejects its malformed or terminal variants", async () => {
  const c = await candidate(); const relation = (await relationRef().get()).data()!;
  equal(ORDER_EMAIL_NORMALIZATION_VERSION, "order-email-normalization-v5"); equal(referralRelationIdentityHistoryStatus(uid, relation), "clear");
  const without = { ...relation }; delete without.checkoutReservation; equal(referralRelationIdentityHistoryStatus(uid, without), "clear");
  for (const reservation of [null, [], { ...relation.checkoutReservation, schemaVersion: 2 }, { ...relation.checkoutReservation, orderId: "bad/path" },
    { ...relation.checkoutReservation, checkoutRequestId: "bad" }, { ...relation.checkoutReservation, createdAtEpochMs: -1 }])
    equal(referralRelationIdentityHistoryStatus(uid, { ...relation, checkoutReservation: reservation }), "corrupt");
  for (const state of ["pending", "rewarded", "cancelled", "reversed"])
    equal(referralRelationIdentityHistoryStatus(uid, { ...relation, state, qualifyingOrderId: c.id, paymentConfirmed: true }), "corrupt");
});
for (const failure of ["off", "drain", "malformed", "identity", "keyring", "cagnotte"] as const)
await test(`exact replay ${failure}: zero runtime/identity/keyring/pricing/rate/effects and same order`, async () => {
  const c = await candidate(); let calls = 0, ownership = 0;
  const forbidden = () => { calls++; throw new Error("must not requalify replay"); };
  const replayDb = new Proxy(db, { get(target, property) {
    if (property === "collection") return (name: string) => { ok(["checkoutRequests", "orders"].includes(name)); return target.collection(name); };
    throw new Error("replay never starts pricing or a transaction");
  } }) as Firestore;
  const r = await create(c.request, { getDb: () => replayDb, referralRuntime: forbidden, referralIdentity: async () => forbidden(), referralKeyring: forbidden,
    getRuntimeConfiguration: forbidden, getFirebaseProjectId: forbidden, enforceRateLimit: async () => forbidden(), processSideEffects: async () => forbidden(),
    verifyToken: async token => { ownership++; return { uid: token, email: null }; } });
  equal(r.status, 200); equal(r.data.orderId, c.id); equal(calls, 0); equal(ownership, 1);
  equal(r.headers.get("Cache-Control"), "private, no-store"); equal(r.headers.get("Vary"), "Authorization");
});
await test("replay ownership and payload/order integrity fail before requalification", async () => {
  const c = await candidate(); let calls = 0; const forbidden = () => { calls++; throw new Error("must not requalify"); };
  const overrides = { referralRuntime: forbidden, getRuntimeConfiguration: forbidden, referralIdentity: async () => forbidden(), referralKeyring: forbidden };
  const cases = [{ ...c.request, authToken: "wrong-user" }, { ...c.request, items: [{ productId: "main", quantity: 2 }] },
    { ...c.request, referralUse: undefined }, { ...c.request, referralUse: { ...c.request.referralUse, acceptance: { ...c.request.referralUse.acceptance, acceptedPayableCents: 1 } } },
    { ...c.request, deliveryMethod: "local_express", deliveryZone: "new-zone" },
    { ...c.request, customer: { ...c.request.customer, address: { ...address, city: "Lyon" } } }];
  const before = await capture(); for (const request of cases) equal((await create(request, overrides)).data.code, "checkout_request_conflict");
  equal(calls, 0); deepStrictEqual(await capture(), before);
  await db.collection("orders").doc(c.id).delete(); equal((await create(c.request, overrides)).data.code, "checkout_request_conflict"); equal(calls, 0);
});
await test("lost ACK/current cancelled order and modified relation replay without qualification", async () => {
  const c = await candidate(); await transition({ orderId: c.id, orderStatus: "cancelled" });
  await relationRef().update({ sponsorUid: "externally-modified", state: "reversed" });
  const before = await capture(); const r = await create(c.request, { referralRuntime: () => { throw new Error("must not run"); } });
  equal(r.status, 200); equal(r.data.orderId, c.id); equal(r.data.orderStatus, "cancelled"); deepStrictEqual(await capture(), before);
});
for (const failure of ["runtime", "identity", "keyring", "cagnotte"] as const)
await test(`early miss/concurrent commit/${failure} failure: one exact safe fallback`, async () => {
  const request = body(), b = accepted(request, await proposal(request)); let committedId = "", lookups = 0, failureCalls = 0;
  // Return the missing snapshot captured before an intervening real successful create.
  const racingDb = new Proxy(db, { get(target, property) {
    if (property === "collection") return (name: string) => {
      const collection = target.collection(name);
      if (name !== "checkoutRequests") return collection;
      return new Proxy(collection, { get(col, key) {
        if (key === "doc") return (id: string) => {
          const ref = col.doc(id); return new Proxy(ref, { get(doc, method) {
            if (method === "get") return async () => {
              lookups++; const snapshot = await doc.get();
              if (lookups === 1) { equal(snapshot.exists, false); const c = await create(b); equal(c.status, 200); committedId = String(c.data.orderId); }
              return snapshot;
            };
            const value = Reflect.get(doc, method); return typeof value === "function" ? value.bind(doc) : value;
          } });
        };
        const value = Reflect.get(col, key); return typeof value === "function" ? value.bind(col) : value;
      } });
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } }) as Firestore;
  const forbidden = () => { failureCalls++; throw new Error("unavailable after concurrent commit"); };
  const overrides: Partial<Parameters<typeof createOrderHandler>[0]> = { getDb: () => racingDb };
  if (failure === "runtime") overrides.referralRuntime = forbidden;
  if (failure === "identity") overrides.referralIdentity = async () => forbidden();
  if (failure === "keyring") overrides.referralKeyring = forbidden;
  if (failure === "cagnotte") overrides.getRuntimeConfiguration = forbidden;
  const r = await create(b, overrides); equal(r.status, 200); equal(r.data.orderId, committedId); equal(lookups, 2); equal(failureCalls, 1);
  equal((await db.collection("orders").get()).size, 1);
});
await test("unpaid cancellation abort preserves reservation/order/stock atomically", async () => {
  const c = await candidate(); const before = await capture();
  await rejects(transition({ orderId: c.id, orderStatus: "cancelled" }, { db: checkedDb(true), referralProgram: REFERRAL_CLOSED_RUNTIME }));
  deepStrictEqual(await capture(), before);
});
await test("early miss concurrent commit fallback still rejects a different owner", async () => {
  const request = body(), b = accepted(request, await proposal(request)); let staged = false;
  const racingDb = new Proxy(db, { get(target, property) {
    if (property === "collection") return (name: string) => {
      const collection = target.collection(name); if (name !== "checkoutRequests") return collection;
      return new Proxy(collection, { get(col, key) {
        if (key === "doc") return (id: string) => new Proxy(col.doc(id), { get(doc, method) {
          if (method === "get") return async () => { const snapshot = await doc.get();
            if (!staged) { staged = true; equal(snapshot.exists, false); equal((await create(b)).status, 200); } return snapshot; };
          const value = Reflect.get(doc, method); return typeof value === "function" ? value.bind(doc) : value;
        } });
        const value = Reflect.get(col, key); return typeof value === "function" ? value.bind(col) : value;
      } });
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } }) as Firestore;
  const result = await create({ ...b, authToken: "wrong-user" }, { getDb: () => racingDb, referralRuntime: () => { throw new Error("unavailable"); } });
  equal(result.status, 409); equal(result.data.code, "checkout_request_conflict"); equal((await db.collection("orders").get()).size, 1);
});
async function unappliedRequest(reason: "below_threshold" | "no_relation" | "priority_advantage" | "right_reserved") {
  const request = body();
  if (reason === "below_threshold") await db.collection("products").doc("main").update({ price: 49.99 });
  if (reason === "no_relation") await relationRef().delete();
  if (reason === "priority_advantage") {
    await db.collection("coupons").doc("free").set({ code: "FREE", isActive: true, usedCount: 0, minimumOrder: 0, discountType: "free_shipping", discountValue: 0 });
    Object.assign(request, { couponCode: "FREE" });
  }
  if (reason === "right_reserved") await candidate();
  return request;
}
function ownershipReplayDependencies(counter: { auth: number; business: number }) {
  const forbidden = () => { counter.business++; throw new Error("replay must not requalify"); };
  const replayDb = new Proxy(db, { get(target, property) {
    if (property === "collection") return (name: string) => { ok(["checkoutRequests", "orders"].includes(name)); return target.collection(name); };
    throw new Error("replay must not start pricing/transactions");
  } }) as Firestore;
  return { getDb: () => replayDb, referralRuntime: forbidden, referralIdentity: async () => forbidden(), referralKeyring: forbidden,
    getRuntimeConfiguration: forbidden, getFirebaseProjectId: forbidden, enforceRateLimit: async () => forbidden(), processSideEffects: async () => forbidden(),
    verifyToken: async (token: string) => { counter.auth++; if (token === "invalid-token") throw new FirebaseIdTokenVerificationError("authentication"); return { uid: token, email: null }; } };
}
async function transactionalReplay(request: ReturnType<typeof body>, customerId = uid) {
  const parsed = parseCheckoutBody(request);
  return commitCheckoutOrder({ db: checkedDb(), body: parsed, priced: {} as Awaited<ReturnType<typeof priceCheckout>>, customerId,
    checkoutRequestId: request.checkoutRequestId, payloadFingerprint: checkoutPayloadFingerprint(parsed), accrualProgram: null, reservationProgram: null });
}
for (const reason of ["below_threshold", "no_relation", "priority_advantage", "right_reserved"] as const)
for (const enrollment of ["absent", "not_started"] as const) await test(`unapplied ${reason}/${enrollment}: owner binding without enrollment, strict replay before runtime`, async () => {
  const request = await unappliedRequest(reason);
  const accrualProgram = enrollment === "absent" ? null : { ...loyalty, startsAtEpochMs: 20000 };
  const q = await quote(request, { accrualProgram }); equal(q.status, 200);
  const refusal = q.data.referralUse as ReferralCheckoutQuote; ok(!refusal.applied); equal(refusal.reason, reason);
  const c = await create(request, { accrualProgram }); equal(c.status, 200);
  const doc = (await db.collection("checkoutRequests").doc(request.checkoutRequestId).get()).data()!;
  const order = (await db.collection("orders").doc(String(c.data.orderId)).get()).data()!;
  equal(doc.referralBeneficiaryId, uid); equal(doc.referralApplied, false); equal(doc.cagnotteBeneficiaryId, undefined);
  equal(order.customerId, uid); equal(order.referral, undefined); equal(order.cagnotte, undefined);
  equal(checkoutPayloadFingerprint(parseCheckoutBody(request)), checkoutPayloadFingerprint(parseCheckoutBody({ ...request, authToken: "another-uid" })));
  const before = await capture(); const counter = { auth: 0, business: 0 }, overrides = ownershipReplayDependencies(counter);
  const same = await create(request, overrides); equal(same.status, 200); equal(same.data.orderId, c.data.orderId); equal(counter.auth, 1);
  equal(same.headers.get("Cache-Control"), "private, no-store"); equal(same.headers.get("Vary"), "Authorization");
  const other = await create({ ...request, authToken: "another-uid" }, overrides); equal(other.status, 409); equal(other.data.code, "checkout_request_conflict"); equal(counter.auth, 2);
  const absent = await create({ ...request, authToken: undefined }, overrides); equal(absent.status, 409); equal(absent.data.code, "checkout_request_conflict"); equal(counter.auth, 2);
  const invalid = await create({ ...request, authToken: "invalid-token" }, overrides); equal(invalid.status, 401); equal(counter.auth, 3);
  equal(counter.business, 0);
  equal((await transactionalReplay(request)).orderId, c.data.orderId);
  await rejects(transactionalReplay(request, "another-uid"), { message: "checkout_request_conflict" }); deepStrictEqual(await capture(), before);
});
for (const applied of [true, false]) await test(`legacy binding without applied flag remains replayable, applied=${applied}`, async () => {
  const c = applied ? await candidate() : await (async () => { const request = await unappliedRequest("no_relation"); const r = await create(request, { accrualProgram: null }); equal(r.status, 200); return { request, id: String(r.data.orderId) }; })();
  const ref = db.collection("checkoutRequests").doc(c.request.checkoutRequestId); const value = (await ref.get()).data()!; delete value.referralApplied; await ref.set(value);
  const before = await capture(); const counter = { auth: 0, business: 0 };
  const r = await create(c.request, ownershipReplayDependencies(counter)); equal(r.status, 200); equal(r.data.orderId, c.id); equal(counter.auth, 1); equal(counter.business, 0);
  equal((await transactionalReplay(c.request)).orderId, c.id); await rejects(transactionalReplay(c.request, "other")); deepStrictEqual(await capture(), before);
});
for (const applied of [true, false]) for (const corrupt of ["order_owner", "applied_flag", "invalid_flag", "conflicting_cagnotte", "missing_order"] as const)
await test(`binding corruption ${corrupt}/applied=${applied}: early and transactional replay fail closed`, async () => {
  const c = applied ? await candidate() : await (async () => { const request = await unappliedRequest("no_relation"); const r = await create(request, { accrualProgram: null }); equal(r.status, 200); return { request, id: String(r.data.orderId) }; })();
  const requestRef = db.collection("checkoutRequests").doc(c.request.checkoutRequestId), orderRef = db.collection("orders").doc(c.id);
  if (corrupt === "order_owner") await orderRef.update({ customerId: "another-uid" });
  if (corrupt === "applied_flag") await requestRef.update({ referralApplied: !applied });
  if (corrupt === "invalid_flag") await requestRef.update({ referralApplied: "invalid" });
  if (corrupt === "conflicting_cagnotte") await requestRef.update({ cagnotteBeneficiaryId: "another-uid" });
  if (corrupt === "missing_order") await orderRef.delete();
  const before = await capture(); const counter = { auth: 0, business: 0 };
  const r = await create(c.request, ownershipReplayDependencies(counter)); equal(r.status, 409); equal(r.data.code, "checkout_request_conflict"); equal(counter.business, 0);
  await rejects(transactionalReplay(c.request), { message: "checkout_request_conflict" }); deepStrictEqual(await capture(), before);
});
for (const otherUid of [false, true]) await test(`unapplied concurrent same request, different UID=${otherUid}: one owner/order/outbox`, async () => {
  const request = await unappliedRequest("no_relation"); let effects = 0;
  const overrides = { accrualProgram: null, processSideEffects: async (...args: Parameters<NonNullable<Parameters<typeof createOrderHandler>[0]["processSideEffects"]>>) => { effects++; return deps().processSideEffects!(...args); } };
  const results = await Promise.all([create(request, overrides), create({ ...request, authToken: otherUid ? "another-uid" : uid }, overrides)]);
  equal(results.filter(r => r.status === 200).length, otherUid ? 1 : 2); equal(effects, 1);
  if (otherUid) { equal(results.filter(r => r.status === 409).length, 1); equal(results.find(r => r.status === 409)?.data.code, "checkout_request_conflict"); }
  const order = (await db.collection("orders").get()).docs[0], binding = (await db.collection("checkoutRequests").doc(request.checkoutRequestId).get()).data()!;
  equal((await db.collection("orders").get()).size, 1); equal((await db.collection("orderSideEffects").get()).size, 1);
  equal(order.data().customerId, binding.referralBeneficiaryId); equal(binding.referralApplied, false); equal(order.data().referral, undefined);
});
await test("normal request without referral remains unbound and preserves the legacy replay contract", async () => {
  const request = { ...body(), referralUse: undefined }; const c = await create(request, { accrualProgram: null }); equal(c.status, 200);
  const doc = (await db.collection("checkoutRequests").doc(request.checkoutRequestId).get()).data()!;
  equal(doc.referralBeneficiaryId, undefined); equal(doc.referralApplied, undefined); equal(doc.cagnotteBeneficiaryId, undefined);
  const r = await create({ ...request, authToken: undefined }, { verifyToken: async () => { throw new Error("legacy unbound replay must not authenticate"); }, referralRuntime: () => { throw new Error("must not resolve"); } });
  equal(r.status, 200); equal(r.data.orderId, c.data.orderId);
});
console.log(`Referral checkout: ${passed} PASS`);
