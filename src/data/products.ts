import type { Product } from "../types";

const placeholder = "/verdanza-label.png";

export const products: Product[] = [
  {
    id: "flower-og-kush-greenhouse",
    slug: "og-kush-cbd-greenhouse",
    name: "OG Kush CBD Greenhouse",
    category: "flowers",
    price: 9.9,
    shortDescription:
      "Fleur CBD greenhouse au profil Kush, menthe fraiche et citron vert.",
    longDescription:
      "Reference phare issue de la selection Verdanza, choisie pour ses fleurs denses, son profil aromatique intense et sa conformite. Les donnees techniques manquantes seront completees depuis les fiches lots avant mise en vente.",
    image: placeholder,
    cbdRate: "A renseigner",
    cbgRate: "A renseigner",
    thcRate: "< 0,3 %",
    origin: "Europe - a preciser selon lot",
    cultureType: "Greenhouse",
    aromas: ["Kush", "Menthe fraiche", "Citron vert"],
    tags: ["fleur", "greenhouse", "premium"],
    stock: 18,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: true,
    seoTitle: "OG Kush CBD Greenhouse - Verdanza CBD",
    seoDescription:
      "OG Kush CBD greenhouse selectionnee par Verdanza, THC conforme et profil aromatique Kush.",
  },
  {
    id: "flower-banana-cream-cbg",
    slug: "banana-cream-cbg-greenhouse",
    name: "Banana Cream CBG Greenhouse",
    category: "flowers",
    price: 10.5,
    shortDescription:
      "Fleur riche en CBG aux notes sucrees, cremeuses et legerement fruitees.",
    longDescription:
      "Banana Cream CBG rejoint le catalogue initial pour apporter une alternative riche en CBG. Les informations de lot, taux exacts et origine seront confirmees avant publication commerciale.",
    image: placeholder,
    cbdRate: "A renseigner",
    cbgRate: "A renseigner",
    thcRate: "< 0,3 %",
    origin: "Europe - a preciser selon lot",
    cultureType: "Greenhouse",
    aromas: ["Creme", "Fruits doux", "Notes sucrees"],
    tags: ["fleur", "cbg", "greenhouse"],
    stock: 14,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: true,
    seoTitle: "Banana Cream CBG Greenhouse - Verdanza CBD",
    seoDescription:
      "Fleur Banana Cream CBG greenhouse, selection premium Verdanza avec THC conforme.",
  },
  {
    id: "flower-northern-lights",
    slug: "northern-lights-cbd-greenhouse",
    name: "Northern Lights CBD Greenhouse",
    category: "flowers",
    price: 9.5,
    shortDescription:
      "Fleur greenhouse aux notes resineuses et fraiches inspirees des grands pins.",
    longDescription:
      "Variete connue, retenue pour son profil frais et vegetal. Les donnees de taux, conditionnement et origine exacte restent a renseigner depuis les analyses de lot.",
    image: placeholder,
    cbdRate: "A renseigner",
    cbgRate: "A renseigner",
    thcRate: "< 0,3 %",
    origin: "Italie - a confirmer selon lot",
    cultureType: "Greenhouse",
    aromas: ["Resine", "Pin", "Fraicheur vegetale"],
    tags: ["fleur", "greenhouse", "classique"],
    stock: 16,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    seoTitle: "Northern Lights CBD Greenhouse - Verdanza CBD",
    seoDescription:
      "Northern Lights CBD greenhouse, fleur premium au THC inferieur a 0,3 %.",
  },
  {
    id: "flower-cookie-kush-indoor",
    slug: "cookie-kush-cbd-indoor",
    name: "Cookie Kush CBD Indoor",
    category: "flowers",
    price: 11.9,
    shortDescription:
      "Fleur indoor a dominante Kush, manucuree avec soin, au profil gourmand.",
    longDescription:
      "Cookie Kush CBD Indoor complete la gamme fleurs avec une reference plus confidentielle. Les informations techniques non presentes dans la selection source sont laissees a renseigner.",
    image: placeholder,
    cbdRate: "A renseigner",
    cbgRate: "A renseigner",
    thcRate: "< 0,3 %",
    origin: "Europe - a preciser selon lot",
    cultureType: "Indoor",
    aromas: ["Kush", "Gourmand", "Vegetal"],
    tags: ["fleur", "indoor", "premium"],
    stock: 10,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: true,
    seoTitle: "Cookie Kush CBD Indoor - Verdanza CBD",
    seoDescription:
      "Cookie Kush CBD Indoor, fleur CBD premium selectionnee par Verdanza.",
  },
  {
    id: "resin-king-hassan",
    slug: "king-hassan-cbd-resine",
    name: "King Hassan CBD",
    category: "resins",
    price: 8.9,
    shortDescription:
      "Resine francaise au pollen de chanvre, texture souple et profil epice.",
    longDescription:
      "King Hassan est retenue comme reference passerelle pour varier l'offre. Sa fiche source indique une fabrication en Aveyron et un taux CBD autour de 16 % selon lot.",
    image: placeholder,
    cbdRate: "16 %",
    cbgRate: "A renseigner",
    thcRate: "< 0,3 %",
    origin: "France",
    cultureType: "Autre",
    aromas: ["Myrte", "Eucalyptus", "Clou de girofle"],
    tags: ["resine", "france", "pollen"],
    stock: 20,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: true,
    seoTitle: "King Hassan CBD - Resine Verdanza",
    seoDescription:
      "Resine King Hassan CBD, selection premium Verdanza avec THC conforme.",
  },
  {
    id: "resin-afghan-hash",
    slug: "afghan-hash-cbd-25",
    name: "Afghan Hash CBD 25 %",
    category: "resins",
    price: 12.5,
    shortDescription:
      "Resine premium travaillee a la main, notes boisees et epicees.",
    longDescription:
      "Afghan Hash CBD est integree a la gamme initiale pour son positionnement haut de gamme. Les informations source mentionnent 25 % de CBD et un THC conforme.",
    image: placeholder,
    cbdRate: "25 %",
    cbgRate: "A renseigner",
    thcRate: "< 0,3 %",
    origin: "Royaume-Uni / France - a verifier selon lot",
    cultureType: "Autre",
    aromas: ["Cedre", "Cannelle", "Epices douces"],
    tags: ["resine", "premium", "25-cbd"],
    stock: 12,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: true,
    seoTitle: "Afghan Hash CBD 25 % - Verdanza CBD",
    seoDescription:
      "Afghan Hash CBD 25 %, resine premium au THC inferieur a 0,3 %.",
  },
  {
    id: "resin-le-mousseux",
    slug: "le-mousseux-cbd",
    name: "Le Mousseux CBD",
    category: "resins",
    price: 8.5,
    shortDescription:
      "Resine francaise souple, aromatique, aux notes boisees.",
    longDescription:
      "Le Mousseux CBD apporte une reference plus douce dans la gamme resines. Les donnees source indiquent plus de 11 % de CBD, a confirmer par lot.",
    image: placeholder,
    cbdRate: "11 %",
    cbgRate: "A renseigner",
    thcRate: "< 0,3 %",
    origin: "France",
    cultureType: "Autre",
    aromas: ["Cedre", "Cannelle", "Boise"],
    tags: ["resine", "france", "boise"],
    stock: 15,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    seoTitle: "Le Mousseux CBD - Resine Verdanza",
    seoDescription:
      "Le Mousseux CBD, resine francaise selectionnee par Verdanza.",
  },
  {
    id: "resin-ketama-cbd-cbg",
    slug: "ketama-cbd-cbg",
    name: "Ketama CBD / CBG",
    category: "resins",
    price: 10.9,
    shortDescription:
      "Resine CBD et CBG inspiree du Rif, profil myrte, eucalyptus et girofle.",
    longDescription:
      "Ketama CBD / CBG est retenue pour sa combinaison CBD et CBG. La selection source indique 14 % de CBD et 14 % de CBG, sous reserve de verification par lot.",
    image: placeholder,
    cbdRate: "14 %",
    cbgRate: "14 %",
    thcRate: "< 0,3 %",
    origin: "France",
    cultureType: "Autre",
    aromas: ["Myrte", "Eucalyptus", "Clou de girofle"],
    tags: ["resine", "cbd", "cbg"],
    stock: 13,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: true,
    seoTitle: "Ketama CBD CBG - Resine Verdanza",
    seoDescription:
      "Ketama CBD CBG, resine premium avec taux CBD et CBG renseignes.",
  },
  {
    id: "resin-triple-filtration",
    slug: "triple-filtration-cbd-cbg",
    name: "Triple Filtration CBD & CBG",
    category: "resins",
    price: 13.9,
    shortDescription:
      "Resine triple filtree, texture malleable, notes boisees et epicees.",
    longDescription:
      "Triple Filtration CBD & CBG ferme la selection initiale avec une reference concentree. La fiche source mentionne 21 % de CBD et 23 % de CBG, a confirmer par analyse de lot.",
    image: placeholder,
    cbdRate: "21 %",
    cbgRate: "23 %",
    thcRate: "< 0,3 %",
    origin: "A renseigner",
    cultureType: "Autre",
    aromas: ["Cedre", "Clou de girofle", "Boise"],
    tags: ["resine", "cbd", "cbg", "triple-filtration"],
    stock: 9,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: true,
    seoTitle: "Triple Filtration CBD CBG - Verdanza CBD",
    seoDescription:
      "Triple Filtration CBD CBG, resine premium au THC conforme.",
  },
];

export const featuredProducts = products.filter((product) => product.isFeatured);

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}

export function getProductsByCategory(category: Product["category"]) {
  return products.filter((product) => product.category === category);
}
