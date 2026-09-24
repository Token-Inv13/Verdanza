export const REFERRAL_PROGRAM_VERSION = "referral-commercial-policy-v1" as const;
export const REFERRAL_RELATION_SCHEMA_VERSION = 1 as const;
export const REFERRAL_SPONSOR_REWARD_CENTS = 1000 as const;
export const REFERRAL_REFEREE_DISCOUNT_CENTS = 500 as const;
export const REFERRAL_MINIMUM_PRODUCTS_CENTS = 5000 as const;

export type ReferralState = "linked" | "pending" | "rewarded" | "cancelled" | "reversed";
export type ReferralCode = { schemaVersion: 1; programVersion: typeof REFERRAL_PROGRAM_VERSION; ownerUid: string; code: string; createdAtEpochMs: number };
export type ReferralEmailClaim = { schemaVersion: 1; programVersion: typeof REFERRAL_PROGRAM_VERSION; keyVersion: string; refereeUid: string; referralId: string; createdAtEpochMs: number };
export type ReferralRelinkEvent = { schemaVersion: 1; programVersion: typeof REFERRAL_PROGRAM_VERSION; type: "sponsor_relinked"; refereeUid: string; previousSponsorUid: string; nextSponsorUid: string; previousLinkedAtEpochMs: number; changedAtEpochMs: number; revision: number };
export type ReferralOrderSnapshot = {
  schemaVersion: 1;
  programVersion: typeof REFERRAL_PROGRAM_VERSION;
  referralId: string;
  createdAtEpochMs: number;
  thresholdCents: typeof REFERRAL_MINIMUM_PRODUCTS_CENTS;
  refereeDiscountCents: typeof REFERRAL_REFEREE_DISCOUNT_CENTS;
  eligibleProductsBeforeReferralCents: number;
  lines: readonly { lineId: string; eligibleBeforeReferralCents: number; referralDiscountCents: number }[];
  fingerprint: string;
};
export type ReferralRelation = {
  schemaVersion: 1;
  programVersion: typeof REFERRAL_PROGRAM_VERSION;
  sponsorUid: string;
  refereeUid: string;
  state: ReferralState;
  createdAtEpochMs: number;
  linkedAtEpochMs: number;
  relinkRevision?: number;
  /** Claimed only by the first confirmed paid order, never by delivery alone. */
  qualifyingOrderId: string | null;
  /** Delivery of qualifyingOrderId only; null until that paid order is delivered. */
  deliveredOrderId: string | null;
  paymentConfirmed: boolean;
  deliveryConfirmed: boolean;
  /** A paid order can consume the right without creating a sponsor reward. */
  rewardIneligibilityReason?: "sponsor_no_longer_eligible" | "sponsor_account_disabled" | "sponsor_identity_unavailable" | "first_paid_order_without_referral_discount" | "referee_identity_unavailable" | "referee_email_unverified" | "referee_email_claimed" | "self_referral_at_payment" | "referral_identity_changed";
  rewardCompartment: "none" | "pending" | "available";
  cumulativeReturnedProductsCents: number;
  processedRefunds: Readonly<Record<string, number>>;
};
