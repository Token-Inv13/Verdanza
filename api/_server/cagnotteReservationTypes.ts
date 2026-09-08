import type { CagnotteCalculationInput, CagnotteOrderReservationIntent } from "../../src/types/cagnotte.js";
import type { CagnotteProgramIdentity, CagnotteProgramMode } from "./cagnotteLedgerTypes.js";
import { CAGNOTTE_RESERVATION_VERSION } from "./cagnotteLedgerTypes.js";

export type CagnotteReservationProgram<M extends CagnotteProgramMode = CagnotteProgramMode> =
  CagnotteProgramIdentity<M> & {
  readonly reservationVersion: typeof CAGNOTTE_RESERVATION_VERSION;
  /** Gates only new intents/reservations. Existing reservations stay terminally operable. */
  readonly reservationsEnabled: boolean;
};

export type CagnotteReservationTestProgram = CagnotteReservationProgram<"local_test">;
export type CagnotteReservationProductionProgram = CagnotteReservationProgram<"production">;

export type CagnotteReservationIntentInput = {
  readonly orderId: string;
  readonly beneficiaryId: string;
  readonly createdAtEpochMs: number;
  readonly calculation: CagnotteCalculationInput;
};

export type CagnotteReservationIntent = CagnotteOrderReservationIntent;

export type CagnotteReservationState = "reserved" | "consumed" | "released";
export const CAGNOTTE_CONSUMED_REFUND_VERSION = "cagnotte-consumed-refund-v1" as const;
export type CagnotteReservationEvent = {
  readonly eventKey: string;
  readonly recordedAtEpochMs: number;
};

export type CagnotteConsumedRefundEvent = {
  readonly refundId: string;
  readonly eventKey: string;
  readonly grossRestitutionCents: number;
  readonly compensationCents: number;
  readonly recordedAtEpochMs: number;
};

export type CagnotteConsumedRefundCorrection = {
  readonly correctionId: string;
  readonly targetRefundId: string;
  readonly revision: number;
  readonly restitutionDeltaCents: number;
  readonly compensationCents: number;
  readonly eventKey?: string;
  readonly recordedAtEpochMs: number;
};

export type CagnotteReservation = {
  readonly schemaVersion: 1;
  readonly reservationVersion: typeof CAGNOTTE_RESERVATION_VERSION;
  readonly calculationVersion: "cagnotte-math-v1";
  readonly currency: "EUR";
  /** Canonical server-prepared order facts retained for terminal-state verification. */
  readonly order: CagnotteReservationIntent["order"];
  readonly orderId: string;
  readonly beneficiaryId: string;
  readonly programVersion: string;
  readonly amountCents: number;
  readonly intentFingerprint: string;
  readonly snapshotFingerprint: string;
  readonly state: CagnotteReservationState;
  readonly events: {
    readonly reserved: CagnotteReservationEvent;
    readonly consumed?: CagnotteReservationEvent;
    readonly released?: CagnotteReservationEvent;
  };
  readonly releaseCompensationCents: number;
  /** Derived projection of confirmed refund events. The reservation remains consumed. */
  readonly refundProjection?: {
    readonly schemaVersion: 1;
    readonly version: typeof CAGNOTTE_CONSUMED_REFUND_VERSION;
    readonly cumulativeRestitutedCents: number;
    readonly events: readonly CagnotteConsumedRefundEvent[];
    readonly corrections?: readonly CagnotteConsumedRefundCorrection[];
  };
};

export type CagnotteReservationResult = {
  readonly status:
    | "reserved"
    | "consumed"
    | "released"
    | "already_reserved"
    | "already_consumed"
    | "already_released"
    | "not_required";
  readonly state: CagnotteReservationState | "none";
  readonly amountCents: number;
  readonly compensationCents: number;
};

export type CagnotteConsumedRefundResult = {
  readonly status: "restituted" | "already_restituted";
  readonly state: "consumed";
  readonly grossRestitutionCents: number;
  readonly compensationCents: number;
  readonly availableIncreaseCents: number;
  readonly cumulativeRestitutedCents: number;
  readonly movementIds: readonly string[];
};
