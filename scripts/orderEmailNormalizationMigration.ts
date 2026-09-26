import { FieldPath, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { usableOrderEmail } from "../api/_server/orderEmailIdentity.js";
import { hasHistoricalPaymentEvidence, isValidHistoricalPaymentInstant } from "../api/_server/referralService.js";
import { isReferralOrderEmailHistoryReady, ORDER_EMAIL_MIGRATION_COLLECTION, ORDER_EMAIL_NORMALIZATION_VERSION } from "../api/_server/referralOrderEmailHistory.js";

export const ORDER_EMAIL_MIGRATION_PROJECT = "verdanza-1f621";
type Counts = { scannedOrders: number; usableEmails: number; alreadyNormalized: number; changesRequired: number; paidProductOrders: number; anomalies: number };
const emptyCounts = (): Counts => ({ scannedOrders: 0, usableEmails: 0, alreadyNormalized: 0, changesRequired: 0, paidProductOrders: 0, anomalies: 0 });

/** Guard applies to the injected engine too; local tests cannot fall back to Production. */
export function assertOrderEmailMigrationTarget(input: { projectId: string; emulatorHost?: string; apply?: boolean; confirmation?: string }) {
  if (input.emulatorHost !== undefined) {
    if (input.projectId !== "demo-verdanza-cagnotte" || input.emulatorHost !== "127.0.0.1:18085") throw new Error("order_email_migration_target_invalid");
  } else if (input.projectId !== ORDER_EMAIL_MIGRATION_PROJECT) throw new Error("order_email_migration_target_invalid");
  if (input.apply && input.confirmation !== ORDER_EMAIL_NORMALIZATION_VERSION) throw new Error("order_email_migration_confirmation_required");
}

/** Paginated technical update only. Does not read or create any commercial referral right. */
export async function migrateOrderEmailNormalization(input: {
  db: Firestore; projectId: string; apply?: boolean; confirmation?: string; pageSize?: number; now?: () => number;
}) {
  assertOrderEmailMigrationTarget({ ...input, emulatorHost: process.env.FIRESTORE_EMULATOR_HOST });
  if (Reflect.get(input.db, "projectId") !== input.projectId) throw new Error("order_email_migration_target_invalid");
  const pageSize = input.pageSize ?? 200;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 400) throw new Error("order_email_migration_page_size_invalid");
  const now = input.now ?? Date.now;
  const markerRef = input.db.collection(ORDER_EMAIL_MIGRATION_COLLECTION).doc(ORDER_EMAIL_NORMALIZATION_VERSION);

  async function scan(write: boolean) {
    const counts = emptyCounts();
    let changedOrders = 0;
    let cursor: QueryDocumentSnapshot | undefined;
    for (;;) {
      let query = input.db.collection("orders").orderBy(FieldPath.documentId()).limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      const batch = input.db.batch();
      let updates = 0;
      for (const doc of page.docs) {
        const order = doc.data();
        counts.scannedOrders++;
        const paid = hasHistoricalPaymentEvidence(order);
        if (paid) counts.paidProductOrders++;
        const email = usableOrderEmail(order.customerEmail);
        if (email === null) {
          // An ambiguous paid document cannot certify absence for a recreated UID either.
          const paymentEvidence = !order.productionFixture && (order.paymentStatus === "paid" ||
            isValidHistoricalPaymentInstant(order.paidAt) || isValidHistoricalPaymentInstant(order.paymentConfirmedAt));
          if (paymentEvidence) counts.anomalies++;
          continue;
        }
        counts.usableEmails++;
        if (order.customerEmailNormalized === email) { counts.alreadyNormalized++; continue; }
        counts.changesRequired++;
        if (write) {
          // Concurrent edits abort the run instead of certifying stale data.
          batch.update(doc.ref, { customerEmailNormalized: email }, { lastUpdateTime: doc.updateTime });
          updates++;
        }
      }
      if (updates) { await batch.commit(); changedOrders += updates; }
      cursor = page.docs[page.docs.length - 1];
    }
    return { ...counts, changedOrders };
  }

  const initial = await scan(false);
  if (!input.apply) return { mode: "dry-run" as const, initial, verification: null, markerComplete: false, markerWritten: false };

  const existingMarker = await markerRef.get();
  const alreadyCertified = isReferralOrderEmailHistoryReady(existingMarker.data());
  let markerPrecondition = existingMarker.updateTime;
  if (!alreadyCertified || initial.changesRequired > 0 || initial.anomalies > 0) {
    // Close a previous certificate BEFORE any update or anomaly exit.
    const batch = input.db.batch();
    const incomplete = { schemaVersion: 1, version: ORDER_EMAIL_NORMALIZATION_VERSION, status: "incomplete" };
    if (existingMarker.exists) batch.update(markerRef, incomplete, { lastUpdateTime: existingMarker.updateTime! });
    else batch.create(markerRef, incomplete);
    markerPrecondition = (await batch.commit())[0].writeTime;
  }
  if (initial.anomalies > 0) return { mode: "apply" as const, initial, verification: null, markerComplete: false, markerWritten: false };

  const applied = await scan(!alreadyCertified || initial.changesRequired > 0);
  // A fresh exhaustive pass, after all writes, is mandatory even on an idempotent replay.
  const verification = await scan(false);
  if (applied.anomalies > 0 || verification.anomalies > 0 || verification.changesRequired > 0) {
    const batch = input.db.batch();
    batch.update(markerRef, { schemaVersion: 1, version: ORDER_EMAIL_NORMALIZATION_VERSION, status: "incomplete" }, { lastUpdateTime: markerPrecondition! });
    await batch.commit();
    return { mode: "apply" as const, initial, applied, verification, markerComplete: false, markerWritten: false };
  }
  // Keep a coherent existing certificate byte-for-byte unchanged on a no-op rerun.
  const markerWritten = !alreadyCertified || initial.changesRequired > 0 ||
    existingMarker.data()?.verifiedOrders !== verification.scannedOrders ||
    existingMarker.data()?.verifiedPaidProductOrders !== verification.paidProductOrders;
  if (markerWritten) {
    const completedAtEpochMs = now();
    if (!Number.isSafeInteger(completedAtEpochMs) || completedAtEpochMs <= 0) throw new Error("order_email_migration_instant_invalid");
    const batch = input.db.batch();
    batch.update(markerRef, { schemaVersion: 1, version: ORDER_EMAIL_NORMALIZATION_VERSION, status: "complete", completedAtEpochMs,
      verifiedOrders: verification.scannedOrders, verifiedPaidProductOrders: verification.paidProductOrders }, { lastUpdateTime: markerPrecondition! });
    await batch.commit();
  }
  return { mode: "apply" as const, initial, applied, verification, markerComplete: true, markerWritten };
}
