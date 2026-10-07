export function SignaturePreview({ slug, previewUrl, alt, className = "" }: { slug: string; previewUrl: string; alt: string; className?: string }) {
  const smallPreviewUrl = previewUrl.replace(/-640\.webp$/, "-320.webp");

  return (
    <img
      src={previewUrl}
      srcSet={`${smallPreviewUrl} 320w, ${previewUrl} 640w`}
      sizes="(min-width: 1024px) 340px, (min-width: 640px) 48vw, 84vw"
      alt={alt}
      width={640}
      height={800}
      loading="lazy"
      decoding="async"
      className={className}
      data-signature-v1-preview={slug}
    />
  );
}
