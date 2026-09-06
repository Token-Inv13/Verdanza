export type ProductSheetCategory = "flower" | "resin";
export type ProductSheetIntensity = "douce" | "moderee" | "soutenue" | "intense";
export type ProductSheetAmbience =
  | "detente"
  | "detente-profonde"
  | "dynamique"
  | "equilibre"
  | "cocooning";
export type ProductSheetAromaFamily =
  | "fruite"
  | "agrumes"
  | "sucre"
  | "terreux"
  | "epice"
  | "boise";

export type ProductSheet = {
  name: string;
  slug: string;
  category: ProductSheetCategory;
  aromas: string[];
  experience: {
    intensity: ProductSheetIntensity;
    ambiences: ProductSheetAmbience[];
    summary: string;
  };
  aromaFamilies: ProductSheetAromaFamily[];
  pdfUrl: string;
  previewUrl: string;
};

export const productSheetCategoryLabels: Record<ProductSheetCategory, string> = {
  flower: "Fleur",
  resin: "Résine",
};

export const productSheetIntensityLabels: Record<ProductSheetIntensity, string> = {
  douce: "Douce",
  moderee: "Modérée",
  soutenue: "Soutenue",
  intense: "Intense",
};

export const productSheetAmbienceLabels: Record<ProductSheetAmbience, string> = {
  detente: "Détente",
  "detente-profonde": "Détente profonde",
  dynamique: "Dynamique",
  equilibre: "Équilibré",
  cocooning: "Cocooning",
};

export const productSheetAromaFamilyLabels: Record<ProductSheetAromaFamily, string> = {
  fruite: "Fruité",
  agrumes: "Agrumes",
  sucre: "Sucré",
  terreux: "Terreux",
  epice: "Épicé",
  boise: "Boisé",
};

