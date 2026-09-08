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
      window.localStorage.setItem("verdanza-age-confirmed", "true");
      window.localStorage.setItem(
        "verdanza-consent-v1",
        JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-07T00:00:00.000Z" }),
      );
    });
    await blockExternalServices(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const pdfRequests: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith(".pdf")) pdfRequests.push(request.url());
    });

    const response = await gotoDomReady(page, `${server.baseUrl}/fiches-produits`);
    assert.equal(response?.status(), 200, `${width}px: route must return HTTP 200`);

    const selector = page.locator("[data-product-selector]");
    assert.equal(await selector.isVisible(), true, `${width}px: selector must be visible`);
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0, `${width}px: results must start hidden`);
    assert.equal(await selector.getAttribute("data-selector-collapsed"), "false", `${width}px: selector must start expanded`);
    assert.equal(await page.locator('[data-selector-step="1"] > button').getAttribute("aria-expanded"), "true", `${width}px: type must start open`);
    assert.equal(await page.locator('[data-selector-step="2"] > button').isDisabled(), true, `${width}px: intensity must stay locked before type`);
    assert.equal(await page.locator('[data-selector-step="3"] > button').isDisabled(), true, `${width}px: aroma must stay locked before intensity`);
    assert.match(await page.locator('[data-selector-step="3"] > button').innerText(), /À choisir/i, `${width}px: aroma must start unselected`);
    assert.equal(await page.locator('[data-selector-option="aroma:any"]').getAttribute("aria-pressed"), "false", `${width}px: Peu importe must not be preselected`);
    assert.equal(await page.locator('a[href="#all-product-sheets"]').count(), 1, `${width}px: library anchor must use #all-product-sheets`);

    await page.locator('[data-selector-option="category:flower"]').click();
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0, `${width}px: type alone must not reveal results`);
    assert.equal(await page.locator('[data-selector-step="2"] > button').getAttribute("aria-expanded"), "true", `${width}px: intensity must open after type`);
    await page.locator('[data-selector-option="intensity:forte"]').click();
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0, `${width}px: type and intensity must not reveal results`);
    assert.equal(await selector.getAttribute("data-selector-collapsed"), "false", `${width}px: selector must stay expanded before aroma confirmation`);
    assert.equal(await page.locator('[data-selector-step="3"] > button').getAttribute("aria-expanded"), "true", `${width}px: aroma must open after intensity`);
    assert.equal(await page.locator('[data-selector-summary]').count(), 0, `${width}px: no compact or sticky summary may appear before the third choice`);
    await page.locator('[data-selector-option="aroma:fruite"]').click();
    await page.locator('[data-product-selector-results][data-result-category="flower"][data-result-intensity="forte"]').waitFor();
    assert.equal(await selector.getAttribute("data-selector-collapsed"), "true", `${width}px: selector must collapse after all three choices`);
    assert.match(await page.locator('[data-selector-summary][data-sticky="false"]').innerText(), /Fleurs\s*·\s*Fort\s*·\s*Fruité/i, `${width}px: compact summary is incomplete`);
    assert.deepEqual(
      await page.locator("[data-selector-result-card]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-selector-result-card"))),
      ["zkittlez-og", "blue-dream", "lemon-skunk"],
      `${width}px: Fruité must reorder all strict V6 matches without filtering them`,
    );
    assert.equal(await page.locator("[data-selector-result-card]").count(), 3, `${width}px: all exact results must stay visible`);

    if (width === 390) {
      const transforms = await page.locator("[data-selector-result-card]").evaluateAll((cards) => cards.map((card) => getComputedStyle(card).transform));
      assert.ok(transforms.every((transform) => transform === "none"), "390px reduced motion: result cards must not tilt");
    }

    await page.locator("#all-product-sheets").scrollIntoViewIfNeeded();
    if (width < 768) {
      await page.locator('[data-selector-summary][data-sticky="true"]').waitFor({ state: "visible" });
      assert.match(await page.locator('[data-selector-summary][data-sticky="true"]').innerText(), /Fleurs\s*·\s*Fort\s*·\s*Fruité/i, `${width}px: sticky summary must repeat the complete selection`);
      await page.locator('[data-selector-summary][data-sticky="true"] [data-selector-edit]').click();
    } else {
      assert.equal(await page.locator('[data-selector-summary][data-sticky="true"]').isVisible(), false, `${width}px: sticky summary is mobile-only`);
      await selector.scrollIntoViewIfNeeded();
      await page.locator('[data-selector-summary][data-sticky="false"] [data-selector-edit]').click();
    }
    await selector.scrollIntoViewIfNeeded();
    assert.equal(await page.locator('[data-selector-step="3"] > button').getAttribute("aria-expanded"), "true", `${width}px: Modify must reopen aroma`);
    await page.locator('[data-selector-option="aroma:any"]').click();
    assert.equal(
      await page.locator("[data-selector-result-card]").first().getAttribute("data-selector-result-card"),
      "blue-dream",
      `${width}px: Peu importe must restore stable exact-match order`,
    );
    assert.equal(await page.locator("[data-selector-result-card]").count(), 3, `${width}px: Peu importe must keep all exact matches`);
    assert.match(await page.locator('[data-selector-summary][data-sticky="false"]').innerText(), /Peu importe/i, `${width}px: explicit Peu importe must appear in the final summary`);
    const activeResultCard = page.locator('[data-selector-primary-card="true"]');
    const restingResultStyle = await activeResultCard.evaluate((card) => ({
      transform: getComputedStyle(card).transform,
      willChange: getComputedStyle(card).willChange,
    }));
    assert.equal(restingResultStyle.transform, "none", `${width}px: active result card must be untransformed at rest`);
    assert.equal(restingResultStyle.willChange, "auto", `${width}px: active result card must not be permanently promoted`);
    if (width >= 1024) {
      const box = await activeResultCard.boundingBox();
      assert.ok(box, `${width}px: active result card needs a bounding box`);
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.35);
      await page.waitForTimeout(50);
      assert.notEqual(await activeResultCard.evaluate((card) => getComputedStyle(card).transform), "none", `${width}px: desktop tilt must remain available during pointer interaction`);
      await page.mouse.move(0, 0);
      await page.waitForFunction(() => {
        const activeCard = document.querySelector<HTMLElement>('[data-selector-primary-card="true"]');
        return activeCard ? getComputedStyle(activeCard).transform === "none" : false;
      });
      assert.equal(await activeResultCard.evaluate((card) => getComputedStyle(card).transform), "none", `${width}px: desktop tilt must return to a crisp untransformed state`);
    }

    await page.locator('[data-selector-summary][data-sticky="false"] [data-selector-edit]').click();
    await page.locator('[data-selector-step="1"] > button').click();
    await page.locator('[data-selector-option="category:resin"]').click();
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0, `${width}px: changing type must hide results until aroma is confirmed again`);
    assert.equal(await page.locator('[data-selector-step="3"] > button').getAttribute("aria-expanded"), "true", `${width}px: compatible intensity may remain but aroma must be confirmed again`);
    assert.equal(await page.locator('[data-selector-option="aroma:any"]').getAttribute("aria-pressed"), "false", `${width}px: changing type must clear the previous aroma choice`);
    await page.locator('[data-selector-option="aroma:any"]').click();
    await page.locator('[data-product-selector-results][data-result-category="resin"][data-result-intensity="forte"]').waitFor();
    assert.deepEqual(
      await page.locator("[data-selector-result-card]").allTextContents(),
      ["Le mousseux", "Kief", "Libanais"],
      `${width}px: strong resin selector names must use the V6.1 references`,
    );
    await page.locator('[data-selector-summary][data-sticky="false"] [data-selector-edit]').click();
    await page.locator('[data-selector-step="2"] > button').click();
    const unavailableSoft = page.locator('[data-selector-option="intensity:douce"]');
    assert.equal(await unavailableSoft.isDisabled(), true, `${width}px: resin soft must be visibly disabled`);
    assert.match(await unavailableSoft.innerText(), /Doux\s+Aucun produit actuellement/i, `${width}px: disabled option needs an explanation`);

    await page.locator("[data-selector-reset]").click();
    assert.equal(await page.locator("[data-product-selector-results]").count(), 0, `${width}px: reset must hide results`);
    assert.equal(await selector.getAttribute("data-selector-collapsed"), "false", `${width}px: reset must expand selector`);
    assert.equal(await page.locator('[data-selector-step="1"] > button').getAttribute("aria-expanded"), "true", `${width}px: reset must reopen type`);
    assert.equal(await page.locator('[data-selector-option="aroma:any"]').getAttribute("aria-pressed"), "false", `${width}px: reset must clear Peu importe`);
    assert.match(await page.locator('[data-selector-step="3"] > button').innerText(), /À choisir/i, `${width}px: reset must restore aroma to À choisir`);

    const library = page.locator("#all-product-sheets");
    await library.scrollIntoViewIfNeeded();
    assert.equal(await page.locator('[data-product-sheet-tab="flower"]').getAttribute("aria-selected"), "true", `${width}px: flowers must be the default tab`);
    assert.equal(await page.locator('[data-product-sheet-card]').count(), 6, `${width}px: flower tab must contain six sheets`);
    assert.equal(await page.locator('[data-product-sheet-card]').first().getAttribute("data-product-sheet-card"), "biscotti", `${width}px: first flower must be immediately visible`);
    await page.locator('[data-product-sheet-tab="resin"]').click();
    await page.locator('[data-product-sheet-category="resin"]').waitFor();
    assert.equal(await page.locator('[data-product-sheet-card]').count(), 4, `${width}px: resin tab must contain four sheets`);
    assert.equal(await page.locator('[data-product-sheet-card]').first().getAttribute("data-product-sheet-card"), "le-mousseux", `${width}px: resins must be one tap away`);
    assert.deepEqual(
      await page.locator('[data-product-sheet-card] h3').allTextContents(),
      ["Le mousseux", "Kief", "Libanais", "Black Butter"],
      `${width}px: resin library names must use the V6.1 references`,
    );
    assert.equal(await page.locator("[data-product-sheet-position]").innerText(), "1 / 4", `${width}px: category change must reset position`);

    await page.locator('[data-product-sheet-tab="flower"]').click();
    await page.locator('[data-product-sheet-category="flower"]').waitFor();
    await page.waitForTimeout(300);
    const carousel = page.locator("[data-product-sheet-carousel]");
    await carousel.focus();
    await carousel.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector("[data-product-sheet-position]")?.textContent?.trim().startsWith("2"));
    await page.waitForFunction(() => {
      const carouselElement = document.querySelector<HTMLElement>("[data-product-sheet-carousel]");
      const activeCard = document.querySelector<HTMLElement>('[data-product-sheet-card][data-active="true"]');
      if (!carouselElement || !activeCard) return false;
      const carouselRect = carouselElement.getBoundingClientRect();
      const cardRect = activeCard.getBoundingClientRect();
      return Math.abs(carouselRect.left + carouselRect.width / 2 - (cardRect.left + cardRect.width / 2)) < 6;
    });
    await page.waitForFunction(() => {
      const activeCard = document.querySelector<HTMLElement>('[data-product-sheet-card][data-active="true"]');
      return activeCard ? getComputedStyle(activeCard).transform === "none" : false;
    });
    assert.equal(await page.locator("[data-product-sheet-position]").innerText(), "2 / 6", `${width}px: keyboard navigation must advance the carousel`);

    const layout = await page.evaluate(() => {
      const carouselElement = document.querySelector<HTMLElement>("[data-product-sheet-carousel]");
      const tabs = [...document.querySelectorAll<HTMLElement>("[data-product-sheet-tabs] button")];
      const visibleSelectorButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-product-selector] button")].filter(isVisible);
      const help = document.querySelector<HTMLElement>('[data-testid="floating-contact-trigger"]');
      const activeCta = document.querySelector<HTMLElement>('[data-product-sheet-card][data-active="true"] a');
      const activeCard = document.querySelector<HTMLElement>('[data-product-sheet-card][data-active="true"]');
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        carouselOverflow: carouselElement ? carouselElement.scrollWidth - carouselElement.clientWidth : 0,
        carouselDisplay: carouselElement ? getComputedStyle(carouselElement).display : "",
        shortestSelectorButton: Math.min(...visibleSelectorButtons.map((button) => button.getBoundingClientRect().height)),
        shortestTab: Math.min(...tabs.map((tab) => tab.getBoundingClientRect().height)),
        helpOverlapsActiveCta: help && activeCta ? intersects(help.getBoundingClientRect(), activeCta.getBoundingClientRect()) : false,
        helpOverlapsActiveCard: help && activeCard ? intersects(help.getBoundingClientRect(), activeCard.getBoundingClientRect()) : false,
        activeCardTransform: activeCard ? getComputedStyle(activeCard).transform : "missing",
      };

      function isVisible(element: HTMLElement) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && !element.closest('[aria-hidden="true"]');
      }
      function intersects(first: DOMRect, second: DOMRect) {
        return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
      }
    });
    assert.ok(layout.pageOverflow <= 1, `${width}px: horizontal page overflow detected (${layout.pageOverflow}px)`);
    assert.ok(layout.shortestSelectorButton >= 43.5, `${width}px: selector touch targets must be about 44px`);
    assert.ok(layout.shortestTab >= 43.5, `${width}px: tabs must be about 44px`);
    assert.equal(layout.helpOverlapsActiveCta, false, `${width}px: floating help must not cover the active card CTA`);
    assert.equal(layout.helpOverlapsActiveCard, false, `${width}px: floating help must not cover the active carousel card`);
    assert.equal(layout.activeCardTransform, "none", `${width}px: active library card must be untransformed at rest`);
    if (width < 1024) {
      assert.ok(layout.carouselOverflow > 0, `${width}px: the mobile/tablet library must scroll horizontally`);
      assert.equal(layout.carouselDisplay, "flex", `${width}px: the mobile/tablet library must use a horizontal flex carousel`);
    } else {
      assert.equal(layout.carouselDisplay, "grid", `${width}px: desktop must use a three-column composition`);
    }

    assert.equal(await page.locator("h1").count(), 1, `${width}px: exactly one H1 is required`);
    assert.equal(await selector.getByText(/Ambiance|Cocooning|Détente profonde|Dynamique|Équilibré/i).count(), 0, `${width}px: legacy ambience UI must remain absent`);
    const retiredNames = new RegExp([["Pollen", "Mousseux"], ["Black", "Libanais"]].map((words) => words.join(" ")).join("|"), "i");
    assert.doesNotMatch(await page.locator("body").innerText(), retiredNames, `${width}px: retired product names must not remain visible`);
    assert.deepEqual(pdfRequests, [], `${width}px: PDFs must not preload`);
    assert.deepEqual(pageErrors, [], `${width}px: browser errors detected`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log("Product sheets UI V2 tests passed: compact selector, sticky summary, tabs, carousel, accessibility and 8 responsive widths.");
