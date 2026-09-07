import type { BrowserContext, Page } from "playwright";

export async function gotoDomReady(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForStableDom(page);
  return response;
}

export async function waitForStableDom(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("body", { timeout: 10000 });
  await page.waitForFunction(
    () => {
      const body = document.body;
      if (!body) return false;
      const text = body.textContent || "";
      return (
        text.trim().length > 20 &&
        !text.includes("Chargement du catalogue") &&
        !text.includes("Chargement des produits") &&
        !text.includes("Chargement du produit")
      );
    },
    undefined,
    { timeout: 10000 },
  );
  await page.waitForTimeout(150);
}

export async function blockExternalServices(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (!isLocalResourceUrl(url)) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

export function isLocalResourceUrl(value: string) {
  const url = new URL(value);
  return (
    ["data:", "blob:"].includes(url.protocol) ||
    ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  );
}
