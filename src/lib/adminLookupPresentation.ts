export function isExpectedNonAdminLookupError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code || "");
  return code === "permission-denied" || code === "firestore/permission-denied";
}
