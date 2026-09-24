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

assert.equal(products.length, 7, "category pages must use the seven active local products");
assert.equal(flowers.length, 5, "the flower category must contain five active products");
assert.equal(resins.length, 2, "the resin category must contain two active products");

assert.deepEqual(Array.from(getAvailableProductIntensities(flowers, "flowers")), [
  "doux",
  "moyen",
  "fort",
]);
assert.deepEqual(Array.from(getAvailableProductIntensities(resins, "resins")), [
  "doux",
  "fort",
]);
assert.deepEqual(Array.from(getAvailableProductAromaFamilies(flowers, {
  category: "flowers",
  intensity: null,
})), ["fruite", "agrumes", "sucre", "boise"]);
assert.deepEqual(Array.from(getAvailableProductAromaFamilies(resins, {
  category: "resins",
  intensity: null,
})), []);

assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: "doux", aromas: [] }),
  ["flower-mandarine-cbd"],
);
assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: "moyen", aromas: [] }),
  [
    "flower-cookie-kush-indoor",
    "flower-harlequin-greenhouse",
    "flower-mango-haze-cbd",
  ],
);
assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: "fort", aromas: [] }),
  ["flower-petites-tetes-og-kush"],
);
assert.deepEqual(
  ids(resins, { category: "resins", intensity: "doux", aromas: [] }),
  ["resin-supreme-50-cbd"],
);
assert.deepEqual(
  ids(resins, { category: "resins", intensity: "fort", aromas: [] }),
  ["resin-golden-static"],
);
assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: null, aromas: ["fruite", "agrumes"] }),
  [
    "flower-mandarine-cbd",
    "flower-mango-haze-cbd",
    "flower-petites-tetes-og-kush",
  ],
  "multiple aroma filters must preserve the shared OR semantics",
);
assert.deepEqual(
  ids(flowers, { category: "flowers", intensity: "fort", aromas: ["fruite"] }),
  [],
  "a valid but incompatible combination must expose the empty state",
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
assert.match(floatingHelpSource, /"\/fleurs-cbd": \["\[data-category-product-filter\]"\]/);
assert.match(floatingHelpSource, /"\/resines-cbd": \["\[data-category-product-filter\]"\]/);
assert.match(analyticsSource, /"category_filter_intensity"/);
assert.match(analyticsSource, /"category_filter_aroma"/);
assert.match(analyticsSource, /"category_filter_reset"/);
assert.match(stylesSource, /\.category-product-grid:has\(> :nth-child\(4\):last-child\)/);
assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.category-filter-aromas/);

console.log(
  "Category Page V2 tests passed: active 5/2 catalog, dynamic intensities/aromas, OR filtering, empty state, clean URL contract, shared ProductCard/SEO, analytics, contextual help and reduced motion.",
);
