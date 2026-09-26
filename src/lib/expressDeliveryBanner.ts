import type { PromoBanner } from "../types";

export type ExpressDeliverySummary = {
  delay: string;
  opensAt: string;
  closesAt: string;
  radius: string;
};

// Presentation only: visibility and delivery eligibility stay in their existing sources.
// If the admin message gains new conditions, show the complete generic banner instead.
export function expressDeliverySummary(banner: PromoBanner): ExpressDeliverySummary | null {
  if (
    banner.id !== "livraison-express-a-aix-en-provence-1786182455265" ||
    banner.type !== "shop_card" ||
    !["info", "delivery"].includes(banner.variant) ||
    banner.linkedCouponId || banner.linkedPromoCode || banner.promotionSummary ||
    banner.buttonLabel || banner.buttonUrl
  ) return null;

  const clean = (value: string) => value
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\s+/g, " ").trim();
  if (clean(banner.title) !== "Livraison express à Aix-en-Provence") return null;
  const match = clean(banner.message).match(
    /^Livraison offerte · environ (\d+(?:[.,]\d+)?) h · de (\d{1,2}) h à (\d{1,2}) h du matin · jusqu[’']à (\d+(?:[.,]\d+)?) km autour du centre-ville\.$/u,
  );
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 23 ||
    Number(match[1].replace(",", ".")) <= 0 || Number(match[4].replace(",", ".")) <= 0) return null;

  return { delay: match[1], opensAt: match[2], closesAt: match[3], radius: match[4] };
}
