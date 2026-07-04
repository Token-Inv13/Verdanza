import type { Product } from "../types/index.js";

export const products: Product[] = [
  {
    id: "resin-golden-static",
    slug: "golden-static",
    name: "Golden Static",
    category: "resins",
    price: 5.5,
    shortDescription:
      "Résine multi-cannabinoides CBD, CBG et CBN, puissante et herbacée.",
    longDescription:
      "Golden Static est une résine premium produite en France, à la texture crémeuse et au profil riche. Sa composition associe CBD, CBG et CBN pour une référence technique, moderne et haut de gamme.",
    image: "/Fiche produit/Golden static/goldenstatic.webp",
    cbdRate: "50 %",
    cbgRate: "10 %",
    thcRate: "< 0,2 %",
    origin: "France",
    cultureType: "Autre",
    aromas: ["Puissant", "Herbacé", "Végétal", "Authentique"],
    tags: ["résine", "cbd", "cbg", "cbn", "france"],
    stock: 100,
    lowStockThreshold: 15,
    isActive: true,
    isFeatured: true,
    seoTitle: "Golden Static - Résine CBD CBG CBN Verdanza",
    seoDescription:
      "Golden Static Verdanza, résine multi-cannabinoides CBD CBG CBN produite en France, disponible au gramme.",
  },
  {
    id: "resin-supreme-purple-cbd",
    slug: "supreme-purple-cbd",
    name: "Suprême Purple CBD",
    category: "resins",
    price: 5,
    shortDescription:
      "Résine CBD premium française, compacte, légèrement friable et intensément aromatique.",
    longDescription:
      "Suprême Purple CBD est une résine premium au profil intense et authentique. Sa fiche indique 50 % de CBD, une origine France et une texture compacte légèrement friable.",
    image: "/Fiche produit/Supreme Purple CBD/SUPREMEPURPLEcopieffff.webp",
    cbdRate: "50 %",
    cbgRate: "Non communiqué",
    thcRate: "< 0,2 %",
    origin: "France",
    cultureType: "Autre",
    aromas: ["Terreux", "Végétal", "Raisin doux", "Épicé"],
    tags: ["résine", "cbd", "france", "premium"],
    stock: 100,
    lowStockThreshold: 15,
    isActive: true,
    isFeatured: true,
    seoTitle: "Suprême Purple CBD - Résine premium Verdanza",
    seoDescription:
      "Suprême Purple CBD Verdanza, résine CBD française à 50 % de CBD, vendue au gramme.",
  },
  {
    id: "flower-cookie-kush-indoor",
    slug: "cookie-kush-indoor",
    name: "Cookie Kush Indoor",
    category: "flowers",
    price: 4.5,
    shortDescription:
      "Fleur CBD indoor gourmande, douce et sucrée, cultivée en intérieur.",
    longDescription:
      "Cookie Kush Indoor est la référence la plus gourmande de la sélection. Cultivée en intérieur en Italie, elle offre un profil sucré, sirupeux et rond avec une présentation soignée.",
    image: "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-zoom.webp",
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "< 0,2 %",
    origin: "Italie",
    cultureType: "Indoor",
    aromas: ["Sucré", "Sirupeux", "Gourmand", "Rond"],
    tags: ["fleur", "indoor", "italie", "gourmand"],
    stock: 100,
    lowStockThreshold: 15,
    isActive: true,
    isFeatured: true,
    seoTitle: "Cookie Kush Indoor - Fleur CBD Verdanza",
    seoDescription:
      "Cookie Kush Indoor Verdanza, fleur CBD indoor italienne au profil gourmand, vendue au gramme.",
  },
  {
    id: "flower-petites-tetes-og-kush",
    slug: "petites-tetes-og-kush",
    name: "Petites Têtes OG Kush",
    category: "flowers",
    price: 4,
    shortDescription:
      "Petites têtes de fleur CBD greenhouse, fraîches, intenses et équilibrées.",
    longDescription:
      "Petites Têtes OG Kush est une fleur CBD cultivée en Italie sous serre. Son profil associe menthe fraîche, agrumes et fraîcheur végétale pour une référence directe et équilibrée.",
    image: "/Fiche produit/Petite tetes OG Kush ( sous serre)/PTOGKush_zoom.webp",
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "< 0,2 %",
    origin: "Italie",
    cultureType: "Sous-serre",
    aromas: ["Menthe fraîche", "Agrumes", "Fraîcheur végétale", "Intense"],
    tags: ["fleur", "greenhouse", "sous-serre", "italie", "og-kush"],
    stock: 100,
    lowStockThreshold: 15,
    isActive: true,
    isFeatured: true,
    seoTitle: "Petites Têtes OG Kush - Fleur CBD Verdanza",
    seoDescription:
      "Petites Têtes OG Kush Verdanza, fleur CBD greenhouse italienne au profil frais et équilibré.",
  },
  {
    id: "flower-harlequin-greenhouse",
    slug: "harlequin-greenhouse",
    name: "Harlequin Greenhouse",
    category: "flowers",
    price: 4,
    shortDescription:
      "Fleur CBD greenhouse naturelle, ronde et authentique, cultivée en Italie.",
    longDescription:
      "Harlequin Greenhouse est une fleur CBD sous serre au profil profond et équilibré. Elle développe des notes de musc, sous-bois, sésame et touches torréfiées.",
    image: "/Fiche produit/Harlequin (sous-serre)/harlequin_zoom.webp",
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "< 0,2 %",
    origin: "Italie",
    cultureType: "Sous-serre",
    aromas: ["Musc", "Sous-bois", "Notes torréfiées", "Sésame", "Rondeur"],
    tags: ["fleur", "greenhouse", "sous-serre", "italie", "harlequin"],
    stock: 100,
    lowStockThreshold: 15,
    isActive: true,
    isFeatured: false,
    seoTitle: "Harlequin Greenhouse - Fleur CBD Verdanza",
    seoDescription:
      "Harlequin Greenhouse Verdanza, fleur CBD sous serre italienne au profil naturel et boisé.",
  },
];

export const featuredProducts = products.filter((product) => product.isFeatured);

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}

export function getProductsByCategory(category: Product["category"]) {
  return products.filter((product) => product.category === category);
}
