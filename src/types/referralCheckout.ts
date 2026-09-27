export const REFERRAL_CHECKOUT_QUOTE_VERSION = "referral-checkout-quote-v1" as const;
export type ReferralCheckoutAcceptance = {
  quoteVersion: typeof REFERRAL_CHECKOUT_QUOTE_VERSION;
  quoteFingerprint: string;
  acceptedReferralDiscountCents: 500;
  acceptedPayableCents: number;
};
export type ReferralUseRequest = { requested: true; acceptance?: ReferralCheckoutAcceptance };
export type ReferralCheckoutQuote = {
  quoteVersion: typeof REFERRAL_CHECKOUT_QUOTE_VERSION;
} & ({ applied: false; reason: "priority_advantage" | "below_threshold" | "no_relation" | "right_consumed" | "right_reserved" }
  | { applied: true; referralDiscountCents: 500; productsBeforeReferralCents: number;
      productsAfterReferralCents: number; deliveryCents: number; payableCents: number;
      loyaltyEstimateCents: number; quoteFingerprint: string });
