import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { blockExternalServices, gotoDomReady, isLocalResourceUrl } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

// Local-only: no app flag changes, authenticated fixtures or remote requests.
const widths = [390, 430, 768, 1024, 1280, 1600];
const output = join(process.env.TEMP || process.cwd(), "verdanza-phase6c-qa-20260926");
console.log("Starting loopback advantages QA (all external services blocked).");
await mkdir(output, { recursive: true });
const server = await startAuditStaticServer();
const fixture = await createServer({
  configFile: false, plugins: [react()], appType: "custom", cacheDir: join(output, "vite-cache"),
  server: { host: "127.0.0.1", port: 0 },
});
fixture.middlewares.use(async (req, res, next) => {
  if (!req.headers.accept?.includes("text/html")) { next(); return; }
  try {
    const html = await fixture.transformIndexHtml(req.url || "/", '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/advantagesHubQa.tsx"></script></body></html>');
    res.setHeader("Content-Type", "text/html"); res.end(html);
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await fixture.listen();
const fixtureUrl = fixture.resolvedUrls!.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ headless: true });
console.log("Local build, isolated fixture server and Chromium ready.");

async function prepare(context: BrowserContext, consent = false) {
  await blockExternalServices(context);
  await context.addInitScript((analytics) => {
    Object.assign(window, { __VERDANZA_PRODUCT_CATALOG_PRERENDER__: true });
    localStorage.setItem("verdanza-age-confirmed", "true");
    localStorage.setItem("verdanza-consent-v1", JSON.stringify({ version: 1, analytics, decidedAt: "2026-09-26T00:00:00.000Z" }));
  }, consent);
  await context.route("**/api/public/promo-banners**", (route) => route.fulfill({ json: { banners: [] } }));
  await context.route("**/api/contests**", (route) => {
    assert.equal(route.request().method(), "GET", "QA must never enter a contest");
    return route.fulfill({ json: { contest: null } });
  });
}

async function noOverflow(page: Page, label: string) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), `${label}: no horizontal overflow`);
}

async function browserEvents(page: Page) {
  // index.html's existing gtag stores Arguments; its runtime shim stores Arrays.
  return page.evaluate(() => (window.dataLayer || []).flatMap((entry) =>
    entry && typeof entry === "object" && "length" in entry
      ? [Array.from(entry as ArrayLike<unknown>)] : []).filter((entry) => entry[0] === "event"));
}

