import assert from "node:assert/strict";
import { productSheets } from "../src/data/productSheets";
import {
  changeProductSelectorCategory,
  createInitialProductSelectorChoices,
  getAvailableProductSheetIntensities,
  rankProductSheets,
} from "../src/lib/productSheetRecommendation";

const names = (category: "flower" | "resin", aroma: "fruite" | "agrumes" | "sucre" | "terreux" | "epice" | "boise" | "any") =>
  rankProductSheets({ category, intensity: "doux", aroma }, productSheets).map(({ sheet }) => sheet.name);

assert.equal(productSheets.length, 8);
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
assert.deepEqual([...getAvailableProductSheetIntensities("flower", productSheets)], ["doux"]);
assert.deepEqual([...getAvailableProductSheetIntensities("resin", productSheets)], ["doux"]);
assert.deepEqual(createInitialProductSelectorChoices(), { category: null, intensity: null, aroma: null });
assert.deepEqual(rankProductSheets({ category: "flower", intensity: "doux", aroma: null }, productSheets), [], "results require the explicit third choice");
assert.deepEqual(rankProductSheets({ category: "flower", intensity: null, aroma: "any" }, productSheets), [], "results require intensity");
assert.deepEqual(rankProductSheets({ category: null, intensity: "doux", aroma: "any" }, productSheets), [], "results require type");

const changed = changeProductSelectorCategory(
  { category: "flower", intensity: "doux", aroma: "fruite" },
  "resin",
  productSheets,
);
assert.deepEqual(changed, { category: "resin", intensity: "doux", aroma: null }, "changing category must keep a compatible intensity but require aroma confirmation again");

for (const sheet of productSheets) {
  assert.equal(sheet.availability, "available");
  assert.equal(sheet.selectionProfile.intensity, "doux");
  assert.equal("ambiences" in sheet.selectionProfile, false);
  assert.equal("experience" in sheet, false);
}

const golden = productSheets.find((sheet) => sheet.slug === "golden-static");
assert.ok(golden);
assert.deepEqual(golden.aromas, ["Herbacé", "Végétal", "Authentique"]);
assert.equal(golden.selectionProfile.intensity, "doux");
assert.equal(golden.aromas.includes("Puissant"), false);

console.log("Product selector tests passed: eight active sheets, strict type/intensity, explicit aroma confirmation, stable ranking and Golden Static correction.");
