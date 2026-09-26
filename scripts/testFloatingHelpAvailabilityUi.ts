import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const before = process.argv.includes("--before");
const phase = before ? "before" : "after";
const output = process.env.VERDANZA_FLOATING_HELP_QA_DIR || mkdtempSync(join(tmpdir(), "verdanza-help-availability-"));
mkdirSync(output, { recursive: true });
const viewports = [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1280, height: 800 }];
const paths = ["/", "/boutique", "/blog", "/fleurs-cbd", "/produits/mandarine-cbd"];
const help = '[data-testid="floating-contact-trigger"]';
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });
type Scene = Awaited<ReturnType<typeof geometry>>;
const results: { path: string; viewport: { width: number; height: number }; availability: number; samples: Scene[]; restorations: number }[] = [];
if (before && process.argv.includes("--resume")) results.push(...JSON.parse(readFileSync(join(output, "before.json"), "utf8")).results);

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 768,
      isMobile: viewport.width < 768, serviceWorkers: "block", reducedMotion: viewport.width === 430 ? "reduce" : "no-preference" });
    await blockExternalServices(context);
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
        if (results.some((r) => r.path === path && r.viewport.width === viewport.width)) continue;
        await gotoDomReady(page, server.baseUrl + path);
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const max = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
        const positions = Array.from({ length: Math.floor(max / 80) + 1 }, (_, i) => i * 80);
        if (positions.at(-1) !== max) positions.push(max);
        const samples: Scene[] = [];
        const captured = new Set<string>();
        let restorations = 0;
        let previous = true;
        for (const y of positions) {
          await page.evaluate((top) => scrollTo({ top, behavior: "instant" }), y);
          await settle(page);
          const scene = await geometry(page, before);
          assertScene(scene, `${path} ${viewport.width} at ${y}`);
          if (scene.visible && !previous) restorations++;
          const state = scene.visible ? (previous ? "visible" : "restored") : "collision";
          // A restored Blog capture demonstrates the newly unprotected excerpt.
          if (!captured.has(state) && (path === "/blog" || path === "/")) {
            await page.screenshot({ path: join(output, `${phase}-${path === "/" ? "home" : "blog"}-${viewport.width}-${state}.png`) });
            captured.add(state);
          }
          if (samples.length % 20 === 0) await assertStable(page, before, scene.visible);
          previous = scene.visible;
          samples.push(scene);
        }
        assert.ok(samples.some((s) => s.collision), `${path}: positive collision case required`);
        assert.ok(samples.some((s) => s.visible && s.visibleTargets > 0), `${path}: visible target without collision must retain help`);
        // Restore to a clear sample, not a one-pixel hysteresis boundary.
        const restorationPosition = samples.filter((s) => s.visible).sort((a,b) => b.clearance-a.clearance)[0]?.y;
        assert.notEqual(restorationPosition, undefined, "an unobstructed restoration position must exist");
        await page.evaluate((top) => scrollTo({ top: top!, behavior: "instant" }), restorationPosition);
        await page.locator(help).waitFor({ state: "visible" });
        await assertStable(page, before, true);
        const availability = 100 * samples.filter((s) => s.visible).length / samples.length;
        results.push({ path, viewport, availability, samples, restorations });
        writeFileSync(join(output, `${phase}.json`), JSON.stringify({ step: 80, metric: "visible positions / regularly sampled positions", results }, null, 2));
        console.log(`${phase.toUpperCase()} ${path} ${viewport.width}×${viewport.height}: ${availability.toFixed(1)}%, ${samples.length} positions, ${restorations} restorations`);
      }
      assert.deepEqual(errors, [], `${viewport.width}: no browser errors`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await server.close(); }

const baselineFile = join(output, "before.json");
if (!before && existsSync(baselineFile)) {
  const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as { results: typeof results };
  const comparison = results.map((row) => {
    const original = baseline.results.find((r) => r.path === row.path && r.viewport.width === row.viewport.width);
    assert.ok(original, "matching before measurement required");
    assert.equal(row.samples.length, original.samples.length, "same scroll positions before/after");
    assert.deepEqual(row.samples.map((s) => s.y), original.samples.map((s) => s.y), "layout must remain unchanged");
    assert.ok(row.availability >= original.availability, "narrowing markers must not reduce availability");
    if (row.path === "/blog" && row.viewport.width < 768) assert.ok(row.availability - original.availability >= 15,
      "Blog mobile availability must improve substantially (at least 15 percentage points)");
    return { path: row.path, viewport: row.viewport, before: original.availability, after: row.availability,
      gain: row.availability - original.availability, indicativeTargetReached: row.availability >= 70 };
  });
  writeFileSync(join(output, "comparison.json"), JSON.stringify(comparison, null, 2));
  console.table(comparison.map((r) => ({ path: r.path, width: r.viewport.width, before: r.before.toFixed(1), after: r.after.toFixed(1), gain: r.gain.toFixed(1), target70: r.indicativeTargetReached })));
} else if (!before) {
  console.log("No before.json supplied: current availability measured; before/after comparison not performed.");
}
console.log(`Help availability ${phase}: ${results.length}/15 PASS; measurements and captures outside Git: ${output}`);

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

