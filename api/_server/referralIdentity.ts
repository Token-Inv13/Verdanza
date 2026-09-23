import { createHmac, randomBytes } from "node:crypto";

export function normalizeReferralEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("referral_email_invalid");
  return email;
}

export function referralEmailClaimId(secret: string, normalizedEmail: string) {
  assertReferralEmailSecret(secret);
  return createHmac("sha256", secret).update(normalizeReferralEmail(normalizedEmail)).digest("hex");
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
