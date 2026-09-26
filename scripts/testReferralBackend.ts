import { deepStrictEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { createHmac } from "node:crypto";
import { CAGNOTTE_DEMO, connectCagnotteEmulator } from "./cagnotteEmulator.js";
import { createReferralHandler } from "../api/referral.js";
import { FirebaseIdTokenVerificationError, verifyFirebaseIdToken } from "../api/_server/adminAuth.js";
import { lookupReferralSponsorIdentity } from "../api/_server/referralSponsorIdentity.js";
import { newReferralCode, normalizeReferralEmail, referralEmailClaimId, parseReferralEmailKeyring, referralEmailClaimAliases } from "../api/_server/referralIdentity.js";
import { resolveReferralRuntime, REFERRAL_CLOSED_RUNTIME, ReferralConfigurationError, REFERRAL_RUNTIME_KEYS } from "../api/_server/referralRuntimeConfig.js";
import { ensureReferralCode, findPriorPaidProductOrder, hasHistoricalPaymentEvidence, isValidHistoricalPaymentInstant, linkReferral, productOrder, readReferralSelf, ReferralError, sponsorHasDeliveredPaidOrder } from "../api/_server/referralService.js";
import { FieldValue } from "firebase-admin/firestore";
import { createReferralOrderSnapshot, referralReturnedProductsCents, referralSnapshotFingerprint } from "../api/_server/referralSnapshot.js";
import { prepareReferralTransition, validateReferralOrderSnapshot, type ReferralPaymentEvidence } from "../api/_server/referralLedger.js";
import { applyCagnotteLedgerOperation } from "../api/_server/cagnotteLedger.js";
import { applyCagnotteReservationOperation, CagnotteReservationError, createCagnotteReservationIntent } from "../api/_server/cagnotteReservations.js";
import { CAGNOTTE_RESERVATION_VERSION } from "../api/_server/cagnotteLedgerTypes.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { executeOrderRefund } from "../api/_server/orderRefunds.js";
import { commitOrderStatusTransition, hasPositiveCagnotteFinancing, hasAppliedReferralPriority } from "../api/_server/orderStatusTransition.js";
import { createOrderStatusHandler } from "../api/_server/orderStatusRoute.js";
import { readUnpaidOrderContext } from "../api/_server/unpaidOrderReview.js";
import type { Order } from "../src/types/index.js";
import type { ReferralRelation } from "../src/types/referral.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import { canonicalOrderEmail } from "../api/_server/orderEmailIdentity.js";
import { ORDER_EMAIL_NORMALIZATION_VERSION, readReferralOrderEmailHistoryReady } from "../api/_server/referralOrderEmailHistory.js";
import { assertOrderEmailMigrationTarget, migrateOrderEmailNormalization } from "./orderEmailNormalizationMigration.js";

let passed = 0;
async function test(name: string, run: () => Promise<void> | void) { await run(); console.log(`OK ${++passed} - ${name}`); }
const secret = "fixture-secret-material-with-at-least-32-bytes";
const keyringJson = JSON.stringify({ activeVersion: "v1", keys: { v1: secret } });
const keyring = parseReferralEmailKeyring(keyringJson);
const program = { mode: "active" as const, startsAtEpochMs: 1000, operational: true };
const drain = { ...program, mode: "drain" as const };
const user = { uid: "referee-a", email: "Referee-A@Example.Test ", emailVerified: true };
const sponsor = { uid: "sponsor-a", email: "Sponsor-A@Example.Test", emailVerified: true };
const codeA = "A".repeat(26);
const codeB = "B".repeat(26);
const nowEpochMs = 2000;
const activeIdentity = async (uid: string) => ({ uid, email: uid === sponsor.uid ? sponsor.email! : uid === "sponsor-b" ? "b@example.test" : `${uid}@example.test`, emailVerified: true, disabled: false });

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
  throws(() => parseReferralEmailKeyring("{}"));
  throws(() => parseReferralEmailKeyring(JSON.stringify({ activeVersion: "v2", keys: { v1: secret } })));
  throws(() => parseReferralEmailKeyring(JSON.stringify({ activeVersion: "v1", keys: { v1: "short" } })));
  throws(() => parseReferralEmailKeyring(JSON.stringify({ activeVersion: "v1", keys: { v1: secret, v2: secret, v3: secret, v4: secret, v5: secret } })));
  throws(() => parseReferralEmailKeyring(JSON.stringify({ activeVersion: "bad", keys: { bad: secret } })));
  throws(() => parseReferralEmailKeyring(JSON.stringify({ activeVersion: "v1", keys: { v1: secret, v2: secret } })));
  ok(referralEmailClaimId(secret, user.email!, "v1") !== referralEmailClaimId(secret, user.email!, "v2"));
});
await test("vérification ID token distingue authentification, configuration et indisponibilité", async () => {
  const priorKey = process.env.VITE_FIREBASE_API_KEY;
  const priorFetch = globalThis.fetch;
  try {
    delete process.env.VITE_FIREBASE_API_KEY;
    await rejects(verifyFirebaseIdToken("token"), (error: unknown) => error instanceof FirebaseIdTokenVerificationError && error.category === "configuration");
    process.env.VITE_FIREBASE_API_KEY = "fixture-api-key";
    for (const code of ["INVALID_ID_TOKEN", "TOKEN_EXPIRED", "USER_NOT_FOUND"]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: code } }), { status: 400 });
      await rejects(verifyFirebaseIdToken("bad"), (error: unknown) => error instanceof FirebaseIdTokenVerificationError && error.category === "authentication");
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "API_KEY_INVALID" } }), { status: 400 });
    await rejects(verifyFirebaseIdToken("token"), (error: unknown) => error instanceof FirebaseIdTokenVerificationError && error.category === "configuration");
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    await rejects(verifyFirebaseIdToken("token"), (error: unknown) => error instanceof FirebaseIdTokenVerificationError && error.category === "unavailable");
    globalThis.fetch = async () => { throw new Error("offline"); };
    await rejects(verifyFirebaseIdToken("token"), (error: unknown) => error instanceof FirebaseIdTokenVerificationError && error.category === "unavailable");
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.VITE_FIREBASE_API_KEY; else process.env.VITE_FIREBASE_API_KEY = priorKey;
  }
});
await test("snapshot refuse les lignes nettes nulles et valide la frontière à un centime", () => {
  const make = (lines: { lineId: string; eligibleBeforeReferralCents: number; referralDiscountCents: number }[]) =>
    createReferralOrderSnapshot({ refereeUid: "referee-snapshot", createdAtEpochMs: 2000, lines });
  throws(() => make([{ lineId: "small", eligibleBeforeReferralCents: 500, referralDiscountCents: 500 },
    { lineId: "large", eligibleBeforeReferralCents: 4500, referralDiscountCents: 0 }]), /referral_snapshot_invalid/);
  throws(() => make([{ lineId: "zero", eligibleBeforeReferralCents: 0, referralDiscountCents: 0 },
    { lineId: "large", eligibleBeforeReferralCents: 5000, referralDiscountCents: 500 }]), /referral_snapshot_invalid/);
  throws(() => make([{ lineId: "small", eligibleBeforeReferralCents: 500, referralDiscountCents: 501 },
    { lineId: "large", eligibleBeforeReferralCents: 4500, referralDiscountCents: 0 }]), /referral_snapshot_invalid/);
  const boundary = make([{ lineId: "small", eligibleBeforeReferralCents: 500, referralDiscountCents: 499 },
    { lineId: "large", eligibleBeforeReferralCents: 4500, referralDiscountCents: 1 }]);
  const withNoDiscountLine = make([{ lineId: "discounted", eligibleBeforeReferralCents: 5000, referralDiscountCents: 500 },
    { lineId: "plain", eligibleBeforeReferralCents: 100, referralDiscountCents: 0 }]);
  equal(validateReferralOrderSnapshot({ customerId: "referee-snapshot", referral: boundary } as Order).fingerprint, boundary.fingerprint);
  equal(validateReferralOrderSnapshot({ customerId: "referee-snapshot", referral: withNoDiscountLine } as Order).fingerprint, withNoDiscountLine.fingerprint);
  const { fingerprint, ...facts } = boundary;
  ok(fingerprint);
  const forgedFacts = { ...facts, lines: [{ lineId: "small", eligibleBeforeReferralCents: 500, referralDiscountCents: 500 },
    { lineId: "large", eligibleBeforeReferralCents: 4500, referralDiscountCents: 0 }] };
  const forged = { ...forgedFacts, fingerprint: referralSnapshotFingerprint(forgedFacts) };
  throws(() => validateReferralOrderSnapshot({ customerId: "referee-snapshot", referral: forged } as Order), /referral_snapshot_invalid/);
  const cagnotte = { lines: [{ lineId: "small", netCents: 1 }, { lineId: "large", netCents: 4499 }] } as never;
  equal(referralReturnedProductsCents(boundary, cagnotte, []), 0);
  equal(referralReturnedProductsCents(boundary, cagnotte, [{ lineId: "small", returnedNetCents: 1 }]), 500);
});
await test("lookup Auth Admin du parrain: projet, UID et échec fermés", async () => {
  const requests: Array<{ url: string; authorization: string; body: unknown }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), authorization: String(new Headers(init?.headers).get("authorization")), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ users: [{ localId: sponsor.uid, email: sponsor.email }] }), { status: 200 });
  };
  deepStrictEqual(await lookupReferralSponsorIdentity({ uid: sponsor.uid, projectId: "verdanza-1f621", accessToken: "fixture-token", fetchImpl: fetchImpl as typeof fetch }),
    { uid: sponsor.uid, email: sponsor.email, emailVerified: false, disabled: false });
  deepStrictEqual(requests, [{ url: "https://identitytoolkit.googleapis.com/v1/projects/verdanza-1f621/accounts:lookup", authorization: "Bearer fixture-token", body: { localId: [sponsor.uid] } }]);
  await rejects(lookupReferralSponsorIdentity({ uid: sponsor.uid, projectId: "wrong-project", accessToken: "fixture-token", fetchImpl: fetchImpl as typeof fetch }));
  equal(requests.length, 1);
  await rejects(lookupReferralSponsorIdentity({ uid: sponsor.uid, projectId: "verdanza-1f621", accessToken: "fixture-token", fetchImpl: (async () => new Response(JSON.stringify({ users: [{ localId: "other", email: sponsor.email }] }), { status: 200 })) as typeof fetch }));
  deepStrictEqual(await lookupReferralSponsorIdentity({ uid: sponsor.uid, projectId: "verdanza-1f621", accessToken: "fixture-token",
    fetchImpl: (async () => new Response(JSON.stringify({ users: [{ localId: sponsor.uid, email: sponsor.email, disabled: true }] }), { status: 200 })) as typeof fetch }),
    { uid: sponsor.uid, email: sponsor.email, emailVerified: false, disabled: true });
});
await test("API fermée avant Auth, Firestore et secret", async () => {
  let calls = 0; let status = 0; let body: unknown;
  const handler = createReferralHandler({ runtime: () => REFERRAL_CLOSED_RUNTIME, verify: async () => { calls++; throw new Error(); },
    db: () => { calls++; throw new Error(); }, sponsorIdentity: async () => { calls++; throw new Error(); }, secret: () => { calls++; throw new Error(); }, now: Date.now });
  const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { body = value; } } as unknown as VercelResponseLike;
  await handler({ method: "GET", headers: {} } as VercelRequestLike, response);
  equal(status, 503); deepStrictEqual(body, { code: "referral_program_disabled" }); equal(calls, 0);
  const missingSecret = createReferralHandler({ runtime: () => program, verify: async () => { calls++; throw new Error(); },
    db: () => { calls++; throw new Error(); }, sponsorIdentity: async () => { calls++; throw new Error(); }, secret: () => "short", now: Date.now });
  await missingSecret({ method: "POST", headers: {}, body: { action: "link", code: codeA } } as VercelRequestLike, response);
  equal(status, 503); deepStrictEqual(body, { code: "referral_configuration_invalid" }); equal(calls, 0);
});
await test("API mappe les catégories de token sans lecture Firestore", async () => {
  let missingStatus = 0; let missingBody: unknown;
  const missingHandler = createReferralHandler({ runtime: () => program, verify: async () => { throw new Error("unexpected_auth"); },
    db: () => { throw new Error("unexpected_db"); }, sponsorIdentity: activeIdentity, secret: () => keyringJson, now: () => 2000 });
  const missingResponse = { setHeader() {}, status(value: number) { missingStatus = value; return this; },
    json(value: unknown) { missingBody = value; } } as unknown as VercelResponseLike;
  await missingHandler({ method: "GET", headers: {} } as VercelRequestLike, missingResponse);
  equal(missingStatus, 401); deepStrictEqual(missingBody, { code: "authentication_required" });
  for (const [category, expectedStatus, expectedCode] of [
    ["authentication", 401, "authentication_required"], ["configuration", 503, "referral_configuration_invalid"],
    ["unavailable", 503, "referral_unavailable"],
  ] as const) {
    let dbCalls = 0; let status = 0; let body: unknown;
    const handler = createReferralHandler({ runtime: () => program, verify: async () => { throw new FirebaseIdTokenVerificationError(category); },
      db: () => { dbCalls++; throw new Error("unexpected_db"); }, sponsorIdentity: activeIdentity,
      secret: () => keyringJson, now: () => 2000 });
    const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { body = value; } } as unknown as VercelResponseLike;
    await handler({ method: "GET", headers: { authorization: "Bearer token" } } as VercelRequestLike, response);
    equal(status, expectedStatus); deepStrictEqual(body, { code: expectedCode }); equal(dbCalls, 0);
  }
});

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const historyMarker = db.collection("referralMigrations").doc(ORDER_EMAIL_NORMALIZATION_VERSION);
const completeHistoryMarker = { schemaVersion: 1, version: ORDER_EMAIL_NORMALIZATION_VERSION, status: "complete",
  completedAtEpochMs: 1000, verifiedOrders: 0, verifiedPaidProductOrders: 0 };
await historyMarker.set(completeHistoryMarker);
const sponsorOrder = (id: string, uid: string, status = "delivered") => db.collection("orders").doc(id).set({ customerId: uid, paymentStatus: "paid", orderStatus: status, orderType: "order", total: 60,
  items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] });
