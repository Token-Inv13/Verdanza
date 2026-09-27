import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { aixRadiusDeliveryZone } from "../src/data/deliveryZones.js";
import { connectCagnotteEmulator, CAGNOTTE_DEMO } from "./cagnotteEmulator.js";
import { createOrderHandler } from "../api/create-order.js";
import { createQuoteOrderHandler } from "../api/quote-order.js";
import { parseCheckoutBody, priceCheckout } from "../api/_server/checkout.js";
import { checkoutPayloadFingerprint } from "../api/_server/orderSideEffects.js";
import { allocateReferralDiscount, prepareReferralCheckout, readReferralCheckoutContext } from "../api/_server/referralCheckout.js";
import { parseReferralEmailKeyring, referralEmailClaimId } from "../api/_server/referralIdentity.js";
import { REFERRAL_CLOSED_RUNTIME, ReferralConfigurationError } from "../api/_server/referralRuntimeConfig.js";
import { ORDER_EMAIL_NORMALIZATION_VERSION } from "../api/_server/referralOrderEmailHistory.js";
import { commitOrderStatusTransition } from "../api/_server/orderStatusTransition.js";
import { executeOrderRefund } from "../api/_server/orderRefunds.js";
import { buildCagnotteOrderEnrollment } from "../api/_server/cagnotteOrders.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import type { CagnotteTestProgram } from "../api/_server/cagnotteLedgerTypes.js";
import type { ReferralRelation } from "../src/types/referral.js";
import type { ReferralCheckoutQuote } from "../src/types/referralCheckout.js";

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const program = { mode: "active" as const, startsAtEpochMs: 1000, operational: true };
const loyalty: CagnotteTestProgram = { mode: "local_test", programVersion: "referral-checkout-test-v1", calculationVersion: "cagnotte-math-v1", startsAtEpochMs: 1000, newAccrualsEnabled: true };
const secret = "only-local-test-key-material-32-bytes-minimum";
const keyring = JSON.stringify({ activeVersion: "v1", keys: { v1: secret } });
const uid = "checkout-referee";
const actor = { uid: "checkout-admin", email: "admin@example.test" };
const identity = async (id: string) => ({ uid: id, email: `${id}@example.test`, emailVerified: true, disabled: false });
const collections = ["orders", "products", "coupons", "deliveryZones", "referrals", "referralEmailClaims", "referralPaymentIdentities", "referralMigrations", "cagnotteWallets", "cagnotteMovements", "cagnotteAccruals", "cagnotteRefunds", "orderRefunds", "checkoutRequests", "orderSideEffects", "stockMovements", "productCosts", "analyticsOutbox", "adminUsers"];
let passed = 0;
let depth = 0;
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
    if (key === "runTransaction") return (callback: (tx: Transaction) => Promise<unknown>) => target.runTransaction(async tx => {
      let wrote = false; depth++;
      const checked = new Proxy(tx, { get(current, method) {
        const value = Reflect.get(current, method);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (["get", "getAll"].includes(String(method))) equal(wrote, false, "read before write");
          if (["set", "update", "create", "delete"].includes(String(method))) wrote = true;
          return Reflect.apply(value, current, args);
        };
      } });
      try { const value = await callback(checked); if (abort && wrote) throw new Error("injected abort"); return value; }
      finally { depth--; }
    });
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }) as Firestore;
}
function deps(overrides: Partial<Parameters<typeof createOrderHandler>[0]> = {}): Parameters<typeof createOrderHandler>[0] {
  return { getDb: () => checkedDb(), verifyToken: async (token: string) => { equal(depth, 0); return { uid: token, email: `${token}@example.test`, emailVerified: true }; },
    accrualProgram: loyalty, reservationProgram: null, now: () => 10000,
    referralRuntime: () => program, referralIdentity: async (id: string) => { equal(depth, 0); return identity(id); },
    referralKeyring: () => { equal(depth, 0); return keyring; },
    enforceRateLimit: async () => ({ allowed: true, code: "allowed", retryAfterSeconds: 0 }),
    processSideEffects: async () => { equal(depth, 0); return { client: { status: "skipped" as const, reason: "fixture" }, admin: { status: "skipped" as const, reason: "fixture" } }; }, ...overrides };
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
for (const mode of ["off", "drain", "malformed"] as const) await test(`${mode} requested closes before DB/Auth/keyring; absent request unchanged`, async () => {
  const runtime = () => { if (mode === "malformed") throw new ReferralConfigurationError(); return mode === "off" ? REFERRAL_CLOSED_RUNTIME : { ...program, mode: "drain" as const }; };
  const fail = () => { throw new Error("must not run"); };
  const closed = { referralRuntime: runtime, getDb: fail, verifyToken: async () => fail(), referralIdentity: async () => fail(), referralKeyring: fail };
  equal((await quote(body(), closed)).status, 503); equal((await create(body(), closed)).status, 503);
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
await test("multi-line reversal gives identical quote fingerprint and frozen allocations", async () => {
  await db.collection("products").doc("second").set({ name: "Second", slug: "second", price: 25, stock: 100, isActive: true, category: "flowers" });
  await db.collection("products").doc("main").update({ price: 25 });
  const request = { ...body(), items: [{ productId: "main", quantity: 1 }, { productId: "second", quantity: 1 }] };
  const q = await proposal(request); const reverse = await proposal({ ...request, items: [...request.items].reverse() }); deepStrictEqual(q, reverse);
  const r = await create(accepted(request, q)); equal(r.status, 200); const order = (await db.collection("orders").doc(String(r.data.orderId)).get()).data()!;
  equal(order.referral.lines.reduce((sum: number, line: { referralDiscountCents: number }) => sum + line.referralDiscountCents, 0), 500);
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
  const before = await capture(); equal((await create(b)).data.orderId, c.data.orderId); deepStrictEqual(await capture(), before);
  equal((await create({ ...b, authToken: "other" })).data.code, "checkout_request_conflict"); deepStrictEqual(await capture(), before);
  equal((await create({ ...b, referralUse: undefined })).data.code, "checkout_request_conflict");
});
await test("aborted transaction leaves stock/order/request/claims/wallet untouched", async () => {
  const request = body(); const b = accepted(request, await proposal(request)); const before = await capture();
  ok((await create(b, { getDb: () => checkedDb(true) })).status >= 400); deepStrictEqual(await capture(), before);
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
console.log(`Referral checkout: ${passed} PASS`);
