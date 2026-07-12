import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";

const distDir = resolve("dist");
const srcDir = resolve("src");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const failures: string[] = [];

auditStaticFiles();

if (existsSync(resolve(distDir, "index.html"))) {
  auditPrerenderedAnalyticsHtml();
  await auditRuntimeConsent();
} else {
  failures.push("dist/index.html is missing; run npm run build before audit:analytics");
}

if (failures.length) {
  console.error("\nAnalytics audit failures:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Analytics audit passed.");
}

function auditStaticFiles() {
  const indexHtml = readFileSync(resolve("index.html"), "utf8");
  const analyticsSource = readFileSync(resolve(srcDir, "lib", "analytics.ts"), "utf8");
  const gtmSource = readFileSync(resolve(srcDir, "lib", "googleTagManager.ts"), "utf8");
  const consentSource = readFileSync(resolve(srcDir, "context", "ConsentContext.tsx"), "utf8");
  const checkoutSuccessSource = readFileSync(resolve(srcDir, "pages", "CheckoutSuccessPage.tsx"), "utf8");
  const checkoutSource = readFileSync(resolve(srcDir, "pages", "CheckoutPage.tsx"), "utf8");
  const privacySource = readFileSync(resolve(srcDir, "pages", "LegalPage.tsx"), "utf8");
  const layoutSource = readFileSync(resolve(srcDir, "layouts", "MainLayout.tsx"), "utf8");
  const bannerSource = readFileSync(resolve(srcDir, "components", "CookieConsentBanner.tsx"), "utf8");
  const envExample = readFileSync(resolve(".env.example"), "utf8");

  if (!envExample.includes('VITE_GTM_ID="GTM-W76PFW2X"')) failures.push(".env.example missing VITE_GTM_ID");
  if (!envExample.includes('VITE_GA4_MEASUREMENT_ID="G-E9XNP7BJ2Y"')) {
    failures.push(".env.example missing VITE_GA4_MEASUREMENT_ID");
  }
  if (!gtmSource.includes("GTM-W76PFW2X") || !gtmSource.includes("G-E9XNP7BJ2Y")) {
    failures.push("GTM/GA4 public fallbacks are missing");
  }
  if (/googletagmanager\.com\/gtm\.js/.test(indexHtml)) failures.push("index.html contains a static GTM script");
  if (/<noscript/i.test(indexHtml) && /googletagmanager/i.test(indexHtml)) {
    failures.push("index.html contains a GTM noscript iframe");
  }
  if (!consentSource.includes("removeAnalyticsCookies")) {
    failures.push("consent withdrawal does not remove analytics cookies");
  }
  if (!analyticsSource.includes("order_submitted")) failures.push("order_submitted is missing");
  if (/trackEvent\(\s*["']purchase["']/.test(checkoutSuccessSource + checkoutSource)) {
    failures.push("client purchase event is still tracked in checkout pages");
  }
  if (!checkoutSource.includes("trackOrderSubmitted")) failures.push("CheckoutPage does not track order_submitted");
  for (const forbidden of ["customer.email", "customer.phone", "user.uid", "firebaseUid"]) {
    if (analyticsSource.includes(forbidden)) failures.push(`analytics source references PII marker: ${forbidden}`);
  }
  for (const required of [
    "Google Tag Manager",
    "Google Analytics 4",
    "Gérer mes cookies",
    "désactivée par défaut",
    "n'incluent pas les données de formulaire",
  ]) {
    if (!privacySource.includes(required)) failures.push(`privacy page missing: ${required}`);
  }
  if (!layoutSource.includes("Gérer mes cookies")) failures.push("footer cookie preferences link missing");
  for (const requiredButton of ["Tout accepter", "Tout refuser", "Personnaliser"]) {
    if (!bannerSource.includes(requiredButton)) failures.push(`cookie banner missing ${requiredButton}`);
  }
  if (!packageJson.scripts?.["audit:analytics"]) failures.push("missing npm script audit:analytics");
}

function auditPrerenderedAnalyticsHtml() {
  const privacyHtmlPath = resolve(distDir, "confidentialite", "index.html");
  if (!existsSync(privacyHtmlPath)) {
    failures.push("prerendered privacy HTML is missing");
    return;
  }

  const privacyHtml = readFileSync(privacyHtmlPath, "utf8");
  for (const required of [
    "Mesure d'audience et cookies",
    "Google Tag Manager",
    "Google Analytics 4",
    "désactivée par défaut",
    "n'incluent pas les données de formulaire",
  ]) {
    if (!privacyHtml.includes(required)) {
      failures.push(`prerendered privacy HTML missing: ${required}`);
    }
  }
}

async function auditRuntimeConsent() {
  const port = await findOpenPort(5190);
  const server = createStaticServer(distDir);
  await new Promise<void>((resolveServer) => server.listen(port, "127.0.0.1", resolveServer));
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext();
    const googleRequests: string[] = [];
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.includes("googletagmanager.com") || url.includes("google-analytics.com")) {
        googleRequests.push(url);
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: "window.__verdanzaMockGtmLoaded = (window.__verdanzaMockGtmLoaded || 0) + 1;",
        });
        return;
      }
      await route.continue();
    });

    await assertFreshSession(context, baseUrl, googleRequests);
    await assertRejectFlow(context, baseUrl, googleRequests);
    await assertAcceptAndWithdrawFlow(context, baseUrl, googleRequests);
    await context.close();
  } finally {
    await browser.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

async function assertFreshSession(context: BrowserContext, baseUrl: string, googleRequests: string[]) {
  googleRequests.length = 0;
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "load" });
  if (!(await page.getByRole("heading", { name: "Accès réservé aux majeurs" }).count())) {
    failures.push("AgeGate is not visible on a fresh session");
  }
  if (googleRequests.length) failures.push("Google request fired before age/consent choice");
  if ((await analyticsCookieCount(context)) !== 0) failures.push("_ga cookie exists before consent");
  await page.getByRole("button", { name: "J'ai 18 ans ou plus" }).click();
  if (!(await page.getByText("Cookies et mesure d'audience").count())) {
    failures.push("cookie banner is not visible after age confirmation");
  }
  if (googleRequests.length) failures.push("Google request fired before consent decision");
  await page.close();
}

