import type { Firestore, Transaction } from "firebase-admin/firestore";

export const ORDER_EMAIL_NORMALIZATION_VERSION = "order-email-normalization-v1";
export const ORDER_EMAIL_MIGRATION_COLLECTION = "referralMigrations";

/** Server certificate of the exhaustive technical migration; never grants a reward. */
export function isReferralOrderEmailHistoryReady(value: FirebaseFirestore.DocumentData | undefined): boolean {
  return value?.schemaVersion === 1 && value.version === ORDER_EMAIL_NORMALIZATION_VERSION && value.status === "complete" &&
    Number.isSafeInteger(value.completedAtEpochMs) && value.completedAtEpochMs > 0 &&
    Number.isSafeInteger(value.verifiedOrders) && value.verifiedOrders >= 0 &&
    Number.isSafeInteger(value.verifiedPaidProductOrders) && value.verifiedPaidProductOrders >= 0 &&
    value.verifiedPaidProductOrders <= value.verifiedOrders;
}

export async function readReferralOrderEmailHistoryReady(tx: Transaction, db: Firestore): Promise<boolean> {
  const marker = await tx.get(db.collection(ORDER_EMAIL_MIGRATION_COLLECTION).doc(ORDER_EMAIL_NORMALIZATION_VERSION));
  return isReferralOrderEmailHistoryReady(marker.data());
}

/** Technical safety maintenance only: never creates a certificate or grants a right.
 * Reading an absent marker also participates in transaction conflict detection. */
export async function prepareReferralOrderEmailHistoryInvalidation(
  tx: Transaction, db: Firestore, invalidatedAtEpochMs: number,
): Promise<{ write: () => void }> {
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
    invalidationReason: "paid_order_email_unusable",
  }); } };
}
