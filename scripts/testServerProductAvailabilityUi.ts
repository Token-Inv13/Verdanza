import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { chromium } from "playwright";
import { createProductPageHandler, renderVerifiedProductPage } from "../api/_server/productPage";
import { publicProductRoutes } from "../src/lib/publicProductRoutes";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http";
import { blockExternalServices } from "./auditPageReady";
import { installPublicAuditCatalog } from "./publicAuditCatalog";
import type { PublicAuditCatalogMode } from "./fixtures/publicAuditCatalog";

const root = resolve("dist");
for (const product of publicProductRoutes) {
  const html = await readFile(resolve(root, `produits/${product.slug}/index.html`), "utf8");
  const pattern = /<script[^>]*data-jsonld-id="jsonld-product"[^>]*>([\s\S]*?)<\/script>/;
  const original = JSON.parse(html.match(pattern)![1]);
  for (const availability of ["https://schema.org/InStock", "https://schema.org/OutOfStock"] as const) {
    const rendered = renderVerifiedProductPage(html, { version: 1, productId: product.id, slug: product.slug, availability, verifiedAt: new Date().toISOString() });
    const schema = JSON.parse(rendered.match(pattern)![1]);
    const { availability: actual, ...offers } = schema.offers;
    assert.equal(actual, availability);
    assert.deepEqual({ ...schema, offers }, original, `${product.slug}: only availability may change`);
  }
}
console.log(`PASS ${publicProductRoutes.length} server templates: available/sold-out availability, unchanged price, brand, SKU, shipping and return policy.`);
let stock = 8;
let unavailable = false;
const handler = createProductPageHandler({
  loadStock: async () => { if (unavailable) throw new Error("fixture outage"); return { slug: "golden-static", stock, isActive: true }; },
  loadTemplate: (slug) => readFile(resolve("dist", slug ? `produits/${slug}/index.html` : "404.html"), "utf8"),
});
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/produits/golden-static") {
      await handler(request as VercelRequestLike, response as VercelResponseLike);
      return;
    }
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    const withinRoot = relative(root, file);
    if (withinRoot.startsWith("..") || isAbsolute(withinRoot)) throw new Error("Invalid static path");
    const body = await readFile(file);
    const types: Record<string, string> = { ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" };
    response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object");
const browser = await chromium.launch({ headless: true });
const cases: Array<{ stock: number; mode: PublicAuditCatalogMode; unavailable?: boolean; expected?: string }> = [
  { stock: 8, mode: "pending", expected: "InStock" },
  { stock: 0, mode: "pending", expected: "OutOfStock" },
  { stock: 8, mode: "error", expected: "InStock" },
  { stock: 0, mode: "authoritative", expected: "InStock" },
  { stock: 8, mode: "pending", unavailable: true },
];
try {
  for (const test of cases) {
    stock = test.stock;
    unavailable = test.unavailable === true;
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem("verdanza-age-confirmed", "true");
      localStorage.setItem("verdanza-consent-v1", JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-11-11T12:00:00.000Z" }));
    });
    await blockExternalServices(context);
    await installPublicAuditCatalog(context, test.mode);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(`http://127.0.0.1:${address.port}/produits/golden-static`, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), test.unavailable ? 503 : 200);
    const raw = await response!.text();
    const initial = JSON.parse(raw.match(/<script[^>]*data-jsonld-id="jsonld-product"[^>]*>([\s\S]*?)<\/script>/)![1]);
    assert.equal(initial.offers.availability, test.unavailable ? undefined : `https://schema.org/${test.stock > 0 ? "InStock" : "OutOfStock"}`);
    if (test.mode !== "pending") await page.waitForFunction(() => Boolean(window.__VERDANZA_AUDIT_CATALOG_RESULT__));
    await page.waitForTimeout(200);
    await page.waitForFunction((expected) => {
      const node = document.querySelector('[data-jsonld-id="jsonld-product"]');
      return node && JSON.parse(node.textContent || "{}").offers?.availability === expected;
    }, test.expected ? `https://schema.org/${test.expected}` : undefined);
    const label = await page.locator("[data-product-availability]").innerText();
    assert.equal(label, test.expected === "InStock" ? "Disponible" : test.expected === "OutOfStock" ? "Rupture de stock" : "Disponibilité à confirmer");
    const add = page.locator('[data-floating-help-suppress="purchase-cart"]');
    assert.equal(await add.isEnabled(), test.mode === "authoritative", "server availability alone must never enable purchase");
    if (test.mode === "error") assert.equal(await add.innerText(), "Commande momentanément indisponible");
    assert.deepEqual(errors, []);
    console.log(`PASS live HTML/client availability: stock=${test.stock}, client=${test.mode}, outage=${test.unavailable || false}; cart guard preserved.`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
}
