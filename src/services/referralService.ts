import { getFirebaseIdToken } from "../lib/firebaseAuth";
import { REFERRAL_SELF_VERSION, type ReferralSelf } from "../types/referralRead";

export class ReferralHttpError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = "ReferralHttpError"; }
}
type Dependencies = { getToken?: typeof getFirebaseIdToken; fetch?: typeof fetch };
async function request(action: "self" | "ensure_code" | "link", code: string | undefined, dependencies: Dependencies) {
  const token = await (dependencies.getToken ?? getFirebaseIdToken)();
  if (!token) throw new ReferralHttpError("AUTH_REQUIRED", 401);
  const response = await (dependencies.fetch ?? fetch)("/api/referral", {
    method: action === "self" ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, ...(action === "self" ? {} : { "content-type": "application/json" }) },
    cache: "no-store",
    ...(action === "self" ? {} : { body: JSON.stringify({ action, ...(code === undefined ? {} : { code }) }) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ReferralHttpError(payload.code || "referral_unavailable", response.status);
  return payload;
}
export async function getReferralSelf(dependencies: Dependencies = {}): Promise<ReferralSelf> {
  const payload = await request("self", undefined, dependencies);
  const keys = ["referralsTotal", "linkedCount", "pendingCount", "rewardedCount", "cancelledCount", "reversedCount", "pendingRewardCents", "validatedRewardCents"] as const;
  const relation = payload.relation;
  if (payload.version !== REFERRAL_SELF_VERSION || (payload.code !== null && !/^[A-Z2-7]{26}$/.test(payload.code)) ||
    !payload.sponsorSummary || keys.some((key) => !Number.isSafeInteger(payload.sponsorSummary[key]) || payload.sponsorSummary[key] < 0) ||
    (relation !== null && (!relation || !["linked", "pending", "rewarded", "cancelled", "reversed"].includes(relation.state) ||
      typeof relation.paymentConfirmed !== "boolean" || typeof relation.deliveryConfirmed !== "boolean" || typeof relation.checkoutReserved !== "boolean")))
    throw new ReferralHttpError("referral_response_invalid", 502);
  return { version: REFERRAL_SELF_VERSION, code: payload.code,
    relation: relation ? { state: relation.state, paymentConfirmed: relation.paymentConfirmed, deliveryConfirmed: relation.deliveryConfirmed, checkoutReserved: relation.checkoutReserved } : null,
    sponsorSummary: Object.fromEntries(keys.map((key) => [key, payload.sponsorSummary[key]])) as ReferralSelf["sponsorSummary"] };
}
export async function ensureReferralCode(dependencies: Dependencies = {}): Promise<{ code: string }> {
  const payload = await request("ensure_code", undefined, dependencies);
  if (typeof payload.code !== "string" || !/^[A-Z2-7]{26}$/.test(payload.code)) throw new ReferralHttpError("referral_response_invalid", 502);
  return { code: payload.code };
}
export async function linkReferralCode(code: string, dependencies: Dependencies = {}): Promise<{ state: "linked"; changed: boolean }> {
  const payload = await request("link", code, dependencies);
  if (payload.state !== "linked" || typeof payload.changed !== "boolean") throw new ReferralHttpError("referral_response_invalid", 502);
  return { state: "linked", changed: payload.changed };
}
export const referralClient = { getReferralSelf, ensureReferralCode, linkReferralCode };
export type ReferralClient = typeof referralClient;
