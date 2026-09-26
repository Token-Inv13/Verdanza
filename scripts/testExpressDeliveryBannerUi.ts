import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { homeHeroImageVariant, homeHeroMobileImageVariant, homeHeroTabletImageVariant } from "../src/lib/generatedImageVariants";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";
import { expressDeliveryBannerFixture as banner } from "./fixtures/expressDeliveryBanner";

const widths = [390, 430, 768, 1280];
const routes = ["/", "/boutique", "/fleurs-cbd", "/resines-cbd",
  "/boutique?type=flowers&intensity=moyen&aroma=fruite#produits"];
const screenshotDir = join(tmpdir(), "verdanza-phase6b-qa-20260926");
mkdirSync(screenshotDir, { recursive: true });
const measurements: unknown[] = [];
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  // Extra breakpoints protect the sizes formula and capped desktop container.
  for (const width of [...widths, 640, 1024, 1440, 1600, 1920]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : width === 430 ? 932 : 1000 },
      serviceWorkers: "block", reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    await context.addInitScript(() => {
      (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean })
        .__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
      localStorage.setItem("verdanza-age-confirmed", "true");
      localStorage.setItem("verdanza-consent-v1", JSON.stringify({
        version: 1, analytics: false, decidedAt: "2026-09-26T00:00:00.000Z",
      }));
      const qaWindow = window as Window & { __qaLcp?: unknown[] };
      qaWindow.__qaLcp = [];
      new PerformanceObserver((list) => {
        for (const item of list.getEntries()) {
          const entry = item as PerformanceEntry & { element?: Element; url?: string };
          qaWindow.__qaLcp?.push({ startTime: entry.startTime, tag: entry.element?.tagName,
            className: entry.element?.className, url: entry.url });
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await blockExternalServices(context);
    await context.route("**/api/public-promo-banners", (route) => route.fulfill({
      json: { banners: [banner] },
    }));
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const route of widths.includes(width) ? routes : ["/"]) {
      await gotoDomReady(page, `${server.baseUrl}${route}`);
      const express = page.locator("[data-express-delivery-banner]");
      await express.waitFor();
      await page.locator(".product-card-v2").first().waitFor();
      if (route === "/") {
        await page.waitForFunction(() => {
          const image = document.querySelector<HTMLImageElement>(".home-hero-v2__image");
          return image?.complete && image.naturalWidth > 0;
        });
        await page.evaluate(() => document.fonts.ready);
        // Allow the existing 280ms hero entry animation/LCP observer to settle.
        await page.waitForTimeout(400);
        const hero = await page.locator(".home-hero-v2__image").evaluate((node: HTMLImageElement) => {
          const rect = node.getBoundingClientRect();
          const selected = [...(node.closest("picture")?.querySelectorAll("source") || [])]
            .find((source) => matchMedia(source.media).matches) || node;
          // Resolve the first matching sizes slot using browser CSS rather than duplicating its formula.
          const sizes = selected.sizes.split(",").map((entry) => entry.trim());
          const slot = sizes.find((entry) => {
            const condition = entry.match(/^\([^)]*\)/)?.[0];
            return !condition || matchMedia(condition).matches;
          })!.replace(/^\([^)]*\)\s*/, "");
          const probe = document.createElement("div");
          probe.style.cssText = `position:fixed;visibility:hidden;width:${slot}`;
          document.body.appendChild(probe);
          const declaredWidth = probe.getBoundingClientRect().width;
          probe.remove();
          return { width: rect.width, height: rect.height, ratio: rect.width / rect.height,
            declaredWidth, sizes: selected.sizes, srcSet: selected.srcset, currentSrc: new URL(node.currentSrc).pathname,
            fit: getComputedStyle(node).objectFit, position: getComputedStyle(node).objectPosition,
            filter: getComputedStyle(node).filter, priority: node.fetchPriority, loading: node.loading,
            dimensions: [selected.getAttribute("width"), selected.getAttribute("height")],
            lcp: (window as Window & { __qaLcp?: unknown[] }).__qaLcp };
        });
        const expected = width >= 900 ? homeHeroImageVariant : width >= 768
          ? homeHeroTabletImageVariant : homeHeroMobileImageVariant;
        assert.equal(hero.sizes, expected.sizes);
        assert.equal(hero.srcSet, expected.srcSet);
        assert.ok(Math.abs(hero.width - hero.declaredWidth) < 1, `${width}px: sizes must describe the real photo width`);
        assert.equal(hero.filter, "none");
        assert.equal(hero.fit, "contain");
        assert.equal(hero.position, "100% 50%");
        assert.equal(hero.priority, "high");
        assert.notEqual(hero.loading, "lazy");
        assert.deepEqual(hero.dimensions, [String(expected.width), String(expected.height)]);
        measurements.push({ width, hero });
        if (widths.includes(width)) await page.screenshot({ path: join(screenshotDir, `home-hero-${width}.png`) });
      }
      await express.scrollIntoViewIfNeeded();
      const layout = await express.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const finder = document.querySelector("[data-home-product-finder]")?.getBoundingClientRect();
        const cards = [...document.querySelectorAll(".product-card-v2")].map((card) => card.getBoundingClientRect());
        const link = element.querySelector<HTMLAnchorElement>("a")!;
        const children = [...element.querySelectorAll<HTMLElement>("h2, li, a")];
        return { height: rect.height, width: rect.width, top: rect.top, bottom: rect.bottom,
          finderBottom: finder?.bottom, cardTops: cards.map((card) => card.top),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          clips: children.filter((child) => child.scrollWidth > child.clientWidth + 1).map((child) => child.tagName),
          outside: children.filter((child) => {
            const box = child.getBoundingClientRect();
            return box.left < rect.left || box.right > rect.right || box.bottom > rect.bottom;
          }).map((child) => child.tagName),
          linkHeight: link.getBoundingClientRect().height, filter: getComputedStyle(element).filter,
          animation: getComputedStyle(element).animationName, text: element.textContent,
        };
      });
      assert.ok(layout.overflow <= 1, `${width}px ${route}: no horizontal overflow`);
      assert.deepEqual(layout.clips, [], `${width}px ${route}: no truncated text`);
      assert.deepEqual(layout.outside, [], `${width}px ${route}: all content inside the banner`);
      assert.ok(layout.height <= (width < 640 ? 220 : width < 1024 ? 145 : 115), `${width}px: keep the banner compact`);
      assert.ok(layout.linkHeight >= 44);
      assert.equal(layout.filter, "none");
      assert.equal(layout.animation, "none", "no permanent or reduced-motion animation");
      assert.doesNotMatch(layout.text || "", /\p{Extended_Pictographic}/u);
      if (route === "/") assert.ok(layout.finderBottom! + 15 <= layout.top, "keep separation after Finder");
      else if (route.includes("?")) assert.ok(Math.max(...layout.cardTops) <= layout.top, "compact shop keeps results first");
      else assert.ok(layout.bottom <= Math.min(...layout.cardTops), "banner must stay before the product grid");
      const conditions = express.getByRole("link", { name: "Voir la zone et les conditions" });
      assert.equal(await conditions.getAttribute("href"), "/livraison-locale");
      await conditions.focus();
      assert.equal(await conditions.evaluate((node) => node.matches(":focus-visible")), true);
      if (route === "/" && width === 390) {
        await express.screenshot({ path: join(screenshotDir, "home-banner-keyboard-focus-390.png") });
      }
      await conditions.evaluate((node) => node.blur());
      const label = route === "/" ? "home" : route.includes("?") ? "boutique-filtered" : route.slice(1);
      await express.screenshot({ path: join(screenshotDir, `${label}-banner-${width}.png`) });
      if (widths.includes(width)) await page.screenshot({ path: join(screenshotDir, `${label}-context-${width}.png`) });
      measurements.push({ width, route, banner: layout });
      await conditions.click();
      await page.waitForURL(`${server.baseUrl}/livraison-locale`);
      assert.ok(await page.locator("h1").isVisible(), "conditions page must open");
      assert.deepEqual(pageErrors, []);
    }
    await context.close();
  }
  // Hero DPR/network coverage lives in testHomeHeroEditorialUi after Phase 6B.1.
  // Verify unknown/new conditions retain the generic source and its own CTA.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.addInitScript(() => {
    localStorage.setItem("verdanza-age-confirmed", "true");
    (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean })
      .__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
  });
  await blockExternalServices(context);
  const altered = { ...banner, message: `${banner.message} Sous réserve de disponibilité.`,
    buttonLabel: "Conditions spécifiques", buttonUrl: "/livraison-locale", dismissible: true };
  await context.route("**/api/public-promo-banners", (route) => route.fulfill({ json: { banners: [altered] } }));
  const page = await context.newPage();
  await gotoDomReady(page, `${server.baseUrl}/boutique`);
  await page.getByText(altered.message).waitFor();
  assert.equal(await page.locator("[data-express-delivery-banner]").count(), 0);
  assert.equal(await page.getByRole("link", { name: "Conditions spécifiques" }).getAttribute("href"), "/livraison-locale");
  await page.getByRole("button", { name: "Fermer cette banniere" }).click();
  assert.equal(await page.getByText(altered.message).count(), 0);
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(join(screenshotDir, "measurements.json"), `${JSON.stringify(measurements, null, 2)}\n`);
console.log(`Express banner UI and hero sizes/LCP checks passed at 390, 430, 768, 1280px (+ hero 640, 1024, 1440, 1600, 1920px). Local captures: ${screenshotDir}`);
