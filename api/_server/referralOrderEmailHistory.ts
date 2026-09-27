import type { Firestore, Transaction } from "firebase-admin/firestore";
import { REFERRAL_PROGRAM_VERSION } from "../../src/types/referral.js";

export const ORDER_EMAIL_NORMALIZATION_VERSION = "order-email-normalization-v5";
export const ORDER_EMAIL_MIGRATION_COLLECTION = "referralMigrations";

export function isUnresolvedReferralIdentityHistoryReason(reason: unknown): boolean {
  return reason === "referee_identity_unavailable" || reason === "referee_email_unverified" || reason === "referral_identity_changed";
}

/** Optional V1 reservation is valid only on a completely unqualified linked relation. */
export function isValidReferralCheckoutReservation(value: FirebaseFirestore.DocumentData): boolean {
  const r = value.checkoutReservation;
  if (r === undefined) return true;
  return r !== null && typeof r === "object" && !Array.isArray(r) && r.schemaVersion === 1 &&
    typeof r.orderId === "string" && /^[A-Za-z0-9._:@+-]{1,128}$/.test(r.orderId) &&
    typeof r.checkoutRequestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.checkoutRequestId) &&
    Number.isSafeInteger(r.createdAtEpochMs) && r.createdAtEpochMs >= 0 &&
    value.state === "linked" && value.qualifyingOrderId === null && value.deliveredOrderId === null &&
    value.paymentConfirmed === false && value.deliveryConfirmed === false && value.rewardCompartment === "none";
}

/** Migration-only validation. Corruption must not hide a consumed identity anomaly. */
export function referralRelationIdentityHistoryStatus(id: string, value: FirebaseFirestore.DocumentData): "clear" | "unresolved" | "corrupt" {
  const validId = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9._:@+-]{1,128}$/.test(v);
  const nonnegative = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const reasons = ["sponsor_no_longer_eligible", "sponsor_account_disabled", "sponsor_identity_unavailable",
    "first_paid_order_without_referral_discount", "prior_paid_order_detected", "referral_history_inconclusive",
    "referee_identity_unavailable", "referee_email_unverified", "referee_email_claimed", "self_referral_at_payment", "referral_identity_changed"];
  if (!isValidReferralCheckoutReservation(value) || value.schemaVersion !== 1 || value.programVersion !== REFERRAL_PROGRAM_VERSION || !validId(id) || value.refereeUid !== id ||
    !validId(value.sponsorUid) || value.sponsorUid === id || !nonnegative(value.createdAtEpochMs) || !nonnegative(value.linkedAtEpochMs) ||
    typeof value.paymentConfirmed !== "boolean" || typeof value.deliveryConfirmed !== "boolean" ||
    (value.qualifyingOrderId !== null && !validId(value.qualifyingOrderId)) ||
    (value.deliveredOrderId !== null && !validId(value.deliveredOrderId)) ||
    value.paymentConfirmed !== (value.qualifyingOrderId !== null) || value.deliveryConfirmed !== (value.deliveredOrderId !== null) ||
    (value.deliveryConfirmed && (!value.paymentConfirmed || value.deliveredOrderId !== value.qualifyingOrderId)) ||
    !nonnegative(value.cumulativeReturnedProductsCents) || !value.processedRefunds || typeof value.processedRefunds !== "object" ||
    Array.isArray(value.processedRefunds) || Object.entries(value.processedRefunds).some(([key, base]) => !validId(key) || !nonnegative(base)) ||
    (value.rewardIneligibilityReason !== undefined && (!reasons.includes(value.rewardIneligibilityReason) || !value.paymentConfirmed || value.rewardCompartment !== "none"))) return "corrupt";
  const coherent = value.state === "linked" ? !value.paymentConfirmed && !value.deliveryConfirmed && value.rewardCompartment === "none"
    : value.state === "pending" ? value.paymentConfirmed && !value.deliveryConfirmed && value.rewardCompartment === "pending"
    : value.state === "rewarded" ? value.paymentConfirmed && value.deliveryConfirmed && value.rewardCompartment === "available"
    : value.state === "cancelled" ? value.paymentConfirmed && value.rewardCompartment === "none"
    : value.state === "reversed" ? value.paymentConfirmed && value.deliveryConfirmed && value.rewardCompartment === "none" : false;
  if (!coherent) return "corrupt";
  return isUnresolvedReferralIdentityHistoryReason(value.rewardIneligibilityReason) ? "unresolved" : "clear";
}

