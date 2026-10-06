import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { availableProductSheets, plannedProductSheets, productSheets } from "../src/data/productSheets";
import { products } from "../src/data/products";

const publicDir = resolve("public");
const distDir = resolve("dist");
const expected = [
  ["flower-blue-dream-cbd", "blue-dream-cbd", "Blue Dream", "flower"],
  ["flower-cookie-kush-indoor", "cookie-kush-indoor", "Cookie Kush Indoor", "flower"],
  ["flower-harlequin-greenhouse", "harlequin-greenhouse", "Harlequin Greenhouse", "flower"],
  ["flower-mandarine-cbd", "mandarine-cbd", "Mandarine", "flower"],
  ["flower-mango-haze-cbd", "mango-haze-cbd", "Mango Haze", "flower"],
  ["flower-petites-tetes-og-kush", "petites-tetes-og-kush", "OG Kush", "flower"],
  ["resin-golden-static", "golden-static", "Golden Static", "resin"],
  ["resin-supreme-50-cbd", "supreme-50-cbd", "Suprême 50 % CBD", "resin"],
] as const;

assert.equal(productSheets.length, 12, "the documentary library must contain eight current and four planned products");
assert.equal(availableProductSheets.length, 8, "the active selector/library range must remain at eight products");
assert.equal(plannedProductSheets.length, 4, "the planned documentary range must contain exactly four products");
assert.deepEqual(
  availableProductSheets.map((sheet) => [sheet.productId, sheet.slug, sheet.name, sheet.selectionProfile.category]),
  expected,
  "the public sheet library must match the audited shop catalogue",
);
assert.equal(availableProductSheets.filter((sheet) => sheet.selectionProfile.category === "flower").length, 6);
assert.equal(availableProductSheets.filter((sheet) => sheet.selectionProfile.category === "resin").length, 2);
assert.equal(new Set(productSheets.map((sheet) => sheet.productId)).size, 12, "stable product ids must be unique");
assert.equal(new Set(productSheets.map((sheet) => sheet.slug)).size, 12, "sheet slugs must be unique");

for (const sheet of availableProductSheets) {
  const product = products.find((candidate) => candidate.id === sheet.productId);
  assert.ok(product, `${sheet.productId}: catalogue product is missing`);
  assert.equal(product.slug, sheet.slug, `${sheet.productId}: catalogue/sheet slug mismatch`);
  assert.equal(product.category === "flowers" ? "flower" : "resin", sheet.selectionProfile.category);
  assert.equal(sheet.pdfUrl, `/fiches-produits/${sheet.slug}/verdanza-${sheet.slug}-modern-20261007.pdf`);
  assert.equal(sheet.previewUrl, `/images/fiches-produits/${sheet.slug}-modern-20261007.webp`);
  const family = sheet.selectionProfile.category === "flower" ? "flowers" : "resins";
  const sourceRoot = resolve("docs/product-sheets/production-modern-2026-10-07");
  const sourcePdf = join(sourceRoot, family, sheet.slug, "print", `verdanza-${sheet.slug}-a6-modern-20261007-standard.pdf`);
  const safePdf = join(sourceRoot, family, sheet.slug, "print", `verdanza-${sheet.slug}-a6-modern-20261007-print-safe.pdf`);
  assert.ok(existsSync(sourcePdf), `${relative(process.cwd(), sourcePdf)} is missing`);
  assert.ok(existsSync(safePdf), `${relative(process.cwd(), safePdf)} is missing`);
  for (const root of [publicDir, distDir]) {
    const publicPdf = join(root, ...sheet.pdfUrl.split("/").filter(Boolean));
    const preview = join(root, ...sheet.previewUrl.split("/").filter(Boolean));
    assert.ok(existsSync(publicPdf), `${relative(process.cwd(), publicPdf)} is missing`);
    assert.ok(existsSync(preview), `${relative(process.cwd(), preview)} is missing`);
    assert.equal(readFileSync(publicPdf).subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(sha256(publicPdf), sha256(sourcePdf), `${sheet.slug}: published standard differs from documentary source`);
    const metadata = await sharp(preview).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 888);
  }
}

assert.deepEqual(plannedProductSheets.map((sheet) => sheet.slug), ["skittle-plus", "black-afghan", "ice-o-lator", "mousseux-skywalker"]);
for (const sheet of plannedProductSheets) {
  assert.equal(sheet.availability, "planned");
  assert.equal(products.some((product) => product.id === sheet.productId), false, `${sheet.slug}: planned sheet must not enter the shop catalogue`);
  for (const root of [publicDir, distDir]) {
    const publicPdf = join(root, ...sheet.pdfUrl.split("/").filter(Boolean));
    const preview = join(root, ...sheet.previewUrl.split("/").filter(Boolean));
    assert.ok(existsSync(publicPdf), `${sheet.slug}: planned PDF is missing`);
    assert.ok(existsSync(preview), `${sheet.slug}: planned preview is missing`);
    const family = sheet.selectionProfile.category === "flower" ? "flowers" : "resins";
    const sourcePdf = join(resolve("docs/product-sheets/production-modern-2026-10-07"), family, sheet.slug, "print", `verdanza-${sheet.slug}-a6-modern-20261007-standard.pdf`);
    assert.equal(sha256(publicPdf), sha256(sourcePdf), `${sheet.slug}: planned public copy differs from modern source`);
  }
}

const publicPdfs = walkFiles(join(publicDir, "fiches-produits")).filter((path) => extname(path).toLowerCase() === ".pdf");
const distPdfs = walkFiles(join(distDir, "fiches-produits")).filter((path) => extname(path).toLowerCase() === ".pdf");
assert.equal(publicPdfs.length, 20, "public assets must retain eight stable PDFs plus exactly twelve modern versioned PDFs");
assert.equal(distPdfs.length, 20, "the build must retain eight stable PDFs plus exactly twelve modern versioned PDFs");
assert.ok([...publicPdfs, ...distPdfs].every((path) => !path.toLowerCase().includes("print-safe")));

const routeHtml = readFileSync(join(distDir, "fiches-produits.html"), "utf8");
assert.match(routeHtml, /<h1[^>]*>Fiches produits<\/h1>/i);
assert.match(routeHtml, /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/verdanza\.fr\/fiches-produits["']/i);
assert.equal(metaContent(routeHtml, "robots"), "noindex,follow");
assert.match(routeHtml, /À venir/i);
assert.equal([...routeHtml.matchAll(/href=["'][^"']+\.pdf["']/gi)].length, 10, "the prerendered page must expose six current flower PDFs and four planned documentary PDFs");
assert.doesNotMatch(routeHtml, /"@type"\s*:\s*"Product"/i);

const sitemap = readFileSync(join(distDir, "sitemap.xml"), "utf8");
assert.doesNotMatch(sitemap, /fiches-produits/i);
assert.doesNotMatch(sitemap, /\.pdf(?:<|$)/i);
const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as { headers?: Array<{ source?: string; headers?: Array<{ key?: string; value?: string }> }> };
assert.ok(vercel.headers?.some((rule) => rule.source === "/fiches-produits/(.*)" && rule.headers?.some((header) => header.key?.toLowerCase() === "x-robots-tag" && header.value === "noindex")));

console.log("Product sheet tests passed: 8 available + 4 planned, isolated selector scope, documentary/public hashes, SEO and controlled assets.");

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}

function metaContent(html: string, name: string) {
  const match = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"));
  return match?.[1] ?? "";
}
