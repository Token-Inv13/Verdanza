import type { Firestore } from "firebase-admin/firestore";
import { assertAdminUser, FirebaseIdTokenVerificationError, firebaseAuthHttpFailure, verifyFirebaseIdToken } from "./adminAuth.js";
import { getAdminDb, getAdminProjectId } from "./firebaseAdmin.js";
import { sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import { parseReferralEmailKeyring } from "./referralIdentity.js";
import { dryRunReferralPaymentIdentities, referralMaintenanceCounters } from "./referralMaintenanceDryRun.js";
import { REFERRAL_MAINTENANCE_PROJECT } from "./referralMaintenanceTarget.js";
import { getReferralRuntime, type ReferralRuntime } from "./referralRuntimeConfig.js";

type Dependencies = {
  enabled: () => string | undefined; deploymentEnvironment: () => string | undefined; vercelRuntime: () => string | undefined;
  emulatorConfigured: () => boolean; getProjectId: () => string | null; getDb: () => Firestore; verifyToken: typeof verifyFirebaseIdToken;
  getRuntime: () => ReferralRuntime; getKeyringJson: () => string | undefined; runDryRun: typeof dryRunReferralPaymentIdentities;
};

/** Google token verification remains authoritative; additionally bind its verified
 * subject to the exact Firebase project before reading adminUsers. */
function assertMaintenanceTokenProject(token: string, uid: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error();
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (claims.aud !== REFERRAL_MAINTENANCE_PROJECT || claims.iss !== `https://securetoken.google.com/${REFERRAL_MAINTENANCE_PROJECT}` ||
        claims.sub !== uid || claims.firebase?.tenant !== undefined) throw new Error();
  } catch { throw new FirebaseIdTokenVerificationError("authentication"); }
}

export function createReferralMaintenanceHandler(dependencies: Dependencies) {
  return async (request: VercelRequestLike, response: VercelResponseLike) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Vary", "Authorization");
    const fail = (code: string, status = 503) => sendJson(response, { code }, status);
    if (request.method !== "POST") { response.setHeader("Allow", "POST"); return fail("method_not_allowed", 405); }
    try { if (dependencies.enabled() !== "true") return fail("referral_maintenance_disabled"); }
    catch { return fail("referral_maintenance_disabled"); }
    try {
      if (dependencies.deploymentEnvironment() !== "production" || dependencies.vercelRuntime() !== "1" || dependencies.emulatorConfigured() ||
          dependencies.getProjectId() !== REFERRAL_MAINTENANCE_PROJECT) return fail("referral_maintenance_context_invalid");
      const authorization = request.headers.authorization;
      const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
      if (!token) return fail("authentication_required", 401);
      const db = dependencies.getDb();
      if (Reflect.get(db, "projectId") !== REFERRAL_MAINTENANCE_PROJECT) return fail("referral_maintenance_context_invalid");
      try {
        await assertAdminUser(db, token, async (idToken) => {
          const user = await dependencies.verifyToken(idToken);
          assertMaintenanceTokenProject(idToken, user.uid);
          if (!user.email || user.emailVerified !== true) throw new Error("referral_maintenance_admin_unverified");
          return user;
        });
      } catch (error) {
        const auth = firebaseAuthHttpFailure(error);
        if (auth) return fail(auth.code, auth.status);
        if (error instanceof Error && ["Acces admin requis.", "referral_maintenance_admin_unverified"].includes(error.message)) return fail("admin_required", 403);
        return fail("authentication_unavailable");
      }
      let body: unknown;
      try {
        if (typeof request.body === "string" && Buffer.byteLength(request.body) > 256) return fail("referral_maintenance_payload_invalid", 400);
        body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
      } catch { return fail("referral_maintenance_payload_invalid", 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return fail("referral_maintenance_payload_invalid", 400);
      if (Reflect.get(body, "action") === "apply") return fail("referral_maintenance_action_forbidden", 403);
      if (Object.keys(body).length !== 1 || Reflect.get(body, "action") !== "dry_run") return fail("referral_maintenance_payload_invalid", 400);
      try {
        const runtime = dependencies.getRuntime();
        if (runtime.mode !== "off" || runtime.operational !== false || runtime.startsAtEpochMs !== null) return fail("referral_maintenance_requires_off");
      } catch { return fail("referral_maintenance_requires_off"); }
      let keyringJson: string;
      try {
        keyringJson = dependencies.getKeyringJson() ?? "";
        parseReferralEmailKeyring(keyringJson);
      } catch { return fail("referral_maintenance_keyring_unavailable"); }
      const result = await dependencies.runDryRun({ db, keyringJson });
      return sendJson(response, referralMaintenanceCounters(result));
    } catch { return fail("referral_maintenance_unavailable"); }
  };
}

export const handleReferralMaintenance = createReferralMaintenanceHandler({
  enabled: () => process.env.REFERRAL_MAINTENANCE_DRY_RUN_ENABLED,
  deploymentEnvironment: () => process.env.VERCEL_ENV, vercelRuntime: () => process.env.VERCEL,
  emulatorConfigured: () => process.env.FIRESTORE_EMULATOR_HOST !== undefined || process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined,
  getProjectId: getAdminProjectId, getDb: () => getAdminDb({ logIdentity: false }), verifyToken: verifyFirebaseIdToken,
  getRuntime: getReferralRuntime, getKeyringJson: () => process.env.REFERRAL_EMAIL_HMAC_KEYRING_JSON,
  runDryRun: dryRunReferralPaymentIdentities,
});
