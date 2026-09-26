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
