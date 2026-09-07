import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Check, ChevronDown, Flower2, Layers2, RotateCcw, SlidersHorizontal } from "lucide-react";
import {
  productSheetAromaFamilyLabels,
  productSheetCategoryLabels,
  productSheetIntensityLabels,
  type ProductSheetAromaFamily,
  type ProductSheetCategory,
  type ProductSheetIntensity,
} from "../../data/productSheets";
import { trackEvent } from "../../lib/analytics";
import {
  changeProductSelectorCategory,
  createInitialProductSelectorChoices,
  getAvailableProductSheetIntensities,
  rankProductSheets,
  type ProductSheetAromaChoice,
  type ProductSelectorChoices,
} from "../../lib/productSheetRecommendation";
import { ProductRecommendation } from "./ProductRecommendation";

type SelectorStepNumber = 1 | 2 | 3;

const intensityOptions: Array<[ProductSheetIntensity, string]> = [
  ["douce", "Doux"],
  ["moyenne", "Moyen"],
  ["forte", "Fort"],
];
const intensitySummaryLabels: Record<ProductSheetIntensity, string> = {
  douce: "Doux",
  moyenne: "Moyen",
  forte: "Fort",
};
const aromaOptions = Object.entries(productSheetAromaFamilyLabels) as Array<
  [ProductSheetAromaFamily, string]
>;

