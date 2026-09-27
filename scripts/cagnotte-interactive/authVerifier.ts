import { FirebaseIdTokenVerificationError, type VerifiedFirebaseUser } from "../../api/_server/adminAuth.js";
import { localUrl, RECIPE_PORTS, RECIPE_PROJECT_ID } from "./constants.js";

type TokenClaims = {
  aud?: unknown;
  iss?: unknown;
  sub?: unknown;
  exp?: unknown;
};

export async function verifyLocalAuthEmulatorToken(idToken: string): Promise<VerifiedFirebaseUser> {
  const claims = decodeClaims(idToken);
  const expectedIssuer = `https://securetoken.google.com/${RECIPE_PROJECT_ID}`;
  if (
    claims.aud !== RECIPE_PROJECT_ID ||
    claims.iss !== expectedIssuer ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.exp !== "number" ||
    claims.exp * 1000 <= Date.now()
  ) {
    throw new FirebaseIdTokenVerificationError("authentication");
  }

  const response = await fetch(
    localUrl(RECIPE_PORTS.auth, "/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo-api-key"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  ).catch(() => { throw new FirebaseIdTokenVerificationError("unavailable"); });
  const payload = await response.json().catch(() => { throw new FirebaseIdTokenVerificationError("unavailable"); }) as {
    users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    error?: { message?: string };
  };
  const user = payload.users?.[0];
  if (!response.ok || !user?.localId || user.localId !== claims.sub) {
    throw new FirebaseIdTokenVerificationError(response.status >= 500 || response.status === 429 ? "unavailable" : "authentication");
  }
  return {
    uid: user.localId,
    email: user.email ?? null,
    emailVerified: user.emailVerified === true,
  };
}

function decodeClaims(token: string): TokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new FirebaseIdTokenVerificationError("authentication");
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as TokenClaims;
  } catch {
    throw new FirebaseIdTokenVerificationError("authentication");
  }
}
