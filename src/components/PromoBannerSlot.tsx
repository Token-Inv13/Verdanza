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

const PromoBannersContext = createContext<PromoBanner[]>([]);

export function PromoBannersProvider({ children }: { children: ReactNode }) {
  const [banners, setBanners] = useState<PromoBanner[]>([]);

  useEffect(() => {
    let isMounted = true;
    getPublicPromoBanners().then((nextBanners) => {
      if (isMounted) setBanners(nextBanners);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <PromoBannersContext.Provider value={banners}>
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
  const banners = useContext(PromoBannersContext);
  const location = useLocation();
  const currentPlacement = placement || placementFromPath(location.pathname);
  const visibleBanners = useMemo(
    () =>
      banners
        .filter((banner) => promoBannerMatchesPlacement(banner, currentPlacement))
        .filter((banner) => (type ? banner.type === type : true))
        .filter((banner) => !isBannerDismissed(banner))
        .sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0)),
    [banners, currentPlacement, type],
  );

  if (!visibleBanners.length) return null;

  return (
    <div className={className}>
      {visibleBanners.map((banner) => (
        <PublicPromoBanner key={banner.id} banner={banner} />
      ))}
    </div>
  );
}

function PublicPromoBanner({ banner }: { banner: PromoBanner }) {
  const [dismissed, setDismissed] = useState(() => isBannerDismissed(banner));

  if (dismissed) return null;

  const content = (
    <>
      <div className="min-w-0">
        <strong className="block text-sm font-semibold text-forest">{banner.title}</strong>
        <p className="mt-1 text-sm leading-6 text-ink/70">{banner.message}</p>
        {banner.linkedPromoCode && (
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
          className="ml-auto rounded border border-transparent px-2 py-1 text-sm text-forest/70 hover:border-forest/10 hover:text-forest"
          aria-label="Fermer cette banniere"
          onClick={() => {
            window.localStorage.setItem(dismissStorageKey(banner.id), "true");
            setDismissed(true);
          }}
        >
          x
        </button>
      )}
    </>
  );

  if (banner.type === "top_bar") {
    return (
      <aside className={`border-b px-4 py-3 ${bannerVariantClass(banner.variant)}`}>
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
  if (variant === "promo") return "border-champagne/40 bg-champagne/15";
  if (variant === "delivery") return "border-forest/10 bg-forest/5";
  if (variant === "warning") return "border-red-200 bg-red-50";
  if (variant === "info") return "border-forest/10 bg-cream";
  return "border-forest/10 bg-cream";
}

function isBannerDismissed(banner: PromoBanner) {
  if (!banner.dismissible || typeof window === "undefined") return false;
  return window.localStorage.getItem(dismissStorageKey(banner.id)) === "true";
}

function dismissStorageKey(bannerId: string) {
  return `verdanza_banner_dismissed_${bannerId}`;
}
