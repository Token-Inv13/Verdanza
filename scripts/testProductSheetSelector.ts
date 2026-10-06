import assert from "node:assert/strict";
import {
  availableProductSheets,
  productSheets,
  temporarilyUnavailableProductSheets,
  type ProductSheet,
} from "../src/data/productSheets";
import {
  changeProductSelectorCategory,
  createInitialProductSelectorChoices,
  getAvailableProductSheetIntensities,
  matchesRequiredSelection,
  matchesSelectedAroma,
  rankProductSheets,
  type ProductSelectorChoices,
} from "../src/lib/productSheetRecommendation";

const expectedProfiles = {
  biscotti: ["flower", "moyen", ["sucre", "terreux", "epice"]],
  "blue-dream": ["flower", "doux", ["agrumes", "terreux", "boise"]],
  "lemon-skunk": ["flower", "fort", ["agrumes", "sucre", "epice"]],
  mimosa: ["flower", "moyen", ["agrumes", "fruite", "sucre"]],
  "watermelon-candy": ["flower", "doux", ["fruite", "sucre", "terreux"]],
  "zkittlez-og": ["flower", "moyen", ["fruite", "sucre", "agrumes"]],
  "skittle-plus": ["flower", "fort", ["agrumes", "sucre", "fruite"]],
  kief: ["resin", "fort", ["terreux", "epice", "boise"]],
  libanais: ["resin", "fort", ["terreux", "epice", "boise"]],
  "black-butter": ["resin", "moyen", ["terreux", "boise", "sucre"]],
  "mousseux-skywalker": ["resin", "fort", ["boise", "agrumes", "epice"]],
  "ice-o-lator": ["resin", "moyen", ["fruite", "epice", "sucre"]],
  "black-afghan": ["resin", "moyen", ["terreux", "sucre", "fruite"]],
  marocain: ["resin", "fort", ["boise", "agrumes", "epice"]],
  "golden-static": ["resin", "fort", ["terreux", "boise"]],
} as const;

assert.equal(productSheets.length, 15, "all fifteen retained profiles must be represented");
assert.deepEqual(
  availableProductSheets.map((sheet) => sheet.slug),
  ["blue-dream", "skittle-plus", "mousseux-skywalker", "ice-o-lator", "black-afghan", "marocain", "golden-static"],
  "only references currently represented in the shop may feed the selector",
);
assert.deepEqual(
  temporarilyUnavailableProductSheets.map((sheet) => sheet.slug),
  ["biscotti", "lemon-skunk", "mimosa", "watermelon-candy", "zkittlez-og", "kief", "libanais", "black-butter"],
  "temporarily unavailable sheets must remain retained outside the selector",
);
for (const sheet of productSheets) {
  const expected = expectedProfiles[sheet.slug as keyof typeof expectedProfiles];
  assert.ok(expected, `${sheet.slug}: normalized V6 profile is missing`);
  assert.deepEqual(
    [sheet.selectionProfile.category, sheet.selectionProfile.intensity, sheet.selectionProfile.aromaFamilies],
    expected,
    `${sheet.slug}: normalized V6 profile differs`,
  );
  assert.equal("experience" in sheet, false, `${sheet.slug}: historical experience data leaked into V6`);
  assert.equal("ambiences" in sheet.selectionProfile, false, `${sheet.slug}: ambience leaked into selectionProfile`);
}

const flowerSoft: ProductSelectorChoices = { category: "flower", intensity: "doux", aroma: "any" };
const flowerMatches = rankProductSheets(flowerSoft);
assert.deepEqual(
  flowerMatches.map((match) => match.sheet.slug),
  ["blue-dream"],
  "flower + soft must return only the available exact match",
);
assert.ok(
  flowerMatches.every((match) => match.sheet.selectionProfile.category === "flower"),
  "flower selection must never return a resin",
);

const resinStrong = { ...flowerSoft, category: "resin", intensity: "fort" } as const;
const resinMatches = rankProductSheets(resinStrong);
assert.deepEqual(
  resinMatches.map((match) => match.sheet.slug),
  ["mousseux-skywalker", "marocain", "golden-static"],
  "resin + strong must return only exact V6 intensity matches",
);
assert.ok(
  resinMatches.every((match) => match.sheet.selectionProfile.category === "resin"),
  "resin selection must never return a flower",
);

assert.deepEqual(
  rankProductSheets({ ...flowerSoft, aroma: "fruite" }).map((match) => match.sheet.slug),
  ["blue-dream"],
  "aroma must refine exact type/intensity matches",
);
assert.deepEqual(
  rankProductSheets({ ...flowerSoft, aroma: "boise" }).map((match) => match.sheet.slug),
  ["blue-dream"],
  "missing aroma match must fall back to exact type/intensity matches",
);
assert.deepEqual(
  rankProductSheets({ ...flowerSoft, aroma: "any" }).map((match) => match.sheet.slug),
  flowerMatches.map((match) => match.sheet.slug),
  "Peu importe must preserve stable exact-match order",
);
assert.deepEqual(
  rankProductSheets({ category: "flower", intensity: "fort", aroma: "fruite" }).map((match) => match.sheet.slug),
  ["skittle-plus"],
  "a matching aroma must rank first without changing intensity",
);
assert.deepEqual(
  rankProductSheets({ category: "resin", intensity: "doux", aroma: null }),
  [],
  "the selector must not silently change intensity when no exact result exists",
);

