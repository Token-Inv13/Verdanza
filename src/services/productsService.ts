import {
  collection,
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
import { getFirebaseIdToken } from "../lib/firebaseAuth";
import { products as localProducts } from "../data/products";
import { logFirestoreFallback } from "../lib/clientLog";
import { collections } from "./collections";
import {
  normalizeFixedPriceMode,
  normalizeFixedPriceOptions,
} from "../lib/fixedPriceOptions";
import { normalizeLegacyInternalReferences } from "../lib/productReferences";
import { syncProductPrimaryImage } from "../lib/productImages";
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

  return syncProductPrimaryImage({
    ...sanitized,
    price: Number(sanitized.price || 0),
    compareAtPrice: Number(sanitized.compareAtPrice || 0) || undefined,
    stock: Math.max(0, Math.floor(Number(sanitized.stock || 0))),
    shortDescription: removeLegacyAvailabilityText(sanitized.shortDescription),
    longDescription: removeLegacyAvailabilityText(sanitized.longDescription),
    seoDescription: removeLegacyAvailabilityText(sanitized.seoDescription),
    fixedPriceMode: normalizeFixedPriceMode(sanitized.fixedPriceMode, sanitized.category),
    fixedPriceOptions: normalizeFixedPriceOptions(sanitized.fixedPriceOptions),
    legacyInternalReferences: normalizeLegacyInternalReferences(sanitized.legacyInternalReferences),
    qualitySealEnabled: sanitized.qualitySealEnabled === true,
    lowStockThreshold: Math.max(0, Math.floor(Number(sanitized.lowStockThreshold ?? 5))),
    isActive: sanitized.isActive !== false,
    isFeatured: sanitized.isFeatured === true,
  });
}

function productImagesWithLocalFallback(product: Product) {
  const currentImages = Array.isArray(product.images) ? product.images : [];
  if (currentImages.length > 1) return currentImages;

  const localGallery = localProducts.find((entry) => entry.id === product.id)?.images || [];
  if (localGallery.length <= 1) return currentImages;

  const localPrimary = localGallery.find((image) => image.isPrimary) || localGallery[0];
  const currentPrimary = currentImages[0] || {
    id: "catalog-primary",
    url: product.image,
    alt: product.imageAlt || `${product.name} Verdanza`,
    sortOrder: 0,
    isPrimary: true,
  };
  const additionalImages = localGallery.filter(
    (image) => image.url !== localPrimary?.url && image.url !== currentPrimary.url,
  );

  return [
    { ...currentPrimary, sortOrder: 0, isPrimary: true },
    ...additionalImages.map((image, index) => ({
      ...image,
      sortOrder: index + 1,
      isPrimary: false,
    })),
  ];
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
    .map((entry) => {
      const firestoreProduct = {
        id: entry.id,
        ...(entry.data() as Omit<Product, "id">),
      };
      return normalizeProduct(
        activeOnly
          ? {
              ...firestoreProduct,
              images: productImagesWithLocalFallback(firestoreProduct),
            }
          : firestoreProduct,
      );
    })
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
  const token = await getFirebaseIdToken();
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
  throw new Error("Session admin requise pour enregistrer un produit via l'API securisee.");
}

export async function deleteProductAdmin(input: {
  productId: string;
  confirmationReference: string;
}) {
  if (!db) throw new Error("Firebase is not configured.");
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Session admin requise.");
  const response = await fetch("/api/invoices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: "deleteProductAdmin",
      productId: input.productId,
      confirmationReference: input.confirmationReference,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    deletedProductId?: string;
    blocked?: boolean;
    dependencies?: Record<string, number>;
    cleaned?: Record<string, number>;
    storage?: { deleted: number; failed: string[] };
    error?: string;
  };
  if (!response.ok) {
    const details = payload.dependencies
      ? Object.entries(payload.dependencies)
          .filter(([, count]) => count > 0)
          .map(([label, count]) => `${label}: ${count}`)
          .join(", ")
      : "";
    throw new Error(
      details
        ? `${payload.error || "Suppression produit impossible."} (${details})`
        : payload.error || "Suppression produit impossible.",
    );
  }
  return payload;
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
