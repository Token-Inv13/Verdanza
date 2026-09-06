import { useEffect } from "react";
import { BRAND_SOCIAL_IMAGE } from "../lib/brandAssets";

const siteUrl = "https://verdanza.fr";

export function Seo({
  title,
  description,
  path,
  canonical,
  noindex = false,
  robots,
  ogTitle,
  ogDescription,
  ogType = "website",
  image,
  articlePublishedTime,
  articleModifiedTime,
  articleAuthor,
}: {
  title: string;
  description: string;
  path?: string;
  canonical?: string | null;
  noindex?: boolean;
  robots?: "index,follow" | "noindex,follow" | "noindex,nofollow";
  ogTitle?: string;
  ogDescription?: string;
  ogType?: "website" | "product" | "article";
  image?: string;
  articlePublishedTime?: string;
  articleModifiedTime?: string;
  articleAuthor?: string;
}) {
  useEffect(() => {
    const href = canonical === null ? "" : canonicalUrl(canonical || path);
    const socialTitle = ogTitle || title;
    const socialDescription = ogDescription || description;
    const imageUrl = absoluteUrl(image || BRAND_SOCIAL_IMAGE);

    document.title = title;
    setMeta("description", description);
    setMeta("robots", robots || (noindex ? "noindex,nofollow" : "index,follow"));
    setProperty("og:title", socialTitle);
    setProperty("og:description", socialDescription);
    if (href) {
      setProperty("og:url", href);
    } else {
      removeProperty("og:url");
    }
    setProperty("og:type", ogType);
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", socialTitle);
    setMeta("twitter:description", socialDescription);
    setProperty("og:image", imageUrl);
    setProperty("og:image:type", socialImageMimeType(imageUrl));
    if (imageUrl === absoluteUrl(BRAND_SOCIAL_IMAGE)) {
      setProperty("og:image:width", "1200");
      setProperty("og:image:height", "630");
    } else {
      removeProperty("og:image:width");
      removeProperty("og:image:height");
    }
    setMeta("twitter:image", imageUrl);
    if (ogType === "article") {
      setOptionalProperty("article:published_time", articlePublishedTime);
      setOptionalProperty("article:modified_time", articleModifiedTime);
      setOptionalProperty("article:author", articleAuthor);
    } else {
      removeProperty("article:published_time");
      removeProperty("article:modified_time");
      removeProperty("article:author");
    }
    if (href) {
      setCanonical(href);
    } else {
      removeCanonical();
    }
  }, [
    articleAuthor,
    articleModifiedTime,
    articlePublishedTime,
    canonical,
    description,
    image,
    noindex,
    ogDescription,
    ogTitle,
    ogType,
    path,
    robots,
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

function socialImageMimeType(imageUrl: string) {
  const pathname = new URL(imageUrl).pathname.toLowerCase();
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
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

function setProperty(property: string, content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("property", property);
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function setOptionalProperty(property: string, content?: string) {
  if (!content) {
    removeProperty(property);
    return;
  }
  setProperty(property, content);
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

function removeCanonical() {
  document.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]').forEach((link) => {
    link.remove();
  });
}
