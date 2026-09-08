import { CAGNOTTE_CALCULATION_VERSION } from "../../src/lib/cagnotteCalculations.js";
import type {
  CagnotteAccrualProgram,
  CagnotteProductionProgram,
  CagnotteProgramMode,
} from "./cagnotteLedgerTypes.js";
import { CAGNOTTE_RESERVATION_VERSION } from "./cagnotteLedgerTypes.js";
import type { CagnotteReservationProductionProgram } from "./cagnotteReservationTypes.js";

export const CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID = "verdanza-1f621" as const;
export const CAGNOTTE_PRODUCTION_PROGRAM_VERSION = "cagnotte-commercial-policy-v1" as const;

/** Deliberately has no launch date and cannot be used as an operational program. */
export const CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION = Object.freeze({
  mode: "production" as const,
  programVersion: CAGNOTTE_PRODUCTION_PROGRAM_VERSION,
  calculationVersion: CAGNOTTE_CALCULATION_VERSION,
});

export const CAGNOTTE_PRODUCTION_RESERVATION_DEFINITION = Object.freeze({
  ...CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION,
  reservationVersion: CAGNOTTE_RESERVATION_VERSION,
});

export type CagnotteRuntimeEnvironment = "local" | "preview" | "production";
export type CagnotteAccrualMode = "off" | "drain" | "accrue";
export type CagnotteReservationMode = "off" | "drain" | "reserve";

export class CagnotteProgramConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CagnotteProgramConfigurationError";
  }
}

/** Pure future resolver. It is intentionally not connected to process.env. */
export function resolveCagnotteProductionProgram(input: {
  readonly runtimeEnvironment: CagnotteRuntimeEnvironment;
  readonly mode: CagnotteAccrualMode;
  readonly startsAtEpochMs?: number;
  readonly firebaseProjectId?: string | null;
}): CagnotteProductionProgram | null {
  if (input.mode === "off") return null;
  if (input.mode !== "drain" && input.mode !== "accrue") {
    throw new CagnotteProgramConfigurationError("Mode d’acquisition cagnotte Production inconnu.");
  }
  assertProductionRuntime(input.runtimeEnvironment);
  assertProductionStart(input.startsAtEpochMs);
  assertProductionFirebaseProject(input.firebaseProjectId);
  return Object.freeze({
    ...CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION,
    startsAtEpochMs: input.startsAtEpochMs,
    newAccrualsEnabled: input.mode === "accrue",
  });
}

/** Pure future resolver. It is intentionally not connected to process.env. */
export function resolveCagnotteProductionReservationProgram(input: {
  readonly runtimeEnvironment: CagnotteRuntimeEnvironment;
  readonly mode: CagnotteReservationMode;
  readonly startsAtEpochMs?: number;
  readonly firebaseProjectId?: string | null;
}): CagnotteReservationProductionProgram | null {
  if (input.mode === "off") return null;
  if (input.mode !== "drain" && input.mode !== "reserve") {
    throw new CagnotteProgramConfigurationError("Mode de réservation cagnotte Production inconnu.");
  }
  assertProductionRuntime(input.runtimeEnvironment);
  assertProductionStart(input.startsAtEpochMs);
  assertProductionFirebaseProject(input.firebaseProjectId);
  return Object.freeze({
    ...CAGNOTTE_PRODUCTION_RESERVATION_DEFINITION,
    startsAtEpochMs: input.startsAtEpochMs,
    reservationsEnabled: input.mode === "reserve",
  });
}

export function assertCagnotteProgramFirebaseProject(
  program: CagnotteAccrualProgram<CagnotteProgramMode> | { readonly mode: CagnotteProgramMode } | null,
  firebaseProjectId?: string | null,
): void {
  if (program?.mode === "production") assertProductionFirebaseProject(firebaseProjectId);
}

function assertProductionRuntime(runtimeEnvironment: CagnotteRuntimeEnvironment) {
  if (runtimeEnvironment !== "production") {
    throw new CagnotteProgramConfigurationError("Programme cagnotte Production interdit hors environnement Production.");
  }
}

function assertProductionStart(value: number | undefined): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CagnotteProgramConfigurationError("Date de démarrage cagnotte Production absente ou invalide.");
  }
}

function assertProductionFirebaseProject(projectId: string | null | undefined) {
  if (projectId !== CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new CagnotteProgramConfigurationError("Projet Firebase Admin incompatible avec la cagnotte Production.");
  }
}

/** Normal entry point: disabled, no launch date, environment switch or fallback. */
export const CAGNOTTE_SERVER_PROGRAM: CagnotteProductionProgram | null = null;
