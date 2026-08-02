import { chromium } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { allSeoRoutes, canonicalUrl, prerenderFallbackSeoRoutes } from "./seoRoutes";
import { startAuditStaticServer } from "./auditStaticServer";

const routes = allSeoRoutes();
const requestedBaseUrl = process.argv[2];
const auditServer = requestedBaseUrl
  ? undefined
  : await startAuditStaticServer({
      notFoundPaths: prerenderFallbackSeoRoutes().map((route) => route.path),
    });
const baseUrl = requestedBaseUrl || auditServer?.baseUrl || "";

type PageMeta = {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  ogType: string;
  twitterCard: string;
  twitterTitle: string;
  twitterDescription: string;
  h1Count: number;
  h1Text: string;
};

const sitemapXml = (await fetchPage(`${baseUrl}/sitemap.xml`)).html;
const sitemapUrls = new Set([...sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]));

const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: "block" });
await blockExternalServices(context);
const page = await context.newPage();
const rows = [];
let unknownResponse = { status: 0, html: "" };

try {
  for (const route of routes) {
    const url = `${baseUrl}${route.path}`;
    const initialResponse = await fetchPage(url);
    const response = await gotoDomReady(page, url);
    const dom = await readDomMeta(page);
    const initial = readInitialMeta(initialResponse.html);
    const expectedCanonical = canonicalUrl(route.path);
    const sitemap = sitemapUrls.has(expectedCanonical);

    rows.push({
      path: route.path,
      kind: route.kind,
      component: route.component,
      status: response?.status() || initialResponse.status,
      initialStatus: initialResponse.status,
      title: dom.title,
      description: dom.description,
      canonical: dom.canonical,
      robots: dom.robots,
      h1: dom.h1Count,
      h1Text: dom.h1Text,
      sitemap,
      initialTitle: initial.title,
      initialDescription: initial.description,
      initialCanonical: initial.canonical,
      initialRobots: initial.robots,
      initialOgTitle: initial.ogTitle,
      initialOgDescription: initial.ogDescription,
      initialOgUrl: initial.ogUrl,
      initialOgType: initial.ogType,
      initialTwitterCard: initial.twitterCard,
      initialTwitterTitle: initial.twitterTitle,
      initialTwitterDescription: initial.twitterDescription,
      initialH1: initial.h1Count,
      expectedIndexable: route.indexable,
      duplicateCanonical: await page.locator('link[rel="canonical"]').count(),
    });
  }
  unknownResponse = await fetchPage(`${baseUrl}/__seo-audit-unknown-route__`);
} finally {
  await context.close();
  await browser.close();
  await auditServer?.close();
}

const unknownRobots = readInitialMeta(unknownResponse.html).robots;
if (unknownResponse.status !== 404 || !unknownRobots.includes("noindex")) {
  console.error(
    `Unknown route mismatch: HTTP ${unknownResponse.status}, robots ${unknownRobots || "missing"}`,
  );
  process.exitCode = 1;
}

const failures = rows.filter((row) => {
  const robotsNoindex = row.robots.includes("noindex");
  const initialRobotsNoindex = row.initialRobots.includes("noindex");
  const isNotFound = row.kind === "fallback";
  const expectedStatus = isNotFound ? 404 : 200;
  return (
    row.status !== expectedStatus ||
    row.initialStatus !== expectedStatus ||
    row.h1 !== 1 ||
    row.initialH1 !== 1 ||
    !row.initialTitle ||
    !row.initialDescription ||
    !row.initialRobots ||
    !row.initialOgTitle ||
    !row.initialOgDescription ||
    !row.initialOgType ||
    !row.initialTwitterCard ||
    !row.initialTwitterTitle ||
    !row.initialTwitterDescription ||
    (isNotFound && Boolean(row.initialCanonical || row.initialOgUrl || row.canonical)) ||
    (!isNotFound && (!row.initialCanonical || !row.initialOgUrl)) ||
    row.duplicateCanonical !== (isNotFound ? 0 : 1) ||
    (row.expectedIndexable && row.canonical !== canonicalUrl(row.path)) ||
    (row.expectedIndexable && row.initialCanonical !== canonicalUrl(row.path)) ||
    (row.expectedIndexable && (robotsNoindex || !row.sitemap)) ||
    (row.expectedIndexable && initialRobotsNoindex) ||
    (!row.expectedIndexable && (!robotsNoindex || !initialRobotsNoindex || row.sitemap))
  );
});

console.table(
  rows.map((row) => ({
    path: row.path,
    status: row.status,
    robots: row.robots,
      h1: row.h1,
      sitemap: row.sitemap,
      canonical: row.canonical,
      title: row.title,
    })),
);

console.log("\nInitial HTML vs DOM after JavaScript:");
console.table(
  rows
    .filter((row) => row.expectedIndexable || ["/panier", "/checkout", "/connexion"].includes(row.path))
    .map((row) => ({
      path: row.path,
      initialTitle: Boolean(row.initialTitle),
      initialDescription: Boolean(row.initialDescription),
      initialCanonical: row.initialCanonical || "",
      initialRobots: row.initialRobots || "",
      initialH1: row.initialH1,
      domCanonical: row.canonical,
      domRobots: row.robots,
      domH1: row.h1,
    })),
);

if (failures.length) {
  console.error("\nSEO audit failures:");
  console.table(
    failures.map((row) => ({
      path: row.path,
      status: row.status,
      robots: row.robots,
      initialCanonical: row.initialCanonical,
      initialRobots: row.initialRobots,
      initialH1: row.initialH1,
      canonical: row.canonical,
      h1: row.h1,
      sitemap: row.sitemap,
      duplicateCanonical: row.duplicateCanonical,
    })),
  );
  process.exitCode = 1;
} else {
  console.log(
    `\nSEO audit passed. Unknown route returned ${unknownResponse.status} with ${unknownRobots}.`,
  );
}

async function fetchPage(url: string) {
  const response = await fetch(url);
  return { status: response.status, html: await response.text() };
}

function readInitialMeta(html: string): PageMeta {
  return {
    title: firstMatch(html, /<title>(.*?)<\/title>/is),
    description: metaContent(html, "description"),
    canonical: firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
    robots: metaContent(html, "robots"),
    ogTitle: metaProperty(html, "og:title"),
    ogDescription: metaProperty(html, "og:description"),
    ogUrl: metaProperty(html, "og:url"),
    ogType: metaProperty(html, "og:type"),
    twitterCard: metaContent(html, "twitter:card"),
    twitterTitle: metaContent(html, "twitter:title"),
    twitterDescription: metaContent(html, "twitter:description"),
    h1Count: [...html.matchAll(/<h1[\s>]/gi)].length,
    h1Text: "",
  };
}

async function readDomMeta(page: import("playwright").Page): Promise<PageMeta> {
  return page.evaluate(`(() => {
    const meta = (selector) =>
      document.querySelector(selector)?.content || "";
    const h1s = [...document.querySelectorAll("h1")];
    return {
      title: document.title,
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      robots: meta('meta[name="robots"]'),
      ogTitle: meta('meta[property="og:title"]'),
      ogDescription: meta('meta[property="og:description"]'),
      ogUrl: meta('meta[property="og:url"]'),
      ogType: meta('meta[property="og:type"]'),
      twitterCard: meta('meta[name="twitter:card"]'),
      twitterTitle: meta('meta[name="twitter:title"]'),
      twitterDescription: meta('meta[name="twitter:description"]'),
      h1Count: h1s.length,
      h1Text: h1s.map((heading) => heading.textContent?.trim()).filter(Boolean).join(" | "),
    };
  })()`);
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
