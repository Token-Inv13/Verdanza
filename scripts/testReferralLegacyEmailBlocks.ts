import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { CAGNOTTE_DEMO } from "./cagnotteEmulator.js";
import { reconcileReferralPaymentIdentities, REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION } from "./referralPaymentIdentityReconciliation.js";
import { lookupReferralMaintenanceIdentity, type ReferralMaintenanceIdentity } from "./referralMaintenanceAuth.js";
import { migrateOrderEmailNormalization } from "./orderEmailNormalizationMigration.js";
import { isValidReferralEmailBlock } from "../api/_server/referralEmailBlocks.js";
import { findPriorReferralPaymentIdentity, paymentIdentityEvidenceShape, paymentIdentityProtectionMatches, prepareReferralEmailIdentityProtection, readCurrentPaymentIdentity } from "../api/_server/referralPaymentIdentity.js";
import { ORDER_EMAIL_NORMALIZATION_VERSION, isReferralOrderEmailHistoryReady } from "../api/_server/referralOrderEmailHistory.js";
import { linkReferral } from "../api/_server/referralService.js";
import { commitOrderStatusTransition } from "../api/_server/orderStatusTransition.js";
import { REFERRAL_CLOSED_RUNTIME } from "../api/_server/referralRuntimeConfig.js";
import { parseReferralEmailKeyring, referralEmailClaimId, referralEmailClaimAliases } from "../api/_server/referralIdentity.js";
import { REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION, REFERRAL_PROGRAM_VERSION, type ReferralPaymentIdentityEvidence } from "../src/types/referral.js";

