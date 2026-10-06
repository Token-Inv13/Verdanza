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
  availability: "available" | "planned";
};

export const productSheetCategoryLabels: Record<ProductSheetCategory, string> = {
  flower: "Fleur",
  resin: "Résine",
};

export const productSheetIntensityLabels = productIntensityLabels;
export const productSheetAromaFamilyLabels = productAromaFamilyLabels;

// Public documentary library. Planned sheets stay visible here without entering
// the shop catalogue or the profile selector.
export const productSheets: ProductSheet[] = [
  {
    productId: "flower-blue-dream-cbd",
    name: "Blue Dream",
    slug: "blue-dream-cbd",
    aromas: ["Citron", "Pin", "Fruit doux"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["agrumes", "boise", "fruite"] },
    pdfUrl: "/fiches-produits/blue-dream-cbd/verdanza-blue-dream-cbd-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/blue-dream-cbd-modern-20261007.webp",
    availability: "available",
  },
  {
    productId: "flower-cookie-kush-indoor",
    name: "Cookie Kush Indoor",
    slug: "cookie-kush-indoor",
    aromas: ["Sucré", "Sirupeux", "Gourmand"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["sucre"] },
    pdfUrl: "/fiches-produits/cookie-kush-indoor/verdanza-cookie-kush-indoor-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/cookie-kush-indoor-modern-20261007.webp",
    availability: "available",
  },
  {
    productId: "flower-harlequin-greenhouse",
    name: "Harlequin Greenhouse",
    slug: "harlequin-greenhouse",
    aromas: ["Musc", "Sous-bois", "Notes torréfiées"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["terreux", "boise"] },
    pdfUrl: "/fiches-produits/harlequin-greenhouse/verdanza-harlequin-greenhouse-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/harlequin-greenhouse-modern-20261007.webp",
    availability: "available",
  },
  {
    productId: "flower-mandarine-cbd",
    name: "Mandarine",
    slug: "mandarine-cbd",
    aromas: ["Mandarine", "Agrumes", "Citron"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["agrumes", "fruite"] },
    pdfUrl: "/fiches-produits/mandarine-cbd/verdanza-mandarine-cbd-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/mandarine-cbd-modern-20261007.webp",
    availability: "available",
  },
  {
    productId: "flower-mango-haze-cbd",
    name: "Mango Haze",
    slug: "mango-haze-cbd",
    aromas: ["Sucré", "Fruité", "Acidulé"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["sucre", "fruite"] },
    pdfUrl: "/fiches-produits/mango-haze-cbd/verdanza-mango-haze-cbd-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/mango-haze-cbd-modern-20261007.webp",
    availability: "available",
  },
  {
    productId: "flower-petites-tetes-og-kush",
    name: "OG Kush",
    slug: "petites-tetes-og-kush",
    aromas: ["Menthe fraîche", "Agrumes", "Fraîcheur végétale"],
    selectionProfile: { category: "flower", intensity: "doux", aromaFamilies: ["agrumes"] },
    pdfUrl: "/fiches-produits/petites-tetes-og-kush/verdanza-petites-tetes-og-kush-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/petites-tetes-og-kush-modern-20261007.webp",
    availability: "available",
  },
  {
    productId: "resin-golden-static",
    name: "Golden Static",
    slug: "golden-static",
    aromas: ["Herbacé", "Végétal", "Authentique"],
    selectionProfile: { category: "resin", intensity: "doux", aromaFamilies: ["terreux", "boise"] },
    pdfUrl: "/fiches-produits/golden-static/verdanza-golden-static-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/golden-static-modern-20261007.webp",
    availability: "available",
  },
  {
    productId: "resin-supreme-50-cbd",
    name: "Suprême 50 % CBD",
    slug: "supreme-50-cbd",
    aromas: ["Floral", "Raffiné"],
    selectionProfile: { category: "resin", intensity: "doux", aromaFamilies: [] },
    pdfUrl: "/fiches-produits/supreme-50-cbd/verdanza-supreme-50-cbd-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/supreme-50-cbd-modern-20261007.webp",
    availability: "available",
  },
  {
    productId: "flower-skittle-plus",
    name: "Skittle Plus",
    slug: "skittle-plus",
    aromas: ["Citron", "Bonbon", "Diesel"],
    selectionProfile: { category: "flower", intensity: "fort", aromaFamilies: ["agrumes", "sucre", "fruite"] },
    pdfUrl: "/fiches-produits/skittle-plus/verdanza-skittle-plus-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/skittle-plus-modern-20261007.webp",
    availability: "planned",
  },
  {
    productId: "resin-black-afghan",
    name: "Black Afghan",
    slug: "black-afghan",
    aromas: ["Terreux", "Sucré", "Fruits rouges"],
    selectionProfile: { category: "resin", intensity: "moyen", aromaFamilies: ["terreux", "sucre", "fruite"] },
    pdfUrl: "/fiches-produits/black-afghan/verdanza-black-afghan-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/black-afghan-modern-20261007.webp",
    availability: "planned",
  },
  {
    productId: "resin-ice-o-lator",
    name: "Ice-o-Lator",
    slug: "ice-o-lator",
    aromas: ["Floral", "Fruits mûrs", "Épicé"],
    selectionProfile: { category: "resin", intensity: "moyen", aromaFamilies: ["fruite", "epice", "sucre"] },
    pdfUrl: "/fiches-produits/ice-o-lator/verdanza-ice-o-lator-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/ice-o-lator-modern-20261007.webp",
    availability: "planned",
  },
  {
    productId: "resin-mousseux-skywalker",
    name: "Mousseux Skywalker",
    slug: "mousseux-skywalker",
    aromas: ["Pin", "Boisé", "Agrumes"],
    selectionProfile: { category: "resin", intensity: "fort", aromaFamilies: ["boise", "agrumes", "epice"] },
    pdfUrl: "/fiches-produits/mousseux-skywalker/verdanza-mousseux-skywalker-modern-20261007.pdf",
    previewUrl: "/images/fiches-produits/mousseux-skywalker-modern-20261007.webp",
    availability: "planned",
  },
];

export const availableProductSheets = productSheets.filter((sheet) => sheet.availability === "available");
export const plannedProductSheets = productSheets.filter((sheet) => sheet.availability === "planned");
