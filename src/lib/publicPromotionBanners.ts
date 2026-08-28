import type {
  Coupon,
  Product,
  ProductGiftTier,
  PromoBanner,
  PublicPromotionSummary,
} from "../types/index.js";

export function publicPromotionSummary(
  coupon: Coupon,
  products: Product[] = [],
): PublicPromotionSummary {
  const requiresCode = coupon.autoApply !== true;
  const giftProductIds = new Set(coupon.giftProductIds || []);
  const giftTiers = sanitizeGiftTiers(coupon.giftTiers || []);
  const giftProductNames = products
    .filter((product) => giftProductIds.has(product.id))
    .map((product) => String(product.name || "").trim())
    .filter(Boolean);

  return {
    ...(coupon.promotionType ? { promotionType: coupon.promotionType } : {}),
    applicationMode: requiresCode ? "code" : "automatic",
    requiresCode,
    ...(giftTiers.length ? { giftTiers } : {}),
    ...(giftProductNames.length ? { giftProductNames } : {}),
    ...(coupon.discountType ? { discountType: coupon.discountType } : {}),
    discountValue: finiteNonNegative(coupon.discountValue),
    minimumOrder: finiteNonNegative(coupon.minimumOrder),
  };
}

export function publicPromoCode(
  bannerCode: string | undefined,
  coupon: Coupon | undefined,
  summary: PublicPromotionSummary | undefined,
) {
  if (!summary?.requiresCode) return "";
  return String(bannerCode || coupon?.code || "").trim().toUpperCase();
}

export function orderedTopPromoBanners(banners: PromoBanner[]) {
  return [...banners].sort(
    (left, right) => Number(left.priority || 0) - Number(right.priority || 0),
  );
}

export function topPromoPresentation(banners: PromoBanner[], activeIndex = 0) {
  const ordered = orderedTopPromoBanners(banners);
  const currentIndex = ordered.length
    ? ((activeIndex % ordered.length) + ordered.length) % ordered.length
    : 0;
  return {
    primary: ordered[currentIndex],
    secondary: ordered.length > 1 ? ordered[(currentIndex + 1) % ordered.length] : undefined,
    currentIndex,
    showNavigation: ordered.length > 2,
  };
}

export function publicCodeForBanner(banner: PromoBanner) {
  if (banner.promotionSummary?.requiresCode !== true) return "";
  return String(banner.linkedPromoCode || "").trim().toUpperCase();
}

function sanitizeGiftTiers(tiers: ProductGiftTier[]) {
  return tiers
    .map((tier) => ({
      id: String(tier.id || "").trim(),
      minimumSubtotal: finiteNonNegative(tier.minimumSubtotal),
      quantityGrams: Math.max(0, Math.floor(finiteNonNegative(tier.quantityGrams))),
    }))
    .filter(
      (tier) => tier.id && tier.minimumSubtotal > 0 && tier.quantityGrams > 0,
    )
    .sort((left, right) => left.minimumSubtotal - right.minimumSubtotal);
}

function finiteNonNegative(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}
