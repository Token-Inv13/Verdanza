import type { Product } from "../types";
import {
  hasAnyProductAromaFamily,
  productAromaFamilyValues,
  productIntensityValues,
  resolveProductAromaFamilies,
  resolveProductIntensity,
  type ProductAromaFamily,
  type ProductIntensity,
} from "./productTaxonomy";

export type ProductDiscoveryCategory = "all" | "flowers" | "resins";

export type ProductDiscoveryCriteria = {
  category: ProductDiscoveryCategory;
  intensity: ProductIntensity | null;
  aromas: ProductAromaFamily[];
};

export function createInitialProductDiscoveryCriteria(): ProductDiscoveryCriteria {
  return { category: "all", intensity: null, aromas: [] };
}

export function resolveProductDiscoveryProfile(product: Product) {
  return {
    category: product.category,
    intensity: resolveProductIntensity(product.aromas),
    aromaFamilies: resolveProductAromaFamilies(product.aromas),
  };
}

export function filterProductsByDiscoveryCriteria(
  products: Product[],
  criteria: ProductDiscoveryCriteria,
) {
  return products.filter((product) => {
    const profile = resolveProductDiscoveryProfile(product);
    if (criteria.category !== "all" && profile.category !== criteria.category) return false;
    if (criteria.intensity && profile.intensity !== criteria.intensity) return false;
    return hasAnyProductAromaFamily(profile.aromaFamilies, criteria.aromas);
  });
}

export function getAvailableProductIntensities(
  products: Product[],
  category: ProductDiscoveryCategory = "all",
) {
  return new Set(
    productIntensityValues.filter(
      (intensity) =>
        filterProductsByDiscoveryCriteria(products, {
          category,
          intensity,
          aromas: [],
        }).length > 0,
    ),
  );
}

export function getAvailableProductAromaFamilies(
  products: Product[],
  criteria: Pick<ProductDiscoveryCriteria, "category" | "intensity"> = {
    category: "all",
    intensity: null,
  },
) {
  const compatibleProducts = filterProductsByDiscoveryCriteria(products, {
    ...criteria,
    aromas: [],
  });
  const available = new Set(
    compatibleProducts.flatMap((product) => resolveProductAromaFamilies(product.aromas)),
  );
  return new Set(productAromaFamilyValues.filter((family) => available.has(family)));
}

export function reconcileProductDiscoveryCriteria(
  products: Product[],
  criteria: ProductDiscoveryCriteria,
): ProductDiscoveryCriteria {
  const availableIntensities = getAvailableProductIntensities(products, criteria.category);
  const intensity =
    criteria.intensity && availableIntensities.has(criteria.intensity)
      ? criteria.intensity
      : null;
  const availableAromas = getAvailableProductAromaFamilies(products, {
    category: criteria.category,
    intensity,
  });

  return {
    ...criteria,
    intensity,
    aromas: criteria.aromas.filter((aroma) => availableAromas.has(aroma)),
  };
}

export function hasProductDiscoveryCriteria(criteria: ProductDiscoveryCriteria) {
  return criteria.category !== "all" || Boolean(criteria.intensity) || criteria.aromas.length > 0;
}

export function hasCompleteProductDiscoveryCriteria(criteria: ProductDiscoveryCriteria) {
  return criteria.category !== "all" && criteria.intensity !== null;
}

export function parseProductDiscoverySearchParams(
  input: URLSearchParams | string,
): ProductDiscoveryCriteria {
  const searchParams =
    typeof input === "string"
      ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
      : input;
  const type = searchParams.get("type");
  const intensity = searchParams.get("intensity");
  const aromas = searchParams
    .getAll("aroma")
    .flatMap((value) => value.split(","))
    .filter((value): value is ProductAromaFamily =>
      productAromaFamilyValues.includes(value as ProductAromaFamily),
    );

  return {
    category: type === "flowers" || type === "resins" ? type : "all",
    intensity: productIntensityValues.includes(intensity as ProductIntensity)
      ? (intensity as ProductIntensity)
      : null,
    aromas: [...new Set(aromas)],
  };
}

export function createProductDiscoverySearchParams(criteria: ProductDiscoveryCriteria) {
  const searchParams = new URLSearchParams();
  if (criteria.category !== "all") searchParams.set("type", criteria.category);
  if (criteria.intensity) searchParams.set("intensity", criteria.intensity);
  for (const aroma of criteria.aromas) searchParams.append("aroma", aroma);
  return searchParams;
}

export function createProductDiscoveryPath(criteria: ProductDiscoveryCriteria) {
  const query = createProductDiscoverySearchParams(criteria).toString();
  return query ? `/boutique?${query}` : "/boutique";
}
