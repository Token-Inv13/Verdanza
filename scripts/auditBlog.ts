import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
  blogArticlePath,
  blogArticles,
  publishedBlogArticles,
} from "../src/data/blogArticles";
import { absoluteUrl } from "../src/lib/siteUrl";

const distDir = resolve("dist");
const publicDir = resolve("public");
const failures: string[] = [];
const published = publishedBlogArticles;
const sitemap = existsSync(resolve("public/sitemap.xml"))
  ? readFileSync(resolve("public/sitemap.xml"), "utf8")
  : "";
const articleMainTexts: string[] = [];

if (published.length !== 10) failures.push(`published article count ${published.length}, expected 10`);
expectUnique("slugs", published.map((article) => article.slug));
expectUnique("SEO titles", published.map((article) => article.seoTitle));
expectUnique("descriptions", published.map((article) => article.description));

auditBlogIndex();
for (const article of published) {
  await auditArticle(article);
}

for (const article of blogArticles.filter((entry) => entry.status === "draft")) {
  if (sitemap.includes(blogArticlePath(article))) {
    failures.push(`draft article in sitemap: ${article.slug}`);
  }
}

if (articleMainTexts.length === 2 && articleMainTexts[0] === articleMainTexts[1]) {
  failures.push("article bodies are exact duplicates");
}

if (failures.length) {
  console.error("Blog audit failures:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Blog audit passed for /blog and ${published.length} published article(s).`);
}

function auditBlogIndex() {
  const html = readHtml("blog.html");
  const main = mainHtml(html);
  if (!html) failures.push("/blog prerender missing");
  if (!sitemap.includes("<loc>https://verdanza.fr/blog</loc>")) failures.push("/blog missing from sitemap");
  if (jsonLdByType(html, "BlogPosting").length !== 0) failures.push("/blog contains BlogPosting");
  if (!main.includes("Guides CBD Verdanza")) failures.push("/blog H1 missing");
  for (const article of published) {
    if (!main.includes(blogArticlePath(article))) failures.push(`/blog missing article link ${article.slug}`);
  }
}

async function auditArticle(article: (typeof published)[number]) {
  const path = blogArticlePath(article);
  const html = readHtml(`blog/${article.slug}.html`);
  const main = mainHtml(html);
  const text = stripTags(main);
  articleMainTexts.push(text);
  const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  const robots = metaContent(html, "robots");
  const h1Count = (main.match(/<h1[\s>]/gi) || []).length;
  const h2Count = (main.match(/<h2[\s>]/gi) || []).length;
  const blogPosting = jsonLdByType(html, "BlogPosting");
  const breadcrumbs = jsonLdByType(html, "BreadcrumbList");
  const allJson = extractJsonLdScripts(html).map((entry) => JSON.stringify(entry)).join("\n");

  if (!html) failures.push(`${path} prerender missing`);
  if (!sitemap.includes(`<loc>${absoluteUrl(path)}</loc>`)) failures.push(`${path} missing from sitemap`);
  if (canonical !== absoluteUrl(path)) failures.push(`${path} canonical mismatch`);
  if (robots !== "index,follow") failures.push(`${path} robots mismatch`);
  if (h1Count !== 1) failures.push(`${path} h1 count ${h1Count}`);
  if (h2Count < 4) failures.push(`${path} h2 count ${h2Count}`);
  if (!main.includes(article.authorName)) failures.push(`${path} author missing`);
  if (!main.includes(article.readingTime)) failures.push(`${path} reading time missing`);
  if (!main.includes(`datetime="${article.datePublished}"`)) failures.push(`${path} published date mismatch`);
  if (new Date(article.dateModified).getTime() < new Date(article.datePublished).getTime()) {
    failures.push(`${path} dateModified before datePublished`);
  }
  if (Number.isNaN(new Date(article.datePublished).getTime())) failures.push(`${path} invalid published date`);
  if (Number.isNaN(new Date(article.dateModified).getTime())) failures.push(`${path} invalid modified date`);
  if (!main.includes(article.images.wide)) failures.push(`${path} main image missing`);
  if (blogPosting.length !== 1) failures.push(`${path} BlogPosting count ${blogPosting.length}`);
  if (breadcrumbs.length !== 1) failures.push(`${path} BreadcrumbList count ${breadcrumbs.length}`);
  if (/"@type":"Product"|"@type":"Offer"|"@type":"Review"|"@type":"AggregateRating"/.test(allJson)) {
    failures.push(`${path} forbidden commercial schema present`);
  }
  auditBlogPosting(article, blogPosting[0], path);
  await auditImages(article);
  auditLinks(article, main, path);
  auditText(text, path);
}

function auditBlogPosting(article: (typeof published)[number], node: Record<string, unknown> | undefined, path: string) {
  if (!node) return;
  if (node.headline !== article.title) failures.push(`${path} BlogPosting headline mismatch`);
  if (node.description !== article.description) failures.push(`${path} BlogPosting description mismatch`);
  if (node.datePublished !== article.datePublished) failures.push(`${path} BlogPosting datePublished mismatch`);
  if (node.dateModified !== article.dateModified) failures.push(`${path} BlogPosting dateModified mismatch`);
  if (node.inLanguage !== "fr-FR") failures.push(`${path} BlogPosting language mismatch`);
  const author = node.author as Record<string, unknown> | undefined;
  if (!author || author.name !== article.authorName) failures.push(`${path} BlogPosting author mismatch`);
}

async function auditImages(article: (typeof published)[number]) {
  const ratios = [
    [article.images.square, 1],
    [article.images.landscape, 4 / 3],
    [article.images.wide, 16 / 9],
  ] as const;
  for (const [url, expectedRatio] of ratios) {
    const file = resolve(publicDir, url.replace(/^\/+/, ""));
    if (!existsSync(file)) {
      failures.push(`${article.slug} missing image ${url}`);
      continue;
    }
    const metadata = await sharp(file).metadata();
    const ratio = (metadata.width || 0) / (metadata.height || 1);
    if (Math.abs(ratio - expectedRatio) > 0.02) failures.push(`${article.slug} image ratio mismatch ${url}`);
    if (statSync(file).size > 240 * 1024) failures.push(`${article.slug} image too large ${url}`);
  }
}

function auditLinks(article: (typeof published)[number], main: string, path: string) {
  for (const link of article.links) {
    if (!main.includes(`href="${link.to}"`)) failures.push(`${path} missing expected link ${link.to}`);
  }
  if (/href="\/(?:admin|compte|checkout|connexion|inscription|panier)(?:\/|")/.test(main)) {
    failures.push(`${path} private route link in article main`);
  }
}