await sponsorOrder("referral-sponsor-a", sponsor.uid);
await test("parrain éligible, code stable et collision transactionnelle", async () => {
  const first = await ensureReferralCode({ db, user: sponsor, program, nowEpochMs, codeFactory: () => codeA, getSponsorIdentity: activeIdentity });
  deepStrictEqual(first, { code: codeA, created: true });
  deepStrictEqual(await ensureReferralCode({ db, user: sponsor, program, nowEpochMs, codeFactory: () => codeB, getSponsorIdentity: activeIdentity }), { code: codeA, created: false });
  await sponsorOrder("referral-sponsor-b", "sponsor-b");
  let count = 0;
  const collision = await ensureReferralCode({ db, user: { uid: "sponsor-b", email: "b@example.test" }, program, nowEpochMs, codeFactory: () => ++count === 1 ? codeA : codeB, getSponsorIdentity: activeIdentity });
  equal(collision.code, codeB);
  await rejects(ensureReferralCode({ db, user: { uid: "no-orders", email: "none@example.test" }, program, nowEpochMs, codeFactory: () => "C".repeat(26), getSponsorIdentity: activeIdentity }));
});
await test("précommande parrain payée et livrée compte, non livrée ou fixture non", async () => {
  const uid = "sponsor-paid-preorder";
  const preorderRef = db.collection("orders").doc("referral-sponsor-paid-preorder");
  await preorderRef.set({ customerId: uid, orderType: "preorder", paymentStatus: "paid", orderStatus: "confirmed",
    total: 60, items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] });
  equal(await db.runTransaction((tx) => sponsorHasDeliveredPaidOrder(tx, db, uid)), false);
  await preorderRef.update({ orderStatus: "delivered" });
  equal(await db.runTransaction((tx) => sponsorHasDeliveredPaidOrder(tx, db, uid)), true);
  const unpaidUid = "sponsor-unpaid-preorder";
  await db.collection("orders").doc("referral-sponsor-unpaid-preorder").set({ customerId: unpaidUid,
    orderType: "preorder", paymentStatus: "to_confirm", orderStatus: "delivered", total: 60,
    items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] });
  equal(await db.runTransaction((tx) => sponsorHasDeliveredPaidOrder(tx, db, unpaidUid)), false);
  const fixtureUid = "sponsor-fixture-preorder";
  await db.collection("orders").doc("referral-sponsor-fixture-preorder").set({ customerId: fixtureUid,
    orderType: "preorder", paymentStatus: "paid", orderStatus: "delivered", productionFixture: true,
    total: 60, items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] });
  equal(await db.runTransaction((tx) => sponsorHasDeliveredPaidOrder(tx, db, fixtureUid)), false);
  const legacyUid = "sponsor-legacy-no-order-type";
  await db.collection("orders").doc("referral-sponsor-legacy-no-order-type").set({ customerId: legacyUid,
    paymentStatus: "paid", orderStatus: "delivered", total: 60,
    items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] });
  equal(await db.runTransaction((tx) => sponsorHasDeliveredPaidOrder(tx, db, legacyUid)), true);
});
await test("code existant refusé pendant l'inéligibilité puis récupéré sans rotation", async () => {
  const owner = { uid: "sponsor-reeligible", email: "reeligible@example.test", emailVerified: true };
  const firstOrderId = "referral-sponsor-reeligible-first";
  const stableCode = "E".repeat(26);
  await sponsorOrder(firstOrderId, owner.uid);
  deepStrictEqual(await ensureReferralCode({ db, user: owner, program, nowEpochMs, codeFactory: () => stableCode,
    getSponsorIdentity: activeIdentity }), { code: stableCode, created: true });
  const ownerRef = db.collection("referralCodes").doc(`owner_${owner.uid}`);
  const codeRef = db.collection("referralCodes").doc(`code_${stableCode}`);
  const originalOwner = (await ownerRef.get()).data();
  const originalCode = (await codeRef.get()).data();
  await db.collection("orders").doc(firstOrderId).update({ orderStatus: "cancelled" });
  await rejects(ensureReferralCode({ db, user: owner, program, nowEpochMs, codeFactory: () => "F".repeat(26),
    getSponsorIdentity: activeIdentity }), { code: "sponsor_ineligible", status: 403 });
  deepStrictEqual((await ownerRef.get()).data(), originalOwner);
  deepStrictEqual((await codeRef.get()).data(), originalCode);
  equal((await db.collection("referralCodes").doc(`code_${"F".repeat(26)}`).get()).exists, false);
  await sponsorOrder("referral-sponsor-reeligible-second", owner.uid);
  deepStrictEqual(await ensureReferralCode({ db, user: owner, program, nowEpochMs, codeFactory: () => "G".repeat(26),
    getSponsorIdentity: activeIdentity }), { code: stableCode, created: false });
  deepStrictEqual((await ownerRef.get()).data(), originalOwner);
  deepStrictEqual((await codeRef.get()).data(), originalCode);
});
await test("compte parrain désactivé ne crée ni ne récupère un code et ne crée aucun lien", async () => {
  const disabledIdentity = async (uid: string) => ({ uid, email: uid === sponsor.uid ? sponsor.email! : "b@example.test", disabled: true });
  await rejects(ensureReferralCode({ db, user: sponsor, program, nowEpochMs, codeFactory: () => codeA,
    getSponsorIdentity: disabledIdentity }), { code: "sponsor_ineligible" });
  await sponsorOrder("referral-sponsor-disabled-new", "sponsor-disabled-new");
  await rejects(ensureReferralCode({ db, user: { uid: "sponsor-disabled-new", email: "disabled@example.test" }, program, nowEpochMs,
    codeFactory: () => "D".repeat(26), getSponsorIdentity: disabledIdentity }), { code: "sponsor_ineligible" });
  equal((await db.collection("referralCodes").doc("owner_sponsor-disabled-new").get()).exists, false);
  const child = { uid: "referee-disabled-link", email: "disabled-link@example.test", emailVerified: true };
  await rejects(linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: disabledIdentity }),
    { code: "sponsor_ineligible" });
  equal((await db.collection("referrals").doc(child.uid).get()).exists, false);
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, child.email)).get()).exists, false);
});
await test("lien, claim, replay, changement avant paiement et projection privée", async () => {
  const args = { db, user, code: codeA, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity };
  deepStrictEqual(await linkReferral(args), { state: "linked", changed: true });
  deepStrictEqual(await linkReferral(args), { state: "linked", changed: false });
  const claim = await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, user.email!)).get();
  equal(claim.data()?.refereeUid, user.uid); ok(!JSON.stringify(claim.data()).includes("example.test"));
  const changed = await linkReferral({ ...args, code: codeB, getSponsorIdentity: activeIdentity });
  equal(changed.changed, true);
  const self = await readReferralSelf(db, user.uid);
  deepStrictEqual(self, { code: null, relation: { state: "linked", paymentConfirmed: false, deliveryConfirmed: false } });
  ok(!JSON.stringify(self).includes("sponsor"));
  await rejects(linkReferral({ ...args, user: { uid: "another-uid", email: user.email, emailVerified: true } }));
  await rejects(linkReferral({ ...args, user: sponsor }));
  await rejects(linkReferral({ ...args, user: { ...user, emailVerified: false } }));
  await rejects(linkReferral({ ...args, program: drain }));
});
await test("relink A vers B vers A crée deux événements append-only sans événement de replay", async () => {
  const child = { uid: "referee-relink-audit", email: "referee-relink-audit@example.test", emailVerified: true };
  const args = { db, user: child, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity };
  await linkReferral({ ...args, code: codeA });
  await linkReferral({ ...args, code: codeB });
  await linkReferral({ ...args, code: codeB });
  await linkReferral({ ...args, code: codeA });
  const events = (await db.collection("referrals").doc(child.uid).collection("events").orderBy("revision").get()).docs.map((doc) => doc.data());
  equal(events.length, 2);
  deepStrictEqual(events.map((event) => [event.previousSponsorUid, event.nextSponsorUid, event.revision]),
    [[sponsor.uid, "sponsor-b", 1], ["sponsor-b", sponsor.uid, 2]]);
  ok(events.every((event) => event.type === "sponsor_relinked" && event.previousLinkedAtEpochMs === nowEpochMs && event.changedAtEpochMs === nowEpochMs));
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.relinkRevision, 2);
});
await test("rotation HMAC lit v1 et legacy, crée v2 et conserve l'unicité", async () => {
  const secondSecret = "fixture-second-key-material-at-least-32-bytes";
  const rotated = parseReferralEmailKeyring(JSON.stringify({ activeVersion: "v2", keys: { v1: secret, v2: secondSecret } }));
  const onlyV2 = parseReferralEmailKeyring(JSON.stringify({ activeVersion: "v2", keys: { v2: secondSecret } }));
  const child = { uid: "referee-key-rotation", email: "rotation@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity });
  await rejects(linkReferral({ db, user: { ...child, uid: "referee-key-rotation-other" }, code: codeB, keyring: rotated,
    program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referral_email_claimed" });
  await linkReferral({ db, user: child, code: codeB, keyring: rotated, program, nowEpochMs, getSponsorIdentity: activeIdentity });
  const v2Id = referralEmailClaimId(secondSecret, child.email, "v2");
  equal((await db.collection("referralEmailClaims").doc(v2Id).get()).data()?.keyVersion, "v2");
  await rejects(linkReferral({ db, user: { ...child, uid: "referee-key-rotation-after-removal" }, code: codeB, keyring: onlyV2,
    program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referral_email_claimed" });
  const legacyEmail = "legacy-claim-rotation@example.test";
  const legacyId = createHmac("sha256", secret).update(legacyEmail).digest("hex");
  await db.collection("referralEmailClaims").doc(legacyId).set({ schemaVersion: 1, programVersion: "referral-commercial-policy-v1",
    keyVersion: "referral-email-hmac-v1", refereeUid: "historical-owner", referralId: "historical-owner", createdAtEpochMs: nowEpochMs });
  await rejects(linkReferral({ db, user: { uid: "legacy-claim-new-account", email: legacyEmail, emailVerified: true }, code: codeB,
    keyring: rotated, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referral_email_claimed" });
});

const snapshot = createReferralOrderSnapshot({ refereeUid: user.uid, createdAtEpochMs: 2000,
  lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] });
const order = { id: "referral-order-a", customerId: user.uid, paymentStatus: "to_confirm", orderStatus: "contact_required", referral: snapshot } as Order;
const transition = async (source: Order, event: "payment" | "payment_and_delivery" | "delivery" | "refund" | "correction", refundId?: string, returned = 0,
  mode: Parameters<typeof prepareReferralTransition>[0]["program"] = program) => {
  const relationBefore = event === "payment" || event === "payment_and_delivery"
    ? (await db.collection("referrals").doc(source.referral!.referralId).get()).data() as ReferralRelation : null;
  const paymentEvidence: ReferralPaymentEvidence | undefined = relationBefore ? { referralId: source.referral!.referralId,
    sponsorUid: relationBefore.sponsorUid, refereeUid: relationBefore.refereeUid, linkedAtEpochMs: relationBefore.linkedAtEpochMs,
    sponsorAccount: "active", refereeAccount: "active", sponsorEmail: `${relationBefore.sponsorUid}@example.test`,
    refereeEmail: `${relationBefore.refereeUid}@example.test`, activeKeyVersion: keyring.activeVersion,
    claimAliases: referralEmailClaimAliases(keyring, `${relationBefore.refereeUid}@example.test`) } : undefined;
  return db.runTransaction(async (transaction) => {
    const plan = await prepareReferralTransition({ db, transaction, order: source, program: mode, event, recordedAtEpochMs: nowEpochMs,
      paymentEvidence, ...(refundId ? { refundId, cumulativeReturnedProductsCents: returned } : {}) });
    plan?.write(); return plan?.status;
  });
};
const relation = async () => (await db.collection("referrals").doc(user.uid).get()).data() as ReferralRelation;
const wallet = async (uid: string) => (await db.collection("cagnotteWallets").doc(uid).get()).data()!;
const routeActor = { uid: "fixture-admin", email: "fixture-admin@example.test" };
const routeTransition = (orderId: string, body: Omit<Parameters<typeof commitOrderStatusTransition>[0]["body"], "orderId">, mode = program,
  getSponsorIdentity = activeIdentity) =>
  commitOrderStatusTransition({ db, body: { orderId, ...body }, admin: routeActor, referralProgram: mode,
    getSponsorIdentity, referralEmailKeyring: () => keyringJson,
    now: () => "2000-01-03T00:00:00.000Z" });
const routeRelation = async (uid: string) => (await db.collection("referrals").doc(uid).get()).data() as ReferralRelation;
const routeMovements = async (orderId: string) => (await db.collection("cagnotteMovements").where("orderId", "==", orderId).get()).docs;
const routeReferralMovements = async (orderId: string) => (await routeMovements(orderId)).filter((doc) =>
  String(doc.data().businessEvent).startsWith("referral_"));
const capturePaymentState = async () => Promise.all(["orders", "referrals", "referralEmailClaims", "referralMigrations", "cagnotteWallets",
  "cagnotteReservations", "cagnotteMovements", "analyticsOutbox", "analyticsOperationalEvents", "products"].map(async (name) =>
  (await db.collection(name).get()).docs.map((doc) => ({ id: doc.id, data: doc.data(), updatedAt: doc.updateTime.toMillis() }))));
async function createRouteCandidate(orderId: string, uid: string, code = codeB) {
  const child = { uid, email: `${uid}@example.test`, emailVerified: true };
  await linkReferral({ db, user: child, code, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity });
  const productId = `product-${orderId}`;
  await db.collection("products").doc(productId).set({ stock: 10 });
  await db.collection("orders").doc(orderId).set({ id: orderId, customerId: uid, customerName: "Synthetic", customerEmail: child.email,
    orderStatus: "confirmed", paymentStatus: "to_confirm", deliveryMethod: "postal", deliveryFee: 0,
    subtotal: 60, total: 55, discountAmount: 5, promotionDiscountTotal: 0,
    createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z",
    items: [{ lineId: "line", productId, name: "Synthetic", quantity: 1, unitPrice: 60, lineTotal: 60 }],
    referral: createReferralOrderSnapshot({ refereeUid: uid, createdAtEpochMs: 2000,
      lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] }) });
  return child;
}

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
await test("remboursement et correction convertissent deux lignes à net positif", async () => {
  const child = { uid: "referee-multiline-refund", email: "multiline-refund@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity });
  const referral = createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000,
    lines: [{ lineId: "small", eligibleBeforeReferralCents: 500, referralDiscountCents: 499 },
      { lineId: "large", eligibleBeforeReferralCents: 4500, referralDiscountCents: 1 }] });
  const own = { id: "referral-order-multiline-refund", customerId: child.uid, paymentStatus: "paid", orderStatus: "delivered", referral } as Order;
  const cagnotte = { lines: [{ lineId: "small", netCents: 1 }, { lineId: "large", netCents: 4499 }] } as never;
  equal(await transition(own, "payment_and_delivery"), "applied");
  const returned = referralReturnedProductsCents(referral, cagnotte, [{ lineId: "small", returnedNetCents: 1 }]);
  equal(returned, 500);
  equal(await transition(own, "refund", "multiline-refund", returned), "applied");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "reversed");
  equal(await transition(own, "correction", "multiline-correction", referralReturnedProductsCents(referral, cagnotte, [])), "applied");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "rewarded");
});
await test("conversion des retours figée avant remise", () => {
  const cagnotte = { lines: [{ lineId: "line", netCents: 5500 }] } as never;
  equal(referralReturnedProductsCents(snapshot, cagnotte, [{ lineId: "line", returnedNetCents: 5500 }]), 6000);
  equal(referralReturnedProductsCents(snapshot, cagnotte, [{ lineId: "line", returnedNetCents: 1100 }]), 1200);
});
await test("filleul déjà payé refusé par UID ou email historique", async () => {
  const historical = { uid: "referee-old", email: "old@example.test", emailVerified: true };
  await sponsorOrder("referral-prior-uid", historical.uid);
  await rejects(linkReferral({ db, user: historical, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }));
  await db.collection("orders").doc("referral-prior-email").set({ customerId: "legacy-id", customerEmail: "legacy@example.test", paymentStatus: "paid", orderStatus: "delivered", orderType: "order", total: 60,
    items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] });
  await rejects(linkReferral({ db, user: { uid: "referee-legacy", email: "legacy@example.test", emailVerified: true }, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }));
});
await test("paiement historique survit à annulation et remboursement, y compris par email legacy", async () => {
  const base = { orderType: "order", total: 60, items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] };
  const paidAt = "2000-01-02T00:00:00.000Z";
  ok(hasHistoricalPaymentEvidence({ ...base, paymentStatus: "cancelled", orderStatus: "cancelled", paidAt, deletedAt: paidAt }));
  ok(!hasHistoricalPaymentEvidence({ ...base, paymentStatus: "payment_link_sent", paidAt: "invalid" }));
  ok(!hasHistoricalPaymentEvidence({ ...base, paymentStatus: "payment_link_sent", paidAt: "2000-02-31T00:00:00.000Z" }));
  ok(!hasHistoricalPaymentEvidence({ ...base, paymentStatus: "pending", paymentReference: "reference-only" }));
  const cancelled = { uid: "referee-paid-cancelled", email: "paid-cancelled@example.test", emailVerified: true };
  await db.collection("orders").doc("referral-history-paid-cancelled").set({ ...base, customerId: cancelled.uid,
    paymentStatus: "cancelled", orderStatus: "cancelled", paidAt, paymentConfirmedAt: paidAt, cancelledAt: paidAt, deletedAt: paidAt });
  await rejects(linkReferral({ db, user: cancelled, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }),
    { code: "referee_already_paid" });
  const refunded = { uid: "referee-paid-refunded", email: "paid-refunded@example.test", emailVerified: true };
  await db.collection("orders").doc("referral-history-paid-refunded").set({ ...base, customerId: refunded.uid,
    paymentStatus: "cancelled", orderStatus: "cancelled", paymentConfirmedAt: paidAt, refundSummary: { refundedCents: 5500 } });
  await rejects(linkReferral({ db, user: refunded, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }),
    { code: "referee_already_paid" });
  const legacy = { uid: "referee-paid-legacy", email: "paid-legacy@example.test", emailVerified: true };
  await db.collection("orders").doc("referral-history-paid-legacy").set({ ...base, customerId: "old-legacy-uid",
    customerEmail: legacy.email, paymentStatus: "cancelled", orderStatus: "cancelled", paidAt });
  await rejects(linkReferral({ db, user: legacy, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }),
    { code: "referee_already_paid" });
});
await test("preuves historiques ISO avec offset gardent un calendrier civil strict", async () => {
  for (const value of ["2026-09-24T10:00:00+02:00", "2026-09-24T08:00:00Z",
    "2026-09-24T10:00:00-05:30", "2026-09-24T10:00:00.123+02:00", "2024-02-29T23:59:59+01:00",
    "2026-09-24T10:00:00.1Z", "2026-09-24T10:00:00.12Z"])
    equal(isValidHistoricalPaymentInstant(value), true, value);
  for (const value of ["2026-02-29T10:00:00+02:00", "2026-04-31T10:00:00+02:00",
    "2026-13-01T10:00:00+02:00", "2026-00-01T10:00:00+02:00", "2026-09-24T24:01:00+02:00",
    "2026-09-24T10:60:00+02:00", "2026-09-24T10:00:60+02:00", "2026-09-24T10:00:00+02:60",
    "2026-09-24T10:00:00+2:00", "2026-09-24T10:00:00+24:00", "2000-02-31T00:00:00.000Z",
    "2026-09-24T10:00:00.1234Z", "2026-09-24 10:00:00Z"])
    equal(isValidHistoricalPaymentInstant(value), false, value);
  const base = { orderType: "order", total: 60, items: [{ productId: "fixture-product", quantity: 1 }] };
  ok(hasHistoricalPaymentEvidence({ ...base, paymentStatus: "cancelled", orderStatus: "cancelled",
    paidAt: "2026-09-24T10:00:00+02:00" }));
  const uid = "referee-offset-history-uid";
  const uidOrderId = "referral-offset-history-uid";
  await db.collection("orders").doc(uidOrderId).set({ ...base, customerId: uid,
    paymentStatus: "cancelled", orderStatus: "cancelled", paidAt: "2026-09-24T10:00:00+02:00" });
  equal((await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, uid, "candidate-offset-uid"))).kind, "found");
  await rejects(linkReferral({ db, user: { uid, email: "offset-uid@example.test", emailVerified: true }, code: codeB,
    keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referee_already_paid" });
  const email = "offset-legacy@example.test";
  const emailOrderId = "referral-offset-history-email";
  await db.collection("orders").doc(emailOrderId).set({ ...base, customerId: "historical-offset-legacy-uid",
    customerEmail: email, paymentStatus: "cancelled", orderStatus: "cancelled",
    paymentConfirmedAt: "2026-09-24T10:00:00-05:30" });
  const emailHistory = await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, "new-offset-legacy-uid", "candidate-offset-email", email, email));
  deepStrictEqual(emailHistory, { kind: "found", orderId: emailOrderId });
  await rejects(linkReferral({ db, user: { uid: "new-offset-legacy-uid", email, emailVerified: true }, code: codeB,
    keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referee_already_paid" });
  const candidateId = "referral-offset-second-candidate";
  const candidate = await createRouteCandidate(candidateId, "referee-offset-second-candidate");
  await db.collection("orders").doc("referral-offset-first-paid").set({ ...base, customerId: candidate.uid,
    paymentStatus: "cancelled", orderStatus: "cancelled", paidAt: "2026-09-24T10:00:00+02:00" });
  const beforeWallet = await wallet("sponsor-b");
  await rejects(routeTransition(candidateId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    (error: unknown) => error instanceof ReferralError && error.code === "referral_discount_already_consumed");
  equal((await db.collection("orders").doc(candidateId).get()).data()?.paymentStatus, "to_confirm");
  equal((await routeRelation(candidate.uid)).state, "linked");
  equal((await routeReferralMovements(candidateId)).length, 0);
  deepStrictEqual(await wallet("sponsor-b"), beforeWallet);
});
await test("précommandes produits payées ferment le lien par UID et email legacy", async () => {
  const base = { orderType: "preorder", total: 60,
    items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] };
  const paidAt = "2026-09-24T10:00:00+02:00";
  for (const [suffix, facts] of [
    ["paid", { paymentStatus: "paid", orderStatus: "confirmed" }],
    ["cancelled", { paymentStatus: "cancelled", orderStatus: "cancelled", paidAt }],
    ["refunded", { paymentStatus: "cancelled", orderStatus: "cancelled", paymentConfirmedAt: paidAt,
      refundSummary: { refundedCents: 6000 }, deletedAt: paidAt }],
  ] as const) {
    const child = { uid: `referee-preorder-history-${suffix}`, email: `preorder-history-${suffix}@example.test`, emailVerified: true };
    const orderId = `referral-preorder-history-${suffix}`;
    await db.collection("orders").doc(orderId).set({ ...base, ...facts, customerId: child.uid });
    ok(hasHistoricalPaymentEvidence({ ...base, ...facts }), suffix);
    deepStrictEqual(await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, child.uid, null)),
      { kind: "found", orderId });
    await rejects(linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs,
      getSponsorIdentity: activeIdentity }), { code: "referee_already_paid" });
  }
  const legacy = { uid: "referee-preorder-history-legacy", email: "preorder-legacy@example.test", emailVerified: true };
  const legacyId = "referral-preorder-history-legacy";
  await db.collection("orders").doc(legacyId).set({ ...base, customerId: "old-preorder-legacy-uid",
    customerEmail: legacy.email, paymentStatus: "cancelled", orderStatus: "cancelled", paidAt });
  deepStrictEqual(await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, legacy.uid, null,
    legacy.email, legacy.email)), { kind: "found", orderId: legacyId });
  await rejects(linkReferral({ db, user: legacy, code: codeB, keyring, program, nowEpochMs,
    getSponsorIdentity: activeIdentity }), { code: "referee_already_paid" });
});
await test("précommandes impayées et lien de paiement envoyé ne ferment pas le lien", async () => {
  const child = { uid: "referee-unpaid-preorders", email: "unpaid-preorders@example.test", emailVerified: true };
  const base = { orderType: "preorder", customerId: child.uid, total: 60,
    items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] };
  for (const [suffix, paymentStatus] of [
    ["created", "to_confirm"], ["pending", "pending"], ["link", "payment_link_sent"],
    ["cancelled", "cancelled"],
  ] as const) {
    const order = { ...base, paymentStatus, orderStatus: paymentStatus === "cancelled" ? "cancelled" : "confirmed" };
    await db.collection("orders").doc(`referral-unpaid-preorder-${suffix}`).set(order);
    equal(hasHistoricalPaymentEvidence(order), false, suffix);
  }
  deepStrictEqual(await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, child.uid, null)), { kind: "none" });
  deepStrictEqual(await linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs,
    getSponsorIdentity: activeIdentity }), { state: "linked", changed: true });
});
await test("annulation impayée et lien envoyé ne disqualifient pas; historique borné refuse l'ambiguïté", async () => {
  const base = { orderType: "order", total: 60, items: [{ productId: "fixture-product", quantity: 1, lineTotal: 60 }] };
  const child = { uid: "referee-unpaid-history", email: "unpaid-history@example.test", emailVerified: true };
  await db.collection("orders").doc("referral-history-unpaid-cancelled").set({ ...base, customerId: child.uid,
    paymentStatus: "cancelled", orderStatus: "cancelled", cancelledAt: "2000-01-02T00:00:00.000Z" });
  await db.collection("orders").doc("referral-history-link-sent").set({ ...base, customerId: child.uid,
    paymentStatus: "payment_link_sent", orderStatus: "confirmed", paymentReference: "reference-only" });
  deepStrictEqual(await linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }),
    { state: "linked", changed: true });
  const crowded = { uid: "referee-crowded-history", email: "crowded-history@example.test", emailVerified: true };
  const batch = db.batch();
  for (let index = 0; index < 100; index++) batch.set(db.collection("orders").doc(`referral-history-crowded-${index}`), {
    ...base, customerId: crowded.uid, paymentStatus: "to_confirm", orderStatus: "confirmed" });
  await batch.commit();
  await rejects(linkReferral({ db, user: crowded, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }),
    { code: "referral_history_inconclusive" });
});
await test("livraison avant paiement aboutit au même droit", async () => {
  const child = { uid: "referee-inverse", email: "inverse@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity });
  const own = { ...order, id: "referral-order-inverse", customerId: child.uid,
    referral: createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000, lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] }) } as Order;
  const linked = (await db.collection("referrals").doc(child.uid).get()).data();
  equal(await transition(own, "delivery"), "already_applied");
  deepStrictEqual((await db.collection("referrals").doc(child.uid).get()).data(), linked);
  equal(await transition(own, "payment_and_delivery"), "applied");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "rewarded");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.deliveredOrderId, own.id);
  equal(await transition(own, "payment"), "already_applied");
});
await test("paiement concurrent avec gain fidélité personnel partage le wallet", async () => {
  const child = { uid: "referee-concurrent", email: "concurrent@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity });
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
  await linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity });
  const id = "referral-order-admin-refund";
  const referral = createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000,
    lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] });
  const cagnotte = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 6000 }],
    discounts: [{ discountId: "referral", amountCents: 500, kind: "referral_discount", lineIds: ["line"] }],
    requestedCagnotteCents: 0, availableCagnotteCents: 0, advantages: ["referral_discount"] });
  const data = { id, customerId: child.uid, customerName: "Synthetic", customerEmail: child.email,
    orderStatus: "delivered", paymentStatus: "paid", deliveryMethod: "postal", deliveryFee: 0,
    subtotal: 60, total: 55, discountAmount: 5, promotionDiscountTotal: 0,
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
await test("remboursement confirmé après annulation statutaire contrepasse seulement alors le parrainage", async () => {
  const child = { uid: "referee-refund-after-status-cancel", email: "refund-after-status-cancel@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity });
  const id = "referral-order-refund-after-status-cancel";
  const cagnotte = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 6000 }],
    discounts: [{ discountId: "referral", amountCents: 500, kind: "referral_discount", lineIds: ["line"] }],
    requestedCagnotteCents: 0, availableCagnotteCents: 0, advantages: ["referral_discount"] });
  const loyaltyProgram = { mode: "local_test" as const, programVersion: "fixture-referral-loyalty-v1", calculationVersion: "cagnotte-math-v1" as const,
    startsAtEpochMs: 1000, newAccrualsEnabled: true };
  await db.collection("products").doc(`product-${id}`).set({ stock: 10 });
  const data = { id, customerId: child.uid, customerName: "Synthetic", customerEmail: child.email,
    orderStatus: "delivered", paymentStatus: "paid", deliveryMethod: "postal", deliveryFee: 0,
    subtotal: 60, total: 55, discountAmount: 5, promotionDiscountTotal: 0,
    createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-02T00:00:00.000Z", paidAt: "2000-01-02T00:00:00.000Z",
    paymentConfirmedAt: "2000-01-02T00:00:00.000Z", paymentConfirmedBy: "fixture-admin@example.test", finalPaymentMethod: "card_payment_link",
    items: [{ lineId: "line", productId: `product-${id}`, name: "Synthetic", quantity: 1, unitPrice: 60, lineTotal: 60 }],
    cagnotte: { schemaVersion: 1, beneficiaryId: child.uid, programVersion: loyaltyProgram.programVersion,
      calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000, snapshot: cagnotte },
    referral: createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000,
      lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] }) } as const;
  await db.collection("orders").doc(id).set(data);
  await applyCagnotteLedgerOperation({ db, program: loyaltyProgram, command: { event: "payment_and_delivery_confirmed",
    order: { orderId: id, beneficiaryId: child.uid, programVersion: loyaltyProgram.programVersion, createdAtEpochMs: 2000, snapshot: cagnotte } }, recordedAtEpochMs: 2000 });
  await transition(data as unknown as Order, "payment_and_delivery");
  const before = await wallet("sponsor-b");
  await routeTransition(id, { orderStatus: "cancelled" });
  equal((await routeRelation(child.uid)).state, "rewarded");
  deepStrictEqual(await wallet("sponsor-b"), before);
  equal((await routeReferralMovements(id)).length, 2);
  const request = { action: "preview" as const, orderId: id, currency: "EUR" as const,
    additionalReturns: [{ lineId: "line", additionalNetCents: 1100 }], deliveryRefundCents: 0 };
  const common = { db, actor: routeActor, now: () => "2000-01-04T00:00:00.000Z", referralProgram: program };
  const preview = await executeOrderRefund({ ...common, request });
  equal(preview.kind, "refund_preview");
  const confirmed = await executeOrderRefund({ ...common, request: { ...request, action: "record_confirmed", source: "admin",
    reference: "refund-after-status-cancel", declaredFinancialCents: preview.totalFinancialCents, reason: "product_return",
    confirmedAt: "2000-01-03T00:00:00.000Z", expectedPreviewVersion: preview.previewVersion } });
  equal(confirmed.kind, "administrative_refund_recorded");
  equal((await routeRelation(child.uid)).state, "reversed");
  equal((await routeReferralMovements(id)).length, 3);
});
await test("transition de commande appelle paiement et livraison parrainage dans la même transaction", async () => {
  const child = { uid: "referee-order-route", email: "order-route@example.test", emailVerified: true };
  await linkReferral({ db, user: child, code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity });
  const id = "referral-order-route";
  await db.collection("orders").doc(id).set({ id, customerId: child.uid, customerName: "Synthetic", customerEmail: child.email,
    orderStatus: "confirmed", paymentStatus: "to_confirm", deliveryMethod: "postal", deliveryFee: 0,
    subtotal: 60, total: 55, discountAmount: 5, promotionDiscountTotal: 0,
    createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z",
    items: [{ lineId: "line", productId: "referral-product", name: "Synthetic", quantity: 1, unitPrice: 60, lineTotal: 60 }],
    referral: createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000,
      lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] }) });
  const actor = { uid: "fixture-admin", email: "fixture-admin@example.test" };
  const before = (await wallet("sponsor-b")).pendingCents;
  await commitOrderStatusTransition({ db, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
    admin: actor, referralProgram: program, getSponsorIdentity: activeIdentity, referralEmailKeyring: () => keyringJson,
    now: () => "2000-01-02T00:00:00.000Z" });
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "pending");
  equal((await wallet("sponsor-b")).pendingCents, before + 1000);
  const pendingRelation = await routeRelation(child.uid);
  const pendingWallet = await wallet("sponsor-b");
  const pendingMovements = (await routeMovements(id)).length;
  await routeTransition(id, { paymentStatus: "paid" });
  deepStrictEqual(await routeRelation(child.uid), pendingRelation);
  deepStrictEqual(await wallet("sponsor-b"), pendingWallet);
  equal((await routeMovements(id)).length, pendingMovements);
  await commitOrderStatusTransition({ db, body: { orderId: id, orderStatus: "delivered" }, admin: actor, referralProgram: drain, getSponsorIdentity: activeIdentity,
    now: () => "2000-01-03T00:00:00.000Z" });
  equal((await db.collection("orders").doc(id).get()).data()?.orderStatus, "delivered");
  equal((await db.collection("referrals").doc(child.uid).get()).data()?.state, "rewarded");
  equal((await wallet("sponsor-b")).pendingCents, before);
  equal((await routeMovements(id)).length, pendingMovements + 1);
  await routeTransition(id, { orderStatus: "delivered" });
  equal((await routeMovements(id)).length, pendingMovements + 1);
});
await test("replay paid avec livraison réelle libère le gain une seule fois", async () => {
  const id = "referral-order-paid-and-delivered-route";
  const child = await createRouteCandidate(id, "referee-paid-and-delivered-route");
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const before = await wallet("sponsor-b");
  await routeTransition(id, { paymentStatus: "paid", orderStatus: "delivered" });
  equal((await routeRelation(child.uid)).state, "rewarded");
  equal((await wallet("sponsor-b")).pendingCents, before.pendingCents - 1000);
  equal((await wallet("sponsor-b")).availableCents, before.availableCents + 1000);
  equal((await routeMovements(id)).length, 2);
  await routeTransition(id, { paymentStatus: "paid", orderStatus: "delivered" });
  equal((await routeMovements(id)).length, 2);
});
await test("commande parrain non éligible au paiement filleul ne reçoit aucun gain", async () => {
  const sponsorUid = "sponsor-no-longer-eligible";
  const sponsorOrderId = "referral-sponsor-no-longer-eligible";
  const code = "C".repeat(26);
  await sponsorOrder(sponsorOrderId, sponsorUid);
  await ensureReferralCode({ db, user: { uid: sponsorUid, email: "former@example.test" }, program, nowEpochMs,
    codeFactory: () => code, getSponsorIdentity: activeIdentity });
  const id = "referral-order-sponsor-no-longer-eligible";
  const child = await createRouteCandidate(id, "referee-sponsor-no-longer-eligible", code);
  const currentEmail = "changed-sponsor-ineligible@example.test";
  await db.collection("orders").doc(sponsorOrderId).update({ paymentStatus: "cancelled", orderStatus: "cancelled",
    paidAt: "2000-01-02T00:00:00.000Z", paymentConfirmedAt: "2000-01-02T00:00:00.000Z" });
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
    async (uid) => uid === child.uid ? { uid, email: currentEmail, emailVerified: true, disabled: false } : activeIdentity(uid));
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  const relation = await routeRelation(child.uid);
  equal(relation.state, "cancelled");
  equal(relation.paymentConfirmed, true);
  equal(relation.qualifyingOrderId, id);
  equal(relation.rewardIneligibilityReason, "sponsor_no_longer_eligible");
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, currentEmail)).get()).data()?.refereeUid, child.uid);
  equal((await db.collection("cagnotteWallets").doc(sponsorUid).get()).exists, false);
  equal((await routeMovements(id)).length, 0);
  await routeTransition(id, { orderStatus: "delivered" });
  equal((await routeRelation(child.uid)).state, "cancelled");
  equal((await routeMovements(id)).length, 0);
});
await test("désactivation et indisponibilité Auth au paiement ne créent aucun gain", async () => {
  const disabledEmail = "changed-disabled-sponsor@example.test";
  const disabledIdentity = async (uid: string) => uid === "sponsor-b"
    ? { uid, email: "b@example.test", emailVerified: true, disabled: true }
    : { uid, email: disabledEmail, emailVerified: true, disabled: false };
  const before = await wallet("sponsor-b");
  const disabledId = "referral-order-disabled-at-payment";
  const disabledChild = await createRouteCandidate(disabledId, "referee-disabled-at-payment");
  await routeTransition(disabledId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program, disabledIdentity);
  equal((await db.collection("orders").doc(disabledId).get()).data()?.paymentStatus, "paid");
  equal((await routeRelation(disabledChild.uid)).rewardIneligibilityReason, "sponsor_account_disabled");
  equal((await routeRelation(disabledChild.uid)).state, "cancelled");
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, disabledEmail)).get()).data()?.refereeUid, disabledChild.uid);
  await rejects(linkReferral({ db, user: { uid: "second-uid-disabled-email", email: disabledEmail, emailVerified: true },
    code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referral_email_claimed" });
  deepStrictEqual(await wallet("sponsor-b"), before);
  equal((await routeMovements(disabledId)).length, 0);
  await routeTransition(disabledId, { orderStatus: "delivered" });
  equal((await routeMovements(disabledId)).length, 0);
  const conflictId = "referral-order-disabled-claim-conflict";
  const conflictChild = await createRouteCandidate(conflictId, "referee-disabled-claim-conflict");
  const conflictEmail = "changed-disabled-conflict@example.test";
  const conflictRef = db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, conflictEmail));
  await conflictRef.set({ schemaVersion: 1, programVersion: "referral-commercial-policy-v1", keyVersion: "v1",
    refereeUid: "other-referee", referralId: "other-referee", createdAtEpochMs: 1000 });
  const conflictBefore = await capturePaymentState();
  await rejects(routeTransition(conflictId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
    async (uid) => uid === conflictChild.uid ? { uid, email: conflictEmail, emailVerified: true, disabled: false } : disabledIdentity(uid)),
  (error: unknown) => error instanceof ReferralError && error.status === 409 && error.code === "referee_email_claimed");
  deepStrictEqual(await capturePaymentState(), conflictBefore);
  equal((await conflictRef.get()).data()?.refereeUid, "other-referee");
  equal((await routeReferralMovements(conflictId)).length, 0);
  const outageId = "referral-order-auth-outage";
  const outageChild = await createRouteCandidate(outageId, "referee-auth-outage");
  const outageEmail = "changed-auth-outage@example.test";
  await routeTransition(outageId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
    async (uid) => {
      if (uid === "sponsor-b") throw new Error("fixture_auth_unavailable");
      return { uid, email: outageEmail, emailVerified: true, disabled: false };
    });
  equal((await db.collection("orders").doc(outageId).get()).data()?.paymentStatus, "paid");
  equal((await routeRelation(outageChild.uid)).rewardIneligibilityReason, "sponsor_identity_unavailable");
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, outageEmail)).get()).data()?.refereeUid, outageChild.uid);
  equal((await routeMovements(outageId)).length, 0);
  deepStrictEqual(await wallet("sponsor-b"), before);
});
await test("désactivation après gain pending ne retire pas le droit à la livraison", async () => {
  const id = "referral-order-disabled-after-pending";
  const child = await createRouteCandidate(id, "referee-disabled-after-pending");
  const before = await wallet("sponsor-b");
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  equal((await routeRelation(child.uid)).state, "pending");
  await routeTransition(id, { orderStatus: "delivered" }, program,
    async () => { throw new Error("auth_must_not_be_called_for_delivery"); });
  equal((await routeRelation(child.uid)).state, "rewarded");
  equal((await wallet("sponsor-b")).availableCents, before.availableCents + 1000);
  equal((await routeMovements(id)).length, 2);
});
await test("préflight Auth lié à la relation refuse un changement concurrent de parrain sans mutation de paiement", async () => {
  const id = "referral-order-sponsor-race";
  const child = await createRouteCandidate(id, "referee-sponsor-race");
  const changedEmail = "race-current-referee@example.test";
  let beforePayment: Awaited<ReturnType<typeof capturePaymentState>> | undefined;
  await rejects(routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
    async (uid) => {
      if (uid === "sponsor-b") {
        await db.collection("referrals").doc(child.uid).update({ sponsorUid: sponsor.uid });
        beforePayment = await capturePaymentState();
      }
      return uid === child.uid ? { uid, email: changedEmail, emailVerified: true, disabled: false } : activeIdentity(uid);
    }), (error: unknown) => error instanceof ReferralError && error.status === 409 && error.code === "referral_identity_changed");
  ok(beforePayment);
  deepStrictEqual(await capturePaymentState(), beforePayment);
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "to_confirm");
  equal((await routeRelation(child.uid)).sponsorUid, sponsor.uid);
  equal((await routeRelation(child.uid)).qualifyingOrderId, null);
  equal((await routeRelation(child.uid)).paymentConfirmed, false);
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, changedEmail)).get()).exists, false);
  equal((await routeMovements(id)).length, 0);
});
await test("annulation statutaire pending conserve le gain puis refund confirmé l'annule", async () => {
  const id = "referral-order-cancel-pending-route";
  const child = await createRouteCandidate(id, "referee-cancel-pending-route");
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const before = await wallet("sponsor-b");
  await routeTransition(id, { orderStatus: "cancelled" }, drain);
  const after = await routeRelation(child.uid);
  equal(after.state, "pending");
  equal(after.paymentConfirmed, true);
  equal(after.deliveryConfirmed, false);
  equal(after.qualifyingOrderId, id);
  deepStrictEqual(await wallet("sponsor-b"), before);
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "cancelled");
  equal((await db.collection("products").doc(`product-${id}`).get()).data()?.stock, 11);
  const movements = await routeMovements(id);
  equal(movements.length, 1);
  equal((await db.collection("cagnotteRefunds").where("orderId", "==", id).get()).size, 0);
  equal((await db.collection("orders").doc(id).get()).data()?.refundSummary, undefined);
  await routeTransition(id, { orderStatus: "cancelled" }, drain);
  deepStrictEqual(await routeRelation(child.uid), after);
  equal((await routeMovements(id)).length, 1);
  await rejects(routeTransition(id, { orderStatus: "delivered" }, drain));
  const cancelledOrder = (await db.collection("orders").doc(id).get()).data() as Order;
  equal(await transition(cancelledOrder, "refund", "pending-cancelled-refund", 1500, drain), "applied");
  equal((await routeRelation(child.uid)).state, "cancelled");
  equal((await routeMovements(id)).length, 2);
  equal((await wallet("sponsor-b")).pendingCents, before.pendingCents - 1000);
  equal(await transition(cancelledOrder, "refund", "pending-cancelled-refund", 1500, drain), "already_applied");
  equal(await transition(cancelledOrder, "correction", "pending-cancelled-correction", 0, drain), "applied");
  equal((await routeRelation(child.uid)).state, "pending");
});
await test("annulation statutaire rewarded conserve le gain puis refund confirmé le contrepasse", async () => {
  const id = "referral-order-cancel-rewarded-full-route";
  const child = await createRouteCandidate(id, "referee-cancel-rewarded-full-route");
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link", orderStatus: "delivered" });
  const before = await wallet("sponsor-b");
  ok(before.availableCents >= 1000);
  await routeTransition(id, { orderStatus: "cancelled" });
  const after = await routeRelation(child.uid);
  equal(after.state, "rewarded");
  deepStrictEqual(await wallet("sponsor-b"), before);
  const cancelledOrder = (await db.collection("orders").doc(id).get()).data()!;
  equal((await routeMovements(id)).length, 2);
  equal(await transition(cancelledOrder as Order, "refund", "rewarded-cancelled-refund", 1500), "applied");
  equal((await routeRelation(child.uid)).state, "reversed");
  equal((await wallet("sponsor-b")).availableCents, before.availableCents - 1000);
  equal((await wallet("sponsor-b")).regularizationCents, before.regularizationCents);
  equal((await routeMovements(id)).length, 3);
});
await test("refund après annulation statutaire rewarded applique la régularisation", async () => {
  const id = "referral-order-cancel-rewarded-route";
  const child = await createRouteCandidate(id, "referee-cancel-rewarded-route");
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link", orderStatus: "delivered" });
  const reward = await routeRelation(child.uid);
  equal(reward.state, "rewarded");
  const before = await wallet("sponsor-b");
  await db.collection("cagnotteWallets").doc("sponsor-b").update({ availableCents: 100 });
  const beforeCancellation = await wallet("sponsor-b");
  await routeTransition(id, { orderStatus: "cancelled" });
  const after = await routeRelation(child.uid);
  equal(after.state, "rewarded");
  equal(after.deliveryConfirmed, true);
  deepStrictEqual(await wallet("sponsor-b"), beforeCancellation);
  equal((await routeMovements(id)).length, 2);
  const cancelledOrder = (await db.collection("orders").doc(id).get()).data() as Order;
  equal(await transition(cancelledOrder, "refund", "rewarded-regularization-refund", 1500), "applied");
  equal((await routeRelation(child.uid)).state, "reversed");
  equal((await wallet("sponsor-b")).availableCents, 0);
  equal((await wallet("sponsor-b")).regularizationCents, beforeCancellation.regularizationCents + 900);
  const movements = await routeMovements(id);
  equal(movements.length, 3);
  const reversal = movements.find((doc) => doc.data().businessEvent === "referral_reward_reversed");
  ok(reversal);
  equal(reversal.data().availableDeltaCents, -100);
  equal(reversal.data().regularizationDeltaCents, 900);
  equal(JSON.parse(reversal.data().payload).cause, "refund");
  equal((await db.collection("cagnotteRefunds").where("orderId", "==", id).get()).size, 0);
  await routeTransition(id, { orderStatus: "cancelled" });
  equal((await routeRelation(child.uid)).state, "reversed");
  equal((await routeMovements(id)).length, 3);
  equal((await wallet("sponsor-b")).regularizationCents, beforeCancellation.regularizationCents + 900);
  ok(before.availableCents >= 1000);
});
await test("livraison prépaiement reste sur la commande puis le paiement qualifie et rend disponible", async () => {
  const id = "referral-order-inverse-route";
  const child = await createRouteCandidate(id, "referee-inverse-route");
  const before = await wallet("sponsor-b");
  await routeTransition(id, { orderStatus: "delivered" });
  const delivered = await routeRelation(child.uid);
  equal(delivered.state, "linked");
  equal(delivered.deliveryConfirmed, false);
  equal(delivered.deliveredOrderId, null);
  equal(delivered.qualifyingOrderId, null);
  equal((await db.collection("orders").doc(id).get()).data()?.orderStatus, "delivered");
  equal((await routeMovements(id)).length, 0);
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const rewarded = await routeRelation(child.uid);
  equal(rewarded.state, "rewarded");
  equal(rewarded.qualifyingOrderId, id);
  equal(rewarded.deliveredOrderId, id);
  const compensation = Math.min(before.regularizationCents, 1000);
  equal((await wallet("sponsor-b")).availableCents, before.availableCents + 1000 - compensation);
  equal((await wallet("sponsor-b")).regularizationCents, before.regularizationCents - compensation);
  equal((await routeMovements(id)).length, 2);
});
await test("commande sans snapshot referral fonctionne avec programme off", async () => {
  const id = "non-referral-order-route";
  await db.collection("orders").doc(id).set({ id, customerId: "non-referral-buyer", customerName: "Synthetic",
    customerEmail: "non-referral@example.test", orderStatus: "confirmed", paymentStatus: "to_confirm",
    deliveryMethod: "postal", deliveryFee: 0, subtotal: 60, total: 60,
    items: [], createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z" });
  await routeTransition(id, { orderStatus: "delivered" }, REFERRAL_CLOSED_RUNTIME);
  equal((await db.collection("orders").doc(id).get()).data()?.orderStatus, "delivered");
  equal((await routeMovements(id)).length, 0);
});
await test("annulation avant paiement ne consomme pas le droit du filleul", async () => {
  const id = "referral-order-cancel-unpaid-route";
  const child = await createRouteCandidate(id, "referee-cancel-unpaid-route");
  await routeTransition(id, { orderStatus: "cancelled" });
  const linked = await routeRelation(child.uid);
  equal(linked.state, "linked");
  equal(linked.qualifyingOrderId, null);
  equal(linked.paymentConfirmed, false);
  equal((await routeMovements(id)).length, 0);
  const replacementId = "referral-order-after-unpaid-cancellation";
  await createRouteCandidate(replacementId, child.uid);
  await routeTransition(replacementId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  equal((await routeRelation(child.uid)).state, "pending");
  equal((await routeRelation(child.uid)).qualifyingOrderId, replacementId);
});
await test("livraison puis annulation impayée ne réservent jamais la relation", async () => {
  const firstId = "referral-order-delivered-unpaid-cancelled";
  const child = await createRouteCandidate(firstId, "referee-delivered-unpaid-cancelled");
  const walletBefore = await wallet("sponsor-b");
  await routeTransition(firstId, { orderStatus: "delivered" });
  const delivered = await routeRelation(child.uid);
  equal(delivered.state, "linked");
  equal(delivered.paymentConfirmed, false);
  equal(delivered.deliveryConfirmed, false);
  equal(delivered.deliveredOrderId, null);
  equal(delivered.qualifyingOrderId, null);
  deepStrictEqual(await wallet("sponsor-b"), walletBefore);
  equal((await routeMovements(firstId)).length, 0);
  await routeTransition(firstId, { orderStatus: "cancelled" }, drain);
  const cancelled = await routeRelation(child.uid);
  deepStrictEqual(cancelled, delivered);
  deepStrictEqual(await wallet("sponsor-b"), walletBefore);
  equal((await routeMovements(firstId)).length, 0);
  await routeTransition(firstId, { orderStatus: "cancelled" }, drain);
  deepStrictEqual(await routeRelation(child.uid), cancelled);
  const replacementId = "referral-order-after-delivered-unpaid-cancellation";
  await createRouteCandidate(replacementId, child.uid);
  await routeTransition(replacementId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const replacement = await routeRelation(child.uid);
  equal(replacement.state, "pending");
  equal(replacement.qualifyingOrderId, replacementId);
  equal(replacement.deliveryConfirmed, false);
  equal((await wallet("sponsor-b")).pendingCents, walletBefore.pendingCents + 1000);
  equal((await routeMovements(replacementId)).length, 1);
});
await test("A livrée impayée n'empêche pas B de réclamer la première commande payée", async () => {
  const a = "referral-candidate-a-delivered";
  const b = "referral-candidate-b-first-paid";
  const child = await createRouteCandidate(a, "referee-multiple-candidates");
  await createRouteCandidate(b, child.uid);
  const linked = await routeRelation(child.uid);
  const walletBefore = await wallet("sponsor-b");
  await routeTransition(a, { orderStatus: "delivered" });
  deepStrictEqual(await routeRelation(child.uid), linked);
  equal((await db.collection("orders").doc(a).get()).data()?.orderStatus, "delivered");
  equal((await routeReferralMovements(a)).length, 0);
  await routeTransition(b, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const pending = await routeRelation(child.uid);
  equal(pending.qualifyingOrderId, b);
  equal(pending.deliveredOrderId, null);
  equal(pending.paymentConfirmed, true);
  equal(pending.deliveryConfirmed, false);
  equal(pending.state, "pending");
  equal((await wallet("sponsor-b")).pendingCents, walletBefore.pendingCents + 1000);
  const walletAfterFirst = await wallet("sponsor-b");
  let authCalls = 0;
  const rejectedOrder = (await db.collection("orders").doc(a).get()).data()!;
  const reservationBefore = (await db.collection("cagnotteReservations").doc(a).get()).data();
  const movementsBefore = (await routeMovements(a)).map((doc) => [doc.id, doc.data()]);
  const analyticsBefore = (await db.collection("analyticsOutbox").where("orderId", "==", a).get()).size;
  await rejects(routeTransition(a, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program, async (uid) => {
    authCalls++;
    return activeIdentity(uid);
  }), (error: unknown) => error instanceof ReferralError && error.code === "referral_discount_already_consumed" && error.status === 409);
  equal(authCalls, 0);
  deepStrictEqual((await db.collection("orders").doc(a).get()).data(), rejectedOrder);
  deepStrictEqual(await routeRelation(child.uid), pending);
  equal((await routeReferralMovements(a)).length, 0);
  deepStrictEqual(await wallet("sponsor-b"), walletAfterFirst);
  deepStrictEqual((await db.collection("cagnotteReservations").doc(a).get()).data(), reservationBefore);
  deepStrictEqual((await routeMovements(a)).map((doc) => [doc.id, doc.data()]), movementsBefore);
  equal((await db.collection("analyticsOutbox").where("orderId", "==", a).get()).size, analyticsBefore);
  const plainId = "referral-candidate-plain-after-first-paid";
  const plain = { ...rejectedOrder, id: plainId, subtotal: 60, total: 60, discountAmount: 0, promotionDiscountTotal: 0 };
  delete plain.referral;
  await db.collection("orders").doc(plainId).set(plain);
  await routeTransition(plainId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  equal((await db.collection("orders").doc(plainId).get()).data()?.paymentStatus, "paid");
  deepStrictEqual(await routeRelation(child.uid), pending);
  // A legacy second paid order can still be refunded without touching B's reward.
  await db.collection("orders").doc(a).update({ paymentStatus: "paid", paidAt: "2000-01-03T00:00:00.000Z",
    paymentConfirmedAt: "2000-01-03T00:00:00.000Z", paymentConfirmedBy: routeActor.email,
    finalPaymentMethod: "card_payment_link" });
  const nonqualifying = (await db.collection("orders").doc(a).get()).data() as Order;
  const walletAfter = await wallet("sponsor-b");
  equal(await transition(nonqualifying, "refund", "nonqualifying-refund", 6000), "already_applied");
  equal(await transition(nonqualifying, "correction", "nonqualifying-correction", 0), "already_applied");
  deepStrictEqual(await routeRelation(child.uid), pending);
  deepStrictEqual(await wallet("sponsor-b"), walletAfter);
  equal((await routeReferralMovements(a)).length, 0);
  // A refund still commits its own financial journal even though A is not the qualifying order.
  const cagnotte = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 6000 }],
    discounts: [{ discountId: "referral", amountCents: 500, kind: "referral_discount", lineIds: ["line"] }],
    requestedCagnotteCents: 0, availableCagnotteCents: 0, advantages: ["referral_discount"] });
  const loyaltyProgram = { mode: "local_test" as const, programVersion: "fixture-nonqualifying-loyalty-v1",
    calculationVersion: "cagnotte-math-v1" as const, startsAtEpochMs: 1000, newAccrualsEnabled: true };
  await db.collection("orders").doc(a).update({ cagnotte: { schemaVersion: 1, beneficiaryId: child.uid,
    programVersion: loyaltyProgram.programVersion, calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000, snapshot: cagnotte } });
  await applyCagnotteLedgerOperation({ db, program: loyaltyProgram, command: { event: "payment_and_delivery_confirmed",
    order: { orderId: a, beneficiaryId: child.uid, programVersion: loyaltyProgram.programVersion, createdAtEpochMs: 2000, snapshot: cagnotte } },
    recordedAtEpochMs: 2000 });
  const refundRequest = { action: "preview" as const, orderId: a, currency: "EUR" as const,
    additionalReturns: [{ lineId: "line", additionalNetCents: 1100 }], deliveryRefundCents: 0 };
  const refundContext = { db, actor: routeActor, now: () => "2000-01-04T00:00:00.000Z", referralProgram: program };
  const refundPreview = await executeOrderRefund({ ...refundContext, request: refundRequest });
  const refund = await executeOrderRefund({ ...refundContext, request: { ...refundRequest, action: "record_confirmed",
    source: "admin", reference: "nonqualifying-refund-1", declaredFinancialCents: refundPreview.totalFinancialCents,
    reason: "product_return", confirmedAt: "2000-01-04T00:00:00.000Z", expectedPreviewVersion: refundPreview.previewVersion } });
  equal(refund.kind, "administrative_refund_recorded");
  equal((await db.collection("cagnotteRefunds").where("orderId", "==", a).get()).size, 1);
  deepStrictEqual(await routeRelation(child.uid), pending);
  deepStrictEqual(await wallet("sponsor-b"), walletAfter);
  equal((await routeReferralMovements(a)).length, 0);
  await routeTransition(b, { orderStatus: "delivered" });
  const rewarded = await routeRelation(child.uid);
  equal(rewarded.qualifyingOrderId, b);
  equal(rewarded.deliveredOrderId, b);
  equal(rewarded.state, "rewarded");
  equal((await routeReferralMovements(b)).length, 2);
});
await test("candidates non qualifiantes livrées ou annulées laissent B intacte", async () => {
  const a = "referral-other-delivered";
  const b = "referral-other-qualifying";
  const c = "referral-other-cancelled";
  const child = await createRouteCandidate(a, "referee-other-candidates");
  await createRouteCandidate(b, child.uid);
  await createRouteCandidate(c, child.uid);
  await routeTransition(b, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const relationBefore = await routeRelation(child.uid);
  const walletBefore = await wallet("sponsor-b");
  await routeTransition(a, { orderStatus: "delivered" });
  await routeTransition(c, { orderStatus: "cancelled" });
  await routeTransition(a, { orderStatus: "cancelled" });
  deepStrictEqual(await routeRelation(child.uid), relationBefore);
  deepStrictEqual(await wallet("sponsor-b"), walletBefore);
  equal((await routeReferralMovements(a)).length, 0);
  equal((await routeReferralMovements(c)).length, 0);
  equal((await db.collection("orders").doc(a).get()).data()?.orderStatus, "cancelled");
  equal((await db.collection("orders").doc(c).get()).data()?.orderStatus, "cancelled");
});
await test("deux paiements concurrents réclament une seule relation et un seul gain", async () => {
  const a = "referral-race-paid-a";
  const b = "referral-race-paid-b";
  const child = await createRouteCandidate(a, "referee-racing-candidates");
  await createRouteCandidate(b, child.uid);
  const walletBefore = await wallet("sponsor-b");
  const outcomes = await Promise.allSettled([
    routeTransition(a, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    routeTransition(b, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
  ]);
  equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find((result) => result.status === "rejected");
  ok(rejected && rejected.status === "rejected" && rejected.reason instanceof ReferralError &&
    rejected.reason.code === "referral_discount_already_consumed" && rejected.reason.status === 409);
  const relationAfter = await routeRelation(child.uid);
  ok(relationAfter.qualifyingOrderId === a || relationAfter.qualifyingOrderId === b);
  equal(relationAfter.state, "pending");
  equal((await db.collection("orders").doc(relationAfter.qualifyingOrderId!).get()).data()?.paymentStatus, "paid");
  equal((await db.collection("orders").doc(relationAfter.qualifyingOrderId === a ? b : a).get()).data()?.paymentStatus, "to_confirm");
  equal((await routeReferralMovements(a)).length + (await routeReferralMovements(b)).length, 1);
  equal((await wallet("sponsor-b")).pendingCents, walletBefore.pendingCents + 1000);
});
async function createPlainRouteCandidate(orderId: string, uid: string, total = 40) {
  const child = await createRouteCandidate(orderId, uid);
  const ref = db.collection("orders").doc(orderId);
  const data = (await ref.get()).data()!;
  delete data.referral;
  data.subtotal = total; data.total = total; data.discountAmount = 0; data.promotionDiscountTotal = 0;
  data.items[0].unitPrice = total; data.items[0].lineTotal = total;
  await ref.set(data);
  return child;
}
await test("premier paiement sous seuil sans snapshot consomme le lien sans mouvement", async () => {
  const id = "referral-plain-below-threshold";
  const child = await createPlainRouteCandidate(id, "referee-plain-below-threshold");
  const beforeWallet = await wallet("sponsor-b");
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  const consumed = await routeRelation(child.uid);
  equal(consumed.state, "cancelled"); equal(consumed.qualifyingOrderId, id); equal(consumed.paymentConfirmed, true);
  equal(consumed.rewardIneligibilityReason, "first_paid_order_without_referral_discount");
  equal((await routeReferralMovements(id)).length, 0); deepStrictEqual(await wallet("sponsor-b"), beforeWallet);
  await routeTransition(id, { paymentStatus: "paid" });
  deepStrictEqual(await routeRelation(child.uid), consumed);
  const later = `later-${id}`;
  const laterData = (await db.collection("orders").doc(id).get()).data()!;
  laterData.id = later; laterData.paymentStatus = "to_confirm"; laterData.paymentConfirmedAt = null; laterData.paidAt = null;
  laterData.referral = createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000,
    lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] });
  laterData.subtotal = 60; laterData.total = 55; laterData.items[0].unitPrice = 60; laterData.items[0].lineTotal = 60;
  await db.collection("orders").doc(later).set(laterData);
  await rejects(routeTransition(later, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    (error: unknown) => error instanceof ReferralError && error.code === "referral_discount_already_consumed" && error.status === 409);
  equal((await db.collection("orders").doc(later).get()).data()?.paymentStatus, "to_confirm");
  equal((await routeRelation(child.uid)).qualifyingOrderId, id);
  equal((await routeReferralMovements(later)).length, 0);
});
await test("précommande payée après lien consomme le droit et bloque une seconde remise", async () => {
  const preorderId = "referral-linked-preorder-first-paid";
  const laterId = "referral-linked-preorder-second-discount";
  const child = await createPlainRouteCandidate(preorderId, "referee-linked-preorder-first-paid", 60);
  await createRouteCandidate(laterId, child.uid);
  await db.collection("orders").doc(preorderId).update({ orderType: "preorder" });
  const currentEmail = "referee-linked-preorder-current@example.test";
  const walletBefore = await wallet("sponsor-b");
  await routeTransition(preorderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
    async (uid) => uid === child.uid ? { uid, email: currentEmail, emailVerified: true, disabled: false } : activeIdentity(uid));
  equal((await db.collection("orders").doc(preorderId).get()).data()?.paymentStatus, "paid");
  const consumed = await routeRelation(child.uid);
  equal(consumed.state, "cancelled"); equal(consumed.paymentConfirmed, true);
  equal(consumed.qualifyingOrderId, preorderId); equal(consumed.rewardCompartment, "none");
  equal(consumed.rewardIneligibilityReason, "first_paid_order_without_referral_discount");
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, currentEmail)).get()).data()?.refereeUid, child.uid);
  equal((await routeReferralMovements(preorderId)).length, 0);
  deepStrictEqual(await wallet("sponsor-b"), walletBefore);
  await routeTransition(preorderId, { paymentStatus: "paid" });
  deepStrictEqual(await routeRelation(child.uid), consumed);
  await rejects(routeTransition(laterId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    (error: unknown) => error instanceof ReferralError && error.code === "referral_discount_already_consumed" && error.status === 409);
  equal((await db.collection("orders").doc(laterId).get()).data()?.paymentStatus, "to_confirm");
  deepStrictEqual(await routeRelation(child.uid), consumed);
  equal((await routeReferralMovements(laterId)).length, 0);
  deepStrictEqual(await wallet("sponsor-b"), walletBefore);
});
await test("précommande payée pendant off bloque paiements et relink à la reprise sans backfill", async () => {
  const firstId = "referral-preorder-off-first";
  const secondId = "referral-preorder-off-second";
  const thirdId = "referral-preorder-off-third";
  const child = await createRouteCandidate(secondId, "referee-preorder-off-history");
  const candidate = (await db.collection("orders").doc(secondId).get()).data()!;
  await db.collection("orders").doc(thirdId).set({ ...candidate, id: thirdId });
  const first = { ...candidate, id: firstId, orderType: "preorder", subtotal: 60, total: 60,
    discountAmount: 0, promotionDiscountTotal: 0 };
  delete first.referral;
  await db.collection("orders").doc(firstId).set(first);
  const beforeRelation = await routeRelation(child.uid);
  const beforeSponsor = await wallet("sponsor-b");
  const claims = async () => (await db.collection("referralEmailClaims").where("refereeUid", "==", child.uid).get())
    .docs.map((doc) => [doc.id, doc.data()]);
  const beforeClaims = await claims();
  const offDb = new Proxy(db, { get(target, property) {
    if (property === "collection") return (name: string) => {
      if (["referralCodes", "referrals", "referralEmailClaims"].includes(name)) throw new Error("off_referral_read");
      return target.collection(name);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await commitOrderStatusTransition({ db: offDb,
    body: { orderId: firstId, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
    admin: routeActor, referralProgram: REFERRAL_CLOSED_RUNTIME,
    getSponsorIdentity: async () => { throw new Error("off_auth_read"); },
    referralEmailKeyring: () => { throw new Error("off_secret_read"); }, now: () => "2000-01-03T00:00:00.000Z" });
  equal((await db.collection("orders").doc(firstId).get()).data()?.paymentStatus, "paid");
  deepStrictEqual(await routeRelation(child.uid), beforeRelation);
  deepStrictEqual(await claims(), beforeClaims);
  deepStrictEqual(await wallet("sponsor-b"), beforeSponsor);
  equal((await routeMovements(firstId)).length, 0);
  const currentEmail = "referee-preorder-off-current@example.test";
  for (const id of [secondId, thirdId]) {
    const beforeOrder = (await db.collection("orders").doc(id).get()).data();
    await rejects(routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
      async (uid) => uid === child.uid ? { uid, email: currentEmail, emailVerified: true, disabled: false } : activeIdentity(uid)),
    (error: unknown) => error instanceof ReferralError && error.code === "referral_discount_already_consumed" && error.status === 409);
    deepStrictEqual((await db.collection("orders").doc(id).get()).data(), beforeOrder);
    deepStrictEqual(await routeRelation(child.uid), beforeRelation);
    deepStrictEqual(await claims(), beforeClaims);
    deepStrictEqual(await wallet("sponsor-b"), beforeSponsor);
    equal((await routeMovements(id)).length, 0);
  }
  for (const code of [codeB, codeA]) await rejects(linkReferral({ db, user: { ...child, email: currentEmail }, code,
    keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referee_already_paid" });
  deepStrictEqual(await routeRelation(child.uid), beforeRelation);
  equal((await routeRelation(child.uid)).qualifyingOrderId, null);
  deepStrictEqual(await claims(), beforeClaims);
  equal((await db.collection("referrals").doc(child.uid).collection("events").get()).size, 0);
});
await test("promotion prioritaire sans snapshot et mode off respectent le premier paiement", async () => {
  const id = "referral-plain-promotion-priority";
  const child = await createPlainRouteCandidate(id, "referee-plain-promotion-priority", 55);
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, drain);
  equal((await routeRelation(child.uid)).qualifyingOrderId, id);
  equal((await routeRelation(child.uid)).rewardIneligibilityReason, "first_paid_order_without_referral_discount");
  const offId = `${id}-off`;
  const offChild = await createPlainRouteCandidate(offId, "referee-plain-off", 55);
  await commitOrderStatusTransition({ db, body: { orderId: offId, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
    admin: routeActor, referralProgram: REFERRAL_CLOSED_RUNTIME, getSponsorIdentity: async () => { throw new Error("off_auth_read"); },
    referralEmailKeyring: () => { throw new Error("off_secret_read"); }, now: () => "2000-01-03T00:00:00.000Z" });
  equal((await routeRelation(offChild.uid)).state, "linked");
});
await test("deux premiers paiements sans snapshot sérialisent une seule consommation", async () => {
  const uid = "referee-plain-concurrent";
  const first = "referral-plain-concurrent-a", second = "referral-plain-concurrent-b";
  await createPlainRouteCandidate(first, uid);
  await createPlainRouteCandidate(second, uid);
  const results = await Promise.allSettled([
    routeTransition(first, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    routeTransition(second, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
  ]);
  equal(results.filter((result) => result.status === "fulfilled").length, 2);
  const relation = await routeRelation(uid);
  ok(relation.qualifyingOrderId === first || relation.qualifyingOrderId === second);
  equal(relation.state, "cancelled");
  equal((await routeReferralMovements(first)).length + (await routeReferralMovements(second)).length, 0);
});
await test("premier paiement sans remise revendique le nouvel email vérifié", async () => {
  const id = "referral-plain-new-email-claim";
  const child = await createPlainRouteCandidate(id, "referee-plain-new-email-claim");
  const currentEmail = "plain-new-verified@example.test";
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
    async (uid) => uid === child.uid ? { uid, email: currentEmail, emailVerified: true, disabled: false } : activeIdentity(uid));
  equal((await routeRelation(child.uid)).rewardIneligibilityReason, "first_paid_order_without_referral_discount");
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, currentEmail)).get()).data()?.refereeUid, child.uid);
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, child.email)).get()).data()?.refereeUid, child.uid);
  equal((await routeReferralMovements(id)).length, 0);
});
await test("premier paiement sans remise ferme le lien si le nouvel email est revendiqué", async () => {
  const id = "referral-plain-claimed-email";
  const child = await createPlainRouteCandidate(id, "referee-plain-claimed-email");
  const currentEmail = "plain-already-claimed@example.test";
  const claimRef = db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, currentEmail));
  await claimRef.set({ schemaVersion: 1, programVersion: "referral-commercial-policy-v1", keyVersion: "v1",
    refereeUid: "different-referee", referralId: "different-referee", createdAtEpochMs: nowEpochMs });
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
    async (uid) => uid === child.uid ? { uid, email: currentEmail, emailVerified: true, disabled: false } : activeIdentity(uid));
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  equal((await routeRelation(child.uid)).rewardIneligibilityReason, "referee_email_claimed");
  equal((await claimRef.get()).data()?.refereeUid, "different-referee");
  equal((await routeReferralMovements(id)).length, 0);
});
await test("email filleul modifié et vérifié crée un nouveau claim au paiement", async () => {
  const id = "referral-referee-email-changed-free";
  const child = await createRouteCandidate(id, "referee-email-changed-free");
  const newEmail = "fresh-referee-email@example.test";
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
    async (uid) => uid === child.uid ? { uid, email: newEmail, emailVerified: true, disabled: false } : activeIdentity(uid));
  equal((await routeRelation(child.uid)).state, "pending");
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, newEmail)).get()).data()?.refereeUid, child.uid);
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, child.email)).get()).data()?.refereeUid, child.uid);
});
await test("email filleul déjà revendiqué refuse le paiement et son replay sans mutation", async () => {
  const id = "referral-referee-email-changed-claimed";
  const child = await createRouteCandidate(id, "referee-email-changed-claimed");
  const claimedEmail = "claimed-at-payment@example.test";
  await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, claimedEmail)).set({ schemaVersion: 1,
    programVersion: "referral-commercial-policy-v1", keyVersion: "v1", refereeUid: "another-referee", referralId: "another-referee", createdAtEpochMs: 1000 });
  const before = await capturePaymentState();
  for (let attempt = 0; attempt < 2; attempt++) {
    await rejects(routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
      async (uid) => uid === child.uid ? { uid, email: claimedEmail, emailVerified: true, disabled: false } : activeIdentity(uid)),
    (error: unknown) => error instanceof ReferralError && error.status === 409 && error.code === "referee_email_claimed");
    deepStrictEqual(await capturePaymentState(), before);
  }
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "to_confirm");
  equal((await routeRelation(child.uid)).state, "linked");
  equal((await routeRelation(child.uid)).qualifyingOrderId, null);
  equal((await routeReferralMovements(id)).length, 0);
});
await test("email non vérifié, compte désactivé et auto-parrainage refusent le paiement sans mutation", async () => {
  for (const [suffix, identity, reason] of [
    ["unverified", { email: "unverified@example.test", emailVerified: false, disabled: false }, "referee_email_unverified"],
    ["disabled", { email: "disabled@example.test", emailVerified: true, disabled: true }, "referee_email_unverified"],
    ["self", { email: "b@example.test", emailVerified: true, disabled: false }, "self_referral_at_payment"],
  ] as const) {
    const id = `referral-referee-${suffix}-at-payment`;
    const child = await createRouteCandidate(id, `referee-identity-${suffix}-at-payment`);
    const before = await capturePaymentState();
    await rejects(routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
      async (uid) => uid === child.uid ? { uid, ...identity } : activeIdentity(uid)),
    (error: unknown) => error instanceof ReferralError && error.status === 409 && error.code === reason);
    deepStrictEqual(await capturePaymentState(), before);
    equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "to_confirm");
    equal((await routeRelation(child.uid)).state, "linked");
    equal((await routeReferralMovements(id)).length, 0);
  }
});
await test("identité Auth filleul indisponible refuse la remise sans mutation", async () => {
  const id = "referral-referee-auth-unavailable";
  const child = await createRouteCandidate(id, "referee-auth-unavailable-at-payment");
  const before = await capturePaymentState();
  await rejects(routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program,
    async (uid) => { if (uid === child.uid) throw new Error("fixture_referee_auth_unavailable"); return activeIdentity(uid); }),
  (error: unknown) => error instanceof ReferralError && error.status === 409 && error.code === "referee_identity_unavailable");
  deepStrictEqual(await capturePaymentState(), before);
});
await test("keyring invalide ou indisponible refuse la remise sans mutation", async () => {
  for (const [suffix, readKeyring] of [
    ["invalid", () => "{}"], ["unavailable", () => { throw new Error("fixture_keyring_unavailable"); }],
  ] as const) {
    const id = `referral-referee-keyring-${suffix}`;
    await createRouteCandidate(id, `referee-keyring-${suffix}`);
    const before = await capturePaymentState();
    await rejects(commitOrderStatusTransition({ db, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
      admin: routeActor, referralProgram: program, getSponsorIdentity: activeIdentity, referralEmailKeyring: readKeyring,
      now: () => "2000-01-03T00:00:00.000Z" }),
    (error: unknown) => error instanceof ReferralError && error.status === 409 && error.code === "referee_identity_unavailable");
    deepStrictEqual(await capturePaymentState(), before);
  }
});
await test("evidence absente ou aliases incomplets refuse la remise avant toute écriture", async () => {
  const id = "referral-referee-evidence-incomplete";
  const child = await createRouteCandidate(id, "referee-evidence-incomplete");
  const source = (await db.collection("orders").doc(id).get()).data() as Order;
  const relation = await routeRelation(child.uid);
  const valid: ReferralPaymentEvidence = { referralId: child.uid, refereeUid: child.uid, sponsorUid: relation.sponsorUid,
    linkedAtEpochMs: relation.linkedAtEpochMs, sponsorAccount: "active", refereeAccount: "active", refereeEmail: child.email,
    sponsorEmail: "b@example.test", activeKeyVersion: "v1", claimAliases: referralEmailClaimAliases(keyring, child.email) };
  const before = await capturePaymentState();
  for (const [evidence, code] of [
    [undefined, "referral_identity_changed"],
    [{ ...valid, activeKeyVersion: undefined }, "referee_identity_unavailable"],
    [{ ...valid, claimAliases: undefined }, "referee_identity_unavailable"],
  ] as const) {
    await rejects(db.runTransaction(async (transaction) => {
      const plan = await prepareReferralTransition({ db, transaction, order: source, program, event: "payment",
        recordedAtEpochMs: 2000, paymentEvidence: evidence });
      plan?.write();
    }), (error: unknown) => error instanceof ReferralError && error.status === 409 && error.code === code);
    deepStrictEqual(await capturePaymentState(), before);
  }
});
await test("paiement après rotation lit v1 et crée le claim v2", async () => {
  const id = "referral-payment-key-rotation";
  const child = await createRouteCandidate(id, "referee-payment-key-rotation");
  const secondSecret = "fixture-payment-rotation-secret-at-least-32-bytes";
  const rotatedJson = JSON.stringify({ activeVersion: "v2", keys: { v1: secret, v2: secondSecret } });
  await commitOrderStatusTransition({ db, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
    admin: routeActor, referralProgram: program, getSponsorIdentity: activeIdentity, referralEmailKeyring: () => rotatedJson,
    now: () => "2000-01-03T00:00:00.000Z" });
  equal((await routeRelation(child.uid)).state, "pending");
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secondSecret, child.email, "v2")).get()).data()?.refereeUid, child.uid);
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, child.email, "v1")).get()).data()?.refereeUid, child.uid);
});
await test("rotation HMAC migre le claim actif même sans gain parrain", async () => {
  const id = "referral-payment-key-rotation-disabled";
  const child = await createRouteCandidate(id, "referee-payment-key-rotation-disabled");
  const changedEmail = "changed-rotation-disabled@example.test";
  const secondSecret = "fixture-disabled-rotation-secret-at-least-32-bytes";
  const rotatedJson = JSON.stringify({ activeVersion: "v2", keys: { v1: secret, v2: secondSecret } });
  const oldRef = db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, changedEmail, "v1"));
  await oldRef.set({ schemaVersion: 1, programVersion: "referral-commercial-policy-v1", keyVersion: "v1",
    refereeUid: child.uid, referralId: child.uid, createdAtEpochMs: 1000 });
  const sponsorBefore = await wallet("sponsor-b");
  await commitOrderStatusTransition({ db, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
    admin: routeActor, referralProgram: program, referralEmailKeyring: () => rotatedJson,
    getSponsorIdentity: async (uid) => uid === "sponsor-b"
      ? { uid, email: "b@example.test", emailVerified: true, disabled: true }
      : { uid, email: changedEmail, emailVerified: true, disabled: false },
    now: () => "2000-01-03T00:00:00.000Z" });
  equal((await routeRelation(child.uid)).rewardIneligibilityReason, "sponsor_account_disabled");
  equal((await oldRef.get()).data()?.refereeUid, child.uid);
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secondSecret, changedEmail, "v2")).get()).data()?.refereeUid, child.uid);
  equal((await routeReferralMovements(id)).length, 0);
  deepStrictEqual(await wallet("sponsor-b"), sponsorBefore);
});
await test("GET self ne divulgue pas le code d'un parrain devenu inéligible", async () => {
  const codeOwner = sponsor.uid;
  await db.collection("orders").doc("referral-sponsor-a").update({ paymentStatus: "cancelled", orderStatus: "cancelled" });
  let status = 0; let body: unknown;
  const handler = createReferralHandler({ runtime: () => program, verify: async () => ({ uid: codeOwner, email: sponsor.email!, emailVerified: true }),
    db: () => db, sponsorIdentity: activeIdentity, secret: () => keyringJson, now: () => 2000 });
  const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { body = value; } } as unknown as VercelResponseLike;
  await handler({ method: "GET", headers: { authorization: "Bearer fixture" } } as VercelRequestLike, response);
  equal(status, 200); deepStrictEqual(body, { code: null, relation: null });
});

