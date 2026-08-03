import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import sharp from "sharp";
import { blogArticles } from "../src/data/blogArticles";
import { products } from "../src/data/products";

type Variant = {
  name: string;
  width: number;
  quality: number;
};

type GeneratedVariant = {
  src: string;
  width: number;
  height: number;
  bytes: number;
};

type ProductReport = {
  productId: string;
  productName: string;
  sourceUrl: string;
  sourceFile: string;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  format?: string;
  hasAlpha?: boolean;
  card: GeneratedVariant[];
  detail: GeneratedVariant[];
};

const publicDir = resolve("public");
const productOutputDir = resolve(publicDir, "images/products");
const brandOutputDir = resolve(publicDir, "images/brand");
const blogOutputDir = resolve(publicDir, "images/blog");
const reportPath = resolve("reports/performance/images-latest.json");
const manifestPath = resolve("src/lib/generatedImageVariants.ts");
const productCardVariants: Variant[] = [
  { name: "card-320", width: 320, quality: 78 },
  { name: "card-640", width: 640, quality: 80 },
];
const productDetailVariants: Variant[] = [{ name: "detail", width: 713, quality: 82 }];
const staticTargets = [
  {
    key: "/images/verdanza-hero-premium.webp",
    sourceUrl: "/images/verdanza-hero-premium.webp",
    outputBase: "/images/verdanza-hero-premium",
    variants: [
      { name: "768", width: 768, quality: 78 },
      { name: "1280", width: 1280, quality: 80 },
      { name: "1672", width: 1672, quality: 82 },
    ],
    sizes: "100vw",
  },
  {
    key: "/verdanza-badge.png",
    sourceUrl: "/verdanza-badge.png",
    outputBase: "/images/brand/verdanza-badge-age",
    variants: [
      { name: "112", width: 112, quality: 82 },
      { name: "224", width: 224, quality: 84 },
    ],
    sizes: "112px",
  },
  {
    key: "/verdanza-logo.png",
    sourceUrl: "/verdanza-logo.png",
    outputBase: "/images/brand/verdanza-logo",
    variants: [
      { name: "180", width: 180, quality: 82 },
      { name: "320", width: 320, quality: 84 },
    ],
    sizes: "180px",
  },
  {
    key: "/images/brand/verdanza-quality-seal.png",
    sourceUrl: "/images/brand/verdanza-quality-seal.png",
    outputBase: "/images/brand/verdanza-quality-seal",
    variants: [
      { name: "96", width: 96, quality: 82 },
      { name: "180", width: 180, quality: 84 },
      { name: "320", width: 320, quality: 84 },
    ],
    sizes: "64px",
  },
];
const blogImageSources: Record<
  string,
  { label: string; sources?: string[]; kind?: "collage" | "analysis" | "aroma" | "driving" }
> = {
  "aspect-fleur-cbd-couleur-structure": {
    label: "Aspect d'une fleur CBD",
    sources: [
      "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-zoom.webp",
      "/Fiche produit/Harlequin (sous-serre)/harlequin_zoom.webp",
      "/Fiche produit/Mandarine/mandarine_zoom.webp",
    ],
  },
  "terpenes-profils-aromatiques-cbd": {
    label: "Terpènes et arômes CBD",
    kind: "aroma",
  },
  "cbd-conduite-france": {
    label: "CBD et conduite",
    kind: "driving",
  },
  "denominations-cbd-cbn-cbg": {
    label: "Lecture d'analyse CBD",
    kind: "analysis",
  },
  "conserver-fleurs-resines-cbd": {
    label: "Conservation fleurs et résines CBD",
    sources: [
      "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-zoom.webp",
      "/Fiche produit/Golden static/goldenstatic.webp",
      "/Fiche produit/La%20mousse/mousse1.webp",
    ],
  },
  "comment-lire-analyse-cbd": {
    label: "Lecture d'analyse CBD",
    kind: "analysis",
  },
  "choisir-fleur-cbd-profil-aromatique": {
    label: "Profil aromatique",
    kind: "aroma",
  },
  "fleur-cbd-ou-resine-cbd-differences": {
    label: "Fleur et résine CBD",
    sources: [
      "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-zoom.webp",
      "/Fiche produit/Golden static/goldenstatic.webp",
      "/Fiche produit/La%20mousse/mousse1.webp",
    ],
  },
  "indoor-greenhouse-hydroponique-differences": {
    label: "Méthodes de culture",
    sources: [
      "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-zoom.webp",
      "/Fiche produit/Harlequin (sous-serre)/harlequin_zoom.webp",
      "/Fiche produit/Mango%20Haze/MangoHaze.webp",
    ],
  },
};
const blogRatios = [
  { key: "square", suffix: "1x1", width: 900, height: 900, sizes: "(min-width: 1024px) 420px, 92vw" },
  { key: "landscape", suffix: "4x3", width: 1200, height: 900, sizes: "(min-width: 1024px) 520px, 92vw" },
  { key: "wide", suffix: "16x9", width: 1600, height: 900, sizes: "100vw" },
] as const;

