/** Shared identity form; the original email remains available for communications. */
export function canonicalOrderEmail(value: unknown): string {
  return String(value).trim().toLowerCase();
}

export function usableOrderEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = canonicalOrderEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
