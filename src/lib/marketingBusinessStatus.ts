import type { Coupon, PromoBanner } from "../types";
import { promotionAvailability, promotionBoundaryTimestamp } from "./promotionDates";
import { promoBannerVisibility } from "../services/promoBannersService";

export function promotionState(coupon: Coupon) {
  if (coupon.isArchived) return "Archivée"; if (coupon.isTemplate) return "Modèle";
  if (promotionBoundaryTimestamp(coupon.endsAt, "end") && promotionBoundaryTimestamp(coupon.endsAt, "end") < Date.now()) return "Terminée";
  return ({ active: "Active", inactive: "Inactive", scheduled: "Programmée", expired: "Terminée", max_uses: "Limite atteinte" })[promotionAvailability(coupon)];
}
export function bannerState(banner: PromoBanner, coupons: Coupon[]) {
  if (banner.isArchived) return "Archivée"; if (banner.isTemplate) return "Modèle";
  if (promotionBoundaryTimestamp(banner.endsAt, "end") && promotionBoundaryTimestamp(banner.endsAt, "end") < Date.now()) return "Expirée";
  if (!banner.isActive) return "Inactive";
  const linkedCoupon = coupons.find((coupon) => banner.linkedCouponId ? coupon.id === banner.linkedCouponId : Boolean(banner.linkedPromoCode) && coupon.code === banner.linkedPromoCode);
  const visibility = promoBannerVisibility(banner, { linkedCoupon, hasLinkedCouponLookup: true }); return visibility.visible ? "Active" : visibility.label;
}