type Test = (name: string, run: () => Promise<void> | void) => Promise<void>;
export async function exerciseReferralLegacyEmailBlocks(db: Firestore, runTest: Test) {
  equal(Reflect.get(db, "projectId"), CAGNOTTE_DEMO.projectId);
  equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18085");
  const collections = ["orders", "referralEmailBlocks", "referralEmailClaims", "referralPaymentIdentities", "referralCodes", "referrals",
    "referralMigrations", "cagnotteWallets", "cagnotteMovements", "products", "analyticsOutbox", "orderSideEffects"];
  const email = "legacy-block@example.test", uid = "legacy-disabled", id = "legacy-paid";
  const secret = "legacy-block-local-fixture-secret-at-least-32-bytes";
  const keyringJson = JSON.stringify({ activeVersion: "v1", keys: { v1: secret } });
  const keyring = parseReferralEmailKeyring(keyringJson), blockId = referralEmailClaimId(secret, email);
  const policy = REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION;
  const account: ReferralMaintenanceIdentity = { uid, email, disabled: true, emailVerified: false, createdAtEpochMs: 1000 };
  const block = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, keyVersion: "v1", policyVersion: policy,
    reason: "historical_paid_order_unverified_identity", createdAtEpochMs: 2000 };
  const evidence: ReferralPaymentIdentityEvidence = { schemaVersion: 1, version: "referral-payment-identity-v1", orderId: id,
    customerUid: uid, recordedAtEpochMs: 2000, status: "blocked_by_legacy_email", blockId, keyVersion: "v1", policyVersion: policy };
  const program = { mode: "active" as const, startsAtEpochMs: 1000, operational: true };
  const order = (orderId = id, customerId = uid, customerEmail = " LEGACY-BLOCK@Example.Test ") => ({ id: orderId, customerId, customerEmail,
    customerName: "Synthetic", orderType: "order", orderStatus: "confirmed", paymentStatus: "paid", paidAt: "2000-01-09T00:00:00.000Z",
    deliveryMethod: "postal", deliveryFee: 0, subtotal: 60, total: 60,
    items: [{ productId: "fixture-product", quantity: 1, unitPrice: 60, lineTotal: 60 }],
    createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z" });
  const capture = () => Promise.all(collections.map(async name => [name, (await db.collection(name).get()).docs.map(doc => ({ id: doc.id, data: doc.data(), time: doc.updateTime.toMillis() }))]));
  async function reset() { for (const name of collections) await db.recursiveDelete(db.collection(name)); await db.collection("orders").doc(id).set(order()); }
  const test: Test = (name, run) => runTest(`legacy block: ${name}`, async () => { await reset(); await run(); });
  const reconcile = (apply = false, overrides: Partial<Parameters<typeof reconcileReferralPaymentIdentities>[0]> = {}) => reconcileReferralPaymentIdentities({
    db, projectId: CAGNOTTE_DEMO.projectId, apply, confirmation: apply ? REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION : undefined,
    keyringJson, legacyEmailBlockPolicyVersion: policy, getIdentity: async () => account, getIdentityByEmail: async () => account,
    now: () => 3000, pageSize: 2, ...overrides });
  const migrate = (apply = false) => migrateOrderEmailNormalization({ db, projectId: CAGNOTTE_DEMO.projectId, apply,
    confirmation: apply ? ORDER_EMAIL_NORMALIZATION_VERSION : undefined, pageSize: 2, now: () => 5000 });
  const claim = (owner = uid) => ({ schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, keyVersion: "v1", refereeUid: owner, referralId: owner, createdAtEpochMs: 2000 });

  for (const unresolved of [false, true]) await test(`B3 ${unresolved ? "unresolved" : "missing"}: dry-run zéro writes, apply atomique et idempotent`, async () => {
    if (unresolved) await db.collection("referralPaymentIdentities").doc(id).set({ schemaVersion: 1, version: evidence.version, orderId: id,
      customerUid: uid, recordedAtEpochMs: 2100, status: "unresolved", reason: "runtime_closed" });
    const before = await capture(), priorOrder = await db.collection("orders").doc(id).get();
    const dry = await reconcile(); equal(dry.legacyBlocked, 1); equal(dry.unresolved, 0); equal(dry.changed, 0); deepStrictEqual(await capture(), before);
    const applied = await reconcile(true); equal(applied.legacyBlocked, 1); equal(applied.changed, 1);
    const stored = (await db.collection("referralPaymentIdentities").doc(id).get()).data()!;
    equal(stored.status, "blocked_by_legacy_email"); equal(stored.recordedAtEpochMs, unresolved ? 2100 : 3000);
    equal(paymentIdentityEvidenceShape(stored, id, uid), "safe");
    deepStrictEqual((await db.collection("referralEmailBlocks").doc(blockId).get()).data(), { ...block, createdAtEpochMs: 3000 });
    const afterOrder = await db.collection("orders").doc(id).get(); deepStrictEqual(afterOrder.data(), priorOrder.data());
    ok(afterOrder.updateTime); ok(priorOrder.updateTime); ok(afterOrder.updateTime.isEqual(priorOrder.updateTime));
    for (const name of ["referralEmailClaims", "referrals", "cagnotteWallets", "cagnotteMovements", "referralMigrations"]) equal((await db.collection(name).get()).size, 0);
    const safe = await capture(); equal((await reconcile(true)).changed, 0); deepStrictEqual(await capture(), safe);
    equal((await migrate(true)).markerComplete, true);
  });
  await test("policy absente: aucun bypass legacy et aucune lecture Auth par email", async () => {
    const before = await capture();
    const report = await reconcile(true, { legacyEmailBlockPolicyVersion: undefined, getIdentityByEmail: async () => { throw new Error("unexpected_email_lookup"); } });
    equal(report.unresolved, 1); equal(report.legacyBlocked, 0); deepStrictEqual(await capture(), before);
  });
  await test("runtime normal refuse toujours disabled/unverified avant secret", async () => {
    const identity = await readCurrentPaymentIdentity(uid, async () => account, () => { throw new Error("unexpected_secret"); });
    deepStrictEqual(identity, { customerUid: uid, reason: "referee_email_unverified" });
  });
  for (const failure of ["account_missing", "active_unverified", "disabled_verified", "wrong_uid", "email_mismatch", "created_after_payment",
    "unknown_creation", "missing_payment_instant", "email_lookup_other", "email_lookup_failure", "multiple_paid_uids", "uid_other_paid_email",
    "claim_conflict", "same_uid_claim", "block_conflict", "corrupt_block", "history_limit", "corrupt_evidence", "invalid_uid", "normalized_email_conflict", "fixture"] as const) {
    await test(`${failure}: aucune protection legacy automatique`, async () => {
      const overrides: Partial<Parameters<typeof reconcileReferralPaymentIdentities>[0]> = {};
      if (failure === "account_missing") overrides.getIdentity = async () => { throw new Error("fixture_missing_account"); };
      if (failure === "active_unverified") overrides.getIdentity = async () => ({ ...account, disabled: false });
      if (failure === "disabled_verified") overrides.getIdentity = async () => ({ ...account, emailVerified: true });
      if (failure === "wrong_uid") overrides.getIdentity = async () => ({ ...account, uid: "other" });
      if (failure === "email_mismatch") overrides.getIdentity = async () => ({ ...account, email: "other@example.test" });
      if (failure === "created_after_payment") overrides.getIdentity = async () => ({ ...account, createdAtEpochMs: Date.parse(order().paidAt) + 1 });
      if (failure === "unknown_creation") overrides.getIdentity = async () => ({ ...account, createdAtEpochMs: undefined });
      if (failure === "missing_payment_instant") { const { paidAt: omitted, ...rest } = order(); ok(omitted); await db.collection("orders").doc(id).set(rest); }
      if (failure === "email_lookup_other") overrides.getIdentityByEmail = async () => ({ ...account, uid: "other" });
      if (failure === "email_lookup_failure") overrides.getIdentityByEmail = async () => { throw new Error("fixture_http_failure"); };
      if (failure === "multiple_paid_uids") await db.collection("orders").doc("another").set(order("another", "other", email));
      if (failure === "uid_other_paid_email") await db.collection("orders").doc("another").set(order("another", uid, "other@example.test"));
      if (failure === "claim_conflict" || failure === "same_uid_claim") await db.collection("referralEmailClaims").doc(blockId).set(claim(failure === "claim_conflict" ? "other" : uid));
      if (failure === "block_conflict") await db.collection("referralEmailBlocks").doc(blockId).set({ ...block, policyVersion: "other_policy" });
      if (failure === "corrupt_block") await db.collection("referralEmailBlocks").doc(blockId).set({ ...block, refereeUid: uid });
      if (failure === "history_limit") { overrides.legacyHistoryLimit = 1; await db.collection("orders").doc("unpaid").set({ ...order("unpaid"), paymentStatus: "to_confirm", paidAt: null }); }
      if (failure === "corrupt_evidence") await db.collection("referralPaymentIdentities").doc(id).set({ ...evidence, schemaVersion: 99 });
      if (failure === "invalid_uid") {
        await db.collection("orders").doc(id).update({ customerId: "bad/uid" });
        overrides.getIdentity = overrides.getIdentityByEmail = async () => ({ ...account, uid: "bad/uid" });
      }
      if (failure === "normalized_email_conflict") await db.collection("orders").doc(id).update({ customerEmailNormalized: "different@example.test" });
      if (failure === "fixture") await db.collection("orders").doc(id).update({ productionFixture: true });
      const before = await capture(), report = await reconcile(true, overrides);
      equal(report.legacyBlocked, 0); equal(report.changed, 0); deepStrictEqual(await capture(), before);
    });
  }
  for (const fields of ["schemaVersion", "programVersion", "keyVersion", "policyVersion", "reason", "createdAtEpochMs", "refereeUid"] as const) {
    await test(`block strict: ${fields} invalide`, () => {
      equal(isValidReferralEmailBlock(block, "v1"), true);
      const value = { ...block, [fields]: fields === "createdAtEpochMs" ? -1 : "invalid" };
      equal(isValidReferralEmailBlock(value, "v1"), false);
    });
  }
  for (const patch of [{ policyVersion: "wrong" }, { blockId: "wrong" }, { claimId: blockId }, { email }, { keyVersion: "wrong" }]) {
    await test(`evidence block strict: ${Object.keys(patch)[0]}`, () => {
      equal(paymentIdentityEvidenceShape(evidence, id, uid), "safe");
      equal(paymentIdentityEvidenceShape({ ...evidence, ...patch }, id, uid), "corrupt");
    });
  }
  await test("validation générique distingue owner claim, other claim et block sans propriétaire", () => {
    equal(paymentIdentityProtectionMatches(evidence, block), true); equal(paymentIdentityProtectionMatches(evidence, claim()), false);
    const owned = { ...evidence, status: "claimed", claimId: blockId } as ReferralPaymentIdentityEvidence;
    equal(paymentIdentityProtectionMatches(owned, claim()), true); equal(paymentIdentityProtectionMatches(owned, claim("other")), false);
    equal(paymentIdentityProtectionMatches({ ...owned, status: "protected_by_existing_claim" } as ReferralPaymentIdentityEvidence, claim("other")), true);
  });
  await test("ancien UID reste payeur après changement email et suppression de la commande", async () => {
    await reconcile(true); await db.collection("orders").doc(id).delete();
    deepStrictEqual(await db.runTransaction(tx => findPriorReferralPaymentIdentity(tx, db, uid)), { kind: "found", orderId: id });
    const sponsorUid = "legacy-sponsor", code = "L".repeat(26);
    await db.collection("orders").doc("sponsor-paid").set({ ...order("sponsor-paid", sponsorUid, "sponsor@example.test"), orderStatus: "delivered" });
    const mapping = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, ownerUid: sponsorUid, code, createdAtEpochMs: 2000 };
    await db.collection("referralCodes").doc(`code_${code}`).set(mapping); await db.collection("referralCodes").doc(`owner_${sponsorUid}`).set(mapping);
    const before = await capture();
    await rejects(linkReferral({ db, user: { uid, email: "changed@example.test", emailVerified: true }, code, keyring, program, nowEpochMs: 4000,
      getSponsorIdentity: async () => ({ uid: sponsorUid, email: "sponsor@example.test", emailVerified: true, disabled: false }) }), { code: "referee_already_paid" });
    deepStrictEqual(await capture(), before); await db.collection("orders").doc("sponsor-paid").delete();
    const report = await migrate(true); equal(report.markerComplete, true); equal(report.verification?.detachedPaymentIdentityEvidence, 1);
  });
  await test("nouveau UID actif/vérifié même email: link refusé, aucune relation/claim", async () => {
    await reconcile(true); const sponsorUid = "legacy-sponsor", code = "L".repeat(26);
    await db.collection("orders").doc("sponsor-paid").set({ ...order("sponsor-paid", sponsorUid, "sponsor@example.test"), orderStatus: "delivered" });
    const mapping = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, ownerUid: sponsorUid, code, createdAtEpochMs: 2000 };
    await db.collection("referralCodes").doc(`code_${code}`).set(mapping); await db.collection("referralCodes").doc(`owner_${sponsorUid}`).set(mapping);
    const before = await capture();
    await rejects(linkReferral({ db, user: { uid: "new-uid", email, emailVerified: true }, code, keyring, program, nowEpochMs: 4000,
      getSponsorIdentity: async () => ({ uid: sponsorUid, email: "sponsor@example.test", emailVerified: true, disabled: false }) }), { code: "referee_already_paid" });
    deepStrictEqual(await capture(), before);
  });
  await test("plain payment email vérifié/block existant: paid + evidence block, aucun claim", async () => {
    await reconcile(true); const plainId = "plain-block", newUid = "plain-new-uid";
    await db.collection("orders").doc(plainId).set({ ...order(plainId, newUid, "checkout-other@example.test"), paymentStatus: "to_confirm", paidAt: null });
    await commitOrderStatusTransition({ db, admin: { uid: "fixture-admin", email: "admin@example.test" }, accrualProgram: null, reservationProgram: null,
      referralProgram: program, getSponsorIdentity: async requested => ({ uid: requested, email, emailVerified: true, disabled: false }),
      referralEmailKeyring: () => keyringJson, now: () => "2000-01-10T00:00:00.000Z",
      body: { orderId: plainId, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } });
    equal((await db.collection("orders").doc(plainId).get()).data()?.paymentStatus, "paid");
    equal((await db.collection("referralPaymentIdentities").doc(plainId).get()).data()?.status, "blocked_by_legacy_email");
    equal((await db.collection("referralEmailClaims").get()).size, 0); equal((await db.collection("referralEmailBlocks").get()).size, 1);
  });
  await test("OFF ne lit aucun block, Auth ou keyring", async () => {
    await db.collection("orders").doc(id).update({ paymentStatus: "to_confirm", paidAt: null });
    const guarded = new Proxy(db, { get(target, property) {
      if (property === "collection") return (name: string) => { if (name === "referralEmailBlocks") throw new Error("unexpected_block_read"); return target.collection(name); };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } }) as Firestore;
    await commitOrderStatusTransition({ db: guarded, admin: { uid: "fixture-admin", email: "admin@example.test" }, accrualProgram: null, reservationProgram: null,
      referralProgram: REFERRAL_CLOSED_RUNTIME, getSponsorIdentity: async () => { throw new Error("unexpected_auth"); }, referralEmailKeyring: () => { throw new Error("unexpected_keyring"); },
      now: () => "2000-01-10T00:00:00.000Z", body: { orderId: id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } });
    equal((await db.collection("referralPaymentIdentities").doc(id).get()).data()?.status, "unresolved");
  });
  await test("claim apparu après qualification: refus transactionnel, aucun écrasement", async () => {
    let expected: Awaited<ReturnType<typeof capture>> | undefined;
    const report = await reconcile(true, { getIdentityByEmail: async () => { await db.collection("referralEmailClaims").doc(blockId).set(claim("racing-owner")); expected = await capture(); return account; } });
    equal(report.legacyBlockUnresolved, 1); equal(report.changed, 0); deepStrictEqual(await capture(), expected);
  });
  await test("concurrence apply: block unique, evidence unique et replay inchangé", async () => {
    await Promise.all([reconcile(true), reconcile(true)]);
    equal((await db.collection("referralEmailBlocks").get()).size, 1); equal((await db.collection("referralPaymentIdentities").get()).size, 1);
    const before = await capture(); equal((await reconcile(true)).changed, 0); deepStrictEqual(await capture(), before);
  });
  await test("abort et read-before-write: aucun block/evidence partiel", async () => {
    const checkedDb = new Proxy(db, { get(target, property) {
      if (property === "runTransaction") return (callback: (tx: Transaction) => Promise<unknown>) => target.runTransaction(async tx => {
        let wrote = false;
        const checkedTx = new Proxy(tx, { get(current, method) {
          const value = Reflect.get(current, method); if (typeof value !== "function") return value;
          return (...args: unknown[]) => { if (["get", "getAll"].includes(String(method))) equal(wrote, false);
            if (["set", "create", "update", "delete"].includes(String(method))) wrote = true; return Reflect.apply(value, current, args); };
        } });
        await callback(checkedTx); ok(wrote); throw new Error("fixture_abort");
      });
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } }) as Firestore;
    const before = await capture(); await rejects(reconcile(true, { db: checkedDb }), /fixture_abort/); deepStrictEqual(await capture(), before);
  });
  await test("rotation: ancien alias block reste décisif et aucun claim nouveau", async () => {
    await reconcile(true); const rotatedSecret = "legacy-rotated-local-fixture-secret-32-bytes-minimum";
    const rotated = JSON.stringify({ activeVersion: "v2", keys: { v1: secret, v2: rotatedSecret } });
    const newId = "rotated-plain"; await db.collection("orders").doc(newId).set(order(newId, "rotated-new-uid", email));
    const report = await reconcile(true, { keyringJson: rotated, getIdentity: async requested => ({ uid: requested, email, emailVerified: true, disabled: false }) });
    equal(report.legacyBlocked, 1); equal((await db.collection("referralPaymentIdentities").doc(newId).get()).data()?.blockId, blockId);
    equal((await db.collection("referralEmailClaims").get()).size, 0);
  });
  await test("alias HMAC historique non versionné protège sans créer de claim", async () => {
    const alias = referralEmailClaimAliases(keyring, email).find(value => value.version === "referral-email-hmac-v1")!;
    await db.collection("referralEmailBlocks").doc(alias.id).set({ ...block, keyVersion: alias.version });
    const identity = await readCurrentPaymentIdentity("new-uid", async requested => ({ uid: requested, email, emailVerified: true, disabled: false }), () => keyringJson);
    const plan = await db.runTransaction(transaction => prepareReferralEmailIdentityProtection({ db, transaction, customerUid: "new-uid", identity, recordedAtEpochMs: 4000 }));
    deepStrictEqual(plan, { status: "blocked_by_legacy_email", customerUid: "new-uid", blockId: alias.id, keyVersion: alias.version, policyVersion: policy });
    equal(plan.newClaim, undefined); equal((await db.collection("referralEmailClaims").get()).size, 0);
  });
  await test("block malformé au lookup normal: identity unavailable et aucun claim", async () => {
    await db.collection("referralEmailBlocks").doc(blockId).set({ ...block, ownerUid: uid });
    const identity = await readCurrentPaymentIdentity(uid, async () => ({ ...account, disabled: false, emailVerified: true }), () => keyringJson);
    const before = await capture();
    const plan = await db.runTransaction(transaction => prepareReferralEmailIdentityProtection({ db, transaction, customerUid: uid, identity, recordedAtEpochMs: 4000 }));
    deepStrictEqual(plan, { status: "unresolved", customerUid: uid, reason: "identity_unavailable" }); deepStrictEqual(await capture(), before);
  });
  await test("orderId corrompu: aucun block/evidence automatique", async () => {
    await db.collection("orders").doc(id).delete(); await db.collection("orders").doc("bad order id").set(order("bad order id"));
    const before = await capture(), report = await reconcile(true);
    equal(report.corrupt, 1); equal(report.changed, 0); deepStrictEqual(await capture(), before);
  });
  for (const anomaly of ["missing_block", "corrupt_block", "wrong_key", "wrong_policy", "orphan_block", "corrupt_claim"] as const) await test(`V6 ${anomaly}: refuse complete`, async () => {
    await db.collection("referralPaymentIdentities").doc(id).set(evidence);
    if (anomaly !== "missing_block") await db.collection("referralEmailBlocks").doc(blockId).set({ ...block,
      ...(anomaly === "corrupt_block" ? { ownerUid: uid } : anomaly === "wrong_key" ? { keyVersion: "v2" } : anomaly === "wrong_policy" ? { policyVersion: "wrong" } : {}) });
    if (anomaly === "orphan_block") await db.collection("referralEmailBlocks").doc("a".repeat(64)).set(block);
    if (anomaly === "corrupt_claim") await db.collection("referralEmailClaims").doc("a".repeat(64)).set(claim("bad/uid"));
    const dryBefore = await capture(); const dry = await migrate(); equal(dry.markerComplete, false); deepStrictEqual(await capture(), dryBefore);
    const applied = await migrate(true); equal(applied.markerComplete, false);
    if (["missing_block", "corrupt_block", "wrong_key", "wrong_policy"].includes(anomaly)) ok(applied.initial.corruptPaymentIdentityEvidence > 0);
    if (anomaly === "orphan_block") equal(applied.initial.orphanLegacyEmailBlocks, 1);
    if (anomaly === "corrupt_claim") equal(applied.initial.corruptEmailClaims, 1);
  });
  await test("V6 valide accepte block + evidence, V1 à V5 restent non READY", async () => {
    await reconcile(true); const report = await migrate(true); equal(report.markerComplete, true);
    const stored = (await db.collection("referralMigrations").doc(ORDER_EMAIL_NORMALIZATION_VERSION).get()).data()!;
    equal(stored.verifiedLegacyEmailBlocks, 1); equal(stored.verifiedOrphanLegacyEmailBlocks, 0); equal(isReferralOrderEmailHistoryReady(stored), true);
    for (let version = 1; version <= 5; version++) equal(isReferralOrderEmailHistoryReady({ ...stored, version: `order-email-normalization-v${version}` }), false);
    for (const patch of [{ verifiedLegacyEmailBlocks: -1 }, { verifiedLegacyEmailBlocks: 2 }, { verifiedCorruptLegacyEmailBlocks: 1 }, { verifiedOrphanLegacyEmailBlocks: 1 }])
      equal(isReferralOrderEmailHistoryReady({ ...stored, ...patch }), false);
  });
  for (const outcome of ["same_uid", "other_uid", "multiple_results", "http_failure"] as const) await test(`lookup maintenance email: ${outcome}`, async () => {
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      deepStrictEqual(JSON.parse(String(init?.body)), { email: [email] });
      const user = { localId: outcome === "other_uid" ? "another-uid" : uid, email, disabled: true, emailVerified: false, createdAt: "1000" };
      return new Response(JSON.stringify({ users: outcome === "multiple_results" ? [user, user] : [user] }), { status: outcome === "http_failure" ? 503 : 200 });
    };
    const lookup = () => lookupReferralMaintenanceIdentity({ email, projectId: "verdanza-1f621", accessToken: "fixture-token", fetchImpl: fetchImpl as typeof fetch });
    if (outcome === "multiple_results" || outcome === "http_failure") await rejects(lookup());
    else equal((await lookup()).uid, outcome === "other_uid" ? "another-uid" : uid);
  });
}
