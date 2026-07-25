import assert from "node:assert/strict";
import {
  ensureSinglePrimary,
  isProductImageStoragePath,
  normalizeProductImages,
  syncProductPrimaryImage,
  validateProductImages,
  validateProductImagesForProduct,
} from "../src/lib/productImages";
import {
  assertProductDeleteConfirmation,
  hasBlockingProductDependencies,
  productStoragePathsForDeletion,
} from "../api/_server/productDeletion";
import type { Product, ProductImageAsset } from "../src/types";

const baseProduct: Product = {
  id: "resin-test",
  internalReference: "VDZ-RES-ABCDEF",
  slug: "test",
  name: "Test Product",
  category: "resins",
  price: 6,
  fixedPriceMode: "disabled",
  fixedPriceOptions: [],
  shortDescription: "Short",
  longDescription: "Long",
  image: "/legacy.webp",
  imageAlt: "Legacy alt",
  cbdRate: "50 %",
  cbgRate: "Non communique",
  thcRate: "< 0,3 %",
  origin: "France",
  cultureType: "Autre",
  aromas: [],
  tags: [],
  stock: 10,
  lowStockThreshold: 2,
  isActive: true,
  isFeatured: false,
  seoTitle: "SEO",
  seoDescription: "SEO description",
};

const images: ProductImageAsset[] = [
  {
    id: "one",
    url: "https://storage.test/one.webp",
    storagePath: "products/resin-test/one.webp",
    alt: "One",
    sortOrder: 0,
    isPrimary: false,
  },
  {
    id: "two",
    url: "https://storage.test/two.webp",
    storagePath: "products/resin-test/two.webp",
    alt: "Two",
    sortOrder: 1,
    isPrimary: true,
  },
];

assert.equal(validateProductImages(images).ok, true);
assert.equal(validateProductImagesForProduct("resin-test", images).ok, true);
assert.equal(validateProductImagesForProduct("other-product", images).ok, false);

const tooMany = validateProductImages([
  ...images,
  { ...images[0], id: "three", sortOrder: 2, isPrimary: false },
  { ...images[0], id: "four", sortOrder: 3, isPrimary: false },
]);
assert.equal(tooMany.ok, false);
assert.match(tooMany.errors[0], /plus de 3 images/);

const primary = ensureSinglePrimary([
  { ...images[0], isPrimary: true },
  { ...images[1], isPrimary: true },
]);
assert.equal(primary.filter((image) => image.isPrimary).length, 1);

const synced = syncProductPrimaryImage({ ...baseProduct, images });
assert.equal(synced.image, "https://storage.test/two.webp");
assert.equal(synced.imageAlt, "Two");

const legacy = normalizeProductImages({ ...baseProduct, images: undefined });
assert.equal(legacy.length, 1);
assert.equal(legacy[0].url, "/legacy.webp");
assert.equal(legacy[0].isPrimary, true);

assert.equal(isProductImageStoragePath("products/resin-test/one.webp", "resin-test"), true);
assert.equal(isProductImageStoragePath("products/other/one.webp", "resin-test"), false);
assert.equal(isProductImageStoragePath("../products/resin-test/one.webp", "resin-test"), false);

assert.equal(
  hasBlockingProductDependencies({
    orders: 1,
    invoices: 0,
    supplierPurchases: 0,
    stockMovements: 0,
    productReviews: 0,
  }),
  true,
);
assert.equal(
  hasBlockingProductDependencies({
    orders: 0,
    invoices: 0,
    supplierPurchases: 0,
    stockMovements: 0,
    productReviews: 0,
  }),
  false,
);

assert.doesNotThrow(() => assertProductDeleteConfirmation(baseProduct, "VDZ-RES-ABCDEF"));
assert.throws(() => assertProductDeleteConfirmation(baseProduct, "VDZ-RES-WRONG"));

assert.deepEqual(productStoragePathsForDeletion({ ...baseProduct, images }), [
  "products/resin-test/one.webp",
  "products/resin-test/two.webp",
]);

console.info("Admin product image and deletion tests passed.");
