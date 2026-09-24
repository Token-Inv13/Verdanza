import type { Firestore, Transaction } from "firebase-admin/firestore";
import { REFERRAL_EMAIL_KEY_VERSION, REFERRAL_PROGRAM_VERSION, type ReferralCode, type ReferralEmailClaim, type ReferralRelation } from "../../src/types/referral.js";
import { newReferralCode, normalizeReferralEmail, referralEmailClaimId } from "./referralIdentity.js";
import type { ReferralSponsorIdentity } from "./referralSponsorIdentity.js";

export class ReferralError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
type VerifiedUser = { uid: string; email: string | null; emailVerified?: boolean };
type Program = { mode: "active" | "drain"; startsAtEpochMs: number };
const ID = /^[A-Za-z0-9._:@+-]{1,128}$/;
const CODE = /^[A-Z2-7]{26}$/;
const HISTORY_LIMIT = 100;
function uid(value: string) { if (!ID.test(value)) throw new ReferralError("referral_identity_invalid", 400); return value; }
function active(program: Program, now: number) { if (program.mode !== "active" || now < program.startsAtEpochMs) throw new ReferralError("referral_program_disabled", 503); }
function productOrder(value: FirebaseFirestore.DocumentData, includeDeleted = false) {
  return value.orderType !== "preorder" && (includeDeleted || !value.deletedAt) && !value.productionFixture &&
    Array.isArray(value.items) && value.items.length > 0 && value.items.every((item: unknown) =>
      item !== null && typeof item === "object" && typeof (item as { productId?: unknown }).productId === "string" &&
      Number.isSafeInteger((item as { quantity?: unknown }).quantity) && Number((item as { quantity: number }).quantity) > 0) &&
    typeof value.total === "number" && Number.isFinite(value.total) && value.total > 0;
}
function validInstant(value: unknown) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() + 1 === month && calendar.getUTCDate() === day &&
    calendar.getUTCHours() === hour && calendar.getUTCMinutes() === minute && calendar.getUTCSeconds() === second;
}
export function hasHistoricalPaymentEvidence(value: FirebaseFirestore.DocumentData) {
  return productOrder(value, true) && (value.paymentStatus === "paid" || validInstant(value.paymentConfirmedAt) || validInstant(value.paidAt));
}

export async function sponsorHasDeliveredPaidOrder(tx: Transaction, db: Firestore, sponsorUid: string) {
  const orders = await tx.get(db.collection("orders").where("customerId", "==", uid(sponsorUid)).where("paymentStatus", "==", "paid").where("orderStatus", "==", "delivered").limit(HISTORY_LIMIT));
  return orders.docs.some((doc) => productOrder(doc.data()) && doc.data().orderStatus !== "cancelled");
}

async function assertRefereeFirstPaidOrder(tx: Transaction, db: Firestore, refereeUid: string, rawEmail: string, normalizedEmail: string) {
  const searches = [db.collection("orders").where("customerId", "==", refereeUid).limit(HISTORY_LIMIT),
    ...[...new Set([rawEmail, normalizedEmail])].map((email) => db.collection("orders").where("customerEmail", "==", email).limit(HISTORY_LIMIT))];
  for (const query of searches) {
    const result = await tx.get(query);
    if (result.size >= HISTORY_LIMIT) throw new ReferralError("referral_history_inconclusive");
    for (const doc of result.docs) {
      const value = doc.data();
      if (value.orderType === "preorder" || value.productionFixture) continue;
      if (hasHistoricalPaymentEvidence(value)) throw new ReferralError("referee_already_paid");
      if (!productOrder(value, true) && (value.paymentStatus === "paid" || validInstant(value.paymentConfirmedAt) || validInstant(value.paidAt)))
        throw new ReferralError("referral_history_inconclusive");
    }
  }
}

