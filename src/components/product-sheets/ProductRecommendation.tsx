import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ExternalLink } from "lucide-react";
import {
  productSheetAmbienceLabels,
  productSheetCategoryLabels,
  productSheetIntensityLabels,
  type ProductSheet,
} from "../../data/productSheets";
import { trackEvent } from "../../lib/analytics";
import type { ProductSheetMatch } from "../../lib/productSheetRecommendation";

export function ProductRecommendation({
  matches,
  selectionKey,
}: {
  matches: ProductSheetMatch[];
  selectionKey: string;
}) {
  const [promotion, setPromotion] = useState<{
    selectionKey: string;
    slug: string;
  } | null>(null);
  const viewedSignatureRef = useRef("");
  const detailsRef = useRef<HTMLDivElement>(null);
  const promotedSheet =
    promotion?.selectionKey === selectionKey
      ? matches.find((match) => match.sheet.slug === promotion.slug)
      : undefined;
  const activeMatch = promotedSheet || matches[0];
  const alternatives = matches
    .filter((match) => match.sheet.slug !== activeMatch?.sheet.slug)
    .slice(0, 2);

  useEffect(() => {
    if (!activeMatch) return;
    const signature = `${selectionKey}:${activeMatch.sheet.slug}`;
    if (viewedSignatureRef.current === signature) return;
    viewedSignatureRef.current = signature;
    trackEvent("product_selector_result_viewed", {
      result_slug: activeMatch.sheet.slug,
      result_category: activeMatch.sheet.category,
      result_rank: activeMatch.rank + 1,
    });
  }, [activeMatch, selectionKey]);

  if (!activeMatch) return null;

  const selectAlternative = (match: ProductSheetMatch) => {
    setPromotion({ selectionKey, slug: match.sheet.slug });
  };

  return (
    <section
      className="product-recommendation mt-10 overflow-hidden rounded-xl border border-forest/10 bg-cream/70 p-5 shadow-soft sm:p-7 lg:p-10"
      aria-live="polite"
      aria-atomic="false"
      data-product-selector-results
      data-result-category={activeMatch.sheet.category}
      data-result-slug={activeMatch.sheet.slug}
    >
      <div className="mb-8 border-b border-forest/10 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
          {activeMatch.label}
        </p>
        <h3 className="mt-2 font-display text-4xl leading-tight text-forest sm:text-5xl">
          {activeMatch.sheet.name}
        </h3>
      </div>

      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
        <div className="product-result-stage mx-auto w-full max-w-[30rem]">
          <div className="relative flex flex-col items-center">
            <div className="order-2 mt-5 grid w-full grid-cols-2 gap-3 md:absolute md:inset-0 md:order-none md:mt-0 md:block md:pointer-events-none">
              {alternatives.map((match, index) => (
                <button
                  key={match.sheet.slug}
                  type="button"
                  className={`product-alternative-card product-alternative-card-${index + 1} min-h-11 overflow-hidden rounded-lg border border-forest/15 bg-ivory text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 md:absolute md:top-12 md:w-[44%] md:pointer-events-auto`}
                  onClick={() => selectAlternative(match)}
                  aria-label={`Afficher ${match.sheet.name} comme profil principal`}
                  data-selector-alternative={match.sheet.slug}
                >
                  <img
                    src={match.sheet.previewUrl}
                    alt=""
                    width={640}
                    height={888}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[111/154] w-full object-cover"
                  />
                  <span className="block border-t border-forest/10 px-3 py-3">
                    <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-champagne">
                      {match.label}
                    </span>
                    <span className="mt-1 block text-sm font-semibold text-forest">
                      {match.sheet.name}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <TiltProductCard
              key={`${selectionKey}:${activeMatch.sheet.slug}`}
              sheet={activeMatch.sheet}
              label={activeMatch.label}
              onOpenDetails={() => detailsRef.current?.focus({ preventScroll: true })}
            />
          </div>
        </div>

        <div
          ref={detailsRef}
          id="product-selector-result-details"
          className="min-w-0 outline-none"
          tabIndex={-1}
          data-selector-result-details
        >
          <p className="text-xs font-semibold uppercase tracking-[0.17em] text-champagne">
            {productSheetCategoryLabels[activeMatch.sheet.category]}
          </p>
          <h4 className="mt-2 font-display text-4xl leading-tight text-forest">
            {activeMatch.sheet.name}
          </h4>
          <p className="mt-3 text-base leading-7 text-ink/65">
            {activeMatch.sheet.aromas.join(" · ")}
          </p>

          <dl className="mt-7 grid gap-5 sm:grid-cols-2">
            <ResultDetail label="Intensité">
              {productSheetIntensityLabels[activeMatch.sheet.experience.intensity]}
            </ResultDetail>
            <ResultDetail label="Ambiance">
              {activeMatch.sheet.experience.ambiences
                .map((ambience) => productSheetAmbienceLabels[ambience])
                .join(" · ")}
            </ResultDetail>
          </dl>

          <p className="mt-7 border-l-2 border-champagne/70 pl-4 text-sm leading-7 text-ink/70">
            {activeMatch.sheet.experience.summary}
          </p>

          <a
            href={activeMatch.sheet.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-8 w-full sm:w-auto"
            aria-label={`Voir la fiche ${activeMatch.sheet.name} (PDF, nouvel onglet)`}
            onClick={() =>
              trackEvent("product_sheet_opened_from_selector", {
                product_slug: activeMatch.sheet.slug,
                product_category: activeMatch.sheet.category,
                result_rank: activeMatch.rank + 1,
              })
            }
            data-selector-pdf-link
          >
            Voir la fiche
            <ExternalLink aria-hidden="true" size={16} />
          </a>

          {alternatives.length > 0 && (
            <div className="mt-8 border-t border-forest/10 pt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-forest/55">
                Autres profils à découvrir
              </p>
              <p className="mt-2 text-sm leading-6 text-ink/55">
                Sélectionnez une carte du deck pour l’afficher au premier plan.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TiltProductCard({
  sheet,
  label,
  onOpenDetails,
}: {
  sheet: ProductSheet;
  label: ProductSheetMatch["label"];
  onOpenDetails: () => void;
}) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<number | null>(null);
  const pendingTiltRef = useRef({ rotateX: 0, rotateY: 0 });

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const applyTilt = () => {
    frameRef.current = null;
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--tilt-x", `${pendingTiltRef.current.rotateX.toFixed(2)}deg`);
    card.style.setProperty("--tilt-y", `${pendingTiltRef.current.rotateY.toFixed(2)}deg`);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (
      event.pointerType !== "mouse" ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / bounds.width - 0.5;
    const vertical = (event.clientY - bounds.top) / bounds.height - 0.5;
    pendingTiltRef.current = {
      rotateX: vertical * -6,
      rotateY: horizontal * 8,
    };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(applyTilt);
  };

  const resetTilt = () => {
    pendingTiltRef.current = { rotateX: 0, rotateY: 0 };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(applyTilt);
  };

  return (
    <button
      ref={cardRef}
      type="button"
      className="product-result-card relative z-10 order-1 w-full max-w-[21rem] overflow-hidden rounded-xl border border-champagne/35 bg-ivory text-left shadow-soft focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-4 focus:ring-offset-cream md:w-[68%]"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      onPointerCancel={resetTilt}
      onClick={onOpenDetails}
      aria-controls="product-selector-result-details"
      aria-label={`Afficher les détails de ${sheet.name}`}
      data-selector-primary-card
    >
      <img
        src={sheet.previewUrl}
        alt={`Fiche produit ${sheet.name} Verdanza`}
        width={640}
        height={888}
        loading="lazy"
        decoding="async"
        className="aspect-[111/154] w-full object-cover"
      />
      <span className="product-result-highlight pointer-events-none absolute inset-0" aria-hidden="true" />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-forest/95 via-forest/80 to-transparent px-5 pb-5 pt-16 text-ivory">
        <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-champagne">
          {label}
        </span>
        <span className="mt-1 block font-display text-3xl leading-tight">{sheet.name}</span>
      </span>
    </button>
  );
}

function ResultDetail({ label, children }: { label: string; children: string }) {
  return (
    <div className="rounded-lg border border-forest/10 bg-ivory p-4">
      <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-forest/55">
        {label}
      </dt>
      <dd className="mt-2 text-sm font-semibold leading-6 text-forest">{children}</dd>
    </div>
  );
}
