import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { staticSeoRoutes, canonicalUrl } from "./seoRoutes";

type LandingAudit = {
  path: string;
  title: string;
  description: string;
  h1Count: number;
  failures: string[];
};

const distDir = resolve("dist");
const pages = [
  {
    path: "/fleurs-cbd",
    titleIncludes: ["Fleurs CBD premium", "Verdanza"],
    descriptionIncludes: ["Sélection de fleurs CBD", "livraison"],
    h2: [
      "Comprendre les méthodes de culture",
      "Comment comparer les fleurs CBD",
      "La sélection Verdanza",
      "Fleurs à comparer",
      "Liens utiles",
      "Questions fréquentes",
    ],
    links: ["/resines-cbd", "/livraison-express-aix", "/livraison-postale", "/qualite-conformite"],
    textMarkers: ["indoor", "greenhouse", "hydroponique", "prix au gramme"],
  },
  {
    path: "/resines-cbd",
    titleIncludes: ["Résines CBD premium", "Verdanza"],
    descriptionIncludes: ["résines CBD", "livraison"],
    h2: [
      "Comprendre CBD, CBG et autres indications",
      "Comment comparer les résines CBD",
      "La sélection Verdanza",
      "Résines à découvrir",
      "Liens utiles",
      "Questions fréquentes",
    ],
    links: ["/fleurs-cbd", "/livraison-express-aix", "/livraison-postale", "/qualite-conformite"],
    textMarkers: ["texture", "CBG", "cannabinoïdes", "prix au gramme"],
  },
  {
    path: "/livraison-express-aix",
    titleIncludes: ["Livraison CBD à Aix-en-Provence", "Verdanza"],
    descriptionIncludes: ["Livraison locale", "Aix-en-Provence", "créneaux"],
    h2: [
      "Minimum",
      "Horaires",
      "Validation",
      "Adultes",
      "Zones desservies autour d'Aix-en-Provence",
      "Comment commander",
      "Livraison locale ou postale",
      "Liens utiles",
      "Questions fréquentes",
    ],
    links: ["/fleurs-cbd", "/resines-cbd", "/boutique", "/livraison-postale", "/qualite-conformite"],
    textMarkers: ["Aix-en-Provence centre", "Puyricard", "Gardanne", "Le Tholonet"],
  },
];

