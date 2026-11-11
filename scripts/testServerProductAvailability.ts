import assert from "node:assert/strict";
import { createProductPageHandler, renderVerifiedProductPage, type PublicProductStock } from "../api/_server/productPage";
import { parseServerProductAvailability, type ServerProductAvailability } from "../src/lib/serverProductAvailability";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http";
import proxy from "../proxy";

const product = { id: "resin-golden-static", slug: "golden-static" };
const schema = { "@type": "Product", url: "https://verdanza.fr/produits/golden-static", name: "Golden Static", sku: "VDZ-RES-RPV29J", brand: { "@type": "Brand", name: "Verdanza" }, offers: { price: 5.5, priceCurrency: "EUR", hasMerchantReturnPolicy: { merchantReturnDays: 14 } } };
const template = `<html><head><script type="application/ld+json">${JSON.stringify(schema)}</script></head><body><span data-product-availability>Disponibilité à confirmer</span><button disabled data-floating-help-suppress="purchase-cart">Disponibilité à confirmer</button></body></html>`;
const snapshot: ServerProductAvailability = { version: 1, productId: product.id, slug: product.slug, availability: "https://schema.org/InStock", verifiedAt: "2026-11-11T12:00:00.000Z" };
assert.equal(parseServerProductAvailability(snapshot, product, 0), snapshot.availability);
for (const elapsed of [-1, 120_001, NaN, Infinity]) assert.equal(parseServerProductAvailability(snapshot, product, elapsed), undefined);
for (const value of [null, {}, { ...snapshot, version: 2 }, { ...snapshot, productId: "different" }, { ...snapshot, slug: "different" }, { ...snapshot, availability: "invented" }, { ...snapshot, verifiedAt: "invalid" }]) {
  assert.equal(parseServerProductAvailability(value, product, 0), undefined);
}
assert.throws(() => renderVerifiedProductPage("<html><head></head></html>", snapshot));
let stock: PublicProductStock | undefined = { slug: product.slug, stock: 8, isActive: true };
let databaseError = false;
let reads = 0;
const handler = createProductPageHandler({
  loadStock: async (id) => { assert.equal(id, product.id); reads++; if (databaseError) throw new Error("fixture outage"); return stock; },
  loadTemplate: async (slug) => { assert.ok(slug === product.slug || slug === null); return slug === null ? "<html>Not found</html>" : template; },
  now: () => new Date(snapshot.verifiedAt),
});
async function request(url = "/api/product-page?slug=golden-static", method = "GET") {
  let html: string | undefined;
  const headers: Record<string, string> = {};
  const response = { statusCode: 200, setHeader(name: string, value: string) { headers[name] = value; }, end(value?: string) { html = value; } };
  await handler({ url, method } as VercelRequestLike, response as unknown as VercelResponseLike);
  return { status: response.statusCode, html, headers };
}
const available = await request();
assert.equal(available.status, 200);
assert.match(available.html!, /<span data-product-availability>Disponible<\/span>/);
assert.match(available.html!, /Chargement des formats/);
assert.match(available.html!, /disabled/);
assert.match(available.headers["Cache-Control"], /no-store/);
assert.equal(available.headers["Vercel-CDN-Cache-Control"], "no-store");
const parsed = JSON.parse(available.html!.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const { availability, ...offers } = parsed.offers;
assert.equal(availability, "https://schema.org/InStock");
assert.deepEqual({ ...parsed, offers }, schema, "only availability may change in Product JSON-LD");
assert.equal((await request("/produits/golden-static")).status, 200, "support preserved request URL during rewrite");
assert.equal((await request(undefined, "HEAD")).html, undefined);
stock = { ...stock, stock: 0 };
const soldOut = await request();
assert.equal(soldOut.status, 200);
assert.match(soldOut.html!, /https:\/\/schema.org\/OutOfStock/);
assert.match(soldOut.html!, /Rupture de stock/);
for (const invalid of [undefined, "8", -1, NaN, Infinity]) {
  stock = { slug: product.slug, isActive: true, stock: invalid };
  const unknown = await request();
  assert.equal(unknown.status, 503);
  assert.equal(unknown.headers["Retry-After"], "60");
  assert.doesNotMatch(unknown.html!, /"availability"/);
}
databaseError = true;
assert.equal((await request()).status, 503);
databaseError = false;
for (const inactive of [undefined, { slug: product.slug, isActive: false, stock: 8 }, { slug: "different", isActive: true, stock: 8 }]) {
  stock = inactive;
  const missing = await request();
  assert.equal(missing.status, 404);
  assert.doesNotMatch(missing.html!, /Product/);
}
const previousReads = reads;
assert.equal((await request(undefined, "POST")).status, 405);
assert.equal((await request("/api/product-page?slug=..%2Fsecret")).status, 404);
assert.equal(reads, previousReads, "invalid routes/methods must not query the database");
const rewrite = proxy(new Request("https://verdanza.fr/produits/golden-static?campaign=test"));
assert.equal(rewrite.headers.get("x-middleware-rewrite"), "https://verdanza.fr/api/product-page?slug=golden-static");
for (const path of ["/", "/retours", "/produits/unknown", "/api/contact"]) {
  assert.equal(proxy(new Request(`https://verdanza.fr${path}`)).headers.get("x-middleware-next"), "1");
}
console.log("PASS live product availability: request-time stock, consistent HTML/JSON-LD, no-store, zero stock, missing/inactive products, source failures, snapshot expiry and scoped routing (fixtures only).");