assert.deepEqual(
  [...getAvailableProductSheetIntensities("flower")].sort(),
  ["doux", "fort"],
  "flower intensities must be derived from available product profiles only",
);
assert.deepEqual(
  [...getAvailableProductSheetIntensities("resin")].sort(),
  ["fort", "moyen"],
  "resin intensity availability must be derived from product profiles",
);
assert.equal(
  getAvailableProductSheetIntensities("resin").has("doux"),
  false,
  "resin + douce must be unavailable",
);
assert.deepEqual(
  changeProductSelectorCategory(
    { category: "flower", intensity: "doux", aroma: "fruite" },
    "resin",
  ),
  { category: "resin", intensity: null, aroma: null },
  "changing type must clear unavailable intensity and require aroma confirmation again",
);
assert.deepEqual(
  changeProductSelectorCategory(
    { category: "flower", intensity: "fort", aroma: "sucre" },
    "resin",
  ),
  { category: "resin", intensity: "fort", aroma: null },
  "changing type may preserve a compatible intensity but must require aroma confirmation again",
);

const exactSelectionCases: Array<{
  choices: ProductSelectorChoices;
  expected: string[];
}> = [
  { choices: { category: "flower", intensity: "doux", aroma: "any" }, expected: ["blue-dream"] },
  { choices: { category: "flower", intensity: "moyen", aroma: "any" }, expected: [] },
  { choices: { category: "flower", intensity: "fort", aroma: "any" }, expected: ["skittle-plus"] },
  { choices: { category: "resin", intensity: "moyen", aroma: "any" }, expected: ["ice-o-lator", "black-afghan"] },
  { choices: { category: "resin", intensity: "fort", aroma: "any" }, expected: ["mousseux-skywalker", "marocain", "golden-static"] },
];
for (const { choices, expected } of exactSelectionCases) {
  assert.deepEqual(rankProductSheets(choices).map((match) => match.sheet.slug), expected);
}

const aromaCases: Array<{
  aroma: ProductSelectorChoices["aroma"];
  category: ProductSelectorChoices["category"];
  intensity: ProductSelectorChoices["intensity"];
  first: string;
}> = [
  { aroma: "fruite", category: "flower", intensity: "fort", first: "skittle-plus" },
  { aroma: "agrumes", category: "flower", intensity: "doux", first: "blue-dream" },
  { aroma: "sucre", category: "resin", intensity: "moyen", first: "ice-o-lator" },
  { aroma: "terreux", category: "resin", intensity: "fort", first: "golden-static" },
  { aroma: "epice", category: "resin", intensity: "fort", first: "mousseux-skywalker" },
  { aroma: "boise", category: "resin", intensity: "fort", first: "mousseux-skywalker" },
];
for (const { aroma, category, intensity, first } of aromaCases) {
  assert.equal(rankProductSheets({ aroma, category, intensity })[0]?.sheet.slug, first, `${aroma}: matching aroma must rank first`);
}

assert.deepEqual(
  rankProductSheets({ category: "resin", intensity: "moyen", aroma: "any" }).map((match) => match.sheet.slug),
  ["ice-o-lator", "black-afghan"],
  "changing type must recalculate within the new category",
);
assert.deepEqual(
  rankProductSheets({ category: "flower", intensity: "doux", aroma: "any" }).map((match) => match.sheet.slug),
  ["blue-dream"],
  "changing intensity must recalculate without fallback",
);

assert.equal(matchesRequiredSelection(sheet("blue-dream"), flowerSoft), true);
assert.equal(matchesRequiredSelection(sheet("biscotti"), flowerSoft), false);
assert.equal(matchesRequiredSelection(sheet("watermelon-candy"), flowerSoft), true);
assert.equal(matchesSelectedAroma(sheet("mimosa"), "fruite"), true);
assert.equal(matchesSelectedAroma(sheet("mimosa"), "any"), false);

assert.deepEqual(createInitialProductSelectorChoices(), { category: null, intensity: null, aroma: null }, "reset must clear type, intensity and aroma");
assert.deepEqual(rankProductSheets(createInitialProductSelectorChoices()), [], "empty selector must show no result");
assert.deepEqual(rankProductSheets({ category: "flower", intensity: null, aroma: null }), [], "type alone must show no result");
assert.deepEqual(
  rankProductSheets({ category: "flower", intensity: "fort", aroma: null }),
  [],
  "type and intensity must show no result until aroma is explicitly confirmed",
);

const stableTieSheets = [cloneAs("first"), cloneAs("second")];
assert.deepEqual(
  rankProductSheets({ category: "flower", intensity: "doux", aroma: "any" }, stableTieSheets).map((match) => match.sheet.slug),
  ["first", "second"],
  "equal matches must preserve source order",
);

console.log("Product selector tests passed: 7 available and 8 retained profiles, strict availability/type/intensity, aroma refinement, reset and stable ranking.");

function sheet(slug: string) {
  const value = productSheets.find((candidate) => candidate.slug === slug);
  assert.ok(value, `${slug}: test fixture is missing`);
  return value;
}

function cloneAs(slug: string): ProductSheet {
  return { ...sheet("blue-dream"), name: slug, slug };
}
