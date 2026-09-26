import type { Product } from "../types";

type ProductCardMedia = { src: string; alt: string };

// Visual-only choices from the existing product photography. Commerce and
// ProductPage imagery continue to use the product supplied by Firestore.
export const productCardMediaBySlug: Record<string, ProductCardMedia> = {
  "cookie-kush-indoor": {
    src: "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-pile.webp",
    alt: "Ensemble de fleurs Cookie Kush Indoor Verdanza sur fond clair",
  },
  "harlequin-greenhouse": {
    src: "/Fiche produit/Harlequin (sous-serre)/harlequin_pile.webp",
    alt: "Ensemble de fleurs Harlequin Greenhouse Verdanza sur fond clair",
  },
  "mandarine-cbd": {
    src: "/Fiche produit/Mandarine/Mandarine_pile.webp",
    alt: "Ensemble de fleurs Mandarine CBD Verdanza sur fond clair",
  },
  "mango-haze-cbd": {
    src: "/Fiche produit/Mango%20Haze/mango.webp",
    alt: "Ensemble de fleurs Mango Haze CBD Verdanza sur fond clair",
  },
  "petites-tetes-og-kush": {
    src: "/Fiche produit/Petite tetes OG Kush ( sous serre)/PTOGKush_pile.webp",
    alt: "Ensemble de petites têtes OG Kush CBD Verdanza sur fond clair",
  },
  "golden-static": {
    src: "/Fiche produit/Golden static/Composition-ezgif.com-resize.webp",
    alt: "Résine Golden Static Verdanza entière sur fond clair",
  },
  "supreme-50-cbd": {
    src: "/Fiche produit/Supreme/supreme-50-cbd.webp",
    alt: "Plaques de résine Suprême 50 % CBD Verdanza sur fond clair",
  },
};

export function resolveProductCardMedia(product: Product): ProductCardMedia {
  return productCardMediaBySlug[product.slug] ?? {
    src: product.image,
    alt: product.imageAlt || `${product.name} - ${product.category === "flowers" ? "Fleur CBD" : "Résine CBD"} Verdanza`,
  };
}
