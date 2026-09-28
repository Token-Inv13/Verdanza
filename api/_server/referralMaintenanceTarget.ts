export const REFERRAL_MAINTENANCE_PROJECT = "verdanza-1f621";

/** Exact target guard shared with the offline migration and reconciliation engines. */
export function assertReferralMaintenanceTarget(input: { projectId: string; emulatorHost?: string }) {
  if (input.emulatorHost !== undefined) {
    if (input.projectId !== "demo-verdanza-cagnotte" || input.emulatorHost !== "127.0.0.1:18085") throw new Error("order_email_migration_target_invalid");
  } else if (input.projectId !== REFERRAL_MAINTENANCE_PROJECT) throw new Error("order_email_migration_target_invalid");
}
