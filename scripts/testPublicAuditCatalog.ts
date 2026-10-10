import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { blockExternalServices } from "./auditPageReady.js";
import { startAuditStaticServer } from "./auditStaticServer.js";
import { installPublicAuditCatalog } from "./publicAuditCatalog.js";
import { productSeoRoutes, canonicalUrl } from "./seoRoutes.js";
import type { PublicAuditCatalogMode } from "./fixtures/publicAuditCatalog.js";

const baseline = process.argv.includes("--blocked-baseline");
const rootArg = process.argv.find((arg) => arg.startsWith("--source-root="));
const sourceRoot = rootArg ? resolve(rootArg.slice("--source-root=".length)) : process.cwd();
const server = await startAuditStaticServer({ root: resolve(sourceRoot, "dist") });
const browser = await chromium.launch();
const rows: unknown[] = [];
const modes: PublicAuditCatalogMode[] = baseline ? ["blocked"] : ["authoritative", "empty", "error", "pending", "blocked"];

async function metadata(page: Page) {
  return page.evaluate(() => ({
    title: document.title,
    description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || "",
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || "",
    robots: document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content || "",
    productData: [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((node) => node.textContent || "").filter((text) => text.includes('"@type":"Product"')).join("\n"),
    catalog: window.__VERDANZA_AUDIT_CATALOG_RESULT__ && {
      source: window.__VERDANZA_AUDIT_CATALOG_RESULT__.source,
      status: window.__VERDANZA_AUDIT_CATALOG_RESULT__.status,
      commerceAvailable: window.__VERDANZA_AUDIT_CATALOG_RESULT__.commerceAvailable,
      productCount: window.__VERDANZA_AUDIT_CATALOG_RESULT__.products.length,
    },
    sdkQueries: window.__VERDANZA_AUDIT_SDK_QUERIES__ || [],
    enabledPurchaseButtons: [...document.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => /Ajouter/.test(button.textContent || "") && !button.disabled).length,
  }));
}

try {
  for (const mode of modes) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    await blockExternalServices(context);
    await installPublicAuditCatalog(context, mode, sourceRoot);
    const page = await context.newPage();
    try {
      for (const route of baseline ? productSeoRoutes().slice(0, 1) : productSeoRoutes()) {
        const response = await page.goto(`${server.baseUrl}${route.path}`, { waitUntil: "domcontentloaded" });
        assert.equal(response?.status(), 200);
        if (mode === "pending") {
          await page.waitForSelector('script[type="application/ld+json"]', { state: "attached" });
        } else {
          await page.waitForFunction(() => Boolean(window.__VERDANZA_AUDIT_CATALOG_RESULT__), undefined, { timeout: 30000 });
        }
        await page.waitForTimeout(200);
        const state = await metadata(page);
        rows.push({ mode, path: route.path, ...state });
        if (baseline) {
          assert.ok(state.sdkQueries.length, "The blocked baseline must observe a native SDK snapshot");
          console.log(JSON.stringify({ mode, path: route.path, ...state }));
          continue;
        }
        if (mode === "empty") {
          assert.equal(state.catalog?.productCount, 0);
          assert.equal(state.catalog?.status, "authoritative");
          assert.equal(state.canonical, "");
          assert.match(state.robots, /noindex/);
          assert.equal(state.productData, "");
          assert.equal(state.enabledPurchaseButtons, 0);
        } else {
          assert.equal(state.canonical, canonicalUrl(route.path), `${mode}: canonical ${route.path}`);
          assert.ok(state.title && state.description, `${mode}: complete metadata ${route.path}`);
          assert.doesNotMatch(state.robots, /noindex/);
          assert.match(state.productData, /"@type":"Product"/);
          const orderable = mode === "authoritative" && !route.path.includes("supreme");
          assert.equal(state.enabledPurchaseButtons > 0, orderable, `${mode}: availability ${route.path}`);
          assert.match(state.productData, orderable ? /schema.org\/InStock/ : /schema.org\/OutOfStock/);
          if (mode !== "pending") {
            assert.equal(state.catalog?.productCount, 11);
            assert.equal(state.catalog?.status, mode === "authoritative" ? "authoritative" : "degraded");
            assert.equal(state.catalog?.commerceAvailable, mode === "authoritative");
          }
          if (mode === "blocked") assert.ok(state.sdkQueries.some((query) => query.fromCache));
        }
        console.log(`PASS ${mode} ${route.path} : metadata, JSON-LD, commerce`);
      }
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await server.close();
  if (process.env.PUBLIC_AUDIT_REPORT) await writeFile(process.env.PUBLIC_AUDIT_REPORT, JSON.stringify({ sourceRoot, rows }, null, 2));
}
console.log(`Public catalogue runtime: ${rows.length} single-viewport cases, external requests blocked.`);
