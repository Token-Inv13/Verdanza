import { Leaf } from "lucide-react";

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
          "inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-champagne/35 bg-cream px-3 py-1 text-xs font-semibold text-forest",
          className,
        )}
      >
        <Leaf size={13} aria-hidden="true" />
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
          "inline-flex max-w-full items-center gap-2 rounded-full border border-champagne/30 bg-cream px-3 py-1.5 text-xs text-forest",
          className,
        )}
      >
        <Leaf size={14} className="shrink-0 text-champagne" aria-hidden="true" />
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
      <div
        className={classNames(
          "inline-flex aspect-square w-28 flex-col items-center justify-center rounded-full border border-champagne/45 bg-ivory p-4 text-center text-forest shadow-sm",
          className,
        )}
      >
        <Leaf size={20} className="text-champagne" aria-hidden="true" />
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em]">
          Sélection
        </p>
        <p className="font-display text-xl leading-none">Verdanza</p>
        <p className="mt-1 text-[0.65rem] leading-tight text-forest/65">
          {cleanValue || "France · Italie · Suisse"}
        </p>
      </div>
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
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-champagne/35 bg-ivory text-champagne">
          <Leaf size={17} aria-hidden="true" />
        </span>
        <div>
          <p className="font-display text-2xl leading-tight">Sélection Verdanza</p>
          <p className="mt-1 text-sm leading-6 text-ink/65">
            {cleanValue
              ? "Produit sélectionné avec une origine renseignée."
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