export const productSheets: ProductSheet[] = [
  {
    name: "Biscotti",
    slug: "biscotti",
    category: "flower",
    aromas: ["Sucré", "Terreux", "Épicé"],
    experience: {
      intensity: "soutenue",
      ambiences: ["equilibre", "detente"],
      summary: "Une ambiance enveloppante, entre calme posé et léger élan créatif.",
    },
    aromaFamilies: ["sucre", "terreux", "epice"],
    pdfUrl: "/fiches-produits/biscotti/verdanza-biscotti.pdf",
    previewUrl: "/images/fiches-produits/biscotti.webp",
  },
  {
    name: "Blue Dream",
    slug: "blue-dream",
    category: "flower",
    aromas: ["Agrumes", "Pin", "Terreux"],
    experience: {
      intensity: "intense",
      ambiences: ["detente-profonde", "equilibre"],
      summary: "Une ambiance profonde et posée, accompagnée d’un léger élan créatif.",
    },
    aromaFamilies: ["agrumes", "terreux", "boise"],
    pdfUrl: "/fiches-produits/blue-dream/verdanza-blue-dream.pdf",
    previewUrl: "/images/fiches-produits/blue-dream.webp",
  },
  {
    name: "Lemon Skunk",
    slug: "lemon-skunk",
    category: "flower",
    aromas: ["Citron", "Agrumes", "Acidulé"],
    experience: {
      intensity: "intense",
      ambiences: ["detente-profonde", "dynamique"],
      summary: "Une ambiance profonde et posée, équilibrée par un caractère vif et créatif.",
    },
    aromaFamilies: ["agrumes", "sucre", "epice"],
    pdfUrl: "/fiches-produits/lemon-skunk/verdanza-lemon-skunk.pdf",
    previewUrl: "/images/fiches-produits/lemon-skunk.webp",
  },
  {
    name: "Mimosa",
    slug: "mimosa",
    category: "flower",
    aromas: ["Agrumes", "Orange", "Fruité"],
    experience: {
      intensity: "soutenue",
      ambiences: ["dynamique", "equilibre"],
      summary: "Une ambiance vive et créative, équilibrée par un caractère calme et posé.",
    },
    aromaFamilies: ["agrumes", "fruite", "sucre"],
    pdfUrl: "/fiches-produits/mimosa/verdanza-mimosa.pdf",
    previewUrl: "/images/fiches-produits/mimosa.webp",
  },
  {
    name: "Watermelon Candy",
    slug: "watermelon-candy",
    category: "flower",
    aromas: ["Pastèque", "Sucré", "Fruité"],
    experience: {
      intensity: "moderee",
      ambiences: ["detente", "cocooning"],
      summary: "Une ambiance douce et cocooning, pensée pour un moment calme et posé.",
    },
    aromaFamilies: ["fruite", "sucre", "terreux"],
    pdfUrl: "/fiches-produits/watermelon-candy/verdanza-watermelon-candy.pdf",
    previewUrl: "/images/fiches-produits/watermelon-candy.webp",
  },
  {
    name: "Zkittlez OG",
    slug: "zkittlez-og",
    category: "flower",
    aromas: ["Fruité", "Sucré", "Bonbon"],
    experience: {
      intensity: "intense",
      ambiences: ["detente-profonde", "equilibre"],
      summary: "Une ambiance profonde et enveloppante, entre énergie et calme.",
    },
    aromaFamilies: ["fruite", "sucre", "agrumes"],
    pdfUrl: "/fiches-produits/zkittlez-og/verdanza-zkittlez-og.pdf",
    previewUrl: "/images/fiches-produits/zkittlez-og.webp",
  },
  {
    name: "Pollen Mousseux",
    slug: "pollen-mousseux",
    category: "resin",
    aromas: ["Terreux", "Boisé", "Subtilement fruité"],
    experience: {
      intensity: "intense",
      ambiences: ["detente-profonde", "equilibre"],
      summary: "Une ambiance progressive et profonde, équilibrée par une touche d’énergie.",
    },
    aromaFamilies: ["terreux", "boise", "agrumes"],
    pdfUrl: "/fiches-produits/pollen-mousseux/verdanza-pollen-mousseux.pdf",
    previewUrl: "/images/fiches-produits/pollen-mousseux.webp",
  },
  {
    name: "Kief",
    slug: "kief",
    category: "resin",
    aromas: ["Terreux", "Épicé", "Boisé"],
    experience: {
      intensity: "intense",
      ambiences: ["detente-profonde"],
      summary: "Un profil marqué, pensé pour un moment calme et posé.",
    },
    aromaFamilies: ["terreux", "epice", "boise"],
    pdfUrl: "/fiches-produits/kief/verdanza-kief.pdf",
    previewUrl: "/images/fiches-produits/kief.webp",
  },
  {
    name: "Black Libanais",
    slug: "black-libanais",
    category: "resin",
    aromas: ["Épicé", "Terreux", "Boisé"],
    experience: {
      intensity: "intense",
      ambiences: ["detente-profonde", "cocooning"],
      summary: "Une ambiance enveloppante, entre sérénité et détente profonde.",
    },
    aromaFamilies: ["terreux", "epice", "boise"],
    pdfUrl: "/fiches-produits/black-libanais/verdanza-black-libanais.pdf",
    previewUrl: "/images/fiches-produits/black-libanais.webp",
  },
  {
    name: "Black Butter",
    slug: "black-butter",
    category: "resin",
    aromas: ["Terreux", "Boisé", "Sous-bois"],
    experience: {
      intensity: "soutenue",
      ambiences: ["detente", "cocooning"],
      summary: "Une ambiance réconfortante et cocooning, pensée pour un moment posé.",
    },
    aromaFamilies: ["terreux", "boise", "sucre"],
    pdfUrl: "/fiches-produits/black-butter/verdanza-black-butter.pdf",
    previewUrl: "/images/fiches-produits/black-butter.webp",
  },
];
