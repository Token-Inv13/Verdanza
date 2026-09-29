import type { MarketingParameters } from "../types/marketing.js";

export function marketingParameterProductIds(parameters: MarketingParameters): string[] {
  const p = parameters.promotion;
  return [...new Set([...(p?.productIds || []), ...(p?.giftProductIds || []),
    ...(p?.qualifyingProductIds || []), ...(p?.defaultGiftProductId ? [p.defaultGiftProductId] : [])])];
}
