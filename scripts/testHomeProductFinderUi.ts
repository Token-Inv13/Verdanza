import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

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

    const response = await gotoDomReady(page, `${server.baseUrl}/`);
    assert.equal(response?.status(), 200, `${width}px: home route must return HTTP 200`);
    assert.equal(await page.locator("[data-home-product-finder]").isVisible(), true);
    assert.equal(await page.locator('[data-finder-step="type"]').isVisible(), true);
    assert.equal(await page.getByText("Quel produit vous correspond ?", { exact: true }).count(), 1);
    assert.equal(await page.locator("[data-home-finder-progress] [data-progress-marker]").count(), 3);

    const placement = await page.evaluate(() => {
      const hero = document.querySelector<HTMLElement>(".hero-section");
      const finder = document.querySelector<HTMLElement>("[data-home-product-finder]");
      const selectionHeading = [...document.querySelectorAll<HTMLElement>("h2")].find(
        (heading) => heading.textContent?.trim() === "Sélection Verdanza",
      );
      const selection = selectionHeading?.closest<HTMLElement>("section");
      if (!hero || !finder) return null;
      return {
        heroBottom: hero.getBoundingClientRect().bottom,
        finderTop: finder.getBoundingClientRect().top,
        finderBottom: finder.getBoundingClientRect().bottom,
        selectionTop: selection?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
      };
    });
    assert.ok(placement, `${width}px: hero and finder placement must be measurable`);
    assert.ok(placement.finderTop < placement.heroBottom, `${width}px: finder must overlap the hero edge`);
    assert.ok(placement.finderBottom <= placement.selectionTop, `${width}px: finder must precede the featured products`);

    const flowers = page.locator('[data-home-finder-option="type:flowers"]');
    if (width === 390) {
      await flowers.focus();
      await flowers.press("Enter");
    } else {
      await flowers.click();
    }
    assert.equal(await page.locator('[data-finder-step="intensity"]').isVisible(), true);
    assert.equal(await page.locator('[data-home-finder-option^="intensity:"]').count(), 3);
    assert.equal(await page.locator('[data-home-finder-option="intensity:doux"]').count(), 1);
    await page.locator('[data-home-finder-option="intensity:moyen"]').click();
    assert.equal(await page.locator('[data-finder-step="aroma"]').isVisible(), true);
    assert.equal(await page.locator('[data-home-finder-option^="aroma:"]').count(), 4);
    assert.equal(await page.locator('[data-home-finder-option="aroma:agrumes"]').count(), 0);
    assert.equal(await page.getByText("Terreux", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Épicé", { exact: true }).count(), 0);

    await page.locator('[data-home-finder-option="aroma:fruite"]').click();
    await assertResult(page, 1, "Fleurs · Moyen · Fruité");

    await page.locator("[data-home-finder-edit]").click();
    assert.equal(
      await page.locator('[data-home-finder-option="type:flowers"]').getAttribute("aria-pressed"),
      "true",
      `${width}px: modify must preserve the selected type`,
    );
    await page.locator('[data-home-finder-option="type:resins"]').click();
    assert.equal(await page.locator('[data-home-finder-option="intensity:moyen"]').count(), 0);
    assert.equal(
      await page.locator('[data-home-finder-option^="intensity:"][aria-pressed="true"]').count(),
      0,
      `${width}px: changing type must clear an incompatible child intensity`,
    );
    await page.locator('[data-home-finder-option="intensity:fort"]').click();
    assert.equal(
      await page.locator('[data-home-finder-option^="aroma:"]').count(),
      1,
      `${width}px: resin strong must expose only Peu importe`,
    );
    assert.equal(await page.locator('[data-home-finder-option="aroma:agrumes"]').count(), 0);
    await page.locator('[data-home-finder-option="aroma:any"]').click();
    await assertResult(page, 1, "Résines · Fort · Peu importe");

    await page.locator("[data-home-finder-reset]").click();
    assert.equal(await page.locator('[data-finder-step="type"]').isVisible(), true);
    assert.equal(
      await page.locator('[data-home-finder-option="type:flowers"]').getAttribute("aria-pressed"),
      "false",
      `${width}px: reset must clear the previous type`,
    );

    await page.locator('[data-home-finder-option="type:flowers"]').click();
    await page.locator('[data-home-finder-option="intensity:moyen"]').click();
    await page.locator('[data-home-finder-option="aroma:any"]').click();
    await assertResult(page, 3, "Fleurs · Moyen · Peu importe");

    await page.locator("[data-home-finder-reset]").click();
    await page.locator('[data-home-finder-option="type:resins"]').click();
    await page.locator('[data-home-finder-option="intensity:fort"]').click();
    await page.locator('[data-home-finder-option="aroma:any"]').click();
    await assertResult(page, 1, "Résines · Fort · Peu importe");

    const layout = await page.evaluate(() => {
      const finder = document.querySelector<HTMLElement>(".home-product-finder");
      const step = document.querySelector<HTMLElement>(".home-product-finder__step");
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-home-product-finder] button, [data-home-product-finder] a",
        ),
      ];
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        shortestControl: Math.min(...controls.map((control) => control.getBoundingClientRect().height)),
        contentFilter: step ? getComputedStyle(step).filter : "missing",
        stepAnimation: step ? getComputedStyle(step).animationName : "missing",
        atmosphereAnimation: finder ? getComputedStyle(finder, "::before").animationName : "missing",
      };
    });
    assert.ok(layout.pageOverflow <= 1, `${width}px: horizontal overflow detected`);
    assert.ok(layout.shortestControl >= 43.5, `${width}px: finder touch targets must be at least 44px`);
    assert.equal(layout.contentFilter, "none", `${width}px: finder content must stay crisp`);
    if (width === 390) {
      assert.equal(layout.stepAnimation, "none", "reduced motion must disable step animation");
      assert.equal(layout.atmosphereAnimation, "none", "reduced motion must disable atmosphere animation");
    }

    const shopLink = page.locator("[data-home-finder-open-shop]");
    assert.equal(
      await shopLink.getAttribute("href"),
      "/boutique?type=resins&intensity=fort#produits",
      `${width}px: result URL must be shareable and canonical`,
    );
    await Promise.all([
      page.waitForURL("**/boutique?type=resins&intensity=fort#produits"),
      shopLink.click(),
    ]);
    await page.locator("[data-shop-product-selector]").waitFor();
    assert.equal(
      await page.locator("[data-shop-product-selector]").getAttribute("data-shop-selector-mode"),
      "compact",
      `${width}px: homepage arrival must use compact result mode`,
    );
    assert.equal(
      await page.locator("[data-shop-selection-summary]").innerText(),
      "Résines · Fort · Peu importe",
    );
    assert.equal(await page.locator(".product-card-v2").count(), 1);
    assert.equal(await page.locator("[data-shop-result-count]").innerText(), "1 produit correspond");
    assert.equal(new URL(page.url()).hash, "#produits");
    assert.deepEqual(pageErrors, [], `${width}px: browser errors detected`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  "Home product finder UI tests passed at 390px and 1280px: contextual options, guaranteed guided results, keyboard, edit, reset, reduced motion, responsive layout and compact shop handoff.",
);

async function assertResult(page: Page, count: number, summary: string) {
  assert.equal(await page.locator('[data-finder-step="result"]').isVisible(), true);
  assert.equal(
    (await page.locator("[data-home-finder-result-count]").innerText()).toLocaleLowerCase("fr"),
    `${count} ${count === 1 ? "produit correspond" : "produits correspondent"}`,
  );
  assert.equal(await page.getByText(summary, { exact: true }).count(), 1);
}
