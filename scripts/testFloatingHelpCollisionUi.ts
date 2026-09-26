import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const viewports = [
  { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 768, height: 1024 }, { width: 1024, height: 800 },
  { width: 1280, height: 800 }, { width: 1600, height: 900 },
] as const;
const paths = ["/", "/boutique", "/blog", "/fleurs-cbd", "/produits/mandarine-cbd", "/produits/golden-static", "/livraison"];
const output = process.env.VERDANZA_FLOATING_HELP_QA_DIR || mkdtempSync(join(tmpdir(), "verdanza-help-collision-"));
mkdirSync(join(output, "videos"), { recursive: true });
const helpSelector = '[data-testid="floating-contact-trigger"]';
const results: object[] = [];
const videos: { width: number; height: number; path: string }[] = [];
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport, serviceWorkers: "block", hasTouch: viewport.width <= 768,
      isMobile: viewport.width < 768,
      reducedMotion: viewport.width === 430 ? "reduce" : "no-preference",
      ...(viewport.width <= 430 ? { recordVideo: { dir: join(output, "videos"), size: viewport } } : {}),
    });
    await blockExternalServices(context);
    // tsx preserves callback names using this helper when serializing evaluate.
    await context.addInitScript("window.__name = (fn) => fn;");
    await context.addInitScript(() => {
      (window as Window & { __VERDANZA_PRODUCT_CATALOG_PRERENDER__?: boolean }).__VERDANZA_PRODUCT_CATALOG_PRERENDER__ = true;
      localStorage.setItem("verdanza-age-confirmed", "true");
      localStorage.setItem("verdanza-consent-v1", JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-26T00:00:00.000Z" }));
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      for (const path of paths) {
        await gotoDomReady(page, server.baseUrl + path);
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const scene = await geometry(page);
        const positions = await page.evaluate((footprint) => {
          const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
          const positions = new Set([0, max]);
          for (let y = 0; y <= max; y += 180) positions.add(y);
          for (const target of document.querySelectorAll('[data-floating-help-suppress],[data-home-product-finder]')) {
            const r = target.getBoundingClientRect();
            if (getComputedStyle(target).position === "fixed" || !r.height) continue;
            for (const y of [r.top - footprint.bottom - 15, r.top - footprint.bottom + 15,
              (r.top + r.bottom - footprint.top - footprint.bottom) / 2, r.bottom - footprint.top + 15]) {
              positions.add(Math.min(max, Math.max(0, Math.round(y))));
            }
          }
          return [...positions].sort((a, b) => a - b);
        }, scene.footprint);
        let negative = 0;
        let positive = 0;
        let restorations = 0;
        let lastVisible = scene.visible;
        const samples: Awaited<ReturnType<typeof geometry>>[] = [];
        const captured = new Set<string>();
        for (const y of [...positions, 0]) {
          await page.evaluate((top) => scrollTo({ top, behavior: "instant" }), y);
          await settle(page);
          const sample = await geometry(page);
          assertScene(sample, `${path} ${viewport.width} at ${y}`);
          if (sample.visible && sample.visibleSurfaces > 0) negative++;
          if (sample.collision) positive++;
          if (sample.visible && !lastVisible) restorations++;
          const state = sample.visible ? (lastVisible ? "visible" : "restored") : "collision";
          if ((viewport.width === 390 || viewport.width === 1280) && !captured.has(state)) {
            await page.screenshot({ path: join(output, `${path === "/" ? "home" : path.replaceAll("/", "-").slice(1)}-${viewport.width}-${state}.png`) });
            captured.add(state);
          }
          lastVisible = sample.visible;
          samples.push(sample);
        }
        assert.ok(path === "/livraison" ? samples.some((sample) => sample.visible) : negative > 0,
          `${path} ${viewport.width}: visible protected surface WITHOUT collision must keep help visible`);
        assert.ok(positive > 0, `${path} ${viewport.width}: approaching footer must exercise a real collision`);
        assert.ok(restorations > 0, `${path} ${viewport.width}: help must restore after a protected surface`);
        results.push({ path, viewport, negative, positive, restorations, samples });
        writeFileSync(join(output, "geometry.json"), JSON.stringify(results, null, 2));
        console.log(`PASS ${path} ${viewport.width}×${viewport.height}: non-collision=${negative}, collision=${positive}, restoration=${restorations}`);
      }
      await gotoDomReady(page, server.baseUrl + "/livraison");
      await page.locator(helpSelector).waitFor({ state: "visible" });
      await page.locator(helpSelector).click();
      await page.getByRole("heading", { name: "Contacter Verdanza", exact: true }).waitFor();
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await page.locator(helpSelector).waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("heading", { name: "Contacter Verdanza", exact: true }).count(), 0);
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.locator(helpSelector).waitFor({ state: "visible" });
      assert.equal(await page.locator(helpSelector).getAttribute("aria-expanded"), "false");
      await assertDynamicGeometry(page);
      if (viewport.width < 1024) {
        await page.locator('[aria-controls="mobile-navigation-menu"]').click();
        await page.locator(helpSelector).waitFor({ state: "hidden" });
        assert.equal(await page.locator('[data-floating-help-footprint]').getAttribute("data-floating-help-context-suppressed"), "true");
        await page.keyboard.press("Escape");
        await page.locator(helpSelector).waitFor({ state: "visible" });
      }
      await page.locator(helpSelector).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "Contacter Verdanza", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(helpSelector).evaluate((element) => document.activeElement === element), true);
      assert.deepEqual(errors, [], `${viewport.width}: no browser errors`);
      console.log(`PASS ${viewport.width}: dynamic content, button resize, hysteresis, panel closure, focus, menu suppression`);
    } finally {
      await context.close();
      const video = page.video();
      if (video) videos.push({ ...viewport, path: await video.path() });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`Floating help collision UI: ${results.length}/${paths.length * viewports.length} route/viewports PASS. Captures/videos: ${output}`);
