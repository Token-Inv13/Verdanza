import type { CagnotteAccrualProgram } from "./cagnotteLedgerTypes.js";
import {
  CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID,
  type CagnotteAccrualMode,
  type CagnotteReservationMode,
  type CagnotteRuntimeEnvironment,
  resolveCagnotteProductionProgram,
  resolveCagnotteProductionReservationProgram,
} from "./cagnotteProgram.js";
import type { CagnotteReservationProgram } from "./cagnotteReservationTypes.js";
import { getAdminProjectId } from "./firebaseAdmin.js";

export const CAGNOTTE_RUNTIME_ENV_KEYS = Object.freeze([
  "CAGNOTTE_RUNTIME_ENVIRONMENT",
  "CAGNOTTE_ACCRUAL_MODE",
  "CAGNOTTE_RESERVATION_MODE",
  "CAGNOTTE_STARTS_AT_EPOCH_MS",
  "CAGNOTTE_READ_SERVER_ENABLED",
  "ORDER_REFUNDS_ENABLED",
] as const);

type ConfiguredRuntimeEnvironment = Extract<CagnotteRuntimeEnvironment, "preview" | "production">;
type RuntimeEnvironmentSource = Readonly<Record<string, string | undefined>>;

export type CagnotteRuntimeConfiguration = Readonly<{
  configured: boolean;
  runtimeEnvironment: ConfiguredRuntimeEnvironment | null;
  accrualMode: CagnotteAccrualMode;
  reservationMode: CagnotteReservationMode;
  startsAtEpochMs: number | null;
  accrualProgram: CagnotteAccrualProgram<"production"> | null;
  reservationProgram: CagnotteReservationProgram<"production"> | null;
  readServerEnabled: boolean;
  orderRefundsEnabled: boolean;
  firebaseProjectId: string | null;
  readCursorSecret: string | null;
}>;

export class CagnotteRuntimeConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CagnotteRuntimeConfigurationError";
  }
}

export const CAGNOTTE_CLOSED_RUNTIME_CONFIGURATION: CagnotteRuntimeConfiguration = Object.freeze({
  configured: false,
  runtimeEnvironment: null,
  accrualMode: "off",
  reservationMode: "off",
  startsAtEpochMs: null,
  accrualProgram: null,
  reservationProgram: null,
  readServerEnabled: false,
  orderRefundsEnabled: false,
  firebaseProjectId: null,
  readCursorSecret: null,
});

/**
 * The only normal server configuration entry point. Resolution is deliberately
 * lazy so closed routes import without Firebase initialization or configuration
 * errors. Tests keep injecting their local programs directly into service factories.
 */
export function getCagnotteRuntimeConfiguration(): CagnotteRuntimeConfiguration {
  return resolveCagnotteRuntimeConfiguration({
    environment: process.env,
    deploymentEnvironment: process.env.VERCEL_ENV,
    getFirebaseProjectId: getAdminProjectId,
  });
}

