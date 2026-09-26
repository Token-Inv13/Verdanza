import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { products } from "../src/data/products";
import { productCardImageVariants } from "../src/lib/generatedImageVariants";
import { productCardMediaBySlug } from "../src/lib/productCardMedia";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const widths = [390, 430, 1280] as const;
const routes = ["/", "/boutique", "/fleurs-cbd", "/resines-cbd"] as const;
const activeProducts = products.filter((product) => product.isActive);
const goldenVariant = productCardImageVariants[productCardMediaBySlug["golden-static"].src];
assert.ok(goldenVariant, "Golden Static card variant is required");
const { data: goldenPixels, info: goldenInfo } = await sharp(
  resolve("public", goldenVariant.src.replace(/^\//, "")),
).raw().toBuffer({ resolveWithObject: true });
let goldenLeft = goldenInfo.width;
let goldenRight = -1;
for (let y = 0; y < goldenInfo.height; y += 1) {
  for (let x = 0; x < goldenInfo.width; x += 1) {
    const offset = (y * goldenInfo.width + x) * goldenInfo.channels;
    if (goldenPixels[offset] < 200 && goldenPixels[offset + 1] < 200 && goldenPixels[offset + 2] < 200) {
      goldenLeft = Math.min(goldenLeft, x);
      goldenRight = Math.max(goldenRight, x);
    }
  }
}
const goldenProductWidthRatio = (goldenRight - goldenLeft + 1) / goldenInfo.width;
const goldenOccupancies: string[] = [];
const screenshotDir = join(tmpdir(), "verdanza-v2-1-productcard-qa-20260925");
mkdirSync(screenshotDir, { recursive: true });

const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  // Original gallery photos are not all optimized variants; serve encoded names
  // faithfully while retaining the static server's filesystem boundary.
  for (const source of ["/Fiche produit/Golden static/DSC02266copie.webp",
    "/Fiche produit/Supreme/supreme-50-cbd-texture.webp"]) {
    const response = await fetch(`${server.baseUrl}${source}`);
    assert.equal(response.status, 200, `encoded gallery asset must resolve: ${source}`);
    assert.equal(response.headers.get("content-type"), "image/webp");
  }
  assert.equal((await fetch(`${server.baseUrl}/%2e%2e%5cpackage.json`)).status, 404,
    "encoded traversal must never expose files outside dist");
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width === 1280 ? 800 : width === 430 ? 932 : 844 },
      serviceWorkers: "block",
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    await context.addInitScript(() => {
      (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean })
        .__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
      window.localStorage.setItem("verdanza-age-confirmed", "true");
      window.localStorage.setItem(
        "verdanza-consent-v1",
        JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-25T00:00:00.000Z" }),
      );
    });
    await blockExternalServices(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const brokenImages: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.request().resourceType() === "image" && response.status() >= 400) {
        brokenImages.push(`${response.status()} ${response.url()}`);
      }
    });

    for (const route of routes) {
      const response = await gotoDomReady(page, `${server.baseUrl}${route}`);
      assert.equal(response?.status(), 200, `${width}px ${route}: HTTP 200 expected`);
      await page.locator(".product-card-v2").first().waitFor();
      const products = route === "/fleurs-cbd"
        ? activeProducts.filter((product) => product.category === "flowers")
        : route === "/resines-cbd"
          ? activeProducts.filter((product) => product.category === "resins")
          : route === "/boutique" ? activeProducts : [];
      if (products.length) {
        assert.equal(await page.locator(".product-card-v2").count(), products.length);
      }

      const layout = await page.evaluate(() => {
        const cards = [...document.querySelectorAll<HTMLElement>(".product-card-v2")];
        const firstImage = cards[0]?.querySelector<HTMLElement>(".product-card-v2__image");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          columns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size,
          cardFilter: cards[0] ? getComputedStyle(cards[0]).filter : "missing",
          imageFilter: firstImage ? getComputedStyle(firstImage).filter : "missing",
        };
      });
      assert.ok(layout.overflow <= 1, `${width}px ${route}: horizontal overflow`);
      assert.equal(layout.cardFilter, "none", `${width}px ${route}: blurred card`);
      assert.equal(layout.imageFilter, "none", `${width}px ${route}: blurred photo`);
      if (route !== "/") {
        assert.equal(layout.columns, width < 640 ? 1 : route === "/resines-cbd" ? 2 : 3);
      }

      for (const card of await page.locator(".product-card-v2").all()) {
        const image = card.locator("img.product-card-v2__image");
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((element: HTMLImageElement) => element.decode());
        const state = await image.evaluate((element: HTMLImageElement) => ({
          complete: element.complete,
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
          width: element.getAttribute("width"),
          height: element.getAttribute("height"),
          srcSet: element.getAttribute("srcset") || "",
          filter: getComputedStyle(element).filter,
        }));
        assert.ok(state.complete && state.naturalWidth > 0 && state.naturalHeight > 0);
        assert.ok(Number(state.width) > 0 && Number(state.height) > 0);
        assert.match(state.srcSet, /320w.*640w/);
        assert.equal(state.filter, "none");
      }

      if (route === "/boutique") {
        const goldenCard = page.locator(".product-card-v2").filter({
          has: page.locator('a[href="/produits/golden-static"]'),
        });
        assert.equal(await goldenCard.count(), 1);
        const goldenImageLayout = await goldenCard.locator("img.product-card-v2__image").evaluate(
          (element: HTMLImageElement) => {
            const box = element.getBoundingClientRect();
            return {
              width: box.width,
              fittedWidth: Math.min(box.width, box.height * element.naturalWidth / element.naturalHeight),
            };
          },
        );
        const occupancy = goldenProductWidthRatio * goldenImageLayout.fittedWidth / goldenImageLayout.width;
        assert.ok(occupancy >= 0.65 && occupancy <= 0.70,
          `${width}px: Golden Static should occupy 65–70% of the useful card image width, got ${(occupancy * 100).toFixed(1)}%`);
        goldenOccupancies.push(`${width}px ${(occupancy * 100).toFixed(1)}%`);
        for (const product of activeProducts) {
          const card = page.locator(".product-card-v2").filter({
            has: page.locator(`a[href="/produits/${product.slug}"]`),
          });
          assert.equal(await card.count(), 1, `${width}px: missing card for ${product.slug}`);
          const expected = productCardMediaBySlug[product.slug];
          const image = card.locator("img.product-card-v2__image");
          assert.ok(expected, `${product.slug}: no chosen card photo`);
          const selectedSrcSet = await image.getAttribute("srcset");
          if (expected.src !== product.image) {
            assert.match(selectedSrcSet || "", new RegExp(`${product.slug}-editorial-card-640\\.webp`));
          } else {
            assert.doesNotMatch(selectedSrcSet || "", /editorial-card/);
          }
        }
        await page.screenshot({ path: join(screenshotDir, `boutique-${width}.png`), fullPage: true });
        await page.locator(".product-card-v2").first().screenshot({
          path: join(screenshotDir, `productcard-${width}.png`),
        });
      }
      assert.deepEqual(brokenImages, [], `${width}px ${route}: image HTTP errors`);
      assert.deepEqual(pageErrors, [], `${width}px ${route}: browser errors`);
    }
    await gotoDomReady(page, `${server.baseUrl}/produits/golden-static`);
    const galleryImage = page.locator("[data-product-gallery] img.product-page-v2__image");
    await galleryImage.waitFor();
    assert.match(await galleryImage.getAttribute("src") || "", /golden-static-detail\.webp$/);
    assert.equal(await page.getByRole("img", { name: "Sceau officiel Verdanza" }).count(), 1);
    assert.match(await page.locator("main").innerText(), /Crémeuse/, "ProductPage still shows appearance details");
    for (const slug of ["golden-static", "supreme-50-cbd"]) {
      await gotoDomReady(page, `${server.baseUrl}/produits/${slug}`);
      for (const image of await page.locator("[data-product-gallery] img").all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((element: HTMLImageElement) => element.decode());
      }
    }
    assert.deepEqual(pageErrors, [], `${width}px ProductPage: browser errors`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`PASS ProductCard media UI at 390/430/1280px; Golden Static occupies ${goldenOccupancies.join(", ")}; ProductPage remains intact, all card photos decode without 404/filter/overflow. QA captures: ${screenshotDir}`);
