import {
  productSheets,
  type ProductSheet,
  type ProductSheetAromaFamily,
  type ProductSheetCategory,
  type ProductSheetIntensity,
} from "../data/productSheets";

export type ProductSheetAromaChoice = ProductSheetAromaFamily | "any";

export type ProductSelectorChoices = {
  category: ProductSheetCategory | null;
  intensity: ProductSheetIntensity | null;
  aroma: ProductSheetAromaChoice | null;
};

export type ProductSheetMatch = {
  sheet: ProductSheet;
  aromaMatch: boolean;
  rank: number;
};

export function createInitialProductSelectorChoices(): ProductSelectorChoices {
  return { category: null, intensity: null, aroma: null };
}

export function getAvailableProductSheetIntensities(
  category: ProductSheetCategory | null,
  sheets: ProductSheet[] = productSheets,
): Set<ProductSheetIntensity> {
  if (!category) return new Set();

  return new Set(
    sheets
      .filter((sheet) => sheet.selectionProfile.category === category)
      .map((sheet) => sheet.selectionProfile.intensity),
  );
}

export function changeProductSelectorCategory(
  choices: ProductSelectorChoices,
  category: ProductSheetCategory,
  sheets: ProductSheet[] = productSheets,
): ProductSelectorChoices {
  const availableIntensities = getAvailableProductSheetIntensities(category, sheets);

  return {
    ...choices,
    category,
    aroma: choices.category === category ? choices.aroma : null,
    intensity:
      choices.intensity && availableIntensities.has(choices.intensity)
        ? choices.intensity
        : null,
  };
}

export function matchesRequiredSelection(
  sheet: ProductSheet,
  choices: ProductSelectorChoices,
) {
  return Boolean(
    choices.category &&
      choices.intensity &&
      sheet.selectionProfile.category === choices.category &&
      sheet.selectionProfile.intensity === choices.intensity,
  );
}

export function matchesSelectedAroma(
  sheet: ProductSheet,
  aroma: ProductSheetAromaChoice | null,
) {
  return Boolean(
    aroma && aroma !== "any" && sheet.selectionProfile.aromaFamilies.includes(aroma),
  );
}

export function rankProductSheets(
  choices: ProductSelectorChoices,
  sheets: ProductSheet[] = productSheets,
): ProductSheetMatch[] {
  if (!choices.category || !choices.intensity || !choices.aroma) return [];

  return sheets
    .map((sheet, sourceIndex) => ({
      sheet,
      sourceIndex,
      aromaMatch: matchesSelectedAroma(sheet, choices.aroma),
    }))
    .filter(({ sheet }) => matchesRequiredSelection(sheet, choices))
    .sort(
      (left, right) =>
        Number(right.aromaMatch) - Number(left.aromaMatch) ||
        left.sourceIndex - right.sourceIndex,
    )
    .map(({ sheet, aromaMatch }, rank) => ({ sheet, aromaMatch, rank }));
}
