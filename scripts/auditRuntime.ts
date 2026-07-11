import { chromium, type Page } from "playwright";

const baseUrl = process.argv[2] || "http://127.0.0.1:4173";
const noJavaScriptRoutes = [
  "/",
  "/blog",
  "/blog/fleur-cbd-ou-resine-cbd-differences",
  "/blog/indoor-greenhouse-hydroponique-differences",
  "/fleurs-cbd",
  "/resines-cbd",
  "/livraison-postale",
  "/produits/golden-static",
  "/produits/supreme-purple-cbd",
  "/produits/mango-haze-cbd",
  "/connexion",
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
  const context = await browser.newContext({ javaScriptEnabled: false });
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
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    window.localStorage.setItem("verdanza-age-confirmed", "true");
  });
  try {
    const page = await context.newPage();
    collectConsoleErrors(page, label);

    try {
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      await expectOneH1(page, `${label} home`);
      await page.getByRole("link", { name: /Guides/i }).first().click();
      await page.waitForURL("**/blog");
      await expectOneH1(page, `${label} blog`);
      await page.getByRole("link", { name: /Fleur CBD ou résine CBD/i }).first().click();
      await page.waitForURL("**/blog/fleur-cbd-ou-resine-cbd-differences");
      await expectOneH1(page, `${label} blog article`);
      await expectImagesLoaded(page, `${label} blog article`);
      await page.getByRole("link", { name: /Boutique/i }).first().click();
      await page.waitForURL("**/boutique");
      await expectOneH1(page, `${label} boutique`);

      await page.goto(`${baseUrl}/produits/golden-static`, { waitUntil: "networkidle" });
      await expectOneH1(page, `${label} product`);
      await expectImagesLoaded(page, `${label} product`);
      await page.getByRole("button", { name: /Ajouter 1 g au panier/i }).click();
      await page.goto(`${baseUrl}/panier`, { waitUntil: "networkidle" });
      if (!(await page.getByText(/Golden Static/i).count())) {
        failures.push(`${label} cart did not contain added product`);
      }

      await page.goto(`${baseUrl}/produits/golden-static`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Ajouter Golden Static aux favoris/i }).click();
      if (!(await page.getByText(/Connectez-vous pour ajouter ce produit/i).count())) {
        failures.push(`${label} favorite unauthenticated message missing`);
      }

      await page.goto(`${baseUrl}/compte`, { waitUntil: "networkidle" });
      const accountRobots = await page.locator('meta[name="robots"]').getAttribute("content");
      if (accountRobots !== "noindex,nofollow") failures.push(`${label} account robots mismatch`);
      if (!(await page.getByRole("heading", { name: /Connexion/i }).count())) {
        failures.push(`${label} account gate did not show login`);
      }

      await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
      const adminRobots = await page.locator('meta[name="robots"]').getAttribute("content");
      if (adminRobots !== "noindex,nofollow") failures.push(`${label} admin robots mismatch`);
      if (
        !(await page.getByRole("heading", { name: /Admin Verdanza|Acces admin/i }).count())
      ) {
        failures.push(`${label} admin gate did not show admin login`);
      }

      await page.goto(`${baseUrl}/url-totalement-inconnue-test`, { waitUntil: "networkidle" });
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

function collectConsoleErrors(page: Page, label: string) {
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${label} console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`${label} page error: ${error.message}`));
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
        return !element.complete || element.naturalWidth === 0;
      })
      .map((image) => (image as HTMLImageElement).src),
  );
  if (brokenImages.length) {
    failures.push(`${label} images not loaded: ${brokenImages.join(", ")}`);
  }
}
