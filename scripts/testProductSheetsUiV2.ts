import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const viewports = [320, 360, 390, 430, 768, 1024, 1280, 1440];
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

try {
  for (const width of viewports) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      serviceWorkers: "block",
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    await context.addInitScript(() => {
      localStorage.setItem("verdanza-age-confirmed", "true");
      localStorage.setItem("verdanza-consent-v1", JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-10-06T00:00:00Z" }));
    });
    await blockExternalServices(context);
    const page = await context.newPage();
    const errors: string[] = [];
    const pdfRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith(".pdf")) pdfRequests.push(request.url());
    });
    const response = await gotoDomReady(page, `${server.baseUrl}/fiches-produits`);
    assert.equal(response?.status(), 200, `${width}px: route must return 200`);
    const selector = page.locator("[data-product-selector]");
    assert.equal(await selector.isVisible(), true);
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0);
    assert.equal(await page.locator('[data-selector-step="1"] > button').getAttribute("aria-expanded"), "true");
    assert.match(await page.locator('[data-selector-step="3"] > button').innerText(), /À choisir/i);

    await page.locator('[data-selector-option="category:flower"]').click();
    assert.equal(await page.locator('[data-selector-option="intensity:doux"]').isDisabled(), false);
    assert.equal(await page.locator('[data-selector-option="intensity:moyen"]').isDisabled(), true);
    assert.equal(await page.locator('[data-selector-option="intensity:fort"]').isDisabled(), false);
    await page.locator('[data-selector-option="intensity:doux"]').click();
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0, `${width}px: results require the explicit aroma choice`);
    await page.locator('[data-selector-option="aroma:fruite"]').click();
    await page.locator('[data-product-selector-results][data-result-category="flower"][data-result-intensity="doux"]').waitFor();
    assert.deepEqual(
      await page.locator("[data-selector-result-card]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-selector-result-card"))),
      ["blue-dream-cbd", "mandarine-cbd", "mango-haze-cbd", "cookie-kush-indoor", "harlequin-greenhouse", "petites-tetes-og-kush"],
      `${width}px: aroma must only reorder the six exact flower matches`,
    );
    assert.match(await page.locator('[data-selector-summary][data-sticky="false"]').innerText(), /Fleurs\s*·\s*Doux\s*·\s*Fruité/i);
    if (width === 390) {
      const transforms = await page.locator("[data-selector-result-card]").evaluateAll((cards) => cards.map((card) => getComputedStyle(card).transform));
      assert.ok(transforms.every((transform) => transform === "none"), "reduced motion must disable result tilt");
    }

    const library = page.locator("#all-product-sheets");
    await library.scrollIntoViewIfNeeded();
    if (width < 768) {
      await page.locator('[data-selector-summary][data-sticky="true"]').waitFor({ state: "visible" });
      assert.match(await page.locator('[data-selector-summary][data-sticky="true"]').innerText(), /Fleurs\s*·\s*Doux\s*·\s*Fruité/i);
    }
    assert.equal(await page.locator('[data-product-sheet-tab="flower"]').getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("[data-product-sheet-card]").count(), 7, `${width}px: flower tab must contain seven available flowers`);
    assert.equal(await library.locator("[data-signature-v1-preview]").count(), 7, `${width}px: all visible flower cards must use Signature V1`);
    assert.equal(await library.locator("[data-signature-v1-preview]").evaluateAll((images) => images.every((image) =>
      image.getAttribute("src")?.includes("/signature-v1/") && image.getAttribute("srcset")?.includes("-320.webp")
    )), true, `${width}px: Signature V1 responsive previews must use the versioned 320/640 assets`);
    assert.equal(await page.locator("[data-product-sheet-card]").first().getAttribute("data-product-sheet-card"), "blue-dream-cbd");
    await page.locator('[data-product-sheet-tab="resin"]').click();
    await page.locator('[data-product-sheet-category="resin"]').waitFor();
    assert.equal(await page.locator("[data-product-sheet-card]").count(), 5, `${width}px: resin tab must contain five available resins`);
    assert.equal(await library.locator("[data-signature-v1-preview]").count(), 5, `${width}px: all visible resin cards must use Signature V1`);
    assert.deepEqual(await page.locator("[data-product-sheet-card] h3").allTextContents(), ["Golden Static", "Suprême 50 % CBD", "Black Afghan", "Ice-o-Lator", "Mousseux Skywalker"]);
    assert.equal(await page.locator("[data-product-sheet-position]").innerText(), "1 / 5");
    assert.equal(await page.locator("[data-planned-product-sheets]").count(), 0, "no planned section may remain");
    assert.equal(await page.getByText(/Prochainement dans la sélection/).count(), 0);

    await selector.scrollIntoViewIfNeeded();
    const edit = page.locator('[data-selector-summary][data-sticky="false"] [data-selector-edit]');
    await edit.click();
    await page.locator('[data-selector-step="1"] > button').click();
    await page.locator('[data-selector-option="category:resin"]').click();
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0);
    assert.match(await page.locator('[data-selector-step="2"] > button').innerText(), /Doux/i);
    assert.equal(await page.locator('[data-selector-step="3"] > button').getAttribute("aria-expanded"), "true");
    await page.locator('[data-selector-option="aroma:any"]').click();
    assert.deepEqual(
      await page.locator("[data-selector-result-card]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-selector-result-card"))),
      ["golden-static", "supreme-50-cbd"],
      `${width}px: resin selector must match the audited active range`,
    );
    assert.match(await page.locator('[data-selector-summary][data-sticky="false"]').innerText(), /Résines\s*·\s*Doux\s*·\s*Peu importe/i);

    await page.locator("[data-selector-reset]").click();
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0);
    assert.equal(await selector.getAttribute("data-selector-collapsed"), "false");
    assert.equal(await page.locator('[data-selector-step="1"] > button').getAttribute("aria-expanded"), "true");
    assert.match(await page.locator('[data-selector-step="3"] > button').innerText(), /À choisir/i);
    assert.equal(await page.locator('a[href*="/skittle-plus/"]').count(), 0, `${width}px: historical Skittle Plus URL must not be active`);

    if (width === 390) {
      await page.locator('[data-selector-option="category:flower"]').click();
      await page.locator('[data-selector-option="intensity:fort"]').click();
      await page.locator('[data-selector-option="aroma:agrumes"]').click();
      assert.deepEqual(await page.locator("[data-selector-result-card]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-selector-result-card"))), ["skittlez-plus"]);
      await page.locator("[data-selector-reset]").click();

      await page.locator('[data-selector-option="category:resin"]').click();
      await page.locator('[data-selector-option="intensity:moyen"]').click();
      await page.locator('[data-selector-option="aroma:epice"]').click();
      assert.deepEqual(await page.locator("[data-selector-result-card]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-selector-result-card"))), ["ice-o-lator", "black-afghan"]);
      await page.locator("[data-selector-reset]").click();

      await page.locator('[data-selector-option="category:resin"]').click();
      await page.locator('[data-selector-option="intensity:fort"]').click();
      await page.locator('[data-selector-option="aroma:boise"]').click();
      assert.deepEqual(await page.locator("[data-selector-result-card]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-selector-result-card"))), ["mousseux-skywalker"]);
      await page.locator("[data-selector-reset]").click();
    }

    const layout = await page.evaluate(() => {
      const carousel = document.querySelector<HTMLElement>("[data-product-sheet-carousel]");
      const visibleButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-product-selector] button")].filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== "hidden";
      });
      const help = document.querySelector<HTMLElement>('[data-floating-help-footprint]:not([aria-hidden="true"]) [data-testid="floating-contact-trigger"]');
      const cta = document.querySelector<HTMLElement>('[data-product-sheet-card][data-active="true"] a');
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        carouselOverflow: carousel ? carousel.scrollWidth - carousel.clientWidth : 0,
        carouselDisplay: carousel ? getComputedStyle(carousel).display : "",
        shortestButton: Math.min(...visibleButtons.map((button) => button.getBoundingClientRect().height)),
        helpOverlap: Boolean(help && cta && help.getBoundingClientRect().left < cta.getBoundingClientRect().right && help.getBoundingClientRect().right > cta.getBoundingClientRect().left && help.getBoundingClientRect().top < cta.getBoundingClientRect().bottom && help.getBoundingClientRect().bottom > cta.getBoundingClientRect().top),
      };
    });
    assert.ok(layout.pageOverflow <= 1, `${width}px: page overflow ${layout.pageOverflow}`);
    assert.ok(layout.shortestButton >= 43.5, `${width}px: touch targets must be about 44px`);
    assert.equal(layout.helpOverlap, false, `${width}px: help must not cover the active CTA`);
    if (width < 1024) {
      assert.ok(layout.carouselOverflow > 0);
      assert.equal(layout.carouselDisplay, "flex");
    } else {
      assert.equal(layout.carouselDisplay, "grid");
    }
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await selector.getByText(/Ambiance|Cocooning|Détente profonde|Dynamique|Équilibré/i).count(), 0);
    assert.deepEqual(pdfRequests, [], `${width}px: PDFs must not preload`);
    assert.deepEqual(errors, [], `${width}px: browser errors`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log("Product sheets UI V2 tests passed: 12 active + 0 planned, tabs, carousel, accessibility and 8 responsive widths.");
