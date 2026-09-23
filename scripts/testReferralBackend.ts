import { deepStrictEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { CAGNOTTE_DEMO, connectCagnotteEmulator } from "./cagnotteEmulator.js";
import { createReferralHandler } from "../api/referral.js";
import { lookupReferralSponsorEmail } from "../api/_server/referralSponsorIdentity.js";
import { newReferralCode, normalizeReferralEmail, referralEmailClaimId } from "../api/_server/referralIdentity.js";
import { resolveReferralRuntime, REFERRAL_CLOSED_RUNTIME } from "../api/_server/referralRuntimeConfig.js";
import { ensureReferralCode, linkReferral, readReferralSelf } from "../api/_server/referralService.js";
import { createReferralOrderSnapshot, referralReturnedProductsCents } from "../api/_server/referralSnapshot.js";
import { prepareReferralTransition } from "../api/_server/referralLedger.js";
import { applyCagnotteLedgerOperation } from "../api/_server/cagnotteLedger.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { executeOrderRefund } from "../api/_server/orderRefunds.js";
import { commitOrderStatusTransition } from "../api/_server/orderStatusTransition.js";
import type { Order } from "../src/types/index.js";
import type { ReferralRelation } from "../src/types/referral.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";

let passed = 0;
async function test(name: string, run: () => Promise<void> | void) { await run(); console.log(`OK ${++passed} - ${name}`); }
const secret = "fixture-secret-material-with-at-least-32-bytes";
const program = { mode: "active" as const, startsAtEpochMs: 1000, operational: true };
const drain = { ...program, mode: "drain" as const };
const user = { uid: "referee-a", email: "Referee-A@Example.Test ", emailVerified: true };
const sponsor = { uid: "sponsor-a", email: "Sponsor-A@Example.Test", emailVerified: true };
const codeA = "A".repeat(26);
const codeB = "B".repeat(26);
const nowEpochMs = 2000;

await test("runtime absent et off ne consultent pas Firebase", () => {
  const fail = () => { throw new Error("unexpected_project_read"); };
  deepStrictEqual(resolveReferralRuntime({ environment: {}, getProjectId: fail }), REFERRAL_CLOSED_RUNTIME);
  deepStrictEqual(resolveReferralRuntime({ environment: { REFERRAL_PROGRAM_MODE: "off" }, getProjectId: fail }), REFERRAL_CLOSED_RUNTIME);
  throws(() => resolveReferralRuntime({ environment: { REFERRAL_PROGRAM_MODE: "active" }, getProjectId: fail }));
  throws(() => resolveReferralRuntime({ environment: { REFERRAL_PROGRAM_MODE: "drain", REFERRAL_RUNTIME_ENVIRONMENT: "production", REFERRAL_STARTS_AT_EPOCH_MS: "1000", REFERRAL_PROGRAM_VERSION: "referral-commercial-policy-v1" }, deploymentEnvironment: "preview", getProjectId: fail }));
  throws(() => resolveReferralRuntime({ environment: { REFERRAL_PROGRAM_MODE: "active", REFERRAL_RUNTIME_ENVIRONMENT: "production", REFERRAL_STARTS_AT_EPOCH_MS: "1000", REFERRAL_PROGRAM_VERSION: "referral-commercial-policy-v1" }, deploymentEnvironment: "production", getProjectId: () => "wrong" }));
  const valid = resolveReferralRuntime({ environment: { REFERRAL_PROGRAM_MODE: "active", REFERRAL_RUNTIME_ENVIRONMENT: "production", REFERRAL_STARTS_AT_EPOCH_MS: "1000", REFERRAL_PROGRAM_VERSION: "referral-commercial-policy-v1" }, deploymentEnvironment: "production", getProjectId: () => "verdanza-1f621" });
  equal(valid.mode, "active");
});
await test("normalisation et HMAC stable sans email clair", () => {
  equal(normalizeReferralEmail(" TEST@Example.COM "), "test@example.com");
  equal(referralEmailClaimId(secret, "TEST@Example.COM"), referralEmailClaimId(secret, " test@example.com "));
  ok(!referralEmailClaimId(secret, user.email!).includes("example"));
  throws(() => referralEmailClaimId("short", "x@example.test"));
  equal(newReferralCode(() => Buffer.alloc(16)), "A".repeat(26));
});
await test("lookup Auth Admin du parrain: projet, UID et échec fermés", async () => {
  const requests: Array<{ url: string; authorization: string; body: unknown }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), authorization: String(new Headers(init?.headers).get("authorization")), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ users: [{ localId: sponsor.uid, email: sponsor.email }] }), { status: 200 });
  };
  equal(await lookupReferralSponsorEmail({ uid: sponsor.uid, projectId: "verdanza-1f621", accessToken: "fixture-token", fetchImpl: fetchImpl as typeof fetch }), sponsor.email);
  deepStrictEqual(requests, [{ url: "https://identitytoolkit.googleapis.com/v1/projects/verdanza-1f621/accounts:lookup", authorization: "Bearer fixture-token", body: { localId: [sponsor.uid] } }]);
  await rejects(lookupReferralSponsorEmail({ uid: sponsor.uid, projectId: "wrong-project", accessToken: "fixture-token", fetchImpl: fetchImpl as typeof fetch }));
  equal(requests.length, 1);
  await rejects(lookupReferralSponsorEmail({ uid: sponsor.uid, projectId: "verdanza-1f621", accessToken: "fixture-token", fetchImpl: (async () => new Response(JSON.stringify({ users: [{ localId: "other", email: sponsor.email }] }), { status: 200 })) as typeof fetch }));
});
await test("API fermée avant Auth, Firestore et secret", async () => {
  let calls = 0; let status = 0; let body: unknown;
  const handler = createReferralHandler({ runtime: () => REFERRAL_CLOSED_RUNTIME, verify: async () => { calls++; throw new Error(); },
    db: () => { calls++; throw new Error(); }, sponsorEmail: async () => { calls++; throw new Error(); }, secret: () => { calls++; throw new Error(); }, now: Date.now });
  const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { body = value; } } as unknown as VercelResponseLike;
  await handler({ method: "GET", headers: {} } as VercelRequestLike, response);
  equal(status, 503); deepStrictEqual(body, { code: "referral_program_disabled" }); equal(calls, 0);
  const missingSecret = createReferralHandler({ runtime: () => program, verify: async () => { calls++; throw new Error(); },
    db: () => { calls++; throw new Error(); }, sponsorEmail: async () => { calls++; throw new Error(); }, secret: () => "short", now: Date.now });
  await missingSecret({ method: "POST", headers: {}, body: { action: "link", code: codeA } } as VercelRequestLike, response);
  equal(status, 503); deepStrictEqual(body, { code: "referral_configuration_invalid" }); equal(calls, 0);
});

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const sponsorOrder = (id: string, uid: string, status = "delivered") => db.collection("orders").doc(id).set({ customerId: uid, paymentStatus: "paid", orderStatus: status, orderType: "order", total: 60,
  items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] });
