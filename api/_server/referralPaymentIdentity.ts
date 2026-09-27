import type { Firestore, Transaction } from "firebase-admin/firestore";
import { REFERRAL_PAYMENT_IDENTITY_VERSION, REFERRAL_PROGRAM_VERSION,
  type ReferralEmailClaim, type ReferralPaymentIdentityEvidence, type ReferralPaymentIdentityReason } from "../../src/types/referral.js";
import { normalizeReferralEmail, parseReferralEmailKeyring, referralEmailClaimAliases } from "./referralIdentity.js";
import type { ReferralSponsorIdentity } from "./referralSponsorIdentity.js";

export const REFERRAL_PAYMENT_IDENTITIES_COLLECTION = "referralPaymentIdentities";
export type CurrentPaymentIdentity = {
  customerUid: string; reason?: ReferralPaymentIdentityReason; normalizedEmail?: string; activeKeyVersion?: string;
  aliases?: readonly { version: string; id: string }[];
};
export type PreparedEmailIdentityClaim = ({ status: "claimed" | "protected_by_existing_claim"; claimId: string; keyVersion: string }
  | { status: "unresolved"; reason: ReferralPaymentIdentityReason }) & {
    customerUid: string; newClaim?: { ref: FirebaseFirestore.DocumentReference; value: ReferralEmailClaim };
  };
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:@+-]{1,128}$/.test(value);
const validKeyVersion = (value: unknown): value is string => typeof value === "string" && /^(v[1-9][0-9]{0,2}|referral-email-hmac-v1)$/.test(value);
const validClaimId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const instant = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/** An email claim is an identity reservation; it does not imply that a relation exists. */
export function isValidReferralEmailIdentityClaim(value: FirebaseFirestore.DocumentData | undefined, keyVersion: string): value is ReferralEmailClaim {
  return value?.schemaVersion === 1 && value.programVersion === REFERRAL_PROGRAM_VERSION && value.keyVersion === keyVersion &&
    validKeyVersion(keyVersion) && validId(value.refereeUid) && value.referralId === value.refereeUid && instant(value.createdAtEpochMs);
}

/** Network/secret work is outside Firestore transactions, and is never invoked by a closed runtime. */
export async function readCurrentPaymentIdentity(customerUid: string, getIdentity: (uid: string) => Promise<ReferralSponsorIdentity>,
  readKeyring: () => string): Promise<CurrentPaymentIdentity> {
  let account: ReferralSponsorIdentity;
  try { account = await getIdentity(customerUid); }
  catch { return { customerUid, reason: "auth_unavailable" }; }
  if (account.uid !== customerUid) return { customerUid, reason: "identity_unavailable" };
  if (account.disabled || account.emailVerified !== true) return { customerUid, reason: "referee_email_unverified" };
  let normalizedEmail: string;
  try { normalizedEmail = normalizeReferralEmail(account.email); }
  catch { return { customerUid, reason: "identity_unavailable" }; }
  try {
    const keyring = parseReferralEmailKeyring(readKeyring());
    return { customerUid, normalizedEmail, activeKeyVersion: keyring.activeVersion, aliases: referralEmailClaimAliases(keyring, normalizedEmail) };
  } catch { return { customerUid, normalizedEmail, reason: "keyring_unavailable" }; }
}

/** Read phase only. All aliases are checked before choosing ownership or a lazy active-key migration. */
export async function prepareReferralEmailIdentityClaim(input: { db: Firestore; transaction: Transaction; customerUid: string;
  identity?: CurrentPaymentIdentity; recordedAtEpochMs: number }): Promise<PreparedEmailIdentityClaim> {
  const { customerUid, identity } = input;
  const unresolved = (reason: ReferralPaymentIdentityReason): PreparedEmailIdentityClaim => ({ status: "unresolved", customerUid, reason });
  if (!identity || identity.customerUid !== customerUid) return unresolved("identity_unavailable");
  if (identity.reason) return unresolved(identity.reason);
  if (!identity.normalizedEmail || !identity.aliases?.length || !identity.activeKeyVersion || !instant(input.recordedAtEpochMs))
    return unresolved("identity_unavailable");
  const aliases = identity.aliases;
  if (aliases.some((alias) => !validClaimId(alias.id) || !validKeyVersion(alias.version))) return unresolved("identity_unavailable");
  const activeIndex = aliases.findIndex((alias) => alias.version === identity.activeKeyVersion);
  if (activeIndex < 0) return unresolved("keyring_unavailable");
  const refs = aliases.map((alias) => input.db.collection("referralEmailClaims").doc(alias.id));
  const docs = await input.transaction.getAll(...refs);
  for (let i = 0; i < docs.length; i++) {
    const claim = docs[i].data();
    if (docs[i].exists && !isValidReferralEmailIdentityClaim(claim, aliases[i].version)) return unresolved("identity_unavailable");
  }
  const conflictIndex = docs.findIndex((doc) => doc.exists && doc.data()!.refereeUid !== customerUid);
  if (conflictIndex >= 0) return { status: "protected_by_existing_claim", customerUid,
    claimId: aliases[conflictIndex].id, keyVersion: aliases[conflictIndex].version };
  const claim = { schemaVersion: 1 as const, programVersion: REFERRAL_PROGRAM_VERSION, keyVersion: identity.activeKeyVersion,
    refereeUid: customerUid, referralId: customerUid, createdAtEpochMs: input.recordedAtEpochMs };
  return { status: "claimed", customerUid, claimId: aliases[activeIndex].id, keyVersion: identity.activeKeyVersion,
    ...(docs[activeIndex].exists ? {} : { newClaim: { ref: refs[activeIndex], value: claim } }) };
}

