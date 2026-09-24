import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { products } from "../src/data/products";
import { productSeoRoutes } from "./seoRoutes";

const distDir = resolve("dist");
const routes = productSeoRoutes();
const expectedSlugs = routes.map((route) => route.path.split("/").at(-1) || "").sort();
const sitemap = readFileSync(resolve("public/sitemap.xml"), "utf8");

assert.equal(expectedSlugs.length, 7, "exactly seven active product routes must be generated");
assert.deepEqual(expectedSlugs, [
  "cookie-kush-indoor",
  "golden-static",
  "harlequin-greenhouse",
  "mandarine-cbd",
  "mango-haze-cbd",
  "petites-tetes-og-kush",
  "supreme-50-cbd",
]);

for (const slug of expectedSlugs) {
  const htmlPath = join(distDir, "produits", slug, "index.html");
  assert.ok(existsSync(htmlPath), `missing prerendered product route ${slug}`);
  const html = readFileSync(htmlPath, "utf8");
  assert.match(html, /data-product-page-v2/);
  assert.match(html, /https:\/\/schema.org\/OutOfStock/);
  assert.doesNotMatch(html, /https:\/\/schema.org\/InStock/);
  assert.doesNotMatch(html, /data-purchase-option-available="true"/);
  assert.match(sitemap, new RegExp(`<loc>https://verdanza\\.fr/produits/${slug}</loc>`));
}

const mandarineHtml = readFileSync(
  join(distDir, "produits", "mandarine-cbd", "index.html"),
  "utf8",
);
assert.match(mandarineHtml, /<h1[^>]*>Mandarine<\/h1>/);
assert.match(
  mandarineHtml,
  /<link[^>]+rel="canonical"[^>]+href="https:\/\/verdanza\.fr\/produits\/mandarine-cbd"/,
);
assert.match(mandarineHtml, /data-jsonld-id="jsonld-product"/);

const supremeHtml = readFileSync(
  join(distDir, "produits", "supreme-50-cbd", "index.html"),
  "utf8",
);
assert.match(supremeHtml, /Rupture de stock/);
assert.doesNotMatch(supremeHtml, />Disponible</);
assert.doesNotMatch(supremeHtml, /data-purchase-option-available="true"/);

const shopHtml = readFileSync(join(distDir, "boutique", "index.html"), "utf8");
const flowersHtml = readFileSync(join(distDir, "fleurs-cbd", "index.html"), "utf8");
assert.match(shopHtml, /href="\/produits\/mandarine-cbd"/);
assert.match(flowersHtml, /href="\/produits\/mandarine-cbd"/);

for (const inactive of products.filter((product) => !product.isActive)) {
  assert.ok(
    !existsSync(join(distDir, "produits", inactive.slug, "index.html")),
    `${inactive.slug} must not have a commercial prerender route`,
  );
  assert.ok(
    !sitemap.includes(`/produits/${inactive.slug}</loc>`),
    `${inactive.slug} must not appear in the sitemap`,
  );
}

console.log(
  "Product catalogue prerender tests passed: 7 routes, Mandarine canonical/JSON-LD/links/sitemap, fail-closed availability, Suprême non-orderable and inactive products absent.",
);
