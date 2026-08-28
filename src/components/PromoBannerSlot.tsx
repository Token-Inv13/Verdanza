import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  getPublicPromoBanners,
  promoBannerMatchesPlacement,
} from "../services/promoBannersService";
import type {
  PromoBanner,
  PromoBannerPlacement,
  PromoBannerType,
  PromoBannerVariant,
} from "../types";
import { TopPromoShowcase } from "./TopPromoShowcase";

type PromoBannersState = { banners: PromoBanner[]; loaded: boolean };

const PromoBannersContext = createContext<PromoBannersState>({ banners: [], loaded: false });

export function PromoBannersProvider({ children }: { children: ReactNode }) {
  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getPublicPromoBanners().then((nextBanners) => {
      if (!isMounted) return;
      setBanners(nextBanners);
      setLoaded(true);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <PromoBannersContext.Provider value={{ banners, loaded }}>
      {children}
    </PromoBannersContext.Provider>
  );
}

export function PromoBannerSlot({
  placement,
  type,
  className = "",
}: {
  placement?: PromoBannerPlacement;
  type?: PromoBannerType;
  className?: string;
}) {
  const { banners, loaded } = useContext(PromoBannersContext);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const location = useLocation();
  const currentPlacement = placement || placementFromPath(location.pathname);
  const visibleBanners = useMemo(
    () =>
      banners
        .filter((banner) => promoBannerMatchesPlacement(banner, currentPlacement))
        .filter((banner) => (type ? banner.type === type : true))
        .filter((banner) => !dismissedIds.has(banner.id))
        .filter((banner) => !isBannerDismissed(banner))
        .sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0)),
    [banners, currentPlacement, dismissedIds, type],
  );

  const dismissBanner = (banner: PromoBanner) => {
    window.localStorage.setItem(dismissStorageKey(banner.id), "true");
    setDismissedIds((current) => new Set(current).add(banner.id));
  };

  if (type === "top_bar" && !loaded) {
    return (
      <div className="border-b border-forest/10 bg-ivory py-2 sm:py-3" aria-hidden="true">
        <div className="container-page">
          <div className="h-[176px] animate-pulse rounded-2xl bg-forest/5 motion-reduce:animate-none sm:h-[184px]" />
        </div>
      </div>
    );
  }

  if (!visibleBanners.length) return null;

  if (type === "top_bar") {
    return (
      <div className={className}>
        <TopPromoShowcase banners={visibleBanners} onDismiss={dismissBanner} />
      </div>
    );
  }

  return (
    <div className={className}>
      {visibleBanners.map((banner) => (
        <PublicPromoBanner key={banner.id} banner={banner} onDismiss={dismissBanner} />
      ))}
    </div>
  );
}

function PublicPromoBanner({
  banner,
  onDismiss,
}: {
  banner: PromoBanner;
  onDismiss: (banner: PromoBanner) => void;
}) {
  const showOfferBadge = banner.variant === "promo";
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {showOfferBadge && (
            <span className="rounded-full border border-champagne/40 bg-ivory/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-forest">
              Offre
            </span>
          )}
          <strong className="block text-sm font-semibold text-forest">{banner.title}</strong>
        </div>
        <p className="mt-1 text-sm leading-6 text-ink/70">{banner.message}</p>
        {banner.promotionSummary?.requiresCode === true && banner.linkedPromoCode && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-forest">
            <span>Code : {banner.linkedPromoCode}</span>
            <button
              type="button"
              className="rounded border border-forest/15 px-2 py-1 text-xs hover:bg-forest hover:text-ivory"
              onClick={() => void navigator.clipboard?.writeText(banner.linkedPromoCode || "")}
            >
              Copier
            </button>
          </div>
        )}
      </div>
      {banner.buttonLabel && banner.buttonUrl && (
        <BannerLink url={banner.buttonUrl} label={banner.buttonLabel} />
      )}
      {banner.dismissible && (
        <button
          type="button"
          className="ml-auto h-9 w-9 rounded-full border border-transparent text-lg leading-none text-forest/70 hover:border-forest/10 hover:bg-ivory/80 hover:text-forest"
          aria-label="Fermer cette banniere"
          onClick={() => onDismiss(banner)}
        >
          ×
        </button>
      )}
    </>
  );

  if (banner.type === "top_bar") {
    return (
      <aside className={`border-b px-4 py-3 shadow-sm ${bannerVariantClass(banner.variant)}`}>
        <div className="container-page flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {content}
        </div>
      </aside>
    );
  }

  return (
    <aside className={`rounded-lg border px-4 py-4 ${bannerVariantClass(banner.variant)}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {content}
      </div>
    </aside>
  );
}

function BannerLink({ url, label }: { url: string; label: string }) {
  const className = "btn-secondary min-h-10 px-4 py-2 text-sm";
  if (url.startsWith("/")) {
    return (
      <Link to={url} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <a href={url} className={className}>
      {label}
    </a>
  );
}

function placementFromPath(pathname: string): PromoBannerPlacement {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/boutique")) return "shop";
  if (pathname.startsWith("/fleurs-cbd")) return "flowers";
  if (pathname.startsWith("/resines-cbd")) return "resins";
  if (pathname.startsWith("/panier")) return "cart";
  if (pathname.startsWith("/checkout")) return "checkout";
  return "all_public";
}

function bannerVariantClass(variant: PromoBannerVariant) {
  if (variant === "promo") return "border-champagne/50 bg-[#f8efd9]";
  if (variant === "delivery") return "border-forest/15 bg-forest/5";
  if (variant === "warning") return "border-champagne/50 bg-[#fff8eb]";
  if (variant === "info") return "border-forest/10 bg-cream";
  return "border-forest/10 bg-ivory";
}

function isBannerDismissed(banner: PromoBanner) {
  if (!banner.dismissible || typeof window === "undefined") return false;
  return window.localStorage.getItem(dismissStorageKey(banner.id)) === "true";
}

function dismissStorageKey(bannerId: string) {
  return `verdanza_banner_dismissed_${bannerId}`;
}
