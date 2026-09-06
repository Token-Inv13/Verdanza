import assert from "node:assert/strict";
import { productSheets, type ProductSheet } from "../src/data/productSheets";
import {
  createInitialProductSelectorChoices,
  rankProductSheets,
  scoreProductSheet,
  type ProductSelectorChoices,
} from "../src/lib/productSheetRecommendation";

const expectedProfiles = {
  biscotti: ["flower", "soutenue", ["equilibre", "detente"], ["sucre", "terreux", "epice"]],
  "blue-dream": ["flower", "intense", ["detente-profonde", "equilibre"], ["agrumes", "terreux", "boise"]],
  "lemon-skunk": ["flower", "intense", ["detente-profonde", "dynamique"], ["agrumes", "sucre", "epice"]],
  mimosa: ["flower", "soutenue", ["dynamique", "equilibre"], ["agrumes", "fruite", "sucre"]],
  "watermelon-candy": ["flower", "moderee", ["detente", "cocooning"], ["fruite", "sucre", "terreux"]],
  "zkittlez-og": ["flower", "intense", ["detente-profonde", "equilibre"], ["fruite", "sucre", "agrumes"]],
  "pollen-mousseux": ["resin", "intense", ["detente-profonde", "equilibre"], ["terreux", "boise", "agrumes"]],
  kief: ["resin", "intense", ["detente-profonde"], ["terreux", "epice", "boise"]],
  "black-libanais": ["resin", "intense", ["detente-profonde", "cocooning"], ["terreux", "epice", "boise"]],
  "black-butter": ["resin", "soutenue", ["detente", "cocooning"], ["terreux", "boise", "sucre"]],
} as const;

assert.equal(productSheets.length, 10, "all ten V5.1 products must be represented");
for (const sheet of productSheets) {
  const expected = expectedProfiles[sheet.slug as keyof typeof expectedProfiles];
  assert.ok(expected, `${sheet.slug}: normalized official profile is missing`);
  assert.deepEqual(
    [sheet.category, sheet.experience.intensity, sheet.experience.ambiences, sheet.aromaFamilies],
    expected,
    `${sheet.slug}: normalized official profile differs`,
  );
  assert.ok(sheet.experience.summary.length > 0, `${sheet.slug}: V5.1 summary is missing`);
}

const baseFlower: ProductSelectorChoices = {
  category: "flower",
  ambience: "detente-profonde",
  intensity: null,
  aroma: null,
};
const flowerMatches = rankProductSheets(baseFlower);
assert.ok(flowerMatches.length > 0, "flowers should produce matches");
assert.ok(
  flowerMatches.every((match) => match.sheet.category === "flower"),
  "flower selection must never return a resin",
);

const resinMatches = rankProductSheets({ ...baseFlower, category: "resin" });
assert.ok(resinMatches.length > 0, "resins should produce matches");
assert.ok(
  resinMatches.every((match) => match.sheet.category === "resin"),
  "resin selection must never return a flower",
);
assert.notEqual(
  flowerMatches[0].sheet.category,
  resinMatches[0].sheet.category,
  "changing type must recalculate the result",
);

const blueDream = sheet("blue-dream");
const biscotti = sheet("biscotti");
assert.equal(scoreProductSheet(blueDream, baseFlower), 4, "exact ambience must add four points");
assert.equal(scoreProductSheet(biscotti, baseFlower), 0, "non-matching ambience must add no point");
assert.ok(
  scoreProductSheet(blueDream, { ...baseFlower, intensity: "intense" }) >
    scoreProductSheet(biscotti, { ...baseFlower, intensity: "intense" }),
  "exact intensity must outrank a neighboring intensity",
);

const withoutAroma = rankProductSheets({ ...baseFlower, intensity: "intense" });
const withFruityAroma = rankProductSheets({
  ...baseFlower,
  intensity: "intense",
  aroma: "fruite",
});
assert.equal(withoutAroma[0].sheet.slug, "blue-dream", "source order must break an exact tie");
assert.equal(withFruityAroma[0].sheet.slug, "zkittlez-og", "aroma must refine the ranking");
assert.deepEqual(
  rankProductSheets({ ...baseFlower, intensity: "intense", aroma: "any" }).map(({ sheet, score }) => [sheet.slug, score]),
  withoutAroma.map(({ sheet, score }) => [sheet.slug, score]),
  "Peu importe must not alter scores",
);

assert.deepEqual(
  createInitialProductSelectorChoices(),
  { category: null, ambience: null, intensity: null, aroma: null },
  "reset must return to the initial empty state",
);
assert.deepEqual(rankProductSheets(createInitialProductSelectorChoices()), [], "empty selector must show no result");
assert.deepEqual(rankProductSheets({ ...baseFlower, ambience: null }), [], "type alone must show no result");
assert.deepEqual(
  rankProductSheets(baseFlower).map(({ sheet, score }) => [sheet.slug, score]),
  rankProductSheets(baseFlower).map(({ sheet, score }) => [sheet.slug, score]),
  "ranking must be deterministic",
);

const stableTieSheets = [cloneAs("first"), cloneAs("second")];
assert.deepEqual(
  rankProductSheets(baseFlower, stableTieSheets).map((match) => match.sheet.slug),
  ["first", "second"],
  "equal scores must preserve source order",
);

console.log("Product selector tests passed: taxonomy, strict filters, scoring, reset and stable ranking.");

function sheet(slug: string) {
  const value = productSheets.find((candidate) => candidate.slug === slug);
  assert.ok(value, `${slug}: test fixture is missing`);
  return value;
}

function cloneAs(slug: string): ProductSheet {
  return { ...blueDream, name: slug, slug };
}