for (const [suffix, firstHasSnapshot, resumedMode] of [
  ["plain-active", false, program], ["snapshot-drain", true, drain],
] as const) {
  await test(`paiement ${suffix} pendant off interdit une seconde remise à la reprise`, async () => {
    const firstId = `referral-off-prior-${suffix}`;
    const secondId = `referral-resumed-second-${suffix}`;
    const child = await createRouteCandidate(firstId, `referee-off-prior-${suffix}`);
    const firstRef = db.collection("orders").doc(firstId);
    const first = (await firstRef.get()).data()!;
    await db.collection("orders").doc(secondId).set({ ...first, id: secondId });
    if (!firstHasSnapshot) {
      delete first.referral;
      first.subtotal = 60; first.total = 60; first.discountAmount = 0; first.promotionDiscountTotal = 0;
      await firstRef.set(first);
    }
    const beforeRelation = await routeRelation(child.uid);
    const beforeSponsor = await wallet("sponsor-b");
    await commitOrderStatusTransition({ db, body: { orderId: firstId, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
      admin: routeActor, referralProgram: REFERRAL_CLOSED_RUNTIME,
      getSponsorIdentity: async () => { throw new Error("off_auth_read"); },
      referralEmailKeyring: () => { throw new Error("off_secret_read"); }, now: () => "2000-01-03T00:00:00.000Z" });
    equal((await firstRef.get()).data()?.paymentStatus, "paid");
    deepStrictEqual(await routeRelation(child.uid), beforeRelation);
    deepStrictEqual(await wallet("sponsor-b"), beforeSponsor);
    equal((await routeReferralMovements(firstId)).length, 0);
    const secondBefore = (await db.collection("orders").doc(secondId).get()).data();
    await rejects(routeTransition(secondId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, resumedMode),
      (error: unknown) => error instanceof ReferralError && error.code === "referral_discount_already_consumed" && error.status === 409);
    deepStrictEqual((await db.collection("orders").doc(secondId).get()).data(), secondBefore);
    deepStrictEqual(await routeRelation(child.uid), beforeRelation);
    equal((await routeReferralMovements(secondId)).length, 0);
    deepStrictEqual(await wallet("sponsor-b"), beforeSponsor);
    await routeTransition(secondId, { orderStatus: "delivered" }, resumedMode);
    deepStrictEqual(await routeRelation(child.uid), beforeRelation);
    equal((await routeReferralMovements(secondId)).length, 0);
  });
}

await test("parrainage et financement cagnotte positif refusés sans mutation, puis annulables", async () => {
  const id = "referral-cagnotte-positive-conflict";
  const child = await createRouteCandidate(id, "referee-cagnotte-positive-conflict");
  const accrualProgram = { mode: "local_test" as const, programVersion: "fixture-referral-noncumul-v1",
    calculationVersion: "cagnotte-math-v1" as const, startsAtEpochMs: 1000, newAccrualsEnabled: true };
  const reservationProgram = { ...accrualProgram, reservationVersion: CAGNOTTE_RESERVATION_VERSION, reservationsEnabled: true };
  const fundingSnapshot = calculateCagnotte({ lines: [{ lineId: "fund", initialCents: 20_000 }], discounts: [],
    requestedCagnotteCents: 0, availableCagnotteCents: 0 });
  await applyCagnotteLedgerOperation({ db, program: accrualProgram, recordedAtEpochMs: 2000,
    command: { event: "payment_and_delivery_confirmed", order: { orderId: `${id}-fund`, beneficiaryId: child.uid,
      programVersion: accrualProgram.programVersion, createdAtEpochMs: 2000, snapshot: fundingSnapshot } } });
  const intent = createCagnotteReservationIntent({ orderId: id, beneficiaryId: child.uid, createdAtEpochMs: 2000,
    calculation: { lines: [{ lineId: "line", initialCents: 6000 }], discounts: [],
      requestedCagnotteCents: 500, availableCagnotteCents: 1000 } }, reservationProgram)!;
  equal(intent.amountCents, 500);
  await applyCagnotteReservationOperation({ db, action: "reserve", intent, program: reservationProgram, recordedAtEpochMs: 2000 });
  await db.collection("orders").doc(id).update({ cagnotte: { schemaVersion: 1, beneficiaryId: child.uid,
    programVersion: accrualProgram.programVersion, calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000,
    snapshot: intent.order.snapshot }, cagnotteReservationIntent: intent });
  const order = (await db.collection("orders").doc(id).get()).data() as Order;
  equal(hasPositiveCagnotteFinancing(order), true);
  const before = await Promise.all([db.collection("orders").doc(id).get(), db.collection("referrals").doc(child.uid).get(),
    db.collection("cagnotteWallets").doc(child.uid).get(), db.collection("cagnotteWallets").doc("sponsor-b").get(),
    db.collection("cagnotteReservations").doc(id).get(), db.collection("products").doc(`product-${id}`).get()]);
  const beforeMovements = (await routeMovements(id)).map((doc) => [doc.id, doc.data()]);
  const beforeAnalytics = (await db.collection("analyticsOutbox").where("orderId", "==", id).get()).size;
  for (let replay = 0; replay < 2; replay++) {
    await rejects(routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
      (error: unknown) => error instanceof CagnotteReservationError && error.code === "CONFLICT");
    const after = await Promise.all([db.collection("orders").doc(id).get(), db.collection("referrals").doc(child.uid).get(),
      db.collection("cagnotteWallets").doc(child.uid).get(), db.collection("cagnotteWallets").doc("sponsor-b").get(),
      db.collection("cagnotteReservations").doc(id).get(), db.collection("products").doc(`product-${id}`).get()]);
    deepStrictEqual(after.map((doc) => doc.data()), before.map((doc) => doc.data()));
    deepStrictEqual((await routeMovements(id)).map((doc) => [doc.id, doc.data()]), beforeMovements);
    equal((await db.collection("analyticsOutbox").where("orderId", "==", id).get()).size, beforeAnalytics);
  }
  const review = await db.runTransaction((transaction) => readUnpaidOrderContext({ db, transaction, order,
    nowEpochMs: Date.parse("2000-01-03T00:00:00.000Z") }));
  await routeTransition(id, { orderStatus: "cancelled", paymentStatus: "cancelled", unpaidReview: {
    action: "record", outcome: "unpaid_confirmed", source: "fixture locale", reason: "Financement incompatible",
    expectedStateVersion: review.stateVersion } });
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "cancelled");
  equal((await db.collection("cagnotteReservations").doc(id).get()).data()?.state, "released");
  equal((await routeRelation(child.uid)).state, "linked");
  equal((await routeReferralMovements(id)).length, 0);
});

