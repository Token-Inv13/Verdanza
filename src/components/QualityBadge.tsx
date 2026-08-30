import { BRAND_QUALITY_SEAL_ALT } from "../lib/brandAssets";
import { BrandLogo } from "./BrandLogo";

type QualityBadgeVariant = "compact" | "standard" | "seal" | "inline";

type QualityBadgeProps = {
  variant?: QualityBadgeVariant;
  className?: string;
};

const variantStyles: Record<QualityBadgeVariant, string> = {
  compact: "h-9 w-9",
  standard: "h-16 w-16",
  seal: "w-28",
  inline: "h-8 w-8",
};

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function QualityBadge({
  variant = "standard",
  className,
}: QualityBadgeProps) {
  const variantClassName = variantStyles[variant];

  return (
    <BrandLogo
      variant="seal"
      alt={BRAND_QUALITY_SEAL_ALT}
      aria-label={BRAND_QUALITY_SEAL_ALT}
      loading="lazy"
      decoding="async"
      className={classNames(
        "aspect-square shrink-0 rounded-full object-contain shadow-sm",
        variantClassName,
        className,
      )}
    />
  );
}
