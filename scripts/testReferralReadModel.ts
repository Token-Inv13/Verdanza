import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { readReferralSelf, REFERRAL_SELF_SCAN_LIMIT } from "../api/_server/referralService.js";
import { createReferralHandler } from "../api/referral.js";
import { REFERRAL_PROGRAM_VERSION, type ReferralRelation } from "../src/types/referral.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";

export async function exerciseReferralReadModel(db: Firestore, test: (name: string, run: () => Promise<void>) => Promise<void>) {
  const owner = "read-model-owner", code = "R".repeat(26);
  const codes = db.collection("referralCodes"), relations = db.collection("referrals");
  const empty = { referralsTotal: 0, linkedCount: 0, pendingCount: 0, rewardedCount: 0, cancelledCount: 0,
    reversedCount: 0, pendingRewardCents: 0, validatedRewardCents: 0 };
  const relation = (id: string, state: ReferralRelation["state"]): ReferralRelation => ({ schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION,
    refereeUid: id, sponsorUid: owner, state, createdAtEpochMs: 2000, linkedAtEpochMs: 2000,
    qualifyingOrderId: state === "linked" ? null : `private-order-${id}`, deliveredOrderId: ["rewarded", "reversed"].includes(state) ? `private-order-${id}` : null,
    paymentConfirmed: state !== "linked", deliveryConfirmed: ["rewarded", "reversed"].includes(state),
    rewardCompartment: state === "pending" ? "pending" : state === "rewarded" ? "available" : "none", cumulativeReturnedProductsCents: 0, processedRefunds: {} });
  await test("self versionné sans code ni relation, zéro statistiques et aucune création", async () => {
    const before = (await codes.get()).size;
    deepStrictEqual(await readReferralSelf(db, owner), { version: "referral-self-v1", code: null, relation: null, sponsorSummary: empty });
    equal((await codes.get()).size, before); equal((await relations.doc(owner).get()).exists, false);
  });
  const mapping = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, ownerUid: owner, code, createdAtEpochMs: 2000 };
  await codes.doc(`owner_${owner}`).set(mapping); await codes.doc(`code_${code}`).set(mapping);
  await db.collection("orders").doc("read-model-eligibility").set({ customerId: owner, paymentStatus: "paid", orderStatus: "delivered", total: 60,
    items: [{ productId: "synthetic-product", quantity: 1 }] });
  await test("self lit le code existant sans rotation ni mutation", async () => {
    const before = (await codes.doc(`owner_${owner}`).get()).data();
    equal((await readReferralSelf(db, owner)).code, code); deepStrictEqual((await codes.doc(`owner_${owner}`).get()).data(), before);
  });
  for (const invalid of [null, { ...mapping, ownerUid: "other-owner" }, { ...mapping, schemaVersion: 2 },
    { ...mapping, programVersion: "future" }, { ...mapping, createdAtEpochMs: -1 }, { ...mapping, code: "Z".repeat(26) }]) {
    await test("self refuse un inverse code absent ou corrompu", async () => {
      if (invalid) await codes.doc(`code_${code}`).set(invalid); else await codes.doc(`code_${code}`).delete();
      await rejects(readReferralSelf(db, owner), /referral_code_corrupt/);
    });
  }
  await codes.doc(`code_${code}`).set(mapping);
  for (const state of ["linked", "pending", "rewarded", "cancelled", "reversed"] as const) {
    await test(`self agrège uniquement ${state} sans exposer le filleul`, async () => {
      await relations.doc(`private-referee-${state}`).set(relation(`private-referee-${state}`, state));
      const self = await readReferralSelf(db, owner);
      equal(self.sponsorSummary[`${state}Count`], 1);
      ok(!JSON.stringify(self).includes("private-referee")); ok(!JSON.stringify(self).includes("private-order"));
      deepStrictEqual(Object.keys(self).sort(), ["code", "relation", "sponsorSummary", "version"]);
    });
  }
  await test("self total nominal pending/validé, aucune confusion avec le wallet", async () => {
    const self = await readReferralSelf(db, owner);
    deepStrictEqual(self.sponsorSummary, { ...empty, referralsTotal: 5, linkedCount: 1, pendingCount: 1, rewardedCount: 1,
      cancelledCount: 1, reversedCount: 1, pendingRewardCents: 1000, validatedRewardCents: 1000 });
    ok(!JSON.stringify(self).includes("available"));
  });
  await test("self refuse une relation incohérente au lieu d'agréger des faux totaux", async () => {
    await relations.doc("private-corrupt").set({ ...relation("private-corrupt", "pending"), paymentConfirmed: false });
    await rejects(readReferralSelf(db, owner), /referral_relation_corrupt/); await relations.doc("private-corrupt").delete();
  });
  await test("self drain fonctionne sans secret, uniquement projection propriétaire", async () => {
    let body: unknown; let status = 0;
    const handler = createReferralHandler({ runtime: () => ({ mode: "drain", operational: true, startsAtEpochMs: 1000 }),
      verify: async () => ({ uid: "private-referee-linked", email: null }), db: () => db,
      secret: () => { throw new Error("unexpected_keyring"); }, sponsorIdentity: async () => { throw new Error("unexpected_auth_lookup"); }, now: () => 2000 });
    await handler({ method: "GET", headers: { authorization: "Bearer fixture" } } as VercelRequestLike,
      { setHeader() {}, status(s: number) { status = s; return this; }, json(value: unknown) { body = value; } } as unknown as VercelResponseLike);
    equal(status, 200); deepStrictEqual((body as { relation: unknown }).relation, { state: "linked", paymentConfirmed: false, deliveryConfirmed: false, checkoutReserved: false });
    ok(!JSON.stringify(body).includes(owner));
  });
  await test("self borne dépassée fail closed, aucun total partiel", async () => {
    const batch = db.batch();
    for (let i = 0; i <= REFERRAL_SELF_SCAN_LIMIT; i++) { const id = `private-bound-${i}`; batch.set(relations.doc(id), relation(id, "linked")); }
    await batch.commit(); await rejects(readReferralSelf(db, owner), /referral_summary_inconclusive/);
  });
}