mkdirSync(productOutputDir, { recursive: true });
mkdirSync(brandOutputDir, { recursive: true });
mkdirSync(blogOutputDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

const productReports: ProductReport[] = [];
const productManifestEntries: string[] = [];

for (const product of products) {
  const sourceFile = publicPath(product.image);
  if (!existsSync(sourceFile)) throw new Error(`Missing product image for ${product.slug}: ${product.image}`);

  const sourceBuffer = readFileSync(sourceFile);
  const sourceMetadata = await sharp(sourceBuffer).metadata();
  const sourceWidth = sourceMetadata.width || 0;
  const sourceHeight = sourceMetadata.height || 0;
  const sourceBytes = sourceBuffer.length;
  const card = await generateProductVariants(product.slug, sourceBuffer, sourceWidth, sourceHeight, productCardVariants);
  const detail = await generateProductVariants(product.slug, sourceBuffer, sourceWidth, sourceHeight, productDetailVariants);

  productReports.push({
    productId: product.id,
    productName: product.name,
    sourceUrl: product.image,
    sourceFile: normalize(sourceFile),
    sourceBytes,
    sourceWidth,
    sourceHeight,
    format: sourceMetadata.format,
    hasAlpha: Boolean(sourceMetadata.hasAlpha),
    card,
    detail,
  });

  const cardLargest = card[card.length - 1];
  const detailLargest = detail[detail.length - 1];
  productManifestEntries.push(`  ${JSON.stringify(product.image)}: {
    card: {
      src: ${JSON.stringify(cardLargest.src)},
      srcSet: ${JSON.stringify(srcSet(card))},
      sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw",
      width: ${cardLargest.width},
      height: ${cardLargest.height},
    },
    detail: {
      src: ${JSON.stringify(detailLargest.src)},
      srcSet: ${JSON.stringify(srcSet(detail))},
      sizes: "(min-width: 1024px) 45vw, 92vw",
      width: ${detailLargest.width},
      height: ${detailLargest.height},
    },
  }`);
}

const staticReport = [];
const staticManifestEntries = new Map<string, string>();
for (const target of staticTargets) {
  const sourceFile = publicPath(target.sourceUrl);
  if (!existsSync(sourceFile)) throw new Error(`Missing static image: ${target.sourceUrl}`);
  const sourceBuffer = readFileSync(sourceFile);
  const sourceMetadata = await sharp(sourceBuffer).metadata();
  const generated = await Promise.all(
    target.variants.map((variant) =>
      generateVariant(
        sourceBuffer,
        sourceMetadata.width || variant.width,
        sourceMetadata.height || variant.width,
        `${target.outputBase}-${variant.name}.webp`,
        variant,
      ),
    ),
  );
  const largest = generated[generated.length - 1];
  staticReport.push({
    sourceUrl: target.sourceUrl,
    sourceFile: normalize(sourceFile),
    sourceBytes: sourceBuffer.length,
    sourceWidth: sourceMetadata.width || 0,
    sourceHeight: sourceMetadata.height || 0,
    format: sourceMetadata.format,
    hasAlpha: Boolean(sourceMetadata.hasAlpha),
    variants: generated,
  });
  staticManifestEntries.set(target.key, `  ${JSON.stringify(target.key)}: {
    src: ${JSON.stringify(largest.src)},
    srcSet: ${JSON.stringify(srcSet(generated))},
    sizes: ${JSON.stringify(target.sizes)},
    width: ${largest.width},
    height: ${largest.height},
  }`);
}

const blogReport = [];
for (const article of blogArticles) {
  if (article.status !== "published") continue;
  const sourceSet = blogImageSources[article.slug];
  if (!sourceSet) throw new Error(`Missing blog image source definition for ${article.slug}`);

  const generated = [];
  for (const ratio of blogRatios) {
    const outputUrl = article.images[ratio.key];
    const output =
      sourceSet.kind === "analysis"
        ? await generateAnalysisBlogImage({
            outputUrl,
            label: sourceSet.label,
            width: ratio.width,
            height: ratio.height,
          })
        : sourceSet.kind === "driving"
          ? await generateDrivingBlogImage({
              outputUrl,
              label: sourceSet.label,
              width: ratio.width,
              height: ratio.height,
            })
        : sourceSet.kind === "aroma"
          ? await generateAromaBlogImage({
              outputUrl,
              label: sourceSet.label,
              width: ratio.width,
              height: ratio.height,
            })
        : await generateBlogImage({
            outputUrl,
            label: sourceSet.label,
            sourceUrls: sourceSet.sources || [],
            width: ratio.width,
            height: ratio.height,
          });
    generated.push(output);
    staticManifestEntries.set(output.src, `  ${JSON.stringify(output.src)}: {
    src: ${JSON.stringify(output.src)},
    srcSet: ${JSON.stringify(`${output.src} ${output.width}w`)},
    sizes: ${JSON.stringify(ratio.sizes)},
    width: ${output.width},
    height: ${output.height},
  }`);
  }
  blogReport.push({
    articleSlug: article.slug,
    articleTitle: article.title,
    sources: sourceSet.sources,
    variants: generated,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  productImages: productReports,
  staticImages: staticReport,
  blogImages: blogReport,
  totals: {
    productSourceBytes: sum(productReports.map((item) => item.sourceBytes)),
    productCardLargestBytes: sum(productReports.map((item) => item.card.at(-1)?.bytes || 0)),
    productDetailBytes: sum(productReports.map((item) => item.detail.at(-1)?.bytes || 0)),
    staticSourceBytes: sum(staticReport.map((item) => item.sourceBytes)),
    staticLargestBytes: sum(staticReport.map((item) => item.variants.at(-1)?.bytes || 0)),
    blogImageBytes: sum(blogReport.flatMap((item) => item.variants.map((variant) => variant.bytes))),
  },
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(
  manifestPath,
  `export type ResponsiveImageVariant = {
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
${productManifestEntries.join(",\n")}
};

export const staticImageVariants: Record<string, ResponsiveImageVariant> = {
${[...staticManifestEntries.values()].join(",\n")}
};
`,
);

console.log(`Image report written to ${relative(process.cwd(), reportPath)}`);
console.table(
  productReports.map((item) => ({
    product: item.productName,
    sourceKB: kb(item.sourceBytes),
    card640KB: kb(item.card.at(-1)?.bytes || 0),
    detailKB: kb(item.detail.at(-1)?.bytes || 0),
    reductionCard: percent(item.sourceBytes, item.card.at(-1)?.bytes || 0),
    reductionDetail: percent(item.sourceBytes, item.detail.at(-1)?.bytes || 0),
  })),
);
console.table(
  staticReport.map((item) => ({
    source: item.sourceUrl,
    sourceKB: kb(item.sourceBytes),
    largestKB: kb(item.variants.at(-1)?.bytes || 0),
    reduction: percent(item.sourceBytes, item.variants.at(-1)?.bytes || 0),
  })),
);
console.table(
  blogReport.flatMap((item) =>
    item.variants.map((variant) => ({
      article: item.articleSlug,
      image: variant.src,
      KB: kb(variant.bytes),
    })),
  ),
);

async function generateProductVariants(
  slug: string,
  sourceBuffer: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  variants: Variant[],
) {
  return Promise.all(
    variants.map((variant) =>
      generateVariant(
        sourceBuffer,
        sourceWidth,
        sourceHeight,
        `/images/products/${slug}-${variant.name}.webp`,
        variant,
      ),
    ),
  );
}

async function generateVariant(
  sourceBuffer: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  outputUrl: string,
  variant: Variant,
): Promise<GeneratedVariant> {
  const width = Math.min(variant.width, sourceWidth);
  const height = Math.round((sourceHeight / sourceWidth) * width);
  const outputFile = publicPath(outputUrl);
  mkdirSync(dirname(outputFile), { recursive: true });
  const output = await sharp(sourceBuffer)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: variant.quality, effort: 5 })
    .toBuffer();
  writeIfChanged(outputFile, output);
  return {
    src: outputUrl,
    width,
    height,
    bytes: output.length,
  };
}

async function generateBlogImage({
  outputUrl,
  label,
  sourceUrls,
  width,
  height,
}: {
  outputUrl: string;
  label: string;
  sourceUrls: string[];
  width: number;
  height: number;
}): Promise<GeneratedVariant> {
  const outputFile = publicPath(outputUrl);
  mkdirSync(dirname(outputFile), { recursive: true });

  const tileWidth = Math.round(width * 0.34);
  const tileHeight = Math.round(height * 0.62);
  const gap = Math.round(width * 0.025);
  const startX = Math.round(width * 0.08);
  const top = Math.round(height * 0.19);
  const composites = await Promise.all(
    sourceUrls.slice(0, 3).map(async (sourceUrl, index) => {
      const sourceFile = publicPath(sourceUrl);
      if (!existsSync(sourceFile)) throw new Error(`Missing blog source image: ${sourceUrl}`);
      const image = await sharp(readFileSync(sourceFile))
        .resize({ width: tileWidth, height: tileHeight, fit: "cover" })
        .webp({ quality: 82, effort: 5 })
        .toBuffer();
      return {
        input: image,
        left: startX + index * Math.round(tileWidth * 0.7 + gap),
        top: top + (index % 2) * Math.round(height * 0.05),
      };
    }),
  );

  const overlay = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#faf8f2"/>
  <rect x="0" y="0" width="${Math.round(width * 0.28)}" height="${height}" fill="#0d3b2e"/>
  <rect x="${Math.round(width * 0.28)}" y="0" width="${width}" height="${height}" fill="#f5f0e6"/>
  <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.18)}" r="${Math.round(height * 0.18)}" fill="#c9a45c" opacity="0.2"/>
  <text x="${Math.round(width * 0.34)}" y="${Math.round(height * 0.12)}" fill="#0d3b2e" font-family="Arial, sans-serif" font-size="${Math.round(height * 0.04)}" font-weight="700">${escapeSvg(label)}</text>
</svg>`);

  const output = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#faf8f2",
    },
  })
    .composite([{ input: overlay, left: 0, top: 0 }, ...composites])
    .webp({ quality: 82, effort: 6 })
    .toBuffer();
  writeIfChanged(outputFile, output);

  return {
    src: outputUrl,
    width,
    height,
    bytes: output.length,
  };
}

async function generateAnalysisBlogImage({
  outputUrl,
  label,
  width,
  height,
}: {
  outputUrl: string;
  label: string;
  width: number;
  height: number;
}): Promise<GeneratedVariant> {
  const outputFile = publicPath(outputUrl);
  mkdirSync(dirname(outputFile), { recursive: true });

  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f7f1e6"/>
      <stop offset="100%" stop-color="#efe6d8"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#12392f"/>
      <stop offset="100%" stop-color="#0d3b2e"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#0d3b2e" flood-opacity="0.16"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.18)}" r="${Math.round(Math.min(width, height) * 0.18)}" fill="#c9a45c" opacity="0.16"/>
  <rect x="0" y="0" width="${Math.round(width * 0.28)}" height="${height}" fill="url(#panel)"/>
  <rect x="${Math.round(width * 0.31)}" y="${Math.round(height * 0.12)}" width="${Math.round(width * 0.42)}" height="${Math.round(height * 0.72)}" rx="${Math.round(Math.min(width, height) * 0.03)}" fill="#fffaf1" filter="url(#shadow)"/>
  <rect x="${Math.round(width * 0.37)}" y="${Math.round(height * 0.19)}" width="${Math.round(width * 0.19)}" height="${Math.round(height * 0.045)}" rx="${Math.round(height * 0.02)}" fill="#0d3b2e" opacity="0.92"/>
  <rect x="${Math.round(width * 0.37)}" y="${Math.round(height * 0.28)}" width="${Math.round(width * 0.24)}" height="${Math.round(height * 0.014)}" rx="${Math.round(height * 0.007)}" fill="#d8c9ad"/>
  <rect x="${Math.round(width * 0.37)}" y="${Math.round(height * 0.32)}" width="${Math.round(width * 0.20)}" height="${Math.round(height * 0.014)}" rx="${Math.round(height * 0.007)}" fill="#d8c9ad"/>
  <rect x="${Math.round(width * 0.37)}" y="${Math.round(height * 0.36)}" width="${Math.round(width * 0.26)}" height="${Math.round(height * 0.014)}" rx="${Math.round(height * 0.007)}" fill="#d8c9ad"/>
  <rect x="${Math.round(width * 0.37)}" y="${Math.round(height * 0.43)}" width="${Math.round(width * 0.06)}" height="${Math.round(height * 0.20)}" rx="12" fill="#0d3b2e"/>
  <rect x="${Math.round(width * 0.45)}" y="${Math.round(height * 0.48)}" width="${Math.round(width * 0.06)}" height="${Math.round(height * 0.15)}" rx="12" fill="#c9a45c"/>
  <rect x="${Math.round(width * 0.53)}" y="${Math.round(height * 0.40)}" width="${Math.round(width * 0.06)}" height="${Math.round(height * 0.23)}" rx="12" fill="#0d3b2e" opacity="0.78"/>
  <rect x="${Math.round(width * 0.61)}" y="${Math.round(height * 0.52)}" width="${Math.round(width * 0.06)}" height="${Math.round(height * 0.11)}" rx="12" fill="#c9a45c" opacity="0.82"/>
  <line x1="${Math.round(width * 0.37)}" y1="${Math.round(height * 0.70)}" x2="${Math.round(width * 0.67)}" y2="${Math.round(height * 0.70)}" stroke="#d8c9ad" stroke-width="4" stroke-linecap="round"/>
  <line x1="${Math.round(width * 0.37)}" y1="${Math.round(height * 0.75)}" x2="${Math.round(width * 0.63)}" y2="${Math.round(height * 0.75)}" stroke="#d8c9ad" stroke-width="4" stroke-linecap="round"/>
  <line x1="${Math.round(width * 0.37)}" y1="${Math.round(height * 0.80)}" x2="${Math.round(width * 0.59)}" y2="${Math.round(height * 0.80)}" stroke="#d8c9ad" stroke-width="4" stroke-linecap="round"/>
  <circle cx="${Math.round(width * 0.72)}" cy="${Math.round(height * 0.46)}" r="${Math.round(Math.min(width, height) * 0.10)}" fill="none" stroke="#0d3b2e" stroke-width="${Math.max(8, Math.round(width * 0.008))}"/>
  <line x1="${Math.round(width * 0.79)}" y1="${Math.round(height * 0.53)}" x2="${Math.round(width * 0.86)}" y2="${Math.round(height * 0.60)}" stroke="#0d3b2e" stroke-width="${Math.max(10, Math.round(width * 0.01))}" stroke-linecap="round"/>
  <circle cx="${Math.round(width * 0.74)}" cy="${Math.round(height * 0.16)}" r="${Math.round(Math.min(width, height) * 0.045)}" fill="#c9a45c" opacity="0.22"/>
  <circle cx="${Math.round(width * 0.80)}" cy="${Math.round(height * 0.24)}" r="${Math.round(Math.min(width, height) * 0.028)}" fill="#0d3b2e" opacity="0.12"/>
  <text x="${Math.round(width * 0.36)}" y="${Math.round(height * 0.11)}" fill="#0d3b2e" font-family="Arial, sans-serif" font-size="${Math.round(height * 0.04)}" font-weight="700">${escapeSvg(label)}</text>
  <text x="${Math.round(width * 0.36)}" y="${Math.round(height * 0.92)}" fill="#0d3b2e" font-family="Arial, sans-serif" font-size="${Math.round(height * 0.026)}" font-weight="600" opacity="0.72">Lecture méthodique du document et des mesures</text>
</svg>`);

  const output = await sharp(svg).webp({ quality: 82, effort: 6 }).toBuffer();
  writeIfChanged(outputFile, output);

  return {
    src: outputUrl,
    width,
    height,
    bytes: output.length,
  };
}

