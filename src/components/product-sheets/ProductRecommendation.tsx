import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ExternalLink } from "lucide-react";
import {
  productSheetCategoryLabels,
  productSheetIntensityLabels,
  type ProductSheet,
} from "../../data/productSheets";
import { trackEvent } from "../../lib/analytics";
import type { ProductSheetMatch } from "../../lib/productSheetRecommendation";

export function ProductRecommendation({ matches, selectionKey }: { matches: ProductSheetMatch[]; selectionKey: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const viewedSignatureRef = useRef("");
  const frameRef = useRef<number | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const activeMatch = matches[activeIndex] || matches[0];

  useEffect(() => {
    setActiveIndex(0);
    carouselRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [selectionKey]);

  useEffect(() => {
    if (!activeMatch) return;
    const signature = `${selectionKey}:${activeMatch.sheet.slug}`;
    if (viewedSignatureRef.current === signature) return;
    viewedSignatureRef.current = signature;
    trackEvent("product_selector_result_viewed", {
      result_slug: activeMatch.sheet.slug,
      result_category: activeMatch.sheet.selectionProfile.category,
      result_rank: activeMatch.rank + 1,
    });
  }, [activeMatch, selectionKey]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  if (!activeMatch) return null;

  const updateActiveIndex = () => {
    frameRef.current = null;
    const carousel = carouselRef.current;
    if (!carousel) return;
    const cards = [...carousel.querySelectorAll<HTMLElement>("[data-selector-result-card]")];
    const center = carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
    const nearest = cards.reduce(
      (best, card, index) => {
        const rect = card.getBoundingClientRect();
        const distance = Math.abs(rect.left + rect.width / 2 - center);
        return distance < best.distance ? { index, distance } : best;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    ).index;
    setActiveIndex(nearest);
  };

  const handleScroll = () => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(updateActiveIndex);
  };

  const selectCard = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, matches.length - 1));
    if (nextIndex === activeIndex) {
      detailsRef.current?.focus({ preventScroll: true });
      return;
    }
    setActiveIndex(nextIndex);
    const cards = carouselRef.current?.querySelectorAll<HTMLElement>("[data-selector-result-card]");
    cards?.[nextIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  return (
    <section
      className="product-recommendation mt-6 overflow-hidden rounded-xl border border-forest/10 bg-cream/65 py-5 shadow-soft sm:mt-8 sm:py-7 lg:py-9"
      aria-live="polite"
      aria-atomic="false"
      data-product-selector-results
      data-result-category={activeMatch.sheet.selectionProfile.category}
      data-result-intensity={activeMatch.sheet.selectionProfile.intensity}
      data-result-slug={activeMatch.sheet.slug}
    >
      <div className="mx-4 flex items-end justify-between gap-4 border-b border-forest/10 pb-4 sm:mx-7 lg:mx-9">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne">Produits correspondants</p>
          <h3 className="mt-1 font-display text-3xl leading-tight text-forest sm:text-4xl">
            {matches.length} {matches.length > 1 ? "fiches" : "fiche"}
          </h3>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-forest/55" data-result-position>
          {activeIndex + 1} / {matches.length}
        </span>
      </div>

      <div className="mt-5 grid items-center gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)] lg:gap-10 lg:px-9">
        <div className="product-result-stage min-w-0">
          <div
            ref={carouselRef}
            className="product-result-carousel"
            role="region"
            aria-roledescription="carrousel"
            aria-label="Produits correspondant à votre sélection"
            tabIndex={0}
            onScroll={handleScroll}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              selectCard(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
            }}
            data-result-carousel
          >
            {matches.map((match, index) => (
              <TiltProductCard key={`${selectionKey}:${match.sheet.slug}`} sheet={match.sheet} active={index === activeIndex} onSelect={() => selectCard(index)} />
            ))}
          </div>
        </div>

        <div ref={detailsRef} id="product-selector-result-details" className="mx-4 min-w-0 rounded-xl border border-forest/10 bg-ivory p-5 outline-none shadow-sm sm:mx-7 sm:p-6 lg:mx-0" tabIndex={-1} data-selector-result-details>
          <p className="text-xs font-semibold uppercase tracking-[0.17em] text-champagne">{productSheetCategoryLabels[activeMatch.sheet.selectionProfile.category]}</p>
          <h4 className="mt-1 font-display text-3xl leading-tight text-forest sm:text-4xl">{activeMatch.sheet.name}</h4>
          <p className="mt-2 text-sm leading-6 text-ink/60 sm:text-base">{activeMatch.sheet.aromas.join(" · ")}</p>
          <dl className="mt-5">
            <div className="flex items-center justify-between gap-4 border-y border-forest/10 py-3">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-forest/55">Intensité</dt>
              <dd className="rounded-full border border-champagne/40 bg-cream px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-forest">
                {productSheetIntensityLabels[activeMatch.sheet.selectionProfile.intensity]}
              </dd>
            </div>
          </dl>
          <a
            href={activeMatch.sheet.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-5 w-[calc(100%-3rem)] sm:w-auto"
            aria-label={`Voir la fiche ${activeMatch.sheet.name} (PDF, nouvel onglet)`}
            onClick={() => trackEvent("product_sheet_opened_from_selector", { product_slug: activeMatch.sheet.slug, product_category: activeMatch.sheet.selectionProfile.category, result_rank: activeMatch.rank + 1 })}
            data-selector-pdf-link
          >
            Voir la fiche
            <ExternalLink aria-hidden="true" size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}

function TiltProductCard({ sheet, active, onSelect }: { sheet: ProductSheet; active: boolean; onSelect: () => void }) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<number | null>(null);
  const pendingTiltRef = useRef({ rotateX: 0, rotateY: 0 });

  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); }, []);

  const applyTilt = () => {
    frameRef.current = null;
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--tilt-x", `${pendingTiltRef.current.rotateX.toFixed(2)}deg`);
    card.style.setProperty("--tilt-y", `${pendingTiltRef.current.rotateY.toFixed(2)}deg`);
    card.classList.add("is-tilting");
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!active || event.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pendingTiltRef.current = {
      rotateX: ((event.clientY - bounds.top) / bounds.height - 0.5) * -5,
      rotateY: ((event.clientX - bounds.left) / bounds.width - 0.5) * 7,
    };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(applyTilt);
  };

  const resetTilt = () => {
    pendingTiltRef.current = { rotateX: 0, rotateY: 0 };
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const card = cardRef.current;
    card?.classList.remove("is-tilting");
    card?.style.removeProperty("--tilt-x");
    card?.style.removeProperty("--tilt-y");
  };

  return (
    <button
      ref={cardRef}
      type="button"
      className={`product-result-card relative shrink-0 overflow-hidden rounded-xl border bg-ivory text-left focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-4 focus:ring-offset-cream ${active ? "is-active border-champagne/45" : "border-forest/10"}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      onPointerCancel={resetTilt}
      onClick={onSelect}
      aria-controls="product-selector-result-details"
      aria-pressed={active}
      aria-label={`${active ? "Afficher les détails de" : "Mettre au premier plan"} ${sheet.name}`}
      data-selector-result-card={sheet.slug}
      data-selector-primary-card={active ? "true" : undefined}
    >
      <img src={sheet.previewUrl} alt={`Fiche produit ${sheet.name} Verdanza`} width={640} height={888} loading="lazy" decoding="async" className="aspect-[111/154] w-full object-cover" />
      <span className="product-result-highlight pointer-events-none absolute inset-0" aria-hidden="true" />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-forest/95 via-forest/75 to-transparent px-4 pb-4 pt-14 text-ivory">
        <span className="block font-display text-2xl leading-tight sm:text-3xl">{sheet.name}</span>
      </span>
    </button>
  );
}
