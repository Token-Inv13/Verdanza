import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { chromium } from "playwright";
import { publishedBlogArticles } from "../src/data/blogArticles";
import { products } from "../src/data/products";
import { productImageVariants, staticImageVariants } from "../src/lib/generatedImageVariants";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

type PublicImage = {
  url: string;
  file: string;
  bytes: number;
  used: boolean;
  status: "used" | "unused" | "generated" | "working-source";
};

const publicDir = resolve("public");
const distDir = resolve("dist");
const failures: string[] = [];
const warnings: string[] = [];
const productImageUrls = new Set(products.map((product) => product.image));
const blogImageUrls = publishedBlogArticles.flatMap((article) => [
  article.images.square,
  article.images.landscape,
  article.images.wide,
]);
const staticImageUrls = new Set([
  "/images/verdanza-hero-premium.webp",
  "/verdanza-badge.png",
  "/verdanza-logo.png",
  ...blogImageUrls,
]);
const generatedPrefixes = ["/images/products/", "/images/brand/", "/images/blog/", "/images/verdanza-hero-premium-"];
const referencedUrls = new Set([...productImageUrls, ...staticImageUrls]);
const publicImages = listPublicImages(publicDir);

for (const product of products) {
  const sourceFile = publicFile(product.image);
  if (!existsSync(sourceFile)) failures.push(`missing product image ${product.slug}: ${product.image}`);

  const variants = productImageVariants[product.image];
  if (!variants) {
    failures.push(`missing optimized variants for ${product.slug}`);
    continue;
  }
  auditVariantSet(`${product.slug} card`, variants.card, 150 * 1024);
  auditVariantSet(`${product.slug} detail`, variants.detail, 220 * 1024);
  if (!variants.card.sizes) failures.push(`missing card sizes for ${product.slug}`);
  if (!variants.detail.sizes) failures.push(`missing detail sizes for ${product.slug}`);
}

for (const source of staticImageUrls) {
  if (!existsSync(publicFile(source))) failures.push(`missing static image ${source}`);
  const variant = staticImageVariants[source];
  if (!variant) failures.push(`missing optimized static variant for ${source}`);
  else {
    const maxBytes = source.includes("/images/blog/")
      ? 240 * 1024
      : source.includes("hero")
        ? 160 * 1024
        : 80 * 1024;
    auditVariantSet(source, variant, maxBytes);
  }
}

const largeUnused = publicImages.filter(
  (image) => image.status === "unused" && image.bytes > 1500 * 1024,
);

if (existsSync(distDir)) {
  const htmlFiles = walk(distDir).filter((file) => file.endsWith(".html"));
  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    if (/[A-Z]:\\|\\\\/.test(html)) failures.push(`windows path found in ${normalize(file)}`);
    if (/Ãƒ|Ã¢â‚¬â„¢|ï¿½/.test(html)) failures.push(`corrupted UTF-8 text in ${normalize(file)}`);
  }
  await auditRenderedImages();
}

console.log("Image inventory");
console.table(
  publicImages
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 30)
    .map((image) => ({
      url: image.url,
      status: image.status,
      KB: Math.round(image.bytes / 1024),
    })),
);

console.log("Large unused images");
console.table(
  largeUnused.map((image) => ({
    url: image.url,
    KB: Math.round(image.bytes / 1024),
  })),
);

if (warnings.length) {
  console.warn("Image audit warnings:");
  warnings.forEach((warning) => console.warn(`- ${warning}`));
}

if (failures.length) {
  console.error("Image audit failures:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `Image audit passed for ${products.length} product image(s), ${Object.keys(staticImageVariants).length} static image set(s), and ${publicImages.length} public image file(s).`,
  );
}

function auditVariantSet(label: string, variant: { src: string; srcSet: string; sizes: string; width: number; height: number }, maxBytes: number) {
  if (!variant.src || !variant.srcSet) failures.push(`missing src/srcSet for ${label}`);
  if (!variant.width || !variant.height) failures.push(`missing dimensions for ${label}`);
  const candidates = parseSrcSet(variant.srcSet);
  if (!candidates.length) failures.push(`invalid srcSet for ${label}`);
  for (const candidate of candidates) {
    const file = publicFile(candidate.src);
    if (!existsSync(file)) {
      failures.push(`missing variant file for ${label}: ${candidate.src}`);
      continue;
    }
    const bytes = statSync(file).size;
    if (bytes > maxBytes) {
      failures.push(`${label} variant too large: ${candidate.src} ${Math.round(bytes / 1024)} KB`);
    }
    if (candidate.width <= 0) failures.push(`invalid width descriptor for ${label}: ${candidate.src}`);
  }
}

