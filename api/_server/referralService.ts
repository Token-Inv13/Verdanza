import type { Firestore, Transaction } from "firebase-admin/firestore";
import { REFERRAL_PROGRAM_VERSION, type ReferralCode, type ReferralEmailClaim, type ReferralRelation, type ReferralRelinkEvent } from "../../src/types/referral.js";
import { newReferralCode, normalizeReferralEmail, referralEmailClaimAliases, type ReferralEmailKeyring } from "./referralIdentity.js";
import type { ReferralSponsorIdentity } from "./referralSponsorIdentity.js";
import { canonicalOrderEmail } from "./orderEmailIdentity.js";
import { readReferralOrderEmailHistoryReady } from "./referralOrderEmailHistory.js";

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
export function productOrder(value: FirebaseFirestore.DocumentData, includeDeleted = false) {
  return (includeDeleted || !value.deletedAt) && !value.productionFixture &&
    Array.isArray(value.items) && value.items.length > 0 && value.items.every((item: unknown) =>
      item !== null && typeof item === "object" && typeof (item as { productId?: unknown }).productId === "string" &&
      Number.isSafeInteger((item as { quantity?: unknown }).quantity) && Number((item as { quantity: number }).quantity) > 0) &&
    typeof value.total === "number" && Number.isFinite(value.total) && value.total > 0;
}
export function isValidHistoricalPaymentInstant(value: unknown) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:(\d{2}))$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1] &&
    hour <= 23 && minute <= 59 && second <= 59 && (match[7] === undefined || Number(match[7]) <= 59) &&
    Number.isFinite(Date.parse(value));
}
export function hasHistoricalPaymentEvidence(value: FirebaseFirestore.DocumentData) {
  return productOrder(value, true) && (value.paymentStatus === "paid" || isValidHistoricalPaymentInstant(value.paymentConfirmedAt) || isValidHistoricalPaymentInstant(value.paidAt));
}

export async function sponsorHasDeliveredPaidOrder(tx: Transaction, db: Firestore, sponsorUid: string) {
  const orders = await tx.get(db.collection("orders").where("customerId", "==", uid(sponsorUid)).where("paymentStatus", "==", "paid").where("orderStatus", "==", "delivered").limit(HISTORY_LIMIT));
  return orders.docs.some((doc) => productOrder(doc.data()) && doc.data().orderStatus !== "cancelled");
}

/** Bounded, transactional historical check. An inconclusive result must never authorize a reward. */
export async function findPriorPaidProductOrder(tx: Transaction, db: Firestore, refereeUid: string, currentOrderId: string | null,
  rawEmail?: string, normalizedEmail?: string): Promise<{ kind: "found"; orderId: string } | { kind: "none" | "inconclusive" }> {
  const emails = [...new Set([rawEmail, normalizedEmail].filter((email): email is string => Boolean(email)))];
  const searches = [db.collection("orders").where("customerId", "==", uid(refereeUid)).limit(HISTORY_LIMIT),
    ...(normalizedEmail ? [db.collection("orders").where("customerEmailNormalized", "==", canonicalOrderEmail(normalizedEmail)).limit(HISTORY_LIMIT)] : []),
    ...emails.map((email) => db.collection("orders").where("customerEmail", "==", email).limit(HISTORY_LIMIT))];
  let inconclusive = false;
  for (const query of searches) {
    const result = await tx.get(query);
    if (result.size >= HISTORY_LIMIT) inconclusive = true;
    for (const doc of result.docs) {
      if (doc.id === currentOrderId) continue;
      const value = doc.data();
      if (value.productionFixture) continue;
      if (hasHistoricalPaymentEvidence(value)) return { kind: "found", orderId: doc.id };
      if (!productOrder(value, true) && (value.paymentStatus === "paid" || isValidHistoricalPaymentInstant(value.paymentConfirmedAt) || isValidHistoricalPaymentInstant(value.paidAt)))
        inconclusive = true;
    }
  }
  // Exact legacy strings are useful positive evidence, but cannot prove absence.
  if (!await readReferralOrderEmailHistoryReady(tx, db)) inconclusive = true;
  return { kind: inconclusive ? "inconclusive" : "none" };
}

