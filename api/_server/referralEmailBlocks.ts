import type { Firestore, Transaction } from "firebase-admin/firestore";
import { REFERRAL_PROGRAM_VERSION, REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION, type ReferralEmailBlock } from "../../src/types/referral.js";

export const REFERRAL_EMAIL_BLOCKS_COLLECTION = "referralEmailBlocks";
export function isValidReferralEmailBlock(value: FirebaseFirestore.DocumentData | undefined, keyVersion: string): value is ReferralEmailBlock {
  return value?.schemaVersion === 1 && value.programVersion === REFERRAL_PROGRAM_VERSION && value.keyVersion === keyVersion &&
    /^(v[1-9][0-9]{0,2}|referral-email-hmac-v1)$/.test(keyVersion) &&
    value.policyVersion === REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION && value.reason === "historical_paid_order_unverified_identity" &&
    Number.isSafeInteger(value.createdAtEpochMs) && value.createdAtEpochMs >= 0 &&
    Object.keys(value).sort().join(",") === "createdAtEpochMs,keyVersion,policyVersion,programVersion,reason,schemaVersion";
}

/** Read every retained alias before any write. A corrupt block is never treated as absence. */
export async function readReferralEmailBlocks(tx: Transaction, db: Firestore, aliases: readonly { id: string; version: string }[]) {
  const docs = await tx.getAll(...aliases.map(alias => db.collection(REFERRAL_EMAIL_BLOCKS_COLLECTION).doc(alias.id)));
  const corrupt = docs.some((doc, i) => doc.exists && !isValidReferralEmailBlock(doc.data(), aliases[i].version));
  const index = docs.findIndex(doc => doc.exists);
  return { docs, corrupt, block: !corrupt && index >= 0 ? { blockId: aliases[index].id, keyVersion: aliases[index].version,
    policyVersion: REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION } : null };
}
