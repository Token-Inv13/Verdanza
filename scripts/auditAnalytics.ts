import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const distDir = resolve("dist");
const srcDir = resolve("src");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const failures: string[] = [];

type GoogleRequestLog = {
  gtm: string[];
  ga4: string[];
};

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
  const routeTrackerSource = readFileSync(resolve(srcDir, "components", "AnalyticsRouteTracker.tsx"), "utf8");
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
  if (!gtmSource.includes('window.gtag?.("config", ga4MeasurementId') || !gtmSource.includes("send_page_view: false")) {
    failures.push("GA4 target config without automatic page_view is missing");
  }
  if (!gtmSource.includes("isAnalyticsSuppressedPath") || !gtmSource.includes(".vercel.app")) {
    failures.push("analytics suppression for admin and Vercel preview hosts is missing");
  }
  if (!gtmSource.includes("ga-disable-${ga4MeasurementId}")) {
    failures.push("GA4 runtime disable flag is missing for suppressed analytics locations");
  }
  if (!gtmSource.includes("googletagmanager.com/gtag/js") || !gtmSource.includes("data-verdanza-ga4")) {
    failures.push("direct GA4 gtag loader after consent is missing");
  }
  if (/googletagmanager\.com\/gtm\.js/.test(indexHtml)) failures.push("index.html contains a static GTM script");
  if (/<noscript/i.test(indexHtml) && /googletagmanager/i.test(indexHtml)) {
    failures.push("index.html contains a GTM noscript iframe");
  }
  if (!consentSource.includes("removeAnalyticsCookies")) {
    failures.push("consent withdrawal does not remove analytics cookies");
  }
  if (!analyticsSource.includes('window.gtag?.("event", event') || !analyticsSource.includes("send_to: ga4MeasurementId")) {
    failures.push("trackEvent does not send consented events through gtag");
  }
  if (!analyticsSource.includes("isAnalyticsSuppressedLocation()")) {
    failures.push("trackEvent does not suppress admin or preview analytics events");
  }
  if (!routeTrackerSource.includes("isAnalyticsSuppressedLocation()")) {
    failures.push("AnalyticsRouteTracker does not suppress admin page_view events");
  }
  if (/dataLayer\.push\(\s*\{\s*event/.test(analyticsSource)) {
    failures.push("trackEvent still pushes analytics event objects into dataLayer");
  }
  if (!analyticsSource.includes("order_submitted")) failures.push("order_submitted is missing");
  if (!analyticsSource.includes('"cta_click"')) failures.push("cta_click is missing");
  if (!analyticsSource.includes("trackCtaClick")) failures.push("trackCtaClick helper is missing");
  if (!layoutSource.includes("trackCtaClick")) failures.push("MainLayout does not track acquisition CTAs");
  if (!analyticsSource.includes("payment_method_selected")) {
    failures.push("payment_method_selected is missing");
  }
  if (!analyticsSource.includes('"generate_lead"')) {
    failures.push("generate_lead is missing");
  }
  if (!analyticsSource.includes("lead_method:") || !analyticsSource.includes("lead_source:")) {
    failures.push("generate_lead does not expose its non-PII contact context");
  }
  if (!checkoutSource.includes("trackPaymentMethodSelected")) {
    failures.push("CheckoutPage does not track payment_method_selected");
  }
  if (!checkoutSource.includes("trackAddPaymentInfo")) {
    failures.push("CheckoutPage does not track add_payment_info for payment preference selection");
  }
  if (/trackEvent\(\s*["']purchase["']/.test(checkoutSuccessSource + checkoutSource)) {
    failures.push("client purchase event is still tracked in checkout pages");
  }
  if (!checkoutSource.includes("trackOrderSubmitted")) failures.push("CheckoutPage does not track order_submitted");
  if (!analyticsSource.includes("delivery_method: shippingTier")) {
    failures.push("shipping analytics does not expose delivery_method");
  }
  if (!analyticsSource.includes("delivery_zone: deliveryZone")) {
    failures.push("shipping analytics does not expose delivery_zone");
  }
  if (!analyticsSource.includes("preferred_payment_method: paymentMethod")) {
    failures.push("payment analytics does not expose preferred_payment_method");
  }
  if (!checkoutSource.includes("deliveryZone:")) {
    failures.push("order_submitted does not receive the selected delivery zone");
  }
  if (!analyticsSource.includes('"blog_shop_click"') || !analyticsSource.includes("trackBlogShopClick")) {
    failures.push("blog_shop_click helper is missing");
  }
  const blogArticleSource = readFileSync(resolve(srcDir, "pages", "BlogArticlePage.tsx"), "utf8");
  if (!blogArticleSource.includes("trackBlogShopClick") || !blogArticleSource.includes("isShopDestinationPath")) {
    failures.push("blog article shop links do not track blog_shop_click");
  }
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
    const googleRequests: GoogleRequestLog = { gtm: [], ga4: [] };
    await installGoogleRequestMock(context, googleRequests);

    await assertFreshSession(context, baseUrl, googleRequests);
    await assertRejectFlow(context, baseUrl, googleRequests);
    await assertAcceptAndWithdrawFlow(context, baseUrl, googleRequests);
    await context.close();
    await assertKnownVisitorFlow(browser, baseUrl);
  } finally {
    await browser.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

async function assertFreshSession(context: BrowserContext, baseUrl: string, googleRequests: GoogleRequestLog) {
  resetGoogleRequests(googleRequests);
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "load" });
  if (!(await page.getByRole("heading", { name: "Accès réservé aux majeurs" }).count())) {
    failures.push("AgeGate is not visible on a fresh session");
  }
  if (googleRequests.gtm.length || googleRequests.ga4.length) failures.push("Google request fired before age/consent choice");
  if ((await analyticsCookieCount(context)) !== 0) failures.push("_ga cookie exists before consent");
  await page.getByRole("button", { name: "J'ai 18 ans ou plus" }).click();
  if (!(await page.getByText("Cookies et mesure d'audience").waitFor({ timeout: 2000 }).then(() => true).catch(() => false))) {
    failures.push("cookie banner is not visible after age confirmation");
  }
  await assertPageScrollable(page, "after age confirmation before cookie choice");
  if (googleRequests.gtm.length || googleRequests.ga4.length) failures.push("Google request fired before consent decision");
  await page.close();
}

async function assertRejectFlow(context: BrowserContext, baseUrl: string, googleRequests: GoogleRequestLog) {
  resetGoogleRequests(googleRequests);
  await context.clearCookies();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.getByRole("button", { name: "J'ai 18 ans ou plus" }).click();
  await page.getByRole("button", { name: "Tout refuser" }).click();
  await assertPageScrollable(page, "after reject all");
  await page.getByRole("link", { name: "Boutique", exact: true }).click();
  await page.waitForURL("**/boutique");
  if (googleRequests.gtm.length || googleRequests.ga4.length) failures.push("Google request fired after reject all");
  if ((await analyticsCookieCount(context)) !== 0) failures.push("_ga cookie exists after reject all");
  await page.goto(`${baseUrl}/panier`, { waitUntil: "load" });
  if (!(await page.getByRole("heading", { name: "Panier" }).count())) {
    failures.push("cart page is not usable after reject all");
  }
  await page.close();
}

async function assertAcceptAndWithdrawFlow(context: BrowserContext, baseUrl: string, googleRequests: GoogleRequestLog) {
  resetGoogleRequests(googleRequests);
  await context.clearCookies();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.getByRole("button", { name: "J'ai 18 ans ou plus" }).click();
  await page.getByRole("button", { name: "Tout accepter" }).click();
  await page.waitForFunction(() => window.localStorage.getItem("verdanza-consent-v1")?.includes('"analytics":true'));
  await assertConsentCommandOrder(page, "after accept all before GTM is required");
  await page.waitForFunction(() => Boolean(document.querySelector('script[data-verdanza-gtm="GTM-W76PFW2X"]')));
  await assertConsentCommandOrder(page, "after GTM load");
  await assertPageScrollable(page, "after accept all");
  const gtmScriptCount = await page.locator('script[data-verdanza-gtm="GTM-W76PFW2X"]').count();
  if (gtmScriptCount !== 1) failures.push(`expected one GTM script after accept, got ${gtmScriptCount}`);
  if (googleRequests.gtm.length !== 1) {
    failures.push("expected exactly one GTM request after accept");
  }
  await waitForGa4Event(googleRequests, "page_view");
  await page.waitForTimeout(100);
  if (ga4EventCount(googleRequests, "page_view") !== 1) {
    failures.push(`expected one initial page_view after accept, got ${ga4EventCount(googleRequests, "page_view")}`);
  }

  await page.getByRole("link", { name: "Fleurs CBD", exact: true }).click();
  await page.waitForURL("**/fleurs-cbd");
  await waitForGa4Event(googleRequests, "cta_click");
  await assertNoObjectDataLayerEvent(page, "cta_click");
  await waitForGa4EventCount(googleRequests, "page_view", 2);
  await waitForGa4Event(googleRequests, "view_item_list");
  await assertNoObjectDataLayerEvent(page, "view_item_list");

  await page.getByRole("link", { name: "Cookie Kush Indoor", exact: true }).first().click();
  await page.waitForURL("**/produits/cookie-kush-indoor");
  await waitForGa4Event(googleRequests, "view_item");
  await assertNoObjectDataLayerEvent(page, "view_item");
  await page.getByRole("button", { name: "Ajouter 1 g au panier" }).click();
  await waitForGa4Event(googleRequests, "add_to_cart");
  await assertNoObjectDataLayerEvent(page, "add_to_cart");

  await page.getByRole("link", { name: "Panier" }).click();
  await page.waitForURL("**/panier");
  await waitForGa4Event(googleRequests, "view_cart");
  await assertNoObjectDataLayerEvent(page, "view_cart");

  await page.goto(`${baseUrl}/checkout`, { waitUntil: "load" });
  await waitForGa4Event(googleRequests, "begin_checkout");
  await waitForGa4Event(googleRequests, "payment_method_selected");
  await assertNoObjectDataLayerEvent(page, "begin_checkout");
  await assertNoObjectDataLayerEvent(page, "payment_method_selected");
  await assertAdminRouteDoesNotTrack(page, baseUrl, googleRequests, "after public consented navigation");

  await page.goto(`${baseUrl}/blog`, { waitUntil: "load" });
  await page.getByRole("link", { name: /Fleur CBD ou rÃ©sine CBD|Fleur CBD ou résine CBD/ }).first().click();
  await page.waitForURL("**/blog/fleur-cbd-ou-resine-cbd-differences");
  await waitForGa4Event(googleRequests, "blog_article_view");
  await assertNoObjectDataLayerEvent(page, "blog_article_view");

  await page.getByRole("button", { name: "Gérer mes cookies" }).click();
  await assertPageLocked(page, "preferences dialog open");
  await assertPreferencesDialogCanScrollIfNeeded(page);
  await page.getByRole("button", { name: "Tout refuser" }).click();
  await page.waitForTimeout(100);
  await assertPageScrollable(page, "preferences dialog closed after reject");
  await page.evaluate(() => {
    document.cookie = "_ga=test; path=/";
    document.cookie = "_ga_TEST=test; path=/";
  });
  await page.getByRole("button", { name: "Gérer mes cookies" }).click();
  await assertPageLocked(page, "preferences dialog reopened");
  await page.getByRole("button", { name: "Tout refuser" }).click();
  await page.waitForTimeout(100);
  await assertPageScrollable(page, "preferences dialog closed after withdrawal");
  if ((await analyticsCookieCount(context)) !== 0) failures.push("_ga cookies were not removed after withdrawal");
  const ga4RequestsBeforeBlockedEvent = googleRequests.ga4.length;
  await page.goto(`${baseUrl}/produits/golden-static`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Ajouter 1 g au panier" }).click();
  await page.waitForTimeout(200);
  if (googleRequests.ga4.length !== ga4RequestsBeforeBlockedEvent) {
    failures.push("new GA4 events were not blocked after withdrawal");
  }
  await page.close();
}

async function assertKnownVisitorFlow(browser: Browser, baseUrl: string) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.localStorage.setItem("verdanza-age-confirmed", "true");
    window.localStorage.setItem(
      "verdanza-consent-v1",
      JSON.stringify({
        version: 1,
        analytics: true,
        decidedAt: new Date().toISOString(),
      }),
    );
  });
  const googleRequests: GoogleRequestLog = { gtm: [], ga4: [] };
  await installGoogleRequestMock(context, googleRequests);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/admin`, { waitUntil: "load" });
  await page.waitForTimeout(300);
  if (googleRequests.gtm.length || googleRequests.ga4.length) {
    failures.push("direct admin visit with stored consent fired Google requests");
  }
  const adminGtmScriptCount = await page.locator('script[data-verdanza-gtm="GTM-W76PFW2X"]').count();
  if (adminGtmScriptCount !== 0) {
    failures.push(`direct admin visit loaded GTM scripts: ${adminGtmScriptCount}`);
  }
  if (!(await isGa4RuntimeDisabled(page))) {
    failures.push("direct admin visit did not disable GA4 runtime");
  }

  await page.goto(`${baseUrl}/fleurs-cbd`, { waitUntil: "load" });
  await assertPageScrollable(page, "known visitor initial load");
  await page.close();
  await context.close();
}

async function assertAdminRouteDoesNotTrack(
  page: Page,
  baseUrl: string,
  googleRequests: GoogleRequestLog,
  label: string,
) {
  const ga4Before = googleRequests.ga4.length;
  const gtmBefore = googleRequests.gtm.length;
  await page.goto(`${baseUrl}/admin`, { waitUntil: "load" });
  await page.waitForTimeout(300);
  if (googleRequests.gtm.length !== gtmBefore) {
    failures.push(`${label}: admin route loaded an additional GTM request`);
  }
  if (googleRequests.ga4.length !== ga4Before) {
    failures.push(`${label}: admin route fired GA4 events`);
  }
  if (!(await isGa4RuntimeDisabled(page))) {
    failures.push(`${label}: admin route did not disable GA4 runtime`);
  }
}

async function isGa4RuntimeDisabled(page: Page) {
  return page.evaluate(() => Boolean((window as unknown as Record<string, boolean>)["ga-disable-G-E9XNP7BJ2Y"]));
}

async function installGoogleRequestMock(context: BrowserContext, requests: GoogleRequestLog) {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes("googletagmanager.com/gtm.js")) {
      requests.gtm.push(url);
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: mockGoogleTagManagerScript(),
      });
      return;
    }
    if (isGoogleAnalyticsCollectUrl(url)) {
      requests.ga4.push(url);
      await route.fulfill({
        status: 204,
        contentType: "text/plain",
        body: "",
      });
      return;
    }
    if (url.includes("googletagmanager.com") || url.includes("google-analytics.com")) {
      await route.fulfill({
        status: 204,
        contentType: "text/plain",
        body: "",
      });
      return;
    }
    await route.continue();
  });
}

function mockGoogleTagManagerScript() {
  return `
    window.__verdanzaMockGtmLoaded = (window.__verdanzaMockGtmLoaded || 0) + 1;
    (function () {
      function sendGa4Event(name, params) {
        var query = new URLSearchParams();
        query.set("v", "2");
        query.set("tid", "G-E9XNP7BJ2Y");
        query.set("en", name);
        query.set("_p", String(Date.now()));
        var payload = params || {};
        Object.keys(payload).forEach(function (key) {
          var value = payload[key];
          if (value === undefined || value === null || typeof value === "object") return;
          query.set("ep." + key, String(value));
        });
        new Image().src = "https://www.google-analytics.com/g/collect?" + query.toString();
      }
      window.gtag = function () {
        var args = Array.prototype.slice.call(arguments);
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push(args);
        if (args[0] === "event") {
          sendGa4Event(args[1], args[2]);
        }
      };
      (window.dataLayer || []).forEach(function (entry) {
        var args = Array.prototype.slice.call(entry);
        if (args[0] === "event") {
          sendGa4Event(args[1], args[2]);
        }
      });
      sendGa4Event("page_view", { page_location: window.location.href, page_title: document.title });
    })();
  `;
}

function resetGoogleRequests(requests: GoogleRequestLog) {
  requests.gtm.length = 0;
  requests.ga4.length = 0;
}

async function waitForGa4Event(requests: GoogleRequestLog, eventName: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    if (requests.ga4.some((url) => ga4EventNameFromUrl(url) === eventName)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  failures.push(`GA4 collect request missing for ${eventName}`);
}

async function waitForGa4EventCount(requests: GoogleRequestLog, eventName: string, expectedCount: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    if (ga4EventCount(requests, eventName) >= expectedCount) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  failures.push(
    `GA4 collect request count for ${eventName} below ${expectedCount}: ${ga4EventCount(requests, eventName)}`,
  );
}

function ga4EventCount(requests: GoogleRequestLog, eventName: string) {
  return requests.ga4.filter((url) => ga4EventNameFromUrl(url) === eventName).length;
}

function isGoogleAnalyticsCollectUrl(url: string) {
  return (
    url.includes("google-analytics.com/g/collect") ||
    url.includes("analytics.google.com/g/collect") ||
    url.includes("google-analytics.com/collect") ||
    url.includes("analytics.google.com/collect")
  );
}

function ga4EventNameFromUrl(url: string) {
  try {
    return new URL(url).searchParams.get("en") || "";
  } catch {
    return "";
  }
}

async function assertNoObjectDataLayerEvent(page: Page, eventName: string) {
  const objectEventCount = await page.evaluate((name) => {
    return Array.isArray(window.dataLayer)
      ? window.dataLayer.filter((entry) => {
          return (
            entry &&
            !Array.isArray(entry) &&
            typeof entry === "object" &&
            "event" in entry &&
            entry.event === name
          );
        }).length
      : 0;
  }, eventName);
  if (objectEventCount > 0) {
    failures.push(`${eventName} was also pushed as a dataLayer event object`);
  }
}

async function assertConsentCommandOrder(page: Page, label: string) {
  const order = await page.evaluate(() => {
    return Array.isArray(window.dataLayer)
      ? window.dataLayer.map((entry) => {
          const args = Array.prototype.slice.call(entry);
          if (args[0] === "consent") {
            return {
              kind: `consent:${args[1]}`,
              analyticsStorage: args[2]?.analytics_storage,
              adStorage: args[2]?.ad_storage,
              adUserData: args[2]?.ad_user_data,
              adPersonalization: args[2]?.ad_personalization,
            };
          }
          if (entry && !Array.isArray(entry) && typeof entry === "object" && "event" in entry) {
            return { kind: `event:${entry.event}` };
          }
          if (args[0] === "event") return { kind: `gtag-event:${args[1]}` };
          return { kind: "other" };
        })
      : [];
  });
  const defaultIndex = order.findIndex((entry) => entry.kind === "consent:default");
  const grantedUpdateIndex = order.findIndex(
    (entry) => entry.kind === "consent:update" && entry.analyticsStorage === "granted",
  );
  const gtmIndex = order.findIndex((entry) => entry.kind === "event:gtm.js");
  if (defaultIndex < 0) failures.push(`${label}: consent default command is missing`);
  if (grantedUpdateIndex < 0) failures.push(`${label}: granted consent update command is missing`);
  if (gtmIndex < 0) failures.push(`${label}: gtm.js event is missing`);
  if (defaultIndex >= 0 && grantedUpdateIndex >= 0 && defaultIndex > grantedUpdateIndex) {
    failures.push(`${label}: consent default is after granted update`);
  }
  if (grantedUpdateIndex >= 0 && gtmIndex >= 0 && grantedUpdateIndex > gtmIndex) {
    failures.push(`${label}: consent update granted is after gtm.js`);
  }
  for (const entry of order) {
    if (entry.kind?.startsWith("consent:") && entry.adStorage !== "denied") {
      failures.push(`${label}: ad_storage is not denied for ${entry.kind}`);
    }
    if (entry.kind?.startsWith("consent:") && entry.adUserData !== "denied") {
      failures.push(`${label}: ad_user_data is not denied for ${entry.kind}`);
    }
    if (entry.kind?.startsWith("consent:") && entry.adPersonalization !== "denied") {
      failures.push(`${label}: ad_personalization is not denied for ${entry.kind}`);
    }
  }
}

async function assertPageScrollable(page: Page, label: string) {
  await page.waitForFunction(() => document.scrollingElement !== null);
  const initialState = await scrollState(page);
  if (initialState.scrollHeight <= initialState.clientHeight) {
    failures.push(`${label}: page content is not taller than viewport`);
    return;
  }
  if (initialState.bodyComputedOverflow === "hidden" || initialState.htmlComputedOverflow === "hidden") {
    failures.push(
      `${label}: scroll is still locked (body=${initialState.bodyComputedOverflow}, html=${initialState.htmlComputedOverflow})`,
    );
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  });
  await page.evaluate(() => {
    window.scrollTo(0, 500);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 500;
  });
  await page.waitForTimeout(100);
  const afterScrollTo = await page.evaluate(() =>
    Math.max(window.scrollY, document.scrollingElement?.scrollTop || 0),
  );
  if (afterScrollTo <= 0) failures.push(`${label}: window.scrollTo did not move the page`);

  await page.evaluate(() => window.scrollTo(0, 0));
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  let afterWheel = 0;
  for (let attempt = 0; attempt < 3 && afterWheel <= 0; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(100);
    afterWheel = await page.evaluate(() => window.scrollY);
  }
  if (afterWheel <= 0) failures.push(`${label}: wheel did not move the page`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("PageDown");
  await page.waitForTimeout(50);
  const afterPageDown = await page.evaluate(() => window.scrollY);
  if (afterPageDown <= 0) failures.push(`${label}: PageDown did not move the page`);

  await page.evaluate(() => window.scrollTo(0, 0));
}

async function assertPageLocked(page: Page, label: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(50);
  const state = await scrollState(page);
  if (state.bodyComputedOverflow !== "hidden" || state.htmlComputedOverflow !== "hidden") {
    failures.push(
      `${label}: expected scroll lock, got body=${state.bodyComputedOverflow}, html=${state.htmlComputedOverflow}`,
    );
  }
  if (state.scrollY !== 0) failures.push(`${label}: background scrolled while modal was open`);
}

async function assertPreferencesDialogCanScrollIfNeeded(page: Page) {
  const dialogState = await page.locator('[role="dialog"][aria-modal="true"]').evaluate((dialog) => ({
    scrollHeight: dialog.scrollHeight,
    clientHeight: dialog.clientHeight,
    overflowY: window.getComputedStyle(dialog).overflowY,
  }));
  if (dialogState.scrollHeight > dialogState.clientHeight && dialogState.overflowY === "visible") {
    failures.push("preferences dialog content is taller than viewport but not scrollable");
  }
}

async function scrollState(page: Page) {
  return page.evaluate(() => ({
    bodyStyleOverflow: document.body.style.overflow,
    bodyComputedOverflow: window.getComputedStyle(document.body).overflow,
    htmlStyleOverflow: document.documentElement.style.overflow,
    htmlComputedOverflow: window.getComputedStyle(document.documentElement).overflow,
    scrollingElement: document.scrollingElement?.tagName || "",
    scrollHeight: document.scrollingElement?.scrollHeight || 0,
    clientHeight: document.scrollingElement?.clientHeight || 0,
    scrollY: window.scrollY,
  }));
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
