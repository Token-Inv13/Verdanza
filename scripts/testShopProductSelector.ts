import assert from "node:assert/strict";
import { productSheets } from "../src/data/productSheets";
import { isProductOrderable } from "../src/lib/cartStock";
import {
  createInitialProductDiscoveryCriteria,
  filterProductsByDiscoveryCriteria,
  getAvailableProductAromaFamilies,
  hasCompleteProductDiscoveryCriteria,
  parseProductDiscoverySearchParams,
  type ProductDiscoveryCriteria,
} from "../src/lib/productDiscovery";
import {
  productIntensityLabels,
  productIntensityValues,
} from "../src/lib/productTaxonomy";
import { getLocalProducts } from "../src/services/productsService";

const products = getLocalProducts();
const ids = (criteria: ProductDiscoveryCriteria) =>
  filterProductsByDiscoveryCriteria(products, criteria)
    .map((product) => product.id)
    .sort();

const initial = createInitialProductDiscoveryCriteria();

assert.equal(products.length, 7, "the selector fixture must use the seven active catalog products");
assert.equal(ids(initial).length, 7, "initial state must show the complete active catalog");
assert.equal(ids({ ...initial, category: "flowers" }).length, 5, "Fleurs must keep five products");
assert.equal(ids({ ...initial, category: "resins" }).length, 2, "Résines must keep two products");

assert.deepEqual(ids({ ...initial, intensity: "doux" }), [
  "flower-mandarine-cbd",
  "resin-supreme-50-cbd",
]);
assert.deepEqual(ids({ ...initial, intensity: "moyen" }), [
  "flower-cookie-kush-indoor",
  "flower-harlequin-greenhouse",
  "flower-mango-haze-cbd",
]);
assert.deepEqual(ids({ ...initial, intensity: "fort" }), [
  "flower-petites-tetes-og-kush",
  "resin-golden-static",
]);

assert.deepEqual(
  ids({ ...initial, aromas: ["fruite"] }),
  ["flower-mandarine-cbd", "flower-mango-haze-cbd"],
  "a single aroma family must filter the active catalog",
);
assert.deepEqual(
  ids({ ...initial, aromas: ["fruite", "agrumes"] }),
  [
    "flower-mandarine-cbd",
    "flower-mango-haze-cbd",
    "flower-petites-tetes-og-kush",
  ],
  "multiple aroma families must use OR semantics",
);
assert.deepEqual(
  ids({ ...initial, category: "resins", intensity: "fort" }),
  ["resin-golden-static"],
  "type and intensity must combine strictly",
);
assert.deepEqual(
  ids({ ...initial, category: "resins", intensity: "moyen" }),
  [],
  "an impossible combination must expose the zero-result state",
);
assert.deepEqual(
  createInitialProductDiscoveryCriteria(),
  { category: "all", intensity: null, aromas: [] },
  "reset must restore the complete catalog criteria",
);
assert.equal(
  hasCompleteProductDiscoveryCriteria(parseProductDiscoverySearchParams("")),
  false,
  "the unfiltered shop must keep the full selector",
);
assert.equal(
  hasCompleteProductDiscoveryCriteria(parseProductDiscoverySearchParams("type=flowers")),
  false,
  "a category without intensity is not a complete homepage selection",
);
assert.equal(
  hasCompleteProductDiscoveryCriteria(
    parseProductDiscoverySearchParams("type=flowers&intensity=moyen"),
  ),
  true,
  "a valid type and intensity activate compact result mode",
);
assert.equal(
  hasCompleteProductDiscoveryCriteria(
    parseProductDiscoverySearchParams("type=flowers&intensity=inconnue&aroma=fruite"),
  ),
  false,
  "invalid taxonomy values must not activate compact result mode",
);

const availableAromas = [...getAvailableProductAromaFamilies(products)].sort();
assert.deepEqual(
  availableAromas,
  ["agrumes", "boise", "fruite", "sucre"],
  "the shop must propose only canonical families present in active products",
);

const outOfStock = { ...products[0], stock: 0 };
assert.equal(
  filterProductsByDiscoveryCriteria([outOfStock], initial).length,
  1,
  "out-of-stock products must remain visible in filtered results",
);
assert.equal(isProductOrderable(outOfStock), false, "out-of-stock results must remain non-buyable");

assert.deepEqual(productIntensityValues, ["doux", "moyen", "fort"]);
assert.deepEqual(Object.values(productIntensityLabels), ["Doux", "Moyen", "Fort"]);
assert.ok(
  productSheets.every((sheet) => productIntensityValues.includes(sheet.selectionProfile.intensity)),
  "product sheets must use the same canonical intensity values as the shop",
);

console.log(
  "Shop selector tests passed: initial catalog, categories, three intensities, aroma OR, combined filters, reset, zero results and out-of-stock behavior.",
);
