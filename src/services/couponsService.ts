import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import type { Coupon } from "../types";

export type CouponInput = Omit<Coupon, "id" | "usedCount" | "createdAt" | "updatedAt"> & {
  id?: string;
  usedCount?: number;
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
  const couponId = input.id || code.toLowerCase();

  await setDoc(
    doc(db, collections.coupons, couponId),
    {
      ...input,
      code,
      label: input.label || code,
      discountValue: Number(input.discountValue || 0),
      minimumOrder: Number(input.minimumOrder || 0),
      maxUses: input.maxUses || undefined,
      usedCount: Number(input.usedCount || 0),
      isActive: Boolean(input.isActive),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
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

export function normalizeCouponCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}
