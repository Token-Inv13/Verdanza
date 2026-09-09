import { canEnrollCagnotteOrder } from "./cagnotteOrders.js";
import { canCreateCagnotteReservation } from "./cagnotteReservations.js";
import type { CagnotteAccrualProgram } from "./cagnotteLedgerTypes.js";
import type { CagnotteReservationProgram } from "./cagnotteReservationTypes.js";
import type { RateLimitFailurePolicy } from "./publicRateLimit.js";

export type CheckoutCagnotteRateLimitMode =
  | "none"
  | "accrual"
  | "reservation"
  | "accrual_and_reservation";

export type CheckoutRateLimitPolicy =
  | { failurePolicy: Extract<RateLimitFailurePolicy, "fail_open">; cagnotteMode: "none" }
  | {
      failurePolicy: Extract<RateLimitFailurePolicy, "fail_closed">;
      cagnotteMode: Exclude<CheckoutCagnotteRateLimitMode, "none">;
    };

/** Derives checkout sensitivity only from verified identity and server programs. */
export function resolveCheckoutRateLimitPolicy(input: {
  verifiedUid?: string;
  requestedCagnotteCents: number;
  accrualProgram: CagnotteAccrualProgram | null;
  reservationProgram: CagnotteReservationProgram | null;
  firebaseProjectId?: string | null;
  operationNowEpochMs: number;
}): CheckoutRateLimitPolicy {
  const accrual = input.verifiedUid
    ? canEnrollCagnotteOrder(
        input.accrualProgram,
        input.verifiedUid,
        input.operationNowEpochMs,
        input.firebaseProjectId,
      )
    : false;
  const reservation = canCreateCagnotteReservation(
    input.reservationProgram,
    input.verifiedUid,
    input.requestedCagnotteCents,
    input.operationNowEpochMs,
    input.firebaseProjectId,
  );
  const cagnotteMode = accrual && reservation
    ? "accrual_and_reservation"
    : accrual
      ? "accrual"
      : reservation
        ? "reservation"
        : "none";
  if (cagnotteMode === "none") {
    return { failurePolicy: "fail_open", cagnotteMode };
  }
  return { failurePolicy: "fail_closed", cagnotteMode };
}
