import type { CagnotteAdvantage } from "../types/cagnotte.js";

export const CAGNOTTE_OPENING_COMMERCIAL_POLICY_VERSION = "cagnotte-commercial-policy-v1" as const;

const advantageOrder = Object.freeze([
  "promotion_code",
  "contest_prize",
  "automatic_promotion",
  "promotional_gift",
  "referral_discount",
] as const satisfies readonly CagnotteAdvantage[]);

const redemptionCompatibility = Object.freeze({
  promotion_code: "blocked",
  contest_prize: "blocked",
  automatic_promotion: "blocked",
  promotional_gift: "blocked",
  // Referral rules are deliberately outside the 6 September 2026 approval.
  referral_discount: "needs_validation",
} as const satisfies Readonly<Record<CagnotteAdvantage, "blocked" | "needs_validation">>);

/**
 * Commercial decisions approved on 6 September 2026.
 * This contract is not an activation guard and has no effective production date.
 */
export const CAGNOTTE_OPENING_COMMERCIAL_POLICY = Object.freeze({
  version: CAGNOTTE_OPENING_COMMERCIAL_POLICY_VERSION,
  commerciallyValidatedOn: "2026-09-06",
  advantageOrder,
  acquisition: Object.freeze({
    percentage: 5,
    availabilityRequires: Object.freeze(["payment_confirmed", "delivery_confirmed"] as const),
    additionalAvailabilityDelayHours: 0,
  }),
  redemption: Object.freeze({
    maximumEligibleProductsPercentage: 20,
    compatibility: redemptionCompatibility,
  }),
  creditValidity: Object.freeze({
    automaticExpiration: false,
    retroactiveDeletionOnSuspension: false,
  }),
  unpaidReservations: Object.freeze({
    manualReviewAfterHours: 72,
    automaticCancellation: false,
    automaticRelease: false,
    automaticNotification: false,
  }),
  regularization: Object.freeze({
    customerPaymentRequested: false,
    compensationWhenGainBecomesAvailable: true,
    compensationOnReleaseOrRestitution: true,
    reducesFinancialRefund: false,
  }),
});

export function cagnotteUsePolicyForAdvantage(advantage: CagnotteAdvantage) {
  const decision = redemptionCompatibility[advantage];
  if (decision !== "blocked" && decision !== "needs_validation") {
    throw new RangeError("Avantage inconnu.");
  }
  return decision;
}
