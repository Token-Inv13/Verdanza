import { getApps } from "firebase-admin/app";
import { getAdminProjectId } from "../api/_server/firebaseAdmin.js";
import { normalizeReferralEmail } from "../api/_server/referralIdentity.js";
import type { ReferralSponsorIdentity } from "../api/_server/referralSponsorIdentity.js";

export type ReferralMaintenanceIdentity = ReferralSponsorIdentity & { createdAtEpochMs?: number };
/** Maintenance-only metadata. This module is never imported by a deployed commercial endpoint. */
export async function lookupReferralMaintenanceIdentity(input: { uid?: string; email?: string; projectId: string;
  accessToken: string; fetchImpl: typeof fetch }): Promise<ReferralMaintenanceIdentity> {
  if (input.projectId !== "verdanza-1f621" || !input.accessToken || Boolean(input.uid) === Boolean(input.email))
    throw new Error("referral_maintenance_auth_unavailable");
  const response = await input.fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${input.projectId}/accounts:lookup`, {
    method: "POST", headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(input.uid ? { localId: [input.uid] } : { email: [normalizeReferralEmail(input.email!)] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("referral_maintenance_auth_unavailable");
  const payload = await response.json();
  if (!Array.isArray(payload?.users) || payload.users.length !== 1) throw new Error("referral_maintenance_auth_unavailable");
  const user = payload.users[0];
  if (!user || typeof user.localId !== "string" || !/^[A-Za-z0-9._:@+-]{1,128}$/.test(user.localId) ||
      (input.uid && user.localId !== input.uid) || (user.tenantId !== undefined && user.tenantId !== "") || typeof user.email !== "string" ||
      (user.disabled !== undefined && typeof user.disabled !== "boolean") ||
      (user.emailVerified !== undefined && typeof user.emailVerified !== "boolean")) throw new Error("referral_maintenance_auth_unavailable");
  const email = normalizeReferralEmail(user.email);
  if (input.email && email !== normalizeReferralEmail(input.email)) throw new Error("referral_maintenance_auth_unavailable");
  const created = typeof user.createdAt === "string" && /^(0|[1-9][0-9]*)$/.test(user.createdAt) ? Number(user.createdAt) : NaN;
  return { uid: user.localId, email, disabled: user.disabled === true, emailVerified: user.emailVerified === true,
    ...(Number.isSafeInteger(created) && created >= 0 && created <= Date.now() ? { createdAtEpochMs: created } : {}) };
}
async function adminLookup(criteria: { uid: string } | { email: string }) {
  const projectId = getAdminProjectId();
  const credential = getApps()[0]?.options.credential;
  if (projectId !== "verdanza-1f621" || !credential) throw new Error("referral_maintenance_auth_unavailable");
  const accessToken = (await credential.getAccessToken()).access_token;
  return lookupReferralMaintenanceIdentity({ ...criteria, projectId, accessToken, fetchImpl: fetch });
}
export const getReferralMaintenanceIdentity = (uid: string) => adminLookup({ uid });
export const getReferralMaintenanceIdentityByEmail = (email: string) => adminLookup({ email });
