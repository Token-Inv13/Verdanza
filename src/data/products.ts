import type { Product } from "../types/index.js";

export const products: Product[] = [
  {
    id: "resin-golden-static",
    slug: "golden-static",
    name: "Golden Static",
    category: "resins",
    price: 5.5,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "golden-static-50-10g", totalPrice: 50, quantityGrams: 10, isActive: true, source: "manual", sortOrder: 0 },
    ],
    shortDescription:
      "Résine multi-cannabinoïdes CBD, CBG et CBN, texture crémeuse et profil herbacé puissant.",
    longDescription:
      "Golden Static est une résine multi-cannabinoïdes produite en France, pensée autour d'une composition complète associant CBD, CBG et CBN. Sa texture crémeuse facilite la manipulation et lui donne une présentation sombre, dense et travaillée. Son profil aromatique reste puissant, herbacé, végétal et authentique, avec une identité plus technique que les résines classiques de la sélection.",
    image: "/Fiche produit/Golden static/goldenstatic.webp",
    imageAlt: "Résine CBD Golden Static Verdanza, blocs sombres à texture crémeuse",
    images: [
      {
        id: "golden-static-primary",
        url: "/Fiche produit/Golden static/goldenstatic.webp",
        alt: "Résine CBD Golden Static Verdanza, blocs sombres à texture crémeuse",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "golden-static-composition",
        url: "/Fiche produit/Golden static/Composition-ezgif.com-resize.webp",
        alt: "Résine Golden Static Verdanza entière sur fond clair",
        sortOrder: 1,
        isPrimary: false,
      },
      {
        id: "golden-static-texture",
        url: "/Fiche produit/Golden static/DSC02266copie.webp",
        alt: "Texture intérieure de la résine Golden Static Verdanza",
        sortOrder: 2,
        isPrimary: false,
      },
    ],
    cbdRate: "50 %",
    cbgRate: "10 %",
    cbnRate: "10 %",
    thcRate: "< 0,2 %",
    origin: "France",
    qualitySealEnabled: true,
    cultureType: "Autre",
    texture: "Crémeuse, dense, travaillée",
    aromas: ["Puissant", "Herbacé", "Végétal", "Authentique"],
    tags: ["résine", "cbd", "cbg", "cbn", "france"],
    productTier: "Premium",
    whyChooseDescription:
      "Golden Static s'adresse aux clients qui veulent une résine plus technique, avec plusieurs cannabinoïdes annoncés et un profil aromatique franc. Sa composition CBD, CBG et CBN la distingue des références plus simples de la gamme.",
    advisedProfile:
      "Pour les amateurs de résines premium au profil herbacé, végétal et plus technique.",
    experienceDescription:
      "Une référence moderne et complète, à positionner pour les clients qui souhaitent découvrir une résine marquée par la présence de plusieurs cannabinoïdes annoncés.",
    stock: 25,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: true,
    seoTitle: "Golden Static - Résine CBD CBG CBN premium | Verdanza",
    seoDescription:
      "Golden Static Verdanza, résine française multi-cannabinoïdes avec 50 % CBD, 10 % CBG, 10 % CBN et profil herbacé puissant.",
  },
  {
    id: "resin-supreme-purple-cbd",
    slug: "supreme-purple-cbd",
    name: "Suprême Purple CBD",
    category: "resins",
    price: 5,
    fixedPriceMode: "disabled",
    shortDescription:
      "Résine CBD premium française, compacte et légèrement friable, au profil terreux et fruité.",
    longDescription:
      "Suprême Purple CBD est une résine CBD premium produite en France, actuellement indisponible dans la boutique. Sa fiche confirme une concentration annoncée de 50 % de CBD, une texture compacte et légèrement friable, ainsi qu'un profil aromatique terreux et végétal relevé par des accents de raisin doux et d'épices. Son identité est plus intense et fruitée que les résines végétales ou boisées de la sélection.",
    image: "/Fiche produit/Supreme Purple CBD/SUPREMEPURPLEcopieffff.webp",
    imageAlt: "Résine CBD Suprême Purple Verdanza, bloc compact brun à texture friable",
    cbdRate: "50 %",
    cbgRate: "Non communiqué",
    thcRate: "< 0,2 %",
    origin: "France",
    cultureType: "Autre",
    texture: "Compacte, légèrement friable",
    aromas: ["Terreux", "Végétal", "Raisin doux", "Épicé"],
    tags: ["résine", "cbd", "france", "selection"],
    productTier: "Premium",
    whyChooseDescription:
      "Suprême Purple se distingue par son profil aromatique plus fruité et épicé, tout en conservant une base terreuse et végétale. Elle complète les résines plus crémeuses, herbacées ou traditionnelles de la sélection.",
    advisedProfile:
      "Pour les clients qui recherchent une résine française compacte, intense et aromatique. Produit actuellement en rupture de stock.",
    experienceDescription:
      "Une résine au caractère affirmé, pensée pour apporter une alternative plus fruitée dans la gamme premium Verdanza lorsque le stock est disponible.",
    stock: 0,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: true,
    seoTitle: "Suprême Purple - Résine CBD française premium | Verdanza",
    seoDescription:
      "Suprême Purple Verdanza, résine CBD française à 50 % de CBD, texture compacte et profil terreux, végétal, fruité et épicé.",
  },
  {
    id: "resin-supreme-50-cbd",
    slug: "supreme-50-cbd",
    name: "Suprême 50 % CBD",
    category: "resins",
    price: 6,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "supreme-50-cbd-40-7g", totalPrice: 40, quantityGrams: 7, isActive: true, source: "manual", sortOrder: 0 },
      { id: "supreme-50-cbd-50-9g", totalPrice: 50, quantityGrams: 9, isActive: true, source: "manual", sortOrder: 1 },
      { id: "supreme-50-cbd-60-11g", totalPrice: 60, quantityGrams: 11, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Résine CBD premium fabriquée en Savoie, texture dense et profil floral délicat.",
    longDescription:
      "La Suprême 50 % CBD est une résine artisanale française élaborée en Savoie à partir d'extraits de chanvre sélectionnés. Sa formulation broad spectrum conserve naturellement plusieurs cannabinoïdes, notamment le CBN, le CBG et le CBC, sans THC annoncé. Visuellement, elle présente une teinte brun caramel doré, une surface compacte et un intérieur finement granuleux. Sa texture dense, homogène et malléable facilite sa manipulation et participe à son aspect qualitatif. Son profil aromatique se distingue par des notes florales légères et raffinées. Les arômes sont annoncés comme naturels et sans ajout artificiel. Conserver dans son emballage hermétique, dans un endroit frais et sec, à l'abri de la lumière, de la chaleur et des variations importantes de température.",
    image: "/Fiche produit/Supreme/supreme-50-cbd.webp",
    imageAlt: "Résine CBD Suprême 50 % Verdanza, plaques brun caramel",
    images: [
      {
        id: "supreme-50-primary",
        url: "/Fiche produit/Supreme/supreme-50-cbd.webp",
        alt: "Résine CBD Suprême 50 % Verdanza, plaques brun caramel",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "supreme-50-texture",
        url: "/Fiche produit/Supreme/supreme-50-cbd-texture.webp",
        alt: "Texture intérieure de la résine Suprême 50 % CBD Verdanza",
        sortOrder: 1,
        isPrimary: false,
      },
    ],
    cbdRate: "50 %",
    cbgRate: "Non communiqué",
    thcRate: "0 %",
    origin: "France",
    cultureType: "Autre",
    texture: "Dense, homogène et malléable",
    aromas: ["Floral", "Délicat", "Léger", "Raffiné"],
    tags: ["résine", "cbd", "france", "savoie", "broad spectrum", "cbn", "cbg", "cbc"],
    productTier: "Premium",
    qualitySealEnabled: true,
    whyChooseDescription:
      "La Suprême se distingue par sa concentration annoncée de 50 % de CBD, sa formulation broad spectrum et son identité florale délicate. Elle complète les résines plus crémeuses, terreuses ou traditionnelles de la sélection Verdanza.",
    advisedProfile:
      "Pour les amateurs de résines premium françaises au profil floral léger et raffiné.",
    experienceDescription:
      "Une résine française au caractère fin et élégant, destinée aux clients qui recherchent une forte concentration en CBD et une identité aromatique légère.",
    stock: 22,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "Suprême 50 % CBD – Résine premium française | Verdanza",
    seoDescription:
      "Découvrez la Suprême, une résine CBD premium fabriquée en Savoie : 50 % de CBD, broad spectrum, 0 % de THC annoncé et profil floral délicat.",
  },
  {
    id: "flower-cookie-kush-indoor",
    slug: "cookie-kush-indoor",
    name: "Cookie Kush Indoor",
    category: "flowers",
    price: 4.5,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "cookie-kush-30-7g", totalPrice: 30, quantityGrams: 7, isActive: true, source: "manual", sortOrder: 0 },
      { id: "cookie-kush-50-12g", totalPrice: 50, quantityGrams: 12, isActive: true, source: "manual", sortOrder: 1 },
    ],
    shortDescription:
      "Fleur CBD indoor italienne, gourmande et sucrée, à la présentation régulière.",
    longDescription:
      "Cookie Kush Indoor est une fleur CBD cultivée en intérieur en Italie. Sa culture indoor permet une meilleure maîtrise des conditions de production et une belle régularité visuelle. Elle développe un profil gourmand, sucré, sirupeux et rond, avec une expression aromatique douce et une présentation soignée.",
    image: "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-zoom.webp",
    imageAlt: "Fleur CBD Cookie Kush Indoor Verdanza, têtes vertes compactes",
    images: [
      {
        id: "cookie-kush-primary",
        url: "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-zoom.webp",
        alt: "Fleur CBD Cookie Kush Indoor Verdanza, têtes vertes compactes",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "cookie-kush-pile",
        url: "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-pile.webp",
        alt: "Ensemble de fleurs Cookie Kush Indoor Verdanza",
        sortOrder: 1,
        isPrimary: false,
      },
      {
        id: "cookie-kush-detail",
        url: "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie_04-02-25-ezgif.com-optimize.webp",
        alt: "Détail d'une fleur Cookie Kush Indoor Verdanza",
        sortOrder: 2,
        isPrimary: false,
      },
    ],
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "< 0,2 %",
    origin: "Italie",
    cultureType: "Indoor",
    texture: "Têtes soignées, régulières",
    aromas: ["Sucré", "Sirupeux", "Gourmand", "Rond"],
    tags: ["fleur", "indoor", "italie", "gourmand"],
    productTier: "Premium",
    whyChooseDescription:
      "Cookie Kush Indoor est la référence la plus gourmande de la sélection fleurs. Sa culture intérieure confirmée et son profil sucré en font une option plus premium qu'une greenhouse classique.",
    advisedProfile:
      "Pour les clients qui recherchent une fleur CBD douce, aromatique et sucrée.",
    experienceDescription:
      "Une fleur accessible mais soignée, pensée pour les amateurs de profils gourmands qui veulent une présentation régulière et une identité aromatique ronde.",
    stock: 15,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: true,
    seoTitle: "Cookie Kush Indoor - Fleur CBD italienne | Verdanza",
    seoDescription:
      "Cookie Kush Indoor Verdanza, fleur CBD cultivée en intérieur en Italie, profil gourmand, sucré, sirupeux et rond.",
  },
  {
    id: "flower-petites-tetes-og-kush",
    slug: "petites-tetes-og-kush",
    name: "Petites Têtes OG Kush",
    category: "flowers",
    price: 4,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "petites-tetes-og-kush-35-9g", totalPrice: 35, quantityGrams: 9, isActive: true, source: "manual", sortOrder: 0 },
      { id: "petites-tetes-og-kush-45-12g", totalPrice: 45, quantityGrams: 12, isActive: true, source: "manual", sortOrder: 1 },
      { id: "petites-tetes-og-kush-55-15g", totalPrice: 55, quantityGrams: 15, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Fleur CBD greenhouse italienne, fraîche, intense et équilibrée, en petites têtes.",
    longDescription:
      "Petites Têtes OG Kush est une fleur CBD cultivée en Italie sous serre. Elle se présente en petites têtes au profil frais, direct et équilibré. Sa fiche met en avant des notes de menthe fraîche, d'agrumes et de fraîcheur végétale, avec une intensité aromatique nette.",
    image: "/Fiche produit/Petite tetes OG Kush ( sous serre)/PTOGKush_zoom.webp",
    imageAlt: "Petites têtes de fleur CBD OG Kush Verdanza, fleurs greenhouse italiennes",
    images: [
      {
        id: "petites-tetes-og-kush-primary",
        url: "/Fiche produit/Petite tetes OG Kush ( sous serre)/PTOGKush_zoom.webp",
        alt: "Petites têtes de fleur CBD OG Kush Verdanza, fleurs greenhouse italiennes",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "petites-tetes-og-kush-pile",
        url: "/Fiche produit/Petite tetes OG Kush ( sous serre)/PTOGKush_pile.webp",
        alt: "Ensemble de petites têtes OG Kush CBD Verdanza",
        sortOrder: 1,
        isPrimary: false,
      },
    ],
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "< 0,2 %",
    origin: "Italie",
    cultureType: "Sous-serre",
    texture: "Petites têtes compactes",
    aromas: ["Menthe fraîche", "Agrumes", "Fraîcheur végétale", "Intense"],
    tags: ["fleur", "greenhouse", "sous-serre", "italie", "og-kush"],
    productTier: "Premium",
    whyChooseDescription:
      "OG Kush convient aux clients qui veulent une fleur greenhouse fraîche et directe, avec une identité aromatique plus vive que les profils boisés ou gourmands.",
    advisedProfile:
      "Pour les amateurs de fleurs CBD fraîches, intenses et équilibrées.",
    experienceDescription:
      "Une référence accessible et qualitative, pensée pour compléter les fleurs plus premium sans perdre en fraîcheur aromatique.",
    stock: 15,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: true,
    seoTitle: "OG Kush - Fleur CBD greenhouse italienne | Verdanza",
    seoDescription:
      "OG Kush Verdanza, fleur CBD greenhouse italienne en petites têtes, profil menthe fraîche, agrumes et fraîcheur végétale.",
  },
  {
    id: "flower-harlequin-greenhouse",
    slug: "harlequin-greenhouse",
    name: "Harlequin Greenhouse",
    category: "flowers",
    price: 4,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "harlequin-greenhouse-35-9g", totalPrice: 35, quantityGrams: 9, isActive: true, source: "manual", sortOrder: 0 },
      { id: "harlequin-greenhouse-45-12g", totalPrice: 45, quantityGrams: 12, isActive: true, source: "manual", sortOrder: 1 },
      { id: "harlequin-greenhouse-55-15g", totalPrice: 55, quantityGrams: 15, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Fleur CBD greenhouse italienne, naturelle et ronde, au profil boisé et torréfié.",
    longDescription:
      "Harlequin Greenhouse est une fleur CBD cultivée en Italie sous serre. Son profil est plus profond, mature et naturel que les références gourmandes. Elle développe des notes de musc, de sous-bois, de sésame et de touches torréfiées, avec une rondeur aromatique marquée.",
    image: "/Fiche produit/Harlequin (sous-serre)/harlequin_zoom.webp",
    imageAlt: "Fleur CBD Harlequin Greenhouse Verdanza, têtes italiennes sous serre",
    images: [
      {
        id: "harlequin-primary",
        url: "/Fiche produit/Harlequin (sous-serre)/harlequin_zoom.webp",
        alt: "Fleur CBD Harlequin Greenhouse Verdanza, têtes italiennes sous serre",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "harlequin-pile",
        url: "/Fiche produit/Harlequin (sous-serre)/harlequin_pile.webp",
        alt: "Ensemble de fleurs Harlequin Greenhouse Verdanza",
        sortOrder: 1,
        isPrimary: false,
      },
      {
        id: "harlequin-detail",
        url: "/Fiche produit/Harlequin (sous-serre)/harlequin_20-02-25-ezgif.com-optimize.webp",
        alt: "Détail d'une fleur Harlequin Greenhouse Verdanza",
        sortOrder: 2,
        isPrimary: false,
      },
    ],
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "< 0,2 %",
    origin: "Italie",
    cultureType: "Sous-serre",
    texture: "Têtes mûres et plus boisées",
    aromas: ["Musc", "Sous-bois", "Notes torréfiées", "Sésame", "Rondeur"],
    tags: ["fleur", "greenhouse", "sous-serre", "italie", "harlequin"],
    productTier: "Premium",
    whyChooseDescription:
      "Harlequin Greenhouse apporte un profil plus naturel, profond et boisé dans la sélection. Elle équilibre les fleurs plus sucrées comme Cookie Kush et les profils plus frais comme OG Kush.",
    advisedProfile:
      "Pour les clients qui préfèrent les fleurs CBD rondes, boisées et moins sucrées.",
    experienceDescription:
      "Une fleur mature et équilibrée, très complémentaire des profils plus gourmands ou plus frais de la gamme Verdanza.",
    stock: 16,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "Harlequin Greenhouse - Fleur CBD italienne | Verdanza",
    seoDescription:
      "Harlequin Greenhouse Verdanza, fleur CBD sous serre italienne au profil musc, sous-bois, sésame et notes torréfiées.",
  },
  {
    id: "resin-la-mousse",
    slug: "la-mousse",
    name: "La Mousse",
    category: "resins",
    price: 2,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "la-mousse-25-13g", totalPrice: 25, quantityGrams: 13, isActive: true, source: "manual", sortOrder: 0 },
      { id: "la-mousse-30-16g", totalPrice: 30, quantityGrams: 16, isActive: true, source: "manual", sortOrder: 1 },
      { id: "la-mousse-40-22g", totalPrice: 40, quantityGrams: 22, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Mousse CBD française issue de trichomes, souple, légère, compacte et végétale.",
    longDescription:
      "La Mousse est une résine CBD française fabriquée à partir de fleurs de CBD sélectionnées. Elle est issue d'un travail de tamisage et de séparation mécanique des trichomes, sans mention d'extraction par solvant. Sa texture souple, légère et compacte lui donne une présentation naturelle, végétale et authentique, avec un taux de CBD variable selon le lot.",
    image: "/Fiche produit/La%20mousse/mousse1.webp",
    imageAlt: "Mousse CBD Verdanza, résine française claire en texture poudreuse compacte",
    cbdRate: "Variable selon le lot",
    cbgRate: "Non communiqué",
    thcRate: "< 0,3 %",
    origin: "France",
    cultureType: "Autre",
    texture: "Souple, légère, compacte",
    aromas: ["Chanvre naturel", "Végétal", "Intense", "Authentique"],
    tags: ["resine", "mousse cbd", "france", "tamisage", "trichomes"],
    productTier: "Premium",
    qualitySealEnabled: true,
    whyChooseDescription:
      "La Mousse est une référence accessible pour les clients qui recherchent une résine française simple, végétale et naturelle, avec une texture plus légère que les blocs de résine classiques.",
    advisedProfile:
      "Pour les amateurs de résines souples, végétales et authentiques.",
    experienceDescription:
      "Un profil simple, équilibré et qualitatif, utile pour découvrir une résine française à base de trichomes sans aller vers une référence plus technique ou plus concentrée.",
    stock: 60,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "La Mousse - Mousse CBD française | Verdanza",
    seoDescription:
      "La Mousse Verdanza, mousse CBD française issue de fleurs sélectionnées, texture souple, légère et compacte.",
  },
  {
    id: "resin-3x-filtre-cbd-cbg",
    slug: "3x-filtre-cbd-cbg",
    name: "3X Filtré CBD/CBG",
    category: "resins",
    price: 6,
    shortDescription:
      "Résine CBD/CBG sélectionnée, triple filtration, profil cèdre, girofle et notes poivrées.",
    longDescription:
      "Une résine travaillée selon un processus de triple filtration, pensée pour offrir un profil plus pur, plus net et plus technique. Son équilibre CBD/CBG et ses arômes puissants en font une référence destinée aux amateurs de résines de caractère.",
    image: "/Fiche produit/3X%20Filtr%C3%A9%20CBD%20CBG/3X%20Filtr%C3%A9.webp",
    cbdRate: "21 %",
    cbgRate: "23 %",
    thcRate: "Inférieur au seuil légal",
    origin: "France",
    cultureType: "Autre",
    texture: "Neutre / travaillée",
    aromas: ["Cèdre", "Girofle", "Poivré", "Puissant", "Boisé"],
    tags: ["résine", "selection", "cbd", "cbg", "france", "triple filtration"],
    productTier: "Premium",
    qualitySealEnabled: true,
    whyChooseDescription:
      "3X Filtré est une référence intéressante pour les clients qui recherchent une résine plus technique, avec une vraie notion de filtration et un profil aromatique plus sec, boisé et poivré.",
    advisedProfile:
      "Pour les amateurs de résines techniques, boisées et poivrées.",
    experienceDescription:
      "À proposer comme produit connaisseur, moins gourmand que Creamy Piatella et moins fruité que Suprême Purple, mais très pertinent pour construire une gamme résine sérieuse et cohérente.",
    stock: 0,
    lowStockThreshold: 5,
    isActive: false,
    isFeatured: false,
    seoTitle: "3X Filtré CBD/CBG - Résine sélectionnée Verdanza",
    seoDescription:
      "3X Filtré CBD/CBG Verdanza, résine française à triple filtration au profil cèdre, girofle et poivré.",
  },
  {
    id: "resin-le-beldia-cbn-cbd",
    slug: "le-beldia-cbn-cbd",
    name: "Le Beldia CBN + CBD",
    category: "resins",
    price: 6,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "le-beldia-cbn-cbd-40-7g", totalPrice: 40, quantityGrams: 7, isActive: true, source: "manual", sortOrder: 0 },
      { id: "le-beldia-cbn-cbd-50-9g", totalPrice: 50, quantityGrams: 9, isActive: true, source: "manual", sortOrder: 1 },
      { id: "le-beldia-cbn-cbd-60-11g", totalPrice: 60, quantityGrams: 11, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Résine CBD + CBN sélectionnée, texture malléable, profil terreux, épicé et boisé.",
    longDescription:
      "Une résine sélectionnée inspirée des profils traditionnels Beldia, revisitée avec une composition moderne associant CBD et CBN. Sa texture malléable et légèrement grasse lui donne un caractère authentique, proche des résines classiques appréciées des connaisseurs.",
    image: "/Fiche produit/Le%20Beldia/beldia.webp",
    images: [
      {
        id: "le-beldia-primary",
        url: "/Fiche produit/Le%20Beldia/beldia.webp",
        alt: "Résine Le Beldia CBN et CBD Verdanza",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "le-beldia-block",
        url: "/Fiche produit/Le%20Beldia/beldia-.webp",
        alt: "Bloc de résine Le Beldia CBN et CBD Verdanza",
        sortOrder: 1,
        isPrimary: false,
      },
      {
        id: "le-beldia-texture",
        url: "/Fiche produit/Le%20Beldia/beldia2.jpg",
        alt: "Texture intérieure de la résine Le Beldia Verdanza",
        sortOrder: 2,
        isPrimary: false,
      },
    ],
    cbdRate: "40 %",
    cbgRate: "Non communiqué",
    cbnRate: "20 %",
    thcRate: "Inférieur au seuil légal",
    origin: "France",
    cultureType: "Autre",
    texture: "Malléable, légèrement grasse",
    aromas: ["Terreux", "Épicé", "Boisé", "Profond", "Traditionnel"],
    tags: ["résine", "selection", "cbd", "cbn", "france", "beldia"],
    productTier: "Premium",
    whyChooseDescription:
      "Le Beldia est une référence idéale pour les clients qui aiment les résines au profil traditionnel, plus sombre et plus profond. Sa composition CBD + CBN lui donne une vraie différence par rapport aux résines plus simples.",
    advisedProfile:
      "Pour les amateurs de résines traditionnelles, boisées et profondes.",
    experienceDescription:
      "À proposer comme résine connaisseur, avec une identité plus classique, boisée et épicée. Elle complète parfaitement les profils plus crémeux ou fruités comme Creamy Piatella et Suprême Purple.",
    stock: 18,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "Le Beldia CBN + CBD - Résine sélectionnée Verdanza",
    seoDescription:
      "Le Beldia CBN + CBD Verdanza, résine française à la texture malléable et au profil terreux, épicé et boisé.",
  },
  {
    id: "resin-creamy-piatella-cbd",
    slug: "creamy-piatella-cbd",
    name: "Creamy Piatella CBD",
    category: "resins",
    price: 6,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "creamy-piatella-cbd-40-7g", totalPrice: 40, quantityGrams: 7, isActive: true, source: "manual", sortOrder: 0 },
      { id: "creamy-piatella-cbd-50-9g", totalPrice: 50, quantityGrams: 9, isActive: true, source: "manual", sortOrder: 1 },
      { id: "creamy-piatella-cbd-60-11g", totalPrice: 60, quantityGrams: 11, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Résine CBD travaillée, texture crémeuse, profil sucré, terreux et boisé.",
    longDescription:
      "Une résine CBD à la texture beurrée et crémeuse, travaillée pour offrir une présentation dense, souple et raffinée. Sa fabrication française et son affinage à froid lui donnent une identité haut de gamme, pensée pour les amateurs de résines riches et aromatiques.",
    image: "/Fiche produit/Creamy%20Piatella/piatella.webp",
    cbdRate: "70 %",
    cbgRate: "Non communiqué",
    thcRate: "Inférieur au seuil légal",
    origin: "France",
    cultureType: "Autre",
    texture: "Beurrée, crémeuse, malléable",
    aromas: ["Crémeux", "Sucré", "Terreux", "Boisé", "Floral"],
    tags: ["résine", "travaillée", "cbd", "france", "piatella"],
    productTier: "Ultra premium",
    qualitySealEnabled: true,
    whyChooseDescription:
      "Creamy Piatella est la référence la plus travaillée de cette sélection. Sa texture crémeuse, son fort taux de CBD annoncé et son profil aromatique doux et boisé en font un produit vitrine pour la gamme résines Verdanza.",
    advisedProfile:
      "Pour les amateurs de résines haut de gamme, crémeuses et aromatiques.",
    experienceDescription:
      "À proposer aux clients qui recherchent une résine haut de gamme, visuellement qualitative, facile à présenter et plus raffinée qu'une résine classique.",
    stock: 22,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "Creamy Piatella CBD - Résine travaillée Verdanza",
    seoDescription:
      "Creamy Piatella CBD Verdanza, résine CBD travaillée française à la texture crémeuse et au profil sucré, terreux et boisé.",
  },
  {
    id: "flower-mango-haze-cbd",
    slug: "mango-haze-cbd",
    name: "Mango Haze CBD",
    category: "flowers",
    price: 6,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "mango-haze-cbd-40-7g", totalPrice: 40, quantityGrams: 7, isActive: true, source: "manual", sortOrder: 0 },
      { id: "mango-haze-cbd-50-9g", totalPrice: 50, quantityGrams: 9, isActive: true, source: "manual", sortOrder: 1 },
      { id: "mango-haze-cbd-60-11g", totalPrice: 60, quantityGrams: 11, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Fleur CBD hydroponique cultivée en Suisse, au profil sucré, fruité et acidulé.",
    longDescription:
      "Une fleur CBD hydroponique cultivée en Suisse, sélectionnée pour son profil aromatique gourmand et sa belle qualité visuelle. Grâce à sa culture en hydroponie et à une manucure réalisée à la main, la Mango Haze développe une expression aromatique nette, fruitée et raffinée.",
    image: "/Fiche produit/Mango%20Haze/MangoHaze.webp",
    images: [
      {
        id: "mango-haze-primary",
        url: "/Fiche produit/Mango%20Haze/MangoHaze.webp",
        alt: "Fleur Mango Haze CBD Verdanza",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "mango-haze-pile",
        url: "/Fiche produit/Mango%20Haze/mango.webp",
        alt: "Ensemble de fleurs Mango Haze CBD Verdanza",
        sortOrder: 1,
        isPrimary: false,
      },
    ],
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "Inférieur au seuil légal",
    origin: "Suisse",
    cultureType: "Hydroponique",
    aromas: ["Sucré", "Fruité", "Acidulé", "Exotique", "Gourmand"],
    tags: ["fleur", "selection", "hydroponique", "suisse", "fruité"],
    productTier: "Premium",
    qualitySealEnabled: true,
    whyChooseDescription:
      "Mango Haze est pensée pour les amateurs de fleurs fruitées et gourmandes. Son profil sucré, exotique et acidulé en fait une référence idéale pour découvrir une fleur hydroponique sélectionnée au caractère doux, aromatique et accessible.",
    advisedProfile:
      "Pour les amateurs de goûts sucrés, fruités et exotiques.",
    experienceDescription:
      "La Mango Haze est une référence idéale pour les clients qui recherchent une fleur sélectionnée au goût fruité et sucré. Elle se positionne comme l'une des fleurs les plus gourmandes de la gamme Verdanza, avec un profil accessible mais haut de gamme.",
    stock: 22,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "Mango Haze CBD hydroponique - Verdanza",
    seoDescription:
      "Mango Haze CBD hydroponique cultivée en Suisse, au profil sucré, fruité et acidulé.",
  },
  {
    id: "flower-mandarine-cbd",
    slug: "mandarine-cbd",
    name: "Mandarine CBD",
    category: "flowers",
    price: 6,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "mandarine-cbd-40-7g", totalPrice: 40, quantityGrams: 7, isActive: true, source: "manual", sortOrder: 0 },
      { id: "mandarine-cbd-50-9g", totalPrice: 50, quantityGrams: 9, isActive: true, source: "manual", sortOrder: 1 },
      { id: "mandarine-cbd-60-11g", totalPrice: 60, quantityGrams: 11, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Fleur CBD hydroponique au profil frais et fruité, dominé par les agrumes, la mandarine et des notes citronnées.",
    longDescription:
      "Une fleur CBD hydroponique cultivée avec précision pour offrir un profil frais, intense et fruité. Son identité aromatique évoque les agrumes, avec une touche acidulée et rafraîchissante qui en fait une référence très expressive.",
    image: "/Fiche produit/Mandarine/mandarine_zoom.webp",
    images: [
      {
        id: "mandarine-primary",
        url: "/Fiche produit/Mandarine/mandarine_zoom.webp",
        alt: "Fleur Mandarine CBD Verdanza",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "mandarine-pile",
        url: "/Fiche produit/Mandarine/Mandarine_pile.webp",
        alt: "Ensemble de fleurs Mandarine CBD Verdanza",
        sortOrder: 1,
        isPrimary: false,
      },
    ],
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "Inférieur au seuil légal",
    origin: "Italie",
    cultureType: "Hydroponique",
    aromas: ["Mandarine", "Agrumes", "Citron", "Pin", "Fruit doux", "Fraîcheur acidulée"],
    tags: ["fleur", "selection", "hydroponique", "italie", "agrumes"],
    productTier: "Premium",
    qualitySealEnabled: true,
    whyChooseDescription:
      "Mandarine est idéale pour les clients qui recherchent une fleur fraîche, lumineuse et fruitée. Son profil agrume, citronné et légèrement acidulé lui donne une identité aromatique simple à comprendre et agréable à conseiller.",
    advisedProfile:
      "Pour ceux qui aiment les arômes frais, citronnés et agrumes.",
    experienceDescription:
      "La Mandarine est une fleur parfaite pour les clients qui recherchent un produit frais, fruité et soigné. Elle apporte une vraie identité aromatique à la gamme Verdanza et se distingue par son côté agrume naturel, facile à comprendre et à conseiller.",
    stock: 22,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "Mandarine CBD hydroponique - Verdanza",
    seoDescription:
      "Mandarine CBD hydroponique au profil frais, fruité et dominé par les agrumes.",
  },
  {
    id: "flower-amnesia-cbd-hydroponique",
    slug: "amnesia-cbd-hydroponique",
    name: "Amnesia CBD Hydroponique",
    category: "flowers",
    price: 6,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "amnesia-cbd-hydroponique-40-7g", totalPrice: 40, quantityGrams: 7, isActive: true, source: "manual", sortOrder: 0 },
      { id: "amnesia-cbd-hydroponique-50-9g", totalPrice: 50, quantityGrams: 9, isActive: true, source: "manual", sortOrder: 1 },
      { id: "amnesia-cbd-hydroponique-60-11g", totalPrice: 60, quantityGrams: 11, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Fleur CBD à la structure dense et résineuse, avec un profil tonique, boisé et intense.",
    longDescription:
      "Une fleur CBD issue d'une culture hydroponique contrôlée, pensée pour les amateurs de variétés classiques et puissantes en arômes. Sa structure dense, compacte et résineuse lui donne une présentation soignée, adaptée à une gamme haut de gamme.",
    image: "/Fiche produit/Amnesia/amnesia_hydro_zoom.webp",
    images: [
      {
        id: "amnesia-primary",
        url: "/Fiche produit/Amnesia/amnesia_hydro_zoom.webp",
        alt: "Fleur Amnesia CBD hydroponique Verdanza",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "amnesia-pile",
        url: "/Fiche produit/Amnesia/amnesia_hydro_pile.webp",
        alt: "Ensemble de fleurs Amnesia CBD hydroponique Verdanza",
        sortOrder: 1,
        isPrimary: false,
      },
    ],
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "Inférieur au seuil légal",
    origin: "Italie",
    cultureType: "Hydroponique",
    aromas: ["Tonique", "Résineux", "Boisé", "Intense", "Authentique"],
    tags: ["fleur", "selection", "hydroponique", "italie", "amnesia"],
    productTier: "Premium",
    qualitySealEnabled: true,
    whyChooseDescription:
      "Amnesia est une valeur sûre pour les amateurs de fleurs CBD au profil plus classique, intense et résineux. Elle convient aux clients qui recherchent une fleur sélectionnée de caractère, avec une identité aromatique plus profonde que les profils fruités.",
    advisedProfile:
      "Pour les amateurs de fleurs classiques, intenses et résineuses.",
    experienceDescription:
      "L'Amnesia CBD est une valeur sûre pour les clients qui connaissent déjà les fleurs CBD et recherchent un profil plus classique, profond et aromatique. Elle sert de référence sélectionnée incontournable dans une sélection Verdanza cohérente.",
    stock: 22,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "Amnesia CBD hydroponique - Verdanza",
    seoDescription:
      "Amnesia CBD hydroponique, dense et résineuse, au profil tonique, boisé et intense.",
  },
  {
    id: "flower-blue-dream-cbd",
    slug: "blue-dream-cbd",
    name: "Blue Dream CBD",
    category: "flowers",
    price: 6,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "blue-dream-cbd-40-7g", totalPrice: 40, quantityGrams: 7, isActive: true, source: "manual", sortOrder: 0 },
      { id: "blue-dream-cbd-50-9g", totalPrice: 50, quantityGrams: 9, isActive: true, source: "manual", sortOrder: 1 },
      { id: "blue-dream-cbd-60-11g", totalPrice: 60, quantityGrams: 11, isActive: true, source: "manual", sortOrder: 2 },
    ],
    shortDescription:
      "Fleur CBD hydroponique aux notes citronnées, résineuses et fruitées.",
    longDescription:
      "Une fleur CBD hydroponique au profil frais, équilibré et fruité. Sa culture contrôlée permet d'obtenir une fleur compacte, résineuse et soigneusement manucurée, avec une belle expression aromatique autour du citron, du pin et du fruit doux.",
    image: "/Fiche produit/Blue%20Dream/BlueDream.webp",
    images: [
      {
        id: "blue-dream-primary",
        url: "/Fiche produit/Blue%20Dream/BlueDream.webp",
        alt: "Fleur Blue Dream CBD Verdanza",
        sortOrder: 0,
        isPrimary: true,
      },
      {
        id: "blue-dream-pile",
        url: "/Fiche produit/Blue%20Dream/bl.webp",
        alt: "Ensemble de fleurs Blue Dream CBD Verdanza",
        sortOrder: 1,
        isPrimary: false,
      },
    ],
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "Inférieur au seuil légal",
    origin: "Italie",
    cultureType: "Hydroponique",
    aromas: ["Citron", "Pin", "Fruit doux", "Fraîcheur végétale", "Équilibré"],
    tags: ["fleur", "selection", "hydroponique", "italie", "citron"],
    productTier: "Premium",
    whyChooseDescription:
      "Blue Dream offre un bon équilibre entre fraîcheur, fruit doux et notes végétales. C'est une fleur sélectionnée polyvalente, adaptée aux clients qui veulent une référence aromatique sans profil trop sucré ni trop lourd.",
    advisedProfile:
      "Pour ceux qui veulent une fleur équilibrée, fraîche et légèrement fruitée.",
    experienceDescription:
      "La Blue Dream est une fleur sélectionnée polyvalente : fraîche, fruitée, mais moins sucrée que Mango Haze. Elle convient bien aux clients qui veulent une fleur aromatique, propre et équilibrée, sans profil trop lourd.",
    stock: 22,
    lowStockThreshold: 10,
    isActive: true,
    isFeatured: false,
    seoTitle: "Blue Dream CBD hydroponique - Verdanza",
    seoDescription:
      "Blue Dream CBD hydroponique aux notes citronnées, résineuses et fruitées.",
  },
  {
    id: "flower-plutonium-cbd-hydroponique",
    slug: "plutonium-cbd-hydroponique",
    name: "Plutonium CBD Hydroponique",
    category: "flowers",
    price: 6,
    shortDescription:
      "Fleur CBD cultivée en Suisse, au profil boisé, terreux et épicé.",
    longDescription:
      "Une fleur CBD hydroponique au profil profond, dense et aromatique. Cultivée en Suisse, elle se distingue par sa texture compacte, sa richesse naturelle en résine et son identité boisée, terreuse et épicée.",
    image: "/Fiche produit/Plutonium/zoom.webp",
    cbdRate: "Non communiqué",
    cbgRate: "Non communiqué",
    thcRate: "Inférieur au seuil légal",
    origin: "Suisse",
    cultureType: "Hydroponique",
    aromas: ["Boisé", "Terreux", "Épicé", "Chaleureux", "Profond"],
    tags: ["fleur", "selection", "hydroponique", "suisse", "boisé"],
    productTier: "Premium",
    qualitySealEnabled: true,
    whyChooseDescription:
      "Plutonium s'adresse aux clients qui apprécient les fleurs plus profondes, boisées et terreuses. Son profil plus sombre et épicé en fait une référence de caractère, pensée pour les amateurs de produits plus marqués.",
    advisedProfile:
      "Pour les clients qui préfèrent les profils boisés, terreux et plus profonds.",
    experienceDescription:
      "La Plutonium est la fleur la plus connaisseur de cette sélection. Elle complète les profils fruités comme Mango Haze et Mandarine avec une signature plus sombre, boisée et puissante en bouche.",
    stock: 0,
    lowStockThreshold: 5,
    isActive: false,
    isFeatured: false,
    seoTitle: "Plutonium CBD hydroponique - Verdanza",
    seoDescription:
      "Plutonium CBD hydroponique cultivée en Suisse, au profil boisé, terreux et épicé.",
  },
];

export const featuredProducts = products.filter((product) => product.isFeatured);

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}

export function getProductsByCategory(category: Product["category"]) {
  return products.filter((product) => product.category === category);
}
