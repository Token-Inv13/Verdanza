import type { Firestore } from "firebase-admin/firestore";

export type VerifiedFirebaseUser = {
  uid: string;
  email: string | null;
};

export async function verifyFirebaseIdToken(
  idToken: string,
): Promise<VerifiedFirebaseUser> {
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("Missing VITE_FIREBASE_API_KEY server variable.");

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  const payload = (await response.json()) as {
    users?: Array<{ localId?: string; email?: string }>;
    error?: { message?: string };
  };

  const user = payload.users?.[0];
  if (!response.ok || !user?.localId) {
    throw new Error(payload.error?.message || "Token Firebase invalide.");
  }

  return {
    uid: user.localId,
    email: user.email ?? null,
  };
}

export async function assertAdminUser(db: Firestore, idToken: string) {
  const user = await verifyFirebaseIdToken(idToken);
  const uidSnapshot = await db.collection("adminUsers").doc(user.uid).get();
  const emailSnapshot = user.email
    ? await db.collection("adminUsers").doc(user.email).get()
    : null;
  const adminData = uidSnapshot.exists
    ? uidSnapshot.data()
    : emailSnapshot?.exists
      ? emailSnapshot.data()
      : null;

  if (!adminData?.isActive) {
    throw new Error("Acces admin requis.");
  }

  return user;
}
