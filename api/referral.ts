import { getAuth } from "firebase-admin/auth";
import { verifyFirebaseIdToken } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import { sendJson, type VercelRequestLike, type VercelResponseLike } from "./_server/http.js";
import { getReferralRuntime, ReferralConfigurationError } from "./_server/referralRuntimeConfig.js";
import { ensureReferralCode, linkReferral, readReferralSelf, ReferralError } from "./_server/referralService.js";
import { assertReferralEmailSecret } from "./_server/referralIdentity.js";

export function createReferralHandler(dependencies: {
  runtime: typeof getReferralRuntime;
  verify: typeof verifyFirebaseIdToken;
  db: typeof getAdminDb;
  sponsorEmail: (uid: string) => Promise<string | null>;
  secret: () => string;
  now: () => number;
}) {
  return async (request: VercelRequestLike, response: VercelResponseLike) => {
    response.setHeader("Cache-Control", "private, no-store");
    if (request.method !== "GET" && request.method !== "POST") return sendJson(response, { code: "method_not_allowed" }, 405);
    let runtime;
    try { runtime = dependencies.runtime(); }
    catch (error) {
      if (error instanceof ReferralConfigurationError) return sendJson(response, { code: "referral_configuration_invalid" }, 503);
      throw error;
    }
    // Closed BEFORE token parsing, Firebase initialization and secret access.
    if (runtime.mode === "off" || !runtime.operational) return sendJson(response, { code: "referral_program_disabled" }, 503);
    const nowEpochMs = dependencies.now();
    if (runtime.startsAtEpochMs === null || !Number.isSafeInteger(nowEpochMs) || nowEpochMs < runtime.startsAtEpochMs)
      return sendJson(response, { code: "referral_program_disabled" }, 503);
    const action = request.method === "GET" ? "self" : (request.body as { action?: unknown } | null)?.action;
    if (runtime.mode === "drain" && action !== "self") return sendJson(response, { code: "referral_program_draining" }, 503);
    if (action !== "self" && action !== "ensure_code" && action !== "link") return sendJson(response, { code: "referral_action_invalid" }, 400);
    let emailSecret: string | null = null;
    if (action === "link") {
      try { emailSecret = dependencies.secret(); assertReferralEmailSecret(emailSecret); }
      catch { return sendJson(response, { code: "referral_configuration_invalid" }, 503); }
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) return sendJson(response, { code: "authentication_required" }, 401);
    try {
      const user = await dependencies.verify(authorization.slice(7).trim());
      const db = dependencies.db();
      if (action === "self") return sendJson(response, await readReferralSelf(db, user.uid));
      if (action === "ensure_code") return sendJson(response, await ensureReferralCode({ db, user, program: runtime as { mode: "active"; startsAtEpochMs: number }, nowEpochMs }));
      const code = (request.body as { code?: unknown } | null)?.code;
      if (typeof code !== "string") return sendJson(response, { code: "referral_code_invalid" }, 400);
      return sendJson(response, await linkReferral({ db, user, code, program: runtime as { mode: "active"; startsAtEpochMs: number },
        nowEpochMs, secret: emailSecret!, getSponsorEmail: dependencies.sponsorEmail }));
    } catch (error) {
      if (error instanceof ReferralError) return sendJson(response, { code: error.code }, error.status);
      if (error instanceof Error && error.message === "referral_email_secret_invalid") return sendJson(response, { code: "referral_configuration_invalid" }, 503);
      return sendJson(response, { code: "referral_unavailable" }, 500);
    }
  };
}

export default createReferralHandler({
  runtime: getReferralRuntime,
  verify: verifyFirebaseIdToken,
  db: getAdminDb,
  sponsorEmail: async (uid) => (await getAuth().getUser(uid)).email ?? null,
  secret: () => process.env.REFERRAL_EMAIL_HMAC_SECRET ?? "",
  now: Date.now,
});
