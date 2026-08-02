import { chromium, type Page } from "playwright";
import { blockExternalServices, gotoDomReady, waitForStableDom } from "./auditPageReady";

const baseUrl = process.argv[2] || "http://127.0.0.1:4173";
const noJavaScriptRoutes = [
  "/",
  "/blog",
  "/blog/comment-lire-analyse-cbd",
  "/blog/choisir-fleur-cbd-profil-aromatique",
  "/blog/fleur-cbd-ou-resine-cbd-differences",
  "/blog/indoor-greenhouse-hydroponique-differences",
  "/fleurs-cbd",
  "/resines-cbd",
  "/livraison",
  "/livraison-locale",
  "/livraison-postale",
  "/produits/golden-static",
  "/produits/supreme-purple-cbd",
  "/produits/mango-haze-cbd",
  "/connexion",
  "/auth/action",
  "/url-totalement-inconnue-test",
];

const browser = await chromium.launch();
const failures: string[] = [];

try {
  await auditWithoutJavaScript();
  await auditInteractiveViewport("desktop", { width: 1280, height: 900 });
  await auditInteractiveViewport("mobile", { width: 390, height: 844 });
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nRuntime audit failures:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("\nRuntime audit passed.");
}

async function auditWithoutJavaScript() {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    serviceWorkers: "block",
  });
  try {
    for (const route of noJavaScriptRoutes) {
      const page = await context.newPage();
      const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      const status = response?.status() || 0;
      const h1Count = await page.locator("h1").count();
      const title = await page.title();
      const canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute("href")
        .catch(() => "");
      const robots = await page
        .locator('meta[name="robots"]')
        .getAttribute("content")
        .catch(() => "");
      const mainTextLength = await page
        .locator("main, body")
        .first()
        .textContent()
        .then((text) => text?.trim().length || 0);
      const cssLinks = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
        links.map((link) => (link as HTMLLinkElement).href),
      );
      const scripts = await page.locator("script[src]").evaluateAll((items) =>
        items.map((script) => (script as HTMLScriptElement).src),
      );

      if (![200, 404].includes(status)) failures.push(`${route} no-JS status ${status}`);
      if (!title) failures.push(`${route} no-JS missing title`);
      if (!canonical) failures.push(`${route} no-JS missing canonical`);
      if (!robots) failures.push(`${route} no-JS missing robots`);
      if (h1Count !== 1) failures.push(`${route} no-JS h1 count ${h1Count}`);
      if (mainTextLength < 20) failures.push(`${route} no-JS content too short`);
      for (const asset of [...cssLinks, ...scripts]) {
        const assetResponse = await context.request.get(asset);
        if (!assetResponse.ok()) failures.push(`${route} asset failed: ${asset}`);
      }
      await page.close();
    }
  } finally {
    await context.close();
  }
}

async function auditInteractiveViewport(
  label: string,
  viewport: { width: number; height: number },
) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await blockExternalServices(context);
  await context.addInitScript(() => {
    window.localStorage.setItem("verdanza-age-confirmed", "true");
  });
  try {
    const page = await context.newPage();
    collectConsoleErrors(page, label);

    try {
      await gotoDomReady(page, `${baseUrl}/`);
      await expectOneH1(page, `${label} home`);
      if (label === "mobile") {
        await auditMobileMenu(page, label);
      }
      await page.getByRole("link", { name: /Guides/i }).first().click();
      await page.waitForURL("**/blog");
      await waitForStableDom(page);
      await expectOneH1(page, `${label} blog`);
      await page.getByRole("link", { name: /Fleur CBD ou résine CBD/i }).first().click();
      await page.waitForURL("**/blog/fleur-cbd-ou-resine-cbd-differences");
      await waitForStableDom(page);
      await expectOneH1(page, `${label} blog article`);
      await expectImagesLoaded(page, `${label} blog article`);
      await page.getByRole("link", { name: /Boutique/i }).first().click();
      await page.waitForURL("**/boutique");
      await waitForStableDom(page);
      await expectOneH1(page, `${label} boutique`);

      await gotoDomReady(page, `${baseUrl}/produits/golden-static`);
      await expectOneH1(page, `${label} product`);
      await expectImagesLoaded(page, `${label} product`);
      await page.getByRole("button", { name: /Ajouter 1 g au panier/i }).click();
      await gotoDomReady(page, `${baseUrl}/panier`);
      if (!(await page.getByText(/Golden Static/i).count())) {
        failures.push(`${label} cart did not contain added product`);
      }

      await gotoDomReady(page, `${baseUrl}/produits/golden-static`);
      await page.getByRole("button", { name: /Ajouter Golden Static aux favoris/i }).click();
      if (!(await page.getByText(/Connectez-vous pour ajouter ce produit/i).count())) {
        failures.push(`${label} favorite unauthenticated message missing`);
      }

      await gotoDomReady(page, `${baseUrl}/compte`);
      const accountRobots = await page.locator('meta[name="robots"]').getAttribute("content");
      if (accountRobots !== "noindex,nofollow") failures.push(`${label} account robots mismatch`);
      if (!(await page.getByRole("heading", { name: /Connexion/i }).count())) {
        failures.push(`${label} account gate did not show login`);
      }

      await gotoDomReady(page, `${baseUrl}/admin`);
      const adminRobots = await page.locator('meta[name="robots"]').getAttribute("content");
      if (adminRobots !== "noindex,nofollow") failures.push(`${label} admin robots mismatch`);
      if (
        !(await page.getByRole("heading", { name: /Admin Verdanza|Acces admin/i }).count())
      ) {
        failures.push(`${label} admin gate did not show admin login`);
      }

      await gotoDomReady(
        page,
        `${baseUrl}/auth/action?mode=unsupported&oobCode=runtime-secret&continueUrl=https%3A%2F%2Fevil.example`,
      );
      const authActionRobots = await page.locator('meta[name="robots"]').getAttribute("content");
      if (authActionRobots !== "noindex,nofollow") {
        failures.push(`${label} auth action robots mismatch`);
      }
      if (await page.getByRole("heading", { name: "Accès réservé aux majeurs" }).count()) {
        failures.push(`${label} auth action is blocked by the age gate`);
      }
      if (new URL(page.url()).search) {
        failures.push(`${label} auth action retained sensitive query parameters in the URL`);
      }
      await expectOneH1(page, `${label} auth action`);

      await gotoDomReady(page, `${baseUrl}/url-totalement-inconnue-test`);
      const unknownRobots = await page.locator('meta[name="robots"]').getAttribute("content");
      if (unknownRobots !== "noindex,nofollow") {
        failures.push(`${label} unknown route robots mismatch`);
      }
    } catch (error) {
      failures.push(`${label} runtime exception: ${error instanceof Error ? error.message : error}`);
    }
  } finally {
    await context.close();
  }
}

