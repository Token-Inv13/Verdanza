import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { chromium } from "playwright";
import {
  canonicalUrl,
  fallbackSeoRoute,
  prerenderFallbackSeoRoutes,
  prerenderSeoRoutes,
  type SeoRoute,
} from "./seoRoutes";

const distDir = resolve("dist");
const indexPath = join(distDir, "index.html");
const port = await findOpenPort(5180);
const outputFiles = new Map<string, string>();

if (!existsSync(indexPath)) {
  throw new Error("dist/index.html is missing. Run vite build before prerender.");
}

const indexHtmlShell = readFileSync(indexPath);
const server = createStaticServer(distDir, indexPath, indexHtmlShell);

await new Promise<void>((resolveServer) => {
  server.listen(port, "127.0.0.1", resolveServer);
});

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    javaScriptEnabled: true,
    serviceWorkers: "block",
  });
  await blockExternalServices(context);

  for (const route of prerenderSeoRoutes()) {
    await renderRoute(context, route, outputPathForRoute(route.path));
  }
  for (const route of prerenderFallbackSeoRoutes()) {
    await renderRoute(context, route, outputPathForRoute(route.path));
  }

  await renderRoute(context, fallbackSeoRoute(), join(distDir, "404.html"), {
    expectedIndexable: false,
    expectedCanonicalPath: "/route-introuvable-test",
  });
} finally {
  await browser.close();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

console.log(`Prerendered ${outputFiles.size} HTML files in dist.`);

async function renderRoute(
  context: import("playwright").BrowserContext,
  route: SeoRoute,
  outputPath: string,
  options: { expectedIndexable?: boolean; expectedCanonicalPath?: string } = {},
) {
  if (outputFiles.has(outputPath)) {
    throw new Error(
      `Duplicate prerender output for ${route.path}: ${outputPath} already used by ${outputFiles.get(outputPath)}`,
    );
  }

  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto(`http://127.0.0.1:${port}${route.path}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("h1", { timeout: 10000 });
  await page.waitForFunction(
    `() => !document.body.textContent?.includes("Chargement")`,
    undefined,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    `() => Boolean(
      document.title &&
      document.querySelector('meta[name="description"]')?.content &&
      document.querySelector('link[rel="canonical"]')?.href &&
      document.querySelector('meta[name="robots"]')?.content
    )`,
    undefined,
    { timeout: 10000 },
  );

  const html = await page.evaluate(
    `(() => "<!doctype html>\\n" + document.documentElement.outerHTML)()`,
  );
  const checks = await page.evaluate(`(() => {
    const meta = (selector) =>
      document.querySelector(selector)?.content || "";
    const property = (selector) =>
      document.querySelector(selector)?.content || "";
    return {
      title: document.title,
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      robots: meta('meta[name="robots"]'),
      ogTitle: property('meta[property="og:title"]'),
      ogDescription: property('meta[property="og:description"]'),
      ogUrl: property('meta[property="og:url"]'),
      ogType: property('meta[property="og:type"]'),
      twitterCard: meta('meta[name="twitter:card"]'),
      twitterTitle: meta('meta[name="twitter:title"]'),
      twitterDescription: meta('meta[name="twitter:description"]'),
      h1Count: document.querySelectorAll("h1").length,
      mainTextLength: document.querySelector("main")?.textContent?.trim().length || 0,
      bodyTextLength: document.body.textContent?.trim().length || 0,
      bodyText: document.body.textContent || "",
    };
  })()`);
  await page.close();

  const expectedIndexable = options.expectedIndexable ?? route.indexable;
  const expectedCanonical = canonicalUrl(options.expectedCanonicalPath || route.path);
  const expectCanonical = route.kind !== "fallback";
  const robotsNoindex = checks.robots.includes("noindex");
  const isAccountGate = route.kind === "private";
  const isAdminChildGate = route.kind === "admin" && route.path !== "/admin";
  const expectedCanonicalMatches =
    checks.canonical === expectedCanonical ||
    (isAccountGate && checks.canonical === canonicalUrl("/connexion")) ||
    (isAdminChildGate && checks.canonical === canonicalUrl("/admin"));

  assertNonEmpty(html, `HTML for ${route.path}`);
  assertNonEmpty(checks.title, `title for ${route.path}`);
  assertNonEmpty(checks.description, `description for ${route.path}`);
  if (expectCanonical) {
    assertNonEmpty(checks.canonical, `canonical for ${route.path}`);
  } else if (checks.canonical) {
    throw new Error(`Fallback route ${route.path} should not render a canonical.`);
  }
  assertNonEmpty(checks.robots, `robots for ${route.path}`);
  assertNonEmpty(checks.ogTitle, `og:title for ${route.path}`);
  assertNonEmpty(checks.ogDescription, `og:description for ${route.path}`);
  if (expectCanonical) {
    assertNonEmpty(checks.ogUrl, `og:url for ${route.path}`);
  } else if (checks.ogUrl) {
    throw new Error(`Fallback route ${route.path} should not render og:url.`);
  }
  assertNonEmpty(checks.ogType, `og:type for ${route.path}`);
  assertNonEmpty(checks.twitterCard, `twitter:card for ${route.path}`);
  assertNonEmpty(checks.twitterTitle, `twitter:title for ${route.path}`);
  assertNonEmpty(checks.twitterDescription, `twitter:description for ${route.path}`);

  if (expectCanonical && !expectedCanonicalMatches) {
    throw new Error(
      `Canonical mismatch for ${route.path}: expected ${expectedCanonical}, got ${checks.canonical}`,
    );
  }
  if (expectedIndexable && robotsNoindex) {
    throw new Error(`Indexable route ${route.path} rendered noindex.`);
  }
  if (!expectedIndexable && !robotsNoindex) {
    throw new Error(`Noindex route ${route.path} did not render noindex.`);
  }
  if (checks.h1Count !== 1) {
    throw new Error(`Expected one H1 for ${route.path}, found ${checks.h1Count}.`);
  }
  if (expectedIndexable && checks.mainTextLength < 20) {
    throw new Error(`Main content too short for ${route.path}.`);
  }
  if (!expectedIndexable && checks.bodyTextLength < 20) {
    throw new Error(`Body content too short for noindex route ${route.path}.`);
  }
  if (containsPrivateData(checks.bodyText)) {
    throw new Error(`Potential private data marker found in prerendered ${route.path}.`);
  }
  const unexpectedConsoleErrors = consoleErrors.filter(
    (error) => !isExpectedPrerenderNetworkError(error),
  );
  if (unexpectedConsoleErrors.length) {
    throw new Error(
      `Console errors while prerendering ${route.path}: ${unexpectedConsoleErrors.join(" | ")}`,
    );
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf8");
  const cleanUrlPath = cleanUrlOutputPathForRoute(route.path);
  if (cleanUrlPath && cleanUrlPath !== outputPath) {
    mkdirSync(dirname(cleanUrlPath), { recursive: true });
    writeFileSync(cleanUrlPath, html, "utf8");
  }
  outputFiles.set(outputPath, route.path);
}

function outputPathForRoute(path: string) {
  if (path === "/") return indexPath;
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return join(distDir, `${normalized}/index.html`);
}

function cleanUrlOutputPathForRoute(path: string) {
  if (path === "/") return indexPath;
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return join(distDir, `${normalized}.html`);
}

function assertNonEmpty(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}.`);
}

function containsPrivateData(text: string) {
  return [
    "verdanza:lastOrderSummary",
    "adminUsers.",
    "apiKey",
    "firebase-adminsdk",
  ].some((marker) => text.includes(marker));
}

function isExpectedPrerenderNetworkError(message: string) {
  return (
    message === "Failed to load resource: net::ERR_FAILED" ||
    (message.includes("@firebase/firestore") &&
      message.includes("Could not reach Cloud Firestore backend"))
  );
}

async function blockExternalServices(context: import("playwright").BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (
      url.includes("identitytoolkit.googleapis.com") ||
      url.includes("firebaseinstallations.googleapis.com") ||
      url.includes("firestore.googleapis.com") ||
      url.includes("google-analytics.com") ||
      url.includes("googletagmanager.com")
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

function createStaticServer(root: string, fallback: string, fallbackContent: Buffer) {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      const filePath = resolveStaticPath(root, pathname, fallback);
      const content = filePath === fallback ? fallbackContent : readFileSync(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(content);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Static server error");
    }
  });
}

function resolveStaticPath(root: string, pathname: string, fallback: string) {
  const safePath = pathname.replace(/^\/+/, "");
  if (!extname(safePath)) return fallback;

  const directPath = resolve(root, safePath);
  if (directPath.startsWith(root) && existsSync(directPath) && statSync(directPath).isFile()) {
    return directPath;
  }
  const indexFile = resolve(root, safePath, "index.html");
  if (indexFile.startsWith(root) && existsSync(indexFile)) return indexFile;
  return fallback;
}

function contentType(filePath: string) {
  const extension = extname(filePath);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function findOpenPort(start: number) {
  for (let candidate = start; candidate < start + 100; candidate += 1) {
    const available = await canListen(candidate);
    if (available) return candidate;
  }
  throw new Error("No open port found for prerender server.");
}

function canListen(portToCheck: number) {
  return new Promise<boolean>((resolveCheck) => {
    const probe = createServer();
    probe.once("error", () => resolveCheck(false));
    probe.once("listening", () => {
      probe.close(() => resolveCheck(true));
    });
    probe.listen(portToCheck, "127.0.0.1");
  });
}