async function generateDrivingBlogImage({
  outputUrl,
  label,
  width,
  height,
}: {
  outputUrl: string;
  label: string;
  width: number;
  height: number;
}): Promise<GeneratedVariant> {
  const outputFile = publicPath(outputUrl);
  mkdirSync(dirname(outputFile), { recursive: true });

  const roadCenter = Math.round(width * 0.61);
  const roadTop = Math.round(height * 0.17);
  const roadBottom = Math.round(height * 0.86);
  const roadHalfTop = Math.round(width * 0.07);
  const roadHalfBottom = Math.round(width * 0.23);
  const shieldX = Math.round(width * 0.75);
  const shieldY = Math.round(height * 0.29);
  const shieldSize = Math.round(Math.min(width, height) * 0.14);

  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-driving" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8f3e9"/>
      <stop offset="100%" stop-color="#eadfcf"/>
    </linearGradient>
    <linearGradient id="panel-driving" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#123f32"/>
      <stop offset="100%" stop-color="#0d3b2e"/>
    </linearGradient>
    <filter id="shadow-driving" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.round(height * 0.018)}" stdDeviation="${Math.round(height * 0.018)}" flood-color="#0d3b2e" flood-opacity="0.17"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg-driving)"/>
  <rect width="${Math.round(width * 0.27)}" height="${height}" fill="url(#panel-driving)"/>
  <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.18)}" r="${Math.round(Math.min(width, height) * 0.15)}" fill="#c9a45c" opacity="0.18"/>
  <path d="M ${roadCenter - roadHalfTop} ${roadTop} L ${roadCenter + roadHalfTop} ${roadTop} L ${roadCenter + roadHalfBottom} ${roadBottom} L ${roadCenter - roadHalfBottom} ${roadBottom} Z" fill="#0d3b2e" opacity="0.92" filter="url(#shadow-driving)"/>
  <path d="M ${roadCenter} ${Math.round(height * 0.24)} L ${roadCenter} ${Math.round(height * 0.34)} M ${roadCenter} ${Math.round(height * 0.42)} L ${roadCenter} ${Math.round(height * 0.56)} M ${roadCenter} ${Math.round(height * 0.66)} L ${roadCenter} ${Math.round(height * 0.80)}" fill="none" stroke="#faf8f2" stroke-width="${Math.max(8, Math.round(width * 0.012))}" stroke-linecap="round"/>
  <circle cx="${shieldX}" cy="${shieldY}" r="${Math.round(shieldSize * 0.82)}" fill="#fffaf1" stroke="#c9a45c" stroke-width="${Math.max(8, Math.round(width * 0.008))}" filter="url(#shadow-driving)"/>
  <path d="M ${shieldX} ${shieldY - Math.round(shieldSize * 0.48)} L ${shieldX + Math.round(shieldSize * 0.40)} ${shieldY - Math.round(shieldSize * 0.28)} L ${shieldX + Math.round(shieldSize * 0.34)} ${shieldY + Math.round(shieldSize * 0.22)} C ${shieldX + Math.round(shieldSize * 0.24)} ${shieldY + Math.round(shieldSize * 0.48)}, ${shieldX} ${shieldY + Math.round(shieldSize * 0.62)}, ${shieldX} ${shieldY + Math.round(shieldSize * 0.62)} C ${shieldX} ${shieldY + Math.round(shieldSize * 0.62)}, ${shieldX - Math.round(shieldSize * 0.24)} ${shieldY + Math.round(shieldSize * 0.48)}, ${shieldX - Math.round(shieldSize * 0.34)} ${shieldY + Math.round(shieldSize * 0.22)} L ${shieldX - Math.round(shieldSize * 0.40)} ${shieldY - Math.round(shieldSize * 0.28)} Z" fill="#0d3b2e"/>
  <path d="M ${shieldX - Math.round(shieldSize * 0.18)} ${shieldY + Math.round(shieldSize * 0.02)} L ${shieldX - Math.round(shieldSize * 0.04)} ${shieldY + Math.round(shieldSize * 0.18)} L ${shieldX + Math.round(shieldSize * 0.22)} ${shieldY - Math.round(shieldSize * 0.16)}" fill="none" stroke="#fffaf1" stroke-width="${Math.max(8, Math.round(width * 0.009))}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${Math.round(width * 0.85)}" cy="${Math.round(height * 0.72)}" r="${Math.round(Math.min(width, height) * 0.10)}" fill="#c9a45c" opacity="0.16"/>
  <text x="${Math.round(width * 0.33)}" y="${Math.round(height * 0.11)}" fill="#0d3b2e" font-family="Arial, sans-serif" font-size="${Math.round(height * 0.04)}" font-weight="700">${escapeSvg(label)}</text>
  <text x="${Math.round(width * 0.33)}" y="${Math.round(height * 0.93)}" fill="#0d3b2e" font-family="Arial, sans-serif" font-size="${Math.round(height * 0.026)}" font-weight="600" opacity="0.72">Réglementation, THC et prudence au volant</text>
