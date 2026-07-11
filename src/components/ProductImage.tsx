import { productImageVariants } from "../lib/generatedImageVariants";

type ProductImageProps = {
  src: string;
  variant: "card" | "detail";
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
};

const fallbackDimensions = {
  card: { width: 640, height: 640, sizes: "(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw" },
  detail: { width: 713, height: 713, sizes: "(min-width: 1024px) 45vw, 92vw" },
};

export function ProductImage({
  src,
  variant,
  alt,
  className,
  loading = "lazy",
  fetchPriority = "auto",
}: ProductImageProps) {
  const optimized = productImageVariants[src]?.[variant];
  const fallback = fallbackDimensions[variant];

  return (
    <img
      src={optimized?.src || src}
      srcSet={optimized?.srcSet}
      sizes={optimized?.sizes || fallback.sizes}
      alt={alt}
      width={optimized?.width || fallback.width}
      height={optimized?.height || fallback.height}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      className={className}
      onError={(event) => {
        const image = event.currentTarget;
        if (image.dataset.fallbackApplied === "true" || image.currentSrc === src) return;
        image.dataset.fallbackApplied = "true";
        image.removeAttribute("srcset");
        image.removeAttribute("sizes");
        image.src = src;
      }}
    />
  );
}
