import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import type { CustomerProfile } from "../types";

export async function ensureCustomerProfile(user: User) {
  if (!db || !user.email) return null;

  const customerRef = doc(db, collections.customers, user.uid);
  const snapshot = await getDoc(customerRef);
  const baseProfile = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || "",
    phone: user.phoneNumber || "",
    role: "customer" as const,
    loyaltyPoints: 0,
    orderCount: 0,
    totalSpent: 0,
  };

  if (!snapshot.exists()) {
    await setDoc(customerRef, {
      ...baseProfile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(
      customerRef,
      {
        email: user.email,
        displayName: snapshot.data().displayName || user.displayName || "",
        phone: snapshot.data().phone || user.phoneNumber || "",
        role: "customer",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  return getCustomerProfile(user.uid);
}

export async function getCustomerProfile(uid: string) {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, collections.customers, uid));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() } as CustomerProfile;
}

export async function updateCustomerProfile(
  uid: string,
  data: Pick<CustomerProfile, "displayName" | "phone">,
) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.customers, uid), {
    displayName: data.displayName,
    phone: data.phone,
    updatedAt: serverTimestamp(),
  });
  return getCustomerProfile(uid);
}
