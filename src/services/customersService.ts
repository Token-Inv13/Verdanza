import { doc, getDoc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import type { CustomerProfile } from "../types";

/** Only call after an explicit registration or profile-save action. Existing
 * profiles are preserved, including when another creation wins the transaction. */
export async function createCustomerProfileIfMissing(user: User) {
  if (!db || !user.email) return null;

  const customerRef = doc(db, collections.customers, user.uid);
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

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(customerRef);
    if (!snapshot.exists()) {
      transaction.set(customerRef, {
        ...baseProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });

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
