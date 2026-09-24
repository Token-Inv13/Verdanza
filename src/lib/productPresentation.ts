import type { Product, ProductCategory } from "../types";
import {
  isIntensityOnlyAroma,
  productIntensityLabels,
  productIntensityLevels,
  resolveProductIntensity,
  type ProductIntensity,
} from "./productTaxonomy";

export { resolveProductIntensity } from "./productTaxonomy";
export type { ProductIntensity } from "./productTaxonomy";

export type ProductCardPresentation = {
  categoryLabel: string;
  aromaProfile: string[];
  intensity: ProductIntensity;
  intensityLabel: string;
  intensityLevel: 1 | 2 | 3;
  appearance: string[];
};

export function productCategoryLabel(category: ProductCategory) {
  if (category === "flowers") return "Fleur CBD";
  if (category === "resins") return "Résine CBD";
  if (category === "oils") return "Huile CBD";
  return "Pack CBD";
}

export function resolveProductCardPresentation(product: Product): ProductCardPresentation {
  const intensity = resolveProductIntensity(product.aromas);
  const aromaProfile = product.aromas
    .filter((aroma) => !isIntensityOnlyAroma(aroma))
    .slice(0, 3);

  return {
    categoryLabel: productCategoryLabel(product.category),
    aromaProfile: aromaProfile.length ? aromaProfile : product.aromas.slice(0, 3),
    intensity,
    intensityLabel: productIntensityLabels[intensity],
    intensityLevel: productIntensityLevels[intensity],
    appearance: resolveProductAppearance(product),
  };
}

function resolveProductAppearance(product: Product) {
  const texture = String(product.texture || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (texture.length) return texture;
  if (product.cultureType && !["Autre", "A renseigner"].includes(product.cultureType)) {
    return [product.cultureType];
  }
  return product.origin ? [product.origin] : [];
}
