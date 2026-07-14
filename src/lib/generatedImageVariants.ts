export type ResponsiveImageVariant = {
  src: string;
  srcSet: string;
  sizes: string;
  width: number;
  height: number;
};

export type ProductImageVariantSet = {
  card: ResponsiveImageVariant;
  detail: ResponsiveImageVariant;
};

export const productImageVariants: Record<string, ProductImageVariantSet> = {
  "/Fiche produit/Golden static/goldenstatic.webp": {
    card: {
      src: "/images/products/golden-static-card-640.webp",
      srcSet: "/images/products/golden-static-card-320.webp 320w, /images/products/golden-static-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/golden-static-detail.webp",
      srcSet: "/images/products/golden-static-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Supreme Purple CBD/SUPREMEPURPLEcopieffff.webp": {
    card: {
      src: "/images/products/supreme-purple-cbd-card-640.webp",
      srcSet: "/images/products/supreme-purple-cbd-card-320.webp 320w, /images/products/supreme-purple-cbd-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/supreme-purple-cbd-detail.webp",
      srcSet: "/images/products/supreme-purple-cbd-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-zoom.webp": {
    card: {
      src: "/images/products/cookie-kush-indoor-card-640.webp",
      srcSet: "/images/products/cookie-kush-indoor-card-320.webp 320w, /images/products/cookie-kush-indoor-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/cookie-kush-indoor-detail.webp",
      srcSet: "/images/products/cookie-kush-indoor-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Petite tetes OG Kush ( sous serre)/PTOGKush_zoom.webp": {
    card: {
      src: "/images/products/petites-tetes-og-kush-card-640.webp",
      srcSet: "/images/products/petites-tetes-og-kush-card-320.webp 320w, /images/products/petites-tetes-og-kush-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/petites-tetes-og-kush-detail.webp",
      srcSet: "/images/products/petites-tetes-og-kush-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Harlequin (sous-serre)/harlequin_zoom.webp": {
    card: {
      src: "/images/products/harlequin-greenhouse-card-640.webp",
      srcSet: "/images/products/harlequin-greenhouse-card-320.webp 320w, /images/products/harlequin-greenhouse-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/harlequin-greenhouse-detail.webp",
      srcSet: "/images/products/harlequin-greenhouse-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/La%20mousse/mousse1.webp": {
    card: {
      src: "/images/products/la-mousse-card-640.webp",
      srcSet: "/images/products/la-mousse-card-320.webp 320w, /images/products/la-mousse-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 426,
    },
    detail: {
      src: "/images/products/la-mousse-detail.webp",
      srcSet: "/images/products/la-mousse-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 475,
    },
  },
  "/Fiche produit/3X%20Filtr%C3%A9%20CBD%20CBG/3X%20Filtr%C3%A9.webp": {
    card: {
      src: "/images/products/3x-filtre-cbd-cbg-card-640.webp",
      srcSet: "/images/products/3x-filtre-cbd-cbg-card-320.webp 320w, /images/products/3x-filtre-cbd-cbg-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/3x-filtre-cbd-cbg-detail.webp",
      srcSet: "/images/products/3x-filtre-cbd-cbg-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Le%20Beldia/beldia.webp": {
    card: {
      src: "/images/products/le-beldia-cbn-cbd-card-640.webp",
      srcSet: "/images/products/le-beldia-cbn-cbd-card-320.webp 320w, /images/products/le-beldia-cbn-cbd-card-640.webp 600w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 600,
      height: 600,
    },
    detail: {
      src: "/images/products/le-beldia-cbn-cbd-detail.webp",
      srcSet: "/images/products/le-beldia-cbn-cbd-detail.webp 600w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 600,
      height: 600,
    },
  },
  "/Fiche produit/Creamy%20Piatella/piatella.webp": {
    card: {
      src: "/images/products/creamy-piatella-cbd-card-640.webp",
      srcSet: "/images/products/creamy-piatella-cbd-card-320.webp 320w, /images/products/creamy-piatella-cbd-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/creamy-piatella-cbd-detail.webp",
      srcSet: "/images/products/creamy-piatella-cbd-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Mango%20Haze/MangoHaze.webp": {
    card: {
      src: "/images/products/mango-haze-cbd-card-640.webp",
      srcSet: "/images/products/mango-haze-cbd-card-320.webp 320w, /images/products/mango-haze-cbd-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/mango-haze-cbd-detail.webp",
      srcSet: "/images/products/mango-haze-cbd-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Mandarine/mandarine_zoom.webp": {
    card: {
      src: "/images/products/mandarine-cbd-card-640.webp",
      srcSet: "/images/products/mandarine-cbd-card-320.webp 320w, /images/products/mandarine-cbd-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/mandarine-cbd-detail.webp",
      srcSet: "/images/products/mandarine-cbd-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Amnesia/amnesia_hydro_zoom.webp": {
    card: {
      src: "/images/products/amnesia-cbd-hydroponique-card-640.webp",
      srcSet: "/images/products/amnesia-cbd-hydroponique-card-320.webp 320w, /images/products/amnesia-cbd-hydroponique-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/amnesia-cbd-hydroponique-detail.webp",
      srcSet: "/images/products/amnesia-cbd-hydroponique-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Blue%20Dream/BlueDream.webp": {
    card: {
      src: "/images/products/blue-dream-cbd-card-640.webp",
      srcSet: "/images/products/blue-dream-cbd-card-320.webp 320w, /images/products/blue-dream-cbd-card-640.webp 640w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 640,
      height: 640,
    },
    detail: {
      src: "/images/products/blue-dream-cbd-detail.webp",
      srcSet: "/images/products/blue-dream-cbd-detail.webp 713w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 713,
      height: 713,
    },
  },
  "/Fiche produit/Plutonium/zoom.webp": {
    card: {
      src: "/images/products/plutonium-cbd-hydroponique-card-640.webp",
      srcSet: "/images/products/plutonium-cbd-hydroponique-card-320.webp 320w, /images/products/plutonium-cbd-hydroponique-card-640.webp 600w",
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: 600,
      height: 600,
    },
    detail: {
      src: "/images/products/plutonium-cbd-hydroponique-detail.webp",
      srcSet: "/images/products/plutonium-cbd-hydroponique-detail.webp 600w",
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: 600,
      height: 600,
    },
  }
};

export const staticImageVariants: Record<string, ResponsiveImageVariant> = {
  "/images/verdanza-hero-premium.webp": {
    src: "/images/verdanza-hero-premium-1672.webp",
    srcSet: "/images/verdanza-hero-premium-768.webp 768w, /images/verdanza-hero-premium-1280.webp 1280w, /images/verdanza-hero-premium-1672.webp 1672w",
    sizes: "100vw",
    width: 1672,
    height: 941,
  },
  "/verdanza-badge.png": {
    src: "/images/brand/verdanza-badge-age-224.webp",
    srcSet: "/images/brand/verdanza-badge-age-112.webp 112w, /images/brand/verdanza-badge-age-224.webp 224w",
    sizes: "112px",
    width: 224,
    height: 224,
  },
  "/verdanza-logo.png": {
    src: "/images/brand/verdanza-logo-320.webp",
    srcSet: "/images/brand/verdanza-logo-180.webp 180w, /images/brand/verdanza-logo-320.webp 320w",
    sizes: "180px",
    width: 320,
    height: 180,
  },
  "/images/blog/comment-lire-analyse-cbd-1x1.webp": {
    src: "/images/blog/comment-lire-analyse-cbd-1x1.webp",
    srcSet: "/images/blog/comment-lire-analyse-cbd-1x1.webp 900w",
    sizes: "(min-width: 1024px) 420px, 92vw",
    width: 900,
    height: 900,
  },
  "/images/blog/comment-lire-analyse-cbd-4x3.webp": {
    src: "/images/blog/comment-lire-analyse-cbd-4x3.webp",
    srcSet: "/images/blog/comment-lire-analyse-cbd-4x3.webp 1200w",
    sizes: "(min-width: 1024px) 520px, 92vw",
    width: 1200,
    height: 900,
  },
  "/images/blog/comment-lire-analyse-cbd-16x9.webp": {
    src: "/images/blog/comment-lire-analyse-cbd-16x9.webp",
    srcSet: "/images/blog/comment-lire-analyse-cbd-16x9.webp 1600w",
    sizes: "100vw",
    width: 1600,
    height: 900,
  },
  "/images/blog/fleur-cbd-ou-resine-cbd-1x1.webp": {
    src: "/images/blog/fleur-cbd-ou-resine-cbd-1x1.webp",
    srcSet: "/images/blog/fleur-cbd-ou-resine-cbd-1x1.webp 900w",
    sizes: "(min-width: 1024px) 420px, 92vw",
    width: 900,
    height: 900,
  },
  "/images/blog/fleur-cbd-ou-resine-cbd-4x3.webp": {
    src: "/images/blog/fleur-cbd-ou-resine-cbd-4x3.webp",
    srcSet: "/images/blog/fleur-cbd-ou-resine-cbd-4x3.webp 1200w",
    sizes: "(min-width: 1024px) 520px, 92vw",
    width: 1200,
    height: 900,
  },
  "/images/blog/fleur-cbd-ou-resine-cbd-16x9.webp": {
    src: "/images/blog/fleur-cbd-ou-resine-cbd-16x9.webp",
    srcSet: "/images/blog/fleur-cbd-ou-resine-cbd-16x9.webp 1600w",
    sizes: "100vw",
    width: 1600,
    height: 900,
  },
  "/images/blog/choisir-fleur-cbd-profil-aromatique-1x1.webp": {
    src: "/images/blog/choisir-fleur-cbd-profil-aromatique-1x1.webp",
    srcSet: "/images/blog/choisir-fleur-cbd-profil-aromatique-1x1.webp 900w",
    sizes: "(min-width: 1024px) 420px, 92vw",
    width: 900,
    height: 900,
  },
  "/images/blog/choisir-fleur-cbd-profil-aromatique-4x3.webp": {
    src: "/images/blog/choisir-fleur-cbd-profil-aromatique-4x3.webp",
    srcSet: "/images/blog/choisir-fleur-cbd-profil-aromatique-4x3.webp 1200w",
    sizes: "(min-width: 1024px) 520px, 92vw",
    width: 1200,
    height: 900,
  },
  "/images/blog/choisir-fleur-cbd-profil-aromatique-16x9.webp": {
    src: "/images/blog/choisir-fleur-cbd-profil-aromatique-16x9.webp",
    srcSet: "/images/blog/choisir-fleur-cbd-profil-aromatique-16x9.webp 1600w",
    sizes: "100vw",
    width: 1600,
    height: 900,
  },
  "/images/blog/indoor-greenhouse-hydroponique-1x1.webp": {
    src: "/images/blog/indoor-greenhouse-hydroponique-1x1.webp",
    srcSet: "/images/blog/indoor-greenhouse-hydroponique-1x1.webp 900w",
    sizes: "(min-width: 1024px) 420px, 92vw",
    width: 900,
    height: 900,
  },
  "/images/blog/indoor-greenhouse-hydroponique-4x3.webp": {
    src: "/images/blog/indoor-greenhouse-hydroponique-4x3.webp",
    srcSet: "/images/blog/indoor-greenhouse-hydroponique-4x3.webp 1200w",
    sizes: "(min-width: 1024px) 520px, 92vw",
    width: 1200,
    height: 900,
  },
  "/images/blog/indoor-greenhouse-hydroponique-16x9.webp": {
    src: "/images/blog/indoor-greenhouse-hydroponique-16x9.webp",
    srcSet: "/images/blog/indoor-greenhouse-hydroponique-16x9.webp 1600w",
    sizes: "100vw",
    width: 1600,
    height: 900,
  }
};