</svg>`);

  const output = await sharp(svg).webp({ quality: 82, effort: 6 }).toBuffer();
  writeIfChanged(outputFile, output);

  return {
    src: outputUrl,
    width,
    height,
    bytes: output.length,
  };
}

async function generateAromaBlogImage({
  outputUrl,
  label,
  width,
  height,
}: {
  outputUrl: string;
  label: string;
  width: number;
  height: number;
}): Promise<GeneratedVariant> {
  const outputFile = publicPath(outputUrl);
  mkdirSync(dirname(outputFile), { recursive: true });

  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f7f1e7"/>
      <stop offset="100%" stop-color="#efe4d2"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#103e31"/>
      <stop offset="100%" stop-color="#0d3b2e"/>
    </linearGradient>
    <linearGradient id="flare" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#c9a45c" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#ddb77a" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#0d3b2e" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${Math.round(width * 0.26)}" height="${height}" fill="url(#panel)"/>
  <circle cx="${Math.round(width * 0.2)}" cy="${Math.round(height * 0.18)}" r="${Math.round(Math.min(width, height) * 0.16)}" fill="#c9a45c" opacity="0.16"/>
  <circle cx="${Math.round(width * 0.67)}" cy="${Math.round(height * 0.24)}" r="${Math.round(Math.min(width, height) * 0.07)}" fill="#c9a45c" opacity="0.22"/>
  <circle cx="${Math.round(width * 0.76)}" cy="${Math.round(height * 0.61)}" r="${Math.round(Math.min(width, height) * 0.11)}" fill="#0d3b2e" opacity="0.08"/>
  <rect x="${Math.round(width * 0.30)}" y="${Math.round(height * 0.13)}" width="${Math.round(width * 0.48)}" height="${Math.round(height * 0.74)}" rx="${Math.round(Math.min(width, height) * 0.03)}" fill="#fffaf1" filter="url(#shadow)"/>
  <path d="M ${Math.round(width * 0.36)} ${Math.round(height * 0.32)} C ${Math.round(width * 0.43)} ${Math.round(height * 0.20)}, ${Math.round(width * 0.54)} ${Math.round(height * 0.20)}, ${Math.round(width * 0.60)} ${Math.round(height * 0.32)} C ${Math.round(width * 0.65)} ${Math.round(height * 0.42)}, ${Math.round(width * 0.61)} ${Math.round(height * 0.56)}, ${Math.round(width * 0.52)} ${Math.round(height * 0.64)} C ${Math.round(width * 0.44)} ${Math.round(height * 0.71)}, ${Math.round(width * 0.35)} ${Math.round(height * 0.64)}, ${Math.round(width * 0.34)} ${Math.round(height * 0.51)} C ${Math.round(width * 0.33)} ${Math.round(height * 0.42)}, ${Math.round(width * 0.34)} ${Math.round(height * 0.35)}, ${Math.round(width * 0.36)} ${Math.round(height * 0.32)} Z" fill="#e7d3b0" opacity="0.9"/>
  <path d="M ${Math.round(width * 0.44)} ${Math.round(height * 0.32)} C ${Math.round(width * 0.48)} ${Math.round(height * 0.25)}, ${Math.round(width * 0.55)} ${Math.round(height * 0.24)}, ${Math.round(width * 0.58)} ${Math.round(height * 0.31)} C ${Math.round(width * 0.61)} ${Math.round(height * 0.39)}, ${Math.round(width * 0.58)} ${Math.round(height * 0.48)}, ${Math.round(width * 0.51)} ${Math.round(height * 0.54)} C ${Math.round(width * 0.45)} ${Math.round(height * 0.49)}, ${Math.round(width * 0.42)} ${Math.round(height * 0.40)}, ${Math.round(width * 0.44)} ${Math.round(height * 0.32)} Z" fill="#0d3b2e" opacity="0.78"/>
  <path d="M ${Math.round(width * 0.55)} ${Math.round(height * 0.37)} C ${Math.round(width * 0.63)} ${Math.round(height * 0.30)}, ${Math.round(width * 0.71)} ${Math.round(height * 0.33)}, ${Math.round(width * 0.73)} ${Math.round(height * 0.42)} C ${Math.round(width * 0.74)} ${Math.round(height * 0.51)}, ${Math.round(width * 0.68)} ${Math.round(height * 0.60)}, ${Math.round(width * 0.59)} ${Math.round(height * 0.62)} C ${Math.round(width * 0.53)} ${Math.round(height * 0.56)}, ${Math.round(width * 0.51)} ${Math.round(height * 0.44)}, ${Math.round(width * 0.55)} ${Math.round(height * 0.37)} Z" fill="url(#flare)"/>
  <path d="M ${Math.round(width * 0.39)} ${Math.round(height * 0.67)} C ${Math.round(width * 0.47)} ${Math.round(height * 0.59)}, ${Math.round(width * 0.57)} ${Math.round(height * 0.58)}, ${Math.round(width * 0.65)} ${Math.round(height * 0.67)}" fill="none" stroke="#0d3b2e" stroke-width="${Math.max(8, Math.round(width * 0.008))}" stroke-linecap="round" opacity="0.82"/>
  <path d="M ${Math.round(width * 0.36)} ${Math.round(height * 0.74)} C ${Math.round(width * 0.45)} ${Math.round(height * 0.69)}, ${Math.round(width * 0.57)} ${Math.round(height * 0.70)}, ${Math.round(width * 0.68)} ${Math.round(height * 0.76)}" fill="none" stroke="#c9a45c" stroke-width="${Math.max(6, Math.round(width * 0.006))}" stroke-linecap="round" opacity="0.72"/>
  <circle cx="${Math.round(width * 0.69)}" cy="${Math.round(height * 0.42)}" r="${Math.round(Math.min(width, height) * 0.06)}" fill="#0d3b2e" opacity="0.14"/>
  <circle cx="${Math.round(width * 0.73)}" cy="${Math.round(height * 0.47)}" r="${Math.round(Math.min(width, height) * 0.03)}" fill="#c9a45c" opacity="0.26"/>
  <circle cx="${Math.round(width * 0.62)}" cy="${Math.round(height * 0.24)}" r="${Math.round(Math.min(width, height) * 0.022)}" fill="#0d3b2e" opacity="0.18"/>
  <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.20)}" r="${Math.round(Math.min(width, height) * 0.018)}" fill="#c9a45c" opacity="0.28"/>
  <text x="${Math.round(width * 0.34)}" y="${Math.round(height * 0.11)}" fill="#0d3b2e" font-family="Arial, sans-serif" font-size="${Math.round(height * 0.04)}" font-weight="700">${escapeSvg(label)}</text>
  <text x="${Math.round(width * 0.34)}" y="${Math.round(height * 0.91)}" fill="#0d3b2e" font-family="Arial, sans-serif" font-size="${Math.round(height * 0.026)}" font-weight="600" opacity="0.70">Lecture des notes, de l’intensité et de l’équilibre</text>
</svg>`);

  const output = await sharp(svg).webp({ quality: 82, effort: 6 }).toBuffer();
  writeIfChanged(outputFile, output);

  return {
    src: outputUrl,
    width,
    height,
    bytes: output.length,
  };
}

function publicPath(url: string) {
  return resolve(publicDir, decodeURIComponent(url).replace(/^\/+/, ""));
}

function writeIfChanged(file: string, buffer: Buffer) {
  if (existsSync(file) && readFileSync(file).equals(buffer)) return;
  writeFileSync(file, buffer);
}

function srcSet(variants: GeneratedVariant[]) {
  return variants.map((variant) => `${variant.src} ${variant.width}w`).join(", ");
}

function normalize(file: string) {
  return relative(process.cwd(), file).replace(/\\/g, "/");
}

function kb(bytes: number) {
  return Math.round(bytes / 1024);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function percent(before: number, after: number) {
  return before > 0 ? `${Math.round(((before - after) / before) * 100)}%` : "0%";
}

function escapeSvg(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
