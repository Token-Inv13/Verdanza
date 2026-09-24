import type { Firestore } from "firebase-admin/firestore";

export type VerifiedFirebaseUser = {
  uid: string;
  email: string | null;
  emailVerified?: boolean;
};

export class FirebaseIdTokenVerificationError extends Error {
  constructor(readonly category: "authentication" | "configuration" | "unavailable") { super(`firebase_token_${category}`); }
}

export async function verifyFirebaseIdToken(
  idToken: string,
): Promise<VerifiedFirebaseUser> {
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) throw new FirebaseIdTokenVerificationError("configuration");

  if (!idToken?.trim()) throw new FirebaseIdTokenVerificationError("authentication");

  let response: Response;
  try { response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  ); } catch { throw new FirebaseIdTokenVerificationError("unavailable"); }
  let payload: {
    users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    error?: { message?: string };
  };
  try { payload = await response.json() as typeof payload; }
  catch { throw new FirebaseIdTokenVerificationError("unavailable"); }

  const user = payload.users?.[0];
  if (!response.ok || !user?.localId) {
    const code = payload.error?.message ?? "";
    if (code === "API_KEY_INVALID" || code === "INVALID_API_KEY" || code === "PROJECT_NOT_FOUND") throw new FirebaseIdTokenVerificationError("configuration");
    if (response.status >= 500 || response.status === 429) throw new FirebaseIdTokenVerificationError("unavailable");
    throw new FirebaseIdTokenVerificationError("authentication");
  }

  return {
    uid: user.localId,
    email: user.email ?? null,
    emailVerified: user.emailVerified === true,
  };
}

export async function assertAdminUser(
  db: Firestore, idToken: string,
  verify: typeof verifyFirebaseIdToken = verifyFirebaseIdToken,
) {
  const user = await verify(idToken);
  const uidSnapshot = await db.collection("adminUsers").doc(user.uid).get();
  const emailSnapshot = user.email && user.emailVerified === true
    ? await db.collection("adminUsers").doc(user.email).get()
    : null;
  const adminData = uidSnapshot.exists
    ? uidSnapshot.data()
    : emailSnapshot?.exists
      ? emailSnapshot.data()
      : null;

  if (adminData?.isActive !== true) {
    throw new Error("Acces admin requis.");
  }

  return user;
}