function auditText(text: string, path: string) {
  const corrupted = ["Ãƒ", "Ã¢â‚¬â„¢", "ï¿½", "�"];
  if (corrupted.some((entry) => text.includes(entry))) failures.push(`${path} corrupted characters`);
  const forbidden = [
    /\bgu[ée]rit\b/i,
    /\bsoigne\b/i,
    /\btraitement\b/i,
    /\bantidouleur\b/i,
    /\banxi[ée]t[ée]\b/i,
    /\binsomnie\b/i,
    /\bd[ée]pression\b/i,
    /\banti-inflammatoire\b/i,
    /\bdosage recommand[ée]\b/i,
    /\beffets garantis\b/i,
    /\brelaxation garantie\b/i,
    /\bth[ée]rapeutique\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) failures.push(`${path} problematic medical wording: ${pattern}`);
  }
  const cbdCount = (text.match(/\bCBD\b/g) || []).length;
  if (cbdCount > 80) failures.push(`${path} excessive CBD repetition`);
}

function jsonLdByType(html: string, type: string) {
  return extractJsonLdScripts(html)
    .flatMap((value) => flattenJsonLd(value))
    .filter((node) => node["@type"] === type);
}

function extractJsonLdScripts(html: string) {
  return [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap((match) => {
    try {
      return [JSON.parse(decodeScriptJson(match[1].trim())) as Record<string, unknown>];
    } catch {
      failures.push("invalid JSON-LD");
      return [];
    }
  });
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

function readHtml(file: string) {
  const path = join(distDir, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function mainHtml(html: string) {
  return html.match(/<main[\s\S]*?<\/main>/i)?.[0] || "";
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

function expectUnique(label: string, values: string[]) {
  if (new Set(values).size !== values.length) failures.push(`duplicate ${label}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
