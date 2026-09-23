export const REFERRAL_PROGRAM_VERSION = "referral-commercial-policy-v1" as const;
export const REFERRAL_RELATION_SCHEMA_VERSION = 1 as const;
export const REFERRAL_EMAIL_KEY_VERSION = "referral-email-hmac-v1" as const;
export const REFERRAL_SPONSOR_REWARD_CENTS = 1000 as const;
export const REFERRAL_REFEREE_DISCOUNT_CENTS = 500 as const;
export const REFERRAL_MINIMUM_PRODUCTS_CENTS = 5000 as const;

export type ReferralState = "linked" | "pending" | "rewarded" | "cancelled" | "reversed";
export type ReferralCode = { schemaVersion: 1; programVersion: typeof REFERRAL_PROGRAM_VERSION; ownerUid: string; code: string; createdAtEpochMs: number };
export type ReferralEmailClaim = { schemaVersion: 1; programVersion: typeof REFERRAL_PROGRAM_VERSION; keyVersion: typeof REFERRAL_EMAIL_KEY_VERSION; refereeUid: string; referralId: string; createdAtEpochMs: number };
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
  qualifyingOrderId: string | null;
  deliveredOrderId: string | null;
  paymentConfirmed: boolean;
  deliveryConfirmed: boolean;
  /** Terminal commercial fact for a paid qualifying order; absent on earlier V1 relations means false. */
  qualifyingOrderCancelled?: boolean;
  rewardCompartment: "none" | "pending" | "available";
  cumulativeReturnedProductsCents: number;
  processedRefunds: Readonly<Record<string, number>>;
};
