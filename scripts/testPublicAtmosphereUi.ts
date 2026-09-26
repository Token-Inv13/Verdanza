import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Page } from "playwright";
import { blockExternalServices, gotoDomReady } from "./auditPageReady";
import { startAuditStaticServer } from "./auditStaticServer";

const baselineMode = process.argv.includes("--baseline");
const compareBaseline = process.argv.includes("--compare-baseline");
const output = join(process.env.TEMP || process.cwd(), "verdanza-phase6d-qa-20260926");
const widths = [390, 430, 768, 1280, 1600];
const paths = ["/", "/boutique", "/fleurs-cbd", "/resines-cbd", "/produits/mandarine-cbd", "/avantages", "/concours", "/blog", "/livraison", "/qualite-conformite", "/cgv", "/mentions-legales", "/faq", "/blog/emballage-cbd-contenant-fermeture"];
const screenshotNames: Record<string, string> = { "/": "home", "/boutique": "boutique", "/avantages": "avantages", "/produits/mandarine-cbd": "product" };
await mkdir(output, { recursive: true });
const baselinePath = join(output, "baseline.json");
// Normal guards run independently; before/after QA requires an explicit local baseline.
const baseline = compareBaseline && !baselineMode ? JSON.parse(await readFile(baselinePath, "utf8")) : null;
const rootSelector = baselineMode ? ".min-h-screen.bg-ivory.text-ink" : "[data-public-atmosphere]";
const snapshots: Record<string, unknown> = {};
const perf: Record<string, unknown> = {};
const pairedPerf: Record<string, unknown> = {};
const protectedFiles = Object.fromEntries(walk("src").filter((file) => !["src/layouts/MainLayout.tsx", "src/styles/index.css"].includes(file.replaceAll("\\", "/")))
  .map((file) => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
if (baseline) assert.deepEqual(protectedFiles, baseline.protectedFiles, "all other src files must remain byte-identical");
const server = await startAuditStaticServer();
const browser = await chromium.launch({ headless: true });

try {
  for (const width of widths) {
    const height = width === 390 ? 844 : width === 430 ? 932 : width === 768 ? 1024 : 800;
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    await blockExternalServices(context);
    // tsx/esbuild retains local function names in serialized test callbacks.
    await context.addInitScript("window.__name = (fn) => fn;");
    await context.addInitScript(() => {
      Object.assign(window, { __VERDANZA_PRODUCT_CATALOG_PRERENDER__: true, __atmosphereCls: 0 });
      localStorage.setItem("verdanza-age-confirmed", "true");
      localStorage.setItem("verdanza-consent-v1", JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-26T00:00:00Z" }));
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
          if (!shift.hadRecentInput) (window as unknown as { __atmosphereCls: number }).__atmosphereCls += shift.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await context.route("**/api/contests**", (route) => route.fulfill({ json: { contest: null } }));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const path of paths) {
      const response = await gotoDomReady(page, `${server.baseUrl}${path}`);
      assert.equal(response?.status(), 200, `${width}px ${path}: HTTP 200`);
      await page.locator("h1").waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const snapshot = await layoutSnapshot(page, rootSelector);
      const key = `${width}:${path}`;
      snapshots[key] = snapshot;
      assert.ok(snapshot.overflow <= 1, `${key}: horizontal overflow`);
      if (baseline) assert.deepEqual(snapshot, baseline.snapshots[key], `${key}: geometry, surfaces, text/focus styling and SEO must remain identical`);
      if (["/", "/avantages"].includes(path) && [390, 1280].includes(width)) {
        const perfKey = `${width}:${path === "/" ? "home" : "avantages"}`;
        // Measure before media emulation: it restarts existing entry animations.
        perf[perfKey] = await renderingProbe(page);
        if (!baselineMode) {
          await page.locator(rootSelector).evaluate((el) => el.classList.remove("public-atmosphere"));
          try { pairedPerf[perfKey] = { enabled: perf[perfKey], disabled: await renderingProbe(page) }; }
          finally { await page.locator(rootSelector).evaluate((el) => el.classList.add("public-atmosphere")); }
        }
      }
      if (!baselineMode) {
        const layer = await page.locator(rootSelector).evaluate((el) => {
          const before = getComputedStyle(el, "::before");
          const after = getComputedStyle(el, "::after");
          return { position: getComputedStyle(el).position, isolation: getComputedStyle(el).isolation,
            layers: [before, after].map((style) => ({ content: style.content, pointer: style.pointerEvents,
              position: style.position, z: style.zIndex, animation: style.animationName,
              duration: style.animationDuration, height: parseFloat(style.height), background: style.backgroundImage,
              filter: style.filter, willChange: style.willChange })) };
        });
        assert.equal(layer.position, "relative"); assert.equal(layer.isolation, "isolate");
        for (const style of layer.layers) {
          assert.equal(style.pointer, "none"); assert.equal(style.position, "absolute"); assert.equal(style.z, "-1");
          assert.equal(style.filter, "none"); assert.equal(style.willChange, "auto");
          assert.match(style.background, /radial-gradient/); assert.doesNotMatch(style.background, /url\(/);
        }
        assert.ok(layer.layers[0].height <= 1344.1, `${key}: bounded atmospheric texture`);
        assert.equal(layer.layers[0].animation, width < 1024 ? "none" : "public-atmosphere-drift");
        assert.equal(layer.layers[1].animation, "none");
        if (width >= 1024) assert.equal(layer.layers[0].duration, "36s");
        // Reduced motion disables only the atmospheric motion, without changing geometry.
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(await page.locator(rootSelector).evaluate((el) => getComputedStyle(el, "::before").animationName), "none");
        assert.equal(await page.locator(rootSelector).evaluate((el) => getComputedStyle(el, "::before").transform), "none");
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      if ([390, 1280].includes(width) && screenshotNames[path]) {
        if (!baselineMode) {
          // Media emulation restarts existing entry animations: capture their settled state,
          // not a partially transparent hero/product. Never wait for the infinite atmosphere.
          await page.evaluate(async () => {
            await Promise.all(document.getAnimations()
              .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => undefined)));
            await Promise.all([...document.images]
              .filter((img) => { const rect = img.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0; })
              .map((img) => img.decode().catch(() => undefined)));
          });
          await page.screenshot({ path: join(output, `${screenshotNames[path]}-${width}.png`), fullPage: false });
        }
      }
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      if (!baselineMode) {
        assert.ok(Math.abs(await page.locator("header").first().evaluate((el) => el.getBoundingClientRect().top)) <= 1, `${key}: header remains sticky after scroll`);
        const lastLink = page.locator("footer a").last();
        assert.ok(await page.locator("footer a").count() > 0);
        const hit = await lastLink.evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
        assert.equal(hit, true, `${key}: footer remains above decorative layers`);
      }
    }
    assert.deepEqual(errors, [], `${width}px: browser exceptions`);
    await context.close();
    console.log(`PASS ${baselineMode ? "baseline" : "atmosphere"} ${width}px: ${paths.length} routes`);
  }
  if (!baselineMode) await accountFixture();
} finally { await browser.close(); await server.close(); }

const report = { snapshots, perf, pairedPerf, protectedFiles, bundle: bundleSizes(),
  mainLayout: readFileSync("src/layouts/MainLayout.tsx", "utf8"), css: readFileSync("src/styles/index.css", "utf8") };
if (baseline) {
  assert.equal(report.mainLayout.replace('public-atmosphere min-h-screen', 'min-h-screen').replace(' data-public-atmosphere', '').replaceAll("\r\n", "\n"), baseline.mainLayout.replaceAll("\r\n", "\n"), "only decorative root class/marker may change in MainLayout");
  assert.ok(report.css.replaceAll("\r\n", "\n").startsWith(baseline.css.replaceAll("\r\n", "\n")), "previous validated CSS must be untouched");
}
await writeFile(baselineMode ? baselinePath : join(output, "results.json"), JSON.stringify(report, null, 2));
console.log(`PASS ${baselineMode ? "baseline saved" : "atmosphere QA"}: ${output}`);

async function layoutSnapshot(page: Page, selector: string) {
  return page.evaluate((rootQuery) => {
    const root = document.querySelector(rootQuery)!;
    const rect = (el: Element) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100); };
    const styles = (el: Element) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor, s.backgroundImage, s.fontSize, s.lineHeight, s.outlineStyle, s.outlineColor]; };
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rootHeight: root.getBoundingClientRect().height,
      geometry: [...document.querySelectorAll("main, h1, footer, [data-home-product-finder], [data-home-hero-v2], [data-product-gallery], [data-product-purchase], [data-advantages-entries], .product-grid, .product-card-v2")].map(rect),
      protectedStyles: [...document.querySelectorAll("h1, h2, main a, main button, .product-card-v2, [data-home-product-finder], .express-delivery-banner, .advantage-surface, footer")].map(styles),
      title: document.title, headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((el) => el.textContent),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      description: document.querySelector('meta[name="description"]')?.getAttribute("content"),
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content"),
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((el) => el.textContent),
      media: [...document.querySelectorAll("main img, main video, main canvas")].map((el) => [el.tagName, el.getAttribute("src"), el.getAttribute("srcset"), el.getAttribute("sizes"), el.getAttribute("width"), el.getAttribute("height"), el.getAttribute("fetchpriority")]) };
  }, selector);
}

