import assert from "node:assert/strict";
import { availableProductSheets, plannedProductSheets, productSheets } from "../src/data/productSheets";
import {
  changeProductSelectorCategory,
  createInitialProductSelectorChoices,
  getAvailableProductSheetIntensities,
  rankProductSheets,
} from "../src/lib/productSheetRecommendation";

const names = (category: "flower" | "resin", aroma: "fruite" | "agrumes" | "sucre" | "terreux" | "epice" | "boise" | "any") =>
  rankProductSheets({ category, intensity: "doux", aroma }, availableProductSheets).map(({ sheet }) => sheet.name);

assert.equal(productSheets.length, 12);
assert.equal(availableProductSheets.length, 8);
assert.equal(plannedProductSheets.length, 4);
assert.deepEqual(
  names("flower", "any"),
  ["Blue Dream", "Cookie Kush Indoor", "Harlequin Greenhouse", "Mandarine", "Mango Haze", "OG Kush"],
  "Peu importe must preserve the stable flower order",
);
assert.deepEqual(
  names("resin", "any"),
  ["Golden Static", "Suprême 50 % CBD"],
  "Peu importe must preserve the stable resin order",
);
assert.deepEqual(
  names("flower", "fruite"),
  ["Blue Dream", "Mandarine", "Mango Haze", "Cookie Kush Indoor", "Harlequin Greenhouse", "OG Kush"],
  "an aroma must reorder, never remove, strict type/intensity matches",
);
assert.deepEqual(
  names("resin", "terreux"),
  ["Golden Static", "Suprême 50 % CBD"],
  "a resin aroma must keep the non-matching exact product after the match",
);
assert.deepEqual([...getAvailableProductSheetIntensities("flower", availableProductSheets)], ["doux"]);
assert.deepEqual([...getAvailableProductSheetIntensities("resin", availableProductSheets)], ["doux"]);
assert.deepEqual(createInitialProductSelectorChoices(), { category: null, intensity: null, aroma: null });
assert.deepEqual(rankProductSheets({ category: "flower", intensity: "doux", aroma: null }, availableProductSheets), [], "results require the explicit third choice");
assert.deepEqual(rankProductSheets({ category: "flower", intensity: null, aroma: "any" }, availableProductSheets), [], "results require intensity");
assert.deepEqual(rankProductSheets({ category: null, intensity: "doux", aroma: "any" }, availableProductSheets), [], "results require type");

const changed = changeProductSelectorCategory(
  { category: "flower", intensity: "doux", aroma: "fruite" },
  "resin",
  availableProductSheets,
);
assert.deepEqual(changed, { category: "resin", intensity: "doux", aroma: null }, "changing category must keep a compatible intensity but require aroma confirmation again");

for (const sheet of availableProductSheets) {
  assert.equal(sheet.availability, "available");
  assert.equal(sheet.selectionProfile.intensity, "doux");
  assert.equal("ambiences" in sheet.selectionProfile, false);
  assert.equal("experience" in sheet, false);
}

assert.equal(rankProductSheets({ category: "flower", intensity: "fort", aroma: "any" }, availableProductSheets).length, 0, "planned Skittle Plus must never enter selector results");
assert.ok(plannedProductSheets.every((sheet) => sheet.availability === "planned"));

const golden = availableProductSheets.find((sheet) => sheet.slug === "golden-static");
assert.ok(golden);
assert.deepEqual(golden.aromas, ["Herbacé", "Végétal", "Authentique"]);
assert.equal(golden.selectionProfile.intensity, "doux");
assert.equal(golden.aromas.includes("Puissant"), false);

console.log("Product selector tests passed: eight available sheets only, four planned excluded, strict filters and stable Golden Static data.");
