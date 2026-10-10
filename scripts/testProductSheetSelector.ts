import assert from "node:assert/strict";
import { availableProductSheets, plannedProductSheets, productSheets } from "../src/data/productSheets";
import {
  changeProductSelectorCategory,
  createInitialProductSelectorChoices,
  getAvailableProductSheetIntensities,
  rankProductSheets,
} from "../src/lib/productSheetRecommendation";

const names = (category: "flower" | "resin", intensity: "doux" | "moyen" | "fort", aroma: "fruite" | "agrumes" | "sucre" | "terreux" | "epice" | "boise" | "any") =>
  rankProductSheets({ category, intensity, aroma }, availableProductSheets).map(({ sheet }) => sheet.name);

assert.equal(productSheets.length, 12);
assert.equal(availableProductSheets.length, 12);
assert.equal(plannedProductSheets.length, 0);
assert.deepEqual(
  names("flower", "doux", "any"),
  ["Blue Dream", "Cookie Kush Indoor", "Harlequin Greenhouse", "Mandarine", "Mango Haze", "OG Kush"],
  "Peu importe must preserve the stable flower order",
);
assert.deepEqual(
  names("resin", "doux", "any"),
  ["Golden Static", "Suprême 50 % CBD"],
  "Peu importe must preserve the stable resin order",
);
assert.deepEqual(
  names("flower", "doux", "fruite"),
  ["Blue Dream", "Mandarine", "Mango Haze", "Cookie Kush Indoor", "Harlequin Greenhouse", "OG Kush"],
  "an aroma must reorder, never remove, strict type/intensity matches",
);
assert.deepEqual(
  names("resin", "doux", "terreux"),
  ["Golden Static", "Suprême 50 % CBD"],
  "a resin aroma must keep the non-matching exact product after the match",
);
assert.deepEqual([...getAvailableProductSheetIntensities("flower", availableProductSheets)], ["doux", "fort"]);
assert.deepEqual([...getAvailableProductSheetIntensities("resin", availableProductSheets)], ["doux", "moyen", "fort"]);
assert.deepEqual(names("flower", "fort", "any"), ["Skittlez Plus"]);
assert.deepEqual(names("flower", "fort", "agrumes"), ["Skittlez Plus"]);
assert.deepEqual(names("resin", "moyen", "any"), ["Black Afghan", "Ice-o-Lator"]);
assert.deepEqual(names("resin", "moyen", "epice"), ["Ice-o-Lator", "Black Afghan"]);
assert.deepEqual(names("resin", "fort", "any"), ["Mousseux Skywalker"]);
assert.deepEqual(names("resin", "fort", "boise"), ["Mousseux Skywalker"]);
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
  assert.ok(["doux", "moyen", "fort"].includes(sheet.selectionProfile.intensity));
  assert.equal("ambiences" in sheet.selectionProfile, false);
  assert.equal("experience" in sheet, false);
}

assert.equal(rankProductSheets({ category: "flower", intensity: "fort", aroma: "any" }, availableProductSheets).length, 1);

const golden = availableProductSheets.find((sheet) => sheet.slug === "golden-static");
assert.ok(golden);
assert.deepEqual(golden.aromas, ["Herbacé", "Végétal", "Authentique"]);
assert.equal(golden.selectionProfile.intensity, "doux");
assert.equal(golden.aromas.includes("Puissant"), false);

console.log("Product selector tests passed: twelve available sheets, strict filters, aroma ordering and stable Golden Static data.");