async function renderingProbe(page: Page) {
  await page.waitForTimeout(500);
  const startCls = await page.evaluate(() => (window as unknown as { __atmosphereCls: number }).__atmosphereCls);
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable"); await session.send("LayerTree.enable");
  let paints = 0;
  session.on("LayerTree.layerPainted", () => { paints += 1; });
  const metrics = async () => Object.fromEntries((await session.send("Performance.getMetrics")).metrics.map((entry: { name: string; value: number }) => [entry.name, entry.value]));
  const start = await metrics();
  await page.waitForTimeout(2000);
  const idle = await metrics(); const idlePaints = paints; paints = 0;
  const frames = await page.evaluate(() => new Promise<number[]>((resolveFrames) => {
    const deltas: number[] = []; let previous = 0; let started = 0;
    const tick = (now: number) => {
      if (!started) started = now;
      if (previous) deltas.push(now - previous); previous = now;
      window.scrollTo({ top: Math.min(document.documentElement.scrollHeight - innerHeight, (now - started) * 0.65), behavior: "instant" });
      if (now - started < 1200) requestAnimationFrame(tick); else resolveFrames(deltas);
    };
    requestAnimationFrame(tick);
  }));
  const end = await metrics();
  const cls = await page.evaluate(() => (window as unknown as { __atmosphereCls: number }).__atmosphereCls);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await session.detach();
  frames.sort((a, b) => a - b);
  return { idleTaskMs: (idle.TaskDuration - start.TaskDuration) * 1000, idleLayoutMs: (idle.LayoutDuration - start.LayoutDuration) * 1000,
    idlePaints, scrollTaskMs: (end.TaskDuration - idle.TaskDuration) * 1000, scrollPaints: paints,
    frames: frames.length, frameP95Ms: frames[Math.floor(frames.length * 0.95)], cls, scrollCls: cls - startCls };
}

