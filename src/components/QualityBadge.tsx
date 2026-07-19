import {
  BRAND_QUALITY_SEAL,
  BRAND_QUALITY_SEAL_ALT,
} from "../lib/brandAssets";
import { staticImageVariants } from "../lib/generatedImageVariants";

type QualityBadgeVariant = "compact" | "standard" | "seal" | "inline";

type QualityBadgeProps = {
  variant?: QualityBadgeVariant;
  origin?: string;
  showGenericOrigins?: boolean;
  className?: string;
};

const UNKNOWN_ORIGINS = new Set([
  "",
  "a renseigner",
  "à renseigner",
  "non communique",
  "non communiqué",
]);

function cleanOrigin(origin?: string) {
  const value = origin?.trim();
  if (!value) return null;

  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return UNKNOWN_ORIGINS.has(normalized) ? null : value;
}

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

function QualitySealImage({ className, sizes }: { className?: string; sizes?: string }) {
  const variant = staticImageVariants[BRAND_QUALITY_SEAL];

  return (
    <img
      src={variant?.src || BRAND_QUALITY_SEAL}
      srcSet={variant?.srcSet}
      sizes={sizes || variant?.sizes}
      width={variant?.width || 320}
      height={variant?.height || 320}
      alt={BRAND_QUALITY_SEAL_ALT}
      loading="lazy"
      decoding="async"
      className={classNames("aspect-square rounded-full object-contain", className)}
    />
  );
}

export function QualityBadge({
  variant = "standard",
  origin,
  showGenericOrigins = false,
  className,
}: QualityBadgeProps) {
  const cleanValue = cleanOrigin(origin);

  if (!cleanValue && !showGenericOrigins) return null;

  const secondaryLine = cleanValue ? `Origine : ${cleanValue}` : "Origines sélectionnées";
  const tertiaryLine = !cleanValue && showGenericOrigins ? "France · Italie · Suisse" : null;

  if (variant === "inline") {
    return (
      <span
        className={classNames(
          "inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-champagne/35 bg-cream py-1 pl-1 pr-3 text-xs font-semibold text-forest",
          className,
        )}
      >
        <QualitySealImage className="h-8 w-8 shrink-0" sizes="32px" />
        <span>Sélection Verdanza</span>
        <span className="text-forest/55">·</span>
        <span>{secondaryLine}</span>
        {tertiaryLine && <span className="font-medium text-forest/65">{tertiaryLine}</span>}
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <div
        className={classNames(
          "inline-flex max-w-full items-center gap-2 rounded-full border border-champagne/30 bg-cream py-1.5 pl-1.5 pr-3 text-xs text-forest",
          className,
        )}
      >
        <QualitySealImage className="h-9 w-9 shrink-0" sizes="36px" />
        <span className="min-w-0">
          <span className="font-semibold">Sélection Verdanza</span>
          <span className="mx-1 text-forest/45">·</span>
          <span className="text-forest/70">{secondaryLine}</span>
        </span>
      </div>
    );
  }

  if (variant === "seal") {
    return (
      <QualitySealImage
        className={classNames("w-28 shadow-sm", className)}
        sizes="112px"
      />
    );
  }

  return (
    <aside
      className={classNames(
        "rounded-md border border-champagne/30 bg-cream p-4 text-forest",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <QualitySealImage className="h-16 w-16 shrink-0 shadow-sm" sizes="64px" />
        <div>
          <p className="font-display text-2xl leading-tight">Sélection Verdanza</p>
          <p className="mt-1 text-sm leading-6 text-ink/65">
            {cleanValue
              ? "Produit sélectionné selon son origine et son profil."
              : "Produits sélectionnés selon leur origine, leur profil et les informations disponibles."}
          </p>
          <p className="mt-2 text-sm font-semibold text-forest">{secondaryLine}</p>
          {tertiaryLine && (
            <p className="mt-1 text-sm font-medium text-forest/70">{tertiaryLine}</p>
          )}
        </div>
      </div>
    </aside>
  );
}
