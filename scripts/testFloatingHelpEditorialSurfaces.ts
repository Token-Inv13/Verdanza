import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const helpSelector = '[data-testid="floating-contact-trigger"]';
const baseline = process.argv.includes("--baseline");
const output = process.env.VERDANZA_FLOATING_HELP_QA_DIR ||
  mkdtempSync(join(tmpdir(), "verdanza-floating-help-qa-"));
mkdirSync(output, { recursive: true });

const cases = [
  { width: 430, height: 932, path: "/blog", surface: "blog-editorial",
    target: 'h2 a[href="/blog/emballage-cbd-contenant-fermeture"]' },
  { width: 768, height: 1024, path: "/blog", surface: "blog-editorial",
    target: 'h2 a[href="/blog/emballage-cbd-contenant-fermeture"]' },
  { width: 1024, height: 800, path: "/blog", surface: "blog-editorial",
    target: 'h2 a[href="/blog/analyse-cbd-nd-lod-loq"]' },
  { width: 1280, height: 800, path: "/blog", surface: "blog-editorial",
    target: 'h2 a[href="/blog/indoor-greenhouse-hydroponique-differences"]' },
  { width: 768, height: 1024, path: "/produits/golden-static", surface: "product-gallery",
    target: '[data-product-thumbnail]:nth-child(3)' },
  { width: 1024, height: 800, path: "/", surface: "footer",
    target: 'footer a[href*="instagram.com"]' },
] as const;

type Rectangle = { x: number; y: number; width: number; height: number };
const results: object[] = [];
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

