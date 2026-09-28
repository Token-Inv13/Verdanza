import type { Firestore } from "firebase-admin/firestore";
import { REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION } from "../../src/types/referral.js";
import { reconcileReferralPaymentIdentities } from "./referralPaymentIdentityReconciliation.js";
import { REFERRAL_MAINTENANCE_PROJECT } from "./referralMaintenanceTarget.js";
import { referralReadOnlyFirestore } from "./referralReadOnlyFirestore.js";

/** No apply, confirmation, project or policy can be supplied by an HTTP caller. */
export function dryRunReferralPaymentIdentities(input: { db: Firestore; keyringJson: string }) {
  return reconcileReferralPaymentIdentities({
    db: referralReadOnlyFirestore(input.db), projectId: REFERRAL_MAINTENANCE_PROJECT,
    keyringJson: input.keyringJson, apply: false,
    legacyEmailBlockPolicyVersion: REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION,
  });
}

export const REFERRAL_MAINTENANCE_COUNTERS = ["scannedOrders", "authenticatedPaidProductOrders", "scannedPaymentIdentities", "detachedPaymentIdentities",
  "claimed", "protectedByExistingClaim", "legacyBlocked", "legacyBlockUnresolved", "unresolved", "corrupt", "alreadySafe", "changed", "raced"] as const;

/** Explicit numeric allowlist; extra fields never reach the response. */
export function referralMaintenanceCounters(value: Awaited<ReturnType<typeof dryRunReferralPaymentIdentities>>) {
  if (value.mode !== "dry-run" || value.changed !== 0) throw new Error("referral_maintenance_report_invalid");
  const counters = {} as Record<typeof REFERRAL_MAINTENANCE_COUNTERS[number], number>;
  for (const key of REFERRAL_MAINTENANCE_COUNTERS) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error("referral_maintenance_report_invalid");
    counters[key] = value[key];
  }
  return counters;
}