await test("enrollment cagnotte à zéro conserve le paiement parrainage", async () => {
  const id = "referral-cagnotte-zero-enrollment";
  const child = await createRouteCandidate(id, "referee-cagnotte-zero-enrollment");
  const zero = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 6000 }], discounts: [],
    requestedCagnotteCents: 0, availableCagnotteCents: 0 });
  await db.collection("orders").doc(id).update({ cagnotte: { schemaVersion: 1, beneficiaryId: child.uid,
    programVersion: "fixture-referral-zero-v1", calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000,
    snapshot: zero } });
  equal(hasPositiveCagnotteFinancing((await db.collection("orders").doc(id).get()).data() as Order), false);
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  equal((await routeRelation(child.uid)).state, "pending");
  equal((await routeReferralMovements(id)).length, 1);
});

await test("snapshot cagnotte positif sans intent est refusé avant paiement", async () => {
  const id = "referral-cagnotte-missing-intent";
  const child = await createRouteCandidate(id, "referee-cagnotte-missing-intent");
  const positive = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 6000 }], discounts: [],
    requestedCagnotteCents: 500, availableCagnotteCents: 1000 });
  await db.collection("orders").doc(id).update({ cagnotte: { schemaVersion: 1, beneficiaryId: child.uid,
    programVersion: "fixture-referral-malformed-v1", calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000,
    snapshot: positive } });
  const before = (await db.collection("orders").doc(id).get()).data();
  await rejects(routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    (error: unknown) => error instanceof CagnotteReservationError && error.code === "CONFLICT");
  deepStrictEqual((await db.collection("orders").doc(id).get()).data(), before);
  equal((await routeRelation(child.uid)).state, "linked");
  equal((await routeReferralMovements(id)).length, 0);
});

