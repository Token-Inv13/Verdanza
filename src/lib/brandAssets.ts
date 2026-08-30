const BRAND_ROOT = "/brand/verdanza-v1";

export const brandAssets = {
  logos: {
    horizontalCompactFullColor: `${BRAND_ROOT}/logos/verdanza-logo-horizontal-compact-full-color.svg`,
    horizontalCompactGold: `${BRAND_ROOT}/logos/verdanza-logo-horizontal-compact-mono-gold.svg`,
    horizontalPrimaryFullColor: `${BRAND_ROOT}/logos/verdanza-logo-horizontal-primary-full-color.svg`,
    stackedCompactFullColor: `${BRAND_ROOT}/logos/verdanza-logo-stacked-compact-full-color.svg`,
    monogramSmallFullColor: `${BRAND_ROOT}/logos/verdanza-monogram-small-full-color.svg`,
    sealFullColor: `${BRAND_ROOT}/logos/verdanza-seal-full-color.svg`,
  },
  email: `${BRAND_ROOT}/email/verdanza-logo-horizontal-compact-full-color-512.png`,
  documents: `${BRAND_ROOT}/documents/verdanza-logo-horizontal-primary-mono-charcoal-1024.png`,
  structuredData: `${BRAND_ROOT}/structured-data/verdanza-seal-full-color-512.png`,
  social: `${BRAND_ROOT}/social/verdanza-default-og-1200x630.png`,
} as const;

export const BRAND_LOGO_ALT = "Verdanza";
export const BRAND_PRODUCT_PLACEHOLDER = brandAssets.logos.sealFullColor;
export const BRAND_QUALITY_SEAL = brandAssets.logos.sealFullColor;
export const BRAND_QUALITY_SEAL_ALT = "Sceau officiel Verdanza";
export const BRAND_SOCIAL_IMAGE = brandAssets.social;
export const BRAND_STRUCTURED_DATA_LOGO = brandAssets.structuredData;
export const BRAND_EMAIL_LOGO = brandAssets.email;
export const BRAND_EMAIL_LOGO_URL = `https://verdanza.fr${BRAND_EMAIL_LOGO}`;
export const BRAND_DOCUMENT_LOGO = brandAssets.documents;
