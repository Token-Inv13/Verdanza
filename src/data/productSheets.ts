export type ProductSheetCategory = "flowers" | "resins";

export type ProductSheet = {
  name: string;
  slug: string;
  category: ProductSheetCategory;
  aromas: string[];
  intensity: string;
  ambiences: string[];
  pdfUrl: string;
  previewUrl: string;
};

export const productSheets: ProductSheet[] = [
  {
    name: "Biscotti",
    slug: "biscotti",
    category: "flowers",
    aromas: ["Sucré", "Terreux", "Épicé"],
    intensity: "Soutenue",
    ambiences: ["Équilibré", "Détente"],
    pdfUrl: "/fiches-produits/biscotti/verdanza-biscotti.pdf",
    previewUrl: "/images/fiches-produits/biscotti.webp",
  },
  {
    name: "Blue Dream",
    slug: "blue-dream",
    category: "flowers",
    aromas: ["Agrumes", "Pin", "Terreux"],
    intensity: "Intense",
    ambiences: ["Détente profonde", "Équilibré"],
    pdfUrl: "/fiches-produits/blue-dream/verdanza-blue-dream.pdf",
    previewUrl: "/images/fiches-produits/blue-dream.webp",
  },
  {
    name: "Lemon Skunk",
    slug: "lemon-skunk",
    category: "flowers",
    aromas: ["Citron", "Agrumes", "Acidulé"],
    intensity: "Intense",
    ambiences: ["Détente profonde", "Dynamique"],
    pdfUrl: "/fiches-produits/lemon-skunk/verdanza-lemon-skunk.pdf",
    previewUrl: "/images/fiches-produits/lemon-skunk.webp",
  },
  {
    name: "Mimosa",
    slug: "mimosa",
    category: "flowers",
    aromas: ["Agrumes", "Orange", "Fruité"],
    intensity: "Soutenue",
    ambiences: ["Dynamique", "Équilibré"],
    pdfUrl: "/fiches-produits/mimosa/verdanza-mimosa.pdf",
    previewUrl: "/images/fiches-produits/mimosa.webp",
  },
  {
    name: "Watermelon Candy",
    slug: "watermelon-candy",
    category: "flowers",
    aromas: ["Pastèque", "Sucré", "Fruité"],
    intensity: "Modérée",
    ambiences: ["Détente", "Cocooning"],
    pdfUrl: "/fiches-produits/watermelon-candy/verdanza-watermelon-candy.pdf",
    previewUrl: "/images/fiches-produits/watermelon-candy.webp",
  },
  {
    name: "Zkittlez OG",
    slug: "zkittlez-og",
    category: "flowers",
    aromas: ["Fruité", "Sucré", "Bonbon"],
    intensity: "Intense",
    ambiences: ["Détente profonde", "Équilibré"],
    pdfUrl: "/fiches-produits/zkittlez-og/verdanza-zkittlez-og.pdf",
    previewUrl: "/images/fiches-produits/zkittlez-og.webp",
  },
  {
    name: "Pollen Mousseux",
    slug: "pollen-mousseux",
    category: "resins",
    aromas: ["Terreux", "Boisé", "Subtilement fruité"],
    intensity: "Intense",
    ambiences: ["Détente profonde", "Équilibré"],
    pdfUrl: "/fiches-produits/pollen-mousseux/verdanza-pollen-mousseux.pdf",
    previewUrl: "/images/fiches-produits/pollen-mousseux.webp",
  },
  {
    name: "Kief",
    slug: "kief",
    category: "resins",
    aromas: ["Terreux", "Épicé", "Boisé"],
    intensity: "Intense",
    ambiences: ["Détente profonde"],
    pdfUrl: "/fiches-produits/kief/verdanza-kief.pdf",
    previewUrl: "/images/fiches-produits/kief.webp",
  },
  {
    name: "Black Libanais",
    slug: "black-libanais",
    category: "resins",
    aromas: ["Épicé", "Terreux", "Boisé"],
    intensity: "Intense",
    ambiences: ["Détente profonde", "Cocooning"],
    pdfUrl: "/fiches-produits/black-libanais/verdanza-black-libanais.pdf",
    previewUrl: "/images/fiches-produits/black-libanais.webp",
  },
  {
    name: "Black Butter",
    slug: "black-butter",
    category: "resins",
    aromas: ["Terreux", "Boisé", "Sous-bois"],
    intensity: "Soutenue",
    ambiences: ["Détente", "Cocooning"],
    pdfUrl: "/fiches-produits/black-butter/verdanza-black-butter.pdf",
    previewUrl: "/images/fiches-produits/black-butter.webp",
  },
];
