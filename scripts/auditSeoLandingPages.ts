import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { staticSeoRoutes, canonicalUrl, productSeoRoutes } from "./seoRoutes";

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
    path: "/boutique",
    titleIncludes: ["Boutique Verdanza CBD"],
    descriptionIncludes: ["fleurs et résines", "livraison locale", "livraison postale"],
    h2: [],
    links: ["/livraison-locale"],
    textMarkers: ["zone et les conditions de livraison locale", "Disponible"],
  },
  {
    path: "/decouvrir-verdanza",
    titleIncludes: ["Découvrir Verdanza", "Fleurs et résines CBD"],
    descriptionIncludes: ["Découvrez Verdanza", "fleurs et résines CBD"],
    h2: [
      "Une entrée simple vers l’univers Verdanza",
      "Des repères clairs avant de choisir",
      "Découvrez Verdanza à votre rythme",
    ],
    links: ["/boutique", "/fleurs-cbd", "/resines-cbd", "/blog", "/livraison", "/qualite-conformite"],
    textMarkers: [
      "Découvrir Verdanza",
      "CBD sélectionné avec exigence",
      "Fleurs CBD",
      "Résines CBD",
      "Guides CBD",
      "Réservé aux personnes majeures",
    ],
  },
  {
    path: "/fleurs-cbd",
    titleIncludes: ["Fleurs CBD", "Verdanza"],
    descriptionIncludes: ["Sélection de fleurs CBD", "livraison"],
    h2: ["Besoin d'aide pour choisir ?"],
    links: ["/blog"],
    textMarkers: ["indoor", "greenhouse", "hydroponique", "Disponible"],
  },
  {
    path: "/resines-cbd",
    titleIncludes: ["Résines CBD", "Verdanza"],
    descriptionIncludes: ["résines CBD", "livraison"],
    h2: ["Besoin d'aide pour comparer ?"],
    links: ["/blog"],
    textMarkers: ["texture", "CBG", "Disponible"],
  },
  {
    path: "/livraison-locale",
    titleIncludes: ["Livraison CBD Aix-en-Provence", "Verdanza"],
    descriptionIncludes: ["Livraison locale", "15 km", "20 €", "disponibilité"],
    h2: [
      "Comment fonctionne la livraison CBD à Aix ?",
      "Zone de livraison autour d’Aix-en-Provence",
      "Conditions et disponibilité",
      "Livraison locale ou livraison postale : quelle différence ?",
      "Questions fréquentes sur la livraison CBD à Aix-en-Provence",
      "Préparer une commande en livraison locale",
    ],
    links: [
      "/boutique",
      "/fleurs-cbd",
      "/resines-cbd",
      "/livraison-postale",
      "/qualite-conformite",
      "/contact",
    ],
    textMarkers: [
      "livraison locale de CBD à domicile",
      "adresse vérifiée",
      "jusqu’à 15 km",
      "Minimum de commande",
      "5,49 EUR",
    ],
  },
  {
    path: "/livraison",
    titleIncludes: ["Modes de livraison Verdanza", "locale et postale"],
    descriptionIncludes: ["modes de livraison Verdanza", "service local", "livraison postale"],
    h2: [
      "Service local selon votre adresse",
      "Colissimo France à domicile",
      "Comment choisir votre mode de livraison ?",
    ],
    links: ["/livraison-locale", "/livraison-postale"],
    textMarkers: ["éligibilité calculée", "5,49 EUR", "offerte dès 50,00 EUR"],
  },
  {
    path: "/livraison-postale",
    titleIncludes: ["Livraison postale CBD", "Verdanza"],
    descriptionIncludes: ["Livraison Colissimo", "France métropolitaine"],
    h2: ["Fonctionnement", "Délais et modalités", "Alternative locale"],
    links: ["/livraison-locale"],
    textMarkers: ["Minimum postal", "5,49 EUR", "Dès 50,00 EUR", "Suivi Colissimo"],
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
const forbiddenArrivalNoticeText = [
  "De nouvelles références arrivent bientôt",
  "De nouvelles fleurs arrivent bientôt",
  "De nouvelles résines arrivent bientôt",
  "Des produits CBD sélectionnés avec soin seront ajoutés progressivement à la boutique.",
  "Des références sélectionnées avec soin seront ajoutées progressivement.",
];
const corruptedCharacterPattern = /Ã|â€™|�/;

const audits = pages.map(auditPage);
const failures = audits.filter((audit) => audit.failures.length);
const productDeliveryAudits = productSeoRoutes().map((route) => auditProductDeliveryLink(route.path));
const productDeliveryFailures = productDeliveryAudits.filter((audit) => audit.failures.length);

console.table(
  audits.map((audit) => ({
    path: audit.path,
    title: audit.title,
    description: Boolean(audit.description),
    h1: audit.h1Count,
    failures: audit.failures.length,
  })),
);

console.table(
  productDeliveryAudits.map((audit) => ({
    path: audit.path,
    localDeliveryBlock: audit.failures.length === 0,
    failures: audit.failures.length,
  })),
);

if (failures.length || productDeliveryFailures.length) {
  console.error("\nSEO landing page audit failures:");
  console.table(
    [...failures, ...productDeliveryFailures].map((audit) => ({
      path: audit.path,
      failures: audit.failures.join(" | "),
    })),
  );
  process.exitCode = 1;
} else {
  console.log("\nSEO landing page audit passed.");
}

function auditProductDeliveryLink(path: string) {
  const failures: string[] = [];
  const filePath = outputPathForRoute(path);
  const html = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const mainHtml = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || "";
  const mainText = stripTags(mainHtml);

  if (!html.trim()) failures.push("missing prerendered HTML");
  if (!mainText.includes("Livraison locale autour d’Aix-en-Provence")) {
    failures.push("local delivery block missing");
  }
  if (!hasHref(mainHtml, "/livraison-locale")) {
    failures.push("missing internal link: /livraison-locale");
  }

  return { path, failures };
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
  forbiddenArrivalNoticeText.forEach((text) => {
    if (userFacingText.includes(text)) failures.push(`obsolete arrival notice present: ${text}`);
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
  const expected = new URL(href, "https://verdanza.fr");
  const hrefs = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map(
    (match) => match[1],
  );

  return hrefs.some((candidate) => {
    const parsed = new URL(candidate, "https://verdanza.fr");
    if (
      parsed.origin !== expected.origin ||
      parsed.pathname !== expected.pathname ||
      parsed.search !== expected.search
    ) {
      return false;
    }
    return !parsed.hash || fragmentExists(parsed.pathname, parsed.hash);
  });
}

function fragmentExists(pathname: string, hash: string) {
  const targetFile = outputPathForRoute(pathname);
  if (!existsSync(targetFile)) return false;
  const fragment = decodeURIComponent(hash.replace(/^#/, ""));
  if (!fragment) return false;
  const targetHtml = readFileSync(targetFile, "utf8");
  return new RegExp(`\\sid=["']${escapeRegExp(fragment)}["']`, "i").test(targetHtml);
}

function metaContent(html: string, name: string) {
  const match = html.match(
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=(["'])(.*?)\\1`, "i"),
  );
  return match?.[2]?.trim() || "";
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
