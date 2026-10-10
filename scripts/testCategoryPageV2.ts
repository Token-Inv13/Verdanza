import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createProductDiscoverySearchParams,
  filterProductsByDiscoveryCriteria,
  getAvailableProductAromaFamilies,
  getAvailableProductIntensities,
  parseProductDiscoverySearchParams,
  type ProductDiscoveryCriteria,
} from "../src/lib/productDiscovery";
import { getLocalProducts } from "../src/services/productsService";

const products = getLocalProducts();
const flowers = products.filter((product) => product.category === "flowers");
const resins = products.filter((product) => product.category === "resins");

const ids = (catalog: typeof products, criteria: ProductDiscoveryCriteria) =>
  filterProductsByDiscoveryCriteria(catalog, criteria)
    .map((product) => product.id)
    .sort();

assert.equal(products.length, 11, "category pages must use the eleven active local products");
assert.equal(flowers.length, 6, "the flower category must contain six active products");
assert.equal(resins.length, 5, "the resin category must contain five active products");

assert.deepEqual(Array.from(getAvailableProductIntensities(flowers, "flowers")), [
  "doux", "fort",
]);
assert.deepEqual(Array.from(getAvailableProductIntensities(resins, "resins")), [
  "doux", "moyen", "fort",
]);
assert.deepEqual(Array.from(getAvailableProductAromaFamilies(flowers, {
  category: "flowers",
  intensity: null,
})), ["fruite", "agrumes", "sucre", "boise"]);
assert.deepEqual(Array.from(getAvailableProductAromaFamilies(resins, {
  category: "resins",
  intensity: null,
})), ["fruite", "agrumes", "sucre", "terreux", "epice", "boise"]);

assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: "doux", aromas: [] }),
  flowers.filter((product) => product.id !== "flower-skittlez-plus").map((product) => product.id).sort(),
);
assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: "moyen", aromas: [] }),
  [],
);
assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: "fort", aromas: [] }),
  ["flower-skittlez-plus"],
);
assert.deepEqual(
  ids(resins, { category: "resins", intensity: "doux", aromas: [] }),
  resins.filter((product) => !["resin-black-afghan", "resin-ice-o-lator", "resin-mousseux-skywalker"].includes(product.id)).map((product) => product.id).sort(),
);
assert.deepEqual(
  ids(resins, { category: "resins", intensity: "fort", aromas: [] }),
  ["resin-mousseux-skywalker"],
);
assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: null, aromas: ["fruite", "agrumes"] }),
  [
    "flower-mandarine-cbd",
    "flower-mango-haze-cbd",
    "flower-petites-tetes-og-kush",
    "flower-skittlez-plus",
  ],
  "multiple aroma filters must preserve the shared OR semantics",
);
assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: "fort", aromas: ["fruite"] }),
  ["flower-skittlez-plus"],
  "the strong floral aroma selection must resolve to Skittlez Plus",
);

const parsed = parseProductDiscoverySearchParams("intensity=moyen&aroma=fruite&aroma=sucre");
assert.deepEqual(parsed, {
  category: "all",
  intensity: "moyen",
  aromas: ["fruite", "sucre"],
});
const categorySearchParams = createProductDiscoverySearchParams({
  ...parsed,
  category: "flowers",
});
categorySearchParams.delete("type");
assert.equal(
  categorySearchParams.toString(),
  "intensity=moyen&aroma=fruite&aroma=sucre",
  "category URLs must keep only intensity and aroma criteria",
);

const categoryPageSource = readFileSync("src/pages/CategoryPage.tsx", "utf8");
const filterSource = readFileSync(
  "src/components/category/CategoryProductFilters.tsx",
  "utf8",
);
const floatingHelpSource = readFileSync("src/components/FloatingContactButton.tsx", "utf8");
const analyticsSource = readFileSync("src/lib/analytics.ts", "utf8");
const stylesSource = readFileSync("src/styles/index.css", "utf8");

assert.match(categoryPageSource, /getAvailableProductIntensities/);
assert.match(categoryPageSource, /getAvailableProductAromaFamilies/);
assert.match(categoryPageSource, /filterProductsByDiscoveryCriteria/);
assert.match(categoryPageSource, /createProductDiscoverySearchParams/);
assert.match(categoryPageSource, /<ProductCard/);
assert.match(categoryPageSource, /path=\{content\.path\}/);
assert.match(filterSource, /aria-pressed=\{criteria\.intensity === intensity\}/);
assert.match(filterSource, /aria-expanded=\{aromasOpen\}/);
assert.match(filterSource, /aria-live="polite"/);
assert.match(filterSource, /Plusieurs choix correspondent à au moins une famille sélectionnée/);
assert.match(floatingHelpSource, /"\/fleurs-cbd": \["\[data-category-product-filter\] button"\]/);
assert.match(floatingHelpSource, /"\/resines-cbd": \["\[data-category-product-filter\] button"\]/);
assert.match(analyticsSource, /"category_filter_intensity"/);
assert.match(analyticsSource, /"category_filter_aroma"/);
assert.match(analyticsSource, /"category_filter_reset"/);
assert.match(stylesSource, /\.category-product-grid:has\(> :nth-child\(4\):last-child\)/);
assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.category-filter-aromas/);

console.log(
  "Category Page V2 tests passed: active 6/5 catalog, dynamic intensities/aromas, OR filtering, clean URL contract, shared ProductCard/SEO, analytics, contextual help and reduced motion.",
);
