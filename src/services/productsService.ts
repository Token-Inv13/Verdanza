import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { products as localProducts } from "../data/products";
import { collections } from "./collections";
import type { Product } from "../types";

export type ProductInput = Omit<Product, "id"> & { id?: string };

export function getLocalProducts() {
  return localProducts;
}

export function normalizeProduct(product: Product): Product {
  return {
    ...product,
    compareAtPrice: product.compareAtPrice || undefined,
    lowStockThreshold: product.lowStockThreshold ?? 5,
  };
}

export async function getFirestoreProducts(activeOnly = true) {
  if (!db) return [];
  const productsQuery = activeOnly
    ? query(
        collection(db, collections.products),
        where("isActive", "==", true),
      )
    : collection(db, collections.products);
  const snapshot = await getDocs(productsQuery);
  return snapshot.docs
    .map((entry) =>
      normalizeProduct({ id: entry.id, ...(entry.data() as Omit<Product, "id">) }),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getAdminProductsWithFallback() {
  try {
    const firestoreProducts = await getFirestoreProducts(false);
    return {
      products: firestoreProducts.length ? firestoreProducts : getLocalProducts(),
      source: firestoreProducts.length ? ("firestore" as const) : ("local" as const),
    };
  } catch (error) {
    console.warn("Falling back to local admin products", error);
    return { products: getLocalProducts(), source: "local" as const };
  }
}

export async function getProductsWithFallback() {
  try {
    const firestoreProducts = await getFirestoreProducts();
    return {
      products: firestoreProducts.length ? firestoreProducts : getLocalProducts(),
      source: firestoreProducts.length ? ("firestore" as const) : ("local" as const),
    };
  } catch (error) {
    console.warn("Falling back to local products", error);
    return { products: getLocalProducts(), source: "local" as const };
  }
}

export async function upsertProduct(input: ProductInput) {
  if (!db) throw new Error("Firebase is not configured.");
  const id = input.id || input.slug;
  const productRef = doc(db, collections.products, id);
  const payload = {
    ...input,
    compareAtPrice: input.compareAtPrice || deleteField(),
    lowStockThreshold: input.lowStockThreshold ?? 5,
    updatedAt: serverTimestamp(),
  };
  await setDoc(productRef, payload, { merge: true });
  return id;
}

export async function updateProductFlags(
  productId: string,
  flags: Pick<Product, "isActive" | "isFeatured">,
) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.products, productId), {
    ...flags,
    updatedAt: serverTimestamp(),
  });
}

export async function updateProductStock(
  productId: string,
  stock: number,
  lowStockThreshold: number,
) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.products, productId), {
    stock,
    lowStockThreshold,
    updatedAt: serverTimestamp(),
  });
}

export async function seedInitialProducts() {
  if (!db) throw new Error("Firebase is not configured.");
  const database = db;
  const localIds = new Set(localProducts.map((product) => product.id));
  await Promise.all(
    localProducts.map((product) =>
      setDoc(
        doc(database, collections.products, product.id),
        {
          ...product,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    ),
  );

  const snapshot = await getDocs(collection(database, collections.products));
  const batch = writeBatch(database);
  let deactivated = 0;

  snapshot.docs.forEach((entry) => {
    if (!localIds.has(entry.id) && entry.data().isActive !== false) {
      batch.set(
        doc(database, collections.products, entry.id),
        {
          isActive: false,
          isFeatured: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      deactivated += 1;
    }
  });

  if (deactivated) await batch.commit();
  return { upserted: localProducts.length, deactivated };
}
