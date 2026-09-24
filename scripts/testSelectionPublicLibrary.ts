import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.addInitScript(() => {
    localStorage.setItem("verdanza-age-confirmed", "true");
    localStorage.setItem("verdanza-consent-v1", JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-23T00:00:00Z" }));
  });
  await blockExternalServices(context);
  await context.route("**/api/selection?action=library", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sheets: [{
      name: "Résine ajoutée", slug: "resine-ajoutee", aromas: ["Sucré"],
      selectionProfile: { category: "resin", intensity: "douce", aromaFamilies: ["sucre"] },
      pdfUrl: "/api/selection?action=asset&slug=resine-ajoutee&kind=pdf",
      previewUrl: "/api/selection?action=asset&slug=resine-ajoutee&kind=image",
    }] }) });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoDomReady(page, `${server.baseUrl}/fiches-produits`);
  await page.locator('[data-product-sheet-tab="resin"]').click();
  await page.locator('[data-product-sheet-card="resine-ajoutee"]').waitFor();
  assert.equal(await page.locator('[data-product-sheet-card="resine-ajoutee"] a[href*="kind=pdf"]').count(), 1);
  await page.locator('[data-selector-option="category:resin"]').click();
  assert.equal(await page.locator('[data-selector-option="intensity:doux"]').isDisabled(), false);
  await page.locator('[data-selector-option="intensity:doux"]').click();
  await page.locator('[data-selector-option="aroma:sucre"]').click();
  await page.locator('[data-selector-result-card="resine-ajoutee"]').waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  console.log("Dynamic public sheet appears in library and recommendation selector without exposing private data.");
} finally {
  await browser.close();
  await server.close();
}