async function assertRefereeFirstPaidOrder(tx: Transaction, db: Firestore, refereeUid: string, rawEmail: string, normalizedEmail: string) {
  const history = await findPriorPaidProductOrder(tx, db, refereeUid, null, rawEmail, normalizedEmail);
  if (history.kind === "found") throw new ReferralError("referee_already_paid");
  if (history.kind === "inconclusive") throw new ReferralError("referral_history_inconclusive");
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
      if (!await readReferralOrderEmailHistoryReady(tx, input.db)) throw new ReferralError("referral_history_inconclusive");
      const [ownerDoc, codeDoc] = await tx.getAll(ownerRef, codeRef);
      if (ownerDoc.exists) {
        const existing = ownerDoc.data() as ReferralCode;
        if (existing.schemaVersion !== 1 || existing.ownerUid !== ownerUid || existing.programVersion !== REFERRAL_PROGRAM_VERSION || !CODE.test(existing.code)) throw new ReferralError("referral_code_corrupt");
        const ownedMapping = await tx.get(input.db.collection("referralCodes").doc(`code_${existing.code}`));
        if (!ownedMapping.exists || ownedMapping.data()?.ownerUid !== ownerUid || ownedMapping.data()?.code !== existing.code) throw new ReferralError("referral_code_corrupt");
        if (!await sponsorHasDeliveredPaidOrder(tx, input.db, ownerUid)) throw new ReferralError("sponsor_ineligible", 403);
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
export async function linkReferral(input: { db: Firestore; user: VerifiedUser; code: string; keyring: ReferralEmailKeyring; program: Program; nowEpochMs: number;
  getSponsorIdentity: (uid: string) => Promise<ReferralSponsorIdentity> }) {
  active(input.program, input.nowEpochMs);
  const refereeUid = uid(input.user.uid);
  if (!input.user.email || input.user.emailVerified !== true) throw new ReferralError("referee_email_unverified", 403);
  if (!CODE.test(input.code)) throw new ReferralError("referral_code_invalid", 400);
  const normalizedEmail = normalizeReferralEmail(input.user.email);
  const aliases = referralEmailClaimAliases(input.keyring, normalizedEmail);
  const activeAlias = aliases.find((alias) => alias.version === input.keyring.activeVersion)!;
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
  const claimRefs = aliases.map((alias) => input.db.collection("referralEmailClaims").doc(alias.id));
  return input.db.runTransaction(async (tx) => {
    const [freshCode, freshOwner, relationDoc, ...claimDocs] = await tx.getAll(codeRef, ownerRef.doc(`owner_${sponsorUid}`), relationRef, ...claimRefs);
    if (!freshCode.exists || freshCode.data()?.ownerUid !== sponsorUid || !freshOwner.exists || freshOwner.data()?.code !== input.code) throw new ReferralError("referral_code_conflict");
    if (!await sponsorHasDeliveredPaidOrder(tx, input.db, sponsorUid)) throw new ReferralError("sponsor_ineligible", 403);
    await assertRefereeFirstPaidOrder(tx, input.db, refereeUid, input.user.email!.trim(), normalizedEmail);
    const existing = relationDoc.exists ? relationDoc.data() as ReferralRelation : null;
    for (const [index, claimDoc] of claimDocs.entries()) if (claimDoc.exists &&
      (claimDoc.data()?.refereeUid !== refereeUid || claimDoc.data()?.referralId !== refereeUid ||
       claimDoc.data()?.schemaVersion !== 1 || claimDoc.data()?.programVersion !== REFERRAL_PROGRAM_VERSION ||
       claimDoc.data()?.keyVersion !== aliases[index].version)) throw new ReferralError("referral_email_claimed");
    if (existing && (existing.refereeUid !== refereeUid || existing.programVersion !== REFERRAL_PROGRAM_VERSION || existing.state !== "linked" || existing.qualifyingOrderId !== null)) throw new ReferralError("referral_relation_consumed");
    const activeClaimExists = claimDocs[aliases.indexOf(activeAlias)].exists;
    if (existing?.sponsorUid === sponsorUid && activeClaimExists) return { state: "linked" as const, changed: false };
    const revision = (existing?.relinkRevision ?? 0) + (existing && existing.sponsorUid !== sponsorUid ? 1 : 0);
    if (!Number.isSafeInteger(revision)) throw new ReferralError("referral_relation_corrupt");
    const relation: ReferralRelation = existing ? { ...existing, sponsorUid, linkedAtEpochMs: existing.sponsorUid === sponsorUid ? existing.linkedAtEpochMs : input.nowEpochMs, relinkRevision: revision } : {
      schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, sponsorUid, refereeUid, state: "linked",
      createdAtEpochMs: input.nowEpochMs, linkedAtEpochMs: input.nowEpochMs, relinkRevision: 0, qualifyingOrderId: null,
      deliveredOrderId: null,
      paymentConfirmed: false, deliveryConfirmed: false, rewardCompartment: "none", cumulativeReturnedProductsCents: 0, processedRefunds: {},
    };
    const claim: ReferralEmailClaim = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, keyVersion: input.keyring.activeVersion, refereeUid, referralId: refereeUid, createdAtEpochMs: input.nowEpochMs };
    if (existing) tx.set(relationRef, relation); else tx.create(relationRef, relation);
    if (!activeClaimExists) tx.create(claimRefs[aliases.indexOf(activeAlias)], claim);
    if (existing && existing.sponsorUid !== sponsorUid) {
      const event: ReferralRelinkEvent = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, type: "sponsor_relinked",
        refereeUid, previousSponsorUid: existing.sponsorUid, nextSponsorUid: sponsorUid, previousLinkedAtEpochMs: existing.linkedAtEpochMs,
        changedAtEpochMs: input.nowEpochMs, revision };
      tx.create(relationRef.collection("events").doc(`sponsor_change_${revision}`), event);
    }
    return { state: "linked" as const, changed: true };
  });
}

export async function readReferralSelf(db: Firestore, refereeUid: string) {
  const id = uid(refereeUid);
  const doc = await db.collection("referrals").doc(id).get();
  if (!doc.exists) return { code: null, relation: null };
  const relation = doc.data() as ReferralRelation;
  if (relation.refereeUid !== id) throw new ReferralError("referral_relation_corrupt");
  return { code: null, relation: { state: relation.state, paymentConfirmed: relation.paymentConfirmed, deliveryConfirmed: relation.deliveryConfirmed } };
}