async function assertStable(page: Page, oldTargets: boolean, expected: boolean) {
  for (let frame = 0; frame < 4; frame++) {
    await settle(page);
    const scene = await geometry(page, oldTargets);
    assert.equal(scene.visible, expected, `stationary geometry must not flicker: ${JSON.stringify(scene)}`);
  }
}

async function geometry(page: Page, oldTargets: boolean) {
  return page.evaluate((legacy) => {
    const wrapper = document.querySelector<HTMLElement>('[data-floating-help-footprint]')!;
    const button = wrapper.querySelector<HTMLButtonElement>('[data-testid="floating-contact-trigger"]')!;
    const b = button.getBoundingClientRect();
    const visible = getComputedStyle(button).visibility !== "hidden";
    const margin = wrapper.getAttribute("data-floating-help-collision") === "true" ? 12 : 10;
    const selectors = ['[data-floating-help-suppress]'];
    if (legacy && location.pathname === "/") selectors.push('[data-home-product-finder]');
    if (!legacy && location.pathname === "/") selectors.push('[data-home-product-finder] button', '[data-home-product-finder] a');
    if (legacy && location.pathname === "/fleurs-cbd") selectors.push('[data-category-product-filter]');
    if (!legacy && location.pathname === "/fleurs-cbd") selectors.push('[data-category-product-filter] button');
    const painted = (s: Element) => {
      const style = getComputedStyle(s);
      return s.getClientRects().length && !s.closest('[aria-hidden="true"]') && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
    };
    const targets = [...document.querySelectorAll(selectors.join(","))].filter(painted);
    // Independent critical-control inventory: does not depend on suppression markers.
    const controlSelector = '[data-home-product-finder] button, [data-home-product-finder] a, [data-shop-product-selector] button, [data-category-product-filter] button, .product-card-v2 select, .product-card-v2 button[aria-label], [data-product-thumbnail], [data-purchase-option], [data-product-purchase] .btn-primary, [data-product-sticky-purchase] button, footer a, footer button';
    const controls = [...document.querySelectorAll(controlSelector + (location.pathname === "/blog" ? ', main article h2 a, main article a.inline-flex' : ''))]
      .filter((c) => !c.closest('.product-card-v2') || c.tagName === "SELECT" || c.textContent?.includes("panier") || c.hasAttribute("disabled"))
      .filter(painted);
    const area = (r: DOMRect) => Math.max(0, Math.min(b.right,r.right)-Math.max(b.left,r.left)) * Math.max(0, Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top));
    const collision = targets.some((s) => { const r=s.getBoundingClientRect(); return r.width>0 && r.height>0 && b.left-margin<r.right && b.right+margin>r.left && b.top-margin<r.bottom && b.bottom+margin>r.top; });
    const clearance = Math.min(...targets.map((s) => { const r=s.getBoundingClientRect(); return Math.max(b.left-r.right,r.left-b.right,b.top-r.bottom,r.top-b.bottom); }));
    const pointerFailures: string[] = [];
    let pointerChecks = 0;
    for (const control of controls) {
      // Text fragments avoid an inline title's empty rectangular line-end space.
      const boxes: DOMRect[] = [];
      if (control.tagName === "A") {
        const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) {
          const range = document.createRange(); range.selectNodeContents(walker.currentNode); boxes.push(...range.getClientRects());
        }
      } else boxes.push(control.getBoundingClientRect());
      for (const r of boxes) if (area(r)>0) {
        // Painted edges snap to pixels: do not hit-test a subpixel-only border
        // intersection. Full rectangles still participate in the zero-area check.
        const left=Math.max(b.left,r.left+1), right=Math.min(b.right,r.right-1);
        const top=Math.max(b.top,r.top+1), bottom=Math.min(b.bottom,r.bottom-1);
        if (right<=left || bottom<=top) continue;
        const x=(left+right)/2, y=(top+bottom)/2;
        if (y<80 || y>=innerHeight) continue;
        pointerChecks++;
        const hit = document.elementFromPoint(x,y);
        if (!control.contains(hit)) pointerFailures.push(JSON.stringify({ control: control.textContent?.trim().slice(0,50) || control.tagName,
          hit: hit?.tagName, hitClass: hit?.className, x, y, rect: { left:r.left,top:r.top,right:r.right,bottom:r.bottom } }));
      }
    }
    return { y: scrollY, visible, collision, clearance, width: b.width, height: b.height,
      visibleTargets: targets.filter((s)=>{const r=s.getBoundingClientRect(); return r.bottom>80 && r.top<innerHeight;}).length,
      area: visible ? targets.reduce((n,s)=>n+area(s.getBoundingClientRect()),0) : 0,
      controlArea: visible ? controls.reduce((n,s)=>n+area(s.getBoundingClientRect()),0) : 0,
      pointerChecks, pointerFailures, overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth };
  }, oldTargets);
}

function assertScene(scene: Scene, label: string) {
  assert.ok(scene.width > 0 && scene.height > 0, `${label}: footprint stays measurable`);
  assert.equal(scene.visible, !scene.collision, `${label}: geometric collision-only visibility`);
  assert.equal(scene.area, 0, `${label}: protected intersection 0 px²`);
  assert.equal(scene.controlArea, 0, `${label}: independent critical-control intersection 0 px²`);
  assert.deepEqual(scene.pointerFailures, [], `${label}: elementFromPoint must reach the actual control`);
  assert.equal(scene.overflow, 0, `${label}: no horizontal overflow`);
}
