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
    }, {
      name: "Le mousseux", slug: "le-mousseux", aromas: ["Terreux"],
      selectionProfile: { category: "resin", intensity: "fort", aromaFamilies: ["terreux"] },
      pdfUrl: "/fiches-produits/le-mousseux/verdanza-le-mousseux.pdf",
      previewUrl: "/images/fiches-produits/le-mousseux.webp",
    }] }) });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoDomReady(page, `${server.baseUrl}/fiches-produits`);
  await page.locator('[data-product-sheet-tab="resin"]').click();
  await page.locator('[data-product-sheet-card="golden-static"]').waitFor();
  assert.equal(await page.locator('[data-product-sheet-card="le-mousseux"]').count(), 0);
  assert.equal(await page.locator('[data-product-sheet-card="resine-ajoutee"]').count(), 0);
  await page.locator('[data-selector-option="category:resin"]').click();
  assert.equal(await page.locator('[data-selector-option="intensity:doux"]').isDisabled(), false);
  await page.locator('[data-selector-option="intensity:doux"]').click();
  await page.locator('[data-selector-option="aroma:any"]').click();
  assert.deepEqual(
    await page.locator('[data-selector-result-card]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-selector-result-card'))),
    ["golden-static", "supreme-50-cbd"],
  );
  assert.deepEqual(errors, []);
  await context.close();
  console.log("The public sheet library remains pinned to the audited shop catalogue and ignores unrelated dynamic publication entries.");
} finally {
  await browser.close();
  await server.close();
}
