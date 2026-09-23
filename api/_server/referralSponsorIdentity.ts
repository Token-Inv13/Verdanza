import { getApps } from "firebase-admin/app";
import { getAdminProjectId } from "./firebaseAdmin.js";

type LookupResponse = { users?: Array<{ localId?: unknown; email?: unknown }> };

/** Auth Admin lookup is deliberately outside the Firestore transaction. */
export async function lookupReferralSponsorEmail(input: {
  uid: string;
  projectId: string;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<string | null> {
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
  return typeof payload.users[0].email === "string" ? payload.users[0].email : null;
}

/** Uses the existing Admin credential without importing the Auth SDK at function startup. */
export async function getReferralSponsorEmail(uid: string): Promise<string | null> {
  const projectId = getAdminProjectId();
  const credential = getApps()[0]?.options.credential;
  if (projectId !== "verdanza-1f621" || !credential) throw new Error("referral_sponsor_lookup_unavailable");
  const accessToken = (await credential.getAccessToken()).access_token;
  return lookupReferralSponsorEmail({ uid, projectId, accessToken, fetchImpl: fetch });
}
