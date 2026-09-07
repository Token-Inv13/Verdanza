import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const USER_AGENT = "Verdanza-PostDeploy-QA/1.0 (+https://verdanza.fr)";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_CONCURRENCY = 4;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_BRAND_ASSETS = 16;
const EXPECTED_MANIFEST_NAME = "Verdanza CBD";
const EXPECTED_MANIFEST_SHORT_NAME = "Verdanza";
const ROOT = new URL("../", import.meta.url);

const categories = new Map(
  [
    "Homepage",
    "Robots",
    "Sitemap",
    "Public routes",
    "Canonicals",
    "Structured data",
    "Blog",
    "PWA / branding",
  ].map((name) => [name, { failures: [], warnings: [] }]),
);
let requestCount = 0;

const baseUrl = parseBaseUrl(readArgument("--base-url"));
console.log("VERDANZA POST-DEPLOY QA");
console.log(`Target: ${baseUrl.href}`);
console.log(`Policy: GET/HEAD only, ${MAX_CONCURRENCY} concurrent requests, ${REQUEST_TIMEOUT_MS} ms timeout`);
console.log("");

const [homepage, robots, sitemap] = await Promise.all([
  request(baseUrl, { method: "GET", maxBytes: MAX_HTML_BYTES }),
  request(new URL("/robots.txt", baseUrl), { method: "GET", maxBytes: MAX_METADATA_BYTES }),
  request(new URL("/sitemap.xml", baseUrl), { method: "GET", maxBytes: MAX_METADATA_BYTES }),
]);

expectHttp("Homepage", baseUrl, "homepage HTTP status", homepage, 200);
auditRobots(robots);

let remoteSitemapUrls = [];
let localSitemapUrls = [];
if (expectHttp("Sitemap", new URL("/sitemap.xml", baseUrl), "sitemap HTTP status", sitemap, 200)) {
  remoteSitemapUrls = parseSitemap(sitemap.body, "public sitemap", "Sitemap");
}
try {
  const localSitemap = await readFile(fileURLToPath(new URL("public/sitemap.xml", ROOT)), "utf8");
  localSitemapUrls = parseSitemap(localSitemap, "repository sitemap", "Sitemap");
} catch (error) {
  fail("Sitemap", fileURLToPath(new URL("public/sitemap.xml", ROOT)), "repository sitemap", "readable tracked sitemap", errorMessage(error));
}

auditSitemap(remoteSitemapUrls, localSitemapUrls);

const pageResults = new Map();
pageResults.set("/", homepage);
await mapLimited(
  remoteSitemapUrls.filter((url) => normalizePath(url.pathname) !== "/"),
  MAX_CONCURRENCY,
  async (sitemapUrl) => {
    const target = targetUrl(sitemapUrl.pathname);
    const result = await request(target, { method: "GET", maxBytes: MAX_HTML_BYTES });
    pageResults.set(normalizePath(sitemapUrl.pathname), result);
  },
);

auditPublicRoutes(remoteSitemapUrls, pageResults);
auditCanonicals(remoteSitemapUrls, pageResults);
const structuredByPath = auditStructuredData(remoteSitemapUrls, pageResults);
auditBlog(remoteSitemapUrls, pageResults, structuredByPath);
await auditPwaAndBranding(homepage, structuredByPath.get("/") ?? []);

printSummary();

function readArgument(name) {
  const direct = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseBaseUrl(rawValue) {
  if (!rawValue?.trim()) {
    console.error("Missing required --base-url. Example: npm run postdeploy:check -- --base-url https://verdanza.fr");
    process.exit(2);
  }
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    console.error(`Invalid --base-url: ${rawValue}`);
    process.exit(2);
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    console.error(`Invalid --base-url protocol: ${parsed.protocol}. Expected http: or https:.`);
    process.exit(2);
  }
  if (parsed.username || parsed.password) {
    console.error("Invalid --base-url: embedded credentials are forbidden.");
    process.exit(2);
  }
  if (parsed.search || parsed.hash || normalizePath(parsed.pathname) !== "/") {
    console.error("Invalid --base-url: expected an origin URL without path, query, or fragment.");
    process.exit(2);
  }
  return new URL(`${parsed.origin}/`);
}

