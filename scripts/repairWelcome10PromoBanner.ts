import { FieldValue } from "firebase-admin/firestore";
import {
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";
import {
  buildAssociatedPromoBannerInput,
  normalizePromoBanner,
} from "../src/services/promoBannersService.ts";
import type { Coupon, PromoBanner } from "../src/types/index.js";

const expectedProjectId = "verdanza-1f621";
const couponId = "welcome10";

requireConfirmationFlag("repair:welcome10-promo-banner");

const { db, projectId } = getRequiredAdminDb();
if (projectId !== expectedProjectId) {
  throw new Error(`Projet Firebase inattendu: ${projectId}. Attendu: ${expectedProjectId}.`);
}

const couponSnapshot = await db.collection("coupons").doc(couponId).get();
if (!couponSnapshot.exists) {
  throw new Error("Promotion coupons/welcome10 introuvable.");
}

const coupon = {
  id: couponSnapshot.id,
  ...couponSnapshot.data(),
} as Coupon;

if (coupon.code !== "WELCOME10") {
  throw new Error(`Code promo inattendu pour ${couponId}: ${coupon.code}.`);
}

const bannersSnapshot = await db.collection("promoBanners").get();
const banners = bannersSnapshot.docs.map((entry) =>
  normalizePromoBanner({ id: entry.id, ...entry.data() } as PromoBanner),
);

const bannerInput = buildAssociatedPromoBannerInput({
  coupon,
  banners,
  title: coupon.label || coupon.code,
  message: couponDescription(coupon),
});

const bannerId = bannerInput.id || `banner-${couponId}`;
const bannerRef = db.collection("promoBanners").doc(bannerId);
const existingBanner = await bannerRef.get();

const payload = {
  title: bannerInput.title,
  message: bannerInput.message,
  type: bannerInput.type,
  placement: bannerInput.placement,
  placements: bannerInput.placements,
  isActive: false,
  startsAt: bannerInput.startsAt || "",
  endsAt: bannerInput.endsAt || "",
  priority: Number(bannerInput.priority || 10),
  buttonLabel: bannerInput.buttonLabel || "",
  buttonUrl: bannerInput.buttonUrl || "",
  linkedCouponId: coupon.id,
  linkedPromoCode: coupon.code,
  deletedLinkedCouponId: "",
  variant: bannerInput.variant || "promo",
  dismissible: bannerInput.dismissible === true,
  isArchived: false,
  isTemplate: false,
  updatedAt: FieldValue.serverTimestamp(),
  ...(existingBanner.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
};

await bannerRef.set(payload, { merge: true });

const finalSnapshot = await bannerRef.get();
const finalBanner = finalSnapshot.data() || {};

console.log(
  JSON.stringify(
    {
      projectId,
      wrote: `promoBanners/${bannerId}`,
      existedBefore: existingBanner.exists,
      couponUnchanged: `coupons/${couponId}`,
      fields: {
        title: finalBanner.title,
        message: finalBanner.message,
        type: finalBanner.type,
        placement: finalBanner.placement,
        placements: finalBanner.placements,
        linkedCouponId: finalBanner.linkedCouponId,
        linkedPromoCode: finalBanner.linkedPromoCode,
        isActive: finalBanner.isActive,
        isArchived: finalBanner.isArchived,
        isTemplate: finalBanner.isTemplate,
        variant: finalBanner.variant,
      },
    },
    null,
    2,
  ),
);

function couponDescription(coupon: Coupon) {
  if (coupon.promotionType === "threshold_extra_discount") {
    return `Offert apres seuil : ${formatEuro(
      Number(coupon.paidThresholdAmount || 0),
    )} EUR payes, jusqu'a ${formatEuro(Number(coupon.maxGiftAmount || 0))} EUR offerts.`;
  }
  const minimum = Number(coupon.minimumOrder || 0);
  const minimumText = minimum > 0 ? ` a partir de ${formatEuro(minimum)} EUR` : " sans minimum";
  return `${couponTypeLabel(coupon.discountType)} : ${couponValueLabel(coupon)}${minimumText}.`;
}

function couponTypeLabel(type: Coupon["discountType"]) {
  if (type === "fixed") return "Montant fixe";
  if (type === "free_shipping") return "Livraison postale offerte";
  return "Pourcentage";
}

function couponValueLabel(coupon: Pick<Coupon, "discountType" | "discountValue">) {
  if (coupon.discountType === "free_shipping") return "Livraison offerte";
  if (coupon.discountType === "fixed") return `${formatEuro(Number(coupon.discountValue || 0))} EUR`;
  return `${Number(coupon.discountValue || 0)} %`;
}

function formatEuro(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
