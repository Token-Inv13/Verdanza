import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";
import { homeHeroImageVariant, homeHeroMobileImageVariant, homeHeroTabletImageVariant } from "../src/lib/generatedImageVariants";

const widths = [390, 430, 768, 1024, 1280, 1600] as const;
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      serviceWorkers: "block",
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    await context.addInitScript(() => {
      (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean })
        .__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
      window.localStorage.setItem("verdanza-age-confirmed", "true");
      window.localStorage.setItem(
        "verdanza-consent-v1",
        JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-23T00:00:00.000Z" }),
      );
    });
    await blockExternalServices(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await gotoDomReady(page, `${server.baseUrl}/`);
    assert.equal(response?.status(), 200, `${width}px: homepage must return HTTP 200`);
    await page.locator("[data-home-page-v2]").waitFor();
    await page.locator(".product-card-v2").first().waitFor();

    assert.equal(await page.locator("h1").count(), 1, `${width}px: homepage must keep one H1`);
    assert.equal(await page.locator("h1").innerText(), "Une sélection CBD pensée pour vous.");
    assert.equal(await page.locator("[data-home-hero-primary]").count(), 1);
    assert.equal(await page.locator("[data-home-hero-secondary]").count(), 1);
    assert.equal(await page.locator("[data-home-hero-primary]").getAttribute("href"), "/boutique");
    assert.equal(
      await page.locator("[data-home-hero-secondary]").getAttribute("href"),
      "/livraison-postale",
    );
    assert.equal(await page.locator("[data-home-product-finder]").count(), 1);
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="floating-contact-trigger"]'),
    );
    assert.equal(
      await page.locator('[data-testid="floating-contact-trigger"]').count(),
      0,
      `${width}px: floating help must hide while the finder is visible`,
    );
    assert.equal(await page.locator("[data-home-reassurance-item]").count(), 3);
    assert.equal(await page.locator("[data-home-selection] .product-card-v2").count(), 3);
    assert.equal(await page.locator("[data-home-guide-card]").count(), 2);
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://verdanza.fr/",
    );
    assert.equal(await page.locator('[data-jsonld-id="jsonld-site-identity"]').count(), 1);

    const layout = await page.evaluate(() => {
      const hero = document.querySelector<HTMLElement>("[data-home-hero-v2]");
      const image = document.querySelector<HTMLImageElement>(".home-hero-v2__image");
      const matched = [...(image?.closest("picture")?.querySelectorAll("source") || [])]
        .find((source) => matchMedia(source.media).matches);
      const selectedImage = matched || image;
      const finder = document.querySelector<HTMLElement>("[data-home-product-finder]");
      const reassurance = document.querySelector<HTMLElement>("[data-home-reassurance]");
      const selection = document.querySelector<HTMLElement>("[data-home-selection]");
      const guides = document.querySelector<HTMLElement>("[data-home-guides]");
      const heroTargets = document.querySelectorAll<HTMLElement>(
        "[data-home-hero-primary], [data-home-hero-secondary]",
      );
      let shortestHeroTarget = Number.POSITIVE_INFINITY;
      for (const target of heroTargets) {
        shortestHeroTarget = Math.min(shortestHeroTarget, target.getBoundingClientRect().height);
      }
      return {
        heroTop: hero?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        heroBottom: hero?.getBoundingClientRect().bottom ?? Number.NEGATIVE_INFINITY,
        finderTop: finder?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        finderBottom: finder?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
        reassuranceTop: reassurance?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        selectionTop: selection?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        guidesTop: guides?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        shortestHeroTarget,
        imageFilter: image ? getComputedStyle(image).filter : "missing",
        imageObjectFit: image ? getComputedStyle(image).objectFit : "missing",
        imageAnimation: image
          ? getComputedStyle(image.closest<HTMLElement>(".home-hero-v2__media") || image).animationName
          : "missing",
        imageSrcSet: selectedImage?.getAttribute("srcset") ?? "",
        imageSizes: selectedImage?.getAttribute("sizes") ?? "",
        imageFetchPriority: image?.getAttribute("fetchpriority") ?? "",
        imageWidth: image?.getAttribute("width") ?? "",
        imageHeight: image?.getAttribute("height") ?? "",
      };
    });

    assert.ok(layout.finderTop < layout.heroBottom, `${width}px: finder must overlap the hero edge`);
    assert.ok(layout.finderBottom <= layout.reassuranceTop, `${width}px: reassurance must follow finder`);
    assert.ok(layout.reassuranceTop < layout.selectionTop, `${width}px: selection must follow reassurance`);
    assert.ok(layout.selectionTop < layout.guidesTop, `${width}px: guides must follow selection`);
    assert.ok(layout.overflow <= 1, `${width}px: horizontal overflow detected`);
    assert.ok(layout.shortestHeroTarget >= 44, `${width}px: hero CTAs must remain touch friendly`);
    assert.equal(layout.imageFilter, "none", `${width}px: hero image must stay crisp`);
    assert.equal(layout.imageObjectFit, "contain", `${width}px: hero must preserve every product contour`);
    const expectedImage = width >= 900 ? homeHeroImageVariant : width >= 768
      ? homeHeroTabletImageVariant : homeHeroMobileImageVariant;
    assert.equal(layout.imageSrcSet, expectedImage.srcSet);
    assert.equal(layout.imageSizes, expectedImage.sizes);
    assert.equal(layout.imageFetchPriority, "high");
    assert.ok(Number(layout.imageWidth) > 0 && Number(layout.imageHeight) > 0);
    if (width <= 430) {
      assert.ok(
        layout.finderTop - layout.heroTop < 720,
        `${width}px: finder must remain close to the compact mobile hero`,
      );
    }
    if (width === 390) {
      assert.equal(layout.imageAnimation, "none", "reduced motion must disable hero entry animation");
    }

    const rawHtml = (await response?.text()) ?? "";
    // The interactive footer now suppresses help too; it is not a restoration zone.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    const restoredHelp = page.locator('[data-testid="floating-contact-trigger"]');
    await restoredHelp.waitFor({ state: "detached" });
    await gotoDomReady(page, `${server.baseUrl}/livraison`);
    await restoredHelp.waitFor();
    assert.equal(
      await restoredHelp.getAttribute("aria-label"),
      "Besoin d'aide ?",
      `${width}px: floating help must return with its accessible label after all protected controls leave`,
    );
    await gotoDomReady(page, `${server.baseUrl}/`);
    await page.locator("[data-home-product-finder]").scrollIntoViewIfNeeded();
    await restoredHelp.waitFor({ state: "detached" });

    assert.match(rawHtml, /data-home-page-v2/);
    assert.match(rawHtml, /Une sélection CBD pensée pour vous\./);
    assert.match(rawHtml, /data-jsonld-id="jsonld-site-identity"/);
    assert.deepEqual(pageErrors, [], `${width}px: homepage must not raise browser errors`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  "Homepage V2 UI tests passed at 390, 430, 768, 1024, 1280, 1600px: hierarchy, art-directed hero, finder overlap, contextual help, section order, cards, guides, SEO, LCP priority, reduced motion and no overflow.",
);