writeFileSync(join(output, "videos.json"), JSON.stringify(videos, null, 2));

async function settle(page: Page) {
  // Two paint boundaries let the batched geometry update commit before checking.
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>('[data-floating-help-footprint]');
    const button = wrapper?.querySelector<HTMLButtonElement>('[data-testid="floating-contact-trigger"]');
    if (!wrapper || !button) throw Error("Help footprint must remain mounted");
    const b = button.getBoundingClientRect();
    const visible = getComputedStyle(button).visibility !== "hidden";
    const margin = wrapper.getAttribute("data-floating-help-collision") === "true" ? 12 : 10;
    const selectors = ['[data-floating-help-suppress]'];
    if (location.pathname === "/") selectors.push('[data-home-product-finder] button', '[data-home-product-finder] a');
    if (["/fleurs-cbd", "/resines-cbd"].includes(location.pathname)) selectors.push('[data-category-product-filter] button');
    const surfaces = [...document.querySelectorAll<HTMLElement>(selectors.join(","))].filter((s) => {
      const style = getComputedStyle(s);
      return s.getClientRects().length && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
    });
    const intersect = (r: DOMRect, m = 0) => r.width > 0 && r.height > 0 &&
      b.left - m < r.right && b.right + m > r.left && b.top - m < r.bottom && b.bottom + m > r.top;
    const collision = surfaces.some((s) => intersect(s.getBoundingClientRect(), margin));
    const pointerFailures: string[] = [];
    let pointerChecks = 0;
    for (const surface of surfaces) for (const control of [
      ...(surface.matches('button,select,a') ? [surface] : []),
      ...surface.querySelectorAll('button,select,a'),
    ]) {
      // Closed accordions retain child rectangles while their content is
      // clipped/aria-hidden; those controls are not painted hit-test targets.
      if (control.closest('[aria-hidden="true"]') || !control.getClientRects().length) continue;
      const boxes: DOMRect[] = [];
      if (control.tagName === "A") {
        const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) {
          const range = document.createRange(); range.selectNodeContents(walker.currentNode); boxes.push(...range.getClientRects());
        }
      } else boxes.push(control.getBoundingClientRect());
      for (const rect of boxes) if (intersect(rect)) {
        const x = (Math.max(b.left, rect.left) + Math.min(b.right, rect.right)) / 2;
        const y = (Math.max(b.top, rect.top) + Math.min(b.bottom, rect.bottom)) / 2;
        if (y < 80 || y >= innerHeight) continue;
        pointerChecks++;
        if (!control.contains(document.elementFromPoint(x, y))) pointerFailures.push(control.textContent?.trim().slice(0,60) || control.tagName);
      }
    }
    return {
      y: scrollY, visible, collision,
      contextSuppressed: wrapper.getAttribute("data-floating-help-context-suppressed") === "true",
      ariaHidden: wrapper.getAttribute("aria-hidden"), disabled: button.disabled, tabIndex: button.tabIndex,
      footprint: { top: b.top, right: b.right, bottom: b.bottom, left: b.left, width: b.width, height: b.height },
      visibleSurfaces: surfaces.filter((s) => { const r=s.getBoundingClientRect(); return r.bottom>80 && r.top<innerHeight; }).length,
      area: visible ? surfaces.reduce((sum,s) => { const r=s.getBoundingClientRect(); return sum +
        Math.max(0,Math.min(b.right,r.right)-Math.max(b.left,r.left)) * Math.max(0,Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top)); },0) : 0,
      pointerChecks, pointerFailures,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

