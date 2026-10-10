export const productIntensityValues = ["doux", "moyen", "fort"] as const;

export type ProductIntensity = (typeof productIntensityValues)[number];

export const productIntensityLabels: Record<ProductIntensity, string> = {
  doux: "Doux",
  moyen: "Moyen",
  fort: "Fort",
};

export const productIntensityLevels: Record<ProductIntensity, 1 | 2 | 3> = {
  doux: 1,
  moyen: 2,
  fort: 3,
};

const productIntensityAliases: Record<string, ProductIntensity> = {
  doux: "doux",
  douce: "doux",
  moyen: "moyen",
  moyenne: "moyen",
  fort: "fort",
  forte: "fort",
};

export function parseProductIntensity(value: unknown): ProductIntensity | null {
  if (typeof value !== "string") return null;
  return productIntensityAliases[normalizeProductTaxonomyValue(value)] ?? null;
}

export const productAromaFamilyValues = [
  "fruite",
  "agrumes",
  "sucre",
  "terreux",
  "epice",
  "boise",
] as const;

export type ProductAromaFamily = (typeof productAromaFamilyValues)[number];

export const productAromaFamilyLabels: Record<ProductAromaFamily, string> = {
  fruite: "Fruité",
  agrumes: "Agrumes",
  sucre: "Sucré",
  terreux: "Terreux",
  epice: "Épicé",
  boise: "Boisé",
};

const strongIntensitySignals = ["intense", "puissant", "profond", "tonique", "prononce"];
const softIntensitySignals = ["leger", "delicat", "doux", "subtil"];
const intensityOnlySignals = new Set([...strongIntensitySignals, ...softIntensitySignals]);

// Reviewed storefront intensities, including prepared inactive products.
// Unknown products still use aroma-based inference until reviewed.
const storefrontIntensityBySlug: Partial<Record<string, ProductIntensity>> = {
  "blue-dream-cbd": "doux",
  "cookie-kush-indoor": "doux",
  "golden-static": "doux",
  "harlequin-greenhouse": "doux",
  "mandarine-cbd": "doux",
  "mango-haze-cbd": "doux",
  "petites-tetes-og-kush": "doux",
  "skittlez-plus": "fort",
  "black-afghan": "moyen",
  "ice-o-lator": "moyen",
  "mousseux-skywalker": "fort",
  "supreme-50-cbd": "doux",
};

const storefrontAromaFamiliesBySlug: Partial<Record<string, ProductAromaFamily[]>> = {
  "skittlez-plus": ["agrumes", "sucre", "fruite"],
  "black-afghan": ["terreux", "sucre", "fruite"],
  "ice-o-lator": ["fruite", "epice", "sucre"],
  "mousseux-skywalker": ["boise", "agrumes", "epice"],
};

const aromaFamilySignals: Record<ProductAromaFamily, string[]> = {
  fruite: ["fruite", "fruit", "mangue", "mango", "raisin", "pasteque", "exotique"],
  agrumes: ["agrume", "citron", "orange", "mandarine"],
  sucre: ["sucre", "sirupeux", "gourmand", "bonbon", "biscuit"],
  terreux: ["terreux"],
  epice: ["epice"],
  boise: ["boise", "sous-bois", "pin"],
};

export function resolveProductIntensity(aromas: string[], slug?: string): ProductIntensity {
  if (slug && storefrontIntensityBySlug[slug]) return storefrontIntensityBySlug[slug];
  const normalized = aromas.map(normalizeProductTaxonomyValue);
  if (normalized.some((aroma) => strongIntensitySignals.some((signal) => aroma.includes(signal)))) {
    return "fort";
  }
  if (normalized.some((aroma) => softIntensitySignals.some((signal) => aroma.includes(signal)))) {
    return "doux";
  }
  return "moyen";
}

export function resolveProductAromaFamilies(aromas: string[], slug?: string): ProductAromaFamily[] {
  if (slug && storefrontAromaFamiliesBySlug[slug]) return [...storefrontAromaFamiliesBySlug[slug]];
  const normalized = aromas.map(normalizeProductTaxonomyValue);
  return productAromaFamilyValues.filter((family) =>
    normalized.some((aroma) =>
      aromaFamilySignals[family].some((signal) => aroma.includes(signal)),
    ),
  );
}

export function isIntensityOnlyAroma(aroma: string) {
  return intensityOnlySignals.has(normalizeProductTaxonomyValue(aroma));
}

export function hasAnyProductAromaFamily(
  candidateFamilies: readonly ProductAromaFamily[],
  selectedFamilies: readonly ProductAromaFamily[],
) {
  return selectedFamilies.length === 0 ||
    selectedFamilies.some((family) => candidateFamilies.includes(family));
}

export function normalizeProductTaxonomyValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}
