export const siteUrl = "https://verdanza.fr";

export function absoluteUrl(pathOrUrl: string) {
  const url = new URL(pathOrUrl, siteUrl);
  url.protocol = "https:";
  url.host = "verdanza.fr";
  url.hash = "";
  url.search = "";
  url.pathname = normalizePathname(url.pathname);
  return url.toString();
}

export function normalizePathname(pathname: string) {
  const withoutDuplicateSlashes = pathname.replace(/\/{2,}/g, "/");
  if (withoutDuplicateSlashes === "/" || withoutDuplicateSlashes === "") return "/";
  return withoutDuplicateSlashes.replace(/\/+$/, "");
}
