import type { ImgHTMLAttributes } from "react";
import { brandAssets, BRAND_LOGO_ALT } from "../lib/brandAssets";

export type BrandLogoVariant =
  | "horizontal"
  | "horizontal-primary"
  | "stacked"
  | "monogram"
  | "seal";

export type BrandLogoTone = "full-color" | "gold";

type BrandLogoProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt" | "width" | "height"
> & {
  variant?: BrandLogoVariant;
  tone?: BrandLogoTone;
  alt?: string;
  decorative?: boolean;
};

const logoSources: Record<
  BrandLogoVariant,
  { src: string; width: number; height: number }
> = {
  horizontal: {
    src: brandAssets.logos.horizontalCompactFullColor,
    width: 1391,
    height: 302,
  },
  "horizontal-primary": {
    src: brandAssets.logos.horizontalPrimaryFullColor,
    width: 1449,
    height: 348,
  },
  stacked: {
    src: brandAssets.logos.stackedCompactFullColor,
    width: 1078,
    height: 594,
  },
  monogram: {
    src: brandAssets.logos.monogramSmallFullColor,
    width: 812,
    height: 812,
  },
  seal: {
    src: brandAssets.logos.sealFullColor,
    width: 928,
    height: 928,
  },
};

export function BrandLogo({
  variant = "horizontal",
  tone = "full-color",
  alt = BRAND_LOGO_ALT,
  decorative = false,
  decoding = "async",
  ...props
}: BrandLogoProps) {
  const base = logoSources[variant];
  const source =
    tone === "gold" && variant === "horizontal"
      ? brandAssets.logos.horizontalCompactGold
      : base.src;

  return (
    <img
      {...props}
      src={source}
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
      width={base.width}
      height={base.height}
      decoding={decoding}
    />
  );
}
