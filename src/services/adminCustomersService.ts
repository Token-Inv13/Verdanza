import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { collections } from "./collections";
import type {
  Coupon,
  CustomerAssignedPromo,
  CustomerLoyaltyHistoryEntry,
  CustomerProfile,
  LoyaltyMovement,
  ProductFavorite,
  ProductReview,
} from "../types";

export type CustomerAdminDetails = {
  loyaltyMovements: LoyaltyMovement[];
  favorites: ProductFavorite[];
  reviews: ProductReview[];
};

export async function getAdminCustomersWithFallback() {
  if (!db) return { customers: [], source: "empty" as const };
  try {
    const snapshot = await getDocs(
      query(collection(db, collections.customers), orderBy("updatedAt", "desc")),
    );
    const customers = snapshot.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as CustomerProfile,
    );
    return {
      customers,
      source: customers.length ? ("firestore" as const) : ("empty" as const),
    };
  } catch (error) {
    console.warn("Unable to load Firestore customers", error);
    return { customers: [], source: "empty" as const };
  }
}

export async function adjustCustomerLoyalty(
  customer: CustomerProfile,
  points: number,
  note: string,
  mode: "add" | "remove" | "set" = "add",
  reason = "admin_adjustment",
) {
  if (!db) throw new Error("Firebase is not configured.");
  const currentUser = auth?.currentUser;
  const currentBalance = Number(customer.loyaltyPoints || 0);
  const nextBalance = mode === "set"
    ? Math.max(0, points)
    : Math.max(0, currentBalance + points);
  const delta = nextBalance - currentBalance;
  const historyEntry: CustomerLoyaltyHistoryEntry = {
    type: mode,
    points: mode === "set" ? nextBalance : Math.abs(delta),
    previousBalance: currentBalance,
    nextBalance,
    reason,
    note,
    createdAt: new Date().toISOString(),
    createdBy: currentUser?.email || currentUser?.uid || "admin",
  };
  await updateDoc(doc(db, collections.customers, customer.id), {
    loyaltyPoints: mode === "set" ? nextBalance : increment(delta),
    loyaltyHistory: arrayUnion(historyEntry),
    internalNote: note || customer.internalNote || "",
    updatedAt: serverTimestamp(),
  });
  try {
    await addDoc(collection(db, collections.loyaltyMovements), {
      customerId: customer.id,
      customerEmail: customer.email,
      points: delta,
      reason,
      note,
      createdAt: serverTimestamp(),
      createdBy: currentUser?.email || currentUser?.uid || "admin",
    });
  } catch (error) {
    console.warn("Unable to write loyalty movement", error);
  }
}

export async function updateCustomerInternalNote(customerId: string, internalNote: string) {
  if (!db) throw new Error("Firebase is not configured.");
  const currentUser = auth?.currentUser;
  const updatePayload = {
    internalNote,
    updatedAt: serverTimestamp(),
    ...(internalNote.trim()
      ? {
          internalNotes: arrayUnion({
            note: internalNote.trim(),
            isImportant: false,
            createdAt: new Date().toISOString(),
            createdBy: currentUser?.email || currentUser?.uid || "admin",
          }),
        }
      : {}),
  };
  await updateDoc(doc(db, collections.customers, customerId), updatePayload);
}

export async function updateCustomerAdminStatus(
  customerId: string,
  data: { status?: CustomerProfile["status"]; archived?: boolean; hidden?: boolean },
) {
  if (!db) throw new Error("Firebase is not configured.");
  const currentUser = auth?.currentUser;
  const now = serverTimestamp();
  await updateDoc(doc(db, collections.customers, customerId), {
    ...data,
    archivedAt: data.archived ? now : null,
    archivedBy: data.archived ? currentUser?.email || currentUser?.uid || "admin" : null,
    hiddenAt: data.hidden ? now : null,
    hiddenBy: data.hidden ? currentUser?.email || currentUser?.uid || "admin" : null,
    updatedAt: now,
  });
}

export async function assignPromoToCustomer(
  customer: CustomerProfile,
  coupon: Coupon,
  note: string,
) {
  if (!db) throw new Error("Firebase is not configured.");
  const currentUser = auth?.currentUser;
  const assignment: CustomerAssignedPromo = {
    code: coupon.code,
    couponId: coupon.id,
    label: coupon.label,
    note,
    isActive: true,
    assignedAt: new Date().toISOString(),
    assignedBy: currentUser?.email || currentUser?.uid || "admin",
  };
  await updateDoc(doc(db, collections.customers, customer.id), {
    assignedPromos: arrayUnion(assignment),
    updatedAt: serverTimestamp(),
  });
}

export async function getCustomerAdminDetails(customer: CustomerProfile): Promise<CustomerAdminDetails> {
  if (!db) return { loyaltyMovements: [], favorites: [], reviews: [] };
  const [loyaltySnapshot, favoritesSnapshot, reviewsByUserSnapshot] =
    await Promise.all([
      getDocs(
        query(
          collection(db, collections.loyaltyMovements),
          where("customerId", "==", customer.id),
        ),
      ),
      getDocs(
        query(collection(db, collections.favorites), where("userId", "==", customer.uid || customer.id)),
      ),
      getDocs(
        query(collection(db, collections.productReviews), where("userId", "==", customer.uid || customer.id)),
      ),
    ]);
  const reviewsByEmailSnapshot = customer.email
    ? await getDocs(
        query(collection(db, collections.productReviews), where("customerEmail", "==", customer.email)),
      )
    : null;

  const reviewMap = new Map<string, ProductReview>();
  [...reviewsByUserSnapshot.docs, ...(reviewsByEmailSnapshot?.docs || [])].forEach((entry) => {
    reviewMap.set(entry.id, { id: entry.id, ...entry.data() } as ProductReview);
  });

  return {
    loyaltyMovements: loyaltySnapshot.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as LoyaltyMovement,
    ),
    favorites: favoritesSnapshot.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as ProductFavorite,
    ),
    reviews: [...reviewMap.values()].sort(
      (left, right) => dateValue(right.createdAt) - dateValue(left.createdAt),
    ),
  };
}

function dateValue(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") return Date.parse(value) || 0;
  if (value && typeof value === "object" && "seconds" in value) {
    return Number((value as { seconds?: number }).seconds || 0) * 1000;
  }
  return 0;
}
