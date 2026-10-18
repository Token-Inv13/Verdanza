import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import type { AdminUser } from "../types";
import type { User } from "firebase/auth";
import { isAdminRecordBoundToIdentity } from "../lib/adminBinding";

export async function getAdminUserForAuthUser(user: User | null) {
  if (!db || !user?.email) return null;

  try {
    const byUid = await getDoc(doc(db, collections.adminUsers, user.uid));
    if (byUid.exists()) {
      return { ...byUid.data(), id: byUid.id } as AdminUser;
    }

    if (user.emailVerified !== true) return null;
    const byEmail = await getDoc(doc(db, collections.adminUsers, user.email));
    if (byEmail.exists()) {
      return { ...byEmail.data(), id: byEmail.id } as AdminUser;
    }
  } catch (error) {
    console.warn("Admin lookup unavailable for current user", error);
  }

  return null;
}

export function isAdminRecordForAuthUser(record: AdminUser | null, user: User | null): boolean {
  if (!record || !user || !isAdminRecordBoundToIdentity(record, user)) return false;
  if (record.id === user.uid) return true;
  return user.emailVerified === true && record.id === user.email;
}

export async function isAuthorizedAdmin(user: User | null) {
  const adminUser = await getAdminUserForAuthUser(user);
  return isAdminRecordForAuthUser(adminUser, user);
}

export async function createAdminUserRecord(data: {
  uid?: string;
  email: string;
  role?: "admin" | "owner";
}) {
  if (!db) throw new Error("Firebase is not configured.");
  await setDoc(
    doc(db, collections.adminUsers, data.uid || data.email),
    {
      uid: data.uid || null,
      email: data.email,
      role: data.role || "admin",
      isActive: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
