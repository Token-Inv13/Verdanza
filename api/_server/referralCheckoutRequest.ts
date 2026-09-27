import { REFERRAL_CHECKOUT_QUOTE_VERSION, type ReferralCheckoutAcceptance, type ReferralUseRequest } from "../../src/types/referralCheckout.js";
import { ReferralError } from "./referralErrors.js";

/** Only distinguishes the new HTTP contract; no business/runtime resolution. */
export function hasReferralCheckoutRequest(value: unknown): boolean {
  try {
    const body = typeof value === "string" ? JSON.parse(value) : value;
    return Boolean(body && typeof body === "object" && !Array.isArray(body) && body.referralUse !== undefined);
  } catch { return false; }
}
export function parseReferralUse(value: unknown): ReferralUseRequest | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReferralError("referral_request_invalid", 400);
  const raw = value as Record<string, unknown>;
  if (raw.requested !== true || Object.keys(raw).some(key => !["requested", "acceptance"].includes(key))) throw new ReferralError("referral_request_invalid", 400);
  if (raw.acceptance === undefined) return { requested: true };
  const a = raw.acceptance as Partial<ReferralCheckoutAcceptance>;
  if (!a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).sort().join(",") !== "acceptedPayableCents,acceptedReferralDiscountCents,quoteFingerprint,quoteVersion" ||
      a.quoteVersion !== REFERRAL_CHECKOUT_QUOTE_VERSION || typeof a.quoteFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(a.quoteFingerprint) ||
      a.acceptedReferralDiscountCents !== 500 || !Number.isSafeInteger(a.acceptedPayableCents) || Number(a.acceptedPayableCents) < 0) throw new ReferralError("referral_acceptance_invalid", 400);
  return { requested: true, acceptance: a as ReferralCheckoutAcceptance };
}
