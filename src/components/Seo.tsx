import { useEffect } from "react";

const siteUrl = "https://verdanza.fr";

export function Seo({
  title,
  description,
  path,
  canonical,
  noindex = false,
  ogTitle,
  ogDescription,
  ogType = "website",
  image,
}: {
  title: string;
  description: string;
  path?: string;
  canonical?: string;
  noindex?: boolean;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: "website" | "product" | "article";
  image?: string;
}) {
  useEffect(() => {
    const href = canonicalUrl(canonical || path);
    const socialTitle = ogTitle || title;
    const socialDescription = ogDescription || description;
    const imageUrl = image ? absoluteUrl(image) : "";

    document.title = title;
    setMeta("description", description);
    setMeta("robots", noindex ? "noindex,nofollow" : "index,follow");
    setProperty("og:title", socialTitle);
    setProperty("og:description", socialDescription);
    setProperty("og:url", href);
    setProperty("og:type", ogType);
    setMeta("twitter:card", imageUrl ? "summary_large_image" : "summary");
    setMeta("twitter:title", socialTitle);
    setMeta("twitter:description", socialDescription);
    if (imageUrl) {
      setProperty("og:image", imageUrl);
      setMeta("twitter:image", imageUrl);
    } else {
      removeProperty("og:image");
      removeMeta("twitter:image");
    }
    setCanonical(href);
  }, [
    canonical,
    description,
    image,
    noindex,
    ogDescription,
    ogTitle,
    ogType,
    path,
    title,
  ]);

  return null;
}

function canonicalUrl(pathOrUrl?: string) {
  const fallbackPath =
    typeof window === "undefined" ? "/" : window.location.pathname || "/";
  const raw = pathOrUrl || fallbackPath;
  return absoluteUrl(raw);
}

function absoluteUrl(pathOrUrl: string) {
  const url = new URL(pathOrUrl, siteUrl);
  url.protocol = "https:";
  url.host = "verdanza.fr";
  url.hash = "";
  url.search = "";
  url.pathname = normalizePathname(url.pathname);
  return url.toString();
}

function normalizePathname(pathname: string) {
  const withoutDuplicateSlashes = pathname.replace(/\/{2,}/g, "/");
  if (withoutDuplicateSlashes === "/" || withoutDuplicateSlashes === "") return "/";
  return withoutDuplicateSlashes.replace(/\/+$/, "");
}

function setMeta(name: string, content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function removeMeta(name: string) {
  document.querySelectorAll<HTMLMetaElement>(`meta[name="${name}"]`).forEach((meta) => {
    meta.remove();
  });
}

function setProperty(property: string, content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("property", property);
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function removeProperty(property: string) {
  document
    .querySelectorAll<HTMLMetaElement>(`meta[property="${property}"]`)
    .forEach((meta) => {
      meta.remove();
    });
}

function setCanonical(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}