export async function ensureReferralCode(input: { db: Firestore; user: VerifiedUser; program: Program; nowEpochMs: number; codeFactory?: () => string;
  getSponsorIdentity: (uid: string) => Promise<ReferralSponsorIdentity> }) {
  active(input.program, input.nowEpochMs);
  const ownerUid = uid(input.user.uid);
  const ownerIdentity = await input.getSponsorIdentity(ownerUid);
  if (ownerIdentity.uid !== ownerUid || ownerIdentity.disabled) throw new ReferralError("sponsor_ineligible", 403);
  const ownerRef = input.db.collection("referralCodes").doc(`owner_${ownerUid}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = (input.codeFactory ?? newReferralCode)();
    if (!CODE.test(code)) throw new ReferralError("referral_code_invalid", 400);
    const codeRef = input.db.collection("referralCodes").doc(`code_${code}`);
    const outcome = await input.db.runTransaction(async (tx) => {
      const [ownerDoc, codeDoc] = await tx.getAll(ownerRef, codeRef);
      if (ownerDoc.exists) {
        const existing = ownerDoc.data() as ReferralCode;
        if (existing.schemaVersion !== 1 || existing.ownerUid !== ownerUid || existing.programVersion !== REFERRAL_PROGRAM_VERSION || !CODE.test(existing.code)) throw new ReferralError("referral_code_corrupt");
        const ownedMapping = await tx.get(input.db.collection("referralCodes").doc(`code_${existing.code}`));
        if (!ownedMapping.exists || ownedMapping.data()?.ownerUid !== ownerUid || ownedMapping.data()?.code !== existing.code) throw new ReferralError("referral_code_corrupt");
        return { status: "existing" as const, code: existing.code };
      }
      if (codeDoc.exists) return { status: "collision" as const };
      if (!await sponsorHasDeliveredPaidOrder(tx, input.db, ownerUid)) throw new ReferralError("sponsor_ineligible", 403);
      const mapping: ReferralCode = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, ownerUid, code, createdAtEpochMs: input.nowEpochMs };
      tx.create(ownerRef, mapping); tx.create(codeRef, mapping);
      return { status: "created" as const, code };
    });
    if (outcome.status !== "collision") return { code: outcome.code, created: outcome.status === "created" };
  }
  throw new ReferralError("referral_code_collision");
}

/** The only relation-creation operation. The secret is passed after the active gate. */
export async function linkReferral(input: { db: Firestore; user: VerifiedUser; code: string; secret: string; program: Program; nowEpochMs: number;
  getSponsorIdentity: (uid: string) => Promise<ReferralSponsorIdentity> }) {
  active(input.program, input.nowEpochMs);
  const refereeUid = uid(input.user.uid);
  if (!input.user.email || input.user.emailVerified !== true) throw new ReferralError("referee_email_unverified", 403);
  if (!CODE.test(input.code)) throw new ReferralError("referral_code_invalid", 400);
  const normalizedEmail = normalizeReferralEmail(input.user.email);
  const claimId = referralEmailClaimId(input.secret, normalizedEmail);
  const codeRef = input.db.collection("referralCodes").doc(`code_${input.code}`);
  const ownerRef = input.db.collection("referralCodes");
  const codeDoc = await codeRef.get();
  if (!codeDoc.exists) throw new ReferralError("referral_code_unknown", 404);
  const mapping = codeDoc.data() as ReferralCode;
  const sponsorUid = uid(mapping.ownerUid);
  if (mapping.schemaVersion !== 1 || mapping.code !== input.code || mapping.programVersion !== REFERRAL_PROGRAM_VERSION) throw new ReferralError("referral_code_corrupt");
  if (sponsorUid === refereeUid) throw new ReferralError("self_referral", 403);
  const sponsorIdentity = await input.getSponsorIdentity(sponsorUid);
  if (sponsorIdentity.uid !== sponsorUid || sponsorIdentity.disabled) throw new ReferralError("sponsor_ineligible", 403);
  if (normalizeReferralEmail(sponsorIdentity.email) === normalizedEmail) throw new ReferralError("self_referral", 403);
  const relationRef = input.db.collection("referrals").doc(refereeUid);
  const claimRef = input.db.collection("referralEmailClaims").doc(claimId);
  return input.db.runTransaction(async (tx) => {
    const [freshCode, freshOwner, relationDoc, claimDoc] = await tx.getAll(codeRef, ownerRef.doc(`owner_${sponsorUid}`), relationRef, claimRef);
    if (!freshCode.exists || freshCode.data()?.ownerUid !== sponsorUid || !freshOwner.exists || freshOwner.data()?.code !== input.code) throw new ReferralError("referral_code_conflict");
    if (!await sponsorHasDeliveredPaidOrder(tx, input.db, sponsorUid)) throw new ReferralError("sponsor_ineligible", 403);
    await assertRefereeFirstPaidOrder(tx, input.db, refereeUid, input.user.email!.trim(), normalizedEmail);
    const existing = relationDoc.exists ? relationDoc.data() as ReferralRelation : null;
    if (claimDoc.exists && (claimDoc.data()?.refereeUid !== refereeUid || claimDoc.data()?.referralId !== refereeUid ||
      claimDoc.data()?.schemaVersion !== 1 || claimDoc.data()?.programVersion !== REFERRAL_PROGRAM_VERSION ||
      claimDoc.data()?.keyVersion !== REFERRAL_EMAIL_KEY_VERSION)) throw new ReferralError("referral_email_claimed");
    if (existing && (existing.refereeUid !== refereeUid || existing.programVersion !== REFERRAL_PROGRAM_VERSION || existing.state !== "linked" || existing.qualifyingOrderId !== null)) throw new ReferralError("referral_relation_consumed");
    if (existing?.sponsorUid === sponsorUid && claimDoc.exists) return { state: "linked" as const, changed: false };
    const relation: ReferralRelation = existing ? { ...existing, sponsorUid, linkedAtEpochMs: input.nowEpochMs } : {
      schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, sponsorUid, refereeUid, state: "linked",
      createdAtEpochMs: input.nowEpochMs, linkedAtEpochMs: input.nowEpochMs, qualifyingOrderId: null,
      deliveredOrderId: null,
      paymentConfirmed: false, deliveryConfirmed: false, rewardCompartment: "none", cumulativeReturnedProductsCents: 0, processedRefunds: {},
    };
    const claim: ReferralEmailClaim = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, keyVersion: REFERRAL_EMAIL_KEY_VERSION, refereeUid, referralId: refereeUid, createdAtEpochMs: input.nowEpochMs };
    if (existing) tx.set(relationRef, relation); else tx.create(relationRef, relation);
    if (!claimDoc.exists) tx.create(claimRef, claim);
    return { state: "linked" as const, changed: true };
  });
}

export async function readReferralSelf(db: Firestore, refereeUid: string) {
  const id = uid(refereeUid);
  const [doc, owner] = await Promise.all([
    db.collection("referrals").doc(id).get(),
    db.collection("referralCodes").doc(`owner_${id}`).get(),
  ]);
  const code = owner.exists && owner.data()?.schemaVersion === 1 && owner.data()?.programVersion === REFERRAL_PROGRAM_VERSION &&
    owner.data()?.ownerUid === id && CODE.test(owner.data()?.code) ? owner.data()!.code as string : null;
  if (!doc.exists) return { code, relation: null };
  const relation = doc.data() as ReferralRelation;
  if (relation.refereeUid !== id) throw new ReferralError("referral_relation_corrupt");
  return { code, relation: { state: relation.state, paymentConfirmed: relation.paymentConfirmed, deliveryConfirmed: relation.deliveryConfirmed } };
}
