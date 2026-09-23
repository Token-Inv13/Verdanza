import type { Product } from "../types/index.js";
import type { ProductSelection } from "../types/selection.js";
import { selectionPublicName, selectionSlug } from "../types/selection.js";

export type SelectionCatalogInput = {
  price: number;
  stock: number;
  description: string;
};

export function catalogPublicationMissing(item: ProductSelection) {
  const missing: string[] = [];
  if (item.status !== "En boutique") missing.push("étape En boutique");
  if (item.category !== "Fleur" && item.category !== "Résine") missing.push("type Fleur ou Résine");
  if (!selectionPublicName(item)) missing.push("nom public");
  if (!item.imagePath) missing.push("image Verdanza");
  if (!item.origin) missing.push("provenance");
  if (!item.taste) missing.push("goût");
  if (!item.aromas) missing.push("arômes");
  if (!item.intensity) missing.push("intensité");
  return missing;
}

export function normalizeCatalogInput(raw: unknown): SelectionCatalogInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Données boutique invalides.");
  const value = raw as Record<string, unknown>;
  const price = Number(value.price);
  const stock = Number(value.stock);
  const description = String(value.description || "").trim();
  if (!Number.isFinite(price) || price <= 0 || price > 1000 || Math.abs(Math.round(price * 100) - price * 100) > 1e-8) {
    throw new Error("Indiquez un prix de vente par gramme positif, avec deux décimales maximum.");
  }
  if (!Number.isSafeInteger(stock) || stock < 1 || stock > 100_000) {
    throw new Error("Indiquez un stock disponible en grammes (entier positif).");
  }
  if (description.length < 30 || description.length > 1000) {
    throw new Error("Rédigez une description boutique de 30 à 1 000 caractères.");
  }
  return { price, stock, description };
}

export function catalogProductId(selectionId: string) {
  return `selection-${selectionId}`;
}

export function buildCatalogProduct(item: ProductSelection, input: SelectionCatalogInput): Product & { sourceSelectionId: string } {
  const missing = catalogPublicationMissing(item);
  if (missing.length) throw new Error(`Complétez la sélection : ${missing.join(", ")}.`);
  const id = catalogProductId(item.id);
  const name = selectionPublicName(item);
  const category = item.category === "Fleur" ? "flowers" : "resins";
  const slug = `${selectionSlug(name) || "produit"}-${item.id.slice(0, 8)}`;
  const image = `/api/selection?action=catalogImage&id=${encodeURIComponent(item.id)}`;
  const aromas = item.aromas.split(",").map((part) => part.trim()).filter(Boolean).slice(0, 8);
  const shortDescription = input.description.slice(0, 220);
  const descriptionParts = [input.description, `Goût : ${item.taste}.`, `Intensité : ${item.intensity}.`];
  if (item.appearance) descriptionParts.push(`Aspect : ${item.appearance}.`);
  const molecule = item.molecule.trim().toUpperCase();
  return {
    id, sourceSelectionId: item.id, slug, name, category,
    price: input.price, fixedPriceMode: "disabled", fixedPriceOptions: [],
    shortDescription, longDescription: descriptionParts.join("\n\n"),
    image, imageAlt: `${name} - ${item.category} Verdanza`,
    images: [{ id: "selection-primary", url: image, alt: `${name} - ${item.category} Verdanza`, sortOrder: 0, isPrimary: true }],
    cbdRate: molecule === "CBD" ? item.rate || "À renseigner" : "À renseigner",
    cbgRate: molecule === "CBG" ? item.rate || "À renseigner" : "À renseigner",
    cbnRate: molecule === "CBN" ? item.rate || "À renseigner" : undefined,
    thcRate: "À renseigner", origin: item.origin,
    cultureType: catalogCulture(item.culture), aromas,
    tags: [item.molecule, item.intensity].filter(Boolean),
    stock: input.stock, lowStockThreshold: 5, isActive: true, isFeatured: false,
    seoTitle: `${name} | Verdanza`,
    seoDescription: shortDescription,
  };
}

function catalogCulture(value: string): Product["cultureType"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("hydro")) return "Hydroponique";
  if (normalized.includes("greenhouse")) return "Greenhouse";
  if (normalized.includes("serre")) return "Sous-serre";
  if (normalized.includes("indoor")) return "Indoor";
  return value ? "Autre" : "A renseigner";
}
