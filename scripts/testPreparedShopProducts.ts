import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { products } from "../src/data/products";
import { productImageVariants } from "../src/lib/generatedImageVariants";
import { getCartLineStockIssue } from "../src/lib/cartStock";
import { resolveProductDiscoveryProfile } from "../src/lib/productDiscovery";
import { resolveProductCardPresentation } from "../src/lib/productPresentation";
import { resolveProductPurchaseOptions } from "../src/lib/productPurchaseOptions";
import { buildProductJsonLd } from "../src/lib/structuredData";
import { getLocalProducts } from "../src/services/productsService";
import { productSeoRoutes } from "./seoRoutes";

const expected = [
  { id: "flower-skittlez-plus", slug: "skittlez-plus", name: "Skittlez Plus", category: "flowers", price: 7.5, stock: 7,
    intensity: "fort", aromas: ["Citron", "Bonbon", "Diesel"], families: ["agrumes", "sucre", "fruite"], width: 1024 },
  { id: "resin-black-afghan", slug: "black-afghan", name: "Black Afghan", category: "resins", price: 6.5, stock: 11,
    intensity: "moyen", aromas: ["Terreux", "Sucré", "Fruits rouges"], families: ["terreux", "sucre", "fruite"], width: 600 },
  { id: "resin-ice-o-lator", slug: "ice-o-lator", name: "Ice-o-Lator", category: "resins", price: 6, stock: 7,
    intensity: "moyen", aromas: ["Floral", "Fruits mûrs", "Épicé"], families: ["fruite", "epice", "sucre"], width: 600 },
  { id: "resin-mousseux-skywalker", slug: "mousseux-skywalker", name: "Mousseux Skywalker", category: "resins", price: 7.5, stock: 7,
    intensity: "fort", aromas: ["Pin", "Boisé", "Agrumes"], families: ["boise", "agrumes", "epice"], width: 1024 },
] as const;

const publicFile = (url: string) => resolve("public", url.replace(/^\//, ""));
const routes = productSeoRoutes();
assert.equal(getLocalProducts().length, 11, "the four new products must join the seven active static products");

for (const item of expected) {
  const product = products.find((candidate) => candidate.id === item.id);
  assert.ok(product, `${item.id}: missing prepared product`);
  assert.equal(product.slug, item.slug);
  assert.equal(product.name, item.name);
  assert.equal(product.category, item.category);
  assert.equal(product.price, item.price);
  assert.equal(product.stock, item.stock);
  assert.equal(product.lowStockThreshold, 10, "use the existing low-stock convention");
  assert.equal(product.fixedPriceMode, "disabled");
  assert.deepEqual(product.fixedPriceOptions, []);
  assert.equal(product.isActive, true);
  assert.equal(product.isFeatured, false);
  assert.equal(product.compareAtPrice, undefined);
  assert.equal(product.productTier, undefined);
  assert.equal(product.qualitySealEnabled, undefined);
  assert.equal(product.cbdRate, "Non communiqué");
  assert.equal(product.cbgRate, "Non communiqué");
  assert.equal(product.thcRate, "Non communiqué");
  assert.equal(product.moleculeLabel, "THCX");
  assert.ok(product.tags.includes("thcx"), `${item.slug}: THCX range tag missing`);
  assert.deepEqual(product.aromas, item.aromas);
  assert.deepEqual(resolveProductDiscoveryProfile(product), {
    category: item.category,
    intensity: item.intensity,
    aromaFamilies: item.families,
  });
  const card = resolveProductCardPresentation(product);
  assert.equal(card.intensity, item.intensity);
  assert.deepEqual(card.aromaProfile, item.aromas);
  assert.ok(routes.some((route) => route.path === `/produits/${item.slug}`));
  assert.deepEqual(resolveProductPurchaseOptions(product).map(({ id, quantityGrams, totalPrice, available }) => ({
    id, quantityGrams, totalPrice, available,
  })), [{ id: "gram", quantityGrams: 1, totalPrice: item.price, available: true }]);
  assert.equal(getCartLineStockIssue({ productId: item.id, product, quantity: item.stock }), null);
  assert.ok(getCartLineStockIssue({ productId: item.id, product, quantity: item.stock + 1 }));
  const jsonLd = buildProductJsonLd(product);
  assert.equal(jsonLd["@type"], "Product");
  assert.equal((jsonLd.offers as { price: number }).price, item.price);

  const source = publicFile(product.image);
  assert.ok(existsSync(source), `${item.slug}: missing real source photo`);
  const sourceMeta = await sharp(source).metadata();
  assert.equal(sourceMeta.format, "webp");
  assert.equal(sourceMeta.width, item.width);
  assert.equal(sourceMeta.height, item.width);
  const variants = productImageVariants[product.image];
  assert.ok(variants, `${item.slug}: missing responsive WebP variants`);
  for (const variant of [variants.card, variants.detail]) {
    for (const candidate of variant.srcSet.split(", ")) {
      const [url, widthDescriptor] = candidate.split(" ");
      const imagePath = publicFile(url);
      assert.ok(existsSync(imagePath), `${item.slug}: missing ${url}`);
      const metadata = await sharp(imagePath).metadata();
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.width, Number.parseInt(widthDescriptor, 10));
      assert.ok((metadata.width || 0) <= item.width, `${item.slug}: photo must never be upscaled`);
    }
  }
}

console.log("Shop products PASS: 4 active THCX-range profiles, exact prices/stocks, gram-only, taxonomy, stock limits, SEO routes and no-upscale WebP images.");
