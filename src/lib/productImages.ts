import { BRAND_PRODUCT_PLACEHOLDER } from "./brandAssets.js";
import type { Product, ProductImageAsset } from "../types/index.js";

export const PRODUCT_IMAGE_MAX_COUNT = 3;
export const PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const PRODUCT_IMAGE_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type ProductImageValidationResult = {
  ok: boolean;
  errors: string[];
};

export function normalizeProductImages(
  product: Pick<Product, "id" | "name" | "image" | "imageAlt" | "images">,
): ProductImageAsset[] {
  const existing = Array.isArray(product.images) ? product.images : [];
  const baseImages = existing
    .filter((image) => image && typeof image.url === "string" && image.url.trim())
    .map((image, index) => ({
      id: sanitizeImageId(image.id) || `image-${index + 1}`,
      url: image.url.trim(),
      storagePath: sanitizeStoragePathValue(image.storagePath),
      alt: String(image.alt || product.imageAlt || `${product.name} Verdanza`).trim(),
      sortOrder: Number.isFinite(Number(image.sortOrder)) ? Number(image.sortOrder) : index,
      isPrimary: image.isPrimary === true,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .slice(0, PRODUCT_IMAGE_MAX_COUNT);

  if (!baseImages.length && product.image) {
    return [
      {
        id: "legacy-primary",
        url: product.image,
        alt: product.imageAlt || `${product.name} Verdanza`,
        sortOrder: 0,
        isPrimary: true,
      },
    ];
  }

  return ensureSinglePrimary(baseImages);
}

export function syncProductPrimaryImage<T extends Partial<Product>>(product: T): T {
  const images = normalizeProductImages({
    id: product.id || "",
    name: product.name || "Produit",
    image: product.image || "",
    imageAlt: product.imageAlt,
    images: product.images,
  });
  const primary = images.find((image) => image.isPrimary) || images[0];
  return {
    ...product,
    images,
    image: primary?.url || product.image || BRAND_PRODUCT_PLACEHOLDER,
    imageAlt: primary?.alt || product.imageAlt || product.name || "Produit Verdanza",
  };
}

export function ensureSinglePrimary(images: ProductImageAsset[]) {
  const sorted = images
    .slice(0, PRODUCT_IMAGE_MAX_COUNT)
    .map((image, index) => ({ ...image, sortOrder: index }))
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const primaryIndex = Math.max(0, sorted.findIndex((image) => image.isPrimary));
  return sorted.map((image, index) => ({
    ...image,
    isPrimary: index === primaryIndex,
    sortOrder: index,
  }));
}

export function validateProductImages(images: ProductImageAsset[]): ProductImageValidationResult {
  const errors: string[] = [];
  if (images.length > PRODUCT_IMAGE_MAX_COUNT) {
    errors.push(`Un produit ne peut pas contenir plus de ${PRODUCT_IMAGE_MAX_COUNT} images.`);
  }
  if (images.filter((image) => image.isPrimary).length > 1) {
    errors.push("Une seule image principale est autorisee.");
  }
  images.forEach((image, index) => {
    if (!image.url) errors.push(`Image ${index + 1}: URL requise.`);
    if (!image.alt.trim()) errors.push(`Image ${index + 1}: texte alternatif requis.`);
    if (image.storagePath && !isProductImageStoragePath(image.storagePath)) {
      errors.push(`Image ${index + 1}: chemin Storage invalide.`);
    }
  });
  return { ok: errors.length === 0, errors };
}

export function validateProductImagesForProduct(
  productId: string,
  images: ProductImageAsset[],
): ProductImageValidationResult {
  const base = validateProductImages(images);
  const errors = base.errors.slice();
  images.forEach((image, index) => {
    if (image.storagePath && !isProductImageStoragePath(image.storagePath, productId)) {
      errors.push(`Image ${index + 1}: le fichier Storage n'appartient pas a ce produit.`);
    }
  });
  return { ok: errors.length === 0, errors };
}

export function isProductImageStoragePath(path: string, productId?: string) {
  const normalized = sanitizeStoragePathValue(path);
  if (!normalized) return false;
  if (!/^products\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.webp$/.test(normalized)) return false;
  if (!productId) return true;
  return normalized.startsWith(`products/${productId}/`);
}

export function sanitizeImageId(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 80);
}

export function sanitizeStoragePathValue(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^\/+/, "");
}
