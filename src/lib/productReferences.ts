export const PRODUCT_REFERENCE_PREFIX = "VDZ";
export const PRODUCT_REFERENCE_RANDOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PRODUCT_REFERENCE_RANDOM_LENGTH = 6;
export const PRODUCT_REFERENCE_CONFIRMATION = "verdanza-product-references-v2";

export const PRODUCT_REFERENCE_CATEGORY_CODES = {
  flowers: "FLR",
  resins: "RES",
  oils: "HUI",
  packs: "PCK",
} as const;

export const PRODUCT_REFERENCE_FALLBACK_CATEGORY_CODE = "AUT";
export const PRODUCT_REFERENCE_REGEX = /^VDZ-(FLR|RES|HUI|PCK|AUT)-[A-HJ-NP-Z2-9]{6}$/;
export const LEGACY_PRODUCT_REFERENCE_REGEX = /^VDZ-\d{6}$/;

export type ProductReferenceCategoryCode =
  | (typeof PRODUCT_REFERENCE_CATEGORY_CODES)[keyof typeof PRODUCT_REFERENCE_CATEGORY_CODES]
  | typeof PRODUCT_REFERENCE_FALLBACK_CATEGORY_CODE;

export function formatProductInternalReference(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Reference produit invalide.");
  }
  return `${PRODUCT_REFERENCE_PREFIX}-${String(value).padStart(6, "0")}`;
}

export function parseProductInternalReference(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(LEGACY_PRODUCT_REFERENCE_REGEX);
  if (!match) return null;
  const numberMatch = value.trim().match(/\d{6}$/);
  return numberMatch ? Number(numberMatch[0]) : null;
}

export function isLegacyProductInternalReference(value: unknown) {
  return typeof value === "string" && LEGACY_PRODUCT_REFERENCE_REGEX.test(value.trim().toUpperCase());
}

export function isProductInternalReference(value: unknown) {
  return typeof value === "string" && PRODUCT_REFERENCE_REGEX.test(value.trim().toUpperCase());
}

export function productReferenceCategoryCode(category: unknown): ProductReferenceCategoryCode {
  if (category === "flowers") return PRODUCT_REFERENCE_CATEGORY_CODES.flowers;
  if (category === "resins") return PRODUCT_REFERENCE_CATEGORY_CODES.resins;
  if (category === "oils") return PRODUCT_REFERENCE_CATEGORY_CODES.oils;
  if (category === "packs") return PRODUCT_REFERENCE_CATEGORY_CODES.packs;
  return PRODUCT_REFERENCE_FALLBACK_CATEGORY_CODE;
}

export function assertProductReferenceRandomCode(value: string) {
  if (value.length !== PRODUCT_REFERENCE_RANDOM_LENGTH) {
    throw new Error("Code reference produit invalide.");
  }
  for (const character of value) {
    if (!PRODUCT_REFERENCE_RANDOM_ALPHABET.includes(character)) {
      throw new Error("Code reference produit invalide.");
    }
  }
}

export function createProductInternalReference(
  category: unknown,
  randomCode: string,
) {
  const normalizedCode = randomCode.trim().toUpperCase();
  assertProductReferenceRandomCode(normalizedCode);
  return `${PRODUCT_REFERENCE_PREFIX}-${productReferenceCategoryCode(category)}-${normalizedCode}`;
}

export function parseProductReference(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = normalizeInternalReference(value);
  if (!PRODUCT_REFERENCE_REGEX.test(normalized)) return null;
  const [, categoryCode, randomCode] = normalized.split("-");
  return { categoryCode, randomCode };
}

export function normalizeInternalReference(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function normalizeLegacyInternalReferences(value: unknown) {
  const entries = Array.isArray(value) ? value : [];
  const normalized: string[] = [];
  for (const entry of entries) {
    const reference = normalizeInternalReference(entry);
    if (!isLegacyProductInternalReference(reference)) continue;
    if (!normalized.includes(reference)) normalized.push(reference);
  }
  return normalized;
}

export function withLegacyInternalReference(existing: unknown, legacyReference: unknown) {
  const references = normalizeLegacyInternalReferences(existing);
  const normalizedLegacy = normalizeInternalReference(legacyReference);
  if (
    isLegacyProductInternalReference(normalizedLegacy) &&
    !references.includes(normalizedLegacy)
  ) {
    references.push(normalizedLegacy);
  }
  return references;
}
