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
  biscotti: "78edaec3b2539d6a35bc1e58f4c47bfdae5af0dfd6bd850259595c3df441bdb4",
  "blue-dream": "efea9187ff3407cfd7a2a21af127bea9dbcfc9178d8d8be62cbfbe2091898899",
  "lemon-skunk": "f0243ab36f3a0558a9bd7c25dbd9a5b9c99552d37f9a5e2c36859c2f845a19d2",
  mimosa: "dd3e0c3ab48758e1735d175fc52bafce233022ed276c960c3c0b47e594bc937d",
  "watermelon-candy": "8d381cb07a4cbfa906018d9a8defdeee67e5baaec421f514670d5ef8c4dff409",
  "zkittlez-og": "bf9ee2a140a1a56bb80484d54fbe63328cd5a9d7b82f15b1590da3fda85f85cc",
  "pollen-mousseux": "b9516d4168d85c87e7a4d4edfbbc1b95e2548ccfb8fbb9a188fc3ac43e97ed2f",
  kief: "79de3490c076dfcf5fb4f3e1b73d74c0dcbe42a20cbe65aca44b54ed3a54bb5b",
  "black-libanais": "181af77d9086b74e96266f129bd7d85e52f83d654318ca2719ac0d192e3f52db",
  "black-butter": "da2d01aa97defdd62efd02a41abd56492a6162aa218dc9901a4cf41de5583a04",
};

assert.equal(productSheets.length, 10, "the library must contain exactly 10 sheets");
assert.equal(
  productSheets.filter((sheet) => sheet.selectionProfile.category === "flower").length,
  6,
  "the library must contain six flowers",
);
assert.equal(
  productSheets.filter((sheet) => sheet.selectionProfile.category === "resin").length,
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
      `${sheet.slug}: PDF hash differs from the validated V6 standard`,
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
      reducedMotion: width === 390 ? "reduce" : "no-preference",
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

    const selector = page.locator("[data-product-selector]");
    await selector.scrollIntoViewIfNeeded();
    assert.equal(await selector.isVisible(), true, `${width}px: selector must be visible`);
    assert.equal(
      await page.locator("[data-product-selector-results]").count(),
      0,
      `${width}px: result must stay hidden before type and intensity are selected`,
    );

    await page.locator('[data-selector-option="category:flower"]').click();
    assert.equal(
      await page.locator('[data-selector-step="1"] > button').getAttribute("aria-expanded"),
      "false",
      `${width}px: type step must close after selection`,
    );
    assert.equal(
      await page.locator('[data-selector-step="2"] > button').getAttribute("aria-expanded"),
      "true",
      `${width}px: intensity step must open after type`,
    );
    await page.getByRole("button", { name: "Fort", exact: true }).click();
    await page.locator('[data-product-selector-results][data-result-category="flower"][data-result-intensity="forte"]').waitFor();
    assert.equal(
      await page.locator("[data-selector-alternative]").count() <= 2,
      true,
      `${width}px: selector must show at most two alternatives`,
    );
    if (width === 390) {
      const reducedMotionTransforms = await page
        .locator("[data-selector-primary-card], [data-selector-alternative]")
        .evaluateAll((cards) => cards.map((card) => getComputedStyle(card).transform));
      assert.ok(
        reducedMotionTransforms.every((transform) => transform === "none"),
        "390px reduced-motion: recommendation cards must not tilt",
      );
    }

    assert.equal(
      await page.locator('[data-selector-step="3"] > button').getAttribute("aria-expanded"),
      "true",
      `${width}px: aroma step must open after intensity`,
    );
    assert.equal(await page.locator('[data-selector-step="4"]').count(), 0, `${width}px: V6 must expose exactly three steps`);
    assert.equal(await selector.getByText("Ambiance", { exact: false }).count(), 0, `${width}px: ambience must be absent from V6 selector and results`);
    await page.getByRole("button", { name: "Peu importe", exact: true }).click();
    await page.locator('[data-selector-step="1"] > button').click();
    await page.locator('[data-selector-option="category:resin"]').click();
    await page.locator('[data-product-selector-results][data-result-category="resin"][data-result-intensity="forte"]').waitFor();
    const unavailableSoftIntensity = page.locator('[data-selector-option="intensity:douce"]');
    assert.equal(
      await unavailableSoftIntensity.isDisabled(),
      true,
      `${width}px: resin + soft must be announced as a disabled option`,
    );
    assert.match(
      await unavailableSoftIntensity.innerText(),
      /Doux\s+Aucun produit actuellement/i,
      `${width}px: unavailable intensity must remain visible with an explanation`,
    );
    assert.equal(
      await unavailableSoftIntensity.getAttribute("data-available"),
      "false",
      `${width}px: unavailable intensity must expose its computed availability state`,
    );

    const selectorInteractionMetrics = await page.evaluate(() => {
      const visibleButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-product-selector] button")]
        .filter((button) => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            !button.closest('[aria-hidden="true"]')
          );
        });
      const optionButtons = visibleButtons.filter((button) => button.hasAttribute("data-selector-option"));
      return {
        shortestButton: Math.min(...visibleButtons.map((button) => button.getBoundingClientRect().height)),
        overlappingOptions: optionButtons.some((button, index) => {
          const first = button.getBoundingClientRect();
          return optionButtons.slice(index + 1).some((other) => {
            const second = other.getBoundingClientRect();
            return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
          });
        }),
      };
    });
    assert.ok(selectorInteractionMetrics.shortestButton >= 43.5, `${width}px: selector buttons must be about 44px high`);
    assert.equal(selectorInteractionMetrics.overlappingOptions, false, `${width}px: selector options must not overlap`);

    await page.locator("[data-selector-reset]").click();
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0, `${width}px: reset must hide results`);
    assert.equal(
      await page.locator('[data-selector-step="1"] > button').getAttribute("aria-expanded"),
      "true",
      `${width}px: reset must reopen type`,
    );
    assert.equal(
      await page.locator('[data-selector-option="aroma:any"]').getAttribute("aria-pressed"),
      "true",
      `${width}px: reset must restore Peu importe`,
    );

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
    assert.equal(metrics.h2, 4, `${width}px: selector, library and category H2 headings are required`);
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
