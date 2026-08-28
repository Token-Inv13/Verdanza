import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import {
  priceCheckout,
  type CheckoutRequestBody,
  type CheckoutRequestItem,
} from "./_server/checkout.js";
import type {
  Coupon,
  Address,
  DeliveryMethod,
  PromoBanner,
  PromoBannerPlacement,
  Product,
  PromotionSelection,
} from "../src/types/index.js";
import { promotionAvailability } from "../src/lib/promotionDates.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (isPublicPromoBannersRequest(request)) {
    await handlePublicPromoBanners(response);
    return;
  }

  if (assertMethod(request, response, "POST")) return;

  try {
    const requestBody =
      typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const body = parseQuoteBody(requestBody);
    const priced = await priceCheckout(getAdminDb(), body);

    sendJson(response, {
      subtotal: priced.subtotal,
      subtotalBeforeDiscount: priced.subtotalBeforeDiscount,
      deliveryFee: priced.deliveryFee,
      deliveryFeeStatus: priced.deliveryFeeStatus,
      deliveryNote: priced.deliveryNote,
      discountAmount: priced.discountAmount,
      couponCode: priced.couponCode,
      promoApplied: priced.promoApplied,
      discountType: priced.discountType,
      discountValue: priced.discountValue,
      promotionDiscountTotal: priced.promotionDiscountTotal,
      appliedPromotions: priced.appliedPromotions,
      promotionProgressMessages: priced.promotionProgressMessages,
      subtotalBeforePromotion: priced.subtotalBeforePromotion,
      subtotalAfterPromotion: priced.subtotalAfterPromotion,
      postalFreeShippingApplied: priced.postalFreeShippingApplied,
      total: priced.total,
      giftPromotions: priced.giftPromotions,
      promotionConflictMessage: priced.promotionConflictMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    sendJson(
      response,
      {
        error: safeQuoteError(message),
      },
      400,
    );
  }
}

function isPublicPromoBannersRequest(request: VercelRequestLike) {
  if (request.method !== "GET") return false;
  const url = request.url || "";
  return url.includes("publicPromoBanners=1") || url.startsWith("/api/public-promo-banners");
}

async function handlePublicPromoBanners(response: VercelResponseLike) {
  try {
    const db = getAdminDb();
    const [bannerSnapshot, couponSnapshot, productSnapshot] = await Promise.all([
      db
        .collection("promoBanners")
        .where("isActive", "==", true)
        .where("isArchived", "==", false)
        .get(),
      db.collection("coupons").get(),
      db.collection("products").get(),
    ]);
    const coupons = couponSnapshot.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as Coupon,
    );
    const products = productSnapshot.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as Product,
    );
    const banners = bannerSnapshot.docs
      .map((entry) => normalizePublicBanner({ id: entry.id, ...entry.data() } as PromoBanner))
      .filter((banner) => isPublicBannerVisible(banner, coupons, products))
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

function isPublicBannerVisible(banner: PromoBanner, coupons: Coupon[], products: Product[]) {
  if (!banner.isActive || banner.isArchived || banner.isTemplate) return false;
  if (!banner.title.trim() || !banner.message.trim()) return false;
  const placements = normalizePlacements(
    banner.placements?.length ? banner.placements : [banner.placement],
  );
  if (!placements.length || placements.every((placement) => placement === "draft")) return false;
  if (promotionAvailability(banner) !== "active") return false;

  const linkedCoupon = findLinkedCoupon(coupons, banner);
  if (banner.linkedCouponId || banner.linkedPromoCode || banner.deletedLinkedCouponId) {
    if (!linkedCoupon) return false;
    if (promotionAvailability(linkedCoupon) !== "active") return false;
    if (linkedCoupon.promotionType === "tiered_product_gift") {
      const firstTier = [...(linkedCoupon.giftTiers || [])]
        .sort((left, right) => left.minimumSubtotal - right.minimumSubtotal)[0];
      const configuredIds = new Set(linkedCoupon.giftProductIds || []);
      if (
        !firstTier ||
        !products.some(
          (product) =>
            configuredIds.has(product.id) &&
            product.isActive &&
            Number(product.stock || 0) >= Number(firstTier.quantityGrams || 0),
        )
      ) {
        return false;
      }
    }
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

function parseQuoteBody(value: unknown): CheckoutRequestBody {
  if (!value || typeof value !== "object") {
    throw new Error("Payload devis invalide.");
  }
  const body = value as {
    items?: CheckoutRequestItem[];
    deliveryMethod?: DeliveryMethod;
    deliveryZone?: string;
    couponCode?: string;
    email?: string;
    address?: Address;
    promotionSelections?: PromotionSelection[];
  };

  if (!Array.isArray(body.items) || !body.items.length) {
    throw new Error("Le panier est vide.");
  }
  if (body.deliveryMethod !== "postal" && body.deliveryMethod !== "local_express") {
    throw new Error("Mode de livraison invalide.");
  }

  return {
    items: body.items,
    deliveryMethod: body.deliveryMethod,
    deliveryZone: body.deliveryZone,
    couponCode: body.couponCode,
    promotionSelections: body.promotionSelections,
    complianceAccepted: true,
    preferredPaymentMethod: "card_payment_link",
    customer: {
      email: String(body.email || "quote@verdanza.fr").trim(),
      phone: "0000000000",
      firstName: "Devis",
      lastName: "Verdanza",
      address: body.address || {
        firstName: "Devis",
        lastName: "Verdanza",
        line1: "Adresse devis",
        postalCode: "13090",
        city: "Aix-en-Provence",
        country: "France",
      },
    },
  };
}

function safeQuoteError(message: string) {
  if (message.includes("invalide")) return "Ce code promo n'est pas valide.";
  if (message.includes("expire")) return "Ce code promo a expire.";
  if (message.includes("pas encore actif")) return "Ce code promo n'est pas encore actif.";
  if (message.includes("maximum")) return "Ce code promo n'est plus disponible.";
  if (message.includes("minimum de commande")) return message;
  if (message.includes("partir de")) {
    return "Le minimum de commande pour ce code promo n'est pas atteint.";
  }
  if (message.includes("livraison postale")) return message;
  if (message.toLowerCase().includes("adresse") || message.includes("zone de livraison")) return message;
  if (message.includes("non applicable")) return "Ce code promo n'est pas applicable a ce panier.";
  return "Impossible de verifier ce code promo pour le moment.";
}
