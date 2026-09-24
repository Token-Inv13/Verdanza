import type { ProductSheet } from "../data/productSheets.js";
import { parseProductIntensity } from "./productTaxonomy.js";
import type { ProductSelection } from "../types/selection.js";
import { selectionPublicName } from "../types/selection.js";

export type PublishedSelectionSheet = {
  selectionId: string;
  name: string;
  slug: string;
  aromas: string[];
  selectionProfile: ProductSheet["selectionProfile"];
  pdfPath: string;
  imagePath: string;
  published: true;
  publishedAt: string;
};

export function publicSelectionEntry(item: ProductSelection, slug: string, pdfPath: string, publishedAt: string): PublishedSelectionSheet {
  if (item.category !== "Fleur" && item.category !== "Résine") throw new Error("Type public invalide.");
  if (!item.intensity || !item.aromaFamily) throw new Error("Profil public incomplet.");
  const intensity = parseProductIntensity(item.intensity);
  if (!intensity) throw new Error("Intensité publique invalide.");
  return {
    selectionId: item.id,
    name: selectionPublicName(item), slug,
    aromas: item.aromas.split(",").map((part) => part.trim()).filter(Boolean).slice(0, 8),
    selectionProfile: {
      category: item.category === "Fleur" ? "flower" : "resin",
      intensity,
      aromaFamilies: [item.aromaFamily],
    },
    pdfPath, imagePath: item.imagePath, published: true, publishedAt,
  };
}

export function publicSelectionView(entry: PublishedSelectionSheet): ProductSheet {
  const slug = encodeURIComponent(entry.slug);
  return {
    name: entry.name, slug: entry.slug, aromas: entry.aromas,
    selectionProfile: entry.selectionProfile,
    pdfUrl: `/api/selection?action=asset&slug=${slug}&kind=pdf`,
    previewUrl: `/api/selection?action=asset&slug=${slug}&kind=image`,
  };
}
