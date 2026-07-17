import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blogArticlePath, publishedBlogArticles } from "../src/data/blogArticles";
import { products } from "../src/data/products";
import type { Product } from "../src/types";
import {
  absoluteUrl,
} from "../src/lib/siteUrl";
import {
  productAvailability,
  productCategoryLabel,
  productPath,
  type JsonLdValue,
} from "../src/lib/structuredData";
import {
  fallbackSeoRoute,
  prerenderFallbackSeoRoutes,
  prerenderSeoRoutes,
  type SeoRoute,
} from "./seoRoutes";

const distDir = resolve("dist");
const productByPath = new Map(
  products.filter((product) => product.isActive).map((product) => [productPath(product), product]),
);
const articleByPath = new Map(
  publishedBlogArticles.map((article) => [blogArticlePath(article), article]),
);
const rows = [
  ...prerenderSeoRoutes().map((route) => auditRoute(route, outputPathForRoute(route.path))),
  ...prerenderFallbackSeoRoutes().map((route) => auditRoute(route, outputPathForRoute(route.path))),
  auditRoute(fallbackSeoRoute(), join(distDir, "404.html")),
];
const failures = rows.filter((row) => row.failures.length);

console.table(
  rows.map((row) => ({
    path: row.path,
    scripts: row.scriptCount,
    Product: row.typeCounts.Product || 0,
    Offer: row.typeCounts.Offer || 0,
    BlogPosting: row.typeCounts.BlogPosting || 0,
    BreadcrumbList: row.typeCounts.BreadcrumbList || 0,
    WebSite: row.typeCounts.WebSite || 0,
    OnlineStore: row.typeCounts.OnlineStore || 0,
    failures: row.failures.length,
  })),
);

if (failures.length) {
  console.error("\nStructured data audit failures:");
  console.table(
    failures.map((row) => ({
      path: row.path,
      failures: row.failures.join(" | "),
    })),
  );
  process.exitCode = 1;
} else {
  console.log("\nStructured data audit passed.");
}

function auditRoute(route: SeoRoute, filePath: string) {
  const failures: string[] = [];
  const html = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const canonical = firstMatch(
    html,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  );
  const robots = metaContent(html, "robots");
  const scripts = extractJsonLdScripts(html, failures);
  const nodes = scripts.flatMap((script) => flattenJsonLd(script.value));
  const typeCounts = countTypes(nodes);
  const product = productByPath.get(route.path);
  const article = articleByPath.get(route.path);
  const isHome = route.path === "/";
  const isNoindex = robots.includes("noindex") || !route.indexable;

  if (!html.trim()) failures.push("empty html");
  if (scripts.length !== new Set(scripts.map((script) => script.id || script.raw)).size) {
    failures.push("duplicate JSON-LD scripts");
  }

  if (isHome) {
    expectCount(typeCounts, "WebSite", 1, failures);
    expectCount(typeCounts, "OnlineStore", 1, failures);
    expectCount(typeCounts, "Product", 0, failures);
    expectCount(typeCounts, "BreadcrumbList", 0, failures);
    auditHome(nodes, failures);
  } else if (product) {
    expectCount(typeCounts, "Product", 1, failures);
    expectCount(typeCounts, "BreadcrumbList", 1, failures);
    auditProduct(nodes, product, canonical, failures);
    auditBreadcrumb(nodes, expectedBreadcrumbItems(route.path, product), canonical, failures);
  } else if (article) {
    expectCount(typeCounts, "BlogPosting", 1, failures);
    expectCount(typeCounts, "BreadcrumbList", 1, failures);
    expectCount(typeCounts, "Product", 0, failures);
    expectCount(typeCounts, "Offer", 0, failures);
    auditBlogPosting(nodes, article, canonical, failures);
    auditBreadcrumb(nodes, expectedBreadcrumbItems(route.path), canonical, failures);
  } else if (isNoindex) {
    expectCount(typeCounts, "Product", 0, failures);
    expectCount(typeCounts, "Offer", 0, failures);
    expectCount(typeCounts, "BreadcrumbList", 0, failures);
    expectCount(typeCounts, "OnlineStore", 0, failures);
  } else {
    expectCount(typeCounts, "Product", 0, failures);
    expectCount(typeCounts, "BreadcrumbList", 1, failures);
    auditBreadcrumb(nodes, expectedBreadcrumbItems(route.path), canonical, failures);
  }

  const serialized = scripts.map((script) => JSON.stringify(script.value)).join("\n");
  if (serialized.includes("aggregateRating")) failures.push("aggregateRating present");
  if (serialized.includes('"review"') || serialized.includes('"reviews"')) {
    failures.push("review present");
  }
  if (serialized.includes("MedicalWebPage")) failures.push("MedicalWebPage present");

  return {
    path: route.path,
    scriptCount: scripts.length,
    typeCounts,
    failures,
  };
}