/** Strict persistent shape: no clear personal data or transient Auth/secret fields. */
export function paymentIdentityEvidenceShape(value: FirebaseFirestore.DocumentData | undefined, orderId: string, customerUid: string): "safe" | "unresolved" | "corrupt" {
  if (!value || value.schemaVersion !== 1 || value.version !== REFERRAL_PAYMENT_IDENTITY_VERSION ||
    value.orderId !== orderId || value.customerUid !== customerUid || !validId(orderId) || !validId(customerUid) || !instant(value.recordedAtEpochMs)) return "corrupt";
  const base = ["schemaVersion", "version", "orderId", "customerUid", "status", "recordedAtEpochMs"];
  if (value.status === "unresolved") {
    return ["runtime_closed", "auth_unavailable", "referee_email_unverified", "keyring_unavailable", "identity_unavailable"].includes(value.reason) &&
      Object.keys(value).every((key) => [...base, "reason"].includes(key)) ? "unresolved" : "corrupt";
  }
  return ["claimed", "protected_by_existing_claim"].includes(value.status) && validClaimId(value.claimId) && validKeyVersion(value.keyVersion) &&
    Object.keys(value).every((key) => [...base, "claimId", "keyVersion"].includes(key)) ? "safe" : "corrupt";
}

export function paymentIdentityClaimMatches(evidence: ReferralPaymentIdentityEvidence, claim: FirebaseFirestore.DocumentData | undefined): boolean {
  return evidence.status !== "unresolved" && isValidReferralEmailIdentityClaim(claim, evidence.keyVersion) &&
    (evidence.status === "claimed" ? claim.refereeUid === evidence.customerUid : claim.refereeUid !== evidence.customerUid);
}

/** Bounded positive payment proof. Claims and source orders are deliberately not required. */
export async function findPriorReferralPaymentIdentity(transaction: Transaction, db: Firestore, customerUid: string):
  Promise<{ kind: "found"; orderId: string } | { kind: "none" | "inconclusive" }> {
  if (!validId(customerUid)) return { kind: "inconclusive" };
  const limit = 100;
  const result = await transaction.get(db.collection(REFERRAL_PAYMENT_IDENTITIES_COLLECTION).where("customerUid", "==", customerUid).limit(limit));
  let inconclusive = result.size >= limit;
  for (const doc of result.docs) {
    const shape = paymentIdentityEvidenceShape(doc.data(), doc.id, customerUid);
    if (shape === "safe" || shape === "unresolved") return { kind: "found", orderId: doc.id };
    inconclusive = true;
  }
  return { kind: inconclusive ? "inconclusive" : "none" };
}

/** Writes are deliberately delegated to the caller's final transaction write phase. */
export async function prepareReferralPaymentIdentity(input: { db: Firestore; transaction: Transaction; orderId: string; customerUid: string;
  operational: boolean; identity?: CurrentPaymentIdentity; recordedAtEpochMs: number }) {
  const ref = input.db.collection(REFERRAL_PAYMENT_IDENTITIES_COLLECTION).doc(input.orderId);
  await input.transaction.get(ref);
  const claim: PreparedEmailIdentityClaim = input.operational ? await prepareReferralEmailIdentityClaim(input) :
    { status: "unresolved", customerUid: input.customerUid, reason: "runtime_closed" };
  const evidence: ReferralPaymentIdentityEvidence = { schemaVersion: 1, version: REFERRAL_PAYMENT_IDENTITY_VERSION,
    orderId: input.orderId, customerUid: input.customerUid, recordedAtEpochMs: input.recordedAtEpochMs,
    ...(claim.status === "unresolved" ? { status: claim.status, reason: claim.reason } :
      { status: claim.status, claimId: claim.claimId, keyVersion: claim.keyVersion }) };
  return { claim, evidence, write() {
    if (claim.newClaim) input.transaction.create(claim.newClaim.ref, claim.newClaim.value);
    input.transaction.set(ref, evidence);
  } };
}
