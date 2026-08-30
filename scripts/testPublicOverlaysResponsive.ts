import assert from "node:assert/strict";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createServer } from "vite";

const host = "127.0.0.1";
const port = 4182;
const baseUrl = `http://${host}:${port}`;
const guidePath = "/blog/origine-variete-lot-cbd-differences";
const mobileWidths = [320, 360, 375, 390, 412, 430];
const viewports = [
  ...mobileWidths.map((width) => ({ width, height: 844 })),
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
];

const promoBanner = {
  id: "weekend-gift",
  title: "JUSQU’À 3 G OFFERTS CE WEEK-END",
  message: "1 g dès 30 € · 2 g dès 50 € · 3 g dès 70 €. Sans code.",
  type: "top_bar",
  placement: "all_public",
  placements: ["all_public"],
  isActive: true,
  isArchived: false,
  priority: 5,
  variant: "promo",
  dismissible: true,
  buttonLabel: "Découvrir la boutique",
  buttonUrl: "/boutique",
  promotionSummary: {
    applicationMode: "automatic",
    requiresCode: false,
    promotionType: "tiered_product_gift",
    giftTiers: [
      { id: "tier-30", minimumSubtotal: 30, quantityGrams: 1 },
      { id: "tier-50", minimumSubtotal: 50, quantityGrams: 2 },
      { id: "tier-70", minimumSubtotal: 70, quantityGrams: 3 },
    ],
  },
};