function assertScene(scene: Awaited<ReturnType<typeof geometry>>, label: string) {
  assert.ok(scene.footprint.width > 0 && scene.footprint.height > 0, `${label}: measurable while hidden`);
  assert.equal(scene.visible, !scene.collision && !scene.contextSuppressed, `${label}: collision-only visibility`);
  assert.equal(scene.area, 0, `${label}: visible help intersection must be 0 px²`);
  assert.equal(scene.overflow, 0, `${label}: no overflow`);
  assert.deepEqual(scene.pointerFailures, [], `${label}: protected controls must receive elementFromPoint hits`);
  assert.equal(scene.disabled, !scene.visible, `${label}: hidden trigger cannot be interactive`);
  if (!scene.visible) {
    assert.equal(scene.tabIndex, -1, `${label}: hidden trigger cannot receive keyboard focus`);
    assert.equal(scene.ariaHidden, "true", `${label}: hidden help must leave accessibility tree`);
  }
}

async function assertDynamicGeometry(page: Page) {
  const reference = (await geometry(page)).footprint;
  // Local fixture exercises dynamic marker insertion/removal without moving
  // any production Finder/card/gallery/footer layout.
  await page.evaluate(() => {
    const target = document.createElement("button");
    target.setAttribute("data-floating-help-suppress", "test-dynamic");
    target.setAttribute("data-help-test-fixture", "");
    target.textContent = "Contrôle QA local";
    target.style.cssText = "position:fixed;left:12px;top:100px;width:100px;height:48px;z-index:20";
    document.body.append(target);
  });
  await settle(page);
  assert.equal((await geometry(page)).visible, true, "visible dynamic target elsewhere must not hide help");
  await page.locator('[data-help-test-fixture]').evaluate((target, r) => {
    (target as HTMLElement).style.left = `${r.left}px`; (target as HTMLElement).style.top = `${r.top}px`;
  }, reference);
  await page.locator(helpSelector).waitFor({ state: "hidden" });
  assertScene(await geometry(page), "dynamic collision");
  assert.equal(await page.locator('[data-help-test-fixture]').evaluate((target) => {
    const r = target.getBoundingClientRect();
    return target.contains(document.elementFromPoint(r.left + 5, r.top + 5));
  }), true, "dynamic protected control must receive pointer hits");
  await page.locator('[data-help-test-fixture]').evaluate((target, r) => {
    (target as HTMLElement).style.top = `${r.bottom + 11}px`;
  }, reference);
  for (let frame = 0; frame < 12; frame++) {
    await settle(page);
    assert.equal((await geometry(page)).visible, false, "hysteresis band must not flicker");
  }
  await page.locator('[data-help-test-fixture]').evaluate((target, r) => {
    (target as HTMLElement).style.left = `${r.left - 32}px`;
    (target as HTMLElement).style.top = `${r.top + 5}px`;
    (target as HTMLElement).style.width = "10px";
  }, reference);
  await page.locator(helpSelector).waitFor({ state: "visible" });
  await page.evaluate(() => { document.documentElement.style.fontSize = "170%"; });
  await page.locator(helpSelector).waitFor({ state: "hidden" });
  assert.equal((await geometry(page)).collision, true, "ResizeObserver must catch footprint expansion");
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.locator(helpSelector).waitFor({ state: "visible" });
  await page.locator('[data-help-test-fixture]').evaluate((target) => target.remove());
  await settle(page);
  assertScene(await geometry(page), "dynamic removal restoration");
}