async function disclosure(page: Page, navLabel: string, loyalty: boolean) {
  const nav = page.getByRole("navigation", { name: navLabel, exact: true });
  // Stable selector: the accessible label intentionally changes after opening.
  const toggle = nav.locator(".advantages-navigation__toggle");
  await toggle.focus(); await page.keyboard.press("Enter");
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  const panel = page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`);
  assert.equal(await panel.isVisible(), true);
  assert.equal(await panel.getByRole("link", { name: "Mes avantages fidélité" }).count(), loyalty ? 1 : 0);
  assert.equal(await panel.getByRole("link", { name: /Parrainage/ }).count(), 0);
  await page.keyboard.press("Tab");
  assert.equal(await panel.getByRole("link", { name: "Vue d’ensemble" }).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await panel.getByRole("link", { name: "Concours", exact: true }).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Escape");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await toggle.evaluate((el) => el === document.activeElement), true);
  await toggle.click(); await page.locator("h1").click();
  assert.equal(await toggle.getAttribute("aria-expanded"), "false", "outside click closes disclosure");
}

try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block", reducedMotion: width === 390 ? "reduce" : "no-preference" });
    await prepare(context);
    const page = await context.newPage();
    const errors: string[] = [];
    const forbidden: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/\/api\/.*(?:cagnotte|referral)/.test(request.url()) ||
        (isLocalResourceUrl(request.url()) && request.method() === "POST")) forbidden.push(request.url());
    });
    const response = await gotoDomReady(page, `${server.baseUrl}/avantages`);
    assert.equal(response?.status(), 200);
    assert.match(await response!.text(), /data-advantages-hub/);
    await page.locator("[data-advantages-hub]").waitFor();
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("h1").innerText(), "Plus de raisons de revenir.");
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://verdanza.fr/avantages");
    assert.doesNotMatch(await page.locator('meta[name="robots"]').getAttribute("content") || "", /noindex/);
    assert.match(await page.title(), /Avantages Verdanza/);
    assert.equal(await page.locator('[data-advantage="contest"]').getAttribute("data-status"), "active");
    assert.equal(await page.locator('[data-advantage="loyalty"]').getAttribute("data-status"), "soon", "normal build retains the closed existing flag");
    assert.equal(await page.locator('[data-advantage="referral"] a, [data-advantage="referral"] button, [data-advantage="loyalty"] a').count(), 0);
    const layout = await page.locator("[data-advantages-entries]").evaluate((el) => {
      const cards = [...el.children].map((card) => card.getBoundingClientRect());
      return { oneColumn: cards.every((card) => Math.abs(card.x - cards[0].x) < 1), contestLarger: cards[0].width > cards[1].width && cards[0].height > cards[1].height, filter: getComputedStyle(el).filter };
    });
    assert.equal(layout.oneColumn, width < 768);
    if (width >= 768) assert.equal(layout.contestLarger, true);
    assert.equal(layout.filter, "none");
    await noOverflow(page, `${width}px hub`);
    if (width < 1024) {
      const toggle = page.locator('[aria-controls="mobile-navigation-menu"]');
      await toggle.focus(); await page.keyboard.press("Enter");
      const mobile = page.getByRole("navigation", { name: "Navigation mobile", exact: true });
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await mobile.getByRole("link", { name: "Avantages", exact: true }).getAttribute("href"), "/avantages");
      assert.equal(await mobile.getByRole("link", { name: "Concours", exact: true }).count(), 0);
      await noOverflow(page, `${width}px menu`);
      await page.keyboard.press("Escape");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(await toggle.evaluate((el) => el === document.activeElement), true);
      await toggle.click(); await mobile.getByRole("link", { name: "Avantages", exact: true }).click();
      assert.equal(await mobile.count(), 0, "mobile navigation closes after direct hub link");
    } else {
      await disclosure(page, "Navigation principale", false);
      assert.equal(await page.getByRole("navigation", { name: "Navigation principale", exact: true }).getByRole("link", { name: "Avantages", exact: true }).getAttribute("href"), "/avantages");
    }
    if ([390, 430, 768, 1280, 1600].includes(width)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const height = Math.ceil((await page.locator("[data-advantages-hub]").boundingBox())!.height + (await page.locator("[data-advantages-hub]").boundingBox())!.y);
      await page.screenshot({ path: join(output, `avantages-${width}.png`), fullPage: true, clip: { x: 0, y: 0, width, height } });
    }
    const cta = page.getByRole("link", { name: "Découvrir le concours" });
    await cta.scrollIntoViewIfNeeded(); await page.keyboard.press("Tab"); await cta.focus();
    assert.equal(await cta.evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
    await page.locator('[data-testid="floating-contact-trigger"]').waitFor({ state: "detached" });
    assert.ok((await cta.boundingBox())!.height >= 44);
    await page.keyboard.press("Enter");
    await page.waitForURL("**/concours");
    await page.getByRole("heading", { name: "Un rendez-vous, une chance, un gagnant." }).waitFor();
    await noOverflow(page, `${width}px concours`);
    await page.getByRole("heading", { name: "Aucun concours ouvert pour le moment" }).waitFor();
    await context.route("**/api/contests**", (route) => {
      assert.equal(route.request().method(), "GET", "no real or fixture participation submission");
      return route.fulfill({ json: { contest: {
        id: "local-qa-contest", title: "Concours QA local", slug: "concours-qa-local",
        description: "Fixture locale sans participation réelle.", prizeValue: 10, prizeType: "store_credit",
        startAt: "2026-01-01T00:00:00Z", endAt: "2027-01-01T00:00:00Z", drawAt: "2027-01-02T00:00:00Z",
        status: "active", acceptingEntries: true, rulesText: "Règles de recette locale.", eligibilityConditions: "Fixture locale.",
      } } });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Concours QA local", exact: true }).waitFor();
    assert.equal(await page.locator('form button[type="submit"]').count(), 1);
    await noOverflow(page, `${width}px concours ouvert (fixture, no submission)`);
    assert.equal((await browserEvents(page)).filter((entry) => String(entry[1]).startsWith("advantages_")).length, 0,
    "advantages analytics remain silent without consent");
    assert.deepEqual(forbidden, [], "no wallet/referral API or form submission");
    assert.deepEqual(errors, [], `${width}px browser errors`);
    await context.close();
    console.log(`PASS ${width}px: hub, header, navigation, keyboard, contest, SEO, no overflow`);
  }
  for (const flag of ["false", "true"]) {
    for (const width of [390, 430, 768, 1280, 1600]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
      await prepare(context);
      const page = await context.newPage();
      const fixtureErrors: string[] = [];
      page.on("pageerror", (error) => fixtureErrors.push(error.message));
      await page.goto(`${fixtureUrl}/__qa/advantages?flag=${flag}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.locator('[data-advantage="loyalty"]').waitFor({ timeout: 120000 });
      const loyalty = page.getByRole("link", { name: "Voir mes avantages", exact: true });
      assert.equal(await loyalty.count(), flag === "true" ? 1 : 0);
      await disclosure(page, "Navigation QA", flag === "true");
      await noOverflow(page, `${width}px flag ${flag}`);
      if (flag === "true") {
        assert.equal(await loyalty.getAttribute("href"), "/compte/avantages");
        await loyalty.click(); await page.waitForURL("**/connexion");
        assert.equal(await page.locator("[data-qa-protected]").count(), 0, "existing AuthGate denies anonymous account access");
      }
      assert.deepEqual(fixtureErrors, [], `flag ${flag}: fixture browser errors`);
      await context.close();
    }
    console.log(`PASS fixture flag=${flag}: five widths, conditional links, existing AuthGate`);
  }
  const analyticsContext = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
  await prepare(analyticsContext, true);
  const analyticsPage = await analyticsContext.newPage();
  await gotoDomReady(analyticsPage, `${server.baseUrl}/avantages`);
  await analyticsPage.waitForFunction(() => (window.dataLayer || []).some((entry) =>
    entry && typeof entry === "object" && "1" in entry && entry[1] === "advantages_view"));
  await analyticsPage.getByRole("link", { name: "Découvrir le concours" }).click();
  await analyticsPage.waitForURL("**/concours");
  const events = await browserEvents(analyticsPage);
  assert.equal(events.filter((entry) => entry[1] === "advantages_view").length, 1);
  assert.equal(events.filter((entry) => entry[1] === "advantages_contest_click").length, 1);
  assert.ok(events.some((entry) => entry[1] === "cta_click" && (entry[2] as { cta_id?: string }).cta_id === "advantages_contest"));
  assert.equal(events.filter((entry) => /referral|parrainage/.test(String(entry[1]))).length, 0);
  await analyticsContext.close();
  console.log("PASS consent-aware advantages_view/contest_click and existing cta_click (external analytics blocked).");
} finally {
  await browser.close(); await server.close(); await fixture.close();
}
console.log(`Advantages QA passed. Screenshots outside Git: ${output}`);
