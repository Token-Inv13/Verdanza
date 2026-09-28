import type { Firestore, Transaction } from "firebase-admin/firestore";
import { hasHistoricalPaymentEvidence, isValidHistoricalPaymentInstant } from "./referralService.js";
import { usableOrderEmail } from "./orderEmailIdentity.js";
import { readReferralEmailBlocks, REFERRAL_EMAIL_BLOCKS_COLLECTION } from "./referralEmailBlocks.js";
import { REFERRAL_PROGRAM_VERSION, REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION, type ReferralEmailBlock } from "../../src/types/referral.js";
import type { ReferralMaintenanceIdentity } from "./referralMaintenanceAuth.js";

/** Pure precondition; an unverified email never becomes an owned identity. */
export function legacyEmailBlockIdentityMatches(order: FirebaseFirestore.DocumentData, customerUid: string, account: ReferralMaintenanceIdentity) {
  const email = usableOrderEmail(account.email), orderEmail = usableOrderEmail(order.customerEmail);
  const paidInstants = [order.paidAt, order.paymentConfirmedAt].filter(isValidHistoricalPaymentInstant).map(Date.parse);
  return /^[A-Za-z0-9._:@+-]{1,128}$/.test(customerUid) && hasHistoricalPaymentEvidence(order) && order.customerId === customerUid && account.uid === customerUid &&
    account.disabled === true && account.emailVerified === false && email !== null && email === orderEmail &&
    Number.isSafeInteger(account.createdAtEpochMs) && account.createdAtEpochMs! >= 0 && account.createdAtEpochMs! <= Date.now() &&
    paidInstants.length > 0 && account.createdAtEpochMs! <= Math.min(...paidInstants);
}

/** Maintenance only: bounded exhaustive legacy scan, repeated inside the writing transaction.
 * Normalized legacy raw emails are compared in memory; no backfill or UID/email output. */
export async function prepareLegacyEmailBlock(input: { db: Firestore; tx: Transaction; order: FirebaseFirestore.DocumentData;
  customerUid: string; account: ReferralMaintenanceIdentity; emailAccount: ReferralMaintenanceIdentity;
  aliases: readonly { id: string; version: string }[]; activeVersion: string; recordedAtEpochMs: number; historyLimit: number }) {
  const { db, tx, account, customerUid } = input;
  if (!legacyEmailBlockIdentityMatches(input.order, customerUid, account) || input.emailAccount.uid !== customerUid ||
      input.emailAccount.disabled !== true || input.emailAccount.emailVerified !== false ||
      usableOrderEmail(input.emailAccount.email) !== usableOrderEmail(account.email)) return null;
  const email = usableOrderEmail(account.email)!;
  const history = await tx.get(db.collection("orders").select("customerId", "customerEmail", "customerEmailNormalized", "items", "total", "productionFixture",
    "paymentStatus", "paidAt", "paymentConfirmedAt").limit(input.historyLimit + 1));
  if (history.size > input.historyLimit) return null;
  let matchingAuthenticatedPaidOrder = false;
  for (const doc of history.docs) {
    const order = doc.data();
    if (order.productionFixture) continue;
    const paidFact = order.paymentStatus === "paid" || isValidHistoricalPaymentInstant(order.paidAt) || isValidHistoricalPaymentInstant(order.paymentConfirmedAt);
    if (!paidFact) continue;
    const normalized = usableOrderEmail(order.customerEmail);
    if (!hasHistoricalPaymentEvidence(order)) return null; // Ambiguous paid document prevents a complete proof.
    if (order.customerEmailNormalized !== undefined && order.customerEmailNormalized !== normalized) return null;
    if (order.customerId === customerUid && normalized !== null && normalized !== email) return null;
    if (normalized === email && typeof order.customerId === "string" && order.customerId) {
      if (order.customerId !== customerUid) return null;
      matchingAuthenticatedPaidOrder = true;
    }
  }
  if (!matchingAuthenticatedPaidOrder) return null;
  const blocks = await readReferralEmailBlocks(tx, db, input.aliases);
  if (blocks.corrupt) return null;
  const claims = await tx.getAll(...input.aliases.map(alias => db.collection("referralEmailClaims").doc(alias.id)));
  // Any pre-existing owner claim makes this conservative, ownerless policy inapplicable.
  if (claims.some(doc => doc.exists)) return null;
  const activeIndex = input.aliases.findIndex(alias => alias.version === input.activeVersion);
  if (activeIndex < 0) return null;
  const active = input.aliases[activeIndex];
  const value: ReferralEmailBlock = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, keyVersion: active.version,
    policyVersion: REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION, reason: "historical_paid_order_unverified_identity", createdAtEpochMs: input.recordedAtEpochMs };
  return { status: "blocked_by_legacy_email" as const, blockId: active.id, keyVersion: active.version, policyVersion: REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION,
    ...(blocks.docs[activeIndex].exists ? {} : { newBlock: { ref: db.collection(REFERRAL_EMAIL_BLOCKS_COLLECTION).doc(active.id), value } }) };
}