function walk(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]); }
function bundleSizes() {
  const assets = walk("dist/assets").filter((file) => /\.(css|js)$/.test(file));
  return Object.fromEntries(["css", "js"].map((extension) => {
    const files = assets.filter((file) => file.endsWith(`.${extension}`));
    return [extension, { raw: files.reduce((sum, file) => sum + statSync(file).size, 0), gzip: files.reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0) }];
  }));
}

async function accountFixture() {
  const fixture = await createServer({ configFile: false, appType: "custom", cacheDir: join(output, "account-vite-cache"),
    optimizeDeps: { entries: ["scripts/fixtures/publicAtmosphereAccountQa.tsx"] },
    plugins: [react(), { name: "local-auth-fixture", enforce: "pre",
      resolveId(source) { if (source.endsWith("/context/AuthContext")) return join(process.cwd(), "scripts/fixtures/publicAtmosphereAuthQa.ts"); } }],
    server: { host: "127.0.0.1", port: 0 } });
  fixture.middlewares.use(async (req, res, next) => {
    if (!req.headers.accept?.includes("text/html")) { next(); return; }
    try { res.setHeader("Content-Type", "text/html"); res.end(await fixture.transformIndexHtml(req.url || "/", '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/publicAtmosphereAccountQa.tsx"></script></body></html>')); }
    catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  await fixture.listen();
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
      await blockExternalServices(context);
      await context.addInitScript(() => {
        Object.assign(window, { __VERDANZA_PRODUCT_CATALOG_PRERENDER__: true });
        localStorage.setItem("verdanza-age-confirmed", "true");
        localStorage.setItem("verdanza-consent-v1", JSON.stringify({ version: 1, analytics: false, decidedAt: "2026-09-26T00:00:00Z" }));
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${fixture.resolvedUrls!.local[0]}compte`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByRole("heading", { name: "Mon compte", exact: true }).waitFor({ timeout: 120000 });
      assert.equal(await page.locator("[data-public-atmosphere]").count(), 1);
      assert.match(await page.locator('meta[name="robots"]').getAttribute("content") || "", /noindex/);
      assert.equal(await page.getByRole("link", { name: "Mon compte", exact: true }).count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await page.locator("[data-public-atmosphere]").evaluate((el) => getComputedStyle(el, "::before").animationName), "none");
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("PASS authenticated account styling fixture at 390/1280px: actual AuthGate/layout, noindex, no overflow, no real identity or Firebase writes.");
  } finally { await fixture.close(); }
}
