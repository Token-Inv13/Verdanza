import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import type { Coupon } from "../types";
import {
  normalizeGiftTiers,
  validateTieredProductGift,
} from "../lib/tieredProductGifts";

export type CouponInput = Omit<Coupon, "id" | "usedCount" | "createdAt" | "updatedAt"> & {
  id?: string;
  usedCount?: number;
};

type CouponWriteOptions = {
  includeCreatedAt?: boolean;
  clearMissingOptionalFields?: boolean;
};

export async function getCouponsWithFallback() {
  if (!db) return { coupons: [], source: "empty" as const };
  try {
    const snapshot = await getDocs(
      query(collection(db, collections.coupons), orderBy("code", "asc")),
    );
    const coupons = snapshot.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as Coupon,
    );
    return {
      coupons,
      source: coupons.length ? ("firestore" as const) : ("empty" as const),
    };
  } catch (error) {
    console.warn("Unable to load Firestore coupons", error);
    return { coupons: [], source: "empty" as const };
  }
}

export async function upsertCoupon(input: CouponInput) {
  if (!db) throw new Error("Firebase is not configured.");
  const code = normalizeCouponCode(input.code);
  if (!code) throw new Error("Code promo requis.");
  const giftIssues = validateTieredProductGift(input);
  if (giftIssues.length) throw new Error(giftIssues[0]);
  const couponId = input.id || code.toLowerCase();
  const couponRef = doc(db, collections.coupons, couponId);
  const existing = await getDoc(couponRef);
  const couponPayload = buildCouponWritePayload(input, {
    includeCreatedAt: !existing.exists(),
    clearMissingOptionalFields: existing.exists(),
  });

  if (existing.exists()) {
    await updateDoc(couponRef, couponPayload);
    return;
  }

  await setDoc(couponRef, couponPayload);
}

export function buildCouponWritePayload(
  input: CouponInput,
  options: CouponWriteOptions = {},
) {
  const code = normalizeCouponCode(input.code);
  const clearValue = options.clearMissingOptionalFields ? deleteField() : undefined;
  const payload = stripUndefinedFields({
    code,
    label: input.label || code,
    discountType: input.discountType,
    discountValue: Number(input.discountValue || 0),
    minimumOrder: Number(input.minimumOrder || 0),
    autoApply: input.autoApply === true,
    promotionType: input.promotionType || clearValue,
    eligibleCategory: input.eligibleCategory || clearValue,
    minEligibleSubtotal: Number(input.minEligibleSubtotal || 0),
    paidThresholdAmount: Number(input.paidThresholdAmount || 0),
    maxGiftAmount: Number(input.maxGiftAmount || 0),
    maxDiscountAmount: input.maxDiscountAmount
      ? Number(input.maxDiscountAmount)
      : clearValue,
    stackable: input.stackable === true,
    priority: Number(input.priority || 10),
    maxUses: input.maxUses ? Number(input.maxUses) : clearValue,
    usedCount: Number(input.usedCount || 0),
    startsAt: input.startsAt || clearValue,
    endsAt: input.endsAt || clearValue,
    isActive: Boolean(input.isActive),
    productIds: input.productIds ?? [],
    categories: input.categories ?? [],
    giftTiers:
      input.promotionType === "tiered_product_gift"
        ? normalizeGiftTiers(input.giftTiers || [])
        : clearValue,
    giftProductIds:
      input.promotionType === "tiered_product_gift" ? input.giftProductIds ?? [] : clearValue,
    giftSelectionMode:
      input.promotionType === "tiered_product_gift"
        ? input.giftSelectionMode || "customer_choice"
        : clearValue,
    defaultGiftProductId:
      input.promotionType === "tiered_product_gift"
        ? input.defaultGiftProductId || clearValue
        : clearValue,
    qualifyingScope:
      input.promotionType === "tiered_product_gift"
        ? input.qualifyingScope || "cart_subtotal"
        : clearValue,
    qualifyingCategories:
      input.promotionType === "tiered_product_gift"
        ? input.qualifyingCategories ?? []
        : clearValue,
    qualifyingProductIds:
      input.promotionType === "tiered_product_gift"
        ? input.qualifyingProductIds ?? []
        : clearValue,
    isArchived: input.isArchived === true,
    isTemplate: input.isTemplate === true,
    internalNote: input.internalNote || clearValue,
    updatedAt: serverTimestamp(),
    ...(options.includeCreatedAt ? { createdAt: serverTimestamp() } : {}),
  });

  return payload;
}

function stripUndefinedFields<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

export async function updateCouponStatus(couponId: string, isActive: boolean) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.coupons, couponId), {
    isActive,
    updatedAt: serverTimestamp(),
  });
}

export async function archiveCoupon(couponId: string) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.coupons, couponId), {
    isActive: false,
    isArchived: true,
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCouponAndNeutralizeBannerLinks(coupon: Pick<Coupon, "id" | "code">) {
  if (!db) throw new Error("Firebase is not configured.");
  const batch = writeBatch(db);
  const linkedById = await getDocs(
    query(collection(db, collections.promoBanners), where("linkedCouponId", "==", coupon.id)),
  );
  const linkedByCode = coupon.code
    ? await getDocs(
        query(collection(db, collections.promoBanners), where("linkedPromoCode", "==", coupon.code)),
      )
    : null;
  const bannerRefs = new Map<string, ReturnType<typeof doc>>();
  linkedById.docs.forEach((entry) => bannerRefs.set(entry.id, entry.ref as ReturnType<typeof doc>));
  linkedByCode?.docs.forEach((entry) => bannerRefs.set(entry.id, entry.ref as ReturnType<typeof doc>));

  batch.delete(doc(db, collections.coupons, coupon.id));
  bannerRefs.forEach((bannerRef) => {
    batch.update(bannerRef, {
      linkedCouponId: coupon.id,
      deletedLinkedCouponId: coupon.id,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

export function normalizeCouponCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}
