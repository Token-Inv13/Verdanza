import { getApps } from "firebase-admin/app";
import { getAdminProjectId } from "./firebaseAdmin.js";
import { normalizeReferralEmail } from "./referralIdentity.js";

type LookupResponse = { users?: Array<{ localId?: unknown; email?: unknown; disabled?: unknown }> };
export type ReferralSponsorIdentity = { uid: string; email: string; disabled: boolean };

/** Auth Admin lookup is deliberately outside the Firestore transaction. */
export async function lookupReferralSponsorIdentity(input: {
  uid: string;
  projectId: string;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<ReferralSponsorIdentity> {
  if (input.projectId !== "verdanza-1f621" || !input.uid || !input.accessToken) throw new Error("referral_sponsor_lookup_unavailable");
  const response = await input.fetchImpl(
    `https://identitytoolkit.googleapis.com/v1/projects/${input.projectId}/accounts:lookup`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ localId: [input.uid] }),
    },
  );
  if (!response.ok) throw new Error("referral_sponsor_lookup_unavailable");
  const payload = await response.json() as LookupResponse;
  if (!Array.isArray(payload.users) || payload.users.length !== 1 || payload.users[0]?.localId !== input.uid)
    throw new Error("referral_sponsor_lookup_unavailable");
  const user = payload.users[0];
  if (typeof user.email !== "string" || (user.disabled !== undefined && typeof user.disabled !== "boolean"))
    throw new Error("referral_sponsor_lookup_unavailable");
  try { normalizeReferralEmail(user.email); }
  catch { throw new Error("referral_sponsor_lookup_unavailable"); }
  return { uid: input.uid, email: user.email, disabled: user.disabled === true };
}

/** Uses the existing Admin credential without importing the Auth SDK at function startup. */
export async function getReferralSponsorIdentity(uid: string): Promise<ReferralSponsorIdentity> {
  const projectId = getAdminProjectId();
  const credential = getApps()[0]?.options.credential;
  if (projectId !== "verdanza-1f621" || !credential) throw new Error("referral_sponsor_lookup_unavailable");
  const accessToken = (await credential.getAccessToken()).access_token;
  return lookupReferralSponsorIdentity({ uid, projectId, accessToken, fetchImpl: fetch });
}
