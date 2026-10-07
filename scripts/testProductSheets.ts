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
  assert.equal(sheet.pdfUrl, `/fiches-produits/${sheet.slug}/verdanza-${sheet.slug}-signature-v1.pdf`);
  assert.equal(sheet.previewUrl, `/images/fiches-produits/signature-v1/${sheet.slug}-signature-v1-640.webp`);
  const family = sheet.selectionProfile.category === "flower" ? "flowers" : "resins";
  const sourceRoot = resolve("docs/product-sheets/production-signature-v1-2026-10-07");
  const sourcePdf = join(sourceRoot, family, sheet.slug, "print", `verdanza-${sheet.slug}-signature-v1-standard.pdf`);
  const safePdf = join(sourceRoot, family, sheet.slug, "print", `verdanza-${sheet.slug}-signature-v1-print-safe.pdf`);
  assert.ok(existsSync(sourcePdf), `${relative(process.cwd(), sourcePdf)} is missing`);
  assert.ok(existsSync(safePdf), `${relative(process.cwd(), safePdf)} is missing`);
  for (const root of [publicDir, distDir]) {
    const publicPdf = join(root, ...sheet.pdfUrl.split("/").filter(Boolean));
    const preview = join(root, ...sheet.previewUrl.split("/").filter(Boolean));
    assert.ok(existsSync(publicPdf), `${relative(process.cwd(), publicPdf)} is missing`);
    assert.ok(existsSync(preview), `${relative(process.cwd(), preview)} is missing`);
    assert.equal(readFileSync(publicPdf).subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(sha256(publicPdf), sha256(sourcePdf), `${sheet.slug}: published standard differs from documentary source`);
    assert.equal(sha256(preview), sha256(join(sourceRoot, family, sheet.slug, "previews", `${sheet.slug}-signature-v1-640.webp`)), `${sheet.slug}: published preview differs from documentary source`);
    const metadata = await sharp(preview).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 800);
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
    const sourceRoot = resolve("docs/product-sheets/production-signature-v1-2026-10-07");
    const sourcePdf = join(sourceRoot, family, sheet.slug, "print", `verdanza-${sheet.slug}-signature-v1-standard.pdf`);
    assert.equal(sha256(publicPdf), sha256(sourcePdf), `${sheet.slug}: planned public copy differs from Signature V1 source`);
    assert.equal(sha256(preview), sha256(join(sourceRoot, family, sheet.slug, "previews", `${sheet.slug}-signature-v1-640.webp`)), `${sheet.slug}: planned preview differs from Signature V1 source`);
  }
}

const publicPdfs = walkFiles(join(publicDir, "fiches-produits")).filter((path) => extname(path).toLowerCase() === ".pdf");
const distPdfs = walkFiles(join(distDir, "fiches-produits")).filter((path) => extname(path).toLowerCase() === ".pdf");
assert.equal(publicPdfs.length, 32, "public assets must retain eight stable, twelve modern and twelve Signature V1 PDFs");
assert.equal(distPdfs.length, 32, "the build must retain eight stable, twelve modern and twelve Signature V1 PDFs");
assert.ok([...publicPdfs, ...distPdfs].every((path) => !path.toLowerCase().includes("print-safe")));

for (const sheet of productSheets) {
  const family = sheet.selectionProfile.category === "flower" ? "flowers" : "resins";
  const source = join(resolve("docs/product-sheets/production-signature-v1-2026-10-07"), family, sheet.slug);
  const pdf = join(source, "print", `verdanza-${sheet.slug}-signature-v1-standard.pdf`);
  assert.ok(existsSync(pdf), `${sheet.slug}: Signature V1 standard missing`);
  assert.equal(sheet.pdfUrl, `/fiches-produits/${sheet.slug}/verdanza-${sheet.slug}-signature-v1.pdf`);
  assert.equal(sheet.previewUrl, `/images/fiches-produits/signature-v1/${sheet.slug}-signature-v1-640.webp`);
  for (const root of [publicDir, distDir]) {
    const versioned = join(root, "fiches-produits", sheet.slug, `verdanza-${sheet.slug}-signature-v1.pdf`);
    assert.equal(sha256(versioned), sha256(pdf), `${sheet.slug}: Signature V1 PDF copy differs`);
    for (const width of [320, 640]) {
      const webp = join(root, "images/fiches-produits/signature-v1", `${sheet.slug}-signature-v1-${width}.webp`);
      assert.ok(existsSync(webp), `${sheet.slug}: Signature V1 ${width}px WebP missing`);
      assert.equal(sha256(webp), sha256(join(source, "previews", `${sheet.slug}-signature-v1-${width}.webp`)), `${sheet.slug}: Signature V1 ${width}px WebP copy differs`);
      const metadata = await sharp(webp).metadata();
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.width, width);
      assert.equal(metadata.height, width * 1.25);
    }
  }
}

const routeHtml = readFileSync(join(distDir, "fiches-produits.html"), "utf8");
assert.match(routeHtml, /<h1[^>]*>Fiches produits<\/h1>/i);
assert.match(routeHtml, /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/verdanza\.fr\/fiches-produits["']/i);
assert.equal(metaContent(routeHtml, "robots"), "noindex,follow");
assert.match(routeHtml, /À venir/i);
assert.doesNotMatch(routeHtml, /modern-20261007\.(?:pdf|webp)/i);
assert.equal([...routeHtml.matchAll(/href=["'][^"']+\.pdf["']/gi)].length, 10, "the prerendered page must expose six current flower PDFs and four planned documentary PDFs");
assert.doesNotMatch(routeHtml, /"@type"\s*:\s*"Product"/i);

const sitemap = readFileSync(join(distDir, "sitemap.xml"), "utf8");
assert.doesNotMatch(sitemap, /fiches-produits/i);
assert.doesNotMatch(sitemap, /\.pdf(?:<|$)/i);
const signatureQa = JSON.parse(readFileSync(resolve("docs/product-sheets/production-signature-v1-2026-10-07/SIGNATURE-V1-QA.json"), "utf8")) as {
  status: string;
  products: Array<{ slug: string; source_photo: string; source_photo_sha256: string }>;
};
assert.equal(signatureQa.status, "PASS");
assert.equal(signatureQa.products.length, 12);
const golden = signatureQa.products.find((product) => product.slug === "golden-static");
assert.ok(golden);
assert.equal(golden.source_photo, "public/Fiche produit/Golden static/Composition-ezgif.com-resize.webp");
assert.equal(golden.source_photo_sha256, "8cc588388bd397e14ac8f02e025737109332a5ad0eeb6a8b80cbe7d16e3f2436");
assert.equal(sha256(resolve(golden.source_photo)), golden.source_photo_sha256, "Golden Static must use the approved full-product source photograph");
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