async function auditMobileMenu(page: Page, label: string) {
  const menuButton = page.getByRole("button", { name: "Ouvrir le menu mobile" });
  if ((await menuButton.count()) !== 1) {
    failures.push(`${label} mobile menu button missing`);
    return;
  }

  if ((await menuButton.getAttribute("aria-expanded")) !== "false") {
    failures.push(`${label} mobile menu closed aria-expanded mismatch`);
  }

  const controlledPanelId = await menuButton.getAttribute("aria-controls");
  if (!controlledPanelId) {
    failures.push(`${label} mobile menu aria-controls missing`);
    return;
  }

  const toggleButton = page.locator(`button[aria-controls="${controlledPanelId}"]`);
  await toggleButton.click();
  const closeButton = page.getByRole("button", { name: "Fermer le menu mobile" });
  if ((await closeButton.getAttribute("aria-expanded")) !== "true") {
    failures.push(`${label} mobile menu open aria-expanded mismatch`);
  }

  const menuPanel = page.locator(`#${controlledPanelId}`);
  if ((await menuPanel.count()) !== 1) {
    failures.push(`${label} mobile menu aria-controls target missing`);
    return;
  }

  const openWidths = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (openWidths.scrollWidth > openWidths.clientWidth) {
    failures.push(
      `${label} mobile menu overflow ${openWidths.scrollWidth} > ${openWidths.clientWidth}`,
    );
  }

  await page.keyboard.press("Escape");
  if ((await toggleButton.getAttribute("aria-expanded")) !== "false") {
    failures.push(`${label} mobile menu Escape did not close`);
  }
  if (!(await toggleButton.evaluate((button) => document.activeElement === button))) {
    failures.push(`${label} mobile menu Escape did not restore focus`);
  }

  await toggleButton.click();
  await page.locator(`#${controlledPanelId}`).getByRole("link", { name: "Accueil" }).click();
  if ((await toggleButton.getAttribute("aria-expanded")) !== "false") {
    failures.push(`${label} mobile menu link activation did not close`);
  }
  if ((await page.locator(`#${controlledPanelId}`).count()) !== 0) {
    failures.push(`${label} mobile menu panel remained after link activation`);
  }
}

function collectConsoleErrors(page: Page, label: string) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isExpectedRuntimeConsoleError(text)) return;
    failures.push(`${label} console error: ${text}`);
  });
  page.on("pageerror", (error) => failures.push(`${label} page error: ${error.message}`));
}

function isExpectedRuntimeConsoleError(message: string) {
  return (
    message === "Failed to load resource: net::ERR_FAILED" ||
    message === "Failed to load resource: the server responded with a status of 404 (Not Found)"
  );
}

async function expectOneH1(page: Page, label: string) {
  const h1Count = await page.locator("h1").count();
  if (h1Count !== 1) failures.push(`${label} h1 count ${h1Count}`);
}

async function expectImagesLoaded(page: Page, label: string) {
  await page
    .waitForFunction(
      () =>
        Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
      undefined,
      { timeout: 5000 },
    )
    .catch(() => undefined);
  const brokenImages = await page.locator("img").evaluateAll((images) =>
    images
      .filter((image) => {
        const element = image as HTMLImageElement;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0;
        if (!visible) return false;
        return !element.complete || element.naturalWidth === 0;
      })
      .map((image) => (image as HTMLImageElement).src),
  );
  if (brokenImages.length) {
    failures.push(`${label} images not loaded: ${brokenImages.join(", ")}`);
  }
}
