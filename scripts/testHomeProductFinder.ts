import assert from "node:assert/strict";
import {
  createInitialProductDiscoveryCriteria,
  createProductDiscoveryPath,
  filterProductsByDiscoveryCriteria,
  getAvailableProductAromaFamilies,
  getAvailableProductIntensities,
  parseProductDiscoverySearchParams,
  reconcileProductDiscoveryCriteria,
  type ProductDiscoveryCriteria,
} from "../src/lib/productDiscovery";
import { getLocalProducts } from "../src/services/productsService";

const products = getLocalProducts();
const ids = (criteria: ProductDiscoveryCriteria) =>
  filterProductsByDiscoveryCriteria(products, criteria)
    .map((product) => product.id)
    .sort();

const flowerSoft: ProductDiscoveryCriteria = {
  category: "flowers",
  intensity: "doux",
  aromas: [],
};

assert.deepEqual(
  [...getAvailableProductIntensities(products, "flowers")],
  ["doux"],
  "flowers must expose only intensities backed by an active product",
);
assert.deepEqual(
  [...getAvailableProductIntensities(products, "resins")],
  ["doux"],
  "resins must offer only their published soft profile",
);
assert.deepEqual(
  [...getAvailableProductAromaFamilies(products, { category: "flowers", intensity: "doux" })],
  ["fruite", "agrumes", "sucre", "boise"],
  "flower soft aromas must be derived from compatible active products",
);
assert.deepEqual(
  [...getAvailableProductAromaFamilies(products, { category: "resins", intensity: "doux" })],
  [],
  "soft resins must not propose an aroma that would produce zero results",
);
assert.deepEqual(ids(flowerSoft), [
  "flower-cookie-kush-indoor",
  "flower-harlequin-greenhouse",
  "flower-mandarine-cbd",
  "flower-mango-haze-cbd",
  "flower-petites-tetes-og-kush",
]);

assert.deepEqual(
  ids({ category: "flowers", intensity: "doux", aromas: [] }),
  ids(flowerSoft),
  "all active flowers must remain reachable through the soft profile",
);

const resinSoft: ProductDiscoveryCriteria = {
  category: "resins",
  intensity: "doux",
  aromas: [],
};
assert.deepEqual(ids(resinSoft), ["resin-golden-static", "resin-supreme-50-cbd"]);

assert.deepEqual(
  ids({ ...flowerSoft, aromas: ["fruite"] }),
  ["flower-mandarine-cbd", "flower-mango-haze-cbd"],
  "an optional aroma must narrow the shared catalog filter",
);
assert.deepEqual(
  ids({ ...flowerSoft, aromas: [] }),
  ids(flowerSoft),
  "Peu importe must preserve the type and intensity result set",
);

const destination = createProductDiscoveryPath({
  ...flowerSoft,
  aromas: ["fruite"],
});
assert.equal(destination, "/boutique?type=flowers&intensity=doux&aroma=fruite");
assert.deepEqual(
  parseProductDiscoverySearchParams(destination.split("?")[1] ?? ""),
  { category: "flowers", intensity: "doux", aromas: ["fruite"] },
  "the shareable URL must round-trip into the shop criteria",
);

assert.deepEqual(
  parseProductDiscoverySearchParams(
    "type=resins&intensity=fort&aroma=boise&aroma=agrumes&aroma=unknown",
  ),
  { category: "resins", intensity: "fort", aromas: ["boise", "agrumes"] },
  "the shop query parser must retain valid repeated aromas and reject unknown values",
);
assert.deepEqual(
  parseProductDiscoverySearchParams("type=legacy&intensity=forte&aroma=floral"),
  createInitialProductDiscoveryCriteria(),
  "invalid or legacy query values must fall back safely",
);

const modifiedChoice = { ...flowerSoft, category: "resins" } as const;
assert.equal(modifiedChoice.intensity, "doux", "editing the type must not force a full reset");
assert.deepEqual(ids(modifiedChoice), ids(resinSoft), "the shared soft profile must work for both categories");

assert.deepEqual(
  reconcileProductDiscoveryCriteria(products, {
    category: "resins",
    intensity: "moyen",
    aromas: ["fruite"],
  }),
  { category: "resins", intensity: null, aromas: [] },
  "changing a parent choice must clear incompatible intensity and aroma children",
);
assert.deepEqual(
  reconcileProductDiscoveryCriteria(products, {
    category: "resins",
    intensity: "doux",
    aromas: ["fruite"],
  }),
  { category: "resins", intensity: "doux", aromas: [] },
  "changing category must clear an aroma that no longer matches",
);

for (const category of ["flowers", "resins"] as const) {
  for (const intensity of getAvailableProductIntensities(products, category)) {
    assert.ok(
      ids({ category, intensity, aromas: [] }).length > 0,
      `${category} + ${intensity} + Peu importe must always produce a result`,
    );
  }
}

console.log(
  "Home product finder tests passed: contextual intensities/aromas, no guided dead ends, Peu importe, child reconciliation, shared URL and zero-result safety.",
);
