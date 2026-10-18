/** An admin email must match Firebase Auth exactly. Security Rules cannot apply
 * the client's former trim/lowercase normalization, so every boundary uses
 * the same canonical stored/token value without transforming either side. */
export function isAdminRecordBoundToIdentity(
  record: { isActive?: unknown; email?: unknown; uid?: unknown } | null | undefined,
  identity: { uid: string; email: string | null } | null | undefined,
): boolean {
  return record?.isActive === true
    && typeof identity?.uid === "string"
    && identity.uid.length > 0
    && typeof identity.email === "string"
    && identity.email.length > 0
    && record.email === identity.email
    && (record.uid == null || record.uid === identity.uid);
}