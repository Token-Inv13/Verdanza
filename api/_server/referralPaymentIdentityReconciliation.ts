import { FieldPath, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { hasHistoricalPaymentEvidence } from "./referralService.js";
import { getReferralMaintenanceIdentity, getReferralMaintenanceIdentityByEmail, type ReferralMaintenanceIdentity } from "./referralMaintenanceAuth.js";
import { legacyEmailBlockIdentityMatches, prepareLegacyEmailBlock } from "./referralLegacyEmailBlock.js";
import { parseReferralEmailKeyring, referralEmailClaimAliases } from "./referralIdentity.js";
import { paymentIdentityEvidenceShape, paymentIdentityProtectionMatches, paymentIdentityProtectionRef, prepareReferralEmailIdentityProtection,
  readCurrentPaymentIdentity, REFERRAL_PAYMENT_IDENTITIES_COLLECTION } from "./referralPaymentIdentity.js";
import { REFERRAL_PAYMENT_IDENTITY_VERSION, REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION, type ReferralPaymentIdentityEvidence } from "../../src/types/referral.js";
import { assertReferralMaintenanceTarget } from "./referralMaintenanceTarget.js";

export const REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION = "referral-payment-identity-reconciliation-v1";
export function assertPaymentIdentityReconciliationTarget(input: { projectId: string; emulatorHost?: string; apply?: boolean; confirmation?: string }) {
  assertReferralMaintenanceTarget({ projectId: input.projectId, emulatorHost: input.emulatorHost });
  if (input.apply && input.confirmation !== REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION)
    throw new Error("payment_identity_reconciliation_confirmation_required");
}

/** Technical protections only. Never touches relations, rewards, orders or the certificate. */
export async function reconcileReferralPaymentIdentities(input: { db: Firestore; projectId: string; apply?: boolean; confirmation?: string;
  keyringJson: string; getIdentity?: (uid: string) => Promise<ReferralMaintenanceIdentity>; getIdentityByEmail?: (email: string) => Promise<ReferralMaintenanceIdentity>;
  legacyEmailBlockPolicyVersion?: string; legacyHistoryLimit?: number; pageSize?: number; now?: () => number }) {
  assertPaymentIdentityReconciliationTarget({ ...input, emulatorHost: process.env.FIRESTORE_EMULATOR_HOST });
  if (Reflect.get(input.db, "projectId") !== input.projectId) throw new Error("payment_identity_reconciliation_target_invalid");
  // Validate once before any Auth/read/write work. Never generate a key or fall back to another keyring.
  const keyring = parseReferralEmailKeyring(input.keyringJson);
  if (input.legacyEmailBlockPolicyVersion !== undefined && input.legacyEmailBlockPolicyVersion !== REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION)
    throw new Error("legacy_email_block_policy_invalid");
  const historyLimit = input.legacyHistoryLimit ?? 100;
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 400) throw new Error("legacy_email_block_history_limit_invalid");
  const pageSize = input.pageSize ?? 200;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 400) throw new Error("payment_identity_reconciliation_page_size_invalid");
  const counts = { scannedOrders: 0, authenticatedPaidProductOrders: 0, scannedPaymentIdentities: 0, detachedPaymentIdentities: 0,
    claimed: 0, protectedByExistingClaim: 0, legacyBlocked: 0, legacyBlockUnresolved: 0, unresolved: 0, corrupt: 0, alreadySafe: 0, changed: 0, raced: 0 };

  async function reconcileCandidate(orderId: string, customerUid: string, detached: boolean, sourceOrder?: FirebaseFirestore.DocumentData) {
    const orderRef = input.db.collection("orders").doc(orderId);
    const evidenceRef = input.db.collection(REFERRAL_PAYMENT_IDENTITIES_COLLECTION).doc(orderId);
    const prior = await evidenceRef.get();
    const shape = prior.exists ? paymentIdentityEvidenceShape(prior.data(), orderId, customerUid) : "missing";
    if (shape === "corrupt") { counts.corrupt++; return; }
    if (shape === "safe") {
      const evidence = prior.data() as Exclude<ReferralPaymentIdentityEvidence, { status: "unresolved" }>;
      const protection = await paymentIdentityProtectionRef(input.db, evidence).get();
      if (paymentIdentityProtectionMatches(evidence, protection.data())) counts.alreadySafe++; else counts.corrupt++;
      return;
    }
    if (detached && shape !== "unresolved") { counts.raced++; return; }
    let account: ReferralMaintenanceIdentity;
    try { account = await (input.getIdentity ?? getReferralMaintenanceIdentity)(customerUid); }
    catch { counts.unresolved++; return; }
    const legacy = input.legacyEmailBlockPolicyVersion === REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION && account.disabled === true && account.emailVerified === false;
    let emailAccount: ReferralMaintenanceIdentity | undefined;
    if (legacy) {
      if (!sourceOrder || detached || !legacyEmailBlockIdentityMatches(sourceOrder, customerUid, account)) { counts.legacyBlockUnresolved++; return; }
      try { emailAccount = await (input.getIdentityByEmail ?? getReferralMaintenanceIdentityByEmail)(account.email); }
      catch { counts.legacyBlockUnresolved++; return; }
    }
    const identity = await readCurrentPaymentIdentity(customerUid, async () => account, () => input.keyringJson);
    if (!legacy && identity.reason) { counts.unresolved++; return; }
    const outcome = await input.db.runTransaction(async (tx) => {
      const [currentOrder, currentEvidence] = await tx.getAll(orderRef, evidenceRef);
      const currentShape = currentEvidence.exists ? paymentIdentityEvidenceShape(currentEvidence.data(), orderId, customerUid) : "missing";
      if (currentOrder.exists) {
        if (detached || currentOrder.data()!.customerId !== customerUid || !hasHistoricalPaymentEvidence(currentOrder.data()!)) return "raced";
      } else if (currentShape !== "unresolved" && currentShape !== "safe") return "raced";
      // An orphan's own valid unresolved proof is the immutable historical payment source.
      if (currentShape === "corrupt") return "corrupt";
      if (currentShape === "safe") {
        const evidence = currentEvidence.data() as Exclude<ReferralPaymentIdentityEvidence, { status: "unresolved" }>;
        const protection = await tx.get(paymentIdentityProtectionRef(input.db, evidence));
        return paymentIdentityProtectionMatches(evidence, protection.data()) ? "alreadySafe" : "corrupt";
      }
      const recordedAtEpochMs = (input.now ?? Date.now)();
      if (!Number.isSafeInteger(recordedAtEpochMs) || recordedAtEpochMs <= 0) throw new Error("payment_identity_reconciliation_instant_invalid");
      const claim = legacy ? currentOrder.exists ? await prepareLegacyEmailBlock({ db: input.db, tx, order: currentOrder.data()!, customerUid,
        account, emailAccount: emailAccount!, aliases: referralEmailClaimAliases(keyring, account.email), activeVersion: keyring.activeVersion, recordedAtEpochMs, historyLimit }) : null :
        await prepareReferralEmailIdentityProtection({ db: input.db, transaction: tx, customerUid, identity, recordedAtEpochMs });
      if (!claim) return "legacyBlockUnresolved";
      if (claim.status === "unresolved") return "unresolved";
      const evidence: ReferralPaymentIdentityEvidence = { schemaVersion: 1, version: REFERRAL_PAYMENT_IDENTITY_VERSION,
        orderId, customerUid, recordedAtEpochMs: currentShape === "unresolved" ? currentEvidence.data()!.recordedAtEpochMs : recordedAtEpochMs,
        ...(claim.status === "blocked_by_legacy_email" ? { status: claim.status, blockId: claim.blockId, keyVersion: claim.keyVersion, policyVersion: claim.policyVersion } :
          { status: claim.status, claimId: claim.claimId, keyVersion: claim.keyVersion }) };
      if (paymentIdentityEvidenceShape(evidence, orderId, customerUid) !== "safe") return "corrupt";
      if (input.apply) {
        if ("newClaim" in claim && claim.newClaim) tx.create(claim.newClaim.ref, claim.newClaim.value);
        if ("newBlock" in claim && claim.newBlock) tx.create(claim.newBlock.ref, claim.newBlock.value);
        tx.set(evidenceRef, evidence);
      }
      return claim.status === "blocked_by_legacy_email" ? "legacyBlocked" : claim.status === "claimed" ? "claimed" : "protectedByExistingClaim";
    });
    counts[outcome]++;
    if (input.apply && (outcome === "claimed" || outcome === "protectedByExistingClaim" || outcome === "legacyBlocked")) counts.changed++;
  }

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
      await reconcileCandidate(orderDoc.id, order.customerId, false, order);
    }
    cursor = page.docs[page.docs.length - 1];
  }
  cursor = undefined;
  for (;;) {
    let query = input.db.collection(REFERRAL_PAYMENT_IDENTITIES_COLLECTION).orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const evidenceDoc of page.docs) {
      counts.scannedPaymentIdentities++;
      if ((await input.db.collection("orders").doc(evidenceDoc.id).get()).exists) continue;
      counts.detachedPaymentIdentities++;
      const evidence = evidenceDoc.data();
      if (paymentIdentityEvidenceShape(evidence, evidenceDoc.id, evidence.customerUid) === "corrupt") { counts.corrupt++; continue; }
      await reconcileCandidate(evidenceDoc.id, evidence.customerUid, true);
    }
    cursor = page.docs[page.docs.length - 1];
  }
  return { version: REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION, mode: input.apply ? "apply" : "dry-run", ...counts };
}
