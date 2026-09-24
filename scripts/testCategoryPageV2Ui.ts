import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const widths = [390, 430, 768, 1280] as const;
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

async function waitForProductCardCount(page: Page, expected: number) {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".product-card-v2").length === count,
    expected,
  );
  assert.equal(await page.locator(".product-card-v2").count(), expected);
}

async function waitForSearch(page: Page, search: string) {
  await page.waitForFunction(
    (expected) => window.location.search === expected,
    search,
  );
}

try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      serviceWorkers: "block",
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    await context.addInitScript(() => {
      (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean })
        .__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
      window.localStorage.setItem("verdanza-age-confirmed", "true");
      window.localStorage.setItem(
        "verdanza-consent-v1",
        JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-24T00:00:00.000Z" }),
      );
    });
    await blockExternalServices(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const flowerResponse = await gotoDomReady(page, `${server.baseUrl}/fleurs-cbd`);
    assert.equal(flowerResponse?.status(), 200, `${width}px: flowers route must return HTTP 200`);
    const rawFlowerHtml = (await flowerResponse?.text()) ?? "";
    await page.locator('[data-category-page][data-category="flowers"]').waitFor();
    await waitForProductCardCount(page, 5);
    assert.equal(await page.locator("h1").count(), 1, `${width}px: flowers must keep one H1`);
    assert.equal(await page.locator("h1").innerText(), "Une sélection de fleurs CBD Verdanza");
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://verdanza.fr/fleurs-cbd",
    );
    assert.deepEqual(
      await page.locator("[data-category-intensity]").evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-category-intensity")),
      ),
      ["all", "doux", "moyen", "fort"],
      `${width}px: flowers must expose only available intensities`,
    );
    assert.equal(await page.locator("[data-category-aroma-toggle]").count(), 1);
    assert.equal(await page.locator("[data-category-result-count]").innerText(), "5 produits");
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="floating-contact-trigger"]'),
    );

    const layout = await page.evaluate(() => {
      const buttons = document.querySelectorAll<HTMLElement>(
        "[data-category-intensity], [data-category-aroma-toggle]",
      );
      const cards = [...document.querySelectorAll<HTMLElement>(".product-card-v2")];
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        shortestFilterTarget: Math.min(
          ...[...buttons].map((button) => button.getBoundingClientRect().height),
        ),
        cardColumns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size,
        firstCardFilter: cards[0] ? getComputedStyle(cards[0]).filter : "missing",
        firstImageFilter: cards[0]
          ? getComputedStyle(cards[0].querySelector<HTMLElement>(".product-card-v2__image")!).filter
          : "missing",
      };
    });
    assert.ok(layout.overflow <= 1, `${width}px: flowers must not overflow horizontally`);
    assert.ok(layout.shortestFilterTarget >= 44, `${width}px: filter targets must be touch friendly`);
    assert.equal(layout.firstCardFilter, "none", `${width}px: ProductCard text must stay crisp`);
    assert.equal(layout.firstImageFilter, "none", `${width}px: ProductCard image must stay crisp`);
    assert.equal(layout.cardColumns, width < 640 ? 1 : width < 1024 ? 2 : 3);

    const mediumButton = page.locator('[data-category-intensity="moyen"]');
    await mediumButton.focus();
    await page.keyboard.press("Enter");
    await waitForSearch(page, "?intensity=moyen");
    await waitForProductCardCount(page, 3);
    assert.equal(await mediumButton.getAttribute("aria-pressed"), "true");

    const aromaToggle = page.locator("[data-category-aroma-toggle]");
    await aromaToggle.focus();
    await page.keyboard.press(" ");
    assert.equal(await aromaToggle.getAttribute("aria-expanded"), "true");
    assert.deepEqual(
      await page.locator("[data-category-aroma]").evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-category-aroma")),
      ),
      ["fruite", "agrumes", "sucre", "boise"],
    );
    await page.locator('[data-category-aroma="fruite"]').click();
    await waitForSearch(page, "?intensity=moyen&aroma=fruite");
    await waitForProductCardCount(page, 1);
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://verdanza.fr/fleurs-cbd",
      `${width}px: filtered URLs must keep the base canonical`,
    );

    await page.goBack({ waitUntil: "domcontentloaded" });
    await waitForSearch(page, "?intensity=moyen");
    await waitForProductCardCount(page, 3);
    await page.goForward({ waitUntil: "domcontentloaded" });
    await waitForSearch(page, "?intensity=moyen&aroma=fruite");
    await waitForProductCardCount(page, 1);

    await page.locator("[data-category-filter-reset]").click();
    await waitForSearch(page, "");
    await waitForProductCardCount(page, 5);
    assert.equal(await page.locator("[data-category-filter-reset]").count(), 0);

    await gotoDomReady(page, `${server.baseUrl}/fleurs-cbd?intensity=fort&aroma=fruite`);
    await waitForProductCardCount(page, 0);
    assert.equal(
      await page.locator("[data-category-empty-state] h2").innerText(),
      "Aucun produit ne correspond à ces critères.",
    );
    await page.locator("[data-category-empty-reset]").click();
    await waitForSearch(page, "");
    await waitForProductCardCount(page, 5);

    const resinResponse = await gotoDomReady(page, `${server.baseUrl}/resines-cbd`);
    assert.equal(resinResponse?.status(), 200, `${width}px: resins route must return HTTP 200`);
    const rawResinHtml = (await resinResponse?.text()) ?? "";
    await page.locator('[data-category-page][data-category="resins"]').waitFor();
    await waitForProductCardCount(page, 2);
    assert.deepEqual(
      await page.locator("[data-category-intensity]").evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-category-intensity")),
      ),
      ["all", "doux", "fort"],
      `${width}px: resins must expose only available intensities`,
    );
    assert.equal(await page.locator("[data-category-aroma-toggle]").count(), 0);
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://verdanza.fr/resines-cbd",
    );

    const resinLayout = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>(".product-card-v2")];
      const grid = cards[0]?.parentElement?.getBoundingClientRect();
      const first = cards[0]?.getBoundingClientRect();
      const last = cards[1]?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        columns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size,
        cardsCenter: first && last ? (first.left + last.right) / 2 : Number.NaN,
        gridCenter: grid ? grid.left + grid.width / 2 : Number.NaN,
      };
    });
    assert.ok(resinLayout.overflow <= 1, `${width}px: resins must not overflow horizontally`);
    assert.equal(resinLayout.columns, width < 640 ? 1 : 2);
    if (width === 1280) {
      assert.ok(
        Math.abs(resinLayout.cardsCenter - resinLayout.gridCenter) <= 2,
        "1280px: the two resin cards must stay centered",
      );
    }

    await page.locator("[data-category-page] aside").scrollIntoViewIfNeeded();
    const restoredHelp = page.locator('[data-testid="floating-contact-trigger"]');
    await restoredHelp.waitFor();
    assert.equal(await restoredHelp.getAttribute("aria-label"), "Besoin d'aide ?");
    await page.locator("[data-category-product-filter]").scrollIntoViewIfNeeded();
    await restoredHelp.waitFor({ state: "detached" });

    if (width === 390) {
      await gotoDomReady(page, `${server.baseUrl}/fleurs-cbd`);
      const flowerAromaToggle = page.locator("[data-category-aroma-toggle]");
      await flowerAromaToggle.click();
      assert.equal(
        await page.locator("[data-category-aroma-options]").evaluate((element) =>
          getComputedStyle(element).animationName,
        ),
        "none",
        "reduced motion must disable the aroma reveal animation",
      );
    }

    assert.match(rawFlowerHtml, /data-category-page/);
    assert.match(rawFlowerHtml, /Une sélection de fleurs CBD Verdanza/);
    assert.match(rawResinHtml, /data-category-page/);
    assert.match(rawResinHtml, /Des textures et profils sélectionnés avec soin/);
    assert.deepEqual(pageErrors, [], `${width}px: category pages must not raise browser errors`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  "Category Page V2 UI tests passed at 390px, 430px, 768px and 1280px: SEO, dynamic filters, keyboard, URLs/history, 5/2 grids, empty/reset states, contextual help, reduced motion and no overflow.",
);
