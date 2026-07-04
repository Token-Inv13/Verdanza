import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { collections } from "./collections";
import type { CustomerProfile } from "../types";

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
) {
  if (!db) throw new Error("Firebase is not configured.");
  const currentUser = auth?.currentUser;
  await updateDoc(doc(db, collections.customers, customer.id), {
    loyaltyPoints: increment(points),
    internalNote: note || customer.internalNote || "",
    updatedAt: serverTimestamp(),
  });
  try {
    await addDoc(collection(db, collections.loyaltyMovements), {
      customerId: customer.id,
      customerEmail: customer.email,
      points,
      reason: "admin_adjustment",
      note,
      createdAt: serverTimestamp(),
      createdBy: currentUser?.uid || "admin",
    });
  } catch (error) {
    console.warn("Unable to write loyalty movement", error);
  }
}

export async function updateCustomerInternalNote(customerId: string, internalNote: string) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.customers, customerId), {
    internalNote,
    updatedAt: serverTimestamp(),
  });
}
