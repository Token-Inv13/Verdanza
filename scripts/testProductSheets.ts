import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { productSheets } from "../src/data/productSheets";
import { products } from "../src/data/products";

const publicDir = resolve("public");
const distDir = resolve("dist");
const productionDir = resolve("docs/product-sheets/production-active-2026-10-06/final");
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

assert.equal(productSheets.length, 8, "the public library must contain exactly the eight audited shop products");
assert.deepEqual(
  productSheets.map((sheet) => [sheet.productId, sheet.slug, sheet.name, sheet.selectionProfile.category]),
  expected,
  "the public sheet library must match the audited shop catalogue",
);
assert.equal(productSheets.filter((sheet) => sheet.selectionProfile.category === "flower").length, 6);
assert.equal(productSheets.filter((sheet) => sheet.selectionProfile.category === "resin").length, 2);
assert.equal(new Set(productSheets.map((sheet) => sheet.productId)).size, 8, "stable product ids must be unique");
assert.equal(new Set(productSheets.map((sheet) => sheet.slug)).size, 8, "sheet slugs must be unique");

for (const sheet of productSheets) {
  const product = products.find((candidate) => candidate.id === sheet.productId);
  assert.ok(product, `${sheet.productId}: catalogue product is missing`);
  assert.equal(product.slug, sheet.slug, `${sheet.productId}: catalogue/sheet slug mismatch`);
  assert.equal(product.category === "flowers" ? "flower" : "resin", sheet.selectionProfile.category);
  assert.equal(sheet.pdfUrl, `/fiches-produits/${sheet.slug}/verdanza-${sheet.slug}.pdf`);
  assert.equal(sheet.previewUrl, `/images/fiches-produits/${sheet.slug}.webp`);
  const family = sheet.selectionProfile.category === "flower" ? "flowers" : "resins";
  const sourcePdf = join(productionDir, family, sheet.slug, "print", `verdanza-${sheet.slug}-a6-active-standard.pdf`);
  const safePdf = join(productionDir, family, sheet.slug, "print", `verdanza-${sheet.slug}-a6-active-print-safe.pdf`);
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

const publicPdfs = walkFiles(join(publicDir, "fiches-produits")).filter((path) => extname(path).toLowerCase() === ".pdf");
const distPdfs = walkFiles(join(distDir, "fiches-produits")).filter((path) => extname(path).toLowerCase() === ".pdf");
assert.equal(publicPdfs.length, 8, "only active standard PDFs may remain in the public tree");
assert.equal(distPdfs.length, 8, "only active standard PDFs may be copied to the build");
assert.ok([...publicPdfs, ...distPdfs].every((path) => !path.toLowerCase().includes("print-safe")));

const routeHtml = readFileSync(join(distDir, "fiches-produits.html"), "utf8");
assert.match(routeHtml, /<h1[^>]*>Fiches produits<\/h1>/i);
assert.match(routeHtml, /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/verdanza\.fr\/fiches-produits["']/i);
assert.equal(metaContent(routeHtml, "robots"), "noindex,follow");
assert.doesNotMatch(routeHtml, /Archives accessibles|temporairement indisponibles/i);
assert.equal([...routeHtml.matchAll(/href=["'][^"']+\.pdf["']/gi)].length, 6, "the prerendered flower tab must expose the six active flower PDFs");
assert.doesNotMatch(routeHtml, /"@type"\s*:\s*"Product"/i);

const sitemap = readFileSync(join(distDir, "sitemap.xml"), "utf8");
assert.doesNotMatch(sitemap, /fiches-produits/i);
assert.doesNotMatch(sitemap, /\.pdf(?:<|$)/i);
const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as { headers?: Array<{ source?: string; headers?: Array<{ key?: string; value?: string }> }> };
assert.ok(vercel.headers?.some((rule) => rule.source === "/fiches-produits/(.*)" && rule.headers?.some((header) => header.key?.toLowerCase() === "x-robots-tag" && header.value === "noindex")));

console.log("Product sheet tests passed: 8/8 stable catalogue links, documentary/public hashes, WebP dimensions, SEO and public asset scope.");

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
