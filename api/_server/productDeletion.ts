import type { Product, ProductImageAsset } from "../../src/types/index.js";
import { isProductImageStoragePath } from "../../src/lib/productImages.js";

export type ProductDependencyCounts = {
  orders: number;
  invoices: number;
  supplierPurchases: number;
  stockMovements: number;
  productReviews: number;
};

export type ProductCleanupCounts = {
  favorites: number;
  productCosts: number;
  supplierProductAliases: number;
  coupons: number;
  productReferenceReservations: number;
};

export function hasBlockingProductDependencies(counts: ProductDependencyCounts) {
  return Object.values(counts).some((count) => count > 0);
}

export function productDependencyMessage(counts: ProductDependencyCounts) {
  if (!hasBlockingProductDependencies(counts)) return "";
  return [
    "Ce produit possede un historique et ne peut pas etre supprime definitivement.",
    "Desactivez-le pour le retirer de la boutique.",
  ].join(" ");
}

export function productStoragePathsForDeletion(product: Product) {
  const images = Array.isArray(product.images) ? product.images : [];
  return uniqueStrings(
    images
      .map((image: ProductImageAsset) => image.storagePath || "")
      .filter((path) => isProductImageStoragePath(path, product.id)),
  );
}

export function assertProductDeleteConfirmation(product: Product, confirmationReference: string) {
  const reference = String(product.internalReference || "").trim();
  if (!reference) throw new Error("Produit sans reference: suppression definitive refusee.");
  if (String(confirmationReference || "").trim() !== reference) {
    throw new Error("La reference saisie ne correspond pas au produit.");
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
