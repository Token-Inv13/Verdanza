import { ChevronDown, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { trackEvent } from "../../lib/analytics";
import type { ProductDiscoveryCriteria } from "../../lib/productDiscovery";
import {
  productAromaFamilyLabels,
  productIntensityLabels,
  type ProductAromaFamily,
  type ProductIntensity,
} from "../../lib/productTaxonomy";

export function CategoryProductFilters({
  categoryLabel,
  criteria,
  availableIntensities,
  availableAromas,
  resultCount,
  onChange,
  onReset,
}: {
  categoryLabel: string;
  criteria: ProductDiscoveryCriteria;
  availableIntensities: ProductIntensity[];
  availableAromas: ProductAromaFamily[];
  resultCount: number;
  onChange: (criteria: ProductDiscoveryCriteria) => void;
  onReset: () => void;
}) {
  const aromaOptionsId = useId();
  const [aromasOpen, setAromasOpen] = useState(() => criteria.aromas.length > 0);
  const hasActiveFilters = Boolean(criteria.intensity) || criteria.aromas.length > 0;
  const resultLabel = hasActiveFilters
    ? `${resultCount} ${resultCount === 1 ? "produit correspond" : "produits correspondent"}`
    : `${resultCount} ${resultCount === 1 ? "produit" : "produits"}`;

  const selectIntensity = (intensity: ProductIntensity | null) => {
    onChange({ ...criteria, intensity });
    trackEvent("category_filter_intensity", {
      product_type: criteria.category,
      intensity: intensity ?? "all",
    });
  };

  const toggleAroma = (aroma: ProductAromaFamily) => {
    const aromas = criteria.aromas.includes(aroma)
      ? criteria.aromas.filter((candidate) => candidate !== aroma)
      : [...criteria.aromas, aroma];
    onChange({ ...criteria, aromas });
    trackEvent("category_filter_aroma", {
      product_type: criteria.category,
      aroma,
      selected: aromas.includes(aroma),
    });
  };

  const reset = () => {
    setAromasOpen(false);
    onReset();
    trackEvent("category_filter_reset", { product_type: criteria.category });
  };

  return (
    <section
      className="mt-6 border-y border-champagne/35 py-4 sm:py-5"
      aria-label={`Filtrer les ${categoryLabel.toLocaleLowerCase("fr")}`}
      data-category-product-filter
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Filtrer par intensité"
          data-category-intensity-options
        >
          <button
            type="button"
            className="category-filter-choice"
            aria-pressed={criteria.intensity === null}
            data-category-intensity="all"
            onClick={() => selectIntensity(null)}
          >
            Tous
          </button>
          {availableIntensities.map((intensity) => (
            <button
              key={intensity}
              type="button"
              className="category-filter-choice"
              aria-pressed={criteria.intensity === intensity}
              data-category-intensity={intensity}
              onClick={() => selectIntensity(intensity)}
            >
              {productIntensityLabels[intensity]}
            </button>
          ))}
          {availableAromas.length > 0 ? (
            <button
              type="button"
              className="category-filter-choice category-filter-choice--aromas"
              aria-expanded={aromasOpen}
              aria-controls={aromaOptionsId}
              aria-label={`Filtrer par arômes${
                criteria.aromas.length > 0
                  ? `, ${criteria.aromas.length} sélection${criteria.aromas.length > 1 ? "s" : ""}`
                  : ""
              }`}
              data-category-aroma-toggle
              onClick={() => setAromasOpen((current) => !current)}
            >
              Arômes
              {criteria.aromas.length > 0 ? ` · ${criteria.aromas.length}` : ""}
              <ChevronDown
                size={15}
                aria-hidden="true"
                className={aromasOpen ? "rotate-180" : undefined}
              />
            </button>
          ) : null}
        </div>

        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-5 gap-y-1 lg:shrink-0 lg:justify-end">
          <p
            className="text-sm font-semibold text-forest/75"
            aria-live="polite"
            data-category-result-count
          >
            {resultLabel}
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 rounded px-1 text-sm font-medium text-forest/65 underline decoration-champagne/70 underline-offset-4 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
              onClick={reset}
              data-category-filter-reset
            >
              <RotateCcw size={14} aria-hidden="true" />
              Réinitialiser
            </button>
          ) : null}
        </div>
      </div>

      {availableAromas.length > 0 && aromasOpen ? (
        <div
          id={aromaOptionsId}
          className="category-filter-aromas mt-4 flex flex-wrap gap-2 border-t border-forest/10 pt-4"
          aria-label="Familles aromatiques"
          data-category-aroma-options
        >
          {availableAromas.map((aroma) => (
            <button
              key={aroma}
              type="button"
              className="category-filter-choice category-filter-choice--secondary"
              aria-pressed={criteria.aromas.includes(aroma)}
              data-category-aroma={aroma}
              onClick={() => toggleAroma(aroma)}
            >
              {productAromaFamilyLabels[aroma]}
            </button>
          ))}
          <p className="w-full text-xs leading-5 text-ink/50">
            Plusieurs choix correspondent à au moins une famille sélectionnée.
          </p>
        </div>
      ) : null}
    </section>
  );
}
