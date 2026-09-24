import { ArrowRight, ChevronLeft, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { trackEvent } from "../../lib/analytics";
import {
  createInitialProductDiscoveryCriteria,
  createProductDiscoveryPath,
  filterProductsByDiscoveryCriteria,
  getAvailableProductAromaFamilies,
  getAvailableProductIntensities,
  reconcileProductDiscoveryCriteria,
  type ProductDiscoveryCriteria,
} from "../../lib/productDiscovery";
import {
  productAromaFamilyLabels,
  productIntensityLabels,
  productIntensityLevels,
  type ProductAromaFamily,
  type ProductIntensity,
} from "../../lib/productTaxonomy";
import type { Product } from "../../types";

type HomeProductFinderStep = "type" | "intensity" | "aroma" | "result";

const categoryLabels = {
  flowers: "Fleurs",
  resins: "Résines",
} as const;

const stepLabels: Record<HomeProductFinderStep, string> = {
  type: "Étape 1 sur 3",
  intensity: "Étape 2 sur 3",
  aroma: "Étape 3 sur 3",
  result: "Votre sélection",
};

const stepTitles: Record<HomeProductFinderStep, string> = {
  type: "Quel produit vous correspond ?",
  intensity: "Quelle intensité recherchez-vous ?",
  aroma: "Une préférence aromatique ?",
  result: "Votre sélection",
};

const stepProgress: Record<HomeProductFinderStep, number> = {
  type: 1,
  intensity: 2,
  aroma: 3,
  result: 3,
};

export function HomeProductFinder({ products }: { products: Product[] }) {
  const [criteria, setCriteria] = useState(createInitialProductDiscoveryCriteria);
  const [step, setStep] = useState<HomeProductFinderStep>("type");
  const startedRef = useRef(false);
  const previousStepRef = useRef<HomeProductFinderStep>(step);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const matches = useMemo(
    () => filterProductsByDiscoveryCriteria(products, criteria),
    [criteria, products],
  );
  const availableIntensities = useMemo(
    () =>
      criteria.category === "all"
        ? []
        : Array.from(getAvailableProductIntensities(products, criteria.category)),
    [criteria.category, products],
  );
  const availableAromas = useMemo(
    () =>
      criteria.category === "all" || !criteria.intensity
        ? []
        : Array.from(
            getAvailableProductAromaFamilies(products, {
              category: criteria.category,
              intensity: criteria.intensity,
            }),
          ),
    [criteria.category, criteria.intensity, products],
  );
  const destination = `${createProductDiscoveryPath(criteria)}#produits`;

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    questionRef.current?.focus({ preventScroll: true });
  }, [step]);

  const markStarted = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent("home_product_finder_start");
  };

  const selectCategory = (category: "flowers" | "resins") => {
    markStarted();
    setCriteria((current) =>
      reconcileProductDiscoveryCriteria(products, { ...current, category }),
    );
    setStep("intensity");
    trackEvent("home_product_finder_type", { product_type: category });
  };

  const selectIntensity = (intensity: ProductIntensity) => {
    setCriteria((current) =>
      reconcileProductDiscoveryCriteria(products, { ...current, intensity }),
    );
    setStep("aroma");
    trackEvent("home_product_finder_intensity", { intensity });
  };

  const selectAroma = (aroma: ProductAromaFamily | null) => {
    const nextCriteria: ProductDiscoveryCriteria = {
      ...criteria,
      aromas: aroma ? [aroma] : [],
    };
    const resultCount = filterProductsByDiscoveryCriteria(products, nextCriteria).length;
    setCriteria(nextCriteria);
    setStep("result");
    trackEvent("home_product_finder_aroma", { aroma: aroma ?? "any" });
    trackEvent("home_product_finder_result", { result_count: resultCount });
  };

  const reset = () => {
    setCriteria(createInitialProductDiscoveryCriteria());
    setStep("type");
    startedRef.current = false;
  };

  const summary = [
    criteria.category === "all" ? null : categoryLabels[criteria.category],
    criteria.intensity ? productIntensityLabels[criteria.intensity] : null,
    criteria.aromas[0] ? productAromaFamilyLabels[criteria.aromas[0]] : "Peu importe",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className="container-page relative z-10 -mt-10 sm:-mt-12"
      aria-labelledby="home-product-finder-title"
      data-home-product-finder
    >
      <div
        className={`home-product-finder relative isolate overflow-hidden rounded-[1rem] border border-champagne/25 px-4 shadow-[0_24px_70px_rgba(11,61,46,0.065)] sm:px-7 lg:px-10 ${
          step === "result" ? "py-5 sm:py-6" : "py-6 sm:py-8"
        }`}
      >
        <div className="relative z-10 mx-auto max-w-4xl">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-champagne">
              {step === "result" ? "Votre sélection" : "Trouvez votre profil"}
            </p>
            <div
              className="flex items-center gap-1.5"
              aria-label={stepLabels[step]}
              data-home-finder-progress
            >
              {[1, 2, 3].map((marker) => (
                <span
                  key={marker}
                  className={`h-1.5 w-6 rounded-full transition-colors duration-200 motion-reduce:transition-none ${
                    marker <= stepProgress[step] ? "bg-champagne" : "bg-forest/12"
                  }`}
                  aria-hidden="true"
                  data-progress-marker={marker}
                />
              ))}
              <span className="sr-only">{stepLabels[step]}</span>
            </div>
          </div>

          <div key={step} className="home-product-finder__step mt-3" data-finder-step={step}>
            <h2
              ref={questionRef}
              id="home-product-finder-title"
              tabIndex={-1}
              className={
                step === "result"
                  ? "sr-only"
                  : "font-display text-3xl leading-tight text-forest outline-none sm:text-4xl"
              }
            >
              {stepTitles[step]}
            </h2>

            {step === "type" ? (
              <div className="mt-6 grid grid-cols-2 gap-3">
                {(["flowers", "resins"] as const).map((category) => (
                  <FinderChoice
                    key={category}
                    selected={criteria.category === category}
                    onClick={() => selectCategory(category)}
                    dataValue={`type:${category}`}
                  >
                    {categoryLabels[category]}
                  </FinderChoice>
                ))}
              </div>
            ) : null}

            {step === "intensity" ? (
              <>
                <div className="mt-6 grid grid-cols-1 gap-3 min-[360px]:grid-cols-3">
                  {availableIntensities.map((intensity) => (
                    <FinderChoice
                      key={intensity}
                      selected={criteria.intensity === intensity}
                      onClick={() => selectIntensity(intensity)}
                      dataValue={`intensity:${intensity}`}
                    >
                      <span>{productIntensityLabels[intensity]}</span>
                      <span className="flex gap-1" aria-hidden="true">
                        {[1, 2, 3].map((level) => (
                          <span
                            key={level}
                            className={`h-2 w-2 rounded-full border border-champagne ${
                              level <= productIntensityLevels[intensity]
                                ? "bg-champagne"
                                : "bg-transparent"
                            }`}
                          />
                        ))}
                      </span>
                    </FinderChoice>
                  ))}
                </div>
                <FinderBack onClick={() => setStep("type")} />
              </>
            ) : null}

            {step === "aroma" ? (
              <>
                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <FinderChoice
                    selected={criteria.aromas.length === 0}
                    onClick={() => selectAroma(null)}
                    dataValue="aroma:any"
                  >
                    Peu importe
                  </FinderChoice>
                  {availableAromas.map((aroma) => (
                    <FinderChoice
                      key={aroma}
                      selected={criteria.aromas.includes(aroma)}
                      onClick={() => selectAroma(aroma)}
                      dataValue={`aroma:${aroma}`}
                    >
                      {productAromaFamilyLabels[aroma]}
                    </FinderChoice>
                  ))}
                </div>
                <FinderBack onClick={() => setStep("intensity")} />
              </>
            ) : null}

            {step === "result" ? (
              <div className="mt-3" data-home-finder-result>
                <p
                  className="text-sm font-semibold uppercase tracking-[0.12em] text-champagne"
                  aria-live="polite"
                  data-home-finder-result-count
                >
                  {matches.length} {matches.length === 1 ? "produit correspond" : "produits correspondent"}
                </p>
                <p className="mt-2 font-display text-2xl text-forest sm:text-3xl">
                  {summary}
                </p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Link
                    to={destination}
                    className="btn-primary min-h-12 sm:min-w-56"
                    onClick={() =>
                      trackEvent("home_product_finder_open_shop", {
                        destination_path: destination,
                        result_count: matches.length,
                      })
                    }
                    data-home-finder-open-shop
                  >
                    Découvrir ma sélection <ArrowRight aria-hidden="true" size={17} />
                  </Link>
                  <button
                    type="button"
                    className="min-h-11 rounded-md px-3 text-sm font-semibold text-forest underline decoration-champagne underline-offset-4 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
                    onClick={() => setStep("type")}
                    data-home-finder-edit
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-forest/60 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
                    onClick={reset}
                    data-home-finder-reset
                  >
                    <RotateCcw aria-hidden="true" size={14} /> Réinitialiser
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinderChoice({
  selected,
  onClick,
  dataValue,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  dataValue: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`home-product-finder__choice flex min-h-14 items-center justify-center gap-3 rounded-lg border px-3 py-3 text-sm font-semibold uppercase tracking-[0.08em] focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${
        selected
          ? "border-forest bg-forest text-ivory shadow-[0_8px_22px_rgba(11,61,46,0.12)]"
          : "border-champagne/45 bg-ivory/70 text-forest hover:border-champagne hover:bg-cream/75"
      }`}
      onClick={onClick}
      aria-pressed={selected}
      data-home-finder-option={dataValue}
    >
      {children}
    </button>
  );
}

function FinderBack({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="mt-4 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-forest/60 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
      onClick={onClick}
      data-home-finder-back
    >
      <ChevronLeft aria-hidden="true" size={16} /> Retour
    </button>
  );
}
