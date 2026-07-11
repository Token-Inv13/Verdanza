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
  {
    id: "resin-la-mousse",
    slug: "la-mousse",
    name: "La Mousse",
    category: "resins",
    price: 3,
    shortDescription:
      "Mousse CBD française souple, légère et naturelle, issue de fleurs de CBD sélectionnées.",
    longDescription:
      "La Mousse est une résine CBD française issue d'un travail de sélection, de tamisage et de séparation mécanique des trichomes. Sa texture souple, légère et compacte lui donne une présentation naturelle et authentique.",
    image: "/Fiche produit/La%20mousse/mousse1.webp",
    cbdRate: "Variable selon le lot",
    cbgRate: "Non communiqué",
    thcRate: "< 0,3 %",
    origin: "France",
    cultureType: "Autre",
    aromas: ["Chanvre naturel", "Végétal", "Intense", "Authentique"],
    tags: ["resine", "mousse cbd", "france", "tamisage", "trichomes"],
    stock: 40,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "La Mousse - Résine CBD française Verdanza",
    seoDescription:
      "La Mousse Verdanza, résine CBD française issue de fleurs de CBD sélectionnées, vendue au gramme.",
  },
  {
    id: "flower-mango-haze-cbd",
    slug: "mango-haze-cbd",
    name: "Mango Haze CBD",
    category: "flowers",
    price: 7,
    shortDescription:
      "Fleur CBD hydroponique premium cultivée en Suisse, au profil sucré, fruité et acidulé.",
    longDescription:
      "Une fleur CBD hydroponique premium cultivée en Suisse, sélectionnée pour son profil aromatique gourmand et sa belle qualité visuelle. Grâce à sa culture en hydroponie et à une manucure réalisée à la main, la Mango Haze développe une expression aromatique nette, fruitée et raffinée.",
    image: "/Fiche produit/Mango%20Haze/MangoHaze.webp",
    cbdRate: "Selon analyse producteur",
    cbgRate: "Selon analyse producteur",
    thcRate: "Inférieur au seuil légal",
    origin: "Suisse",
    cultureType: "Hydroponique",
    aromas: ["Sucré", "Fruité", "Acidulé", "Exotique", "Gourmand"],
    tags: ["fleur", "premium", "hydroponique", "suisse", "fruité"],
    productTier: "Premium",
    whyChooseDescription:
      "Mango Haze est pensée pour les amateurs de fleurs fruitées et gourmandes. Son profil sucré, exotique et acidulé en fait une référence idéale pour découvrir une fleur premium hydroponique au caractère doux, aromatique et accessible.",
    advisedProfile:
      "Pour les amateurs de goûts sucrés, fruités et exotiques.",
    experienceDescription:
      "La Mango Haze est une référence idéale pour les clients qui recherchent une fleur premium au goût fruité et sucré. Elle se positionne comme l'une des fleurs les plus gourmandes de la gamme Verdanza, avec un profil accessible mais haut de gamme.",
    comingSoon: true,
    stockStatus: "coming_soon",
    stockLabel: "En arrivage chez Verdanza",
    stock: 0,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    seoTitle: "Mango Haze CBD hydroponique premium - Verdanza",
    seoDescription:
      "Mango Haze CBD hydroponique premium cultivée en Suisse, au profil sucré, fruité et acidulé. En arrivage chez Verdanza.",
  },
  {
    id: "flower-mandarine-cbd",
    slug: "mandarine-cbd",
    name: "Mandarine CBD",
    category: "flowers",
    price: 7,
    shortDescription:
      "Fleur CBD hydroponique au profil frais et fruité, dominé par les agrumes, la mandarine et des notes citronnées.",
    longDescription:
      "Une fleur CBD hydroponique premium cultivée avec précision pour offrir un profil frais, intense et fruité. Son identité aromatique évoque les agrumes, avec une touche acidulée et rafraîchissante qui en fait une référence très expressive.",
    image: "/Fiche produit/Mandarine/mandarine_zoom.webp",
    cbdRate: "Selon analyse producteur",
    cbgRate: "Selon analyse producteur",
    thcRate: "Inférieur au seuil légal",
    origin: "Italie",
    cultureType: "Hydroponique",
    aromas: ["Mandarine", "Agrumes", "Citron", "Pin", "Fruit doux", "Fraîcheur acidulée"],
    tags: ["fleur", "premium", "hydroponique", "italie", "agrumes"],
    productTier: "Premium",
    whyChooseDescription:
      "Mandarine est idéale pour les clients qui recherchent une fleur fraîche, lumineuse et fruitée. Son profil agrume, citronné et légèrement acidulé lui donne une identité aromatique simple à comprendre et agréable à conseiller.",
    advisedProfile:
      "Pour ceux qui aiment les arômes frais, citronnés et agrumes.",
    experienceDescription:
      "La Mandarine est une fleur parfaite pour les clients qui recherchent un produit frais, fruité et premium. Elle apporte une vraie identité aromatique à la gamme Verdanza et se distingue par son côté agrume naturel, facile à comprendre et à conseiller.",
    comingSoon: true,
    stockStatus: "coming_soon",
    stockLabel: "En arrivage chez Verdanza",
    stock: 0,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    seoTitle: "Mandarine CBD hydroponique premium - Verdanza",
    seoDescription:
      "Mandarine CBD hydroponique premium au profil frais, fruité et dominé par les agrumes. En arrivage chez Verdanza.",
  },
  {
    id: "flower-amnesia-cbd-hydroponique",
    slug: "amnesia-cbd-hydroponique",
    name: "Amnesia CBD Hydroponique",
    category: "flowers",
    price: 7,
    shortDescription:
      "Fleur CBD premium à la structure dense et résineuse, avec un profil tonique, boisé et intense.",
    longDescription:
      "Une fleur CBD premium issue d'une culture hydroponique contrôlée, pensée pour les amateurs de variétés classiques et puissantes en arômes. Sa structure dense, compacte et résineuse lui donne une présentation soignée, adaptée à une gamme haut de gamme.",
    image: "/Fiche produit/Amnesia/amnesia_hydro_zoom.webp",
    cbdRate: "Selon analyse producteur",
    cbgRate: "Selon analyse producteur",
    thcRate: "Inférieur au seuil légal",
    origin: "Italie",
    cultureType: "Hydroponique",
    aromas: ["Tonique", "Résineux", "Boisé", "Intense", "Authentique"],
    tags: ["fleur", "premium", "hydroponique", "italie", "amnesia"],
    productTier: "Premium",
    whyChooseDescription:
      "Amnesia est une valeur sûre pour les amateurs de fleurs CBD au profil plus classique, intense et résineux. Elle convient aux clients qui recherchent une fleur premium de caractère, avec une identité aromatique plus profonde que les profils fruités.",
    advisedProfile:
      "Pour les amateurs de fleurs classiques, intenses et résineuses.",
    experienceDescription:
      "L'Amnesia CBD est une valeur sûre pour les clients qui connaissent déjà les fleurs CBD et recherchent un profil plus classique, profond et aromatique. Elle sert de référence premium incontournable dans une sélection Verdanza sérieuse.",
    comingSoon: true,
    stockStatus: "coming_soon",
    stockLabel: "En arrivage chez Verdanza",
    stock: 0,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    seoTitle: "Amnesia CBD hydroponique premium - Verdanza",
    seoDescription:
      "Amnesia CBD hydroponique premium, dense et résineuse, au profil tonique, boisé et intense. En arrivage chez Verdanza.",
  },
  {
    id: "flower-blue-dream-cbd",
    slug: "blue-dream-cbd",
    name: "Blue Dream CBD",
    category: "flowers",
    price: 6,
    shortDescription:
      "Fleur CBD hydroponique premium aux notes citronnées, résineuses et fruitées.",
    longDescription:
      "Une fleur CBD hydroponique premium au profil frais, équilibré et fruité. Sa culture contrôlée permet d'obtenir une fleur compacte, résineuse et soigneusement manucurée, avec une belle expression aromatique autour du citron, du pin et du fruit doux.",
    image: "/Fiche produit/Blue%20Dream/BlueDream.webp",
    cbdRate: "Selon analyse producteur",
    cbgRate: "Selon analyse producteur",
    thcRate: "Inférieur au seuil légal",
    origin: "Italie",
    cultureType: "Hydroponique",
    aromas: ["Citron", "Pin", "Fruit doux", "Fraîcheur végétale", "Équilibré"],
    tags: ["fleur", "premium", "hydroponique", "italie", "citron"],
    productTier: "Premium",
    whyChooseDescription:
      "Blue Dream offre un bon équilibre entre fraîcheur, fruit doux et notes végétales. C'est une fleur premium polyvalente, adaptée aux clients qui veulent une référence aromatique sans profil trop sucré ni trop lourd.",
    advisedProfile:
      "Pour ceux qui veulent une fleur équilibrée, fraîche et légèrement fruitée.",
    experienceDescription:
      "La Blue Dream est une fleur premium polyvalente : fraîche, fruitée, mais moins sucrée que Mango Haze. Elle convient bien aux clients qui veulent une fleur aromatique, propre et équilibrée, sans profil trop lourd.",
    comingSoon: true,
    stockStatus: "coming_soon",
    stockLabel: "En arrivage chez Verdanza",
    stock: 0,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    seoTitle: "Blue Dream CBD hydroponique premium - Verdanza",
    seoDescription:
      "Blue Dream CBD hydroponique premium aux notes citronnées, résineuses et fruitées. En arrivage chez Verdanza.",
  },
  {
    id: "flower-plutonium-cbd-hydroponique",
    slug: "plutonium-cbd-hydroponique",
    name: "Plutonium CBD Hydroponique",
    category: "flowers",
    price: 6,
    shortDescription:
      "Fleur CBD premium cultivée en Suisse, au profil boisé, terreux et épicé.",
    longDescription:
      "Une fleur CBD hydroponique premium au profil profond, dense et aromatique. Cultivée en Suisse, elle se distingue par sa texture compacte, sa richesse naturelle en résine et son identité boisée, terreuse et épicée.",
    image: "/Fiche produit/Plutonium/zoom.webp",
    cbdRate: "Selon analyse producteur",
    cbgRate: "Selon analyse producteur",
    thcRate: "Inférieur au seuil légal",
    origin: "Suisse",
    cultureType: "Hydroponique",
    aromas: ["Boisé", "Terreux", "Épicé", "Chaleureux", "Profond"],
    tags: ["fleur", "premium", "hydroponique", "suisse", "boisé"],
    productTier: "Premium",
    whyChooseDescription:
      "Plutonium s'adresse aux clients qui apprécient les fleurs plus profondes, boisées et terreuses. Son profil plus sombre et épicé en fait une référence de caractère, pensée pour les amateurs de produits plus marqués.",
    advisedProfile:
      "Pour les clients qui préfèrent les profils boisés, terreux et plus profonds.",
    experienceDescription:
      "La Plutonium est la fleur la plus connaisseur de cette sélection. Elle complète les profils fruités comme Mango Haze et Mandarine avec une signature plus sombre, boisée et puissante en bouche.",
    comingSoon: true,
    stockStatus: "coming_soon",
    stockLabel: "En arrivage chez Verdanza",
    stock: 0,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    seoTitle: "Plutonium CBD hydroponique premium - Verdanza",
    seoDescription:
      "Plutonium CBD hydroponique premium cultivée en Suisse, au profil boisé, terreux et épicé. En arrivage chez Verdanza.",
  },
];

export const featuredProducts = products.filter((product) => product.isFeatured);

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}

export function getProductsByCategory(category: Product["category"]) {
  return products.filter((product) => product.category === category);
}
