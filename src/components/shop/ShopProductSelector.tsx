import { RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  ChoiceOption,
  OptionGrid,
  SelectorStep,
  type SelectorStepNumber,
} from "../product-discovery/DiscoverySelectorControls";
import { trackEvent } from "../../lib/analytics";
import type {
  ProductDiscoveryCategory,
  ProductDiscoveryCriteria,
} from "../../lib/productDiscovery";
import {
  productAromaFamilyLabels,
  productIntensityLabels,
  productIntensityValues,
  type ProductAromaFamily,
  type ProductIntensity,
} from "../../lib/productTaxonomy";

const categoryOptions: Array<[ProductDiscoveryCategory, string]> = [
  ["all", "Toutes"],
  ["flowers", "Fleurs"],
  ["resins", "Résines"],
];

const categorySummaries: Record<ProductDiscoveryCategory, string> = {
  all: "Toutes les catégories",
  flowers: "Fleurs",
  resins: "Résines",
};

export function ShopProductSelector({
  criteria,
  resultCount,
  availableAromas,
  compact,
  focusFirstStep,
  onChange,
  onEdit,
  onReset,
}: {
  criteria: ProductDiscoveryCriteria;
  resultCount: number;
  availableAromas: ProductAromaFamily[];
  compact: boolean;
  focusFirstStep: boolean;
  onChange: (criteria: ProductDiscoveryCriteria) => void;
  onEdit: () => void;
  onReset: () => void;
}) {
  const [openStep, setOpenStep] = useState<SelectorStepNumber | null>(() => {
    if (criteria.category === "all") return 1;
    if (!criteria.intensity) return 2;
    return criteria.aromas.length > 0 ? null : 3;
  });
  const hasCriteria =
    criteria.category !== "all" || Boolean(criteria.intensity) || criteria.aromas.length > 0;
  const selectionSummary = [
    categorySummaries[criteria.category],
    criteria.intensity ? productIntensityLabels[criteria.intensity] : null,
    criteria.aromas.length > 0
      ? criteria.aromas.map((aroma) => productAromaFamilyLabels[aroma]).join(" · ")
      : "Peu importe",
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  const selectCategory = (category: ProductDiscoveryCategory) => {
    onChange({ ...criteria, category });
    setOpenStep(2);
    trackEvent("product_selector_type_selected", {
      selector_location: "shop",
      product_type: category,
    });
  };

  const selectIntensity = (intensity: ProductIntensity) => {
    const nextIntensity = criteria.intensity === intensity ? null : intensity;
    onChange({ ...criteria, intensity: nextIntensity });
    setOpenStep(3);
    trackEvent("product_selector_intensity_selected", {
      selector_location: "shop",
      intensity: nextIntensity ?? "all",
    });
  };

  const toggleAroma = (aroma: ProductAromaFamily) => {
    const aromas = criteria.aromas.includes(aroma)
      ? criteria.aromas.filter((candidate) => candidate !== aroma)
      : [...criteria.aromas, aroma];
    onChange({ ...criteria, aromas });
    trackEvent("product_selector_aroma_selected", {
      selector_location: "shop",
      aroma,
      selected: aromas.includes(aroma),
    });
  };

  const resetSelection = () => {
    onReset();
    setOpenStep(1);
    trackEvent("product_selector_reset", { selector_location: "shop" });
  };

  if (compact) {
    return (
      <section
        id="produits"
        className="mx-auto mt-6 max-w-5xl scroll-mt-24 border-y border-champagne/35 py-4 sm:py-5"
        aria-labelledby="shop-selection-title"
        data-shop-product-selector
        data-shop-selector-mode="compact"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h1
              id="shop-selection-title"
              className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-champagne"
            >
              Votre sélection
            </h1>
            <p
              className="mt-1.5 font-display text-xl leading-snug text-forest sm:text-2xl"
              data-shop-selection-summary
            >
              {selectionSummary}
            </p>
            <p
              className="mt-1 text-sm font-semibold text-forest/75"
              aria-live="polite"
              data-shop-result-count
            >
              {resultCount} {resultCount === 1 ? "produit correspond" : "produits correspondent"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:shrink-0 sm:justify-end">
            <button
              type="button"
              className="min-h-11 rounded-md px-1 text-sm font-semibold text-forest underline decoration-champagne underline-offset-4 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
              onClick={() => {
                setOpenStep(1);
                onEdit();
              }}
              aria-expanded="false"
              aria-controls="shop-product-selector-controls"
              data-shop-selector-edit
            >
              Modifier
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md px-1 text-sm font-medium text-forest/65 underline decoration-champagne/65 underline-offset-4 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
              onClick={resetSelection}
              data-shop-selector-reset
            >
              Réinitialiser
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      id="produits"
      className="product-selector-shell mx-auto mt-8 max-w-4xl scroll-mt-24 rounded-xl border border-forest/10 p-4 shadow-soft sm:p-6"
      aria-label="Affiner les produits"
      data-shop-product-selector
      data-shop-selector-mode="full"
    >
      <div id="shop-product-selector-controls" className="space-y-2.5">
        <SelectorStep
          number={1}
          title="Quel type de produit ?"
          summary={categorySummaries[criteria.category]}
          open={openStep === 1}
          completed={criteria.category !== "all"}
          autoFocus={focusFirstStep}
          onToggle={() => setOpenStep((current) => (current === 1 ? null : 1))}
        >
          <OptionGrid>
            {categoryOptions.map(([value, label]) => (
              <ChoiceOption
                key={value}
                label={label}
                selected={criteria.category === value}
                onSelect={() => selectCategory(value)}
                dataValue={`shop-category:${value}`}
              />
            ))}
          </OptionGrid>
        </SelectorStep>

        <SelectorStep
          number={2}
          title="Quelle intensité ?"
          summary={criteria.intensity ? productIntensityLabels[criteria.intensity] : "Toutes"}
          open={openStep === 2}
          completed={Boolean(criteria.intensity)}
          optional
          onToggle={() => setOpenStep((current) => (current === 2 ? null : 2))}
        >
          <OptionGrid>
            {productIntensityValues.map((value) => (
              <ChoiceOption
                key={value}
                label={productIntensityLabels[value]}
                selected={criteria.intensity === value}
                onSelect={() => selectIntensity(value)}
                dataValue={`shop-intensity:${value}`}
              />
            ))}
          </OptionGrid>
        </SelectorStep>

        <SelectorStep
          number={3}
          title="Quels arômes aimez-vous ?"
          summary={
            criteria.aromas.length > 0
              ? criteria.aromas.map((aroma) => productAromaFamilyLabels[aroma]).join(" · ")
              : "Tous"
          }
          open={openStep === 3}
          completed={criteria.aromas.length > 0}
          optional
          onToggle={() => setOpenStep((current) => (current === 3 ? null : 3))}
        >
          <OptionGrid>
            {availableAromas.map((value) => (
              <ChoiceOption
                key={value}
                label={productAromaFamilyLabels[value]}
                selected={criteria.aromas.includes(value)}
                onSelect={() => toggleAroma(value)}
                dataValue={`shop-aroma:${value}`}
              />
            ))}
          </OptionGrid>
          <p className="mt-3 text-xs leading-5 text-ink/55">
            Plusieurs choix correspondent à au moins une des familles sélectionnées.
          </p>
        </SelectorStep>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-forest/10 pt-4">
        <p className="text-sm font-semibold text-forest" aria-live="polite" data-shop-result-count>
          {resultCount} {resultCount === 1 ? "produit correspond" : "produits correspondent"}
        </p>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-forest underline decoration-champagne underline-offset-4 transition hover:text-[#082f24] focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35"
          onClick={resetSelection}
          disabled={!hasCriteria}
          data-shop-selector-reset
        >
          <RotateCcw aria-hidden="true" size={15} />
          Réinitialiser
        </button>
      </div>
    </section>
  );
}
