import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  canonicalUrl,
  fallbackSeoRoute,
  prerenderFallbackSeoRoutes,
  prerenderSeoRoutes,
  sitemapUrls,
  type SeoRoute,
} from "./seoRoutes";

const distDir = resolve("dist");
const sitemap = new Set(sitemapUrls());
const rows = [];

for (const route of prerenderSeoRoutes()) {
  rows.push(auditRoute(route, outputPathForRoute(route.path)));
}
for (const route of prerenderFallbackSeoRoutes()) {
  rows.push(auditRoute(route, outputPathForRoute(route.path)));
}
rows.push(
  auditRoute(fallbackSeoRoute(), join(distDir, "404.html"), {
    expectedCanonicalPath: "/route-introuvable-test",
  }),
);

const failures = rows.filter((row) => row.failures.length);

console.table(
  rows.map((row) => ({
    path: row.path,
    file: row.fileExists,
    title: Boolean(row.title),
    canonical: row.canonical,
    robots: row.robots,
    h1: row.h1Count,
    sitemap: row.inSitemap,
    main: row.mainTextLength,
  })),
);

if (failures.length) {
  console.error("\nPrerender audit failures:");
  console.table(
    failures.map((row) => ({
      path: row.path,
      failures: row.failures.join(" | "),
    })),
  );
  process.exitCode = 1;
} else {
  console.log("\nPrerender audit passed.");
}

function auditRoute(
  route: SeoRoute,
  filePath: string,
  options: { expectedCanonicalPath?: string } = {},
) {
  const failures: string[] = [];
  const html = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const expectedCanonical = canonicalUrl(options.expectedCanonicalPath || route.path);
  const title = firstMatch(html, /<title>(.*?)<\/title>/is);
  const description = metaContent(html, "description");
  const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  const robots = metaContent(html, "robots");
  const h1Count = [...html.matchAll(/<h1[\s>]/gi)].length;
  const mainHtml = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || "";
  const bodyHtml = html.match(/<body[\s\S]*?<\/body>/i)?.[0] || "";
  const mainTextLength = stripTags(mainHtml || bodyHtml).trim().length;
  const noindex = robots.includes("noindex");
  const inSitemap = sitemap.has(expectedCanonical);

  if (!html.trim()) failures.push("empty html");
  if (!title) failures.push("missing title");
  if (!description) failures.push("missing description");
  if (!canonical) failures.push("missing canonical");
  if (!robots) failures.push("missing robots");
  if (!metaProperty(html, "og:title")) failures.push("missing og:title");
  if (!metaProperty(html, "og:description")) failures.push("missing og:description");
  if (!metaProperty(html, "og:url")) failures.push("missing og:url");
  if (!metaProperty(html, "og:type")) failures.push("missing og:type");
  if (!metaContent(html, "twitter:card")) failures.push("missing twitter:card");
  if (!metaContent(html, "twitter:title")) failures.push("missing twitter:title");
  if (!metaContent(html, "twitter:description")) failures.push("missing twitter:description");
  if (route.indexable && canonical !== expectedCanonical) failures.push("canonical mismatch");
  if (route.indexable && noindex) failures.push("indexable noindex");
  if (!route.indexable && !noindex) failures.push("noindex missing");
  if (route.indexable && !inSitemap) failures.push("missing sitemap URL");
  if (!route.indexable && inSitemap) failures.push("noindex URL in sitemap");
  if (h1Count !== 1) failures.push(`h1 count ${h1Count}`);
  if (mainTextLength < 20) failures.push("main content too short");
  if (containsPrivateData(html)) failures.push("private data marker");

  return {
    path: route.path,
    fileExists: existsSync(filePath),
    title,
    canonical,
    robots,
    h1Count,
    inSitemap,
    mainTextLength,
    failures,
  };
}

function outputPathForRoute(path: string) {
  if (path === "/") return join(distDir, "index.html");
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const cleanUrlFile = join(distDir, `${normalized}.html`);
  if (existsSync(cleanUrlFile)) return cleanUrlFile;
  return join(distDir, `${normalized}/index.html`);
}

function metaContent(html: string, name: string) {
  return firstMatch(
    html,
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
  );
}

function metaProperty(html: string, property: string) {
  return firstMatch(
    html,
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
  );
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.trim() || "";
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function containsPrivateData(html: string) {
  return [
    "verdanza:lastOrderSummary",
    "adminUsers.",
    "apiKey",
    "firebase-adminsdk",
  ].some((marker) => html.includes(marker));
}
