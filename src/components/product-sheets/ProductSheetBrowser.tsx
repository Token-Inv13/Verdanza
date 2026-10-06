import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import {
  availableProductSheets,
  productSheetIntensityLabels,
  type ProductSheet,
  type ProductSheetCategory,
} from "../../data/productSheets";
import { trackEvent } from "../../lib/analytics";

const categoryOptions: Array<{ category: ProductSheetCategory; label: string }> = [
  { category: "flower", label: "Fleurs" },
  { category: "resin", label: "Résines" },
];

export function ProductSheetBrowser({ library = availableProductSheets }: { library?: ProductSheet[] }) {
  const [category, setCategory] = useState<ProductSheetCategory>("flower");
  const [activeIndex, setActiveIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const navigationTimeoutRef = useRef<number | null>(null);
  const navigationTargetRef = useRef<number | null>(null);
  const lastTrackedIndexRef = useRef(0);
  const sheets = useMemo(
    () => library.filter((sheet) => sheet.selectionProfile.category === category),
    [category, library],
  );

  useEffect(() => {
    navigationTargetRef.current = null;
    if (navigationTimeoutRef.current !== null) {
      window.clearTimeout(navigationTimeoutRef.current);
      navigationTimeoutRef.current = null;
    }
    setActiveIndex(0);
    lastTrackedIndexRef.current = 0;
    carouselRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [category]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (navigationTimeoutRef.current !== null) window.clearTimeout(navigationTimeoutRef.current);
    },
    [],
  );

  const selectCategory = (nextCategory: ProductSheetCategory) => {
    if (nextCategory === category) return;
    setCategory(nextCategory);
    trackEvent("product_sheet_category_selected", { product_category: nextCategory });
  };

  const updateActiveIndex = () => {
    frameRef.current = null;
    const carousel = carouselRef.current;
    if (!carousel) return;
    const cards = [...carousel.querySelectorAll<HTMLElement>("[data-product-sheet-card]")];
    const center = carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
    const nearest = cards.reduce(
      (best, card, index) => {
        const rect = card.getBoundingClientRect();
        const distance = Math.abs(rect.left + rect.width / 2 - center);
        return distance < best.distance ? { index, distance } : best;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    ).index;
    if (navigationTargetRef.current !== null && nearest !== navigationTargetRef.current) return;
    setActiveIndex(nearest);
    if (lastTrackedIndexRef.current !== nearest) {
      lastTrackedIndexRef.current = nearest;
      trackEvent("product_sheet_carousel_navigated", {
        product_category: category,
        product_position: nearest + 1,
      });
    }
  };

  const handleScroll = () => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(updateActiveIndex);
  };

  const goTo = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, sheets.length - 1));
    const card = carouselRef.current?.querySelectorAll<HTMLElement>("[data-product-sheet-card]")[nextIndex];
    navigationTargetRef.current = nextIndex;
    if (navigationTimeoutRef.current !== null) window.clearTimeout(navigationTimeoutRef.current);
    navigationTimeoutRef.current = window.setTimeout(() => {
      navigationTargetRef.current = null;
      navigationTimeoutRef.current = null;
    }, 450);
    setActiveIndex(nextIndex);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  return (
    <div className="pt-6 sm:pt-8" data-product-sheet-browser>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          className="inline-grid min-h-12 grid-cols-2 rounded-lg border border-forest/10 bg-cream p-1 shadow-sm"
          role="tablist"
          aria-label="Catégories de fiches produits"
          data-product-sheet-tabs
        >
          {categoryOptions.map((option) => (
            <button
              key={option.category}
              type="button"
              role="tab"
              id={`product-sheet-tab-${option.category}`}
              aria-selected={category === option.category}
              aria-controls="product-sheet-category-panel"
              className={`min-h-11 min-w-[7.5rem] rounded-md px-4 text-sm font-semibold uppercase tracking-[0.1em] transition duration-200 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${
                category === option.category
                  ? "bg-forest text-ivory shadow-sm"
                  : "text-forest hover:bg-ivory"
              }`}
              onClick={() => selectCategory(option.category)}
              data-product-sheet-tab={option.category}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex min-h-11 items-center gap-2 text-sm text-forest/60" aria-live="polite">
          <span className="min-w-12 text-center font-semibold tabular-nums" data-product-sheet-position>
            {activeIndex + 1} / {sheets.length}
          </span>
          <div className="hidden gap-2 lg:flex">
            <button
              type="button"
              className="icon-button"
              aria-label={`Fiche précédente parmi les ${category === "flower" ? "fleurs" : "résines"}`}
              disabled={activeIndex === 0}
              onClick={() => goTo(activeIndex - 1)}
              data-carousel-previous
            >
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Fiche suivante parmi les ${category === "flower" ? "fleurs" : "résines"}`}
              disabled={activeIndex === sheets.length - 1}
              onClick={() => goTo(activeIndex + 1)}
              data-carousel-next
            >
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
      </div>

      <div
        id="product-sheet-category-panel"
        role="tabpanel"
        aria-labelledby={`product-sheet-tab-${category}`}
        className="product-category-panel mt-5 sm:mt-7"
        key={category}
        data-product-sheet-category={category}
      >
        <div
          ref={carouselRef}
          className="product-sheet-carousel"
          role="region"
          aria-roledescription="carrousel"
          aria-label={`Fiches ${category === "flower" ? "Fleurs" : "Résines"}`}
          tabIndex={0}
          onScroll={handleScroll}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              goTo(activeIndex - 1);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              goTo(activeIndex + 1);
            }
          }}
          data-product-sheet-carousel
        >
          {sheets.map((sheet, index) => (
            <ProductSheetCard
              key={sheet.slug}
              sheet={sheet}
              active={index === activeIndex}
              position={index + 1}
              total={sheets.length}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function TemporarilyUnavailableProductSheets({
  library,
}: {
  library: ProductSheet[];
}) {
  if (library.length === 0) return null;

  return (
    <details
      className="group mt-10 rounded-xl border border-forest/10 bg-cream/45 shadow-sm sm:mt-12"
      data-unavailable-product-sheets
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4 py-3 text-forest focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 sm:px-6 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-champagne">
            Archives accessibles
          </span>
          <span className="mt-1 block font-display text-2xl leading-tight">
            Fiches temporairement indisponibles
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="shrink-0 transition-transform duration-200 group-open:rotate-180" size={20} />
      </summary>

      <div className="border-t border-forest/10 px-4 py-5 sm:px-6 sm:py-6">
        <p className="max-w-3xl text-sm leading-6 text-ink/60">
          Ces références ne sont pas proposées dans la boutique actuellement. Leurs fiches restent conservées ici à titre documentaire.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {library.map((sheet) => (
            <article
              key={sheet.slug}
              className="rounded-lg border border-forest/10 bg-ivory p-4"
              data-unavailable-product-sheet={sheet.slug}
            >
              <div className="flex items-start gap-3">
                <img
                  src={sheet.previewUrl}
                  alt=""
                  width={96}
                  height={133}
                  loading="lazy"
                  decoding="async"
                  className="h-[6.9rem] w-20 shrink-0 rounded-md border border-forest/10 bg-cream object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-forest/50">
                    Temporairement indisponible
                  </p>
                  <h3 className="mt-1 font-display text-xl leading-tight text-forest">{sheet.name}</h3>
                  <p className="mt-1 text-xs leading-5 text-ink/55">{sheet.aromas.join(" · ")}</p>
                  <p className="mt-2 text-xs font-semibold text-forest">
                    Intensité {productSheetIntensityLabels[sheet.selectionProfile.intensity]}
                  </p>
                </div>
              </div>
              <a
                href={sheet.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-forest/15 px-3 py-2 text-sm font-semibold text-forest transition hover:bg-cream focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
                aria-label={`Consulter la fiche archivée ${sheet.name} (PDF, nouvel onglet)`}
              >
                Consulter la fiche
                <ExternalLink aria-hidden="true" size={14} />
              </a>
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}

function ProductSheetCard({
  sheet,
  active,
  position,
  total,
}: {
  sheet: ProductSheet;
  active: boolean;
  position: number;
  total: number;
}) {
  return (
    <article
      className={`product-sheet-card-v2 group min-w-0 overflow-hidden rounded-xl border bg-ivory ${active ? "is-active border-champagne/45" : "border-forest/10"}`}
      data-product-sheet-card={sheet.slug}
      data-active={active ? "true" : "false"}
      aria-label={`${sheet.name}, fiche ${position} sur ${total}`}
    >
      <div className="bg-cream/80 p-2.5 sm:p-3">
        <div className="mx-auto aspect-[111/154] w-full overflow-hidden rounded-lg border border-forest/10 bg-ivory shadow-sm">
          <img
            src={sheet.previewUrl}
            alt={`Fiche produit ${sheet.name} Verdanza`}
            width={640}
            height={888}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <h3 className="font-display text-2xl leading-tight text-forest sm:text-3xl">{sheet.name}</h3>
        <p className="mt-1.5 min-h-10 text-sm leading-5 text-ink/60">{sheet.aromas.join(" · ")}</p>

        <div className="mt-4 flex flex-col items-start gap-3 border-t border-forest/10 pt-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-forest/50">
              Intensité
            </p>
            <p className="mt-1 text-sm font-semibold text-forest">
              {productSheetIntensityLabels[sheet.selectionProfile.intensity]}
            </p>
          </div>
          <a
            href={sheet.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-forest px-4 py-2 text-sm font-semibold text-ivory transition duration-200 hover:bg-[#082f24] focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
            aria-label={`Voir la fiche ${sheet.name} (PDF, nouvel onglet)`}
            onClick={() =>
              trackEvent("product_sheet_card_opened", {
                product_slug: sheet.slug,
                product_category: sheet.selectionProfile.category,
              })
            }
          >
            Voir la fiche
            <ExternalLink aria-hidden="true" size={15} />
          </a>
        </div>
      </div>
    </article>
  );
}