async function request(url, { method, maxBytes = 0 }) {
  if (!new Set(["GET", "HEAD"]).has(method)) {
    throw new Error(`Forbidden HTTP method: ${method}`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    return { error: `unsafe URL rejected: ${url.href}` };
  }
  requestCount += 1;
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      headers: {
        Accept: method === "HEAD" ? "*/*" : "text/html,application/xml,application/json;q=0.9,*/*;q=0.1",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = method === "GET" ? await readBody(response, maxBytes) : "";
    return {
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") ?? "",
      body,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function readBody(response, maxBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (maxBytes && byteLength > maxBytes) {
      await reader.cancel();
      throw new Error(`response body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function auditRobots(result) {
  const url = new URL("/robots.txt", baseUrl);
  if (!expectHttp("Robots", url, "robots HTTP status", result, 200)) return;
  const body = result.body;
  expect("Robots", url, "wildcard crawler policy", /user-agent\s*:\s*\*/i.test(body), "User-agent: *", compact(body));
  expect("Robots", url, "site-wide crawl policy", !/^\s*disallow\s*:\s*\/\s*$/im.test(body), "no Disallow: /", compact(body));
  const sitemapDirective = body.match(/^\s*sitemap\s*:\s*(\S+)\s*$/im)?.[1];
  expect("Robots", url, "sitemap directive", Boolean(sitemapDirective), `${baseUrl.origin}/sitemap.xml`, sitemapDirective ?? "missing");
  if (sitemapDirective) {
    expect("Robots", url, "sitemap directive target", sitemapDirective === `${baseUrl.origin}/sitemap.xml`, `${baseUrl.origin}/sitemap.xml`, sitemapDirective);
  }
}

function parseSitemap(xml, label, category) {
  const source = xml.trim();
  if (!source.startsWith("<?xml") || !/<urlset\b/i.test(source) || !/<\/urlset>\s*$/i.test(source)) {
    fail(category, new URL("/sitemap.xml", baseUrl), `${label} structure`, "well-formed urlset XML", compact(source));
    return [];
  }
  const urlBlocks = [...source.matchAll(/<url>([\s\S]*?)<\/url>/gi)];
  const locValues = urlBlocks.map((match) => match[1].match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]?.trim());
  if (!urlBlocks.length || locValues.some((value) => !value)) {
    fail(category, new URL("/sitemap.xml", baseUrl), `${label} entries`, "one non-empty loc per url", `${urlBlocks.length} url blocks`);
    return [];
  }
  const urls = [];
  for (const encodedValue of locValues) {
    const value = decodeEntities(encodedValue);
    try {
      urls.push(new URL(value));
    } catch {
      fail(category, new URL("/sitemap.xml", baseUrl), `${label} URL`, "valid absolute URL", value);
    }
  }
  return urls;
}

function auditSitemap(remoteUrls, localUrls) {
  const sitemapUrl = new URL("/sitemap.xml", baseUrl);
  expect("Sitemap", sitemapUrl, "remote sitemap entries", remoteUrls.length > 0, "> 0 URLs", remoteUrls.length);
  const seen = new Set();
  for (const url of remoteUrls) {
    const normalized = url.href;
    if (seen.has(normalized)) {
      fail("Sitemap", sitemapUrl, "duplicate URL", "unique URL", normalized);
    }
    seen.add(normalized);
    expect("Sitemap", url, "URL origin", url.origin === baseUrl.origin, baseUrl.origin, url.origin);
    expect("Sitemap", url, "URL protocol", baseUrl.protocol !== "https:" || url.protocol === "https:", "https:", url.protocol);
    expect("Sitemap", url, "URL query and fragment", !url.search && !url.hash, "none", `${url.search}${url.hash}` || "none");
  }
  const remotePaths = new Set(remoteUrls.map((url) => normalizePath(url.pathname)));
  const localPaths = new Set(localUrls.map((url) => normalizePath(url.pathname)));
  for (const path of localPaths) {
    if (!remotePaths.has(path)) fail("Sitemap", targetUrl(path), "repository URL deployed", "present in public sitemap", "missing");
  }
  for (const path of remotePaths) {
    if (!localPaths.has(path)) warn("Sitemap", targetUrl(path), "public URL tracked locally", "present in repository sitemap", "extra public URL");
  }
}

function auditPublicRoutes(sitemapUrls, results) {
  const paths = sitemapUrls.map((url) => normalizePath(url.pathname));
  const productPath = paths.find((path) => path.startsWith("/produits/"));
  const criticalPaths = ["/", "/blog", "/livraison-locale", productPath, "/concours"].filter(Boolean);
  for (const criticalPath of criticalPaths) {
    expect("Public routes", targetUrl(criticalPath), "critical route listed", paths.includes(criticalPath), "present in sitemap", "missing");
  }
  for (const path of paths) {
    expectHttp("Public routes", targetUrl(path), "sitemap route HTTP status", results.get(path), 200);
  }
}

function auditCanonicals(sitemapUrls, results) {
  for (const sitemapUrl of sitemapUrls) {
    const path = normalizePath(sitemapUrl.pathname);
    const target = targetUrl(path);
    const result = results.get(path);
    if (!result || result.error || result.status !== 200) continue;
    const links = tags(result.body, "link").filter((attributes) => tokens(attributes.rel).includes("canonical"));
    expect("Canonicals", target, "canonical count", links.length === 1, "1", links.length);
    if (links.length === 1) {
      let canonical;
      try {
        canonical = new URL(links[0].href, target);
      } catch {
        fail("Canonicals", target, "canonical URL", "valid URL", links[0].href ?? "missing");
      }
      if (canonical) {
        expect("Canonicals", target, "canonical origin", canonical.origin === baseUrl.origin, baseUrl.origin, canonical.origin);
        expect("Canonicals", target, "canonical path", normalizePath(canonical.pathname) === path && !canonical.search && !canonical.hash, target.href, canonical.href);
      }
    }
    const robotsMeta = tags(result.body, "meta").find((attributes) => attributes.name?.toLowerCase() === "robots")?.content ?? "";
    expect("Canonicals", target, "indexability", !/\bnoindex\b/i.test(robotsMeta), "not noindex", robotsMeta || "no robots meta");
  }
}

function auditStructuredData(sitemapUrls, results) {
  const nodesByPath = new Map();
  for (const sitemapUrl of sitemapUrls) {
    const path = normalizePath(sitemapUrl.pathname);
    const target = targetUrl(path);
    const result = results.get(path);
    if (!result || result.error || result.status !== 200) continue;
    const extraction = extractJsonLd(result.body);
    nodesByPath.set(path, extraction.nodes);
    for (const message of extraction.errors) {
      fail("Structured data", target, "JSON-LD parsing", "valid JSON", message);
    }
    const types = extraction.nodes.flatMap((node) => asArray(node["@type"]));
    if (path === "/") {
      expectTypeCount("Structured data", target, types, "WebSite", 1);
      expectTypeCount("Structured data", target, types, "OnlineStore", 1);
    } else {
      expectTypeCount("Structured data", target, types, "BreadcrumbList", 1);
    }
    if (path.startsWith("/blog/")) expectTypeCount("Structured data", target, types, "BlogPosting", 1);
    if (path.startsWith("/produits/")) expectTypeCount("Structured data", target, types, "Product", 1);
  }
  return nodesByPath;
}

function auditBlog(sitemapUrls, results, structuredByPath) {
  const articlePaths = sitemapUrls
    .map((url) => normalizePath(url.pathname))
    .filter((path) => path.startsWith("/blog/"));
  expect("Blog", targetUrl("/blog"), "published article routes", articlePaths.length > 0, "> 0", articlePaths.length);
  for (const path of articlePaths) {
    const target = targetUrl(path);
    const result = results.get(path);
    if (!expectHttp("Blog", target, "article HTTP status", result, 200)) continue;
    const canonical = canonicalLinks(result.body)[0];
    expect("Blog", target, "article canonical", canonical === target.href, target.href, canonical ?? "missing");
    const robotsMeta = tags(result.body, "meta").find((attributes) => attributes.name?.toLowerCase() === "robots")?.content ?? "";
    expect("Blog", target, "article indexability", !/\bnoindex\b/i.test(robotsMeta), "not noindex", robotsMeta || "no robots meta");
    const types = (structuredByPath.get(path) ?? []).flatMap((node) => asArray(node["@type"]));
    expectTypeCount("Blog", target, types, "BlogPosting", 1);
    expectTypeCount("Blog", target, types, "BreadcrumbList", 1);
  }
}

async function auditPwaAndBranding(homepageResult, homeNodes) {
  if (!homepageResult || homepageResult.error || homepageResult.status !== 200) {
    fail("PWA / branding", baseUrl, "homepage metadata", "available", homepageResult?.error ?? homepageResult?.status ?? "missing");
    return;
  }
  const linkTags = tags(homepageResult.body, "link");
  const manifestHref = linkTags.find((attributes) => tokens(attributes.rel).includes("manifest"))?.href;
  expect("PWA / branding", baseUrl, "manifest declaration", Boolean(manifestHref), "link rel=manifest", "missing");

  let manifest;
  if (manifestHref) {
    const manifestUrl = safeAssetUrl(manifestHref, baseUrl, "manifest URL");
    if (manifestUrl) {
      const result = await request(manifestUrl, { method: "GET", maxBytes: MAX_METADATA_BYTES });
      if (expectHttp("PWA / branding", manifestUrl, "manifest HTTP status", result, 200)) {
        try {
          manifest = JSON.parse(result.body);
        } catch (error) {
          fail("PWA / branding", manifestUrl, "manifest parsing", "valid JSON", errorMessage(error));
        }
      }
    }
  }

  const iconLinks = linkTags.filter((attributes) => tokens(attributes.rel).some((token) => token === "icon" || token === "apple-touch-icon" || token === "mask-icon"));
  expect("PWA / branding", baseUrl, "primary favicon", iconLinks.some((attributes) => tokens(attributes.rel).includes("icon")), "declared", "missing");

  const assetCandidates = iconLinks.map((attributes) => attributes.href).filter(Boolean);
  if (manifest) {
    expect("PWA / branding", new URL(manifestHref, baseUrl), "manifest name", manifest.name === EXPECTED_MANIFEST_NAME, EXPECTED_MANIFEST_NAME, manifest.name ?? "missing");
    expect("PWA / branding", new URL(manifestHref, baseUrl), "manifest short name", manifest.short_name === EXPECTED_MANIFEST_SHORT_NAME, EXPECTED_MANIFEST_SHORT_NAME, manifest.short_name ?? "missing");
    expect("PWA / branding", new URL(manifestHref, baseUrl), "manifest display", manifest.display === "standalone", "standalone", manifest.display ?? "missing");
    expect("PWA / branding", new URL(manifestHref, baseUrl), "manifest essential icons", Array.isArray(manifest.icons) && manifest.icons.length >= 2, ">= 2", Array.isArray(manifest.icons) ? manifest.icons.length : "missing");
    for (const icon of Array.isArray(manifest.icons) ? manifest.icons : []) {
      if (typeof icon?.src === "string") assetCandidates.push(icon.src);
    }
  }

  for (const meta of tags(homepageResult.body, "meta")) {
    if (new Set(["og:image", "twitter:image"]).has(meta.property ?? meta.name)) assetCandidates.push(meta.content);
  }
  const onlineStore = homeNodes.find((node) => asArray(node["@type"]).includes("OnlineStore"));
  if (typeof onlineStore?.logo === "string") assetCandidates.push(onlineStore.logo);

  const assetUrls = [];
  for (const candidate of assetCandidates) {
    if (!candidate) continue;
    const assetUrl = safeAssetUrl(candidate, baseUrl, "branding asset URL");
    if (assetUrl && !assetUrls.some((url) => url.href === assetUrl.href)) assetUrls.push(assetUrl);
  }
  if (assetUrls.length > MAX_BRAND_ASSETS) {
    warn("PWA / branding", baseUrl, "branding asset limit", `<= ${MAX_BRAND_ASSETS}`, assetUrls.length);
  }
  await mapLimited(assetUrls.slice(0, MAX_BRAND_ASSETS), MAX_CONCURRENCY, async (assetUrl) => {
    const result = await request(assetUrl, { method: "HEAD" });
    expectHttp("PWA / branding", assetUrl, "branding asset HTTP status", result, 200);
  });
}

function safeAssetUrl(value, contextUrl, control) {
  let url;
  try {
    url = new URL(value, contextUrl);
  } catch {
    fail("PWA / branding", contextUrl, control, "valid URL", value);
    return undefined;
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    fail("PWA / branding", url, control, "safe HTTP(S) URL", url.href);
    return undefined;
  }
  expect("PWA / branding", url, `${control} origin`, url.origin === baseUrl.origin, baseUrl.origin, url.origin);
  return url;
}

function extractJsonLd(html) {
  const nodes = [];
  const errors = [];
  const scripts = tagsWithBody(html, "script").filter(({ attributes }) => attributes.type?.toLowerCase() === "application/ld+json");
  for (const script of scripts) {
    try {
      nodes.push(...flattenJsonLd(JSON.parse(script.body.trim())));
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  return { nodes, errors };
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const current = value["@type"] ? [value] : [];
  return Array.isArray(value["@graph"])
    ? [...current, ...value["@graph"].flatMap(flattenJsonLd)]
    : current;
}

function canonicalLinks(html) {
  return tags(html, "link")
    .filter((attributes) => tokens(attributes.rel).includes("canonical"))
    .map((attributes) => {
      try {
        return new URL(attributes.href, baseUrl).href;
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

function tags(html, name) {
  const pattern = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return [...html.matchAll(pattern)].map((match) => parseAttributes(match[0]));
}

function tagsWithBody(html, name) {
  const pattern = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, "gi");
  return [...html.matchAll(pattern)].map((match) => ({
    attributes: parseAttributes(match[1]),
    body: match[2],
  }));
}

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[3]);
  }
  return attributes;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function tokens(value = "") {
  return value.toLowerCase().split(/\s+/).filter(Boolean);
}

function targetUrl(path) {
  return new URL(normalizePath(path), baseUrl);
}

function normalizePath(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

function expectHttp(category, url, control, result, expectedStatus) {
  if (!result) {
    fail(category, url, control, expectedStatus, "missing result");
    return false;
  }
  if (result.error) {
    fail(category, url, control, expectedStatus, result.error);
    return false;
  }
  const success = result.status === expectedStatus;
  expect(category, url, control, success, expectedStatus, result.status);
  if (result.finalUrl) {
    let final;
    try {
      final = new URL(result.finalUrl);
    } catch {
      fail(category, url, `${control} final URL`, "valid URL", result.finalUrl);
    }
    if (final) expect(category, url, `${control} final origin`, final.origin === baseUrl.origin, baseUrl.origin, final.origin);
  }
  return success;
}

function expectTypeCount(category, url, types, type, expectedCount) {
  const count = types.filter((value) => value === type).length;
  expect(category, url, `${type} count`, count === expectedCount, expectedCount, count);
}

function expect(category, url, control, condition, expected, actual) {
  if (!condition) fail(category, url, control, expected, actual);
  return condition;
}

function fail(category, url, control, expected, actual) {
  categories.get(category).failures.push({ url: String(url), control, expected: String(expected), actual: String(actual) });
}

function warn(category, url, control, expected, actual) {
  categories.get(category).warnings.push({ url: String(url), control, expected: String(expected), actual: String(actual) });
}

async function mapLimited(items, concurrency, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const itemIndex = index;
      index += 1;
      await worker(items[itemIndex], itemIndex);
    }
  });
  await Promise.all(runners);
}

function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function compact(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 180) || "empty";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function printSummary() {
  const details = [];
  for (const [name, result] of categories) {
    const status = result.failures.length ? "FAIL" : result.warnings.length ? "WARN" : "PASS";
    console.log(`${name.padEnd(25, ".")} ${status}`);
    details.push(...result.failures.map((entry) => ({ severity: "FAIL", ...entry })), ...result.warnings.map((entry) => ({ severity: "WARN", ...entry })));
  }
  const hasFailures = details.some((entry) => entry.severity === "FAIL");
  const hasWarnings = details.some((entry) => entry.severity === "WARN");
  const globalStatus = hasFailures ? "FAIL" : hasWarnings ? "WARN" : "PASS";
  console.log("");
  console.log(`Requests ................. ${requestCount}`);
  console.log(`GLOBAL ${"".padEnd(18, ".")} ${globalStatus}`);
  if (details.length) {
    console.log("");
    console.log("DETAILS");
    for (const detail of details) {
      console.log(`[${detail.severity}] URL: ${detail.url}`);
      console.log(`  Control: ${detail.control}`);
      console.log(`  Expected: ${detail.expected}`);
      console.log(`  Actual: ${detail.actual}`);
    }
  }
  if (hasFailures) process.exitCode = 1;
}
