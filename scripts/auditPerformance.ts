import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  prerenderFallbackSeoRoutes,
  prerenderSeoRoutes,
} from "./seoRoutes";

const failures: string[] = [];
const distDir = resolve("dist");
const beforeReport = resolve("reports/performance/phase5-before.json");
const afterReport = resolve("reports/performance/phase5-after.json");
const bundleReport = resolve("reports/performance/bundle-latest.json");

if (!existsSync(distDir)) failures.push("dist is missing");
if (!existsSync(beforeReport)) failures.push("missing reports/performance/phase5-before.json");
if (!existsSync(afterReport)) failures.push("missing reports/performance/phase5-after.json");
if (!existsSync(bundleReport)) failures.push("missing reports/performance/bundle-latest.json");

const jsFiles = existsSync(distDir) ? walk(distDir).filter((file) => file.endsWith(".js")) : [];
const jsTextByFile = new Map(jsFiles.map((file) => [file, readFileSync(file, "utf8")]));
const allJsText = [...jsTextByFile.values()].join("\n");
const indexHtml = readHtml("index.html");
const homeHtml = readHtml("index.html");
const publicInitialAssets = referencedAssets(indexHtml).filter((asset) => asset.endsWith(".js"));
const publicInitialText = publicInitialAssets.map((asset) => readDistAsset(asset)).join("\n");
const largestJs = jsFiles
  .map((file) => ({ file, rawBytes: statSync(file).size, gzipBytes: gzipSync(readFileSync(file)).length }))
  .sort((left, right) => right.rawBytes - left.rawBytes)[0];

if (jsFiles.length < 4) failures.push(`expected split JS chunks, found ${jsFiles.length}`);
if (largestJs && largestJs.gzipBytes > 180 * 1024) {
  failures.push(`largest JS gzip too large: ${Math.round(largestJs.gzipBytes / 1024)} KB`);
}
if (publicInitialText.includes("firebase-admin") || allJsText.includes("firebase-admin")) {
  failures.push("firebase-admin found in client assets");
}
if (publicInitialText.includes("pdf-lib")) failures.push("pdf-lib found in public initial JS");
if (!hasChunkMatch(/Admin|adminUsers|invoice|coupon/i)) failures.push("admin chunk not detected");
if (!hasChunkMatch(/Account|customerProfile|favorites/i)) failures.push("account chunk not detected");
if (!hasChunkMatch(/Checkout|lastOrderSummary|quote-order|payment/i)) failures.push("checkout chunk not detected");
const heroPattern = /verdanza-hero-premium(?:-\d+)?\.webp/;
if (!heroPattern.test(homeHtml)) failures.push("home hero image missing");
if (!/fetchpriority="high"|fetchPriority="high"/i.test(homeHtml)) {
  failures.push("home LCP image is not high priority");
}
if (/verdanza-hero-premium(?:-\d+)?\.webp[\s\S]{0,250}loading="lazy"/i.test(homeHtml)) {
  failures.push("home LCP image is lazy loaded");
}
if (!/verdanza-hero-premium(?:-\d+)?\.webp[\s\S]{0,300}width="1672"/i.test(homeHtml)) {
  failures.push("home LCP image width missing");
}
if (!/verdanza-hero-premium(?:-\d+)?\.webp[\s\S]{0,350}height="941"/i.test(homeHtml)) {
  failures.push("home LCP image height missing");
}
const expectedPrerenderRoutes =
  prerenderSeoRoutes().length + prerenderFallbackSeoRoutes().length + 1;
if (expectedPrerenderRoutes !== 50) {
  failures.push(`expected 50 prerendered routes, found ${expectedPrerenderRoutes}`);
}
if (!existsSync(join(distDir, "404.html"))) failures.push("missing 404.html");
checkHtmlText();

if (failures.length) {
  console.error("Performance audit failures:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Performance audit passed.");
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function readHtml(file: string) {
  const path = join(distDir, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function referencedAssets(html: string) {
  return [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
}

function readDistAsset(asset: string) {
  const file = join(distDir, asset.replace(/^\//, ""));
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function hasChunkMatch(pattern: RegExp) {
  return [...jsTextByFile.entries()].some(([file, text]) => {
    const isInitial = publicInitialAssets.some((asset) => file.endsWith(asset.replace(/^\//, "")));
    return !isInitial && pattern.test(text);
  });
}

function checkHtmlText() {
  const corrupted = /Ã|â€™|�/;
  const requiredPages = ["index.html", "boutique.html", "fleurs-cbd.html", "livraison-express-aix.html"];
  requiredPages.forEach((file) => {
    const html = readHtml(file);
    if (!html) failures.push(`missing ${file}`);
    if (corrupted.test(html)) failures.push(`corrupted UTF-8 text in ${file}`);
    if (!/<title>[^<]+<\/title>/i.test(html)) failures.push(`missing title in ${file}`);
    if (!/<meta[^>]+name="description"[^>]+content="[^"]+"/i.test(html)) {
      failures.push(`missing description in ${file}`);
    }
    if (!/<h1[\s>]/i.test(html)) failures.push(`missing h1 in ${file}`);
  });
}