await sponsorOrder("referral-sponsor-a", sponsor.uid);
await test("parrain éligible, code stable et collision transactionnelle", async () => {
  const first = await ensureReferralCode({ db, user: sponsor, program, nowEpochMs, codeFactory: () => codeA });
  deepStrictEqual(first, { code: codeA, created: true });
  deepStrictEqual(await ensureReferralCode({ db, user: sponsor, program, nowEpochMs, codeFactory: () => codeB }), { code: codeA, created: false });
  await sponsorOrder("referral-sponsor-b", "sponsor-b");
  let count = 0;
  const collision = await ensureReferralCode({ db, user: { uid: "sponsor-b", email: "b@example.test" }, program, nowEpochMs, codeFactory: () => ++count === 1 ? codeA : codeB });
  equal(collision.code, codeB);
  await rejects(ensureReferralCode({ db, user: { uid: "no-orders", email: "none@example.test" }, program, nowEpochMs, codeFactory: () => "C".repeat(26) }));
});
await test("lien, claim, replay, changement avant paiement et projection privée", async () => {
  const args = { db, user, code: codeA, secret, program, nowEpochMs, getSponsorEmail: async () => sponsor.email };
  deepStrictEqual(await linkReferral(args), { state: "linked", changed: true });
  deepStrictEqual(await linkReferral(args), { state: "linked", changed: false });
  const claim = await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, user.email!)).get();
  equal(claim.data()?.refereeUid, user.uid); ok(!JSON.stringify(claim.data()).includes("example.test"));
  const changed = await linkReferral({ ...args, code: codeB, getSponsorEmail: async () => "b@example.test" });
  equal(changed.changed, true);
  const self = await readReferralSelf(db, user.uid);
  deepStrictEqual(self, { code: null, relation: { state: "linked", paymentConfirmed: false, deliveryConfirmed: false } });
  ok(!JSON.stringify(self).includes("sponsor"));
  await rejects(linkReferral({ ...args, user: { uid: "another-uid", email: user.email, emailVerified: true } }));
  await rejects(linkReferral({ ...args, user: sponsor }));
  await rejects(linkReferral({ ...args, user: { ...user, emailVerified: false } }));
  await rejects(linkReferral({ ...args, program: drain }));
});

