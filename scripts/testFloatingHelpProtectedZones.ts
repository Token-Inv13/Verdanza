import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const viewports = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1280, height: 800 },
] as const;
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport,
      serviceWorkers: "block",
      reducedMotion: viewport.width === 1280 ? "no-preference" : "reduce",
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
    const label = `${viewport.width}×${viewport.height}`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    if (viewport.width !== 1280) {
      await gotoDomReady(page, `${server.baseUrl}/boutique`);
      await page.locator('[data-shop-selector-mode="full"]').waitFor();
      await assertControl(page, '[data-selector-option="shop-category:resins"]', `${label} Boutique type`);
      await assertControl(page, '[data-selector-step="2"] > button', `${label} Boutique intensité`);
      await assertControl(page, '[data-selector-step="3"] > button', `${label} Boutique arômes`);
      await assertControl(page, '[data-shop-selector-reset]', `${label} Boutique réinitialiser`);

      await gotoDomReady(
        page,
        `${server.baseUrl}/boutique?type=flowers&intensity=moyen&aroma=fruite#produits`,
      );
      await page.locator('[data-shop-selector-mode="compact"]').waitFor();
      await assertControl(page, '[data-shop-selector-edit]', `${label} Boutique modifier`);
      await assertControl(page, '.product-card-v2 [data-floating-help-suppress] select', `${label} carte format`);
      await assertControl(page, '.product-card-v2 [data-floating-help-suppress] button', `${label} carte achat`);
    }

    await gotoDomReady(page, `${server.baseUrl}/produits/mandarine-cbd`);
    await page.locator('[data-product-purchase]').waitFor();
    assert.equal(await page.locator('[data-product-purchase] [data-purchase-option]').count(), 4);
    await assertControl(page, '[data-product-purchase] [data-purchase-option]:last-child', `${label} Mandarine 11 g`);
    await assertControl(page, '[data-product-purchase] .btn-primary', `${label} Mandarine achat`);

    if (viewport.width !== 1280) {
      // The static editorial fallback is deliberately out of stock, so the real
      // sticky purchase bar cannot render. Exercise its shared marker with a
      // fixed local fixture; the live Preview covers the in-stock component.
      // The footer is protected too. Use an unprotected reading surface to
      // exercise dynamic sticky-bar insertion and restoration independently.
      await gotoDomReady(page, `${server.baseUrl}/livraison`);
      await page.locator('[data-testid="floating-contact-trigger"]').waitFor({ state: "visible" });
      await page.evaluate(() => {
        const bar = document.createElement("div");
        bar.setAttribute("data-floating-help-suppress", "");
        bar.setAttribute("data-test-sticky-purchase", "");
        bar.style.cssText = "position:fixed;inset:auto 0 0;z-index:30;height:76px;background:white";
        const button = document.createElement("button");
        button.textContent = "Ajouter";
        button.style.cssText = "position:absolute;right:16px;top:12px;width:100px;height:44px";
        bar.append(button);
        document.body.append(bar);
      });
      await assertControl(page, '[data-test-sticky-purchase] button', `${label} barre sticky`);
      await page.locator('[data-test-sticky-purchase]').evaluate((element) => element.remove());
      await page.locator('[data-testid="floating-contact-trigger"]').waitFor({ state: "visible" });
    }

    assert.deepEqual(errors, [], `${label}: browser errors`);
    await context.close();
    console.log(`${label}: protected controls have zero help overlap and pass pointer hit-tests.`);
  }
} finally {
  await browser.close();
  await server.close();
}

async function assertControl(page: Page, selector: string, label: string) {
  const control = page.locator(selector).first();
  await control.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior }));
  await page.waitForFunction(
    (targetSelector) => {
      const element = document.querySelector(targetSelector);
      const rect = element?.getBoundingClientRect();
      return !document.querySelector('[data-testid="floating-contact-trigger"]') &&
        Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight);
    },
    selector,
  );
  const metrics = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const help = document.querySelector<HTMLElement>('[data-testid="floating-contact-trigger"]');
    const helpRect = help?.getBoundingClientRect();
    const area = helpRect
      ? Math.max(0, Math.min(rect.right, helpRect.right) - Math.max(rect.left, helpRect.left)) *
        Math.max(0, Math.min(rect.bottom, helpRect.bottom) - Math.max(rect.top, helpRect.top))
      : 0;
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.right - Math.min(12, rect.width / 4), rect.bottom - Math.min(12, rect.height / 4)],
    ];
    return {
      area,
      inViewport: rect.top >= 0 && rect.bottom <= innerHeight,
      pointerHits: points.map(([x, y]) => element.contains(document.elementFromPoint(x, y))),
    };
  });
  assert.equal(metrics.area, 0, `${label}: help/control intersection must be 0 px²`);
  assert.equal(metrics.inViewport, true, `${label}: control must be fully visible`);
  assert.deepEqual(metrics.pointerHits, [true, true], `${label}: control must receive pointer hits`);
}
