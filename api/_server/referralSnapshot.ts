import { createHash } from "node:crypto";
import type { CagnotteSnapshot, CumulativeLineReturn } from "../../src/types/cagnotte.js";
import { REFERRAL_MINIMUM_PRODUCTS_CENTS, REFERRAL_PROGRAM_VERSION, REFERRAL_REFEREE_DISCOUNT_CENTS, type ReferralOrderSnapshot } from "../../src/types/referral.js";

const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function canonicalReferralJson(value: unknown) {
  const canonical = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(canonical) : entry && typeof entry === "object"
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : entry;
  return JSON.stringify(canonical(value));
}
export function referralSnapshotFingerprint(value: Omit<ReferralOrderSnapshot, "fingerprint">) {
  return createHash("sha256").update(canonicalReferralJson(value)).digest("hex");
}

/** Only for a future trusted checkout integration or local fixture; never accepts an HTTP snapshot. */
export function createReferralOrderSnapshot(input: { refereeUid: string; createdAtEpochMs: number; lines: readonly { lineId: string; eligibleBeforeReferralCents: number; referralDiscountCents: number }[] }): ReferralOrderSnapshot {
  const base = input.lines.reduce((sum, line) => sum + line.eligibleBeforeReferralCents, 0);
  const discount = input.lines.reduce((sum, line) => sum + line.referralDiscountCents, 0);
  if (!input.refereeUid || !integer(input.createdAtEpochMs) || !input.lines.length || !input.lines.every((line) => line.lineId && integer(line.eligibleBeforeReferralCents) && line.eligibleBeforeReferralCents > 0 && integer(line.referralDiscountCents) && line.referralDiscountCents < line.eligibleBeforeReferralCents) ||
    !integer(base) || base < REFERRAL_MINIMUM_PRODUCTS_CENTS || discount !== REFERRAL_REFEREE_DISCOUNT_CENTS || new Set(input.lines.map((line) => line.lineId)).size !== input.lines.length) throw new Error("referral_snapshot_invalid");
  const snapshot = { schemaVersion: 1, programVersion: REFERRAL_PROGRAM_VERSION, referralId: input.refereeUid,
    createdAtEpochMs: input.createdAtEpochMs, thresholdCents: REFERRAL_MINIMUM_PRODUCTS_CENTS,
    refereeDiscountCents: REFERRAL_REFEREE_DISCOUNT_CENTS, eligibleProductsBeforeReferralCents: base, lines: input.lines } as const;
  return { ...snapshot, fingerprint: referralSnapshotFingerprint(snapshot) };
}

/** Map historic refund net amounts back to the frozen pre-referral line basis. */
export function referralReturnedProductsCents(snapshot: ReferralOrderSnapshot, cagnotte: CagnotteSnapshot, returns: readonly CumulativeLineReturn[]) {
  const byLine = new Map(cagnotte.lines.map((line) => [line.lineId, line]));
  let result = 0;
  for (const line of snapshot.lines) {
    const original = byLine.get(line.lineId);
    const afterReferral = line.eligibleBeforeReferralCents - line.referralDiscountCents;
    const returned = returns.find((entry) => entry.lineId === line.lineId)?.returnedNetCents ?? 0;
    if (!original || original.netCents !== afterReferral || afterReferral <= 0 || !integer(returned) || returned > afterReferral) throw new Error("referral_refund_basis_invalid");
    result += Number((BigInt(returned) * BigInt(line.eligibleBeforeReferralCents) + BigInt(afterReferral) / 2n) / BigInt(afterReferral));
  }
  if (!integer(result) || result > snapshot.eligibleProductsBeforeReferralCents) throw new Error("referral_refund_basis_invalid");
  return result;
}
