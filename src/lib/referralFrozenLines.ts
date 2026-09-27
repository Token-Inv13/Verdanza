import type { Order, OrderItem } from "../types/index.js";
import { orderItemLineTotal } from "./orderLineDisplay.js";

export type FrozenReferralLineAmounts = {
  eligibleCents: number;
  discountCents: number;
  netCents: number;
};

/** Read frozen cents once. Invalid historic data must not be reallocated as if it were valid. */
export function resolveFrozenReferralLineAmounts(
  order: Pick<Order, "items" | "referral" | "subtotalAfterPromotion">,
): Map<string, FrozenReferralLineAmounts> | null {
  const snapshot = order.referral;
  if (!snapshot || !Array.isArray(snapshot.lines) || !snapshot.lines.length ||
      !Number.isSafeInteger(snapshot.eligibleProductsBeforeReferralCents) || snapshot.eligibleProductsBeforeReferralCents <= 0 ||
      !Number.isSafeInteger(snapshot.refereeDiscountCents) || snapshot.refereeDiscountCents < 0) return null;

  const subtotalCents = Math.round(Number(order.subtotalAfterPromotion) * 100);
  const expectedNetCents = subtotalCents - snapshot.refereeDiscountCents;
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0 ||
      !Number.isSafeInteger(expectedNetCents) || expectedNetCents < 0) return null;

  const itemsByLineId = new Map<string, OrderItem | null>();
  let grossCents = 0;
  for (const item of order.items) {
    const cents = Math.round(orderItemLineTotal(item) * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) return null;
    grossCents += cents;
    if (!Number.isSafeInteger(grossCents)) return null;
    if (typeof item.lineId === "string" && item.lineId) {
      itemsByLineId.set(item.lineId, itemsByLineId.has(item.lineId) ? null : item);
    }
  }

  const amounts = new Map<string, FrozenReferralLineAmounts>();
  let eligibleCents = 0;
  let discountCents = 0;
  let netCents = 0;
  for (const line of snapshot.lines) {
    if (!line || typeof line.lineId !== "string" || !line.lineId || amounts.has(line.lineId) ||
        !Number.isSafeInteger(line.eligibleBeforeReferralCents) || line.eligibleBeforeReferralCents <= 0 ||
        !Number.isSafeInteger(line.referralDiscountCents) || line.referralDiscountCents < 0 ||
        line.referralDiscountCents >= line.eligibleBeforeReferralCents) return null;
    const item = itemsByLineId.get(line.lineId);
    if (!item || Math.round(orderItemLineTotal(item) * 100) !== line.eligibleBeforeReferralCents) return null;
    const frozenNetCents = line.eligibleBeforeReferralCents - line.referralDiscountCents;
    amounts.set(line.lineId, {
      eligibleCents: line.eligibleBeforeReferralCents,
      discountCents: line.referralDiscountCents,
      netCents: frozenNetCents,
    });
    eligibleCents += line.eligibleBeforeReferralCents;
    discountCents += line.referralDiscountCents;
    netCents += frozenNetCents;
    if (![eligibleCents, discountCents, netCents].every(Number.isSafeInteger)) return null;
  }
  return eligibleCents === snapshot.eligibleProductsBeforeReferralCents && eligibleCents === subtotalCents &&
    grossCents === eligibleCents && discountCents === snapshot.refereeDiscountCents &&
    netCents === expectedNetCents ? amounts : null;
}
