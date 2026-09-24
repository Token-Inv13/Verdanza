import assert from "node:assert/strict";
import { productSheets, type ProductSheet } from "../src/data/productSheets";
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
  "blue-dream": ["flower", "fort", ["agrumes", "terreux", "boise"]],
  "lemon-skunk": ["flower", "fort", ["agrumes", "sucre", "epice"]],
  mimosa: ["flower", "moyen", ["agrumes", "fruite", "sucre"]],
  "watermelon-candy": ["flower", "doux", ["fruite", "sucre", "terreux"]],
  "zkittlez-og": ["flower", "fort", ["fruite", "sucre", "agrumes"]],
  "le-mousseux": ["resin", "fort", ["terreux", "boise", "agrumes"]],
  kief: ["resin", "fort", ["terreux", "epice", "boise"]],
  libanais: ["resin", "fort", ["terreux", "epice", "boise"]],
  "black-butter": ["resin", "moyen", ["terreux", "boise", "sucre"]],
} as const;

assert.equal(productSheets.length, 10, "all ten V6 profiles must be represented");
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

const flowerMedium: ProductSelectorChoices = { category: "flower", intensity: "moyen", aroma: "any" };
const flowerMatches = rankProductSheets(flowerMedium);
assert.deepEqual(
  flowerMatches.map((match) => match.sheet.slug),
  ["biscotti", "mimosa"],
  "flower + medium must return only exact V6 intensity matches in stable source order",
);
assert.ok(
  flowerMatches.every((match) => match.sheet.selectionProfile.category === "flower"),
  "flower selection must never return a resin",
);

const resinStrong = { ...flowerMedium, category: "resin", intensity: "fort" } as const;
const resinMatches = rankProductSheets(resinStrong);
assert.deepEqual(
  resinMatches.map((match) => match.sheet.slug),
  ["le-mousseux", "kief", "libanais"],
  "resin + strong must return only exact V6 intensity matches",
);
assert.ok(
  resinMatches.every((match) => match.sheet.selectionProfile.category === "resin"),
  "resin selection must never return a flower",
);

assert.deepEqual(
  rankProductSheets({ ...flowerMedium, aroma: "fruite" }).map((match) => match.sheet.slug),
  ["mimosa", "biscotti"],
  "aroma must refine exact type/intensity matches",
);
assert.deepEqual(
  rankProductSheets({ ...flowerMedium, aroma: "boise" }).map((match) => match.sheet.slug),
  ["biscotti", "mimosa"],
  "missing aroma match must fall back to exact type/intensity matches",
);
assert.deepEqual(
  rankProductSheets({ ...flowerMedium, aroma: "any" }).map((match) => match.sheet.slug),
  flowerMatches.map((match) => match.sheet.slug),
  "Peu importe must preserve stable exact-match order",
);
assert.deepEqual(
  rankProductSheets({ category: "flower", intensity: "fort", aroma: "fruite" }).map((match) => match.sheet.slug),
  ["zkittlez-og", "blue-dream", "lemon-skunk"],
  "a matching aroma must rank first without changing intensity",
);
assert.deepEqual(
  rankProductSheets({ category: "resin", intensity: "doux", aroma: null }),
  [],
  "the selector must not silently change intensity when no exact result exists",
);

assert.deepEqual(
  [...getAvailableProductSheetIntensities("flower")].sort(),
  ["doux", "fort", "moyen"],
  "all three flower intensities must be available from product profiles",
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
    { category: "flower", intensity: "moyen", aroma: "sucre" },
    "resin",
  ),
  { category: "resin", intensity: "moyen", aroma: null },
  "changing type may preserve a compatible intensity but must require aroma confirmation again",
);

const exactSelectionCases: Array<{
  choices: ProductSelectorChoices;
  expected: string[];
}> = [
  { choices: { category: "flower", intensity: "doux", aroma: "any" }, expected: ["watermelon-candy"] },
  { choices: { category: "flower", intensity: "moyen", aroma: "any" }, expected: ["biscotti", "mimosa"] },
  { choices: { category: "flower", intensity: "fort", aroma: "any" }, expected: ["blue-dream", "lemon-skunk", "zkittlez-og"] },
  { choices: { category: "resin", intensity: "moyen", aroma: "any" }, expected: ["black-butter"] },
  { choices: { category: "resin", intensity: "fort", aroma: "any" }, expected: ["le-mousseux", "kief", "libanais"] },
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
  { aroma: "fruite", category: "flower", intensity: "fort", first: "zkittlez-og" },
  { aroma: "agrumes", category: "flower", intensity: "fort", first: "blue-dream" },
  { aroma: "sucre", category: "flower", intensity: "moyen", first: "biscotti" },
  { aroma: "terreux", category: "resin", intensity: "fort", first: "le-mousseux" },
  { aroma: "epice", category: "resin", intensity: "fort", first: "kief" },
  { aroma: "boise", category: "resin", intensity: "fort", first: "le-mousseux" },
];
for (const { aroma, category, intensity, first } of aromaCases) {
  assert.equal(rankProductSheets({ aroma, category, intensity })[0]?.sheet.slug, first, `${aroma}: matching aroma must rank first`);
}

assert.deepEqual(
  rankProductSheets({ category: "resin", intensity: "moyen", aroma: "any" }).map((match) => match.sheet.slug),
  ["black-butter"],
  "changing type must recalculate within the new category",
);
assert.deepEqual(
  rankProductSheets({ category: "flower", intensity: "doux", aroma: "any" }).map((match) => match.sheet.slug),
  ["watermelon-candy"],
  "changing intensity must recalculate without fallback",
);

assert.equal(matchesRequiredSelection(sheet("biscotti"), flowerMedium), true);
assert.equal(matchesRequiredSelection(sheet("mimosa"), flowerMedium), true);
assert.equal(matchesRequiredSelection(sheet("watermelon-candy"), flowerMedium), false);
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
  rankProductSheets({ category: "flower", intensity: "fort", aroma: "any" }, stableTieSheets).map((match) => match.sheet.slug),
  ["first", "second"],
  "equal matches must preserve source order",
);

console.log("Product selector V6 tests passed: 10 profiles, strict type/intensity, aroma refinement, fallback, reset and stable ranking.");

function sheet(slug: string) {
  const value = productSheets.find((candidate) => candidate.slug === slug);
  assert.ok(value, `${slug}: test fixture is missing`);
  return value;
}

function cloneAs(slug: string): ProductSheet {
  return { ...sheet("blue-dream"), name: slug, slug };
}
