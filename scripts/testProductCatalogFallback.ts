import assert from "node:assert/strict";
import { products } from "../src/data/products";
import {
  findOrderableCartProduct,
  getCartCatalogWarnings,
} from "../src/lib/cartCatalog";
import { isProductOrderable, publicProductStockLabel } from "../src/lib/cartStock";
import { resolveProductPurchaseOptions } from "../src/lib/productPurchaseOptions";
import { buildProductJsonLd } from "../src/lib/structuredData";
import {
  asEditorialFallbackProducts,
  getLocalProducts,
  getProductsWithFallback,
} from "../src/services/productsService";
import type { Product } from "../src/types";
import { productSeoRoutes } from "./seoRoutes";

const activeStaticProducts = getLocalProducts();
const supreme = requiredProduct("resin-supreme-50-cbd");
const mandarine = requiredProduct("flower-mandarine-cbd");

assert.equal(activeStaticProducts.length, 7, "the static editorial catalogue must contain 7 products");
assert.equal(activeStaticProducts.filter((product) => product.category === "flowers").length, 5);
assert.equal(activeStaticProducts.filter((product) => product.category === "resins").length, 2);
assert.equal(mandarine.isActive, true, "Mandarine must remain active in static data");
assert.equal(mandarine.slug, "mandarine-cbd", "Mandarine public slug must remain stable");
assert.equal(supreme.stock, 0, "Suprême static stock must be defensive zero");

const authoritativeProducts = [{ ...mandarine, stock: 14 }];
const success = await getProductsWithFallback(async () => authoritativeProducts);
assert.equal(success.source, "firestore");
assert.equal(success.status, "authoritative");
assert.equal(success.commerceAvailable, true);
assert.strictEqual(
  success.products,
  authoritativeProducts,
  "a successful Firestore response must be used exactly as returned",
);

const empty = await getProductsWithFallback(async () => []);
assert.equal(empty.source, "firestore");
assert.equal(empty.status, "authoritative");
assert.equal(empty.commerceAvailable, true);
assert.deepEqual(empty.products, [], "an authoritative empty response must stay empty");

const degraded = await getProductsWithFallback(async () => {
  throw Object.assign(new Error("simulated Firestore outage"), { code: "unavailable" });
});
assert.equal(degraded.source, "local");
assert.equal(degraded.status, "degraded");
assert.equal(degraded.commerceAvailable, false);
assert.equal(degraded.products.length, 7, "degraded mode must retain editorial page structure");
assert.ok(
  degraded.products.every((product) => product.stock === 0 && !isProductOrderable(product)),
  "degraded products must all be non-orderable regardless of static stock",
);

const staleSupreme = { ...supreme, stock: 22 };
const editorialSupreme = asEditorialFallbackProducts([staleSupreme])[0];
assert.equal(editorialSupreme.stock, 0, "stale positive fallback stock must be neutralized");
assert.equal(publicProductStockLabel(editorialSupreme), "Rupture de stock");
assert.ok(
  resolveProductPurchaseOptions(editorialSupreme).every((option) => !option.available),
  "no Suprême fallback format may be commercially available",
);
assert.equal(
  findOrderableCartProduct(
    { products: [staleSupreme], commerceAvailable: false },
    staleSupreme.id,
  ),
  undefined,
  "CartContext guard must reject a stale positive-stock product in degraded mode",
);
assert.ok(
  getCartCatalogWarnings(
    { products: [staleSupreme], commerceAvailable: false },
    [{ productId: staleSupreme.id, quantity: 1, purchaseMode: "gram" }],
  ).length > 0,
  "a persisted cart must be blocked while commercial availability is unverified",
);

const firestoreFormatProduct: Product = {
  ...mandarine,
  stock: 20,
  fixedPriceMode: "manual",
  fixedPriceOptions: [
    {
      id: "fixed-verified-format",
      totalPrice: 40,
      quantityGrams: 7,
      isActive: true,
      source: "manual",
    },
  ],
};
assert.ok(
  getCartCatalogWarnings(
    { products: [firestoreFormatProduct], commerceAvailable: true },
    [
      {
        productId: firestoreFormatProduct.id,
        quantity: 1,
        purchaseMode: "fixed_price",
        fixedPriceOptionId: "obsolete-local-format",
      },
    ],
  ).some((warning) => warning.includes("n'est plus disponible")),
  "a source change must block an obsolete fixed-format id instead of creating a ghost line",
);

const supremeFromFirestore = await getProductsWithFallback(async () => [{ ...supreme, stock: 0 }]);
assert.equal(supremeFromFirestore.products[0]?.stock, 0);
assert.ok(
  resolveProductPurchaseOptions(supremeFromFirestore.products[0]).every(
    (option) => !option.available,
  ),
  "authoritative Suprême stock zero must disable every purchase option",
);

const routes = productSeoRoutes();
assert.equal(routes.length, 7, "SEO/prerender routing must expose the seven active products");
assert.ok(routes.some((route) => route.path === "/produits/mandarine-cbd"));
for (const inactive of products.filter((product) => !product.isActive)) {
  assert.ok(
    !routes.some((route) => route.path === `/produits/${inactive.slug}`),
    `${inactive.slug} must stay outside commercial SEO routes`,
  );
}

const mandarineJsonLd = JSON.stringify(
  buildProductJsonLd(asEditorialFallbackProducts([mandarine])[0]),
);
assert.match(mandarineJsonLd, /"@type":"Product"/);
assert.match(mandarineJsonLd, /\/produits\/mandarine-cbd/);
assert.match(mandarineJsonLd, /https:\/\/schema.org\/OutOfStock/);
assert.doesNotMatch(
  mandarineJsonLd,
  /https:\/\/schema.org\/InStock/,
  "degraded JSON-LD must not claim mutable static availability",
);

console.log(
  "Product catalogue fallback tests passed: 7 static products, exact/empty/error Firestore states, non-commercial fallback, CartContext guard, Suprême zero stock, stale format blocking and Mandarine SEO route.",
);

function requiredProduct(id: string) {
  const product = activeStaticProducts.find((entry) => entry.id === id);
  assert.ok(product, `missing active static product ${id}`);
  return product;
}