const privateRoutePatterns = [
  /href=["']\/admin(?:\/|["'])/i,
  /href=["']\/compte(?:\/|["'])/i,
  /href=["']\/panier(?:\/|["'])/i,
  /href=["']\/checkout(?:\/|["'])/i,
  /href=["']\/connexion(?:\/|["'])/i,
  /href=["']\/inscription(?:\/|["'])/i,
];
const forbiddenSchemaTypes = ["Product", "Review", "AggregateRating", "FAQPage", "LocalBusiness"];
const forbiddenMedicalExpressions = [
  /anti[- ]?douleur/i,
  /anxiolytique/i,
  /soigne/i,
  /guerit/i,
  /traitement/i,
  /therapeutique garanti/i,
  /effet relaxant garanti/i,
];
const forbiddenAsciiUserText = [
  "Resines CBD",
  "selection",
  "a Aix-en-Provence",
  "Questions frequentes",
  "Verifier la livraison",
  "Decouvrir les resines",
  "disponibilite des creneaux",
];
const corruptedCharacterPattern = /Ã|â€™|�/;

const audits = pages.map(auditPage);
const failures = audits.filter((audit) => audit.failures.length);

console.table(
  audits.map((audit) => ({
    path: audit.path,
    title: audit.title,
    description: Boolean(audit.description),
    h1: audit.h1Count,
    failures: audit.failures.length,
  })),
);

if (failures.length) {
  console.error("\nSEO landing page audit failures:");
  console.table(
    failures.map((audit) => ({
      path: audit.path,
      failures: audit.failures.join(" | "),
    })),
  );
  process.exitCode = 1;
} else {
  console.log("\nSEO landing page audit passed.");
}

function auditPage(page: (typeof pages)[number]): LandingAudit {
  const failures: string[] = [];
  const route = staticSeoRoutes.find((entry) => entry.path === page.path);
  const filePath = outputPathForRoute(page.path);
  const html = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const title = firstMatch(html, /<title>(.*?)<\/title>/is);
  const description = metaContent(html, "description");
  const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  const robots = metaContent(html, "robots");
  const h1Count = [...html.matchAll(/<h1[\s>]/gi)].length;
  const mainHtml = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || "";
  const mainText = stripTags(mainHtml);
  const userFacingText = [title, description, mainText].join(" ");
  const jsonLdNodes = extractJsonLdNodes(html, failures);
  const schemaTypes = jsonLdNodes.flatMap((node) => {
    const type = node["@type"];
    return Array.isArray(type) ? type : [type];
  });

  if (!route?.indexable) failures.push("route is not marked indexable");
  if (!html.trim()) failures.push("missing prerendered HTML");
  if (!title) failures.push("missing title");
  if (title && page.titleIncludes.some((expected) => !title.includes(expected))) {
    failures.push("title is not specific enough");
  }
  if (!description) failures.push("missing description");
  if (description && page.descriptionIncludes.some((expected) => !description.includes(expected))) {
    failures.push("description is not specific enough");
  }
  if (canonical !== canonicalUrl(page.path)) failures.push("canonical mismatch");
  if (robots !== "index,follow") failures.push(`robots mismatch: ${robots || "missing"}`);
  if (h1Count !== 1) failures.push(`h1 count ${h1Count}`);
  if (mainText.length < 600) failures.push("main content too short");

  page.h2.forEach((heading) => {
    if (!html.includes(heading)) failures.push(`missing H2: ${heading}`);
  });
  page.textMarkers.forEach((marker) => {
    if (!mainText.toLowerCase().includes(marker.toLowerCase())) {
      failures.push(`missing text marker: ${marker}`);
    }
  });
  page.links.forEach((link) => {
    if (!hasHref(mainHtml, link)) failures.push(`missing internal link: ${link}`);
  });
  privateRoutePatterns.forEach((pattern) => {
    if (pattern.test(mainHtml)) failures.push(`private link present: ${pattern}`);
  });
  forbiddenAsciiUserText.forEach((text) => {
    if (userFacingText.includes(text)) failures.push(`unaccented French text present: ${text}`);
  });
  if (corruptedCharacterPattern.test(userFacingText)) {
    failures.push("corrupted UTF-8 character present");
  }

  if (!schemaTypes.includes("BreadcrumbList")) failures.push("BreadcrumbList missing");
  forbiddenSchemaTypes.forEach((type) => {
    if (schemaTypes.includes(type)) failures.push(`${type} schema present`);
  });
  forbiddenMedicalExpressions.forEach((pattern) => {
    if (pattern.test(mainText)) failures.push(`forbidden medical expression: ${pattern}`);
  });

  return { path: page.path, title, description, h1Count, failures };
}

function outputPathForRoute(path: string) {
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const cleanUrlFile = join(distDir, `${normalized}.html`);
  if (existsSync(cleanUrlFile)) return cleanUrlFile;
  return join(distDir, normalized, "index.html");
}

function extractJsonLdNodes(html: string, failures: string[]) {
  return [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap(
    (match, index) => {
      try {
        const parsed = JSON.parse(decodeScriptJson(match[1].trim())) as unknown;
        return flattenJsonLd(parsed);
      } catch {
        failures.push(`invalid JSON-LD script ${index + 1}`);
        return [];
      }
    },
  );
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((entry) => flattenJsonLd(entry));
  if (!isRecord(value)) return [];
  const graph = value["@graph"];
  const current = value["@type"] ? [value] : [];
  return Array.isArray(graph)
    ? [...current, ...graph.flatMap((entry) => flattenJsonLd(entry))]
    : current;
}

function hasHref(html: string, href: string) {
  return new RegExp(`<a[^>]+href=["']${escapeRegExp(href)}["']`, "i").test(html);
}

function metaContent(html: string, name: string) {
  return firstMatch(
    html,
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
  );
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.trim() || "";
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeScriptJson(value: string) {
  return value
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
