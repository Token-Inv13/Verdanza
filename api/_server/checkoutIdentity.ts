import { verifyFirebaseIdToken } from "./adminAuth.js";

/** Same verified identity for creation and every idempotent retry branch. */
export function createCheckoutIdentityResolver(
  authToken: string | undefined,
  verify: typeof verifyFirebaseIdToken = verifyFirebaseIdToken,
) {
  let identity: Promise<string | undefined> | undefined;
  return () => identity ??= authToken
    ? verify(authToken).then((user) => user.uid)
    : Promise.resolve(undefined);
}
