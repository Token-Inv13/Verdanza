import { getAdminProjectId } from "./firebaseAdmin.js";
import { REFERRAL_PROGRAM_VERSION } from "../../src/types/referral.js";

export type ReferralMode = "off" | "drain" | "active";
export type ReferralRuntime = Readonly<{ mode: ReferralMode; startsAtEpochMs: number | null; operational: boolean }>;
export const REFERRAL_RUNTIME_KEYS = ["REFERRAL_PROGRAM_MODE", "REFERRAL_RUNTIME_ENVIRONMENT", "REFERRAL_STARTS_AT_EPOCH_MS", "REFERRAL_PROGRAM_VERSION"] as const;
export const REFERRAL_CLOSED_RUNTIME: ReferralRuntime = Object.freeze({ mode: "off", startsAtEpochMs: null, operational: false });
export class ReferralConfigurationError extends Error { constructor() { super("Configuration parrainage invalide."); } }

/** Resolve before authentication, Firestore or the email secret is accessed. */
export function resolveReferralRuntime(input: { environment: Readonly<Record<string, string | undefined>>; deploymentEnvironment?: string; getProjectId: () => string | null }): ReferralRuntime {
  const env = input.environment;
  const present = REFERRAL_RUNTIME_KEYS.filter((key) => env[key] !== undefined);
  if (present.length === 0) return REFERRAL_CLOSED_RUNTIME;
  if (present.length === 1 && env.REFERRAL_PROGRAM_MODE === "off") return REFERRAL_CLOSED_RUNTIME;
  if (present.length !== REFERRAL_RUNTIME_KEYS.length || (env.REFERRAL_PROGRAM_MODE !== "drain" && env.REFERRAL_PROGRAM_MODE !== "active") ||
      env.REFERRAL_RUNTIME_ENVIRONMENT !== "production" || input.deploymentEnvironment !== "production" ||
      env.REFERRAL_PROGRAM_VERSION !== REFERRAL_PROGRAM_VERSION ||
      !/^(0|[1-9][0-9]*)$/.test(env.REFERRAL_STARTS_AT_EPOCH_MS ?? "")) throw new ReferralConfigurationError();
  const startsAtEpochMs = Number(env.REFERRAL_STARTS_AT_EPOCH_MS);
  if (!Number.isSafeInteger(startsAtEpochMs) || input.getProjectId() !== "verdanza-1f621") throw new ReferralConfigurationError();
  return Object.freeze({ mode: env.REFERRAL_PROGRAM_MODE, startsAtEpochMs, operational: true });
}

export function getReferralRuntime(): ReferralRuntime {
  return resolveReferralRuntime({ environment: process.env, deploymentEnvironment: process.env.VERCEL_ENV, getProjectId: getAdminProjectId });
}