const snapshot = createReferralOrderSnapshot({ refereeUid: user.uid, createdAtEpochMs: 2000,
  lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] });
const order = { id: "referral-order-a", customerId: user.uid, paymentStatus: "to_confirm", orderStatus: "contact_required", referral: snapshot } as Order;
const transition = (source: Order, event: "payment" | "payment_and_delivery" | "delivery" | "refund" | "correction", refundId?: string, returned = 0) =>
  db.runTransaction(async (transaction) => {
    const plan = await prepareReferralTransition({ db, transaction, order: source, program, event, recordedAtEpochMs: nowEpochMs,
      ...(refundId ? { refundId, cumulativeReturnedProductsCents: returned } : {}) });
    plan?.write(); return plan?.status;
  });
const relation = async () => (await db.collection("referrals").doc(user.uid).get()).data() as ReferralRelation;
const wallet = async (uid: string) => (await db.collection("cagnotteWallets").doc(uid).get()).data()!;

await test("paiement, replay, livraison et wallet partagé", async () => {
  equal(await transition(order, "payment"), "applied");
  equal(await transition(order, "payment"), "already_applied");
  equal((await relation()).state, "pending");
  equal((await wallet("sponsor-b")).pendingCents, 1000);
  equal(await transition(order, "delivery"), "applied");
  equal(await transition(order, "delivery"), "already_applied");
  equal((await relation()).state, "rewarded");
  equal((await wallet("sponsor-b")).availableCents, 1000);
});
await test("refund au-dessus du seuil, puis sous le seuil et régularisation", async () => {
  equal(await transition(order, "refund", "refund-1", 500), "applied");
  equal((await relation()).state, "rewarded");
  await db.collection("cagnotteWallets").doc("sponsor-b").update({ availableCents: 100 });
  equal(await transition(order, "refund", "refund-2", 1500), "applied");
  equal((await relation()).state, "reversed");
  equal((await wallet("sponsor-b")).regularizationCents, 900);
  equal(await transition(order, "refund", "refund-2", 1500), "already_applied");
  await rejects(transition(order, "refund", "refund-2", 1400));
});
await test("correction restaure le droit sans doubler le ledger", async () => {
  equal(await transition(order, "correction", "correction-1", 500), "applied");
  equal((await relation()).state, "rewarded");
  equal((await wallet("sponsor-b")).regularizationCents, 0);
  equal((await wallet("sponsor-b")).availableCents, 100);
  equal(await transition(order, "correction", "correction-1", 500), "already_applied");
  const movements = await db.collection("cagnotteMovements").where("orderId", "==", order.id).get();
  equal(movements.size, 5);
});
await test("conversion des retours figée avant remise", () => {
  const cagnotte = { lines: [{ lineId: "line", netCents: 5500 }] } as never;
  equal(referralReturnedProductsCents(snapshot, cagnotte, [{ lineId: "line", returnedNetCents: 5500 }]), 6000);
  equal(referralReturnedProductsCents(snapshot, cagnotte, [{ lineId: "line", returnedNetCents: 1100 }]), 1200);
});
await test("filleul déjà payé refusé par UID ou email historique", async () => {
  const historical = { uid: "referee-old", email: "old@example.test", emailVerified: true };
  await sponsorOrder("referral-prior-uid", historical.uid);
  await rejects(linkReferral({ db, user: historical, code: codeB, secret, program, nowEpochMs, getSponsorEmail: async () => "b@example.test" }));
  await db.collection("orders").doc("referral-prior-email").set({ customerId: "legacy-id", customerEmail: "legacy@example.test", paymentStatus: "paid", orderStatus: "delivered", orderType: "order", total: 60,
    items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] });
  await rejects(linkReferral({ db, user: { uid: "referee-legacy", email: "legacy@example.test", emailVerified: true }, code: codeB, secret, program, nowEpochMs, getSponsorEmail: async () => "b@example.test" }));
});
await test("livraison avant paiement aboutit au même droit", async () => {
  const child = { uid: "referee-inverse", email: "inverse@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, secret, program, nowEpochMs, getSponsorEmail: async () => "b@example.test" });
  const own = { ...order, id: "referral-order-inverse", customerId: child.uid,
    referral: createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000, lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] }) } as Order;
  equal(await transition(own, "delivery"), "applied");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.deliveryConfirmed, true);
  equal(await transition(own, "payment"), "applied");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "rewarded");
  equal(await transition(own, "payment"), "already_applied");
});
await test("paiement concurrent avec gain fidélité personnel partage le wallet", async () => {
  const child = { uid: "referee-concurrent", email: "concurrent@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, secret, program, nowEpochMs, getSponsorEmail: async () => "b@example.test" });
  const own = { ...order, id: "referral-order-concurrent", customerId: child.uid,
    referral: createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000, lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] }) } as Order;
  const previousPending = (await wallet("sponsor-b")).pendingCents;
  const loyaltyOrder = { orderId: "sponsor-personal-loyalty", beneficiaryId: "sponsor-b", programVersion: "fixture-loyalty-v1", createdAtEpochMs: 2000,
    snapshot: calculateCagnotte({ lines: [{ lineId: "line", initialCents: 10000 }], discounts: [], requestedCagnotteCents: 0, availableCagnotteCents: 0 }) };
  await Promise.all([
    transition(own, "payment"),
    applyCagnotteLedgerOperation({ db, command: { order: loyaltyOrder, event: "payment_confirmed" },
      program: { mode: "local_test", programVersion: "fixture-loyalty-v1", calculationVersion: "cagnotte-math-v1", startsAtEpochMs: 1000, newAccrualsEnabled: true }, recordedAtEpochMs: 2000 }),
  ]);
  equal((await wallet("sponsor-b")).pendingCents, previousPending + 1500);
  equal(await transition(own, "refund", "pending-refund", 1500), "applied");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "cancelled");
  equal((await wallet("sponsor-b")).pendingCents, previousPending + 500);
  equal(await transition(own, "correction", "pending-correction", 500), "applied");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "pending");
  equal((await wallet("sponsor-b")).pendingCents, previousPending + 1500);
});
await test("remboursement administratif compose atomiquement fidélité et parrainage", async () => {
  const child = { uid: "referee-admin-refund", email: "admin-refund@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, secret, program, nowEpochMs, getSponsorEmail: async () => "b@example.test" });
  const id = "referral-order-admin-refund";
  const referral = createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000,
    lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] });
  const cagnotte = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 6000 }],
    discounts: [{ discountId: "referral", amountCents: 500, kind: "referral_discount", lineIds: ["line"] }],
    requestedCagnotteCents: 0, availableCagnotteCents: 0, advantages: ["referral_discount"] });
  const data = { id, customerId: child.uid, customerName: "Synthetic", customerEmail: child.email,
    orderStatus: "delivered", paymentStatus: "paid", deliveryMethod: "postal", deliveryFee: 0,
    subtotal: 60, total: 55, discountAmount: 5, promotionDiscountTotal: 5,
    createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-02T00:00:00.000Z", paidAt: "2000-01-02T00:00:00.000Z",
    paymentConfirmedAt: "2000-01-02T00:00:00.000Z", paymentConfirmedBy: "fixture-admin@example.test", finalPaymentMethod: "card_payment_link",
    items: [{ lineId: "line", productId: "referral-product", name: "Synthetic", quantity: 1, unitPrice: 60, lineTotal: 60 }],
    cagnotte: { schemaVersion: 1, beneficiaryId: child.uid, programVersion: "fixture-referral-loyalty-v1", calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000, snapshot: cagnotte },
    referral } as const;
  await db.collection("orders").doc(id).set(data);
  const loyaltyProgram = { mode: "local_test" as const, programVersion: "fixture-referral-loyalty-v1", calculationVersion: "cagnotte-math-v1" as const, startsAtEpochMs: 1000, newAccrualsEnabled: true };
  await applyCagnotteLedgerOperation({ db, program: loyaltyProgram, command: { event: "payment_and_delivery_confirmed",
    order: { orderId: id, beneficiaryId: child.uid, programVersion: loyaltyProgram.programVersion, createdAtEpochMs: 2000, snapshot: cagnotte } }, recordedAtEpochMs: 2000 });
  await transition(data as unknown as Order, "payment_and_delivery");
  const request = { action: "preview" as const, orderId: id, currency: "EUR" as const,
    additionalReturns: [{ lineId: "line", additionalNetCents: 1100 }], deliveryRefundCents: 0 };
  const common = { db, actor: { uid: "fixture-admin", email: "fixture-admin@example.test" }, now: () => "2000-01-03T00:00:00.000Z", referralProgram: program };
  const preview = await executeOrderRefund({ ...common, request });
  equal(preview.kind, "refund_preview");
  const confirmed = await executeOrderRefund({ ...common, request: { ...request, action: "record_confirmed", source: "admin", reference: "referral-refund-1",
    declaredFinancialCents: preview.totalFinancialCents, reason: "product_return", confirmedAt: "2000-01-02T00:00:00.000Z", expectedPreviewVersion: preview.previewVersion } });
  equal(confirmed.kind, "administrative_refund_recorded");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "reversed");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.cumulativeReturnedProductsCents, 1200);
  const refundEvents = await db.collection("cagnotteRefunds").where("orderId", "==", id).get();
  equal(refundEvents.size, 1);
  const correction = { action: "preview_correction" as const, orderId: id, currency: "EUR" as const,
    targetEventId: refundEvents.docs[0].id, expectedRevision: 0, replacementReturns: [], deliveryRefundCents: 0,
    declaredFinancialCents: 0, correctionReason: "Rectification externe vérifiée", externalVerificationConfirmed: true };
  const correctionPreview = await executeOrderRefund({ ...common, request: correction });
  equal(correctionPreview.kind, "refund_correction_preview");
  const corrected = await executeOrderRefund({ ...common, request: { ...correction, action: "record_correction", correctionReference: "referral-correction-1",
    expectedPreviewVersion: correctionPreview.previewVersion } });
  equal(corrected.kind, "administrative_refund_correction_recorded");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "rewarded");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.cumulativeReturnedProductsCents, 0);
});
await test("transition de commande appelle paiement et livraison parrainage dans la même transaction", async () => {
  const child = { uid: "referee-order-route", email: "order-route@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, secret, program, nowEpochMs, getSponsorEmail: async () => "b@example.test" });
  const id = "referral-order-route";
  await db.collection("orders").doc(id).set({ id, customerId: child.uid, customerName: "Synthetic", customerEmail: child.email,
    orderStatus: "confirmed", paymentStatus: "to_confirm", deliveryMethod: "postal", deliveryFee: 0,
    subtotal: 60, total: 55, discountAmount: 5, promotionDiscountTotal: 5,
    createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z",
    items: [{ lineId: "line", productId: "referral-product", name: "Synthetic", quantity: 1, unitPrice: 60, lineTotal: 60 }],
    referral: createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000,
      lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] }) });
  const actor = { uid: "fixture-admin", email: "fixture-admin@example.test" };
  const before = (await wallet("sponsor-b")).pendingCents;
  await commitOrderStatusTransition({ db, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
    admin: actor, referralProgram: program, now: () => "2000-01-02T00:00:00.000Z" });
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "pending");
  equal((await wallet("sponsor-b")).pendingCents, before + 1000);
  await commitOrderStatusTransition({ db, body: { orderId: id, orderStatus: "delivered" }, admin: actor, referralProgram: drain,
    now: () => "2000-01-03T00:00:00.000Z" });
  equal((await db.collection("orders").doc(id).get()).data()?.orderStatus, "delivered");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "rewarded");
  equal((await wallet("sponsor-b")).pendingCents, before);
});
console.log(`Referral backend: ${passed} checks.`);
