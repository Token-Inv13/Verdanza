import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import type { Coupon, PromoBanner, PromoBannerPlacement } from "../src/types/index.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "GET")) return;

  try {
    const db = getAdminDb();
    const [bannerSnapshot, couponSnapshot] = await Promise.all([
      db
        .collection("promoBanners")
        .where("isActive", "==", true)
        .where("isArchived", "==", false)
        .get(),
      db.collection("coupons").get(),
    ]);
    const coupons = couponSnapshot.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as Coupon,
    );
    const banners = bannerSnapshot.docs
      .map((entry) => normalizePublicBanner({ id: entry.id, ...entry.data() } as PromoBanner))
      .filter((banner) => isPublicBannerVisible(banner, coupons))
      .sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0));

    sendJson(response, {
      banners: banners.map((banner) => ({
        id: banner.id,
        title: banner.title,
        message: banner.message,
        type: banner.type,
        placement: banner.placement,
        placements: banner.placements,
        isActive: banner.isActive,
        startsAt: banner.startsAt || "",
        endsAt: banner.endsAt || "",
        priority: Number(banner.priority || 0),
        buttonLabel: banner.buttonLabel || "",
        buttonUrl: banner.buttonUrl || "",
        linkedCouponId: banner.linkedCouponId || "",
        linkedPromoCode: banner.linkedPromoCode || "",
        variant: banner.variant,
        dismissible: Boolean(banner.dismissible),
        isArchived: Boolean(banner.isArchived),
        isTemplate: Boolean(banner.isTemplate),
      })),
    });
  } catch (error) {
    console.error("public-promo-banners failed", error);
    sendJson(response, { banners: [] }, 200);
  }
}

function normalizePublicBanner(banner: PromoBanner): PromoBanner {
  const placements = normalizePlacements(
    banner.placements?.length ? banner.placements : [banner.placement],
  );
  return {
    ...banner,
    title: String(banner.title || ""),
    message: String(banner.message || ""),
    placement: placements.includes("all_public") ? "all_public" : placements[0] || "draft",
    placements,
    isActive: banner.isActive === true,
    isArchived: banner.isArchived === true,
    isTemplate: banner.isTemplate === true,
    priority: Number(banner.priority || 0),
    buttonLabel: banner.buttonLabel || "",
    buttonUrl: banner.buttonUrl || "",
    linkedCouponId: banner.linkedCouponId || banner.deletedLinkedCouponId || "",
    linkedPromoCode: banner.linkedPromoCode || "",
    deletedLinkedCouponId: banner.deletedLinkedCouponId || "",
  };
}

function isPublicBannerVisible(banner: PromoBanner, coupons: Coupon[]) {
  if (!banner.isActive || banner.isArchived || banner.isTemplate) return false;
  if (!banner.title.trim() || !banner.message.trim()) return false;
  const placements = normalizePlacements(
    banner.placements?.length ? banner.placements : [banner.placement],
  );
  if (!placements.length || placements.every((placement) => placement === "draft")) return false;
  const now = Date.now();
  const startsAt = banner.startsAt ? Date.parse(banner.startsAt) : 0;
  const endsAt = banner.endsAt ? Date.parse(banner.endsAt) : 0;
  if (startsAt && now < startsAt) return false;
  if (endsAt && now > endOfDay(endsAt)) return false;

  const linkedCoupon = findLinkedCoupon(coupons, banner);
  if (banner.linkedCouponId || banner.linkedPromoCode || banner.deletedLinkedCouponId) {
    if (!linkedCoupon) return false;
    if (!isCouponCurrentlyUsable(linkedCoupon, now)) return false;
  }
  return true;
}

function findLinkedCoupon(coupons: Coupon[], banner: PromoBanner) {
  if (banner.linkedCouponId) {
    return coupons.find((coupon) => coupon.id === banner.linkedCouponId);
  }
  const code = (banner.linkedPromoCode || "").trim().toUpperCase();
  if (!code) return undefined;
  return coupons.find((coupon) => coupon.code.trim().toUpperCase() === code);
}

function isCouponCurrentlyUsable(coupon: Coupon, now: number) {
  const startsAt = coupon.startsAt ? Date.parse(coupon.startsAt) : 0;
  const endsAt = coupon.endsAt ? Date.parse(coupon.endsAt) : 0;
  if (!coupon.isActive || coupon.isArchived) return false;
  if (startsAt && now < startsAt) return false;
  if (endsAt && now > endOfDay(endsAt)) return false;
  if (coupon.maxUses && Number(coupon.usedCount || 0) >= Number(coupon.maxUses)) {
    return false;
  }
  return true;
}

function normalizePlacements(values: unknown[]) {
  const valid = new Set<PromoBannerPlacement>([
    "home",
    "shop",
    "flowers",
    "resins",
    "cart",
    "checkout",
    "all_public",
    "draft",
  ]);
  const placements = values
    .map((value) => String(value || "").trim() as PromoBannerPlacement)
    .filter((value) => valid.has(value));
  const unique = Array.from(new Set(placements));
  if (unique.includes("all_public")) return ["all_public"] as PromoBannerPlacement[];
  const publicPlacements = unique.filter((placement) => placement !== "draft");
  return publicPlacements.length ? publicPlacements : (["draft"] as PromoBannerPlacement[]);
}

function endOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}
