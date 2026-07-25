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
import { auth } from "../lib/firebase";
import { products as localProducts } from "../data/products";
import { logFirestoreFallback } from "../lib/clientLog";
import { collections } from "./collections";
import {
  fixedPriceOptionsForMode,
  normalizeFixedPriceMode,
  normalizeFixedPriceOptions,
} from "../lib/fixedPriceOptions";
import type { Product } from "../types";

export type ProductInput = Omit<Product, "id"> & { id?: string };

const legacyComingSoonLabelPattern = new RegExp(
  `(?:^|\\s+)${["En arrivage", "chez Verdanza"].join("\\s+")}\\s*[.!?]?`,
  "g",
);

export function getLocalProducts(activeOnly = true) {
  const products = localProducts.map(normalizeProduct);
  return activeOnly ? products.filter((product) => product.isActive !== false) : products;
}

export function normalizeProduct(product: Product): Product {
  const { comingSoon, stockStatus, stockLabel, ...normalized } = product as Product &
    Record<string, unknown>;
  void comingSoon;
  void stockStatus;
  void stockLabel;
  const sanitized = normalized as Product;

  return {
    ...sanitized,
    price: Number(sanitized.price || 0),
    compareAtPrice: Number(sanitized.compareAtPrice || 0) || undefined,
    stock: Math.max(0, Math.floor(Number(sanitized.stock || 0))),
    shortDescription: removeLegacyAvailabilityText(sanitized.shortDescription),
    longDescription: removeLegacyAvailabilityText(sanitized.longDescription),
    seoDescription: removeLegacyAvailabilityText(sanitized.seoDescription),
    fixedPriceMode: normalizeFixedPriceMode(sanitized.fixedPriceMode, sanitized.category),
    fixedPriceOptions: normalizeFixedPriceOptions(sanitized.fixedPriceOptions),
    qualitySealEnabled: sanitized.qualitySealEnabled === true,
    lowStockThreshold: Math.max(0, Math.floor(Number(sanitized.lowStockThreshold ?? 5))),
    isActive: sanitized.isActive !== false,
    isFeatured: sanitized.isFeatured === true,
  };
}

function removeLegacyAvailabilityText(value: string) {
  return value
    .replace(legacyComingSoonLabelPattern, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?])\1+/g, "$1")
    .replace(/([,;:])\1+/g, "$1")
    .replace(/([.!?])[,;:]+/g, "$1")
    .replace(/([,;:])+([.!?])/g, "$2")
    .replace(/\s{2,}/g, " ")
    .trim();
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
      products: firestoreProducts.length ? firestoreProducts : getLocalProducts(false),
      source: firestoreProducts.length ? ("firestore" as const) : ("local" as const),
    };
  } catch (error) {
    logFirestoreFallback("Falling back to local admin products", error);
    return { products: getLocalProducts(false), source: "local" as const };
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
    logFirestoreFallback("Falling back to local products", error);
    return { products: getLocalProducts(), source: "local" as const };
  }
}

export async function upsertProduct(input: ProductInput) {
  if (!db) throw new Error("Firebase is not configured.");
  const token = await auth?.currentUser?.getIdToken();
  if (token) {
    const response = await fetch("/api/invoices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "upsertProductAdmin", product: input }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      productId?: string;
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error || "Enregistrement produit impossible.");
    return payload.productId || input.id || input.slug;
  }
  const id = input.id || input.slug;
  const productRef = doc(db, collections.products, id);
  const payload = {
    ...input,
    fixedPriceMode: normalizeFixedPriceMode(input.fixedPriceMode, input.category),
    compareAtPrice: input.compareAtPrice || deleteField(),
    qualitySealEnabled: input.qualitySealEnabled === true,
    lowStockThreshold: input.lowStockThreshold ?? 5,
    updatedAt: serverTimestamp(),
  };
  payload.fixedPriceOptions = fixedPriceOptionsForMode(
    payload.fixedPriceMode,
    input.fixedPriceOptions,
  );
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
