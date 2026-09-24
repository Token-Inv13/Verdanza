import {
  productAromaFamilyLabels,
  productIntensityLabels,
  type ProductAromaFamily,
  type ProductIntensity,
} from "../lib/productTaxonomy.js";

export type ProductSheetCategory = "flower" | "resin";
export type ProductSheetIntensity = ProductIntensity;
export type ProductSheetAromaFamily = ProductAromaFamily;

export type ProductSelectionProfile = {
  category: ProductSheetCategory;
  intensity: ProductSheetIntensity;
  aromaFamilies: ProductSheetAromaFamily[];
};

export type ProductSheet = {
  name: string;
  slug: string;
  aromas: string[];
  selectionProfile: ProductSelectionProfile;
  pdfUrl: string;
  previewUrl: string;
};

export const productSheetCategoryLabels: Record<ProductSheetCategory, string> = {
  flower: "Fleur",
  resin: "Résine",
};

export const productSheetIntensityLabels = productIntensityLabels;
export const productSheetAromaFamilyLabels = productAromaFamilyLabels;

export const productSheets: ProductSheet[] = [
  {
    name: "Biscotti",
    slug: "biscotti",
    aromas: ["Sucré", "Terreux", "Épicé"],
    selectionProfile: { category: "flower", intensity: "moyen", aromaFamilies: ["sucre", "terreux", "epice"] },
    pdfUrl: "/fiches-produits/biscotti/verdanza-biscotti.pdf",
    previewUrl: "/images/fiches-produits/biscotti.webp",
  },
  {
    name: "Blue Dream",
    slug: "blue-dream",
    aromas: ["Agrumes", "Pin", "Terreux"],
    selectionProfile: { category: "flower", intensity: "fort", aromaFamilies: ["agrumes", "terreux", "boise"] },
    pdfUrl: "/fiches-produits/blue-dream/verdanza-blue-dream.pdf",
    previewUrl: "/images/fiches-produits/blue-dream.webp",
  },
  {
    name: "Lemon Skunk",
    slug: "lemon-skunk",
    aromas: ["Citron", "Agrumes", "Acidulé"],
    selectionProfile: { category: "flower", intensity: "fort", aromaFamilies: ["agrumes", "sucre", "epice"] },
    pdfUrl: "/fiches-produits/lemon-skunk/verdanza-lemon-skunk.pdf",
    previewUrl: "/images/fiches-produits/lemon-skunk.webp",
  },
  {
    name: "Mimosa",
    slug: "mimosa",
    aromas: ["Agrumes", "Orange", "Fruité"],
    selectionProfile: { category: "flower", intensity: "moyen", aromaFamilies: ["agrumes", "fruite", "sucre"] },
    pdfUrl: "/fiches-produits/mimosa/verdanza-mimosa.pdf",
    previewUrl: "/images/fiches-produits/mimosa.webp",
  },
  {
    name: "Watermelon Candy",
    slug: "watermelon-candy",
    aromas: ["Pastèque", "Sucré", "Fruité"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["fruite", "sucre", "terreux"] },
    pdfUrl: "/fiches-produits/watermelon-candy/verdanza-watermelon-candy.pdf",
    previewUrl: "/images/fiches-produits/watermelon-candy.webp",
  },
  {
    name: "Zkittlez OG",
    slug: "zkittlez-og",
    aromas: ["Fruité", "Sucré", "Bonbon"],
    selectionProfile: { category: "flower", intensity: "fort", aromaFamilies: ["fruite", "sucre", "agrumes"] },
    pdfUrl: "/fiches-produits/zkittlez-og/verdanza-zkittlez-og.pdf",
    previewUrl: "/images/fiches-produits/zkittlez-og.webp",
  },
  {
    name: "Le mousseux",
    slug: "le-mousseux",
    aromas: ["Terreux", "Boisé", "Subtilement fruité"],
    selectionProfile: { category: "resin", intensity: "fort", aromaFamilies: ["terreux", "boise", "agrumes"] },
    pdfUrl: "/fiches-produits/le-mousseux/verdanza-le-mousseux.pdf",
    previewUrl: "/images/fiches-produits/le-mousseux.webp",
  },
  {
    name: "Kief",
    slug: "kief",
    aromas: ["Terreux", "Épicé", "Boisé"],
    selectionProfile: { category: "resin", intensity: "fort", aromaFamilies: ["terreux", "epice", "boise"] },
    pdfUrl: "/fiches-produits/kief/verdanza-kief.pdf",
    previewUrl: "/images/fiches-produits/kief.webp",
  },
  {
    name: "Libanais",
    slug: "libanais",
    aromas: ["Épicé", "Terreux", "Boisé"],
    selectionProfile: { category: "resin", intensity: "fort", aromaFamilies: ["terreux", "epice", "boise"] },
    pdfUrl: "/fiches-produits/libanais/verdanza-libanais.pdf",
    previewUrl: "/images/fiches-produits/libanais.webp",
  },
  {
    name: "Black Butter",
    slug: "black-butter",
    aromas: ["Terreux", "Boisé", "Sous-bois"],
    selectionProfile: { category: "resin", intensity: "moyen", aromaFamilies: ["terreux", "boise", "sucre"] },
    pdfUrl: "/fiches-produits/black-butter/verdanza-black-butter.pdf",
    previewUrl: "/images/fiches-produits/black-butter.webp",
  },
];
