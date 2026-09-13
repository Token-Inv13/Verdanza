import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const artifactRoot = resolve("node_modules/.cache/verdanza-cagnotte-recette-v1");
const pages = [
  { name: "01-commande-b-proposition", html: await readFile(resolve(artifactRoot, "01-commande-b-proposition.html"), "utf8") },
  { name: "02-remboursement-final", html: await readFile(resolve(artifactRoot, "02-remboursement-final.html"), "utf8") },
];
const viewports = [
  { label: "desktop", width: 1440, height: 1100 },
  { label: "mobile", width: 390, height: 844 },
];
const browser = await chromium.launch({ headless: true });
const screenshots: string[] = [];

try {
  for (const source of pages) {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      let networkRequests = 0;
      await context.route("**/*", (route) => {
        networkRequests += 1;
        return route.abort();
      });
      const page = await context.newPage();
      await page.setContent(source.html, { waitUntil: "domcontentloaded" });
      assert.equal(networkRequests, 0, "la capture UI autonome ne doit effectuer aucun appel réseau");
      const screenshot = resolve(artifactRoot, `${source.name}-${viewport.label}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      screenshots.push(screenshot);
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`Captures UI locales sans réseau : ${screenshots.join(", ")}`);
