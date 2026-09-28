import type { ReferralState } from "./referral.js";

export const REFERRAL_SELF_VERSION = "referral-self-v1" as const;
/** Owner-only projection. Reward totals are nominal history, never a spendable balance. */
export type ReferralSelf = {
  version: typeof REFERRAL_SELF_VERSION;
  code: string | null;
  relation: { state: ReferralState; paymentConfirmed: boolean; deliveryConfirmed: boolean; checkoutReserved: boolean } | null;
  sponsorSummary: {
    referralsTotal: number; linkedCount: number; pendingCount: number; rewardedCount: number;
    cancelledCount: number; reversedCount: number; pendingRewardCents: number; validatedRewardCents: number;
  };
};