try {
  for (const testCase of cases) {
    const context = await browser.newContext({
      viewport: { width: testCase.width, height: testCase.height },
      serviceWorkers: "block",
      reducedMotion: testCase.width === 430 ? "reduce" : "no-preference",
    });
    try {
      await blockExternalServices(context);
      await context.addInitScript(() => {
        (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean })
          .__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
        localStorage.setItem("verdanza-age-confirmed", "true");
        localStorage.setItem("verdanza-consent-v1", JSON.stringify({
          version: 1, analytics: false, decidedAt: "2026-09-26T00:00:00.000Z",
        }));
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const label = `${testCase.path} ${testCase.width}×${testCase.height}`;

      // Measure the real help button on an unprotected surface. For product
      // pages, a shorter reference viewport exposes only the static photo;
      // translate its fixed-position rectangle back to the exact QA height.
      // Never remove a marker, force help visible, or alter application CSS.
      if (testCase.surface === "product-gallery") {
        await page.setViewportSize({ width: testCase.width, height: 600 });
        await gotoDomReady(page, `${server.baseUrl}${testCase.path}`);
      } else {
        await gotoDomReady(page, `${server.baseUrl}/livraison`);
      }
      await page.locator(helpSelector).waitFor({ state: "visible" });
      const reference = await page.locator(helpSelector).boundingBox();
      assert.ok(reference, `${label}: reference help rectangle is required`);
      if (testCase.surface === "product-gallery") {
        reference.y += testCase.height - 600;
        await page.setViewportSize({ width: testCase.width, height: testCase.height });
      }

      await gotoDomReady(page, `${server.baseUrl}${testCase.path}`);
      await page.evaluate(() => document.fonts.ready);
      const target = page.locator(testCase.target);
      assert.equal(await target.count(), 1, `${label}: regression target must be unique`);
      await target.waitFor();
      await positionAtFormerHelp(page, testCase.target, reference);
      if (!baseline) await page.locator(helpSelector).waitFor({ state: "detached" });

      const metrics = await target.evaluate((element, options) => {
        const protectedSurface = element.closest(
          `[data-floating-help-suppress="${options.surface}"]`,
        );
        const surface = protectedSurface || element.closest(".space-y-4.p-5, [data-product-thumbnails], footer");
        if (!surface) throw new Error("Regression surface missing");
        const rect = surface.getBoundingClientRect();
        const help = document.querySelector<HTMLElement>('[data-testid="floating-contact-trigger"]');
        const helpRect = help?.getBoundingClientRect();
        const area = helpRect
          ? Math.max(0, Math.min(rect.right, helpRect.right) - Math.max(rect.left, helpRect.left)) *
            Math.max(0, Math.min(rect.bottom, helpRect.bottom) - Math.max(rect.top, helpRect.top))
          : 0;
        const former = options.reference;
        const boxes = foregroundBoxes(element);
        const formerIntersections = boxes.map((box) => ({
          left: Math.max(box.left, former.x), right: Math.min(box.right, former.x + former.width),
          top: Math.max(box.top, former.y), bottom: Math.min(box.bottom, former.y + former.height),
        })).filter((box) => box.right > box.left && box.bottom > box.top);
        const box = formerIntersections.at(-1);
        if (!box) throw new Error("Target must exercise the formerly covered help footprint");
        const point = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          protected: Boolean(protectedSurface), area, point,
          formerIntersectionArea: (box.right - box.left) * (box.bottom - box.top),
          pointerHit: element.contains(hit), helpReceivesPointer: Boolean(help?.contains(hit)),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };

        function foregroundBoxes(node: Element) {
          if (node.tagName !== "A") return [node.getBoundingClientRect()];
          const boxes: DOMRect[] = [];
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            boxes.push(...range.getClientRects());
          }
          return boxes;
        }
      }, { surface: testCase.surface, reference });

      assert.ok(metrics.formerIntersectionArea > 0, `${label}: reproduce original collision geometry`);
      assert.equal(metrics.overflow, 0, `${label}: no horizontal overflow`);
      if (baseline) {
        assert.ok(metrics.area > 0, `${label}: baseline must reproduce help overlap`);
        assert.equal(metrics.helpReceivesPointer, true, `${label}: baseline help intercepts this point`);
      } else {
        assert.equal(metrics.protected, true, `${label}: real interactive surface must be marked`);
        assert.equal(metrics.area, 0, `${label}: help/surface intersection must be 0 px²`);
        assert.equal(metrics.pointerHit, true, `${label}: formerly covered target receives the pointer`);
        const samples = await page.evaluate(async () => {
          const states: boolean[] = [];
          for (let index = 0; index < 12; index += 1) {
            await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
            states.push(Boolean(document.querySelector('[data-testid="floating-contact-trigger"]')));
          }
          return states;
        });
        assert.ok(samples.every((visible) => !visible), `${label}: no flicker on a stationary protected surface`);

        if (testCase.surface === "product-gallery") {
          const originalImage = await page.locator(".product-page-v2__image").getAttribute("src");
          await page.mouse.click(metrics.point.x, metrics.point.y);
          assert.equal(await target.getAttribute("aria-pressed"), "true", `${label}: third thumbnail still selects`);
          assert.notEqual(await page.locator(".product-page-v2__image").getAttribute("src"), originalImage);
          await page.locator(".product-page-v2__image").evaluate(async (element) => {
            await (element as HTMLImageElement).decode();
            await Promise.all(element.getAnimations().map((animation) => animation.finished));
          });
        } else if (testCase.surface === "footer") {
          await assertPointerTarget(page, 'footer a[href*="facebook.com"]');
        }
      }

      const screenshot = join(output, `${baseline ? "before" : "after"}-${testCase.width}-${testCase.surface}.png`);
      await page.screenshot({ path: screenshot });
      results.push({ ...testCase, ...metrics, screenshot });
      writeFileSync(join(output, baseline ? "geometry-before.json" : "geometry-after.json"), JSON.stringify(results, null, 2));
      if (!baseline) {
        await gotoDomReady(page, `${server.baseUrl}/livraison`);
        await page.locator(helpSelector).waitFor({ state: "visible" });
        await page.locator(helpSelector).focus();
        await page.keyboard.press("Enter");
        await page.getByRole("heading", { name: "Contacter Verdanza", exact: true }).waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(helpSelector).getAttribute("aria-expanded"), "false");
        assert.equal(await page.locator(helpSelector).evaluate((element) => document.activeElement === element), true);
      }
      assert.deepEqual(errors, [], `${label}: no browser errors`);
      console.log(`${baseline ? "BASELINE" : "PASS"} ${label}: area=${metrics.area} px², pointer=${metrics.pointerHit}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`${baseline ? "Baseline" : "Editorial surfaces"}: ${results.length}/6 cases. QA captures: ${output}`);

async function positionAtFormerHelp(page: Page, selector: string, reference: Rectangle) {
  await page.locator(selector).evaluate((element, former) => {
    const boxes: DOMRect[] = [];
    if (element.tagName === "A") {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        boxes.push(...range.getClientRects());
      }
    } else boxes.push(element.getBoundingClientRect());
    const box = boxes.filter((rect) => rect.right > former.x && rect.left < former.x + former.width).at(-1);
    if (!box) throw new Error("Regression text/control must intersect the help horizontal footprint");
    const targetY = scrollY + box.top + box.height / 2 - (former.y + former.height / 2);
    window.scrollTo({ top: targetY, behavior: "instant" });
  }, reference);
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() =>
    requestAnimationFrame(() => resolveFrame()))));
}

async function assertPointerTarget(page: Page, selector: string) {
  const target = page.locator(selector);
  assert.equal(await target.count(), 1);
  const receivesPointer = await target.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  });
  assert.equal(receivesPointer, true, `${selector}: footer link must receive pointer`);
}
