import { FieldPath, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { hasHistoricalPaymentEvidence } from "../api/_server/referralService.js";
import { getReferralSponsorIdentity, type ReferralSponsorIdentity } from "../api/_server/referralSponsorIdentity.js";
import { parseReferralEmailKeyring } from "../api/_server/referralIdentity.js";
import { paymentIdentityEvidenceShape, paymentIdentityClaimMatches, prepareReferralEmailIdentityClaim,
  readCurrentPaymentIdentity, REFERRAL_PAYMENT_IDENTITIES_COLLECTION } from "../api/_server/referralPaymentIdentity.js";
import { REFERRAL_PAYMENT_IDENTITY_VERSION, type ReferralPaymentIdentityEvidence } from "../src/types/referral.js";
import { assertOrderEmailMigrationTarget } from "./orderEmailNormalizationMigration.js";

export const REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION = "referral-payment-identity-reconciliation-v1";
export function assertPaymentIdentityReconciliationTarget(input: { projectId: string; emulatorHost?: string; apply?: boolean; confirmation?: string }) {
  assertOrderEmailMigrationTarget({ projectId: input.projectId, emulatorHost: input.emulatorHost });
  if (input.apply && input.confirmation !== REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION)
    throw new Error("payment_identity_reconciliation_confirmation_required");
}

/** Technical reservations only. Never touches relations, rewards, orders or the V4 certificate. */
export async function reconcileReferralPaymentIdentities(input: { db: Firestore; projectId: string; apply?: boolean; confirmation?: string;
  keyringJson: string; getIdentity?: (uid: string) => Promise<ReferralSponsorIdentity>; pageSize?: number; now?: () => number }) {
  assertPaymentIdentityReconciliationTarget({ ...input, emulatorHost: process.env.FIRESTORE_EMULATOR_HOST });
  if (Reflect.get(input.db, "projectId") !== input.projectId) throw new Error("payment_identity_reconciliation_target_invalid");
  // Validate once before any Auth/read/write work. Never generate a key or fall back to another keyring.
  parseReferralEmailKeyring(input.keyringJson);
  const pageSize = input.pageSize ?? 200;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 400) throw new Error("payment_identity_reconciliation_page_size_invalid");
  const counts = { scannedOrders: 0, authenticatedPaidProductOrders: 0, claimed: 0, protectedByExistingClaim: 0,
    unresolved: 0, corrupt: 0, alreadySafe: 0, changed: 0, raced: 0 };
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = input.db.collection("orders").orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const orderDoc of page.docs) {
      counts.scannedOrders++;
      const order = orderDoc.data();
      if (!hasHistoricalPaymentEvidence(order) || typeof order.customerId !== "string" || !order.customerId) continue;
      counts.authenticatedPaidProductOrders++;
      const evidenceRef = input.db.collection(REFERRAL_PAYMENT_IDENTITIES_COLLECTION).doc(orderDoc.id);
      const prior = await evidenceRef.get();
      const shape = prior.exists ? paymentIdentityEvidenceShape(prior.data(), orderDoc.id, order.customerId) : "missing";
      if (shape === "corrupt") { counts.corrupt++; continue; }
      if (shape === "safe") {
        const evidence = prior.data() as ReferralPaymentIdentityEvidence;
        const claim = await input.db.collection("referralEmailClaims").doc((evidence as { claimId: string }).claimId).get();
        if (paymentIdentityClaimMatches(evidence, claim.data())) counts.alreadySafe++; else counts.corrupt++;
        continue;
      }
      const identity = await readCurrentPaymentIdentity(order.customerId, input.getIdentity ?? getReferralSponsorIdentity, () => input.keyringJson);
      if (identity.reason) { counts.unresolved++; continue; }
      const outcome = await input.db.runTransaction(async (tx) => {
        const [currentOrder, currentEvidence] = await tx.getAll(orderDoc.ref, evidenceRef);
        if (!currentOrder.exists || currentOrder.data()!.customerId !== order.customerId || !hasHistoricalPaymentEvidence(currentOrder.data()!)) return "raced";
        if (currentEvidence.exists) {
          const currentShape = paymentIdentityEvidenceShape(currentEvidence.data(), orderDoc.id, order.customerId);
          if (currentShape === "corrupt") return "corrupt";
          if (currentShape === "safe") {
            const evidence = currentEvidence.data() as ReferralPaymentIdentityEvidence;
            const claim = await tx.get(input.db.collection("referralEmailClaims").doc((evidence as { claimId: string }).claimId));
            return paymentIdentityClaimMatches(evidence, claim.data()) ? "alreadySafe" : "corrupt";
          }
        }
        const recordedAtEpochMs = (input.now ?? Date.now)();
        if (!Number.isSafeInteger(recordedAtEpochMs) || recordedAtEpochMs <= 0) throw new Error("payment_identity_reconciliation_instant_invalid");
        const claim = await prepareReferralEmailIdentityClaim({ db: input.db, transaction: tx, customerUid: order.customerId,
          identity, recordedAtEpochMs });
        if (claim.status === "unresolved") return "unresolved";
        const evidence: ReferralPaymentIdentityEvidence = { schemaVersion: 1, version: REFERRAL_PAYMENT_IDENTITY_VERSION,
          orderId: orderDoc.id, customerUid: order.customerId, recordedAtEpochMs, status: claim.status, claimId: claim.claimId, keyVersion: claim.keyVersion };
        if (input.apply) {
          if (claim.newClaim) tx.create(claim.newClaim.ref, claim.newClaim.value);
          tx.set(evidenceRef, evidence);
        }
        return claim.status === "claimed" ? "claimed" : "protectedByExistingClaim";
      });
      counts[outcome]++;
      if (input.apply && (outcome === "claimed" || outcome === "protectedByExistingClaim")) counts.changed++;
    }
    cursor = page.docs[page.docs.length - 1];
  }
  return { version: REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION, mode: input.apply ? "apply" : "dry-run", ...counts };
}
