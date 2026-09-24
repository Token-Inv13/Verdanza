import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const products = [
  ["cookie-kush-indoor", "Cookie Kush Indoor"],
  ["harlequin-greenhouse", "Harlequin Greenhouse"],
  ["mandarine-cbd", "Mandarine"],
  ["mango-haze-cbd", "Mango Haze"],
  ["petites-tetes-og-kush", "OG Kush"],
  ["golden-static", "Golden Static"],
  ["supreme-50-cbd", "Suprême 50 % CBD"],
] as const;
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

try {
  const desktop = await createContext(1280, "no-preference");
  const desktopPage = await desktop.newPage();
  const pageErrors: string[] = [];
  desktopPage.on("pageerror", (error) => pageErrors.push(error.message));

  for (const [slug, name] of products) {
    const response = await gotoDomReady(desktopPage, `${server.baseUrl}/produits/${slug}`);
    assert.equal(response?.status(), 200, `${name}: prerendered route must return HTTP 200`);
    await desktopPage.locator("[data-product-page-v2]").waitFor();
    assert.equal(await desktopPage.locator("h1").innerText(), name);
    assert.equal(await desktopPage.locator("[data-product-profile]").count(), 1);
    assert.ok((await desktopPage.locator("[data-product-aroma]").count()) <= 3);
    assert.ok((await desktopPage.locator("[data-product-aspect]").count()) <= 2);
    assert.ok(
      ["Doux", "Moyen", "Fort"].includes(
        await desktopPage.locator("[data-product-intensity]").innerText(),
      ),
    );
    assert.ok((await desktopPage.locator("[data-product-editorial] dl > div").count()) <= 4);
    assert.equal(await desktopPage.locator("[data-product-purchase]").count(), 1);
    assert.equal(
      await desktopPage.locator('[data-jsonld-id="jsonld-product"]').count(),
      1,
      `${name}: Product JSON-LD must remain present`,
    );
    assert.equal(
      await desktopPage.locator('link[rel="canonical"]').getAttribute("href"),
      `https://verdanza.fr/produits/${slug}`,
    );
    const crispRendering = await desktopPage.evaluate(() => {
      const image = document.querySelector<HTMLElement>(".product-page-v2__image");
      const gallery = document.querySelector<HTMLElement>("[data-product-gallery]");
      return {
        imageFilter: image ? getComputedStyle(image).filter : "missing",
        imageObjectFit: image ? getComputedStyle(image).objectFit : "missing",
        galleryFilter: gallery ? getComputedStyle(gallery).filter : "missing",
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    assert.equal(crispRendering.imageFilter, "none");
    assert.equal(crispRendering.imageObjectFit, "contain");
    assert.equal(crispRendering.galleryFilter, "none");
    assert.ok(crispRendering.overflow <= 1, `${name}: desktop horizontal overflow detected`);

    const rawHtml = await response?.text();
    assert.match(rawHtml || "", /data-product-page-v2/);
    assert.ok((rawHtml || "").includes(name), `${name}: prerender must contain the product name`);
    assert.match(rawHtml || "", /application\/ld\+json/);
    assert.match(rawHtml || "", /https:\/\/schema.org\/OutOfStock/);
    assert.doesNotMatch(rawHtml || "", /https:\/\/schema.org\/InStock/);
    assert.doesNotMatch(rawHtml || "", /data-purchase-option-available="true"/);
  }

  await gotoDomReady(desktopPage, `${server.baseUrl}/produits/golden-static`);
  const thumbnails = desktopPage.locator("[data-product-thumbnail]");
  assert.equal(await thumbnails.count(), 3);
  const firstImageSrc = await desktopPage.locator(".product-page-v2__image").getAttribute("src");
  await thumbnails.nth(1).focus();
  await desktopPage.keyboard.press("Enter");
  await desktopPage.waitForFunction(
    (initialSrc) => document.querySelector<HTMLImageElement>(".product-page-v2__image")?.src !== initialSrc,
    new URL(firstImageSrc || "", server.baseUrl).toString(),
  );
  assert.equal(await thumbnails.nth(1).getAttribute("aria-pressed"), "true");

  const fixedFormat = desktopPage.locator('[data-purchase-option="fixed-price-golden-static-50-10g"]');
  assert.equal(await fixedFormat.isDisabled(), true);
  const primaryPurchaseButton = desktopPage.locator("[data-product-purchase] .btn-primary");
  assert.equal(await primaryPurchaseButton.isDisabled(), true);
  assert.match(await primaryPurchaseButton.innerText(), /Rupture de stock/);
  assert.deepEqual(
    await desktopPage.evaluate(() => JSON.parse(window.localStorage.getItem("verdanza-cart") || "[]")),
    [],
    "the prerender fallback must not create a cart line",
  );

  await desktopPage.locator("[data-product-editorial]").scrollIntoViewIfNeeded();
  assert.equal(await desktopPage.locator("[data-product-sticky-purchase]").count(), 0);
  assert.deepEqual(pageErrors, [], "desktop ProductPage must not raise browser errors");
  await desktop.close();

  const mobile = await createContext(390, "reduce");
  const mobilePage = await mobile.newPage();
  const mobileErrors: string[] = [];
  mobilePage.on("pageerror", (error) => mobileErrors.push(error.message));
  await gotoDomReady(mobilePage, `${server.baseUrl}/produits/mango-haze-cbd`);
  await mobilePage.locator("[data-product-page-v2]").waitFor();

  const mobileLayout = await mobilePage.evaluate(() => {
    const title = document.querySelector<HTMLElement>("h1");
    const gallery = document.querySelector<HTMLElement>("[data-product-gallery]");
    const profile = document.querySelector<HTMLElement>("[data-product-profile]");
    const purchase = document.querySelector<HTMLElement>("[data-product-purchase]");
    const targets = document.querySelectorAll<HTMLElement>(
      "[data-product-thumbnail], [data-purchase-option], [data-product-purchase] .btn-primary",
    );
    let minimumTargetHeight = Number.POSITIVE_INFINITY;
    for (const target of targets) {
      minimumTargetHeight = Math.min(minimumTargetHeight, target.getBoundingClientRect().height);
    }
    const image = document.querySelector<HTMLElement>(".product-page-v2__image");
    return {
      titleTop: title?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
      galleryTop: gallery?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
      profileTop: profile?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
      purchaseTop: purchase?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
      minimumTargetHeight,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      imageFilter: image ? getComputedStyle(image).filter : "missing",
      imageAnimation: image ? getComputedStyle(image).animationName : "missing",
    };
  });
  assert.ok(mobileLayout.titleTop < mobileLayout.galleryTop, "mobile title must precede the gallery");
  assert.ok(mobileLayout.galleryTop < mobileLayout.profileTop, "mobile gallery must precede the profile");
  assert.ok(mobileLayout.profileTop < mobileLayout.purchaseTop, "mobile profile must precede purchase");
  assert.ok(mobileLayout.minimumTargetHeight >= 44, "mobile interactive targets must be at least 44px high");
  assert.ok(mobileLayout.overflow <= 1, "390px layout must not overflow horizontally");
  assert.equal(mobileLayout.imageFilter, "none");
  assert.equal(mobileLayout.imageAnimation, "none");
  assert.deepEqual(mobileErrors, [], "mobile ProductPage must not raise browser errors");
  await mobile.close();
} finally {
  await browser.close();
  await server.close();
}

console.log(
  "ProductPage V2 UI tests passed: seven prerendered products, SEO/JSON-LD, gallery keyboard switch, fail-closed formats, 390px/1280px layouts, reduced motion, crisp images and no overflow.",
);

async function createContext(width: number, reducedMotion: "reduce" | "no-preference") {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    serviceWorkers: "block",
    reducedMotion,
  });
  await context.addInitScript(() => {
    (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean })
      .__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
    window.localStorage.setItem("verdanza-age-confirmed", "true");
    window.localStorage.setItem(
      "verdanza-consent-v1",
      JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-23T00:00:00.000Z" }),
    );
    window.localStorage.removeItem("verdanza-cart");
  });
  await blockExternalServices(context);
  return context;
}