const server = await createServer({
  logLevel: "error",
  server: { host, port, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    const page = await preparedPage(context);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${baseUrl}${guidePath}`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="top-promo-showcase"]').waitFor();
    await page.locator('[data-testid="cookie-consent-banner"]').waitFor();
    await page.evaluate(() => document.fonts.ready);

    const initial = await responsiveMetrics(page);
    assertNoOverflow(initial, viewport.width, "initial");
    assert.equal(initial.tierCount, 3, `${viewport.width}px: all three gift tiers must render`);
    assert.equal(initial.tiersFit, true, `${viewport.width}px: every gift tier must fit the promo card`);
    assert.equal(initial.tierTextClipped, false, `${viewport.width}px: gift tier text must not be clipped`);
    assert.equal(initial.closeInsidePromo, true, `${viewport.width}px: close control must remain inside the promo`);
    assert.ok(initial.closeWidth >= 44 && initial.closeHeight >= 44, `${viewport.width}px: close target must be at least 44px`);
    assert.equal(initial.ctaInsidePromo, true, `${viewport.width}px: promo CTA must fit`);
    assert.equal(initial.helpVisible, false, `${viewport.width}px: help trigger must hide during initial consent`);
    assert.equal(initial.cookieChoicesVisible, 3, `${viewport.width}px: all cookie choices must be visible`);
    assert.equal(initial.cookieInsideViewport, true, `${viewport.width}px: cookie sheet must fit the viewport`);
    assert.equal(initial.engagementButtons, 3, `${viewport.width}px: blog engagement controls must remain intact`);

    if (viewport.width === 320) {
      assert.equal(initial.tierRows, 3, "320px: gift tiers must fall back to three compact rows");
    } else if (viewport.width <= 430) {
      assert.equal(initial.tierRows, 1, `${viewport.width}px: gift tiers should remain in three columns`);
    }
    if (viewport.width === 390) {
      assert.ok(initial.cookieHeight <= viewport.height / 3, "390px: cookie sheet should use at most one third of the viewport");
    }

    await page.getByRole("button", { name: "Tout refuser" }).click();
    await page.locator('[data-testid="cookie-consent-banner"]').waitFor({ state: "detached" });
    const help = page.locator('[data-testid="floating-contact-trigger"]');
    await help.waitFor();
    const helpBox = await help.boundingBox();
    assert.ok(helpBox, `${viewport.width}px: help trigger must be measurable after consent`);
    assert.ok(helpBox.x >= 0 && helpBox.x + helpBox.width <= viewport.width, `${viewport.width}px: help trigger must stay inside viewport`);
    if (viewport.width < 640) {
      assert.ok(helpBox.width >= 48 && helpBox.width <= 52, `${viewport.width}px: mobile help trigger must stay circular`);
      assert.ok(helpBox.height >= 48 && helpBox.height <= 52, `${viewport.width}px: mobile help trigger must keep its touch target`);
      await page.getByRole("button", { name: "Ouvrir le menu mobile" }).click();
      assert.equal(await help.count(), 0, `${viewport.width}px: help trigger must hide while the mobile menu is open`);
      await page.getByRole("button", { name: "Fermer le menu mobile" }).click();
    } else {
      assert.ok(helpBox.width > 52, `${viewport.width}px: tablet and desktop help trigger should retain its label`);
    }

    assert.deepEqual(pageErrors, [], `${viewport.width}px: no page errors expected`);
    console.log(`${viewport.width}x${viewport.height}`, initial);
    await context.close();
  }

  const scaledContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const scaledPage = await preparedPage(scaledContext);
  await scaledPage.goto(`${baseUrl}${guidePath}`, { waitUntil: "domcontentloaded" });
  await scaledPage.locator('[data-testid="top-promo-showcase"]').waitFor();
  await scaledPage.evaluate(() => {
    document.documentElement.style.fontSize = "130%";
  });
  await scaledPage.waitForTimeout(100);
  const scaled = await responsiveMetrics(scaledPage);
  assertNoOverflow(scaled, 390, "130% text");
  assert.equal(scaled.tiersFit, true, "130% text: gift tiers must stay inside the promo");
  assert.equal(scaled.tierTextClipped, false, "130% text: tier labels must wrap without clipping");
  assert.equal(scaled.cookieChoicesVisible, 3, "130% text: all cookie actions must remain available");
  assert.equal(scaled.cookieInsideViewport, true, "130% text: cookie sheet must remain inside viewport");
  await scaledContext.close();
  console.log("390x844 at 130% text", scaled);

  const acceptContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const acceptPage = await preparedPage(acceptContext);
  await acceptPage.goto(`${baseUrl}${guidePath}`, { waitUntil: "domcontentloaded" });
  await acceptPage.locator('[data-testid="cookie-consent-banner"]').waitFor();
  await acceptPage.getByRole("button", { name: "Tout accepter" }).click();
  await acceptPage.locator('[data-testid="cookie-consent-banner"]').waitFor({ state: "detached" });
  assert.match(
    (await acceptPage.evaluate(() => window.localStorage.getItem("verdanza-consent-v1"))) || "",
    /"analytics":true/,
    "accept all must preserve the analytics consent choice",
  );
  assert.equal(await acceptPage.locator('[data-testid="floating-contact-trigger"]').count(), 1, "help trigger must return after accepting consent");
  await acceptContext.close();

  const preferencesContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const preferencesPage = await preparedPage(preferencesContext);
  await preferencesPage.goto(`${baseUrl}${guidePath}`, { waitUntil: "domcontentloaded" });
  await preferencesPage.locator('[data-testid="cookie-consent-banner"]').waitFor();
  await preferencesPage.getByRole("button", { name: "Personnaliser" }).click();
  await preferencesPage.getByRole("dialog", { name: "Préférences cookies" }).waitFor();
  assert.equal(await preferencesPage.locator('[data-testid="floating-contact-trigger"]').count(), 0, "help trigger must stay hidden behind cookie preferences");
  assert.equal(await preferencesPage.getByRole("button", { name: "Tout accepter" }).count(), 1, "preferences must preserve accept all");
  assert.equal(await preferencesPage.getByRole("button", { name: "Tout refuser" }).count(), 1, "preferences must preserve reject all");
  assert.equal(await preferencesPage.getByRole("button", { name: "Enregistrer" }).count(), 1, "preferences must preserve custom saving");
  await preferencesContext.close();
} finally {
  await browser.close();
  await server.close();
}

console.log("Public overlays responsive tests passed");

async function preparedPage(context: BrowserContext) {
  await context.addInitScript(() => {
    window.localStorage.setItem("verdanza-age-confirmed", "true");
    window.localStorage.removeItem("verdanza-consent-v1");
    window.localStorage.removeItem("verdanza_banner_dismissed_weekend-gift");
  });
  const page = await context.newPage();
  await page.route("**://www.googletagmanager.com/**", (route) => route.abort());
  await page.route("**/api/public-promo-banners", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ banners: [promoBanner] }) }),
  );
  await page.route("**/api/blog-interactions?*", (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const body = action === "comments"
      ? { comments: [], total: 0, page: 1, pageSize: 10, hasMore: false }
      : { slug: "origine-variete-lot-cbd-differences", likeCount: 1, approvedCommentCount: 0, viewerLiked: false };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return page;
}

async function responsiveMetrics(page: Page) {
  return page.evaluate(() => {
    const promo = document.querySelector<HTMLElement>('[data-testid="top-promo-showcase"] > .container-page > div');
    const tiers = [...document.querySelectorAll<HTMLElement>('[data-testid="gift-tier"]')];
    const close = document.querySelector<HTMLElement>('button[aria-label^="Fermer la promotion"]');
    const cta = [...document.querySelectorAll<HTMLElement>('a')].find((element) => element.textContent?.trim() === "Découvrir la boutique");
    const cookie = document.querySelector<HTMLElement>('[data-testid="cookie-consent-banner"]');
    const cookieButtons = cookie ? [...cookie.querySelectorAll<HTMLElement>("button")] : [];
    const promoRect = promo?.getBoundingClientRect();
    const closeRect = close?.getBoundingClientRect();
    const ctaRect = cta?.getBoundingClientRect();
    const cookieRect = cookie?.getBoundingClientRect();
    const tierRects = tiers.map((tier) => tier.getBoundingClientRect());
    const tierRows = new Set(tierRects.map((rect) => Math.round(rect.top))).size;
    const engagementButtons = [...document.querySelectorAll<HTMLElement>('[data-blog-engagement-actions] button')].filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }).length;

    return {
      viewportWidth: window.innerWidth,
      rootClientWidth: document.documentElement.clientWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      promoInsideViewport: Boolean(promoRect && promoRect.left >= 0 && promoRect.right <= window.innerWidth),
      tierCount: tiers.length,
      tierRows,
      tiersFit: Boolean(promoRect && tierRects.every((rect) => rect.left >= promoRect.left - 1 && rect.right <= promoRect.right + 1 && rect.top >= promoRect.top - 1 && rect.bottom <= promoRect.bottom + 1)),
      tierTextClipped: tiers.some((tier) => tier.scrollWidth > tier.clientWidth + 1 || tier.scrollHeight > tier.clientHeight + 1),
      closeInsidePromo: Boolean(promoRect && closeRect && closeRect.left >= promoRect.left - 1 && closeRect.right <= promoRect.right + 1 && closeRect.top >= promoRect.top - 1 && closeRect.bottom <= promoRect.bottom + 1),
      closeWidth: closeRect?.width || 0,
      closeHeight: closeRect?.height || 0,
      ctaInsidePromo: Boolean(promoRect && ctaRect && ctaRect.left >= promoRect.left - 1 && ctaRect.right <= promoRect.right + 1 && ctaRect.top >= promoRect.top - 1 && ctaRect.bottom <= promoRect.bottom + 1),
      helpVisible: [...document.querySelectorAll<HTMLElement>('[data-testid="floating-contact-trigger"]')].some((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }),
      cookieChoicesVisible: cookieButtons.filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }).length,
      cookieInsideViewport: Boolean(cookieRect && cookieRect.left >= 0 && cookieRect.right <= window.innerWidth && cookieRect.top >= 0 && cookieRect.bottom <= window.innerHeight),
      cookieHeight: cookieRect?.height || 0,
      engagementButtons,
    };
  });
}

function assertNoOverflow(metrics: Awaited<ReturnType<typeof responsiveMetrics>>, width: number, label: string) {
  assert.ok(metrics.rootScrollWidth <= metrics.rootClientWidth, `${width}px ${label}: document must not scroll horizontally`);
  assert.equal(metrics.promoInsideViewport, true, `${width}px ${label}: promo must remain inside viewport`);
}
