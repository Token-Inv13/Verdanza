/** Amounts are integer euro cents, checked at every public calculation boundary. */
export type Cents = number;

/** Server-created registration. No wallet is created at checkout. */
export type CagnotteOrderEnrollment = {
  schemaVersion: 1;
  beneficiaryId: string;
  programVersion: string;
  calculationVersion: CagnotteCalculationVersion;
  createdAtEpochMs: number;
  snapshot: CagnotteSnapshot;
  /** Missing on earlier enrolled orders and therefore interpreted as enrolled. */
  accrualEnrollment?: "enrolled" | "not_enrolled";
};

/** Server-persisted binding between an order and its reserved wallet amount. */
export type CagnotteOrderReservationIntent = {
  readonly schemaVersion: 1;
  readonly reservationVersion: "cagnotte-reservation-v1";
  readonly order: {
    readonly orderId: string;
    readonly beneficiaryId: string;
    readonly programVersion: string;
    readonly createdAtEpochMs: number;
    readonly snapshot: CagnotteSnapshot;
  };
  readonly amountCents: number;
  readonly snapshotFingerprint: string;
  readonly intentFingerprint: string;
};

/** Server evidence recorded when a mixed payment consumes its reservation. */
export type CagnottePaymentEvidence = {
  readonly schemaVersion: 1;
  readonly version: "cagnotte-payment-evidence-v1";
  readonly reservationState: "consumed";
  readonly loyaltyAccrualDecision: "attributed" | "not_attributed";
  readonly loyaltyAccrualReason?: "server_program_ineligible";
  readonly recordedAt: string;
};

export type CagnotteCalculationVersion = "cagnotte-math-v1";

export type CagnotteAdvantage =
  | "promotion_code"
  | "contest_prize"
  | "automatic_promotion"
  | "promotional_gift"
  | "referral_discount";

export type CagnotteCompatibility = {
  readonly status: "allowed" | "blocked" | "needs_validation";
  readonly blockingAdvantages: readonly CagnotteAdvantage[];
  readonly pendingAdvantages: readonly CagnotteAdvantage[];
};

export type CagnotteCheckoutQuoteVersion = "cagnotte-checkout-quote-v1";

export type CagnotteUseAcceptance = {
  readonly quoteVersion: CagnotteCheckoutQuoteVersion;
  readonly quoteFingerprint: string;
  readonly acceptedCagnotteCents: Cents;
  readonly acceptedPayableCents: Cents;
};

export type CagnotteUseRequest = {
  readonly requestedCents: Cents;
  readonly acceptance?: CagnotteUseAcceptance;
};

/** Server quote only. It neither reserves credit nor creates an order. */
export type CagnotteCheckoutQuote = {
  readonly quoteVersion: CagnotteCheckoutQuoteVersion;
  readonly quoteFingerprint: string;
  readonly currency: "EUR";
  readonly productsAfterDiscountsCents: Cents;
  readonly deliveryCents: Cents;
  readonly requestedCagnotteCents: Cents;
  readonly proposedCagnotteCents: Cents;
  readonly cagnotteCapCents: Cents;
  readonly payableCents: Cents;
  readonly estimatedLoyaltyCents: Cents;
  readonly loyaltyAccrualStatus: "estimated" | "suspended";
  readonly limitationReasons: readonly CagnotteLimitationReason[];
  readonly compatibility: CagnotteCompatibility;
};

export type CagnotteLine = {
  readonly lineId: string;
  /** Exact resolved line/pack total; never a rounded per-gram price. */
  readonly initialCents: Cents;
  readonly isGift?: boolean;
  /** Informational only: excluded from discounts, payments and loyalty. */
  readonly giftCommercialValueCents?: Cents;
};

export type ProductDiscount = {
  readonly discountId: string;
  readonly amountCents: Cents;
  readonly lineIds: readonly string[];
  /** Classification of an already resolved discount, not a promotion selector. */
  readonly kind: Exclude<CagnotteAdvantage, "promotional_gift"> | "product_discount";
};

export type AllocationBase = {
  readonly lineId: string;
  readonly baseCents: Cents;
};

export type CentAllocation = {
  readonly lineId: string;
  readonly amountCents: Cents;
};

export type CagnotteCalculationInput = {
  readonly lines: readonly CagnotteLine[];
  /** Canonical, uniquely identified discounts, in their resolved application order. */
  readonly discounts: readonly ProductDiscount[];
  readonly requestedCagnotteCents: Cents;
  readonly availableCagnotteCents: Cents;
  /** Also carries advantages without monetary discounts, e.g. a shipping coupon. */
  readonly advantages?: readonly CagnotteAdvantage[];
};

export type CagnotteLimitationReason =
  | "available_balance"
  | "twenty_percent_cap"
  | "compatibility_blocked"
  | "compatibility_to_validate";

export type CagnotteLineSnapshot = CagnotteLine & {
  readonly discounts: readonly {
    readonly discountId: string;
    readonly amountCents: Cents;
  }[];
  readonly discountCents: Cents;
  readonly netCents: Cents;
  readonly cagnotteCents: Cents;
  readonly productsPaidCents: Cents;
};

/** An estimate only: no balance, payment or credit has been persisted. */
export type CagnotteSnapshot = {
  readonly kind: "estimate";
  readonly calculationVersion: CagnotteCalculationVersion;
  readonly lines: readonly CagnotteLineSnapshot[];
  readonly subtotalCents: Cents;
  readonly discountCents: Cents;
  readonly eligibleCents: Cents;
  readonly requestedCagnotteCents: Cents;
  readonly availableCagnotteCents: Cents;
  readonly cagnotteCapCents: Cents;
  readonly appliedCagnotteCents: Cents;
  readonly productsPaidCents: Cents;
  readonly loyaltyCents: Cents;
  readonly compatibility: CagnotteCompatibility;
  readonly limitationReasons: readonly CagnotteLimitationReason[];
};

export type CumulativeLineReturn = {
  readonly lineId: string;
  /** Net returned cents after original discounts, before original cagnotte. */
  readonly returnedNetCents: Cents;
};

export type RefundCumulativeTotals = {
  readonly returnedNetCents: Cents;
  readonly cagnotteRestitutionCents: Cents;
  readonly financialRefundCents: Cents;
  readonly retainedProductsPaidCents: Cents;
  readonly theoreticalLoyaltyCents: Cents;
};

export type CagnotteRefundSimulation = {
  readonly kind: "refund_simulation";
  readonly calculationVersion: CagnotteCalculationVersion;
  readonly lines: readonly {
    readonly lineId: string;
    readonly previousReturnedNetCents: Cents;
    readonly returnedNetCents: Cents;
    readonly cumulativeCagnotteRestitutionCents: Cents;
    readonly cumulativeFinancialRefundCents: Cents;
    readonly cagnotteRestitutionDeltaCents: Cents;
    readonly financialRefundDeltaCents: Cents;
  }[];
  readonly previous: RefundCumulativeTotals;
  readonly next: RefundCumulativeTotals;
  readonly delta: {
    readonly returnedNetCents: Cents;
    readonly cagnotteRestitutionCents: Cents;
    readonly financialRefundCents: Cents;
    readonly loyaltyCorrectionCents: Cents;
  };
};