async function assertRejectFlow(context: BrowserContext, baseUrl: string, googleRequests: string[]) {
  googleRequests.length = 0;
  await context.clearCookies();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.getByRole("button", { name: "J'ai 18 ans ou plus" }).click();
  await page.getByRole("button", { name: "Tout refuser" }).click();
  await page.getByRole("link", { name: "Boutique", exact: true }).click();
  await page.waitForURL("**/boutique");
  if (googleRequests.length) failures.push("Google request fired after reject all");
  if ((await analyticsCookieCount(context)) !== 0) failures.push("_ga cookie exists after reject all");
  await page.goto(`${baseUrl}/produits/golden-static`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Ajouter 1 g au panier" }).click();
  await page.goto(`${baseUrl}/panier`, { waitUntil: "load" });
  if (!(await page.getByText("Golden Static").count())) failures.push("cart is not usable after reject all");
  await page.close();
}

async function assertAcceptAndWithdrawFlow(context: BrowserContext, baseUrl: string, googleRequests: string[]) {
  googleRequests.length = 0;
  await context.clearCookies();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.getByRole("button", { name: "J'ai 18 ans ou plus" }).click();
  await page.getByRole("button", { name: "Tout accepter" }).click();
  await page.waitForFunction(() => window.localStorage.getItem("verdanza-consent-v1")?.includes('"analytics":true'));
  await page.waitForFunction(() => Boolean(document.querySelector('script[data-verdanza-gtm="GTM-W76PFW2X"]')));
  const gtmScriptCount = await page.locator('script[data-verdanza-gtm="GTM-W76PFW2X"]').count();
  if (gtmScriptCount !== 1) failures.push(`expected one GTM script after accept, got ${gtmScriptCount}`);
  if (googleRequests.filter((url) => url.includes("googletagmanager.com/gtm.js")).length !== 1) {
    failures.push("expected exactly one GTM request after accept");
  }
  await page.goto(`${baseUrl}/produits/golden-static`, { waitUntil: "load" });
  const dataLayerLength = await page.evaluate(() => window.dataLayer?.length || 0);
  await page.getByRole("button", { name: "Ajouter 1 g au panier" }).click();
  const dataLayerAfterEvent = await page.evaluate(() => window.dataLayer?.length || 0);
  if (dataLayerAfterEvent <= dataLayerLength) failures.push("analytics event was not pushed after accept");

  await page.getByRole("button", { name: "Gérer mes cookies" }).click();
  await page.getByRole("button", { name: "Tout refuser" }).click();
  await page.evaluate(() => {
    document.cookie = "_ga=test; path=/";
    document.cookie = "_ga_TEST=test; path=/";
  });
  await page.getByRole("button", { name: "Gérer mes cookies" }).click();
  await page.getByRole("button", { name: "Tout refuser" }).click();
  if ((await analyticsCookieCount(context)) !== 0) failures.push("_ga cookies were not removed after withdrawal");
  const dataLayerBeforeBlockedEvent = await page.evaluate(() => window.dataLayer?.length || 0);
  await page.goto(`${baseUrl}/produits/golden-static`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Ajouter 1 g au panier" }).click();
  const dataLayerAfterBlockedEvent = await page.evaluate(() => window.dataLayer?.length || 0);
  if (dataLayerAfterBlockedEvent > dataLayerBeforeBlockedEvent + 1) {
    failures.push("new ecommerce events were not blocked after withdrawal");
  }
  await page.close();
}

async function analyticsCookieCount(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies.filter((cookie) => cookie.name === "_ga" || cookie.name.startsWith("_ga_")).length;
}

function createStaticServer(root: string) {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const file = resolveStaticPath(root, decodeURIComponent(url.pathname));
      const content = readFileSync(file);
      const status = file.endsWith("404.html") ? 404 : 200;
      response.writeHead(status, { "content-type": contentType(file) });
      response.end(content);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Static server error");
    }
  });
}

function resolveStaticPath(root: string, pathname: string) {
  const safePath = pathname.replace(/^\/+/, "");
  const directPath = resolve(root, safePath);
  if (directPath.startsWith(root) && existsSync(directPath) && statSync(directPath).isFile()) return directPath;
  const htmlPath = resolve(root, `${safePath}.html`);
  if (htmlPath.startsWith(root) && existsSync(htmlPath)) return htmlPath;
  const indexPath = resolve(root, safePath, "index.html");
  if (indexPath.startsWith(root) && existsSync(indexPath)) return indexPath;
  return resolve(root, "404.html");
}

function contentType(filePath: string) {
  const extension = extname(filePath);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".webp") return "image/webp";
  if (extension === ".png") return "image/png";
  return "application/octet-stream";
}

async function findOpenPort(start: number) {
  for (let candidate = start; candidate < start + 100; candidate += 1) {
    if (await canListen(candidate)) return candidate;
  }
  throw new Error("No open port found for analytics audit.");
}

function canListen(portToCheck: number) {
  return new Promise<boolean>((resolveCheck) => {
    const probe = createServer();
    probe.once("error", () => resolveCheck(false));
    probe.once("listening", () => probe.close(() => resolveCheck(true)));
    probe.listen(portToCheck, "127.0.0.1");
  });
}
