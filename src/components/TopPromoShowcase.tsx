import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Gift, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { PromoBanner } from "../types";
import { publicCodeForBanner, topPromoPresentation } from "../lib/publicPromotionBanners";

export function TopPromoShowcase({
  banners,
  onDismiss,
}: {
  banners: PromoBanner[];
  onDismiss: (banner: PromoBanner) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [copiedBannerId, setCopiedBannerId] = useState("");
  const copiedTimer = useRef<number>();
  const { primary, secondary, currentIndex, showNavigation } = topPromoPresentation(
    banners,
    activeIndex,
  );

  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (activeIndex >= banners.length) setActiveIndex(0);
  }, [activeIndex, banners.length]);

  if (!primary) return null;
  const primaryCode = publicCodeForBanner(primary);

  const move = (direction: number) => {
    setActiveIndex((index) => (index + direction + banners.length) % banners.length);
  };

  const copyCode = async (banner: PromoBanner) => {
    const code = publicCodeForBanner(banner);
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedBannerId(banner.id);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedBannerId(""), 1800);
  };

  return (
    <section
      className="border-b border-forest/10 bg-gradient-to-b from-[#fbf8f0] to-ivory py-2"
      aria-label="Offres du moment"
      data-testid="top-promo-showcase"
    >
      <div className="container-page">
        <div className="relative overflow-hidden rounded-2xl border border-forest/10 bg-[#fffdf8] shadow-[0_12px_35px_rgba(19,79,63,0.08)]">
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[38%] overflow-hidden sm:block" aria-hidden="true">
            <span className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-forest/10 blur-2xl" />
            <span className="absolute right-20 top-3 h-24 w-12 rotate-[28deg] rounded-[100%_0_100%_0] bg-sage/25" />
            <span className="absolute right-8 top-10 h-20 w-10 rotate-[58deg] rounded-[100%_0_100%_0] bg-forest/15" />
          </div>

          {primary.dismissible && (
            <div className="absolute right-1 top-1 z-10">
              <DismissButton banner={primary} onDismiss={onDismiss} />
            </div>
          )}

          <div className="relative grid min-w-0 gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5 sm:px-5 sm:py-2">
            <div className="min-w-0 pr-10 sm:pr-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-forest px-2.5 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-ivory">
                  <Gift size={13} aria-hidden="true" />
                  Offre du moment
                </span>
                {primary.promotionSummary?.applicationMode === "automatic" && (
                  <span className="min-w-0 break-words text-[0.6875rem] font-medium text-forest/75">Sans code</span>
                )}
              </div>
              <h2 className="mt-1.5 max-w-3xl font-display text-[clamp(1.2rem,5.6vw,1.5rem)] leading-[1.08] text-forest [text-wrap:balance] sm:text-[28px]">
                {formatPromoTitle(primary.title)}
              </h2>
              <p className="sr-only max-w-3xl text-xs leading-5 text-ink/70 sm:not-sr-only sm:mt-1 sm:text-sm">
                {primary.message}
              </p>
              <GiftTierRail banner={primary} />
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2 pr-10 sm:justify-end sm:self-end">
              {primaryCode && (
                <>
                  <code className="rounded-md border border-forest/15 bg-ivory px-2 py-1.5 text-xs font-semibold tracking-wide text-forest">
                    {primaryCode}
                  </code>
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 text-xs font-semibold underline decoration-champagne underline-offset-2 hover:bg-forest/5"
                    aria-label={`Copier le code ${primaryCode}`}
                    onClick={() => void copyCode(primary)}
                  >
                    <Copy size={13} aria-hidden="true" />
                    {copiedBannerId === primary.id ? "Copié" : "Copier"}
                  </button>
                  <span className="sr-only" role="status" aria-live="polite">
                    {copiedBannerId === primary.id ? `Code ${primaryCode} copié` : ""}
                  </span>
                </>
              )}
              {primary.buttonLabel && primary.buttonUrl && (
                <BannerLink url={primary.buttonUrl} label={primary.buttonLabel} primary />
              )}
              {showNavigation && (
                <div className="flex items-center gap-1" aria-label="Parcourir les offres">
                  <button
                    type="button"
                    className="grid h-9 w-9 place-items-center rounded-full border border-forest/15 bg-ivory/90 text-forest transition hover:bg-forest hover:text-ivory motion-reduce:transition-none"
                    aria-label="Offre précédente"
                    onClick={() => move(-1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <button
                    type="button"
                    className="grid h-9 w-9 place-items-center rounded-full border border-forest/15 bg-ivory/90 text-forest transition hover:bg-forest hover:text-ivory motion-reduce:transition-none"
                    aria-label="Offre suivante"
                    onClick={() => move(1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {secondary && (
            <SecondaryPromoRail
              banner={secondary}
              copied={copiedBannerId === secondary.id}
              onCopy={() => void copyCode(secondary)}
              onDismiss={onDismiss}
            />
          )}

          {showNavigation && (
            <div className="absolute bottom-1.5 right-3 flex gap-1" aria-label="Position dans les offres">
              {banners.map((banner, index) => (
                <button
                  key={banner.id}
                  type="button"
                  className={`h-1.5 rounded-full transition-all motion-reduce:transition-none ${
                    index === currentIndex ? "w-5 bg-forest" : "w-1.5 bg-forest/25"
                  }`}
                  aria-label={`Afficher l'offre ${index + 1}`}
                  aria-current={index === currentIndex ? "true" : undefined}
                  onClick={() => setActiveIndex(index)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function GiftTierRail({ banner }: { banner: PromoBanner }) {
  const tiers = banner.promotionSummary?.giftTiers || [];
  if (!tiers.length) return null;

  return (
    <div
      className="mt-2 grid min-w-0 max-w-2xl grid-cols-1 gap-1.5 min-[350px]:grid-cols-3"
      aria-label="Paliers de l'offre"
      role="group"
      data-testid="gift-tier-grid"
    >
      {tiers.map((tier) => (
        <div
          key={tier.id}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-forest/10 bg-ivory/75 px-2 py-1.5 text-forest min-[350px]:grid-cols-1 min-[350px]:justify-items-center min-[350px]:gap-0.5 min-[350px]:px-1.5 min-[350px]:text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:justify-items-stretch sm:gap-2 sm:px-2 sm:text-left"
          data-testid="gift-tier"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-champagne/25 text-[11px]" aria-hidden="true">
            <Gift size={13} />
          </span>
          <span className="min-w-0 max-w-full break-words text-[0.6875rem] leading-4">
            <span className="block">{formatEuro(tier.minimumSubtotal)}</span>
            <strong className="block text-xs leading-4">{tier.quantityGrams} g offert{tier.quantityGrams > 1 ? "s" : ""}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}

function SecondaryPromoRail({
  banner,
  copied,
  onCopy,
  onDismiss,
}: {
  banner: PromoBanner;
  copied: boolean;
  onCopy: () => void;
  onDismiss: (banner: PromoBanner) => void;
}) {
  const code = publicCodeForBanner(banner);
  return (
    <aside
      className="relative flex min-h-10 flex-nowrap items-center gap-x-2 overflow-x-auto border-t border-forest/10 bg-cream/75 px-3 py-2 pr-11 text-xs text-forest [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:px-5"
      data-testid="secondary-promo-rail"
    >
      <strong>{banner.title}</strong>
      <span className="hidden text-forest/30 sm:inline" aria-hidden="true">·</span>
      <span className="hidden min-w-0 text-ink/65 sm:inline">{banner.message}</span>
      {code && (
        <>
          <code className="rounded-md border border-forest/15 bg-ivory px-2 py-1 font-sans font-semibold tracking-wide text-forest">{code}</code>
          <button
            type="button"
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 font-semibold underline decoration-champagne underline-offset-2 hover:bg-forest/5"
            aria-label={`Copier le code ${code}`}
            onClick={onCopy}
          >
            <Copy size={13} aria-hidden="true" />
            {copied ? "Copié" : "Copier"}
          </button>
          <span className="sr-only" role="status" aria-live="polite">
            {copied ? `Code ${code} copié` : ""}
          </span>
        </>
      )}
      {banner.buttonLabel && banner.buttonUrl && (
        <BannerLink url={banner.buttonUrl} label={banner.buttonLabel} />
      )}
      {banner.dismissible && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <DismissButton banner={banner} onDismiss={onDismiss} />
        </div>
      )}
    </aside>
  );
}

function BannerLink({
  url,
  label,
  primary = false,
}: {
  url: string;
  label: string;
  primary?: boolean;
}) {
  const className = primary
    ? "inline-flex min-h-11 w-full min-w-0 max-w-full items-center justify-center rounded-lg bg-forest px-3 py-2 text-center text-xs font-semibold text-ivory shadow-sm transition hover:bg-forest/90 motion-reduce:transition-none sm:min-h-9 sm:w-auto sm:px-4 sm:text-sm"
    : "font-semibold underline decoration-champagne underline-offset-2";
  if (url.startsWith("/")) return <Link to={url} className={className}>{label}</Link>;
  return <a href={url} className={className}>{label}</a>;
}

function DismissButton({
  banner,
  onDismiss,
}: {
  banner: PromoBanner;
  onDismiss: (banner: PromoBanner) => void;
}) {
  return (
    <button
      type="button"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-transparent text-forest/65 transition hover:border-forest/10 hover:bg-ivory hover:text-forest focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 motion-reduce:transition-none"
      aria-label={`Fermer la promotion ${banner.title}`}
      onClick={() => onDismiss(banner)}
    >
      <X size={16} aria-hidden="true" />
    </button>
  );
}

function formatEuro(value: number) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value)} €`;
}

function formatPromoTitle(title: string) {
  return title.replace(/week-end/gi, (value) => value.replace("-", "‑"));
}