/** Server certificate of the exhaustive technical migration; never grants a reward. */
export function isReferralOrderEmailHistoryReady(value: FirebaseFirestore.DocumentData | undefined): boolean {
  return value?.schemaVersion === 1 && value.version === ORDER_EMAIL_NORMALIZATION_VERSION && value.status === "complete" &&
    Number.isSafeInteger(value.completedAtEpochMs) && value.completedAtEpochMs > 0 &&
    Number.isSafeInteger(value.verifiedOrders) && value.verifiedOrders >= 0 &&
    Number.isSafeInteger(value.verifiedPaidProductOrders) && value.verifiedPaidProductOrders >= 0 &&
    value.verifiedPaidProductOrders <= value.verifiedOrders &&
    Number.isSafeInteger(value.verifiedReferralRelations) && value.verifiedReferralRelations >= 0 &&
    value.verifiedUnresolvedIdentityRelations === 0 && value.verifiedLinkedRelationsWithPaidHistory === 0 &&
    Number.isSafeInteger(value.verifiedPaymentIdentityEvidence) && value.verifiedPaymentIdentityEvidence >= 0 &&
    Number.isSafeInteger(value.verifiedDetachedPaymentIdentityEvidence) && value.verifiedDetachedPaymentIdentityEvidence >= 0 &&
    value.verifiedDetachedPaymentIdentityEvidence <= value.verifiedPaymentIdentityEvidence &&
    value.verifiedMissingPaymentIdentityEvidence === 0 && value.verifiedUnresolvedPaymentIdentityEvidence === 0 &&
    value.verifiedCorruptPaymentIdentityEvidence === 0;
}

export async function readReferralOrderEmailHistoryReady(tx: Transaction, db: Firestore): Promise<boolean> {
  const marker = await tx.get(db.collection(ORDER_EMAIL_MIGRATION_COLLECTION).doc(ORDER_EMAIL_NORMALIZATION_VERSION));
  return isReferralOrderEmailHistoryReady(marker.data());
}

/** Technical safety maintenance only: never creates a certificate or grants a right.
 * Reading an absent marker also participates in transaction conflict detection. */
export async function prepareReferralOrderEmailHistoryInvalidation(
  tx: Transaction, db: Firestore, invalidatedAtEpochMs: number,
  reason: "paid_order_email_unusable" | "plain_payment_identity_unresolved" | "payment_identity_unchecked_while_closed" | "payment_identity_unresolved" = "paid_order_email_unusable",
): Promise<{ write: () => void }> {
  if (!Number.isSafeInteger(invalidatedAtEpochMs) || invalidatedAtEpochMs <= 0) throw new Error("order_email_invalidation_instant_invalid");
  const ref = db.collection(ORDER_EMAIL_MIGRATION_COLLECTION).doc(ORDER_EMAIL_NORMALIZATION_VERSION);
  const marker = await tx.get(ref);
  if (!marker.exists) return { write: () => {} };
  const previous = marker.data()?.invalidationRevision;
  // A corrupt or exhausted revision restarts safely; the write still changes the document version.
  const invalidationRevision = Number.isSafeInteger(previous) && previous >= 1 && previous < Number.MAX_SAFE_INTEGER
    ? previous + 1 : 1;
  return { write: () => { tx.update(ref, {
    schemaVersion: 1,
    version: ORDER_EMAIL_NORMALIZATION_VERSION,
    status: "incomplete",
    invalidatedAtEpochMs,
    invalidationRevision,
    invalidationReason: reason,
  }); } };
}