await test("avantages prioritaires persistés refusent le paiement referral sans mutation", async () => {
  const cases: Array<[string, (order: Order) => void]> = [
    ["coupon-livraison", (order) => { order.couponCode = "PORTOFFERT"; }],
    ["promo-code", (order) => { order.promoCode = "PROMO"; }],
    ["promo-id", (order) => { order.promoId = "promotion-id"; }],
    ["concours", (order) => { order.contestPrizeId = "prize-id"; }],
    ["promo-appliquee", (order) => { order.promoApplied = true; }],
    ["total-promotion", (order) => { order.promotionDiscountTotal = 1; }],
    ["promotion-automatique", (order) => { order.appliedPromotions = [{ id: "automatic", label: "Automatique", applicationMode: "automatic", type: "percentage_cart_discount", discountAmount: 0 }]; }],
    ["cadeau-palier", (order) => { order.appliedPromotions = [{ id: "gift", label: "Cadeau", type: "tiered_product_gift", giftTierId: "tier", discountAmount: 0 }]; }],
    ["ligne-cadeau", (order) => { order.items[0].isGift = true; }],
    ["ligne-promotion", (order) => { order.items[0].promotionId = "promotion-id"; }],
  ];
  for (const [suffix, apply] of cases) {
    const id = `referral-priority-${suffix}`;
    const child = await createRouteCandidate(id, `referee-priority-${suffix}`);
    const ref = db.collection("orders").doc(id);
    const data = (await ref.get()).data() as Order;
    apply(data);
    await ref.set(data);
    ok(hasAppliedReferralPriority(data as Order));
    const before = await Promise.all([ref.get(), db.collection("referrals").doc(child.uid).get(),
      db.collection("cagnotteWallets").doc("sponsor-b").get(), db.collection("products").doc(`product-${id}`).get()]);
    const movements = (await routeMovements(id)).map((doc) => [doc.id, doc.data()]);
    const analytics = (await db.collection("analyticsOutbox").where("orderId", "==", id).get()).size;
    await rejects(routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
      (error: unknown) => error instanceof CagnotteReservationError && error.code === "CONFLICT");
    const after = await Promise.all([ref.get(), db.collection("referrals").doc(child.uid).get(),
      db.collection("cagnotteWallets").doc("sponsor-b").get(), db.collection("products").doc(`product-${id}`).get()]);
    deepStrictEqual(after.map((doc) => doc.data()), before.map((doc) => doc.data()));
    deepStrictEqual((await routeMovements(id)).map((doc) => [doc.id, doc.data()]), movements);
    equal((await db.collection("analyticsOutbox").where("orderId", "==", id).get()).size, analytics);
    if (suffix === "coupon-livraison") {
      await routeTransition(id, { orderStatus: "cancelled" });
      equal((await ref.get()).data()?.orderStatus, "cancelled");
      equal((await routeRelation(child.uid)).state, "linked");
    }
  }
});

await test("remise referral seule et offre non appliquée restent payables", async () => {
  const id = "referral-priority-not-applied";
  const child = await createRouteCandidate(id, "referee-priority-not-applied");
  await db.collection("orders").doc(id).update({ couponCode: "  ", promoCode: "", promoId: "",
    appliedPromotions: [], promoApplied: false, postalFreeShippingApplied: true });
  const order = (await db.collection("orders").doc(id).get()).data() as Order;
  equal(order.discountAmount, 5);
  equal(hasAppliedReferralPriority(order), false);
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  equal((await routeRelation(child.uid)).state, "pending");
});

await test("cagnotte positive et promotion prioritaire ont un refus déterministe", async () => {
  const id = "referral-double-priority";
  const child = await createRouteCandidate(id, "referee-double-priority");
  await db.collection("orders").doc(id).update({ promoCode: "PROMO", cagnotteReservationIntent: { amountCents: 1 } });
  const before = (await db.collection("orders").doc(id).get()).data();
  await rejects(routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    (error: unknown) => error instanceof CagnotteReservationError && error.code === "CONFLICT" &&
      error.message === "Parrainage et cagnotte incompatibles sur cette commande.");
  deepStrictEqual((await db.collection("orders").doc(id).get()).data(), before);
  equal((await routeRelation(child.uid)).state, "linked");
});

