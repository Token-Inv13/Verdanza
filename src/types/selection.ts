export const selectionStatuses = [
  "À explorer", "À commander", "À tester", "Testé", "Retenu", "En boutique", "Écarté",
] as const;
export const selectionPriorities = ["Haute", "Moyenne", "Basse"] as const;
export const selectionCategories = ["Fleur", "Résine", "Autre"] as const;
export const selectionIntensities = ["douce", "moyenne", "forte"] as const;
export const selectionAromaFamilies = ["fruite", "agrumes", "sucre", "terreux", "epice", "boise"] as const;

export type SelectionStatus = typeof selectionStatuses[number];
export type SelectionPriority = typeof selectionPriorities[number];
export type SelectionCategory = typeof selectionCategories[number];
export type SelectionIntensity = typeof selectionIntensities[number];
export type SelectionAromaFamily = typeof selectionAromaFamilies[number];

export type SelectionPrice = { format: string; price: string };
export type ProductSelection = {
  id: string;
  name: string;
  publicName: string;
  url: string;
  supplier: string;
  category: SelectionCategory;
  molecule: string;
  rate: string;
  origin: string;
  culture: string;
  description: string;
  taste: string;
  aromas: string;
  intensity: SelectionIntensity | "";
  aromaFamily: SelectionAromaFamily | "";
  appearance: string;
  imageUrl: string;
  imagePath: string;
  status: SelectionStatus;
  priority: SelectionPriority;
  notes: string;
  attributes: Record<string, string>;
  rating: number;
  prices: SelectionPrice[];
  importedAt: string;
  updatedAt: string;
  publishedAt: string;
  publishedSlug: string;
  catalogProductId: string;
};

export function emptySelection(): ProductSelection {
  return {
    id: "", name: "", publicName: "", url: "", supplier: "", category: "Autre",
    molecule: "", rate: "", origin: "", culture: "", description: "", taste: "",
    aromas: "", intensity: "", aromaFamily: "", appearance: "", imageUrl: "",
    imagePath: "", status: "À explorer", priority: "Moyenne", notes: "", attributes: {}, rating: 0,
    prices: [], importedAt: "", updatedAt: "", publishedAt: "", publishedSlug: "",
    catalogProductId: "",
  };
}

export function normalizeSelection(raw: unknown): ProductSelection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Produit invalide.");
  const value = raw as Record<string, unknown>;
  const text = (key: string, max = 2000) => String(value[key] ?? "").trim().slice(0, max);
  const oneOf = <T extends string>(key: string, options: readonly T[], fallback: T) =>
    options.includes(value[key] as T) ? value[key] as T : fallback;
  const prices = Array.isArray(value.prices)
    ? value.prices.slice(0, 40).map((row) => {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return { format: String(item.format ?? "").trim().slice(0, 120), price: String(item.price ?? "").trim().slice(0, 32) };
    }).filter((row) => row.format || row.price)
    : [];
  const url = text("url", 1000);
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new Error("Lien fournisseur invalide.");
  const imageUrl = text("imageUrl", 1000);
  if (imageUrl && !/^https?:\/\/[^\s]+$/i.test(imageUrl)) throw new Error("Lien image invalide.");
  const rating = Number(value.rating);
  const attributes: Record<string, string> = {};
  if (value.attributes && typeof value.attributes === "object" && !Array.isArray(value.attributes)) {
    for (const [key, detail] of Object.entries(value.attributes as Record<string, unknown>).slice(0, 30)) {
      if (typeof detail === "string" && key.trim()) attributes[key.trim().slice(0, 80)] = detail.trim().slice(0, 500);
    }
  }
  return {
    id: text("id", 100), name: text("name", 180), publicName: text("publicName", 100),
    url, supplier: text("supplier", 120), category: oneOf("category", selectionCategories, "Autre"),
    molecule: text("molecule", 100), rate: text("rate", 60), origin: text("origin", 100),
    culture: text("culture", 100), description: text("description"), taste: text("taste", 500),
    aromas: text("aromas", 300), intensity: oneOf("intensity", [...selectionIntensities, ""] as const, ""),
    aromaFamily: oneOf("aromaFamily", [...selectionAromaFamilies, ""] as const, ""),
    appearance: text("appearance", 300), imageUrl, imagePath: text("imagePath", 300),
    status: oneOf("status", selectionStatuses, "À explorer"),
    priority: oneOf("priority", selectionPriorities, "Moyenne"),
    notes: text("notes", 4000), attributes, rating: Number.isFinite(rating) ? Math.min(5, Math.max(0, rating)) : 0,
    prices, importedAt: text("importedAt", 40), updatedAt: text("updatedAt", 40),
    publishedAt: text("publishedAt", 40), publishedSlug: text("publishedSlug", 100),
    catalogProductId: text("catalogProductId", 100),
  };
}

export function selectionPublicName(item: ProductSelection) {
  return item.publicName.trim() || item.name.split(/\s+[–—-]\s+/)[0].trim();
}

export function selectionSlug(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function publicationMissing(item: ProductSelection) {
  const missing: string[] = [];
  if (item.status !== "En boutique") missing.push("étape En boutique");
  if (item.category !== "Fleur" && item.category !== "Résine") missing.push("type Fleur ou Résine");
  if (!selectionPublicName(item)) missing.push("nom public");
  if (!item.taste) missing.push("goût");
  if (!item.aromas) missing.push("arômes");
  if (!item.intensity) missing.push("intensité");
  if (!item.aromaFamily) missing.push("famille aromatique");
  if (!item.appearance) missing.push("aspect");
  if (!item.imagePath) missing.push("image Verdanza");
  return missing;
}

export function gramsInSelectionFormat(format: string): number | null {
  const value = format.toLowerCase().replace(/\u00a0/g, " ");
  if (/\d+(?:[,.]\d+)?\s*[x×]\s*\d+(?:[,.]\d+)?\s*(?:kg|grammes?|gr|g)\b/.test(value)
    || /\d+(?:[,.]\d+)?\s*(?:kg|grammes?|gr|g)\s*[x×]\s*\d+/i.test(value)) return null;
  const rows = [...value.matchAll(/(\d+(?:[,.]\d+)?)\s*(kg|grammes?|gr|g)\b/g)]
    .map((match) => ({ quantity: Number(match[1].replace(",", ".")) * (match[2] === "kg" ? 1000 : 1), index: match.index ?? 0 }));
  if (!rows.length || rows.length > 2 || rows.some((row) => !Number.isFinite(row.quantity) || row.quantity <= 0)) return null;
  if (rows.length === 2 && !/offert|gratuit|bonus/.test(value.slice(rows[0].index + 1))) return null;
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

export function costPerGram(row: SelectionPrice): number | null {
  const grams = gramsInSelectionFormat(row.format);
  const price = Number(row.price.replace(",", "."));
  return grams && Number.isFinite(price) && price > 0 ? price / grams : null;
}
