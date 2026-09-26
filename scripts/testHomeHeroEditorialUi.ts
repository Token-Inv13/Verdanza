import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { homeHeroImageVariant as desktop, homeHeroTabletImageVariant as tablet,
  homeHeroMobileImageVariant as mobile } from "../src/lib/generatedImageVariants";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";
import { expressDeliveryBannerFixture as banner } from "./fixtures/expressDeliveryBanner";

const widths = [390, 430, 768, 1024, 1280, 1600];
const output = join(tmpdir(), "verdanza-phase6b1-hero-qa-20260926");
mkdirSync(output, { recursive: true });
const metrics: unknown[] = [];
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  for (const dpr of [1, 2]) {
    for (const width of widths) {
      const height = width === 390 ? 844 : width === 430 ? 932 : width === 768 ? 1000 : 800;
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
        serviceWorkers: "block", reducedMotion: width === 390 ? "reduce" : "no-preference" });
      await context.addInitScript(() => {
        localStorage.setItem("verdanza-age-confirmed", "true");
        localStorage.setItem("verdanza-consent-v1", JSON.stringify({ version: 1, analytics: false,
          decidedAt: "2026-09-26T00:00:00.000Z" }));
        (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean })
          .__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
        const qaWindow = window as Window & { __heroLcp?: unknown[] };
        qaWindow.__heroLcp = [];
        new PerformanceObserver((list) => {
          for (const item of list.getEntries()) {
            const entry = item as PerformanceEntry & { element?: Element; url?: string };
            qaWindow.__heroLcp?.push({ time: entry.startTime, tag: entry.element?.tagName,
              className: entry.element?.className, url: entry.url ? new URL(entry.url).pathname : "" });
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      await blockExternalServices(context);
      await context.route("**/api/public-promo-banners", (route) => route.fulfill({ json: { banners: [banner] } }));
      const page = await context.newPage();
      const requests: string[] = [];
      const imageResponses: { url: string; status: number; bytes: number }[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/images/hero-editorial-")) requests.push(new URL(request.url()).pathname);
      });
      page.on("response", (response) => {
        if (response.url().includes("/images/hero-editorial-")) imageResponses.push({
          url: new URL(response.url()).pathname, status: response.status(),
          bytes: Number(response.headers()["content-length"] || 0),
        });
      });
      await gotoDomReady(page, `${server.baseUrl}/`);
      await page.locator("[data-express-delivery-banner]").waitFor();
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>(".home-hero-v2__image");
        const media = document.querySelector(".home-hero-v2__media")!;
        return image?.complete && image.naturalWidth > 0 && getComputedStyle(media).opacity === "1";
      });
      await page.evaluate(() => document.fonts.ready);
      // Allow the known entry fade and buffered LCP observer to finish before scrolling.
      await page.waitForTimeout(350);
      const observed = await page.evaluate(() => {
        const hero = document.querySelector<HTMLElement>("[data-home-hero-v2]")!;
        const image = hero.querySelector<HTMLImageElement>(".home-hero-v2__image")!;
        const media = hero.querySelector<HTMLElement>(".home-hero-v2__media")!;
        const picture = image.closest("picture")!;
        const selected = [...picture.querySelectorAll("source")].find((source) => matchMedia(source.media).matches) || image;
        const title = hero.querySelector("h1")!;
        const actions = hero.querySelector(".home-hero-v2__actions")!;
        const finder = document.querySelector("[data-home-product-finder]")!;
        const banner = document.querySelector("[data-express-delivery-banner]")!;
        const [titleBox, actionsBox, imageBox, heroBox, finderBox, bannerBox] =
          [title, actions, image, hero, finder, banner].map((element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, left: box.left, right: box.right,
            width: box.width, height: box.height };
        });
        const slot = selected.sizes.split(",").map((part) => part.trim()).find((part) => {
          const condition = part.match(/^\([^)]*\)/)?.[0];
          return !condition || matchMedia(condition).matches;
        })!.replace(/^\([^)]*\)\s*/, "");
        const probe = document.createElement("div");
        probe.style.cssText = `position:fixed;visibility:hidden;width:${slot}`;
        document.body.appendChild(probe);
        const declaredWidth = probe.getBoundingClientRect().width;
        probe.remove();
        const controls = [...actions.querySelectorAll<HTMLAnchorElement>("a")].map((node) => {
          const box = node.getBoundingClientRect();
          return { href: node.getAttribute("href"), height: box.height,
            receivesPointer: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("a") === node };
        });
        return { title: titleBox, actions: actionsBox, image: imageBox, hero: heroBox,
          finder: finderBox, banner: bannerBox, currentSrc: new URL(image.currentSrc).pathname,
          selectedSrcSet: selected.srcset, sizes: selected.sizes, declaredWidth,
          dimensions: [selected.getAttribute("width"), selected.getAttribute("height")],
          imageFilter: getComputedStyle(image).filter, imageFit: getComputedStyle(image).objectFit,
          imagePosition: getComputedStyle(image).objectPosition,
          imageTransform: getComputedStyle(media).transform, imageAnimation: getComputedStyle(media).animationName,
          shadow: getComputedStyle(media).boxShadow, border: getComputedStyle(media).borderWidth,
          overlay: getComputedStyle(picture, "::after").backgroundImage,
          priority: image.fetchPriority, loading: image.loading, decoding: image.decoding,
          alt: image.alt, overflow: document.documentElement.scrollWidth - innerWidth,
          h1: title.textContent, controls,
          lcp: (window as Window & { __heroLcp?: unknown[] }).__heroLcp };
      });
      const expected = width >= 900 ? desktop : width >= 768 ? tablet : mobile;
      assert.equal(await page.locator("[data-home-hero-picture]").count(), 1);
      assert.equal(observed.selectedSrcSet, expected.srcSet);
      assert.equal(observed.sizes, expected.sizes);
      assert.deepEqual(observed.dimensions, [String(expected.width), String(expected.height)]);
      assert.ok(expected.srcSet.includes(`${observed.currentSrc} `));
      assert.deepEqual(requests, [observed.currentSrc], `${width}px DPR${dpr}: only one hero image may download`);
      assert.equal(imageResponses.length, 1);
      assert.equal(imageResponses[0].status, 200);
      assert.ok(imageResponses[0].bytes > 0 && imageResponses[0].bytes <= 160 * 1024);
      const previousBytes = dpr === 1 ? 25660 : width === 390 || width === 768
        ? 25660 : width === 430 || width === 1024 ? 58044 : 102118;
      assert.ok(imageResponses[0].bytes <= previousBytes,
        `${width}px DPR${dpr}: preserve or improve the Phase 6B image transfer budget`);
      assert.ok(!requests.some((url) => /hero-editorial-(?:desktop|mobile)\.webp$/.test(url)), "never download a lossless master");
      assert.ok(Math.abs(observed.declaredWidth - observed.image.width) < 1);
      assert.equal(observed.imageFilter, "none");
      assert.equal(observed.imageFit, "contain");
      assert.equal(observed.imageTransform, "none", "media animation must not translate or zoom");
      assert.equal(observed.shadow, "none");
      assert.equal(observed.border, "0px");
      assert.match(observed.overlay, /linear-gradient/);
      assert.equal(observed.priority, "high");
      assert.notEqual(observed.loading, "lazy");
      assert.equal(observed.decoding, "async");
      assert.ok(observed.alt.length > 0 && observed.alt.length < 90);
      assert.equal(observed.h1?.trim(), "Une sélection CBD pensée pour vous.");
      assert.equal(observed.overflow, 0);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(observed.controls.length, 2);
      assert.deepEqual(observed.controls.map((control) => control.href), ["/boutique", "/livraison-postale"]);
      assert.ok(observed.controls.every((control) => control.height >= 44 && control.receivesPointer));
      assert.ok(observed.finder.top < observed.hero.bottom);
      assert.ok(observed.finder.top >= observed.hero.bottom - 49, "keep the existing slight overlap");
      assert.ok(observed.finder.bottom + 15 <= observed.banner.top);
      assert.ok(observed.image.bottom + 10 <= observed.finder.top, "Finder must not cover the product photo");
      if (width < 900) {
        assert.ok(observed.title.bottom < observed.actions.top);
        assert.ok(observed.actions.bottom < observed.image.top, "stack copy before photo on phone/tablet");
        if (width < 768) assert.ok(observed.image.height < 180, "keep the phone panorama compact");
      } else {
        assert.ok(observed.title.right <= observed.image.left + observed.image.width * 0.14,
          "H1 must remain in the fully opaque ivory zone");
      }
      if (width === 390) assert.equal(observed.imageAnimation, "none");
      assert.deepEqual(errors, []);
      metrics.push({ width, viewportHeight: height, dpr, bytes: imageResponses[0].bytes, ...observed });
      if (dpr === 1) {
        await page.screenshot({ path: join(output, `viewport-${width}.png`) });
        await page.locator(".home-hero-flow").screenshot({ path: join(output, `hero-finder-${width}.png`) });
        await page.locator("[data-express-delivery-banner]").screenshot({ path: join(output, `banner-${width}.png`) });
      } else if (width === 768 || width === 1280) {
        await page.screenshot({ path: join(output, `viewport-${width}-dpr2.png`) });
      }
      await context.close();
    }
  }
  // A new local visitor still sees the untouched age gate, no Hero network fetch.
  const context = await browser.newContext({ serviceWorkers: "block" });
  await blockExternalServices(context);
  await context.route("**/api/public-promo-banners", (route) => route.fulfill({ json: { banners: [banner] } }));
  const page = await context.newPage();
  const pendingRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/images/hero-editorial-")) pendingRequests.push(request.url());
  });
  await gotoDomReady(page, `${server.baseUrl}/`);
  assert.equal(await page.locator("[data-home-hero-picture]").count(), 0);
  assert.deepEqual(pendingRequests, []);
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(join(output, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(`Hero editorial UI passed at 390/430/768/1024/1280/1600px, DPR1 and DPR2: one selected image request, accurate sizes, protected HTML copy/CTAs, complete framing, Finder/banner order, reduced motion, age gate, no overflow/filter. Captures: ${output}`);
