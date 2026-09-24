import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProductGallery,
  ProductPurchasePanel,
} from "../src/components/product/ProductPageSections";
import { publicProductStockLabel } from "../src/lib/cartStock";
import { normalizeProductImages } from "../src/lib/productImages";
import { resolveProductCardPresentation } from "../src/lib/productPresentation";
import { resolveProductPurchaseOptions } from "../src/lib/productPurchaseOptions";
import { buildProductJsonLd } from "../src/lib/structuredData";
import { getLocalProducts } from "../src/services/productsService";
import type { Product } from "../src/types";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderProductSection(element: React.ReactElement) {
  const originalError = console.error;
  console.error = (message?: unknown, ...details: unknown[]) => {
    if ([message, ...details].some((detail) => String(detail).includes("fetchPriority"))) return;
    originalError(message, ...details);
  };
  try {
    return renderToStaticMarkup(element);
  } finally {
    console.error = originalError;
  }
}

const activeProducts = getLocalProducts();
const expectedProducts = [
  ["cookie-kush-indoor", "Cookie Kush Indoor"],
  ["harlequin-greenhouse", "Harlequin Greenhouse"],
  ["mandarine-cbd", "Mandarine"],
  ["mango-haze-cbd", "Mango Haze"],
  ["petites-tetes-og-kush", "OG Kush"],
  ["golden-static", "Golden Static"],
  ["supreme-50-cbd", "Suprême 50 % CBD"],
] as const;

assert.equal(activeProducts.length, 7, "ProductPage V2 must cover the seven active products");
assert.deepEqual(
  activeProducts.map(({ slug, name }) => [slug, name]).sort(),
  [...expectedProducts].sort(),
  "the active product identities must stay unchanged",
);

for (const product of activeProducts) {
  const presentation = resolveProductCardPresentation(product);
  assert.ok(
    ["Doux", "Moyen", "Fort"].includes(presentation.intensityLabel),
    `${product.name}: intensity must use the canonical public labels`,
  );
  assert.ok(
    presentation.aromaProfile.length <= 3,
    `${product.name}: no more than three aromas may be visible in the profile`,
  );
  assert.ok(
    presentation.appearance.length <= 2,
    `${product.name}: no more than two aspects may be visible in the profile`,
  );
  assert.ok(normalizeProductImages(product).length >= 1, `${product.name}: an image is required`);

  const jsonLd = JSON.stringify(buildProductJsonLd(product));
  assert.match(jsonLd, /"@type":"Product"/);
  assert.match(jsonLd, new RegExp(product.slug));
}

assert.deepEqual(
  new Set(activeProducts.map((product) => resolveProductCardPresentation(product).intensityLabel)),
  new Set(["Doux", "Moyen", "Fort"]),
  "the active catalog must exercise all three canonical intensity labels",
);

const goldenStatic = activeProducts.find((product) => product.slug === "golden-static");
const supreme = activeProducts.find((product) => product.slug === "supreme-50-cbd");
assert.ok(goldenStatic && supreme, "representative resin fixtures must exist");

const galleryImages = normalizeProductImages(goldenStatic);
const multipleGalleryHtml = renderProductSection(
  <ProductGallery
    product={goldenStatic}
    images={galleryImages}
    selectedImage={galleryImages[0]}
    onSelectImage={() => undefined}
  />,
);
assert.match(multipleGalleryHtml, /data-product-thumbnails="true"/);
assert.equal(
  occurrences(multipleGalleryHtml, "data-product-thumbnail=\"true\""),
  galleryImages.length,
  "a multi-image product must expose one thumbnail per normalized image",
);
assert.match(multipleGalleryHtml, /object-contain/);

const oneImageProduct: Product = { ...goldenStatic, images: undefined };
const singleImages = normalizeProductImages(oneImageProduct);
const singleGalleryHtml = renderProductSection(
  <ProductGallery
    product={oneImageProduct}
    images={singleImages}
    selectedImage={singleImages[0]}
    onSelectImage={() => undefined}
  />,
);
assert.equal(singleImages.length, 1);
assert.doesNotMatch(singleGalleryHtml, /data-product-thumbnails/);

const purchaseOptions = resolveProductPurchaseOptions(goldenStatic, []);
const tenGramOption = purchaseOptions.find((option) => option.quantityGrams === 10);
assert.ok(tenGramOption, "Golden Static must keep its existing 10 g fixed-price format");
assert.equal(tenGramOption.totalPrice, 50);
assert.equal(tenGramOption.totalPrice / tenGramOption.quantityGrams, 5);

const outOfStockSupreme: Product = { ...supreme, stock: 0 };
const unavailableOptions = resolveProductPurchaseOptions(outOfStockSupreme, []);
assert.ok(unavailableOptions.length > 0, "the unavailable product keeps its real format list");
assert.ok(
  unavailableOptions.every((option) => option.available === false),
  "stock zero must disable every purchase option",
);
const outOfStockLabel = publicProductStockLabel(outOfStockSupreme);
const unavailablePurchaseHtml = renderProductSection(
  <ProductPurchasePanel
    product={outOfStockSupreme}
    purchaseOptions={unavailableOptions}
    selectedPurchaseOption={undefined}
    availabilityLabel={outOfStockLabel}
    stockLabel={outOfStockLabel}
    onSelectPurchaseOption={() => undefined}
    onAddToCart={() => undefined}
  />,
);
assert.match(unavailablePurchaseHtml, /Rupture de stock/);
assert.equal(
  occurrences(unavailablePurchaseHtml, 'data-purchase-option-available="false"'),
  unavailableOptions.length,
  "every zero-stock format must be explicitly unavailable",
);
assert.equal(
  occurrences(unavailablePurchaseHtml, "disabled=\"\""),
  unavailableOptions.length + 1,
  "zero stock must disable every format and the add-to-cart button",
);
assert.match(
  JSON.stringify(buildProductJsonLd(outOfStockSupreme)),
  /https:\/\/schema.org\/OutOfStock/,
  "the out-of-stock state must stay aligned with Product JSON-LD",
);

const pageSource = readFileSync("src/pages/ProductPage.tsx", "utf8");
for (const obsoleteLabel of ["Modérée", "Soutenue", "Intense", "Douce", "Moyenne", "Forte"]) {
  assert.ok(
    !pageSource.includes(obsoleteLabel),
    `ProductPage must not reintroduce the obsolete intensity label ${obsoleteLabel}`,
  );
}
assert.match(pageSource, /IntersectionObserver/);
assert.match(pageSource, /selectedPurchaseOption && !purchaseBlockVisible/);
assert.ok(!pageSource.includes("backdrop-blur"), "the sticky bar must not introduce blur");

const styleSource = readFileSync("src/styles/index.css", "utf8");
assert.match(styleSource, /product-page-image-in 180ms/);
assert.match(styleSource, /\.product-page-v2__image[\s\S]*filter: none/);
assert.match(
  styleSource,
  /prefers-reduced-motion: reduce[\s\S]*\.product-page-v2__image[\s\S]*animation: none/,
);

console.log(
  "ProductPage V2 tests passed: seven products, canonical profiles, one/multiple-image galleries, formats, effective price, zero stock, JSON-LD, sticky observer, crisp images and reduced motion.",
);

function occurrences(value: string, fragment: string) {
  return value.split(fragment).length - 1;
}
