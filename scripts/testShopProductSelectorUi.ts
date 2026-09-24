import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

async function waitForProductCardCount(page: Page, expected: number) {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".product-card-v2").length === count,
    expected,
  );
  assert.equal(await page.locator(".product-card-v2").count(), expected);
}

try {
  for (const width of [390, 1280]) {
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
        JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-23T00:00:00.000Z" }),
      );
    });
    await blockExternalServices(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const normalResponse = await gotoDomReady(page, `${server.baseUrl}/boutique`);
    assert.equal(normalResponse?.status(), 200, `${width}px: shop route must return HTTP 200`);
    await assertShopMode(page, "full");
    assert.equal(await page.locator("h1").innerText(), "Trouvez votre sélection");
    assert.equal(await page.locator('.selector-step [aria-expanded="true"]').count(), 1);
    await waitForProductCardCount(page, 7);

    await gotoDomReady(page, `${server.baseUrl}/boutique?type=flowers`);
    await assertShopMode(page, "full");
    await waitForProductCardCount(page, 5);
    assert.equal(
      await page.locator('[data-selector-option="shop-category:flowers"]').getAttribute("aria-pressed"),
      "true",
    );

    await gotoDomReady(page, `${server.baseUrl}/boutique?type=flowers&intensity=moyen`);
    await assertCompactSelection(page, "Fleurs · Moyen · Peu importe", 3);

    await gotoDomReady(page, `${server.baseUrl}/boutique?type=resins&intensity=fort`);
    await assertCompactSelection(page, "Résines · Fort · Peu importe", 1);

    await gotoDomReady(
      page,
      `${server.baseUrl}/boutique?type=flowers&intensity=moyen&aroma=fruite`,
    );
    await assertCompactSelection(page, "Fleurs · Moyen · Fruité", 1);

    const editButton = page.locator("[data-shop-selector-edit]");
    assert.equal(await editButton.getAttribute("aria-expanded"), "false");
    await editButton.click();
    await assertShopMode(page, "full");
    assert.equal(await page.locator('[data-selector-step="1"] > button').getAttribute("aria-expanded"), "true");
    assert.equal(
      await page.locator('[data-selector-option="shop-category:flowers"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page.locator('[data-selector-option="shop-intensity:moyen"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page.locator('[data-selector-option="shop-aroma:fruite"]').getAttribute("aria-pressed"),
      "true",
    );

    await page.locator('[data-selector-option="shop-category:resins"]').click();
    await waitForProductCardCount(page, 0);
    assert.equal(
      new URL(page.url()).search,
      "?type=resins&intensity=moyen&aroma=fruite",
      `${width}px: edits must keep the URL synchronized`,
    );
    assert.equal(await page.locator("[data-shop-result-count]").innerText(), "0 produits correspondent");

    await page.locator('[data-selector-option="shop-intensity:fort"]').click();
    await page.locator('[data-selector-option="shop-aroma:fruite"]').click();
    await waitForProductCardCount(page, 1);
    assert.equal(new URL(page.url()).search, "?type=resins&intensity=fort");

    await page.locator("[data-shop-selector-reset]").click();
    await page.waitForURL(`${server.baseUrl}/boutique`);
    await assertShopMode(page, "full");
    await waitForProductCardCount(page, 7);
    assert.equal(new URL(page.url()).hash, "", `${width}px: reset must remove the anchor`);

    await gotoDomReady(page, `${server.baseUrl}/boutique`);
    await gotoDomReady(page, `${server.baseUrl}/boutique?type=resins&intensity=fort`);
    await assertShopMode(page, "compact");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await assertShopMode(page, "full");
    await waitForProductCardCount(page, 7);
    await page.goForward({ waitUntil: "domcontentloaded" });
    await assertCompactSelection(page, "Résines · Fort · Peu importe", 1);

    await gotoDomReady(page, `${server.baseUrl}/boutique?type=resins&intensity=moyen`);
    await assertCompactSelection(page, "Résines · Moyen · Peu importe", 0);
    assert.equal(
      await page.getByRole("heading", { name: "Aucun produit ne correspond" }).isVisible(),
      true,
    );
    assert.equal(await page.locator("[data-shop-selector-edit]").isVisible(), true);
    assert.equal(await page.locator("[data-shop-selector-reset]").isVisible(), true);

    await page.locator("[data-shop-selector-reset]").click();
    await page.waitForURL(`${server.baseUrl}/boutique`);
    await assertShopMode(page, "full");
    await waitForProductCardCount(page, 7);

    await gotoDomReady(page, `${server.baseUrl}/boutique?type=resins&intensity=fort#produits`);
    await assertCompactSelection(page, "Résines · Fort · Peu importe", 1);

    const layout = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(".product-card-v2");
      const image = document.querySelector<HTMLElement>(".product-card-v2__image");
      const summary = document.querySelector<HTMLElement>("[data-shop-product-selector]");
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cardFilter: card ? getComputedStyle(card).filter : "missing",
        imageFilter: image ? getComputedStyle(image).filter : "missing",
        summaryHeight: summary?.getBoundingClientRect().height ?? Number.POSITIVE_INFINITY,
        cardTop: card?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        viewportHeight: window.innerHeight,
      };
    });
    assert.ok(layout.pageOverflow <= 1, `${width}px: horizontal overflow detected`);
    assert.equal(layout.cardFilter, "none");
    assert.equal(layout.imageFilter, "none");
    assert.ok(layout.summaryHeight < 190, `${width}px: compact summary must stay low`);
    assert.ok(layout.cardTop < layout.viewportHeight, `${width}px: filtered cards must be visible quickly`);
    assert.deepEqual(pageErrors, [], `${width}px: browser errors detected`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  "Shop selector UI tests passed at 390px and 1280px: normal/partial/compact URLs, edit, reset, history, external zero state, anchor, crisp rendering and no overflow.",
);

async function assertShopMode(page: Page, mode: "full" | "compact") {
  await page.waitForFunction(
    (expectedMode) =>
      document
        .querySelector("[data-shop-product-selector]")
        ?.getAttribute("data-shop-selector-mode") === expectedMode,
    mode,
  );
  const selector = page.locator("[data-shop-product-selector]");
  await selector.waitFor();
  assert.equal(await selector.getAttribute("data-shop-selector-mode"), mode);
}

async function assertCompactSelection(page: Page, summary: string, resultCount: number) {
  await assertShopMode(page, "compact");
  assert.equal(await page.locator("[data-shop-selection-summary]").innerText(), summary);
  assert.equal(
    await page.locator("[data-shop-result-count]").innerText(),
    `${resultCount} ${resultCount === 1 ? "produit correspond" : "produits correspondent"}`,
  );
  await waitForProductCardCount(page, resultCount);
}