await test("paiement off détecté par email legacy à la reprise", async () => {
  const secondId = "referral-legacy-email-second";
  const firstId = "referral-legacy-email-first";
  const child = await createRouteCandidate(secondId, "referee-legacy-email-second");
  const first = (await db.collection("orders").doc(secondId).get()).data()!;
  delete first.referral;
  await db.collection("orders").doc(firstId).set({ ...first, id: firstId, customerId: "legacy-customer-other-uid" });
  await routeTransition(firstId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, REFERRAL_CLOSED_RUNTIME);
  equal((await db.collection("orders").doc(firstId).get()).data()?.paymentStatus, "paid");
  equal((await routeRelation(child.uid)).state, "linked");
  await rejects(routeTransition(secondId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    (error: unknown) => error instanceof ReferralError && error.code === "referral_discount_already_consumed" && error.status === 409);
  equal((await db.collection("orders").doc(secondId).get()).data()?.paymentStatus, "to_confirm");
  equal((await routeRelation(child.uid)).state, "linked");
  equal((await routeReferralMovements(secondId)).length, 0);
});

await test("historique saturé sans remise laisse le paiement consommer le lien sans gain", async () => {
  const id = "referral-history-saturated-candidate";
  const child = await createPlainRouteCandidate(id, "referee-history-saturated-candidate");
  const batch = db.batch();
  for (let index = 0; index < 100; index++) batch.set(db.collection("orders").doc(`referral-history-saturated-${index}`),
    { customerId: child.uid, orderType: "order", paymentStatus: "to_confirm", total: 60,
      items: [{ productId: "fixture-product", quantity: 1 }] });
  await batch.commit();
  deepStrictEqual(await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, child.uid, id)), { kind: "inconclusive" });
  const sponsorBefore = await wallet("sponsor-b");
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  equal((await routeRelation(child.uid)).state, "cancelled");
  equal((await routeRelation(child.uid)).rewardIneligibilityReason, "first_paid_order_without_referral_discount");
  equal((await routeRelation(child.uid)).qualifyingOrderId, id);
  equal((await routeReferralMovements(id)).length, 0);
  deepStrictEqual(await wallet("sponsor-b"), sponsorBefore);
});
await test("historique inconclusif refuse le paiement remisé et son replay sans mutation puis qualifie après résolution", async () => {
  const id = "referral-history-inconclusive-discount";
  const child = await createRouteCandidate(id, "referee-history-inconclusive-discount");
  const loyaltyProgram = { mode: "local_test" as const, programVersion: "fixture-referral-inconclusive-v1",
    calculationVersion: "cagnotte-math-v1" as const, startsAtEpochMs: 1000, newAccrualsEnabled: true };
  const loyaltySnapshot = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 6000 }],
    discounts: [{ discountId: "referral", amountCents: 500, kind: "referral_discount", lineIds: ["line"] }],
    requestedCagnotteCents: 0, availableCagnotteCents: 0, advantages: ["referral_discount"] });
  await db.collection("orders").doc(id).update({ cagnotte: { schemaVersion: 1, beneficiaryId: child.uid,
    programVersion: loyaltyProgram.programVersion, calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000,
    snapshot: loyaltySnapshot } });
  const historyRefs = Array.from({ length: 100 }, (_, index) => db.collection("orders").doc(`referral-inconclusive-history-${index}`));
  const batch = db.batch();
  for (const ref of historyRefs) batch.set(ref, { customerId: child.uid, orderType: "order", paymentStatus: "to_confirm",
    total: 60, items: [{ productId: "fixture-product", quantity: 1 }] });
  await batch.commit();
  deepStrictEqual(await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, child.uid, id)), { kind: "inconclusive" });
  const collections = ["orders", "referrals", "referralEmailClaims", "cagnotteWallets", "cagnotteReservations",
    "cagnotteMovements", "analyticsOutbox", "analyticsOperationalEvents", "products"];
  const capture = async () => Promise.all(collections.map(async (name) => (await db.collection(name).get())
    .docs.map((doc) => ({ id: doc.id, data: doc.data(), updatedAt: doc.updateTime.toMillis() }))));
  const before = await capture();
  const currentEmail = "referee-inconclusive-current@example.test";
  const pay = () => commitOrderStatusTransition({ db, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
    admin: routeActor, referralProgram: program, accrualProgram: loyaltyProgram,
    getSponsorIdentity: async (uid) => uid === child.uid ? { uid, email: currentEmail, emailVerified: true, disabled: false } : activeIdentity(uid),
    referralEmailKeyring: () => keyringJson, now: () => "2000-01-03T00:00:00.000Z" });
  for (let attempt = 0; attempt < 2; attempt++) {
    await rejects(pay(), (error: unknown) => error instanceof ReferralError && error.code === "referral_history_inconclusive" && error.status === 409);
    deepStrictEqual(await capture(), before);
    equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "to_confirm");
    equal((await routeRelation(child.uid)).state, "linked");
    equal((await routeRelation(child.uid)).qualifyingOrderId, null);
    equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, currentEmail, "v1")).get()).exists, false);
    equal((await routeMovements(id)).length, 0);
  }
  // Only synthetic unpaid history is reduced; the candidate and its relation remain untouched.
  const reduction = db.batch();
  for (const ref of historyRefs.slice(0, 10)) reduction.delete(ref);
  await reduction.commit();
  deepStrictEqual(await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, child.uid, id)), { kind: "none" });
  const sponsorBefore = await wallet("sponsor-b");
  await pay();
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  equal((await routeRelation(child.uid)).state, "pending");
  equal((await routeRelation(child.uid)).qualifyingOrderId, id);
  equal((await wallet("sponsor-b")).pendingCents, sponsorBefore.pendingCents + 1000);
  equal((await wallet(child.uid)).pendingCents, 275);
  equal((await routeReferralMovements(id)).length, 1);
  equal((await db.collection("referralEmailClaims").doc(referralEmailClaimId(secret, currentEmail, "v1")).get()).data()?.refereeUid, child.uid);
});
const noReferralDb = new Proxy(db, { get(target, property) {
  if (property === "collection") return (name: string) => {
    if (["referralCodes", "referrals", "referralEmailClaims", "referralMigrations"].includes(name)) throw new Error("unexpected_referral_access");
    return target.collection(name);
  };
  const value = Reflect.get(target, property, target);
  return typeof value === "function" ? value.bind(target) : value;
} });
const noMigrationDb = new Proxy(db, { get(target, property) {
  if (property === "collection") return (name: string) => {
    if (name === "referralMigrations") throw new Error("unexpected_migration_marker_read");
    return target.collection(name);
  };
  const value = Reflect.get(target, property, target);
  return typeof value === "function" ? value.bind(target) : value;
} });
const captureReferralState = async () => Promise.all(["referralCodes", "referrals", "referralEmailClaims", "cagnotteWallets",
  "cagnotteMovements"].map(async (name) => (await db.collection(name).get()).docs.map((doc) =>
    ({ id: doc.id, data: doc.data(), updatedAt: doc.updateTime.toMillis() }))));
async function createUnrelatedOrder(id: string, customerId?: string) {
  await db.collection("orders").doc(id).set({ id, ...(customerId ? { customerId } : {}),
    customerName: "Synthetic", customerEmail: `${id}@example.test`, orderType: "order",
    orderStatus: "confirmed", paymentStatus: "to_confirm", deliveryMethod: "postal", deliveryFee: 0,
    subtotal: 60, total: 60, items: [{ productId: "fixture-product", quantity: 1, unitPrice: 60, lineTotal: 60 }],
    createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z" });
}
function closedTransitionDependencies() {
  const calls = { runtime: 0, auth: 0, keyring: 0 };
  return { calls, dependencies: {
    db: noReferralDb, admin: routeActor, accrualProgram: null, reservationProgram: null,
    resolveReferralRuntime: () => { calls.runtime++; throw new ReferralConfigurationError(); },
    getSponsorIdentity: async () => { calls.auth++; throw new Error("unexpected_referral_auth"); },
    referralEmailKeyring: () => { calls.keyring++; throw new Error("unexpected_referral_keyring"); },
    now: () => "2000-01-03T00:00:00.000Z",
  } };
}
for (const action of ["payment", "delivery"] as const) {
  await test(`commande anonyme ${action} ne résout jamais le runtime malformé ni ne lit Referral`, async () => {
    const id = `referral-runtime-anonymous-${action}`;
    await createUnrelatedOrder(id);
    const before = await captureReferralState();
    const { calls, dependencies } = closedTransitionDependencies();
    const result = await commitOrderStatusTransition({ ...dependencies, body: { orderId: id,
      ...(action === "payment" ? { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } : { orderStatus: "delivered" }) } });
    equal(action === "payment" ? result.updatedOrder?.paymentStatus : result.updatedOrder?.orderStatus,
      action === "payment" ? "paid" : "delivered");
    deepStrictEqual(calls, { runtime: 0, auth: 0, keyring: 0 });
    deepStrictEqual(await captureReferralState(), before);
  });
}
await test("livraison sans snapshot avec customerId ne résout jamais le runtime", async () => {
  const id = "referral-runtime-plain-delivery";
  const child = await createPlainRouteCandidate(id, "referee-runtime-plain-delivery");
  const before = await captureReferralState();
  const { calls, dependencies } = closedTransitionDependencies();
  await commitOrderStatusTransition({ ...dependencies, body: { orderId: id, orderStatus: "delivered" } });
  deepStrictEqual(calls, { runtime: 0, auth: 0, keyring: 0 });
  equal((await routeRelation(child.uid)).state, "linked");
  deepStrictEqual(await captureReferralState(), before);
});
await test("paiement customerId sans relation avec runtime invalide continue sans lecture Referral", async () => {
  const id = "referral-runtime-plain-no-relation";
  await createUnrelatedOrder(id, "referee-runtime-no-relation");
  const before = await captureReferralState();
  const { calls, dependencies } = closedTransitionDependencies();
  await commitOrderStatusTransition({ ...dependencies, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } });
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  deepStrictEqual(calls, { runtime: 1, auth: 0, keyring: 0 });
  deepStrictEqual(await captureReferralState(), before);
});
await test("runtime invalide laisse un lien intact au paiement plain mais l'historique interdit une remise à la reprise", async () => {
  const first = "referral-runtime-linked-plain";
  const later = "referral-runtime-linked-later-discount";
  const child = await createPlainRouteCandidate(first, "referee-runtime-linked-plain");
  await createRouteCandidate(later, child.uid);
  const before = await captureReferralState();
  const { calls, dependencies } = closedTransitionDependencies();
  await commitOrderStatusTransition({ ...dependencies, body: { orderId: first, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } });
  deepStrictEqual(calls, { runtime: 1, auth: 0, keyring: 0 });
  deepStrictEqual(await captureReferralState(), before);
  equal((await routeRelation(child.uid)).state, "linked");
  equal((await db.collection("orders").doc(first).get()).data()?.paymentStatus, "paid");
  const afterPayment = await capturePaymentState();
  await rejects(routeTransition(later, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    (error: unknown) => error instanceof ReferralError && error.code === "referral_discount_already_consumed");
  deepStrictEqual(await capturePaymentState(), afterPayment);
});
for (const action of ["payment", "delivery"] as const) {
  await test(`handler snapshot + runtime invalide ${action} renvoie 503 sans aucune mutation`, async () => {
    const id = `referral-runtime-invalid-snapshot-${action}`;
    await createRouteCandidate(id, `referee-runtime-invalid-snapshot-${action}`);
    if (action === "delivery") await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
    await db.collection("adminUsers").doc(routeActor.uid).set({ isActive: true });
    const before = await capturePaymentState();
    let runtimeCalls = 0; let effectCalls = 0; let status = 0; let payload: unknown;
    const handler = createOrderStatusHandler({ getDb: () => noReferralDb, verifyToken: async () => routeActor,
      accrualProgram: null, reservationProgram: null,
      resolveReferralRuntime: () => { runtimeCalls++; throw new ReferralConfigurationError(); },
      sendStatusEmail: async () => { effectCalls++; throw new Error("unexpected_email_effect"); },
      processAnalytics: async () => { effectCalls++; throw new Error("unexpected_analytics_effect"); },
      now: () => "2000-01-03T00:00:00.000Z" });
    const response = { status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; } } as unknown as VercelResponseLike;
    await handler({ method: "POST", headers: { authorization: "Bearer fixture-token" }, body: { orderId: id,
      ...(action === "payment" ? { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } : { orderStatus: "delivered" }) } } as VercelRequestLike, response);
    equal(status, 503); deepStrictEqual(payload, { code: "referral_configuration_invalid", error: "Configuration parrainage indisponible." });
    equal(runtimeCalls, 1); equal(effectCalls, 0);
    deepStrictEqual(await capturePaymentState(), before);
  });
}
await test("runtime off injecté paie un snapshot sans résolution environnementale ni mutation Referral", async () => {
  const id = "referral-runtime-injected-off";
  await createRouteCandidate(id, "referee-runtime-injected-off");
  const before = await captureReferralState();
  const { calls, dependencies } = closedTransitionDependencies();
  await commitOrderStatusTransition({ ...dependencies, referralProgram: REFERRAL_CLOSED_RUNTIME,
    body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } });
  deepStrictEqual(calls, { runtime: 0, auth: 0, keyring: 0 });
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  deepStrictEqual(await captureReferralState(), before);
});
await test("runtime actif injecté qualifie puis livre sans résolution environnementale", async () => {
  const id = "referral-runtime-injected-active";
  const child = await createRouteCandidate(id, "referee-runtime-injected-active");
  let calls = 0;
  const dependencies = { db, admin: routeActor, referralProgram: program, getSponsorIdentity: activeIdentity,
    referralEmailKeyring: () => keyringJson, resolveReferralRuntime: () => { calls++; throw new ReferralConfigurationError(); },
    now: () => "2000-01-03T00:00:00.000Z" };
  await commitOrderStatusTransition({ ...dependencies, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } });
  equal((await routeRelation(child.uid)).state, "pending");
  await commitOrderStatusTransition({ ...dependencies, body: { orderId: id, orderStatus: "delivered" } });
  equal((await routeRelation(child.uid)).state, "rewarded"); equal(calls, 0);
  equal((await routeReferralMovements(id)).length, 2);
});
for (const runtime of [program, drain]) {
  await test(`runtime ${runtime.mode} résolu une fois consomme toujours le lien plain puis ignore le replay`, async () => {
    const id = `referral-runtime-resolved-plain-${runtime.mode}`;
    const child = await createPlainRouteCandidate(id, `referee-runtime-resolved-plain-${runtime.mode}`);
    let calls = 0;
    const dependencies = { db, admin: routeActor, getSponsorIdentity: activeIdentity, referralEmailKeyring: () => keyringJson,
      resolveReferralRuntime: () => { calls++; return runtime; }, now: () => "2000-01-03T00:00:00.000Z" };
    await commitOrderStatusTransition({ ...dependencies, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } });
    equal(calls, 1); equal((await routeRelation(child.uid)).state, "cancelled");
    equal((await routeRelation(child.uid)).qualifyingOrderId, id);
    equal((await routeReferralMovements(id)).length, 0);
    await commitOrderStatusTransition({ ...dependencies, body: { orderId: id, paymentStatus: "paid" } });
    equal(calls, 1);
  });
}
await test("erreur inattendue du resolver reste visible sur une commande plain", async () => {
  const id = "referral-runtime-unexpected-error";
  await createUnrelatedOrder(id, "referee-runtime-unexpected-error");
  const before = await capturePaymentState();
  await rejects(commitOrderStatusTransition({ db: noReferralDb, admin: routeActor,
    resolveReferralRuntime: () => { throw new Error("unexpected_resolver_failure"); },
    body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } }), /unexpected_resolver_failure/);
  deepStrictEqual(await capturePaymentState(), before);
});
await test("snapshot ajouté entre préflight plain et transaction reste strict après résolution invalide", async () => {
  const id = "referral-runtime-snapshot-race";
  const child = await createPlainRouteCandidate(id, "referee-runtime-snapshot-race");
  const snapshot = createReferralOrderSnapshot({ refereeUid: child.uid, createdAtEpochMs: 2000,
    lines: [{ lineId: "line", eligibleBeforeReferralCents: 6000, referralDiscountCents: 500 }] });
  let before: Awaited<ReturnType<typeof capturePaymentState>> | undefined;
  const raceDb = new Proxy(noReferralDb, { get(target, property) {
    if (property === "runTransaction") return async (callback: Parameters<typeof db.runTransaction>[0]) => {
      await db.collection("orders").doc(id).update({ referral: snapshot, subtotal: 60, total: 55, discountAmount: 5 });
      before = await capturePaymentState();
      return db.runTransaction(callback);
    };
    return Reflect.get(target, property, target);
  } });
  const { calls, dependencies } = closedTransitionDependencies();
  await rejects(commitOrderStatusTransition({ ...dependencies, db: raceDb,
    body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } }), ReferralConfigurationError);
  ok(before); deepStrictEqual(await capturePaymentState(), before);
  deepStrictEqual(calls, { runtime: 1, auth: 0, keyring: 0 });
});
async function createSettlementCandidate(id: string, delivered: boolean) {
  const child = await createRouteCandidate(id, `referee-${id}`);
  const loyaltyProgram = { mode: "local_test" as const, programVersion: "fixture-referral-settlement-v1",
    calculationVersion: "cagnotte-math-v1" as const, startsAtEpochMs: 1000, newAccrualsEnabled: true };
  const snapshot = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 6000 }],
    discounts: [{ discountId: "referral", amountCents: 500, kind: "referral_discount", lineIds: ["line"] }],
    requestedCagnotteCents: 0, availableCagnotteCents: 0, advantages: ["referral_discount"] });
  await db.collection("orders").doc(id).update({ cagnotte: { schemaVersion: 1, beneficiaryId: child.uid,
    programVersion: loyaltyProgram.programVersion, calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000, snapshot } });
  await commitOrderStatusTransition({ db, admin: routeActor, referralProgram: program, accrualProgram: loyaltyProgram,
    getSponsorIdentity: activeIdentity, referralEmailKeyring: () => keyringJson,
    now: () => "2000-01-03T00:00:00.000Z", body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link",
      ...(delivered ? { orderStatus: "delivered" } : {}) } });
  return child;
}
const captureSettlementState = async () => ({ payment: await capturePaymentState(),
  financial: await Promise.all(["cagnotteRefunds", "cagnotteAccruals"].map(async (name) =>
    (await db.collection(name).get()).docs.map((doc) => ({ id: doc.id, data: doc.data(), updatedAt: doc.updateTime.toMillis() })))) });
const captureCodesAndClaims = async () => Promise.all(["referralCodes", "referralEmailClaims"].map(async (name) =>
  (await db.collection(name).get()).docs.map((doc) => ({ id: doc.id, data: doc.data(), updatedAt: doc.updateTime.toMillis() }))));
