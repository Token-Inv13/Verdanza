import type { CagnotteCalculationVersion, CagnotteSnapshot, CumulativeLineReturn } from "../../src/types/cagnotte.js";

/** Fixtures only. No production start date or activation default exists. */
export type CagnotteTestProgram = {
  readonly mode: "local_test";
  readonly programVersion: string;
  readonly calculationVersion: CagnotteCalculationVersion;
  readonly startsAtEpochMs: number;
  readonly newAccrualsEnabled: boolean;
};

/** Trusted internal order facts, never an HTTP/client payload contract. */
export type CagnotteInternalOrder = {
  readonly orderId: string;
  readonly beneficiaryId: string | null;
  readonly programVersion: string | null;
  readonly createdAtEpochMs: number;
  readonly snapshot: CagnotteSnapshot;
};

export type CagnotteLedgerCommand = {
  readonly order: CagnotteInternalOrder;
} & (
  | { readonly event: "payment_confirmed" | "delivery_confirmed" | "payment_and_delivery_confirmed" | "cancelled" }
  | {
    readonly event: "refund_confirmed";
    readonly refundId: string;
    /** Additional net cents, not a partial cumulative state. */
    readonly additionalReturns: readonly { readonly lineId: string; readonly additionalNetCents: number }[];
  }
);

/** Local loyalty-only convention: no debt collection, financial refund offset or launch approval. */
export const CAGNOTTE_REGULARIZATION_VERSION = "cagnotte-regularization-v1" as const;
export const CAGNOTTE_RESERVATION_VERSION = "cagnotte-reservation-v1" as const;

export type CagnotteWallet = {
  schemaVersion: 3;
  regularizationVersion: typeof CAGNOTTE_REGULARIZATION_VERSION;
  reservationVersion: typeof CAGNOTTE_RESERVATION_VERSION;
  currency: "EUR";
  beneficiaryId: string;
  pendingCents: number;
  availableCents: number;
  reservedCents: number;
  regularizationCents: number;
};

export type CagnotteAccrual = {
  schemaVersion: 1;
  calculationVersion: CagnotteCalculationVersion;
  currency: "EUR";
  orderId: string;
  beneficiaryId: string;
  programVersion: string;
  /** Stable canonical binding to ALL supplied original order facts. */
  binding: string;
  initialSnapshot: CagnotteSnapshot;
  initialGainCents: number;
  paymentConfirmed: boolean;
  deliveryConfirmed: boolean;
  cancelled: boolean;
  credited: boolean;
  compartment: "none" | "pending" | "available";
  remainingGainCents: number;
  cumulativeReturns: readonly CumulativeLineReturn[];
};

export type CagnotteMovement = {
  schemaVersion: 3;
  regularizationVersion: typeof CAGNOTTE_REGULARIZATION_VERSION;
  reservationVersion: typeof CAGNOTTE_RESERVATION_VERSION;
  calculationVersion: CagnotteCalculationVersion;
  programVersion: string;
  currency: "EUR";
  origin: "internal_server";
  orderId: string;
  beneficiaryId: string;
  businessEvent:
    | Exclude<CagnotteLedgerCommand["event"], "payment_and_delivery_confirmed">
    | "made_available"
    | "credit_reserved"
    | "credit_consumed"
    | "credit_released"
    | "credit_refunded_after_return"
    | "refund_declaration_corrected"
    | "credit_refund_corrected";
  eventKey: string;
  /** Canonical payload detects conflicting reuse of a refund ID. */
  payload: string;
  pendingDeltaCents: number;
  availableDeltaCents: number;
  reservedDeltaCents: number;
  regularizationDeltaCents: number;
  /** Immutable server operation time used for stable, bounded read pagination. */
  recordedAtEpochMs: number;
};

export type CagnotteLedgerResult = {
  status: "applied" | "already_applied" | "not_eligible" | "cancelled";
  movementIds: readonly string[];
};
