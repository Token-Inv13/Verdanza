import {
  BRAND_QUALITY_SEAL,
  BRAND_QUALITY_SEAL_ALT,
} from "../lib/brandAssets";
import { staticImageVariants } from "../lib/generatedImageVariants";

type QualityBadgeVariant = "compact" | "standard" | "seal" | "inline";

type QualityBadgeProps = {
  variant?: QualityBadgeVariant;
  className?: string;
};

const variantStyles: Record<
  QualityBadgeVariant,
  { className: string; sizes: string }
> = {
  compact: { className: "h-9 w-9", sizes: "36px" },
  standard: { className: "h-16 w-16", sizes: "64px" },
  seal: { className: "w-28", sizes: "112px" },
  inline: { className: "h-8 w-8", sizes: "32px" },
};

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function QualityBadge({
  variant = "standard",
  className,
}: QualityBadgeProps) {
  const imageVariant = staticImageVariants[BRAND_QUALITY_SEAL];
  const style = variantStyles[variant];

  return (
    <img
      src={imageVariant?.src || BRAND_QUALITY_SEAL}
      srcSet={imageVariant?.srcSet}
      sizes={style.sizes}
      width={imageVariant?.width || 320}
      height={imageVariant?.height || 320}
      alt={BRAND_QUALITY_SEAL_ALT}
      aria-label={BRAND_QUALITY_SEAL_ALT}
      loading="lazy"
      decoding="async"
      className={classNames(
        "aspect-square shrink-0 rounded-full object-contain shadow-sm",
        style.className,
        className,
      )}
    />
  );
}
