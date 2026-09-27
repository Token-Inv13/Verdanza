import assert from "node:assert/strict";
import {
  FirebaseIdTokenVerificationError,
  firebaseAuthHttpFailure,
  verifyFirebaseIdToken,
} from "../api/_server/adminAuth.js";
import createReview from "../api/create-review.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.VITE_FIREBASE_API_KEY;
const scenarios: Array<[string, number, unknown, "authentication" | "configuration" | "unavailable"]> = [
  ["invalid token", 400, { error: { message: "INVALID_ID_TOKEN" } }, "authentication"],
  ["expired token", 400, { error: { message: "TOKEN_EXPIRED" } }, "authentication"],
  ["unknown user", 400, { error: { message: "USER_NOT_FOUND" } }, "authentication"],
  ["invalid API key", 400, { error: { message: "API_KEY_INVALID" } }, "configuration"],
  ["rate limited", 429, { error: { message: "TOO_MANY_ATTEMPTS_TRY_LATER" } }, "unavailable"],
  ["backend error", 503, { error: { message: "INTERNAL" } }, "unavailable"],
];

async function category(run: () => Promise<unknown>, expected: FirebaseIdTokenVerificationError["category"]) {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof FirebaseIdTokenVerificationError);
    assert.equal(error.category, expected);
    assert.deepEqual(firebaseAuthHttpFailure(error), expected === "authentication"
      ? { status: 401, code: "authentication_required" }
      : { status: 503, code: "authentication_unavailable" });
    return true;
  });
}

async function review(token?: string) {
  let status = 0;
  let payload: unknown;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { payload = value; } };
  await createReview({ method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: {} } as VercelRequestLike, response as VercelResponseLike);
  return { status, payload: payload as { code?: string } };
}

try {
  process.env.VITE_FIREBASE_API_KEY = "local-test-api-key";
  for (const [name, status, payload, expected] of scenarios) {
    globalThis.fetch = async () => new Response(JSON.stringify(payload), { status });
    await category(() => verifyFirebaseIdToken("test-token"), expected);
    const rejectedReview = await review("test-token");
    assert.equal(rejectedReview.status, expected === "authentication" ? 401 : 503);
    console.log(`OK firebase auth: ${name}`);
  }
  assert.equal((await review()).status, 401);
  delete process.env.VITE_FIREBASE_API_KEY;
  await category(() => verifyFirebaseIdToken("test-token"), "configuration");
  process.env.VITE_FIREBASE_API_KEY = "local-test-api-key";
  globalThis.fetch = async () => { throw new Error("local network fixture"); };
  await category(() => verifyFirebaseIdToken("test-token"), "unavailable");
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  await category(() => verifyFirebaseIdToken("test-token"), "unavailable");
  globalThis.fetch = async () => new Response(JSON.stringify({ users: [{ localId: "test-user", email: "test@example.test", emailVerified: true }] }), { status: 200 });
  assert.deepEqual(await verifyFirebaseIdToken("test-token"), { uid: "test-user", email: "test@example.test", emailVerified: true });
  assert.equal(firebaseAuthHttpFailure(new Error("ordinary error")), null);
  console.log("OK firebase auth: missing key, fetch failure, invalid JSON, valid token, non-auth error");
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.VITE_FIREBASE_API_KEY;
  else process.env.VITE_FIREBASE_API_KEY = originalKey;
}