for (const environment of ["absent", "off", "malformed"] as const) {
  for (const delivered of [false, true]) {
    await test(`refund et correction ${delivered ? "rewarded" : "pending"} avec runtime ${environment} sans injection restent écrits et idempotents`, async () => {
      const id = `referral-settlement-${environment}-${delivered ? "rewarded" : "pending"}`;
      const child = await createSettlementCandidate(id, delivered);
      if (delivered) await db.collection("cagnotteWallets").doc("sponsor-b").update({ availableCents: 100 });
      const beforeWallet = await wallet("sponsor-b");
      const claimsBefore = await captureCodesAndClaims();
      const orderBefore = (await db.collection("orders").doc(id).get()).data()!;
      const saved = REFERRAL_RUNTIME_KEYS.map((key) => [key, process.env[key]] as const);
      try {
        for (const key of REFERRAL_RUNTIME_KEYS) delete process.env[key];
        if (environment !== "absent") process.env.REFERRAL_PROGRAM_MODE = environment === "off" ? "off" : "not-a-mode";
        if (environment === "malformed") throws(() => resolveReferralRuntime({ environment: process.env, getProjectId: () => { throw new Error("unexpected_project_read"); } }), ReferralConfigurationError);
        // Deliberately no referralProgram: the real refund entrypoint must not resolve the environment.
        const common = { db, actor: routeActor, now: () => "2000-01-04T00:00:00.000Z", log: () => undefined };
        const selection = { action: "preview" as const, orderId: id, currency: "EUR" as const,
          additionalReturns: [{ lineId: "line", additionalNetCents: 1100 }], deliveryRefundCents: 0 };
        const beforePreview = await captureSettlementState();
        const preview = await executeOrderRefund({ ...common, request: selection });
        equal(preview.kind, "refund_preview"); deepStrictEqual(await captureSettlementState(), beforePreview);
        const request = { ...selection, action: "record_confirmed" as const, source: "admin" as const, reference: `refund-${id}`,
          declaredFinancialCents: preview.totalFinancialCents, reason: "product_return" as const,
          confirmedAt: "2000-01-04T00:00:00.000Z", expectedPreviewVersion: preview.previewVersion };
        const confirmed = await executeOrderRefund({ ...common, request });
        equal(confirmed.kind, "administrative_refund_recorded");
        const relation = await routeRelation(child.uid);
        equal(relation.state, delivered ? "reversed" : "cancelled"); equal(relation.cumulativeReturnedProductsCents, 1200);
        equal(relation.qualifyingOrderId, id); equal(relation.paymentConfirmed, true);
        equal(relation.deliveredOrderId, delivered ? id : null);
        equal((await db.collection("orders").doc(id).get()).data()?.refundSummary.returnedProductNetCents, 1100);
        const events = await db.collection("cagnotteRefunds").where("orderId", "==", id).get(); equal(events.size, 1);
        const sponsorAfter = await wallet("sponsor-b");
        if (delivered) {
          equal(sponsorAfter.availableCents, 0); equal(sponsorAfter.regularizationCents, beforeWallet.regularizationCents + 900);
          equal(sponsorAfter.pendingCents, beforeWallet.pendingCents);
        } else {
          equal(sponsorAfter.pendingCents, beforeWallet.pendingCents - 1000);
          equal(sponsorAfter.availableCents, beforeWallet.availableCents); equal(sponsorAfter.regularizationCents, beforeWallet.regularizationCents);
        }
        const movement = (await routeReferralMovements(id)).find((doc) => doc.data().businessEvent === (delivered ? "referral_reward_reversed" : "referral_reward_cancelled")); ok(movement);
        const refundState = await captureSettlementState();
        await executeOrderRefund({ ...common, request }); deepStrictEqual(await captureSettlementState(), refundState);
        const correction = { action: "preview_correction" as const, orderId: id, currency: "EUR" as const,
          targetEventId: events.docs[0].id, expectedRevision: 0, replacementReturns: [], deliveryRefundCents: 0, declaredFinancialCents: 0,
          correctionReason: "Rectification externe vérifiée", externalVerificationConfirmed: true };
        const correctionPreview = await executeOrderRefund({ ...common, request: correction });
        equal(correctionPreview.kind, "refund_correction_preview"); deepStrictEqual(await captureSettlementState(), refundState);
        const correctionRequest = { ...correction, action: "record_correction" as const, correctionReference: `correction-${id}`,
          expectedPreviewVersion: correctionPreview.previewVersion };
        const corrected = await executeOrderRefund({ ...common, request: correctionRequest });
        equal(corrected.kind, "administrative_refund_correction_recorded");
        const restored = await routeRelation(child.uid);
        equal(restored.state, delivered ? "rewarded" : "pending"); equal(restored.cumulativeReturnedProductsCents, 0);
        equal(restored.qualifyingOrderId, id); equal(restored.sponsorUid, relation.sponsorUid);
        equal((await db.collection("cagnotteRefunds").where("orderId", "==", id).get()).size, 2);
        equal((await routeReferralMovements(id)).filter((doc) => doc.data().businessEvent === "referral_reward_restored").length, 1);
        const afterRestore = await wallet("sponsor-b");
        if (delivered) {
          const compensation = Math.min(sponsorAfter.regularizationCents, 1000);
          equal(afterRestore.availableCents, 1000 - compensation);
          equal(afterRestore.regularizationCents, sponsorAfter.regularizationCents - compensation);
        } else equal(afterRestore.pendingCents, sponsorAfter.pendingCents + 1000);
        deepStrictEqual(await captureCodesAndClaims(), claimsBefore);
        deepStrictEqual((await db.collection("orders").doc(id).get()).data()?.referral, orderBefore.referral);
        const correctionState = await captureSettlementState();
        await executeOrderRefund({ ...common, request: correctionRequest }); deepStrictEqual(await captureSettlementState(), correctionState);
      } finally {
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    });
  }
}
await test("settlement off conserve les refus snapshot relation refund et wallet corrompus sans écriture", async () => {
  const id = "referral-settlement-strict";
  const child = await createSettlementCandidate(id, false);
  const source = (await db.collection("orders").doc(id).get()).data() as Order;
  const relationRef = db.collection("referrals").doc(child.uid);
  const original = (await relationRef.get()).data()!;
  const settle = (order = source, refundId = "strict-refund", returned = 1200) => transition(order, "refund", refundId, returned, REFERRAL_CLOSED_RUNTIME);
  const before = await captureSettlementState();
  await rejects(settle({ ...source, referral: { ...source.referral!, programVersion: "unknown-version" as never } }), { code: "referral_snapshot_invalid" });
  await rejects(settle(source, "", 1200), { code: "referral_refund_invalid" });
  await rejects(settle(source, "strict-refund", 6001), { code: "referral_refund_invalid" });
  deepStrictEqual(await captureSettlementState(), before);
  for (const patch of [{ schemaVersion: 2 }, { programVersion: "wrong-version" }, { refereeUid: "another-referee" },
    { sponsorUid: child.uid }, { paymentConfirmed: false }, { deliveredOrderId: "another-order" },
    { processedRefunds: { corrupt: -1 } }, { cumulativeReturnedProductsCents: 6001 }]) {
    await relationRef.set({ ...original, ...patch });
    const corruptState = await captureSettlementState();
    await rejects(settle(), (error: unknown) => error instanceof ReferralError);
    deepStrictEqual(await captureSettlementState(), corruptState);
  }
  await relationRef.set(original);
  const walletRef = db.collection("cagnotteWallets").doc("sponsor-b");
  const originalWallet = (await walletRef.get()).data()!;
  await walletRef.update({ pendingCents: -1 });
  const corruptWalletState = await captureSettlementState();
  await rejects(settle()); deepStrictEqual(await captureSettlementState(), corruptWalletState);
  await walletRef.set(originalWallet);
});
await test("settlement off refuse une relation jamais qualifiée et ne rouvre aucune activité normale", async () => {
  const id = "referral-settlement-unqualified";
  await createRouteCandidate(id, "referee-settlement-unqualified");
  const source = (await db.collection("orders").doc(id).get()).data() as Order;
  const before = await captureSettlementState();
  for (const event of ["refund", "correction"] as const) await rejects(transition(source, event, `unqualified-${event}`, 0, REFERRAL_CLOSED_RUNTIME), { code: "referral_payment_required" });
  for (const event of ["payment", "payment_and_delivery", "delivery"] as const) await rejects(transition(source, event, undefined, 0, REFERRAL_CLOSED_RUNTIME), { code: "referral_program_disabled" });
  deepStrictEqual(await captureSettlementState(), before);
});
await test("refund et correction sans snapshot ignorent une configuration Referral malformée", async () => {
  const id = "referral-settlement-unrelated";
  const child = await createSettlementCandidate(id, false);
  const source = (await db.collection("orders").doc(id).get()).data()!; delete source.referral;
  await db.collection("orders").doc(id).set(source);
  const beforeRelation = await routeRelation(child.uid);
  const beforeSponsor = await wallet("sponsor-b");
  const saved = process.env.REFERRAL_PROGRAM_MODE;
  try {
    process.env.REFERRAL_PROGRAM_MODE = "invalid-mode";
    const common = { db: noReferralDb, actor: routeActor, now: () => "2000-01-04T00:00:00.000Z", log: () => undefined };
    const selection = { action: "preview" as const, orderId: id, currency: "EUR" as const, additionalReturns: [{ lineId: "line", additionalNetCents: 1100 }], deliveryRefundCents: 0 };
    const preview = await executeOrderRefund({ ...common, request: selection });
    await executeOrderRefund({ ...common, request: { ...selection, action: "record_confirmed", source: "admin", reference: `refund-${id}`,
      declaredFinancialCents: preview.totalFinancialCents, reason: "product_return", confirmedAt: "2000-01-04T00:00:00.000Z", expectedPreviewVersion: preview.previewVersion } });
    const events = await db.collection("cagnotteRefunds").where("orderId", "==", id).get(); equal(events.size, 1);
    const correction = { action: "preview_correction" as const, orderId: id, currency: "EUR" as const, targetEventId: events.docs[0].id,
      expectedRevision: 0, replacementReturns: [], deliveryRefundCents: 0, declaredFinancialCents: 0,
      correctionReason: "Rectification externe vérifiée", externalVerificationConfirmed: true };
    const previewCorrection = await executeOrderRefund({ ...common, request: correction });
    await executeOrderRefund({ ...common, request: { ...correction, action: "record_correction", correctionReference: `correction-${id}`,
      expectedPreviewVersion: previewCorrection.previewVersion } });
    equal((await db.collection("cagnotteRefunds").where("orderId", "==", id).get()).size, 2);
    deepStrictEqual(await routeRelation(child.uid), beforeRelation); deepStrictEqual(await wallet("sponsor-b"), beforeSponsor);
  } finally { if (saved === undefined) delete process.env.REFERRAL_PROGRAM_MODE; else process.env.REFERRAL_PROGRAM_MODE = saved; }
});
await test("livraison absorbe intégralement le reward dans la régularisation sans disponible supplémentaire", async () => {
  const id = "referral-full-compensation-ledger";
  await createRouteCandidate(id, "referee-full-compensation-ledger");
  await db.collection("cagnotteWallets").doc("sponsor-b").update({ availableCents: 0, regularizationCents: 1500 });
  const before = await wallet("sponsor-b");
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  equal((await wallet("sponsor-b")).pendingCents, before.pendingCents + 1000);
  await routeTransition(id, { orderStatus: "delivered" });
  const after = await wallet("sponsor-b");
  equal(after.availableCents, before.availableCents); equal(after.pendingCents, before.pendingCents); equal(after.regularizationCents, 500);
  const movement = (await routeReferralMovements(id)).find((doc) => doc.data().businessEvent === "referral_reward_available"); ok(movement);
  equal(movement.data().pendingDeltaCents, -1000); equal(movement.data().availableDeltaCents, 0); equal(movement.data().regularizationDeltaCents, -1000);
  const claimsBeforeReplay = await captureCodesAndClaims();
  const movementsBeforeReplay = (await routeReferralMovements(id)).map((doc) => ({ id: doc.id, data: doc.data() }));
  await routeTransition(id, { orderStatus: "delivered" });
  deepStrictEqual(await wallet("sponsor-b"), after);
  deepStrictEqual(await captureCodesAndClaims(), claimsBeforeReplay);
  deepStrictEqual((await routeReferralMovements(id)).map((doc) => ({ id: doc.id, data: doc.data() })), movementsBeforeReplay);
  equal((await routeReferralMovements(id)).length, 2);
});
await test("canonisation commandes et normalisation Referral convergent", () => {
  for (const email of [" Alice@Example.test ", "ALICE@example.test", "alice@example.test"]) {
    equal(canonicalOrderEmail(email), "alice@example.test");
    equal(normalizeReferralEmail(email), canonicalOrderEmail(email));
  }
});
await test("paiement legacy répare normalized absent ou faux dans la transaction, email brut conservé", async () => {
  for (const wrong of [undefined, "wrong@example.test"]) {
    const id = wrong ? "email-legacy-wrong" : "email-legacy-absent";
    await createUnrelatedOrder(id);
    await db.collection("orders").doc(id).update({ customerEmail: " Alice@Example.test ", ...(wrong ? { customerEmailNormalized: wrong } : {}) });
    await commitOrderStatusTransition({ db: noReferralDb, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
      admin: routeActor, now: () => "2000-01-03T00:00:00.000Z" });
    const stored = (await db.collection("orders").doc(id).get()).data()!;
    equal(stored.customerEmail, " Alice@Example.test "); equal(stored.customerEmailNormalized, "alice@example.test"); equal(stored.paymentStatus, "paid");
  }
});
await test("P1 nouvel UID et casse différente: lookup normalized refuse aussi une précommande payée", async () => {
  const oldEmail = "Alice-Identity@Example.test";
  const newEmail = "ALICE-IDENTITY@example.test";
  const normalized = canonicalOrderEmail(newEmail);
  const ref = db.collection("orders").doc("historical-mixed-case-preorder");
  await ref.set({ customerId: "old-firebase-uid", customerEmail: oldEmail, customerEmailNormalized: normalized,
    orderType: "preorder", paymentStatus: "cancelled", orderStatus: "cancelled", paidAt: "2000-01-01T00:00:00Z",
    total: 60, items: [{ productId: "fixture-product", quantity: 1 }] });
  for (const email of [newEmail, normalized]) equal((await db.collection("orders").where("customerEmail", "==", email).get()).size, 0);
  const before = await captureReferralState();
  await rejects(linkReferral({ db, user: { uid: "recreated-firebase-uid", email: newEmail, emailVerified: true }, code: codeB,
    keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referee_already_paid" });
  deepStrictEqual(await captureReferralState(), before);
});
await test("marqueur absent: link et ensure_code nouveau ou existant refusés sans mutation", async () => {
  await historyMarker.delete();
  try {
    const before = await captureReferralState();
    await rejects(linkReferral({ db, user: { uid: "email-marker-missing", email: "missing-marker@example.test", emailVerified: true },
      code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referral_history_inconclusive" });
    await rejects(ensureReferralCode({ db, user: sponsor, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referral_history_inconclusive" });
    await rejects(ensureReferralCode({ db, user: { uid: "new-sponsor-marker", email: "new-sponsor@example.test" }, program, nowEpochMs,
      getSponsorIdentity: activeIdentity }), { code: "referral_history_inconclusive" });
    deepStrictEqual(await captureReferralState(), before);
  } finally { await historyMarker.set(completeHistoryMarker); }
});
await test("snapshot remisé et marker absent: HTTP 409, zéro mutation de paiement", async () => {
  const id = "email-discount-marker-missing";
  await createRouteCandidate(id, "referee-discount-marker-missing");
  await db.collection("adminUsers").doc(routeActor.uid).set({ isActive: true });
  await historyMarker.delete();
  try {
    const before = await capturePaymentState();
    let status = 0; let responseBody: unknown;
    const handler = createOrderStatusHandler({ verifyToken: async () => routeActor, getDb: () => db,
      accrualProgram: null, reservationProgram: null, resolveReferralRuntime: () => program,
      now: () => "2000-01-03T00:00:00.000Z",
      sendStatusEmail: async () => { throw new Error("unexpected_email"); }, processAnalytics: async () => { throw new Error("unexpected_analytics"); } });
    const res = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { responseBody = value; } } as unknown as VercelResponseLike;
    await handler({ method: "POST", headers: { authorization: "Bearer fixture-token" }, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } } as VercelRequestLike, res);
    equal(status, 409); deepStrictEqual(responseBody, { error: "referral_history_inconclusive", code: "referral_history_inconclusive" });
    deepStrictEqual(await capturePaymentState(), before);
  } finally { await historyMarker.set(completeHistoryMarker); }
});
await test("marker exact complet permet lien puis qualification normalement", async () => {
  const id = "email-marker-complete";
  const child = await createRouteCandidate(id, "referee-marker-complete");
  await routeTransition(id, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" });
  equal((await routeRelation(child.uid)).state, "pending");
});
for (const [name, patch] of [ ["version", { version: "other-version" }], ["schema", { schemaVersion: 2 }],
  ["status", { status: "incomplete" }], ["instant", { completedAtEpochMs: 0 }], ["counts", { verifiedPaidProductOrders: -1 }] ] as const) {
  await test(`marqueur corrompu ${name}: histoire vide inconclusive et code fermé`, async () => {
    await historyMarker.set({ ...completeHistoryMarker, ...patch });
    try {
      const before = await captureReferralState();
      const history = await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, `marker-corrupt-${name}`, null, "empty@example.test", "empty@example.test"));
      equal(history.kind, "inconclusive");
      await rejects(linkReferral({ db, user: { uid: `marker-corrupt-${name}`, email: "empty@example.test", emailVerified: true },
        code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referral_history_inconclusive" });
      await rejects(ensureReferralCode({ db, user: sponsor, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referral_history_inconclusive" });
      deepStrictEqual(await captureReferralState(), before);
    } finally { await historyMarker.set(completeHistoryMarker); }
  });
}
await test("preuve payée UID ou normalized reste found sans marker", async () => {
  await historyMarker.delete();
  try {
    const byUid = await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, "old-firebase-uid", null));
    equal(byUid.kind, "found");
    const byEmail = await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, "new-again-uid", null,
      "ALICE-IDENTITY@example.test", "alice-identity@example.test"));
    equal(byEmail.kind, "found");
    await rejects(linkReferral({ db, user: { uid: "new-again-uid", email: "ALICE-IDENTITY@example.test", emailVerified: true }, code: codeB,
      keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referee_already_paid" });
  } finally { await historyMarker.set(completeHistoryMarker); }
});
await test("paiement plain consomme linked même sans marker, sans remise ni reward", async () => {
  const id = "email-plain-marker-missing";
  const child = await createPlainRouteCandidate(id, "referee-plain-marker-missing");
  await historyMarker.delete();
  try {
    await commitOrderStatusTransition({ db: noMigrationDb, body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" },
      admin: routeActor, referralProgram: program, getSponsorIdentity: activeIdentity, referralEmailKeyring: () => keyringJson,
      now: () => "2000-01-03T00:00:00.000Z" });
    equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
    equal((await routeRelation(child.uid)).state, "cancelled"); equal((await routeRelation(child.uid)).qualifyingOrderId, id);
    equal((await routeReferralMovements(id)).length, 0);
  } finally { await historyMarker.set(completeHistoryMarker); }
});
await test("GET self reste disponible sans marker et projection sans normalized ni PII", async () => {
  await historyMarker.delete();
  try {
    const before = await capturePaymentState();
    const self = await readReferralSelf(noMigrationDb, "referee-marker-complete");
    deepStrictEqual(self, { code: null, relation: { state: "pending", paymentConfirmed: true, deliveryConfirmed: false } });
    ok(!JSON.stringify(self).includes("email"));
    let status = 0; let payload: unknown;
    const handler = createReferralHandler({ runtime: () => program, verify: async () => ({ uid: "referee-marker-complete", email: "synthetic@example.test" }),
      db: () => noMigrationDb, sponsorIdentity: async () => { throw new Error("unexpected_auth"); }, secret: () => { throw new Error("unexpected_secret"); }, now: () => nowEpochMs });
    const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; } } as unknown as VercelResponseLike;
    await handler({ method: "GET", headers: { authorization: "Bearer fixture-token" } } as VercelRequestLike, response);
    equal(status, 200); deepStrictEqual(payload, self);
    deepStrictEqual(await capturePaymentState(), before);
  } finally { await historyMarker.set(completeHistoryMarker); }
});
await test("settlement off refund/correction ignore le marker absent", async () => {
  const id = "email-settlement-marker-missing";
  const child = await createSettlementCandidate(id, true);
  const source = (await db.collection("orders").doc(id).get()).data() as Order;
  await historyMarker.delete();
  try {
    for (const [event, returned] of [["refund", 1200], ["correction", 0]] as const) {
      await noMigrationDb.runTransaction(async (transaction) => {
        const plan = await prepareReferralTransition({ db: noMigrationDb, transaction, order: source, program: REFERRAL_CLOSED_RUNTIME,
          event, refundId: `markerless-${event}`, cumulativeReturnedProductsCents: returned, recordedAtEpochMs: nowEpochMs });
        plan?.write();
      });
    }
    equal((await routeRelation(child.uid)).state, "rewarded");
  } finally { await historyMarker.set(completeHistoryMarker); }
});
// Certificate maintenance is permitted even while every commercial referral access is forbidden.
const noCommercialReferralDb = new Proxy(db, { get(target, property) {
  if (property === "collection") return (name: string) => {
    if (["referralCodes", "referrals", "referralEmailClaims", "cagnotteWallets", "cagnotteMovements"].includes(name))
      throw new Error("unexpected_commercial_referral_access");
    return target.collection(name);
  };
  const value = Reflect.get(target, property, target);
  return typeof value === "function" ? value.bind(target) : value;
} });
const payLegacy = (id: string, overrides: Partial<Parameters<typeof commitOrderStatusTransition>[0]> = {}) =>
  commitOrderStatusTransition({ db: noCommercialReferralDb, admin: routeActor, accrualProgram: null, reservationProgram: null,
    referralProgram: REFERRAL_CLOSED_RUNTIME, getSponsorIdentity: async () => { throw new Error("unexpected_auth"); },
    referralEmailKeyring: () => { throw new Error("unexpected_keyring"); }, now: () => "2000-01-03T00:00:00.000Z",
    body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, ...overrides });
async function createBadEmailOrder(id: string, patch: FirebaseFirestore.DocumentData = {}) {
  await createUnrelatedOrder(id, `old-${id}`);
  await db.collection("orders").doc(id).update({ customerEmail: FieldValue.delete(), ...patch });
}
await test("premier paiement legacy email inexploitable: paid et certificat incomplete atomiques, aucun gain", async () => {
  const discountedId = "certificate-discounted-after-invalidation";
  await createRouteCandidate(discountedId, "referee-certificate-discounted");
  const beforeRights = await captureReferralState();
  for (const [index, email] of [undefined, "", "   ", "bad", "bad@", "bad\n@example.test"].entries()) {
    await historyMarker.set(completeHistoryMarker);
    const id = `certificate-invalid-${index}`;
    await createBadEmailOrder(id, email === undefined ? {} : { customerEmail: email });
    await payLegacy(id);
    const stored = (await db.collection("orders").doc(id).get()).data()!;
    equal(stored.paymentStatus, "paid"); equal(stored.paidAt, "2000-01-03T00:00:00.000Z"); equal(stored.paymentConfirmedAt, stored.paidAt);
    equal(stored.customerEmailNormalized, undefined);
    const marker = (await historyMarker.get()).data()!;
    deepStrictEqual(marker, { ...completeHistoryMarker, status: "incomplete", invalidationRevision: 1,
      invalidatedAtEpochMs: Date.parse(stored.paidAt), invalidationReason: "paid_order_email_unusable" });
    ok(!JSON.stringify(marker).includes(id));
    const beforeReplay = await historyMarker.get();
    await payLegacy(id); const afterReplay = await historyMarker.get();
    deepStrictEqual(afterReplay.data(), beforeReplay.data()); ok(afterReplay.updateTime!.isEqual(beforeReplay.updateTime!));
  }
  deepStrictEqual(await captureReferralState(), beforeRights);
  const beforeRejected = await capturePaymentState();
  await rejects(linkReferral({ db, user: { uid: "recreated-after-invalidation", email: "new-certificate@example.test", emailVerified: true },
    code: codeB, keyring, program, nowEpochMs, getSponsorIdentity: activeIdentity }), { code: "referral_history_inconclusive" });
  await rejects(routeTransition(discountedId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
    { code: "referral_history_inconclusive", status: 409 });
  deepStrictEqual(await capturePaymentState(), beforeRejected);
  await historyMarker.set(completeHistoryMarker);
});
await test("échec dans la phase write: commande et certificat restent inchangés", async () => {
  await historyMarker.set(completeHistoryMarker);
  const id = "certificate-atomic-abort"; await createBadEmailOrder(id);
  const before = await capturePaymentState();
  const abortDb = new Proxy(noCommercialReferralDb, { get(target, property) {
    if (property === "runTransaction") return (callback: Parameters<typeof db.runTransaction>[0]) => db.runTransaction(async (tx) => {
      await callback(tx); throw new Error("fixture_abort_after_prepared_writes");
    });
    return Reflect.get(target, property, target);
  } });
  await rejects(payLegacy(id, { db: abortDb }), /fixture_abort_after_prepared_writes/);
  deepStrictEqual(await capturePaymentState(), before);
});
await test("marker absent: paiement accepté, aucun certificat créé", async () => {
  await historyMarker.delete();
  const id = "certificate-absent-payment"; await createBadEmailOrder(id);
  await payLegacy(id);
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  equal((await historyMarker.get()).exists, false);
  await historyMarker.set(completeHistoryMarker);
});
await test("marker incomplete revision 4: paiement bump 5 et invalide la précondition de certification", async () => {
  await historyMarker.set({ ...completeHistoryMarker, status: "incomplete", invalidationRevision: 4 });
  const stale = await historyMarker.get();
  const id = "certificate-incomplete-payment"; await createBadEmailOrder(id); await payLegacy(id);
  const current = await historyMarker.get();
  equal(current.data()?.status, "incomplete"); equal(current.data()?.invalidationRevision, 5);
  ok(!current.updateTime!.isEqual(stale.updateTime!));
  await rejects(historyMarker.update({ status: "complete" }, { lastUpdateTime: stale.updateTime! }),
    (error: unknown) => typeof error === "object" && error !== null && Reflect.get(error, "code") === 9);
  equal((await historyMarker.get()).data()?.status, "incomplete");
  await historyMarker.set(completeHistoryMarker);
});
await test("deux paiements ambigus concurrents sérialisent les révisions du certificat", async () => {
  await historyMarker.set(completeHistoryMarker);
  const ids = ["certificate-concurrent-a", "certificate-concurrent-b"];
  for (const id of ids) await createBadEmailOrder(id);
  await Promise.all(ids.map((id) => payLegacy(id)));
  equal((await historyMarker.get()).data()?.invalidationRevision, 2);
  for (const id of ids) equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  await historyMarker.set(completeHistoryMarker);
});
await test("marker créé entre tentatives: retry Firestore reconstruit le plan et invalide le nouveau certificat", async () => {
  const id = "certificate-absent-retry"; await createBadEmailOrder(id); await historyMarker.delete();
  let attempts = 0;
  let creation: Promise<unknown> | undefined;
  const retryDb = new Proxy(noCommercialReferralDb, { get(target, property) {
    if (property === "runTransaction") return (callback: Parameters<typeof db.runTransaction>[0]) => db.runTransaction(async (tx) => {
      attempts++;
      if (creation) await creation;
      await callback(tx);
      if (attempts === 1) {
        equal((await historyMarker.get()).exists, false);
        // Inject ABORTED after preparing the absent-marker attempt. The real SDK
        // discards its writes and retries; creation races only with the discarded attempt.
        creation = historyMarker.create(completeHistoryMarker);
        throw Object.assign(new Error("fixture_transaction_conflict"), { code: 10 });
      }
    });
    return Reflect.get(target, property, target);
  } });
  await payLegacy(id, { db: retryDb });
  ok(attempts >= 2); equal((await historyMarker.get()).data()?.status, "incomplete");
  equal((await historyMarker.get()).data()?.invalidationRevision, 1);
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
  await historyMarker.set(completeHistoryMarker);
});
await test("marker corrompu ou revision invalide: schéma réparé fermé sans PII ajoutée", async () => {
  for (const [index, revision] of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER].entries()) {
    await historyMarker.set({ schemaVersion: 9, version: "corrupt", status: "corrupt", ...(revision === undefined ? {} : { invalidationRevision: revision }) });
    const id = `certificate-corrupt-${index}`; await createBadEmailOrder(id); await payLegacy(id);
    deepStrictEqual((await historyMarker.get()).data(), { schemaVersion: 1, version: ORDER_EMAIL_NORMALIZATION_VERSION, status: "incomplete",
      invalidationRevision: 1, invalidatedAtEpochMs: Date.parse("2000-01-03T00:00:00.000Z"), invalidationReason: "paid_order_email_unusable" });
  }
  await historyMarker.set(completeHistoryMarker);
});
await test("raw invalide même avec normalized plausible: certificat invalidé, normalized non inventé", async () => {
  const id = "certificate-invalid-raw-plausible-normalized";
  await createBadEmailOrder(id, { customerEmail: "bad", customerEmailNormalized: "plausible@example.test" });
  await payLegacy(id);
  equal((await db.collection("orders").doc(id).get()).data()?.customerEmailNormalized, "plausible@example.test");
  equal((await historyMarker.get()).data()?.status, "incomplete");
  await historyMarker.set(completeHistoryMarker);
});
await test("emails legacy exploitables: normalized absent ou faux réparé, certificat strictement inchangé", async () => {
  for (const [index, normalized] of [undefined, "wrong@example.test"].entries()) {
    const before = await historyMarker.get();
    const id = `certificate-valid-${index}`;
    await createBadEmailOrder(id, { customerEmail: " Alice@Example.test ", ...(normalized ? { customerEmailNormalized: normalized } : {}) });
    await payLegacy(id);
    equal((await db.collection("orders").doc(id).get()).data()?.customerEmailNormalized, "alice@example.test");
    const after = await historyMarker.get(); deepStrictEqual(after.data(), before.data()); ok(after.updateTime!.isEqual(before.updateTime!));
  }
});
await test("précommande bad-email: invalidation et preuve historique UID conservée", async () => {
  const id = "certificate-preorder"; await createBadEmailOrder(id, { orderType: "preorder" }); await payLegacy(id);
  equal((await historyMarker.get()).data()?.status, "incomplete");
  deepStrictEqual(await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, `old-${id}`, null)), { kind: "found", orderId: id });
  await historyMarker.set(completeHistoryMarker);
});
await test("non-produit ne lit aucun certificat; fixture exclue du même prédicat historique", async () => {
  for (const [index, patch] of [{ items: [] }, { total: 0 }].entries()) {
    const before = await historyMarker.get();
    const id = `certificate-non-product-${index}`; await createBadEmailOrder(id, patch);
    await payLegacy(id, { db: noReferralDb });
    equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
    const after = await historyMarker.get(); ok(after.updateTime!.isEqual(before.updateTime!));
  }
  const fixture = { productionFixture: true, paymentStatus: "paid", total: 60, items: [{ productId: "fixture-product", quantity: 1 }] };
  equal(productOrder(fixture, true), false); equal(hasHistoricalPaymentEvidence(fixture), false);
  // A malformed fixture also stays protected by the existing status boundary.
  const id = "certificate-protected-fixture"; await createBadEmailOrder(id, { productionFixture: true });
  const before = await capturePaymentState();
  await rejects(payLegacy(id, { db: noReferralDb }), /production_fixture_marker_invalid/);
  deepStrictEqual(await capturePaymentState(), before);
});
for (const mode of ["absent", "off", "malformed"] as const) {
  await test(`certificat technique invalidé avec runtime ${mode}, paiement sans activité commerciale`, async () => {
    await historyMarker.set(completeHistoryMarker);
    const id = `certificate-runtime-${mode}`; await createBadEmailOrder(id);
    let resolutions = 0;
    const before = await captureReferralState();
    await payLegacy(id, { referralProgram: undefined, resolveReferralRuntime: () => {
      resolutions++;
      if (mode === "malformed") throw new ReferralConfigurationError();
      return resolveReferralRuntime({ environment: mode === "off" ? { REFERRAL_PROGRAM_MODE: "off" } : {},
        getProjectId: () => { throw new Error("unexpected_project_lookup"); } });
    } });
    equal(resolutions, 1); equal((await historyMarker.get()).data()?.status, "incomplete");
    equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
    deepStrictEqual(await captureReferralState(), before);
  });
  await historyMarker.set(completeHistoryMarker);
}
await test("invalidation anonyme ne résout jamais le runtime uniquement pour le certificat", async () => {
  const id = "certificate-anonymous-payment"; await createBadEmailOrder(id);
  await db.collection("orders").doc(id).update({ customerId: FieldValue.delete() });
  await payLegacy(id, { referralProgram: undefined, resolveReferralRuntime: () => { throw new Error("unexpected_runtime_resolution"); } });
  equal((await historyMarker.get()).data()?.status, "incomplete");
  await historyMarker.set(completeHistoryMarker);
});
await test("migration cible exacte et apply explicite, pas de fallback distant", () => {
  throws(() => assertOrderEmailMigrationTarget({ projectId: "wrong-project", apply: true, confirmation: ORDER_EMAIL_NORMALIZATION_VERSION }));
  throws(() => assertOrderEmailMigrationTarget({ projectId: "verdanza-1f621", apply: true }));
  throws(() => assertOrderEmailMigrationTarget({ projectId: "verdanza-1f621", emulatorHost: "127.0.0.1:18085" }));
  throws(() => assertOrderEmailMigrationTarget({ projectId: CAGNOTTE_DEMO.projectId, emulatorHost: "remote:18085" }));
  assertOrderEmailMigrationTarget({ projectId: "verdanza-1f621", apply: true, confirmation: ORDER_EMAIL_NORMALIZATION_VERSION });
});

// Dedicated emulator only: reset orders after all commercial tests, so the exhaustive
// migration sees a precisely known dataset (including the deliberately invalid cases below).
await db.recursiveDelete(db.collection("orders"));
await historyMarker.delete();
const migrationPaidOrder = { customerId: "migration-old-uid", orderType: "order", paymentStatus: "paid", total: 60,
  items: [{ productId: "fixture-product", quantity: 1 }] };
const migrationFixtures = [
  { ...migrationPaidOrder, customerEmail: "Alice@Example.test" },
  { ...migrationPaidOrder, customerEmail: "bob@example.test", customerEmailNormalized: "bob@example.test" },
  { ...migrationPaidOrder, customerEmail: " CAROL@Example.test ", customerEmailNormalized: "wrong@example.test" },
  { ...migrationPaidOrder, orderType: "preorder", paymentStatus: "cancelled", orderStatus: "cancelled", paidAt: "2000-01-01T00:00:00Z", customerEmail: "Preorder@Example.test" },
  { ...migrationPaidOrder, paymentStatus: "to_confirm", customerEmail: "unpaid@example.test" },
];
for (const [index, fixture] of migrationFixtures.entries()) await db.collection("orders").doc(`migration-${index}`).set(fixture);
const runMigration = (apply = false) => migrateOrderEmailNormalization({ db, projectId: CAGNOTTE_DEMO.projectId, apply,
  ...(apply ? { confirmation: ORDER_EMAIL_NORMALIZATION_VERSION } : {}), pageSize: 2, now: () => 3000 });
await test("migration dry-run paginée: compteurs exacts, zéro écriture", async () => {
  const before = await capturePaymentState();
  const report = await runMigration();
  deepStrictEqual(report.initial, { scannedOrders: 5, usableEmails: 5, alreadyNormalized: 1, changesRequired: 4,
    paidProductOrders: 4, anomalies: 0, changedOrders: 0 });
  equal(report.verification, null); equal(report.markerWritten, false); equal((await historyMarker.get()).exists, false);
  deepStrictEqual(await capturePaymentState(), before);
});
await test("migration apply émulateur: champs corrigés, passe exhaustive puis marker complet", async () => {
  const rightsBefore = await captureReferralState();
  const report = await runMigration(true);
  equal(report.applied?.changedOrders, 4); equal(report.verification?.changesRequired, 0); equal(report.verification?.anomalies, 0);
  equal(report.markerWritten, true); equal(report.markerComplete, true);
  for (const [index, fixture] of migrationFixtures.entries()) {
    const order = (await db.collection("orders").doc(`migration-${index}`).get()).data()!;
    equal(order.customerEmail, fixture.customerEmail); equal(order.customerEmailNormalized, canonicalOrderEmail(fixture.customerEmail));
  }
  equal(await db.runTransaction((tx) => readReferralOrderEmailHistoryReady(tx, db)), true);
  const preorderHistory = await db.runTransaction((tx) => findPriorPaidProductOrder(tx, db, "recreated-preorder-uid", null,
    "PREORDER@example.test", canonicalOrderEmail("PREORDER@example.test")));
  deepStrictEqual(preorderHistory, { kind: "found", orderId: "migration-3" });
  deepStrictEqual(await captureReferralState(), rightsBefore);
});
await test("migration deuxième apply: documents et certificat inchangés, vérification refaite", async () => {
  const before = await capturePaymentState(); const markerBefore = await historyMarker.get();
  const report = await runMigration(true);
  equal(report.applied?.changedOrders, 0); equal(report.markerWritten, false); equal(report.verification?.scannedOrders, 5);
  deepStrictEqual(await capturePaymentState(), before);
  const after = await historyMarker.get(); deepStrictEqual(after.data(), markerBefore.data()); ok(after.updateTime!.isEqual(markerBefore.updateTime!));
});
await test("migration email payé absent ou inexploitable: anomalie ferme aussi un ancien certificat", async () => {
  for (const patch of [{}, { customerEmail: "not-an-email" }, { total: 0 }, { items: [] }]) {
    const ref = db.collection("orders").doc("migration-anomaly");
    await ref.set({ ...migrationPaidOrder, ...patch });
    const dryBefore = await capturePaymentState();
    const dry = await runMigration(); equal(dry.initial.anomalies, 1); deepStrictEqual(await capturePaymentState(), dryBefore);
    const report = await runMigration(true); equal(report.initial.anomalies, 1); equal(report.markerComplete, false);
    equal(await db.runTransaction((tx) => readReferralOrderEmailHistoryReady(tx, db)), false);
    equal((await historyMarker.get()).data()?.status, "incomplete");
    await ref.delete(); await runMigration(true);
  }
});
await test("migration: anomalie apparue après update détectée par passe finale, aucun complete prématuré", async () => {
  await db.collection("orders").doc("migration-0").update({ customerEmailNormalized: "wrong-again@example.test" });
  let injected = false;
  const observedDb = new Proxy(db, { get(target, property) {
    if (property === "batch") return () => {
      const batch = target.batch();
      let writesOrder = false;
      return new Proxy(batch, { get(batchTarget, batchProperty) {
        if (batchProperty === "update") return (...args: Parameters<typeof batch.update>) => {
          if (args[0].parent.id === "orders") writesOrder = true;
          return batchTarget.update(...args);
        };
        if (batchProperty === "commit") return async () => {
          if (writesOrder) equal((await historyMarker.get()).data()?.status, "incomplete");
          const result = await batchTarget.commit();
          if (writesOrder && !injected) {
            injected = true;
            // Its ID precedes the pagination cursor: only a fresh pass can discover it.
            await target.collection("orders").doc("000-final-verification-anomaly").set(migrationPaidOrder);
          }
          return result;
        };
        const value = Reflect.get(batchTarget, batchProperty, batchTarget);
        return typeof value === "function" ? value.bind(batchTarget) : value;
      } });
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const report = await migrateOrderEmailNormalization({ db: observedDb, projectId: CAGNOTTE_DEMO.projectId, apply: true,
    confirmation: ORDER_EMAIL_NORMALIZATION_VERSION, pageSize: 2, now: () => 4000 });
  equal(injected, true); equal(report.initial.anomalies, 0); equal(report.verification?.anomalies, 1);
  equal(report.markerComplete, false); equal((await historyMarker.get()).data()?.status, "incomplete");
  await db.collection("orders").doc("000-final-verification-anomaly").delete();
  await runMigration(true);
});
await test("champ normalized non projeté vers mouvements, analytics et rapports de migration", async () => {
  for (const name of ["cagnotteMovements", "analyticsOutbox", "analyticsOperationalEvents"]) {
    const docs = await db.collection(name).get();
    for (const doc of docs.docs) ok(!JSON.stringify(doc.data()).includes("customerEmailNormalized"));
  }
  const report = JSON.stringify(await runMigration());
  for (const fixture of migrationFixtures) ok(!report.includes(fixture.customerEmail));
  ok(!report.includes("migration-old-uid"));
});
await test("migration après paiement ambigu: refuse recertification puis récupère après réparation admin locale", async () => {
  const id = "migration-legacy-payment-after-certificate";
  await createBadEmailOrder(id);
  // The unpaid legacy anomaly is allowed at certification time.
  equal((await runMigration(true)).markerComplete, true);
  await payLegacy(id);
  equal((await historyMarker.get()).data()?.status, "incomplete");
  const beforeRights = await captureReferralState();
  const refused = await runMigration(true);
  equal(refused.initial.anomalies, 1); equal(refused.markerComplete, false);
  equal((await historyMarker.get()).data()?.status, "incomplete");
  await db.collection("orders").doc(id).update({ customerEmail: " Repaired@Example.test " });
  const recovered = await runMigration(true);
  equal(recovered.applied?.changedOrders, 1); equal(recovered.verification?.anomalies, 0);
  equal(recovered.verification?.changesRequired, 0); equal(recovered.markerComplete, true);
  equal((await db.collection("orders").doc(id).get()).data()?.customerEmailNormalized, "repaired@example.test");
  equal((await historyMarker.get()).data()?.status, "complete"); deepStrictEqual(await captureReferralState(), beforeRights);
});
await test("vrai apply migration: paiement après scan final fait échouer sa précondition complete", async () => {
  const id = "migration-concurrent-legacy-payment"; await createBadEmailOrder(id);
  await historyMarker.set({ ...completeHistoryMarker, status: "incomplete", invalidationRevision: 4 });
  let injected = false;
  const racingDb = new Proxy(db, { get(target, property) {
    if (property === "batch") return () => {
      const batch = target.batch(); let certifying = false;
      return new Proxy(batch, { get(batchTarget, batchProperty) {
        if (batchProperty === "update") return (...args: Parameters<typeof batch.update>) => {
          if (args[0].path === historyMarker.path && Reflect.get(args[1], "status") === "complete") certifying = true;
          return batchTarget.update(...args);
        };
        if (batchProperty === "commit") return async () => {
          if (certifying && !injected) { injected = true; await payLegacy(id); }
          return batchTarget.commit();
        };
        const value = Reflect.get(batchTarget, batchProperty, batchTarget);
        return typeof value === "function" ? value.bind(batchTarget) : value;
      } });
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await rejects(migrateOrderEmailNormalization({ db: racingDb, projectId: CAGNOTTE_DEMO.projectId, apply: true,
    confirmation: ORDER_EMAIL_NORMALIZATION_VERSION, pageSize: 2, now: () => 5000 }),
    (error: unknown) => typeof error === "object" && error !== null && Reflect.get(error, "code") === 9);
  equal(injected, true); equal((await historyMarker.get()).data()?.invalidationRevision, 5);
  equal((await historyMarker.get()).data()?.status, "incomplete");
  equal((await db.collection("orders").doc(id).get()).data()?.paymentStatus, "paid");
});
console.log(`Referral backend: ${passed} checks.`);