export function resolveCagnotteRuntimeConfiguration(input: {
  environment: RuntimeEnvironmentSource;
  deploymentEnvironment?: string;
  getFirebaseProjectId: () => string | null;
}): CagnotteRuntimeConfiguration {
  if (!CAGNOTTE_RUNTIME_ENV_KEYS.some((key) => input.environment[key] !== undefined)) {
    return CAGNOTTE_CLOSED_RUNTIME_CONFIGURATION;
  }

  const runtimeEnvironment = oneOf(
    "CAGNOTTE_RUNTIME_ENVIRONMENT",
    required(input.environment, "CAGNOTTE_RUNTIME_ENVIRONMENT"),
    ["preview", "production"] as const,
  );
  const accrualMode = oneOf(
    "CAGNOTTE_ACCRUAL_MODE",
    required(input.environment, "CAGNOTTE_ACCRUAL_MODE"),
    ["off", "drain", "accrue"] as const,
  );
  const reservationMode = oneOf(
    "CAGNOTTE_RESERVATION_MODE",
    required(input.environment, "CAGNOTTE_RESERVATION_MODE"),
    ["off", "drain", "reserve"] as const,
  );
  const startsAtEpochMs = epochMilliseconds(
    "CAGNOTTE_STARTS_AT_EPOCH_MS",
    required(input.environment, "CAGNOTTE_STARTS_AT_EPOCH_MS"),
  );
  const readServerEnabled = exactBoolean(
    "CAGNOTTE_READ_SERVER_ENABLED",
    required(input.environment, "CAGNOTTE_READ_SERVER_ENABLED"),
  );
  const orderRefundsEnabled = exactBoolean(
    "ORDER_REFUNDS_ENABLED",
    required(input.environment, "ORDER_REFUNDS_ENABLED"),
  );

  if (input.deploymentEnvironment !== runtimeEnvironment) {
    throw new CagnotteRuntimeConfigurationError(
      "Environnement de déploiement incompatible avec la configuration cagnotte.",
    );
  }

  const operational = accrualMode !== "off" || reservationMode !== "off" ||
    readServerEnabled || orderRefundsEnabled;
  if (runtimeEnvironment !== "production" && operational) {
    throw new CagnotteRuntimeConfigurationError(
      "Ouverture cagnotte interdite hors déploiement Vercel Production.",
    );
  }

  let firebaseProjectId: string | null = null;
  if (operational) {
    try {
      firebaseProjectId = input.getFirebaseProjectId();
    } catch (cause) {
      throw new CagnotteRuntimeConfigurationError(
        "Identité du projet Firebase Admin impossible à résoudre.",
        { cause },
      );
    }
    if (firebaseProjectId !== CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID) {
      throw new CagnotteRuntimeConfigurationError(
        "Projet Firebase Admin incompatible avec la cagnotte Production.",
      );
    }
  }

  const readCursorSecret = input.environment.CAGNOTTE_READ_CURSOR_SECRET ?? null;
  if (readServerEnabled && (typeof readCursorSecret !== "string" || readCursorSecret.length < 32)) {
    throw new CagnotteRuntimeConfigurationError(
      "Secret de curseur requis avant ouverture de la lecture cagnotte.",
    );
  }

  const accrualProgram = resolveCagnotteProductionProgram({
    runtimeEnvironment,
    mode: accrualMode,
    startsAtEpochMs,
    firebaseProjectId,
  });
  const reservationProgram = resolveCagnotteProductionReservationProgram({
    runtimeEnvironment,
    mode: reservationMode,
    startsAtEpochMs,
    firebaseProjectId,
  });

  return Object.freeze({
    configured: true,
    runtimeEnvironment,
    accrualMode,
    reservationMode,
    startsAtEpochMs,
    accrualProgram,
    reservationProgram,
    readServerEnabled,
    orderRefundsEnabled,
    firebaseProjectId,
    readCursorSecret,
  });
}

export function cagnotteRuntimeCapabilities(
  configuration: Pick<CagnotteRuntimeConfiguration, "accrualProgram" | "reservationProgram">,
  nowEpochMs: number,
) {
  return {
    canRequestReservation: Boolean(
      configuration.reservationProgram?.reservationsEnabled === true &&
      Number.isSafeInteger(nowEpochMs) &&
      nowEpochMs >= configuration.reservationProgram.startsAtEpochMs,
    ),
    canAccrueLoyalty: Boolean(
      configuration.accrualProgram?.newAccrualsEnabled === true &&
      Number.isSafeInteger(nowEpochMs) &&
      nowEpochMs >= configuration.accrualProgram.startsAtEpochMs,
    ),
  };
}

function required(environment: RuntimeEnvironmentSource, key: typeof CAGNOTTE_RUNTIME_ENV_KEYS[number]) {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new CagnotteRuntimeConfigurationError(`Paramètre ${key} absent ou mal formé.`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(name: string, value: string, values: T): T[number] {
  if (!(values as readonly string[]).includes(value)) {
    throw new CagnotteRuntimeConfigurationError(`Valeur ${name} refusée.`);
  }
  return value as T[number];
}

function exactBoolean(name: string, value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CagnotteRuntimeConfigurationError(`Valeur ${name} refusée : true ou false requis.`);
}

function epochMilliseconds(name: string, value: string) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new CagnotteRuntimeConfigurationError(`Valeur ${name} refusée : entier epoch millisecondes requis.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new CagnotteRuntimeConfigurationError(`Valeur ${name} hors plage.`);
  }
  return parsed;
}
