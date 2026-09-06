import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { productSheets } from "../src/data/productSheets";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const publicDir = resolve("public");
const distDir = resolve("dist");
const expectedPdfHashes: Record<string, string> = {
  biscotti: "566e9e0926ba2a24b73fb0f91f9ecb32c13e1e537a74d5db6b9e3f390ad18f7a",
  "blue-dream": "713875a691d70b0a9b9ef3c735f4890b3235e44ab330ac1cab3af1c7d404be87",
  "lemon-skunk": "d8ee71213bc7baf5513e364dd1e7a899c231db3250284fc568a9ebc832b14ace",
  mimosa: "2f77b96c8ce7d168c076bc8c301d7b97cc826e40e6683e0b8254942f774f06c0",
  "watermelon-candy": "4e09195c75321d44fa2025dead407a28e01beca8b825bc9c962812763f6659ca",
  "zkittlez-og": "ce27ed529402ddd3f10da23d08aff843dc148e45b1ba57d1c6874297ad84c31b",
  "pollen-mousseux": "26aaf58dc3b07d6308df351288ef4b67bbcc4a10b96b8320af9d40b99e55f050",
  kief: "1b659ca37e6bbde9d0cb5234358799e99629622fe8d5007d5e24761ea10a4c72",
  "black-libanais": "b02e2b579f88860ab942bdf6c82d8d5a4b973ef6609b37ca3b1e7c38749ba32e",
  "black-butter": "2040feb70e4b975f40db97bea12670dbf375e87ab63ec329a87b5912977ee6de",
};

assert.equal(productSheets.length, 10, "the library must contain exactly 10 sheets");
assert.equal(
  productSheets.filter((sheet) => sheet.category === "flowers").length,
  6,
  "the library must contain six flowers",
);
assert.equal(
  productSheets.filter((sheet) => sheet.category === "resins").length,
  4,
  "the library must contain four resins",
);
assert.equal(
  new Set(productSheets.map((sheet) => sheet.slug)).size,
  productSheets.length,
  "product sheet slugs must be unique",
);

for (const sheet of productSheets) {
  assert.equal(
    sheet.pdfUrl,
    `/fiches-produits/${sheet.slug}/verdanza-${sheet.slug}.pdf`,
    `${sheet.slug}: unexpected PDF URL`,
  );
  assert.equal(
    sheet.previewUrl,
    `/images/fiches-produits/${sheet.slug}.webp`,
    `${sheet.slug}: unexpected preview URL`,
  );

  for (const root of [publicDir, distDir]) {
    const pdfPath = join(root, ...sheet.pdfUrl.split("/").filter(Boolean));
    const previewPath = join(root, ...sheet.previewUrl.split("/").filter(Boolean));
    assert.ok(existsSync(pdfPath), `${relative(process.cwd(), pdfPath)} is missing`);
    assert.ok(existsSync(previewPath), `${relative(process.cwd(), previewPath)} is missing`);
    assert.equal(
      readFileSync(pdfPath).subarray(0, 5).toString("ascii"),
      "%PDF-",
      `${relative(process.cwd(), pdfPath)} is not a PDF`,
    );
    assert.equal(
      sha256(pdfPath),
      expectedPdfHashes[sheet.slug],
      `${sheet.slug}: PDF hash differs from the validated V5.1 standard`,
    );

    const metadata = await sharp(previewPath).metadata();
    assert.equal(metadata.format, "webp", `${sheet.slug}: preview must be WebP`);
    assert.equal(metadata.width, 640, `${sheet.slug}: preview width must be 640px`);
    assert.equal(metadata.height, 888, `${sheet.slug}: preview height must be 888px`);
  }
}

const publicPdfFiles = walkFiles(join(publicDir, "fiches-produits")).filter(
  (file) => extname(file).toLowerCase() === ".pdf",
);
const distPdfFiles = walkFiles(join(distDir, "fiches-produits")).filter(
  (file) => extname(file).toLowerCase() === ".pdf",
);
assert.equal(publicPdfFiles.length, 10, "public tree must contain exactly 10 PDFs");
assert.equal(distPdfFiles.length, 10, "build tree must contain exactly 10 PDFs");
assert.ok(
  [...publicPdfFiles, ...distPdfFiles].every(
    (file) => !file.toLowerCase().includes("print-safe"),
  ),
  "print-safe PDFs must not be published",
);
assert.equal(
  existsSync(join(distDir, "Fiche produit", "Nouveau produits", "production-v5.1")),
  false,
  "the internal V5.1 production tree must not be exposed in the build",
);