export function ProductProfileSelector() {
  const [choices, setChoices] = useState<ProductSelectorChoices>(
    createInitialProductSelectorChoices,
  );
  const [openStep, setOpenStep] = useState<SelectorStepNumber | null>(1);
  const [selectorExpanded, setSelectorExpanded] = useState(true);
  const [showStickySummary, setShowStickySummary] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const matches = useMemo(() => rankProductSheets(choices), [choices]);
  const availableIntensities = useMemo(
    () => getAvailableProductSheetIntensities(choices.category),
    [choices.category],
  );
  const selectionKey = [choices.category, choices.intensity, choices.aroma].join(":");
  const hasSelection = Boolean(choices.category || choices.intensity || choices.aroma);
  const selectionComplete = Boolean(choices.category && choices.intensity && choices.aroma);

  useEffect(() => {
    const summary = summaryRef.current;
    if (!summary || !selectionComplete || selectorExpanded) {
      setShowStickySummary(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickySummary(!entry.isIntersecting && entry.boundingClientRect.top < 80),
      { rootMargin: "-80px 0px 0px" },
    );
    observer.observe(summary);
    return () => observer.disconnect();
  }, [selectionComplete, selectorExpanded]);

  const startSelector = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent("product_selector_started", { selector_version: "v6-ui-v2" });
  };

  const selectCategory = (category: ProductSheetCategory) => {
    startSelector();
    const nextChoices = changeProductSelectorCategory(choices, category);
    setChoices(nextChoices);
    setSelectorExpanded(true);
    setOpenStep(nextChoices.intensity ? 3 : 2);
    trackEvent("product_selector_type_selected", { product_type: category });
  };

  const selectIntensity = (intensity: ProductSheetIntensity) => {
    startSelector();
    setChoices((current) => ({
      ...current,
      intensity,
      aroma: current.intensity === intensity ? current.aroma : null,
    }));
    setOpenStep(3);
    setSelectorExpanded(true);
    trackEvent("product_selector_intensity_selected", { intensity });
  };

  const selectAroma = (aroma: ProductSheetAromaChoice) => {
    startSelector();
    setChoices((current) => ({ ...current, aroma }));
    setOpenStep(null);
    setSelectorExpanded(false);
    trackEvent("product_selector_aroma_selected", { aroma });
  };

  const editSelection = () => {
    setSelectorExpanded(true);
    setOpenStep(3);
  };

  const reset = () => {
    setChoices(createInitialProductSelectorChoices());
    setOpenStep(1);
    setSelectorExpanded(true);
    setShowStickySummary(false);
    startedRef.current = false;
  };

  const completedSteps = [
    Boolean(choices.category),
    Boolean(choices.intensity),
    Boolean(choices.aroma),
  ];

  return (
    <>
      <section
        className="product-selector-shell rounded-xl border border-forest/10 p-4 shadow-soft sm:p-6 lg:p-8"
        aria-labelledby="product-selector-title"
        data-product-selector
        data-selector-collapsed={selectorExpanded ? "false" : "true"}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
              Trouvez votre profil
            </p>
            <h2 id="product-selector-title" className="mt-2 font-display text-3xl leading-tight text-forest sm:text-4xl">
              Trois choix, simplement
            </h2>
            {selectorExpanded && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/60 sm:text-base">
                Le type et l’intensité filtrent la sélection. Les arômes affinent uniquement l’ordre.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-forest underline decoration-champagne underline-offset-4 transition hover:text-[#082f24] focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={reset}
              disabled={!hasSelection}
              data-selector-reset
            >
              <RotateCcw aria-hidden="true" size={15} />
              Réinitialiser
            </button>
            <a href="#all-product-sheets" className="btn-secondary min-h-11 px-4 py-2 text-sm">
              Voir toutes les fiches
            </a>
          </div>
        </div>

        {selectorExpanded ? (
          <>
            <ol className="mt-5 flex items-center gap-2" aria-label="Progression du sélecteur : Type, Intensité, Arômes">
              {([1, 2, 3] as SelectorStepNumber[]).map((step, index) => (
                <li key={step} className="flex flex-1 items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-semibold transition ${completedSteps[index] ? "border-forest bg-forest text-ivory" : openStep === step ? "border-champagne bg-champagne text-forest" : "border-forest/15 bg-ivory text-forest/50"}`}
                    aria-current={openStep === step ? "step" : undefined}
                    data-selector-progress-step={step}
                    data-state={completedSteps[index] ? "complete" : openStep === step ? "active" : "pending"}
                  >
                    {completedSteps[index] ? <Check aria-hidden="true" size={13} /> : step}
                  </span>
                  {index < 2 && <span className="h-px flex-1 bg-forest/15" aria-hidden="true" />}
                </li>
              ))}
            </ol>

            <div className="mt-5 space-y-2.5" data-selector-steps>
              <SelectorStep
                number={1}
                title="Que recherchez-vous ?"
                summary={choices.category ? `${productSheetCategoryLabels[choices.category]}s` : "À choisir"}
                open={openStep === 1}
                completed={Boolean(choices.category)}
                onToggle={() => setOpenStep((current) => (current === 1 ? null : 1))}
              >
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <TypeOption category="flower" title="Fleurs" description="Profils aromatiques et visuels" selected={choices.category === "flower"} onSelect={selectCategory} icon={<Flower2 aria-hidden="true" size={21} />} />
                  <TypeOption category="resin" title="Résines" description="Textures et profils plus profonds" selected={choices.category === "resin"} onSelect={selectCategory} icon={<Layers2 aria-hidden="true" size={21} />} />
                </div>
              </SelectorStep>

              <SelectorStep
                number={2}
                title="Quelle intensité ?"
                summary={choices.intensity ? productSheetIntensityLabels[choices.intensity] : "À choisir"}
                open={openStep === 2}
                completed={Boolean(choices.intensity)}
                locked={!choices.category}
                onToggle={() => setOpenStep((current) => (current === 2 ? null : 2))}
              >
                <OptionGrid>
                  {intensityOptions.map(([value, label]) => (
                    <ChoiceOption
                      key={value}
                      label={label}
                      description={choices.category && !availableIntensities.has(value) ? "Aucun produit actuellement" : undefined}
                      disabled={Boolean(choices.category && !availableIntensities.has(value))}
                      selected={availableIntensities.has(value) && choices.intensity === value}
                      onSelect={() => selectIntensity(value)}
                      dataValue={`intensity:${value}`}
                    />
                  ))}
                </OptionGrid>
              </SelectorStep>

              <SelectorStep
                number={3}
                title="Quels arômes aimez-vous ?"
                optional
                summary={choices.aroma === "any" ? "Peu importe" : choices.aroma ? productSheetAromaFamilyLabels[choices.aroma] : "À choisir"}
                open={openStep === 3}
                completed={Boolean(choices.aroma)}
                locked={!choices.intensity}
                onToggle={() => setOpenStep((current) => (current === 3 ? null : 3))}
              >
                <OptionGrid>
                  {aromaOptions.map(([value, label]) => (
                    <ChoiceOption key={value} label={label} selected={choices.aroma === value} onSelect={() => selectAroma(value)} dataValue={`aroma:${value}`} />
                  ))}
                  <ChoiceOption label="Peu importe" selected={choices.aroma === "any"} onSelect={() => selectAroma("any")} dataValue="aroma:any" />
                </OptionGrid>
              </SelectorStep>
            </div>
          </>
        ) : (
          <SelectionSummary summaryRef={summaryRef} choices={choices} onEdit={editSelection} sticky={false} />
        )}
      </section>

      {showStickySummary && <SelectionSummary choices={choices} onEdit={editSelection} sticky />}

      {matches.length > 0 && <ProductRecommendation matches={matches} selectionKey={selectionKey} />}
    </>
  );
}

function SelectionSummary({
  choices,
  onEdit,
  sticky,
  summaryRef,
}: {
  choices: ProductSelectorChoices;
  onEdit: () => void;
  sticky: boolean;
  summaryRef?: Ref<HTMLDivElement>;
}) {
  const labels = [
    choices.category ? `${productSheetCategoryLabels[choices.category]}s` : null,
    choices.intensity ? intensitySummaryLabels[choices.intensity] : null,
    choices.aroma === "any"
      ? "Peu importe"
      : choices.aroma
        ? productSheetAromaFamilyLabels[choices.aroma]
        : null,
  ].filter(Boolean) as string[];

  return (
    <div
      ref={summaryRef}
      className={sticky ? "product-selector-sticky fixed inset-x-0 top-20 z-30 border-b border-champagne/30 bg-ivory/95 px-3 shadow-sm backdrop-blur md:hidden" : "mt-4 flex min-h-14 items-center justify-between gap-3 rounded-lg border border-champagne/35 bg-ivory px-3 py-2 shadow-sm sm:px-4"}
      data-selector-summary
      data-sticky={sticky ? "true" : "false"}
      aria-label="Sélection actuelle"
    >
      <div className={`${sticky ? "mx-auto flex w-full max-w-7xl" : "flex w-full"} min-w-0 items-center gap-2 overflow-hidden`}>
        <SlidersHorizontal aria-hidden="true" size={16} className="shrink-0 text-champagne" />
        <p className="truncate text-sm font-semibold text-forest">{labels.join(" · ")}</p>
        <button type="button" className="ml-auto inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-semibold text-forest underline decoration-champagne underline-offset-4 focus:outline-none focus:ring-2 focus:ring-champagne" onClick={onEdit} data-selector-edit>
          Modifier
        </button>
      </div>
    </div>
  );
}

function SelectorStep({ number, title, summary, open, completed, locked = false, optional = false, onToggle, children }: { number: SelectorStepNumber; title: string; summary: string; open: boolean; completed: boolean; locked?: boolean; optional?: boolean; onToggle: () => void; children: ReactNode }) {
  const panelId = `product-selector-step-${number}-panel`;
  return (
    <div className={`selector-step rounded-lg border bg-ivory transition ${open ? "border-champagne/55 shadow-sm" : "border-forest/10"} ${locked ? "opacity-55" : ""}`} data-selector-step={number} data-state={open ? "open" : completed ? "complete" : locked ? "locked" : "closed"}>
      <button type="button" className="grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-3 py-2 text-left text-forest focus:outline-none focus:ring-2 focus:ring-inset focus:ring-champagne sm:px-4" onClick={onToggle} disabled={locked} aria-expanded={open} aria-controls={panelId}>
        <span className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${completed ? "border-forest bg-forest text-ivory" : "border-champagne/55 bg-cream text-forest"}`} aria-hidden="true">{completed ? <Check size={13} /> : number}</span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">{title}{optional && <span className="text-[0.62rem] font-medium uppercase tracking-[0.1em] text-forest/45">Facultatif</span>}</span>
          <span className="mt-0.5 block truncate text-xs font-medium text-ink/50">{summary}</span>
        </span>
        <ChevronDown aria-hidden="true" size={17} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <fieldset id={panelId} className={`selector-step-content m-0 min-w-0 border-0 p-0 ${open ? "is-open" : ""}`} aria-hidden={!open} disabled={!open}>
        <div><div className="border-t border-forest/10 px-3 pb-4 pt-3 sm:px-4">{children}</div></div>
      </fieldset>
    </div>
  );
}

function TypeOption({ category, title, description, selected, onSelect, icon }: { category: ProductSheetCategory; title: string; description: string; selected: boolean; onSelect: (category: ProductSheetCategory) => void; icon: ReactNode }) {
  return (
    <button type="button" className={`group flex min-h-20 items-center gap-3 rounded-lg border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${selected ? "border-forest bg-forest text-ivory" : "border-forest/15 bg-cream/55 text-forest hover:border-champagne"}`} onClick={() => onSelect(category)} aria-pressed={selected} data-selector-option={`category:${category}`}>
      <span className="shrink-0 text-champagne">{icon}</span>
      <span className="min-w-0"><span className="block text-sm font-semibold uppercase tracking-[0.13em]">{title}</span><span className={`mt-1 block text-xs leading-4 ${selected ? "text-ivory/70" : "text-ink/55"}`}>{description}</span></span>
    </button>
  );
}

function OptionGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function ChoiceOption({ label, description, disabled = false, selected, onSelect, dataValue }: { label: string; description?: string; disabled?: boolean; selected: boolean; onSelect: () => void; dataValue: string }) {
  return (
    <button type="button" className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold uppercase tracking-[0.06em] transition focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${disabled ? "cursor-not-allowed border-forest/10 bg-forest/[0.035] text-forest/35" : selected ? "border-forest bg-forest text-ivory" : "border-forest/15 bg-cream/45 text-forest hover:border-champagne hover:bg-cream"}`} onClick={onSelect} disabled={disabled} aria-pressed={selected} data-selector-option={dataValue} data-available={disabled ? "false" : "true"}>
      <span className="block">{label}</span>
      {description && <span className="mt-0.5 block text-[0.62rem] font-medium normal-case tracking-normal">{description}</span>}
    </button>
  );
}