function auditBlogPosting(
  nodes: Record<string, JsonLdValue>[],
  article: (typeof publishedBlogArticles)[number],
  canonical: string,
  failures: string[],
) {
  const node = nodeByType(nodes, "BlogPosting");
  if (!node) return;
  const url = absoluteUrl(blogArticlePath(article));
  if (canonical !== url) failures.push("blog canonical mismatch");
  if (node["@id"] !== `${url}#article`) failures.push("BlogPosting @id mismatch");
  if (node.url !== url) failures.push("BlogPosting url mismatch");
  if (!isRecord(node.mainEntityOfPage) || node.mainEntityOfPage["@id"] !== url) {
    failures.push("BlogPosting mainEntityOfPage mismatch");
  }
  if (node.headline !== article.title) failures.push("BlogPosting headline mismatch");
  if (node.description !== article.description) failures.push("BlogPosting description mismatch");
  if (!Array.isArray(node.image) || node.image.length !== 3) {
    failures.push("BlogPosting image count mismatch");
  }
  if (node.datePublished !== article.datePublished) failures.push("BlogPosting datePublished mismatch");
  if (node.dateModified !== article.dateModified) failures.push("BlogPosting dateModified mismatch");
  if (node.inLanguage !== "fr-FR") failures.push("BlogPosting language mismatch");
  if (!isRecord(node.author) || node.author.name !== article.authorName) {
    failures.push("BlogPosting author mismatch");
  }
  if (!isRecord(node.publisher) || node.publisher["@id"] !== `${absoluteUrl("/")}#organization`) {
    failures.push("BlogPosting publisher mismatch");
  }
}

