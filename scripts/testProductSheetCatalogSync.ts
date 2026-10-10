import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { availableProductSheets, plannedProductSheets } from "../src/data/productSheets";
import { products } from "../src/data/products";

const auditedPublishedProductIds = [
  "flower-blue-dream-cbd",
  "flower-cookie-kush-indoor",
  "flower-harlequin-greenhouse",
  "flower-mandarine-cbd",
  "flower-mango-haze-cbd",
  "flower-petites-tetes-og-kush",
  "resin-golden-static",
  "resin-supreme-50-cbd",
  "flower-skittlez-plus",
  "resin-black-afghan",
  "resin-ice-o-lator",
  "resin-mousseux-skywalker",
] as const;

assert.deepEqual(
  availableProductSheets.map((sheet) => sheet.productId),
  auditedPublishedProductIds,
  "every audited published shop product must have exactly one public sheet and no inactive product may leak into the library",
);

for (const sheet of availableProductSheets) {
  const product = products.find((candidate) => candidate.id === sheet.productId);
  assert.ok(product, `${sheet.productId}: public sheet points to a missing catalogue product`);
  assert.equal(sheet.slug, product.slug, `${sheet.productId}: wrong public sheet slug`);
  assert.equal(
    normalizeName(sheet.name),
    normalizeName(product.name),
    `${sheet.productId}: wrong public sheet name`,
  );
  const expectedCategory = product.category === "flowers" ? "flower" : "resin";
  assert.equal(sheet.selectionProfile.category, expectedCategory, `${sheet.productId}: wrong category`);
  assert.equal(sheet.pdfUrl, `/fiches-produits/${product.slug}/verdanza-${product.slug}-signature-v1.pdf`, `${sheet.productId}: wrong PDF URL`);
  assert.equal(sheet.previewUrl, `/images/fiches-produits/signature-v1/${product.slug}-signature-v1-640.webp`, `${sheet.productId}: wrong preview URL`);
  assert.ok(existsSync(resolve("public", sheet.pdfUrl.slice(1))), `${sheet.productId}: active PDF is missing`);
  assert.ok(existsSync(resolve("public", sheet.previewUrl.slice(1))), `${sheet.productId}: active preview is missing`);
}

assert.equal(availableProductSheets.length, 12);
assert.equal(plannedProductSheets.length, 0);

console.log("Catalogue/product-sheet consistency passed: 12 shop-linked available sheets, 0 planned.");

function normalizeName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+CBD$/i, "").toLocaleLowerCase("fr");
}
