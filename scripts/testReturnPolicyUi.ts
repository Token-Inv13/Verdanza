import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startAuditStaticServer } from "./auditStaticServer";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { withdrawalReceiptText } from "../src/lib/withdrawal";

const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    await context.addInitScript(() => {
      window.localStorage.setItem("verdanza-age-confirmed", "true");
      window.localStorage.setItem("verdanza-consent-v1", JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-11-11T12:00:00.000Z" }));
      (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean }).__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
    });
    await blockExternalServices(context);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let mode: "sent" | "failure" | "skipped" | "receipt-failure" = "sent";
    let requests = 0;
    await page.route("**/api/contact", async (route) => {
      requests++;
      const body = route.request().postDataJSON();
      assert.equal(body.withdrawal.confirmed, true);
      assert.equal(body.withdrawal.contract, "Commande TEST-123");
      assert.ok(body.submissionSecurity.formStartedAt > 0);
      const details = { ...body.withdrawal, items: body.withdrawal.items || "totalité de la commande" };
      const submittedAt = "2026-11-11T12:30:00.000Z";
      const receipt = { ...details, id: "fixture-receipt", submittedAt, text: withdrawalReceiptText(details, submittedAt, "fixture-receipt") };
      await route.fulfill({
        status: mode === "failure" ? 502 : 200, contentType: "application/json",
        body: JSON.stringify(mode === "failure" ? { error: "Déclaration non transmise (fixture)." } : mode === "skipped" ? { ok: true, skipped: true } : { accepted: true, receipt, receiptEmailSent: mode !== "receipt-failure" }),
      });
    });
    async function fillAndReview() {
      await gotoDomReady(page, `${server.baseUrl}/retours`);
      await page.getByLabel("Nom et prénom", { exact: true }).fill("Client Exemple");
      await page.getByLabel("E-mail pour l’accusé de réception", { exact: true }).fill("client@example.test");
      await page.getByLabel("Référence de commande ou informations pour l’identifier", { exact: true }).fill("Commande TEST-123");
      const before = requests;
      await page.getByRole("button", { name: "Vérifier ma déclaration", exact: true }).click();
      await page.getByRole("button", { name: "Confirmer la rétractation", exact: true }).waitFor();
      assert.equal(requests, before, "review must not transmit the declaration");
    }
    await fillAndReview();
    await page.getByRole("button", { name: "Modifier ma déclaration", exact: true }).click();
    assert.equal(await page.getByLabel("Nom et prénom", { exact: true }).inputValue(), "Client Exemple");
    await page.getByRole("button", { name: "Vérifier ma déclaration", exact: true }).click();
    await page.getByRole("button", { name: "Confirmer la rétractation", exact: true }).click();
    await page.getByRole("heading", { name: "Votre rétractation a été transmise", exact: true }).waitFor();
    const download = page.getByRole("link", { name: "Télécharger mon accusé de réception", exact: true });
    assert.match(decodeURIComponent((await download.getAttribute("href")) || ""), /2026-11-11T12:30:00.000Z/);
    const downloadEvent = page.waitForEvent("download");
    await download.click();
    const downloaded = await downloadEvent;
    const receiptPath = await downloaded.path();
    assert.ok(receiptPath);
    assert.match(await readFile(receiptPath, "utf8"), /Commande TEST-123/);
    for (const state of ["failure", "skipped", "receipt-failure"] as const) {
      mode = state;
      await fillAndReview();
      await page.getByRole("button", { name: "Confirmer la rétractation", exact: true }).click();
      if (state === "receipt-failure") {
        await page.getByRole("heading", { name: "Votre rétractation a été transmise", exact: true }).waitFor();
        await page.getByText("La copie par e-mail n’a pas pu être envoyée.", { exact: false }).waitFor();
        assert.equal(await download.count(), 1);
      } else {
        await page.getByRole("alert").waitFor();
        assert.equal(await page.getByRole("heading", { name: "Votre rétractation a été transmise", exact: true }).count(), 0);
      }
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `overflow at ${width}px`);
    assert.deepEqual(errors, []);
    await page.goto(`${server.baseUrl}/cgv`);
    await page.locator('main a[href="/retours"]').waitFor();
    await page.locator('footer a[href="/retours#retractation"]').click();
    await page.waitForURL("**/retours#retractation");
    const formTop = await page.locator("#retractation").evaluate((element) => element.getBoundingClientRect().top);
    assert.ok(formTop >= -1 && formTop < 900, "footer must open the declaration directly");
    console.log(`PASS return policy UI ${width}px: review/confirm, correction, receipt, API/email failures, CGV link and no overflow (mock API).`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