function extractJsonLdScripts(html: string, failures: string[]) {
  const matches = [...html.matchAll(/<script([^>]*)type=["']application\/ld\+json["']([^>]*)>([\s\S]*?)<\/script>/gi)];
  return matches.flatMap((match, index) => {
    const attrs = `${match[1]} ${match[2]}`;
    const id = firstMatch(attrs, /data-jsonld-id=["']([^"']+)["']/i);
    const raw = decodeScriptJson(match[3].trim());
    try {
      return [{ id, raw, value: JSON.parse(raw) as JsonLdValue }];
    } catch (error) {
      failures.push(`invalid JSON-LD script ${index + 1}: ${error instanceof Error ? error.message : "parse error"}`);
      return [];
    }
  });
}

function decodeScriptJson(value: string) {
  return value
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&");
}

function flattenJsonLd(value: JsonLdValue): Record<string, JsonLdValue>[] {
  if (Array.isArray(value)) return value.flatMap((entry) => flattenJsonLd(entry));
  if (!isRecord(value)) return [];
  const graph = value["@graph"];
  const current = value["@type"] ? [value] : [];
  return graph && Array.isArray(graph)
    ? [...current, ...graph.flatMap((entry) => flattenJsonLd(entry))]
    : current;
}

function countTypes(nodes: Record<string, JsonLdValue>[]) {
  return nodes.reduce<Record<string, number>>((counts, node) => {
    const type = node["@type"];
    const types = Array.isArray(type) ? type : [type];
    types.forEach((entry) => {
      if (typeof entry === "string") counts[entry] = (counts[entry] || 0) + 1;
    });
    return counts;
  }, {});
}

function auditHome(nodes: Record<string, JsonLdValue>[], failures: string[]) {
  const website = nodeByType(nodes, "WebSite");
  const store = nodeByType(nodes, "OnlineStore");
  if (website?.["@id"] !== `${absoluteUrl("/")}#website`) failures.push("WebSite @id mismatch");
  if (website?.url !== absoluteUrl("/")) failures.push("WebSite url mismatch");
  if (website?.name !== "Verdanza") failures.push("WebSite name mismatch");
  if (!isRecord(website?.publisher) || website.publisher["@id"] !== `${absoluteUrl("/")}#organization`) {
    failures.push("WebSite publisher mismatch");
  }
  if (store?.["@id"] !== `${absoluteUrl("/")}#organization`) failures.push("OnlineStore @id mismatch");
  if (store?.name !== "Verdanza") failures.push("OnlineStore name mismatch");
  if (store?.url !== absoluteUrl("/")) failures.push("OnlineStore url mismatch");
  if (store?.logo !== absoluteUrl("/verdanza-logo.png")) failures.push("OnlineStore logo mismatch");
}

function auditProduct(
  nodes: Record<string, JsonLdValue>[],
  product: Product,
  canonical: string,
  failures: string[],
) {
  const node = nodeByType(nodes, "Product");
  if (!node) return;
  const url = absoluteUrl(productPath(product));
  const offer = isRecord(node.offers) ? node.offers : undefined;

  if (canonical !== url) failures.push("product canonical mismatch");
  if (node["@id"] !== `${url}#product`) failures.push("Product @id mismatch");
  if (node.name !== product.name) failures.push("Product name mismatch");
  if (node.description !== product.longDescription) failures.push("Product description mismatch");
  if (!Array.isArray(node.image) || node.image[0] !== absoluteUrl(product.image)) {
    failures.push("Product image mismatch");
  }
  if (node.sku !== product.id) failures.push("Product sku mismatch");
  if (node.category !== productCategoryLabel(product)) failures.push("Product category mismatch");
  if (node.url !== url) failures.push("Product url mismatch");
  if ("brand" in node) failures.push("Product brand present");
  if (!offer) {
    failures.push("missing Product offers");
    return;
  }
  if (offer["@type"] !== "Offer") failures.push("Offer type mismatch");
  if (offer["@id"] !== `${url}#offer`) failures.push("Offer @id mismatch");
  if (offer.url !== url) failures.push("Offer url mismatch");
  if (offer.price !== product.price || typeof offer.price !== "number") {
    failures.push("Offer price mismatch");
  }
  if (offer.priceCurrency !== "EUR") failures.push("Offer currency mismatch");
  if (offer.itemCondition !== "https://schema.org/NewCondition") {
    failures.push("Offer itemCondition mismatch");
  }
  if (offer.availability !== productAvailability(product)) failures.push("Offer availability mismatch");
  if (!isRecord(offer.seller) || offer.seller["@id"] !== `${absoluteUrl("/")}#organization`) {
    failures.push("Offer seller mismatch");
  }
}

function auditBreadcrumb(
  nodes: Record<string, JsonLdValue>[],
  expectedItems: { name: string; path: string }[],
  canonical: string,
  failures: string[],
) {
  const breadcrumb = nodeByType(nodes, "BreadcrumbList");
  if (!breadcrumb) return;
  const itemListElement = breadcrumb.itemListElement;
  if (!Array.isArray(itemListElement)) {
    failures.push("BreadcrumbList itemListElement missing");
    return;
  }
  if (itemListElement.length < 2) failures.push("BreadcrumbList too short");
  if (itemListElement.length !== expectedItems.length) failures.push("BreadcrumbList length mismatch");
  itemListElement.forEach((entry, index) => {
    if (!isRecord(entry)) {
      failures.push(`Breadcrumb item ${index + 1} invalid`);
      return;
    }
    const expected = expectedItems[index];
    if (entry["@type"] !== "ListItem") failures.push(`Breadcrumb item ${index + 1} type mismatch`);
    if (entry.position !== index + 1) failures.push(`Breadcrumb item ${index + 1} position mismatch`);
    if (expected && entry.name !== expected.name) failures.push(`Breadcrumb item ${index + 1} name mismatch`);
    if (expected && entry.item !== absoluteUrl(expected.path)) {
      failures.push(`Breadcrumb item ${index + 1} item mismatch`);
    }
  });
  const last = itemListElement[itemListElement.length - 1];
  if (isRecord(last) && last.item !== canonical) failures.push("Breadcrumb last item canonical mismatch");
}

function expectedBreadcrumbItems(path: string, product?: Product) {
  if (product) {
    return [
      { name: "Accueil", path: "/" },
      {
        name: productCategoryLabel(product),
        path: product.category === "flowers" ? "/fleurs-cbd" : "/resines-cbd",
      },
      { name: product.name, path },
    ];
  }

  const map: Record<string, { name: string; path: string }[]> = {
    "/boutique": [
      { name: "Accueil", path: "/" },
      { name: "Boutique", path: "/boutique" },
    ],
    "/blog": [
      { name: "Accueil", path: "/" },
      { name: "Guides CBD", path: "/blog" },
    ],
    "/blog/comment-lire-analyse-cbd": [
      { name: "Accueil", path: "/" },
      { name: "Guides CBD", path: "/blog" },
      {
        name: "Comment lire une analyse de CBD ?",
        path: "/blog/comment-lire-analyse-cbd",
      },
    ],
    "/blog/choisir-fleur-cbd-profil-aromatique": [
      { name: "Accueil", path: "/" },
      { name: "Guides CBD", path: "/blog" },
      {
        name: "Comment choisir une fleur CBD selon son profil aromatique ?",
        path: "/blog/choisir-fleur-cbd-profil-aromatique",
      },
    ],
    "/blog/fleur-cbd-ou-resine-cbd-differences": [
      { name: "Accueil", path: "/" },
      { name: "Guides CBD", path: "/blog" },
      {
        name: "Fleur CBD ou résine CBD : quelles différences ?",
        path: "/blog/fleur-cbd-ou-resine-cbd-differences",
      },
    ],
    "/blog/indoor-greenhouse-hydroponique-differences": [
      { name: "Accueil", path: "/" },
      { name: "Guides CBD", path: "/blog" },
      {
        name: "Indoor, greenhouse ou hydroponique : comprendre les méthodes de culture",
        path: "/blog/indoor-greenhouse-hydroponique-differences",
      },
    ],
    "/fleurs-cbd": [
      { name: "Accueil", path: "/" },
      { name: "Fleurs CBD", path: "/fleurs-cbd" },
    ],
    "/resines-cbd": [
      { name: "Accueil", path: "/" },
      { name: "Résines CBD", path: "/resines-cbd" },
    ],
    "/livraison-locale": [
      { name: "Accueil", path: "/" },
      { name: "Livraison locale Aix-en-Provence", path: "/livraison-locale" },
    ],
    "/livraison-postale": [
      { name: "Accueil", path: "/" },
      { name: "Livraison postale", path: "/livraison-postale" },
    ],
    "/qualite-conformite": [
      { name: "Accueil", path: "/" },
      { name: "Qualité & conformité", path: "/qualite-conformite" },
    ],
    "/a-propos": [
      { name: "Accueil", path: "/" },
      { name: "A propos", path: "/a-propos" },
    ],
    "/faq": [
      { name: "Accueil", path: "/" },
      { name: "FAQ", path: "/faq" },
    ],
    "/contact": [
      { name: "Accueil", path: "/" },
      { name: "Contact", path: "/contact" },
    ],
    "/mentions-legales": [
      { name: "Accueil", path: "/" },
      { name: "Informations legales", path: "/mentions-legales" },
    ],
    "/cgv": [
      { name: "Accueil", path: "/" },
      { name: "Informations legales", path: "/mentions-legales" },
      { name: "Conditions générales de vente", path: "/cgv" },
    ],
    "/confidentialite": [
      { name: "Accueil", path: "/" },
      { name: "Informations legales", path: "/mentions-legales" },
      { name: "Politique de confidentialité", path: "/confidentialite" },
    ],
    "/retours": [
      { name: "Accueil", path: "/" },
      { name: "Informations legales", path: "/mentions-legales" },
      { name: "Politique de retour", path: "/retours" },
    ],
  };

  return map[path] || [];
}

function outputPathForRoute(path: string) {
  if (path === "/") return join(distDir, "index.html");
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const cleanUrlFile = join(distDir, `${normalized}.html`);
  if (existsSync(cleanUrlFile)) return cleanUrlFile;
  return join(distDir, `${normalized}/index.html`);
}

function nodeByType(nodes: Record<string, JsonLdValue>[], type: string) {
  return nodes.find((node) => node["@type"] === type);
}

function expectCount(
  counts: Record<string, number>,
  type: string,
  expected: number,
  failures: string[],
) {
  const actual = counts[type] || 0;
  if (actual !== expected) failures.push(`${type} count ${actual}, expected ${expected}`);
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

function isRecord(value: unknown): value is Record<string, JsonLdValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
