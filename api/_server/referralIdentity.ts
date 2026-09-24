import { createHmac, randomBytes } from "node:crypto";

export function normalizeReferralEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("referral_email_invalid");
  return email;
}

export type ReferralEmailKeyring = Readonly<{ activeVersion: string; keys: Readonly<Record<string, string>> }>;
const VERSION = /^v[1-9][0-9]{0,2}$/;
export function parseReferralEmailKeyring(raw: string): ReferralEmailKeyring {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("referral_email_keyring_invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "activeVersion,keys") throw new Error("referral_email_keyring_invalid");
  const input = value as { activeVersion?: unknown; keys?: unknown };
  if (typeof input.activeVersion !== "string" || !VERSION.test(input.activeVersion) ||
      !input.keys || typeof input.keys !== "object" || Array.isArray(input.keys)) throw new Error("referral_email_keyring_invalid");
  const keys = input.keys as Record<string, unknown>;
  const versions = Object.keys(keys);
  if (versions.length < 1 || versions.length > 4 || !versions.includes(input.activeVersion)) throw new Error("referral_email_keyring_invalid");
  for (const version of versions) {
    if (!VERSION.test(version) || typeof keys[version] !== "string") throw new Error("referral_email_keyring_invalid");
    assertReferralEmailSecret(keys[version]);
  }
  if (new Set(Object.values(keys)).size !== versions.length) throw new Error("referral_email_keyring_invalid");
  return { activeVersion: input.activeVersion, keys: keys as Record<string, string> };
}
export function referralEmailClaimId(secret: string, normalizedEmail: string, version = "v1") {
  assertReferralEmailSecret(secret);
  if (!VERSION.test(version)) throw new Error("referral_email_keyring_invalid");
  return createHmac("sha256", secret).update(`referral-email-claim\0${version}\0${normalizeReferralEmail(normalizedEmail)}`).digest("hex");
}
export function referralEmailClaimAliases(keyring: ReferralEmailKeyring, normalizedEmail: string) {
  const aliases = Object.entries(keyring.keys).sort(([a], [b]) => a.localeCompare(b))
    .map(([version, secret]) => ({ version, id: referralEmailClaimId(secret, normalizedEmail, version) }));
  // The old single-secret implementation used an unversioned ID. Keep it addressable during v1 rotation.
  if (keyring.keys.v1) aliases.push({ version: "referral-email-hmac-v1", id: createHmac("sha256", keyring.keys.v1).update(normalizeReferralEmail(normalizedEmail)).digest("hex") });
  return aliases;
}
export function assertReferralEmailSecret(secret: string) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) throw new Error("referral_email_secret_invalid");
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newReferralCode(bytes: () => Buffer = () => randomBytes(16)) {
  const source = bytes();
  if (source.length !== 16) throw new Error("referral_entropy_invalid");
  let bits = 0; let value = 0; let code = "";
  for (const byte of source) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; code += alphabet[(value >>> bits) & 31]; }
  }
  if (bits > 0) code += alphabet[(value << (5 - bits)) & 31];
  return code;
}
