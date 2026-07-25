export const PRODUCT_REFERENCE_PREFIX = "VDZ";

export function formatProductInternalReference(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Reference produit invalide.");
  }
  return `${PRODUCT_REFERENCE_PREFIX}-${String(value).padStart(6, "0")}`;
}

export function parseProductInternalReference(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^VDZ-(\d{6})$/);
  return match ? Number(match[1]) : null;
}

export function normalizeInternalReference(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
