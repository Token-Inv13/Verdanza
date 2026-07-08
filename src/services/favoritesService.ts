import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { Product, ProductFavorite } from "../types";
import { collections } from "./collections";

export type FavoriteProductStat = {
  productId: string;
  productName: string;
  productCategory: Product["category"];
  count: number;
};

export function favoriteDocumentId(userId: string, productId: string) {
  return `${userId}_${productId}`;
}

export async function getUserFavorites(userId: string) {
  if (!db) return [];
  const snapshot = await getDocs(
    query(collection(db, collections.favorites), where("userId", "==", userId)),
  );
  return snapshot.docs.map(
    (entry) => ({ id: entry.id, ...entry.data() }) as ProductFavorite,
  );
}

export async function addFavorite(userId: string, product: Product) {
  if (!db) throw new Error("Service temporairement indisponible.");
  const id = favoriteDocumentId(userId, product.id);
  await setDoc(doc(db, collections.favorites, id), {
    userId,
    productId: product.id,
    productName: product.name,
    productCategory: product.category,
    productImage: product.image,
    createdAt: serverTimestamp(),
  });
}

export async function removeFavorite(userId: string, productId: string) {
  if (!db) throw new Error("Service temporairement indisponible.");
  await deleteDoc(
    doc(db, collections.favorites, favoriteDocumentId(userId, productId)),
  );
}

export async function getAdminFavoriteStats() {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, collections.favorites));
  const stats = new Map<string, FavoriteProductStat>();
  snapshot.docs.forEach((entry) => {
    const favorite = entry.data() as ProductFavorite;
    const current = stats.get(favorite.productId);
    stats.set(favorite.productId, {
      productId: favorite.productId,
      productName: favorite.productName,
      productCategory: favorite.productCategory,
      count: (current?.count || 0) + 1,
    });
  });
  return [...stats.values()].sort((left, right) => right.count - left.count);
}
