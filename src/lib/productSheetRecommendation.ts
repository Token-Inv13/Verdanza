import {
  productSheets,
  type ProductSheet,
  type ProductSheetAmbience,
  type ProductSheetAromaFamily,
  type ProductSheetCategory,
  type ProductSheetIntensity,
} from "../data/productSheets";

export type ProductSheetAromaChoice = ProductSheetAromaFamily | "any";

export type ProductSelectorChoices = {
  category: ProductSheetCategory | null;
  ambience: ProductSheetAmbience | null;
  intensity: ProductSheetIntensity | null;
  aroma: ProductSheetAromaChoice | null;
};

export type ProductSheetMatch = {
  sheet: ProductSheet;
  score: number;
  rank: number;
  label: "Meilleure correspondance" | "Très proche" | "Alternative";
};

const intensityOrder: ProductSheetIntensity[] = [
  "douce",
  "moderee",
  "soutenue",
  "intense",
];

export function createInitialProductSelectorChoices(): ProductSelectorChoices {
  return {
    category: null,
    ambience: null,
    intensity: null,
    aroma: null,
  };
}

export function scoreProductSheet(
  sheet: ProductSheet,
  choices: ProductSelectorChoices,
) {
  if (!choices.category || sheet.category !== choices.category) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (choices.ambience && sheet.experience.ambiences.includes(choices.ambience)) {
    score += 4;
  }

  if (choices.intensity) {
    if (sheet.experience.intensity === choices.intensity) {
      score += 3;
    } else if (areNeighboringIntensities(sheet.experience.intensity, choices.intensity)) {
      score += 1;
    }
  }

  if (
    choices.aroma &&
    choices.aroma !== "any" &&
    sheet.aromaFamilies.includes(choices.aroma)
  ) {
    score += 2;
  }

  return score;
}

export function rankProductSheets(
  choices: ProductSelectorChoices,
  sheets: ProductSheet[] = productSheets,
): ProductSheetMatch[] {
  if (!choices.category || !choices.ambience) return [];

  return sheets
    .map((sheet, sourceIndex) => ({
      sheet,
      sourceIndex,
      score: scoreProductSheet(sheet, choices),
    }))
    .filter((match) => Number.isFinite(match.score))
    .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .map(({ sheet, score }, rank) => ({
      sheet,
      score,
      rank,
      label:
        rank === 0
          ? "Meilleure correspondance"
          : rank === 1
            ? "Très proche"
            : "Alternative",
    }));
}

export function areNeighboringIntensities(
  left: ProductSheetIntensity,
  right: ProductSheetIntensity,
) {
  return Math.abs(intensityOrder.indexOf(left) - intensityOrder.indexOf(right)) === 1;
}
