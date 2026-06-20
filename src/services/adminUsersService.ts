import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { User } from "firebase/auth";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import type { AdminUser } from "../types";

export async function getAdminUserForAuthUser(user: User | null) {
  if (!db || !user?.email) return null;

  const byUid = await getDoc(doc(db, collections.adminUsers, user.uid));
  if (byUid.exists()) {
    return { id: byUid.id, ...byUid.data() } as AdminUser;
  }

  const byEmail = await getDoc(doc(db, collections.adminUsers, user.email));
  if (byEmail.exists()) {
    return { id: byEmail.id, ...byEmail.data() } as AdminUser;
  }

  return null;
}

export async function isAuthorizedAdmin(user: User | null) {
  const adminUser = await getAdminUserForAuthUser(user);
  return Boolean(adminUser?.isActive && adminUser.email === user?.email);
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
