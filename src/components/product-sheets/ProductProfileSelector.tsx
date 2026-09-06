import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Flower2, Layers2, RotateCcw } from "lucide-react";
import {
  productSheetAmbienceLabels,
  productSheetAromaFamilyLabels,
  productSheetCategoryLabels,
  productSheetIntensityLabels,
  type ProductSheetAmbience,
  type ProductSheetAromaFamily,
  type ProductSheetCategory,
  type ProductSheetIntensity,
} from "../../data/productSheets";
import { trackEvent } from "../../lib/analytics";
import {
  createInitialProductSelectorChoices,
  rankProductSheets,
  type ProductSheetAromaChoice,
  type ProductSelectorChoices,
} from "../../lib/productSheetRecommendation";
import { ProductRecommendation } from "./ProductRecommendation";

type SelectorStepNumber = 1 | 2 | 3 | 4;

const ambienceOptions = Object.entries(productSheetAmbienceLabels) as Array<
  [ProductSheetAmbience, string]
>;
const intensityOptions = Object.entries(productSheetIntensityLabels) as Array<
  [ProductSheetIntensity, string]
>;
const aromaOptions = Object.entries(productSheetAromaFamilyLabels) as Array<
  [ProductSheetAromaFamily, string]
>;

export function ProductProfileSelector() {
  const [choices, setChoices] = useState<ProductSelectorChoices>(
    createInitialProductSelectorChoices,
  );
  const [openStep, setOpenStep] = useState<SelectorStepNumber | null>(1);
  const startedRef = useRef(false);
  const matches = useMemo(() => rankProductSheets(choices), [choices]);
  const selectionKey = [
    choices.category,
    choices.ambience,
    choices.intensity,
    choices.aroma,
  ].join(":");
  const hasSelection = Object.values(choices).some(Boolean);

  const startSelector = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent("product_selector_started", { selector_version: "v1" });
  };

  const selectCategory = (category: ProductSheetCategory) => {
    startSelector();
    setChoices((current) => ({ ...current, category }));
    setOpenStep(2);
    trackEvent("product_selector_type_selected", { product_type: category });
  };

  const selectAmbience = (ambience: ProductSheetAmbience) => {
    startSelector();
    setChoices((current) => ({ ...current, ambience }));
    setOpenStep(3);
    trackEvent("product_selector_ambience_selected", { ambience });
  };

  const selectIntensity = (intensity: ProductSheetIntensity) => {
    startSelector();
    setChoices((current) => ({ ...current, intensity }));
    setOpenStep(4);
    trackEvent("product_selector_intensity_selected", { intensity });
  };

  const selectAroma = (aroma: ProductSheetAromaChoice) => {
    startSelector();
    setChoices((current) => ({ ...current, aroma }));
    setOpenStep(null);
    trackEvent("product_selector_aroma_selected", { aroma });
  };

  const reset = () => {
    setChoices(createInitialProductSelectorChoices());
    setOpenStep(1);
    startedRef.current = false;
  };

  const completedSteps = [
    Boolean(choices.category),
    Boolean(choices.ambience),
    Boolean(choices.intensity),
    Boolean(choices.aroma),
  ];

  return (
    <section
      className="product-selector-shell rounded-xl border border-forest/10 p-5 shadow-soft sm:p-8 lg:p-10"
      aria-labelledby="product-selector-title"
      data-product-selector
    >
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
            Trouvez votre profil
          </p>
          <h2
            id="product-selector-title"
            className="mt-3 font-display text-4xl leading-tight text-forest sm:text-5xl"
          >
            Quelle ambiance recherchez-vous ?
          </h2>
          <p className="mt-4 text-base leading-7 text-ink/65 sm:text-lg">
            Quelques choix suffisent pour trouver les profils Verdanza qui vous
            correspondent le mieux.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
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
          <a
            href="#toutes-les-fiches"
            className="btn-secondary min-h-11 px-4 py-2 text-sm"
          >
            Voir toutes les fiches
          </a>
        </div>
      </div>

      <ol
        className="mt-8 flex items-center gap-2"
        aria-label="Progression du sélecteur : Type, Ambiance, Intensité, Arômes"
      >
        {([1, 2, 3, 4] as SelectorStepNumber[]).map((step, index) => (
          <li key={step} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition ${
                completedSteps[index]
                  ? "border-forest bg-forest text-ivory"
                  : openStep === step
                    ? "border-champagne bg-champagne text-forest"
                    : "border-forest/15 bg-ivory text-forest/50"
              }`}
              aria-current={openStep === step ? "step" : undefined}
              data-selector-progress-step={step}
              data-state={completedSteps[index] ? "complete" : openStep === step ? "active" : "pending"}
            >
              {completedSteps[index] ? <Check aria-hidden="true" size={14} /> : step}
            </span>
            {index < 3 && <span className="h-px flex-1 bg-forest/15" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="mt-7 space-y-3" data-selector-steps>
        <SelectorStep
          number={1}
          title="Type de produit"
          summary={choices.category ? productSheetCategoryLabels[choices.category] : "À choisir"}
          open={openStep === 1}
          completed={Boolean(choices.category)}
          onToggle={() => setOpenStep((current) => (current === 1 ? null : 1))}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TypeOption
              category="flower"
              title="Fleurs"
              description="Profils aromatiques et visuels"
              selected={choices.category === "flower"}
              onSelect={selectCategory}
              icon={<Flower2 aria-hidden="true" size={24} />}
            />
            <TypeOption
              category="resin"
              title="Résines"
              description="Textures et profils plus profonds"
              selected={choices.category === "resin"}
              onSelect={selectCategory}
              icon={<Layers2 aria-hidden="true" size={24} />}
            />
          </div>
        </SelectorStep>

        <SelectorStep
          number={2}
          title="Ambiance recherchée"
          summary={
            choices.ambience ? productSheetAmbienceLabels[choices.ambience] : "À choisir"
          }
          open={openStep === 2}
          completed={Boolean(choices.ambience)}
          locked={!choices.category}
          onToggle={() => setOpenStep((current) => (current === 2 ? null : 2))}
        >
          <OptionGrid>
            {ambienceOptions.map(([value, label]) => (
              <ChoiceOption
                key={value}
                label={label}
                selected={choices.ambience === value}
                onSelect={() => selectAmbience(value)}
              />
            ))}
          </OptionGrid>
        </SelectorStep>

        <SelectorStep
          number={3}
          title="Intensité"
          summary={
            choices.intensity ? productSheetIntensityLabels[choices.intensity] : "À affiner"
          }
          open={openStep === 3}
          completed={Boolean(choices.intensity)}
          locked={!choices.ambience}
          onToggle={() => setOpenStep((current) => (current === 3 ? null : 3))}
        >
          <OptionGrid>
            {intensityOptions.map(([value, label]) => (
              <ChoiceOption
                key={value}
                label={label}
                selected={choices.intensity === value}
                onSelect={() => selectIntensity(value)}
              />
            ))}
          </OptionGrid>
        </SelectorStep>

        <SelectorStep
          number={4}
          title="Arômes"
          optional
          summary={
            choices.aroma === "any"
              ? "Peu importe"
              : choices.aroma
                ? productSheetAromaFamilyLabels[choices.aroma]
                : "Facultatif"
          }
          open={openStep === 4}
          completed={Boolean(choices.aroma)}
          locked={!choices.intensity}
          onToggle={() => setOpenStep((current) => (current === 4 ? null : 4))}
        >
          <OptionGrid>
            {aromaOptions.map(([value, label]) => (
              <ChoiceOption
                key={value}
                label={label}
                selected={choices.aroma === value}
                onSelect={() => selectAroma(value)}
              />
            ))}
            <ChoiceOption
              label="Peu importe"
              selected={choices.aroma === "any"}
              onSelect={() => selectAroma("any")}
            />
          </OptionGrid>
        </SelectorStep>
      </div>

      <p className="mt-5 text-xs leading-5 text-ink/50">
        Le type filtre strictement la sélection. L’ambiance guide la recommandation ;
        l’intensité et les arômes l’affinent ensuite.
      </p>

      {matches.length > 0 && (
        <ProductRecommendation matches={matches} selectionKey={selectionKey} />
      )}
    </section>
  );
}

function SelectorStep({
  number,
  title,
  summary,
  open,
  completed,
  locked = false,
  optional = false,
  onToggle,
  children,
}: {
  number: SelectorStepNumber;
  title: string;
  summary: string;
  open: boolean;
  completed: boolean;
  locked?: boolean;
  optional?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `product-selector-step-${number}-panel`;

  return (
    <div
      className={`selector-step rounded-lg border bg-ivory transition ${
        open ? "border-champagne/55 shadow-sm" : "border-forest/10"
      } ${locked ? "opacity-55" : ""}`}
      data-selector-step={number}
      data-state={open ? "open" : completed ? "complete" : locked ? "locked" : "closed"}
    >
      <button
        type="button"
        className="grid min-h-16 w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-4 py-3 text-left text-forest focus:outline-none focus:ring-2 focus:ring-inset focus:ring-champagne sm:px-5"
        onClick={onToggle}
        disabled={locked}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold ${
            completed
              ? "border-forest bg-forest text-ivory"
              : "border-champagne/55 bg-cream text-forest"
          }`}
          aria-hidden="true"
        >
          {completed ? <Check size={14} /> : number}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {title}
            {optional && (
              <span className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-forest/45">
                Facultatif
              </span>
            )}
          </span>
          <span className="mt-1 block truncate text-xs font-medium text-ink/50">{summary}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          size={18}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <fieldset
        id={panelId}
        className={`selector-step-content m-0 min-w-0 border-0 p-0 ${open ? "is-open" : ""}`}
        aria-hidden={!open}
        disabled={!open}
      >
        <div>
          <div className="border-t border-forest/10 px-4 pb-5 pt-4 sm:px-5">
            {children}
          </div>
        </div>
      </fieldset>
    </div>
  );
}

function TypeOption({
  category,
  title,
  description,
  selected,
  onSelect,
  icon,
}: {
  category: ProductSheetCategory;
  title: string;
  description: string;
  selected: boolean;
  onSelect: (category: ProductSheetCategory) => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`group min-h-28 rounded-lg border p-5 text-left transition focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${
        selected
          ? "border-forest bg-forest text-ivory"
          : "border-forest/15 bg-cream/55 text-forest hover:border-champagne"
      }`}
      onClick={() => onSelect(category)}
      aria-pressed={selected}
      data-selector-option={`category:${category}`}
    >
      <span className="text-champagne">{icon}</span>
      <span className="mt-5 block text-sm font-semibold uppercase tracking-[0.15em]">
        {title}
      </span>
      <span className={`mt-2 block text-xs leading-5 ${selected ? "text-ivory/70" : "text-ink/55"}`}>
        {description}
      </span>
    </button>
  );
}

function OptionGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function ChoiceOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`min-h-11 rounded-md border px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${
        selected
          ? "border-forest bg-forest text-ivory"
          : "border-forest/15 bg-cream/45 text-forest hover:border-champagne hover:bg-cream"
      }`}
      onClick={onSelect}
      aria-pressed={selected}
      data-selector-option
    >
      {label}
    </button>
  );
}
