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
  productId: string;
  name: string;
  slug: string;
  aromas: string[];
  selectionProfile: ProductSelectionProfile;
  pdfUrl: string;
  previewUrl: string;
  availability: "available";
};

export const productSheetCategoryLabels: Record<ProductSheetCategory, string> = {
  flower: "Fleur",
  resin: "Résine",
};

export const productSheetIntensityLabels = productIntensityLabels;
export const productSheetAromaFamilyLabels = productAromaFamilyLabels;

// Public library linked one-to-one to the products currently published in the shop.
// Historical sheets remain in their documentary archives, outside the active UI.
export const productSheets: ProductSheet[] = [
  {
    productId: "flower-blue-dream-cbd",
    name: "Blue Dream",
    slug: "blue-dream-cbd",
    aromas: ["Citron", "Pin", "Fruit doux"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["agrumes", "boise", "fruite"] },
    pdfUrl: "/fiches-produits/blue-dream-cbd/verdanza-blue-dream-cbd.pdf",
    previewUrl: "/images/fiches-produits/blue-dream-cbd.webp",
    availability: "available",
  },
  {
    productId: "flower-cookie-kush-indoor",
    name: "Cookie Kush Indoor",
    slug: "cookie-kush-indoor",
    aromas: ["Sucré", "Sirupeux", "Gourmand"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["sucre"] },
    pdfUrl: "/fiches-produits/cookie-kush-indoor/verdanza-cookie-kush-indoor.pdf",
    previewUrl: "/images/fiches-produits/cookie-kush-indoor.webp",
    availability: "available",
  },
  {
    productId: "flower-harlequin-greenhouse",
    name: "Harlequin Greenhouse",
    slug: "harlequin-greenhouse",
    aromas: ["Musc", "Sous-bois", "Notes torréfiées"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["terreux", "boise"] },
    pdfUrl: "/fiches-produits/harlequin-greenhouse/verdanza-harlequin-greenhouse.pdf",
    previewUrl: "/images/fiches-produits/harlequin-greenhouse.webp",
    availability: "available",
  },
  {
    productId: "flower-mandarine-cbd",
    name: "Mandarine",
    slug: "mandarine-cbd",
    aromas: ["Mandarine", "Agrumes", "Citron"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["agrumes", "fruite"] },
    pdfUrl: "/fiches-produits/mandarine-cbd/verdanza-mandarine-cbd.pdf",
    previewUrl: "/images/fiches-produits/mandarine-cbd.webp",
    availability: "available",
  },
  {
    productId: "flower-mango-haze-cbd",
    name: "Mango Haze",
    slug: "mango-haze-cbd",
    aromas: ["Sucré", "Fruité", "Acidulé"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["sucre", "fruite"] },
    pdfUrl: "/fiches-produits/mango-haze-cbd/verdanza-mango-haze-cbd.pdf",
    previewUrl: "/images/fiches-produits/mango-haze-cbd.webp",
    availability: "available",
  },
  {
    productId: "flower-petites-tetes-og-kush",
    name: "OG Kush",
    slug: "petites-tetes-og-kush",
    aromas: ["Menthe fraîche", "Agrumes", "Fraîcheur végétale"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["agrumes"] },
    pdfUrl: "/fiches-produits/petites-tetes-og-kush/verdanza-petites-tetes-og-kush.pdf",
    previewUrl: "/images/fiches-produits/petites-tetes-og-kush.webp",
    availability: "available",
  },
  {
    productId: "resin-golden-static",
    name: "Golden Static",
    slug: "golden-static",
    aromas: ["Herbacé", "Végétal", "Authentique"],
    selectionProfile: { category: "resin", intensity: "doux", aromaFamilies: ["terreux", "boise"] },
    pdfUrl: "/fiches-produits/golden-static/verdanza-golden-static.pdf",
    previewUrl: "/images/fiches-produits/golden-static.webp",
    availability: "available",
  },
  {
    productId: "resin-supreme-50-cbd",
    name: "Suprême 50 % CBD",
    slug: "supreme-50-cbd",
    aromas: ["Floral", "Raffiné"],
    selectionProfile: { category: "resin", intensity: "doux", aromaFamilies: [] },
    pdfUrl: "/fiches-produits/supreme-50-cbd/verdanza-supreme-50-cbd.pdf",
    previewUrl: "/images/fiches-produits/supreme-50-cbd.webp",
    availability: "available",
  },
];

export const availableProductSheets = productSheets;