async function auditRenderedImages() {
  const heroVariants = staticImageVariants["/images/verdanza-hero-premium.webp"];
  if (!heroVariants) {
    failures.push("home hero optimized variants missing");
  } else {
    auditBuiltVariantSet("home hero", heroVariants, 160 * 1024);
    await auditRuntimeHero(heroVariants);
  }

  const productHtml = readDistHtml("produits/golden-static.html");
  if (!productHtml.includes("/images/products/golden-static-detail.webp")) {
    failures.push("Golden Static detail optimized image missing from prerendered HTML");
  }
  if (/golden-static-detail\.webp[\s\S]{0,260}loading="lazy"/i.test(productHtml)) {
    failures.push("Golden Static LCP image is lazy loaded");
  }

  const boutiqueHtml = readDistHtml("boutique.html");
  const highPriorityCount = (boutiqueHtml.match(/fetchpriority="high"/gi) || []).length;
  if (highPriorityCount > 5) failures.push(`too many high priority images on boutique: ${highPriorityCount}`);
  if (!boutiqueHtml.includes("/images/products/")) failures.push("optimized product card images missing from boutique HTML");
  for (const image of publicImages) {
    if (image.bytes > 1500 * 1024 && boutiqueHtml.includes(image.url)) {
      failures.push(`large source image rendered in boutique HTML: ${image.url}`);
    }
  }

  const blogHtml = readDistHtml("blog.html");
  if (!blogHtml.includes("/images/blog/")) failures.push("blog optimized images missing from prerendered HTML");
  for (const article of publishedBlogArticles) {
    const html = readDistHtml(`blog/${article.slug}.html`);
    if (!html.includes(article.images.wide)) {
      failures.push(`article hero image missing from HTML: ${article.slug}`);
    }
    if (!html.includes("fetchpriority=\"high\"")) {
      failures.push(`article hero image priority missing: ${article.slug}`);
    }
  }
}

function auditBuiltVariantSet(
  label: string,
  variant: { src: string; srcSet: string; sizes: string; width: number; height: number },
  maxBytes: number,
) {
  const urls = new Set([variant.src, ...parseSrcSet(variant.srcSet).map((candidate) => candidate.src)]);
  for (const url of urls) {
    const file = resolve(distDir, decodeURIComponent(url).replace(/^\/+/, ""));
    if (!existsSync(file)) {
      failures.push(`missing built variant for ${label}: ${url}`);
      continue;
    }
    const bytes = statSync(file).size;
    if (bytes > maxBytes) {
      failures.push(`${label} built variant too large: ${url} ${Math.round(bytes / 1024)} KB`);
    }
  }
}

async function auditRuntimeHero(variant: {
  src: string;
  srcSet: string;
  sizes: string;
  width: number;
  height: number;
}) {
  const server = await startAuditStaticServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: "block" });
  const consoleErrors: string[] = [];

  try {
    await context.addInitScript(() => {
      window.localStorage.setItem("verdanza-age-confirmed", "true");
    });
    await blockExternalServices(context);
    await context.route("**/api/public-promo-banners", (route) => route.abort());
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" && message.text() !== "Failed to load resource: net::ERR_FAILED") {
        consoleErrors.push(`${message.text()} @ ${message.location().url || "unknown"}`);
      }
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await gotoDomReady(page, `${server.baseUrl}/`);
    const hero = page.locator('img[src*="verdanza-hero-premium"]');
    if ((await hero.count()) !== 1) {
      failures.push(`home hero runtime count ${await hero.count()}`);
      return;
    }
    await hero.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(
      () => {
        const image = document.querySelector<HTMLImageElement>(
          'img[src*="verdanza-hero-premium"]',
        );
        return Boolean(image?.complete && image.naturalWidth > 0);
      },
      undefined,
      { timeout: 10000 },
    );
    const rendered = await hero.evaluate((image: HTMLImageElement) => ({
      src: image.getAttribute("src") || "",
      srcSet: image.getAttribute("srcset") || "",
      sizes: image.getAttribute("sizes") || "",
      fetchPriority: image.getAttribute("fetchpriority") || "",
      loading: image.getAttribute("loading") || "",
      width: image.getAttribute("width") || "",
      height: image.getAttribute("height") || "",
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    }));

    if (rendered.src !== variant.src) failures.push(`home hero runtime src mismatch: ${rendered.src}`);
    if (rendered.srcSet !== variant.srcSet) failures.push("home hero runtime srcSet mismatch");
    if (rendered.sizes !== variant.sizes) failures.push("home hero runtime sizes mismatch");
    if (rendered.fetchPriority !== "high") failures.push("home hero runtime fetchpriority high missing");
    if (rendered.loading === "lazy") failures.push("home hero is lazy loaded at runtime");
    if (Number(rendered.width) !== variant.width || Number(rendered.height) !== variant.height) {
      failures.push("home hero runtime dimensions mismatch");
    }
    if (!rendered.naturalWidth || !rendered.naturalHeight) failures.push("home hero runtime image not loaded");
    if (consoleErrors.length) {
      failures.push(`home hero runtime console errors: ${consoleErrors.join(" | ")}`);
    }
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
}

function listPublicImages(dir: string): PublicImage[] {
  return walk(dir)
    .filter((file) => /\.(png|jpe?g|webp|svg)$/i.test(file))
    .map((file) => {
      const url = `/${relative(publicDir, file).replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")}`;
      const decodedUrl = `/${relative(publicDir, file).replace(/\\/g, "/")}`;
      const generated = generatedPrefixes.some((prefix) => decodedUrl.startsWith(prefix));
      const used = referencedUrls.has(decodedUrl) || referencedUrls.has(url);
      return {
        url: decodedUrl,
        file: normalize(file),
        bytes: statSync(file).size,
        used,
        status: generated
          ? "generated"
          : used
            ? "used"
            : decodedUrl.includes("/Fiche produit/") || decodedUrl.includes("QRcode")
              ? "working-source"
              : "unused",
      };
    });
}

function parseSrcSet(srcSet: string) {
  return srcSet
    .split(",")
    .map((entry) => entry.trim().match(/^(\S+)\s+(\d+)w$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ src: match[1], width: Number(match[2]) }));
}

function publicFile(url: string) {
  return resolve(publicDir, decodeURIComponent(url).replace(/^\/+/, ""));
}

function readDistHtml(file: string) {
  const path = join(distDir, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function normalize(file: string) {
  return relative(process.cwd(), file).replace(/\\/g, "/");
}