const routeHtmlPath = join(distDir, "fiches-produits.html");
assert.ok(existsSync(routeHtmlPath), "the clean prerendered route is missing");
const routeHtml = readFileSync(routeHtmlPath, "utf8");
assert.match(routeHtml, /<h1[^>]*>Fiches produits<\/h1>/i, "the route must contain its H1");
assert.match(
  routeHtml,
  /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/verdanza\.fr\/fiches-produits["']/i,
  "the canonical URL is missing or incorrect",
);
assert.equal(metaContent(routeHtml, "robots"), "noindex,follow", "robots must be noindex,follow");
assert.equal(
  [...routeHtml.matchAll(/href=["'][^"']+\.pdf["']/gi)].length,
  10,
  "the prerendered route must link exactly 10 PDFs",
);
assert.doesNotMatch(routeHtml, /"@type"\s*:\s*"Product"/i, "Product schema must not be present");
assert.doesNotMatch(routeHtml, /production-v5\.1/i, "internal production path leaked into HTML");

const sitemap = readFileSync(join(distDir, "sitemap.xml"), "utf8");
assert.doesNotMatch(sitemap, /fiches-produits/i, "product sheets must not be in the sitemap");
assert.doesNotMatch(sitemap, /\.pdf(?:<|$)/i, "PDFs must not be in the sitemap");

const vercelConfig = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
  headers?: Array<{ source?: string; headers?: Array<{ key?: string; value?: string }> }>;
};
const pdfHeaderRule = vercelConfig.headers?.find(
  (rule) =>
    rule.source === "/fiches-produits/(.*)" &&
    rule.headers?.some(
      (header) => header.key?.toLowerCase() === "x-robots-tag" && header.value === "noindex",
    ),
);
assert.ok(pdfHeaderRule, "vercel.json must set X-Robots-Tag: noindex below /fiches-produits/");

const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });
const viewports = [320, 360, 390, 430, 768, 1280];

try {
  for (const width of viewports) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      serviceWorkers: "block",
    });
    await context.addInitScript(() => {
      window.localStorage.setItem("verdanza-age-confirmed", "true");
      window.localStorage.setItem(
        "verdanza-consent-v1",
        JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-06T00:00:00.000Z" }),
      );
    });
    await blockExternalServices(context);
    const pdfRequests: string[] = [];
    context.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith(".pdf")) pdfRequests.push(request.url());
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const response = await gotoDomReady(page, `${server.baseUrl}/fiches-produits`);
    assert.equal(response?.status(), 200, `${width}px: route must return HTTP 200`);
    await page.locator('[data-product-sheet-card]').first().scrollIntoViewIfNeeded();
    await page.locator('[data-product-sheet-card] img').first().waitFor({ state: "visible" });
    await page.waitForFunction(
      () => document.querySelector<HTMLImageElement>('[data-product-sheet-card] img')?.naturalWidth === 640,
    );

    const metrics = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>('[data-product-sheet-card]')];
      const flowerCards = cards.slice(0, 6);
      const columnCount = new Set(flowerCards.map((card) => Math.round(card.getBoundingClientRect().left))).size;
      const pdfLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-product-sheet-card] a[href$=".pdf"]')];
      return {
        cards: cards.length,
        columnCount,
        h1: document.querySelectorAll("h1").length,
        h2: document.querySelectorAll("h2").length,
        viewportWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        imageAltMissing: [...document.querySelectorAll<HTMLImageElement>('[data-product-sheet-card] img')].some(
          (image) => !image.alt.trim(),
        ),
        badLinkAttributes: pdfLinks.some(
          (link) =>
            link.target !== "_blank" ||
            !link.relList.contains("noopener") ||
            !link.relList.contains("noreferrer"),
        ),
        pdfLinks: pdfLinks.length,
        embeds: document.querySelectorAll("iframe, embed, object").length,
      };
    });

    assert.equal(metrics.cards, 10, `${width}px: all product cards must render`);
    assert.equal(metrics.h1, 1, `${width}px: exactly one H1 is required`);
    assert.equal(metrics.h2, 2, `${width}px: two H2 section headings are required`);
    assert.equal(metrics.scrollWidth, metrics.viewportWidth, `${width}px: horizontal overflow detected`);
    assert.equal(metrics.columnCount, width < 640 ? 1 : width < 1280 ? 2 : 3, `${width}px: unexpected grid columns`);
    assert.equal(metrics.imageAltMissing, false, `${width}px: image alt text is missing`);
    assert.equal(metrics.badLinkAttributes, false, `${width}px: PDF link attributes are incomplete`);
    assert.equal(metrics.pdfLinks, 10, `${width}px: exactly 10 PDF links are required`);
    assert.equal(metrics.embeds, 0, `${width}px: PDFs must not be embedded`);
    assert.deepEqual(pdfRequests, [], `${width}px: PDFs must not load before a click`);
    assert.deepEqual(pageErrors, [], `${width}px: page errors detected`);

    const firstPdfLink = page.locator('[data-product-sheet-card] a[href$=".pdf"]').first();
    await firstPdfLink.focus();
    const focusVisible = await firstPdfLink.evaluate((link) => {
      const style = getComputedStyle(link);
      return style.outlineStyle !== "none" || style.boxShadow !== "none";
    });
    assert.equal(focusVisible, true, `${width}px: PDF link needs a visible focus state`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log("Product sheets tests passed: 10 PDFs, 10 previews, SEO, sitemap and responsive layout.");

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}

function metaContent(html: string, name: string) {
  const tag = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, "i"))?.[0] || "";
  return tag.match(/content=["']([^"']*)["']/i)?.[1] || "";
}
