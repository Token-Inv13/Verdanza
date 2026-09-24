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

const aromaFamilySignals: Record<ProductAromaFamily, string[]> = {
  fruite: ["fruite", "fruit", "mangue", "mango", "raisin", "pasteque", "exotique"],
  agrumes: ["agrume", "citron", "orange", "mandarine"],
  sucre: ["sucre", "sirupeux", "gourmand", "bonbon", "biscuit"],
  terreux: ["terreux"],
  epice: ["epice"],
  boise: ["boise", "sous-bois", "pin"],
};

export function resolveProductIntensity(aromas: string[]): ProductIntensity {
  const normalized = aromas.map(normalizeProductTaxonomyValue);
  if (normalized.some((aroma) => strongIntensitySignals.some((signal) => aroma.includes(signal)))) {
    return "fort";
  }
  if (normalized.some((aroma) => softIntensitySignals.some((signal) => aroma.includes(signal)))) {
    return "doux";
  }
  return "moyen";
}

export function resolveProductAromaFamilies(aromas: string[]): ProductAromaFamily[] {
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
