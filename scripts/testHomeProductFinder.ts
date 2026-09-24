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

const flowerMedium: ProductDiscoveryCriteria = {
  category: "flowers",
  intensity: "moyen",
  aromas: [],
};

assert.deepEqual(
  [...getAvailableProductIntensities(products, "flowers")],
  ["doux", "moyen", "fort"],
  "flowers must expose only intensities backed by an active product",
);
assert.deepEqual(
  [...getAvailableProductIntensities(products, "resins")],
  ["doux", "fort"],
  "resins must hide the impossible medium intensity",
);
assert.deepEqual(
  [...getAvailableProductAromaFamilies(products, { category: "flowers", intensity: "moyen" })],
  ["fruite", "sucre", "boise"],
  "flower medium aromas must be derived from compatible active products",
);
assert.deepEqual(
  [...getAvailableProductAromaFamilies(products, { category: "resins", intensity: "fort" })],
  [],
  "resin strong must not propose an aroma that would produce zero results",
);
assert.deepEqual(ids(flowerMedium), [
  "flower-cookie-kush-indoor",
  "flower-harlequin-greenhouse",
  "flower-mango-haze-cbd",
]);

assert.deepEqual(
  ids({ category: "flowers", intensity: "doux", aromas: [] }),
  ["flower-mandarine-cbd"],
  "Mandarine must remain reachable through the shared finder taxonomy",
);

const resinStrong: ProductDiscoveryCriteria = {
  category: "resins",
  intensity: "fort",
  aromas: [],
};
assert.deepEqual(ids(resinStrong), ["resin-golden-static"]);

assert.deepEqual(
  ids({ ...flowerMedium, aromas: ["fruite"] }),
  ["flower-mango-haze-cbd"],
  "an optional aroma must narrow the shared catalog filter",
);
assert.deepEqual(
  ids({ ...flowerMedium, aromas: [] }),
  ids(flowerMedium),
  "Peu importe must preserve the type and intensity result set",
);

const destination = createProductDiscoveryPath({
  ...flowerMedium,
  aromas: ["fruite"],
});
assert.equal(destination, "/boutique?type=flowers&intensity=moyen&aroma=fruite");
assert.deepEqual(
  parseProductDiscoverySearchParams(destination.split("?")[1] ?? ""),
  { category: "flowers", intensity: "moyen", aromas: ["fruite"] },
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

const modifiedChoice = { ...flowerMedium, category: "resins" } as const;
assert.equal(modifiedChoice.intensity, "moyen", "editing the type must not force a full reset");
assert.deepEqual(ids(modifiedChoice), [], "a possible zero-result selection must remain representable");

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
    category: "flowers",
    intensity: "fort",
    aromas: ["fruite"],
  }),
  { category: "flowers", intensity: "fort", aromas: [] },
  "changing intensity must clear an aroma that no longer matches",
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
