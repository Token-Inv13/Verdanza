import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";

const mocks = fileURLToPath(new URL("./fixtures/adminNavMocks.tsx", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" },
  define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" },
  plugins: [{ name: "admin-nav-local-fixture", enforce: "pre", resolveId(source) {
    if (/\/(AuthContext|Seo|BrandLogo)(\.[jt]sx?)?$/.test(source)) return mocks;
  } }],
  build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/adminNavFixture.tsx", import.meta.url)), name: "AdminNavFixture", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } } },
});
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput;
const script = output.output.find((item) => item.type === "chunk"); assert.ok(script?.type === "chunk");
const css = output.output.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => item.type === "asset" ? String(item.source) : "").join("\n");
const browser = await chromium.launch({ headless: true });
const widths = [{ width: 1440, height: 1000 }, { width: 1280, height: 720 }, { width: 820, height: 900 }, { width: 390, height: 844 }];
const groups = ["Tableau de bord", "Catalogue", "Commandes", "Marketing", "Communauté", "Contenu", "Gestion", "Paramètres"];
let checks = 0;
try {
  for (const viewport of widths) {
    const page = await browser.newPage({ viewport }); page.setDefaultTimeout(10000);
    const errors: string[] = [], external: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "admin-nav-fixture.test") external.push(url.href);
      return route.abort();
    });
    await page.setContent('<html><head><base href="http://admin-nav-fixture.test/"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: "window.__name = (value) => value;" }); await page.addScriptTag({ content: script.code });
    if (viewport.width < 1024) await page.getByRole("button", { name: "Ouvrir le menu admin" }).click();
    const nav = page.getByRole("navigation", { name: "Navigation administration" });
    await nav.waitFor();
    if (process.env.ADMIN_V3_SHOTS_DIR && [1440, 390].includes(viewport.width))
      await page.screenshot({ path: path.join(process.env.ADMIN_V3_SHOTS_DIR, `sidebar-after-${viewport.width}.png`) });
    const headings = nav.locator("section > button");
    assert.equal(await headings.count(), 8);
    for (const title of groups) {
      const heading = nav.getByRole("button", { name: title, exact: true });
      assert.equal(await heading.getAttribute("aria-expanded"), title === "Marketing" ? "true" : "false");
    }
    assert.equal(await nav.getByRole("link", { name: "Vue d'ensemble" }).count(), 1);
    assert.equal(await nav.getByRole("link", { name: "Achats fournisseurs", includeHidden: true }).count(), 1);
    const scroll = await nav.evaluate((element) => ({ overflow: getComputedStyle(element).overflowY, width: getComputedStyle(element).scrollbarWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    assert.equal(scroll.overflow, "auto"); assert.equal(scroll.width, "none");
    await nav.getByRole("button", { name: "Gestion", exact: true }).focus(); await page.keyboard.press("Enter");
    assert.equal(await nav.getByRole("button", { name: "Gestion", exact: true }).getAttribute("aria-expanded"), "true");
    assert.equal(await nav.getByRole("link", { name: "Achats fournisseurs" }).count(), 1);
    assert.equal(await nav.getByRole("button", { name: "Paramètres", exact: true }).getAttribute("aria-expanded"), "false");
    for (const title of groups) {
      const heading = nav.getByRole("button", { name: title, exact: true });
      if (await heading.getAttribute("aria-expanded") === "false") await heading.click();
    }
    const full = await nav.evaluate((element) => ({ client: element.clientHeight, content: element.scrollHeight }));
    assert.ok(full.content > full.client, `La navigation complète doit défiler à ${viewport.width}px`);
    await nav.evaluate((element) => { element.scrollTop = 0; });
    await nav.hover(); await page.mouse.wheel(0, 360);
    await page.waitForFunction(() => document.querySelector('nav[aria-label="Navigation administration"]')!.scrollTop > 0);
    await nav.getByRole("link", { name: "Achats fournisseurs" }).click();
    await page.getByTestId("current-route").getByText("/admin/comptabilite?tab=achats").waitFor();
    if (viewport.width < 1024) {
      assert.equal(await page.getByRole("button", { name: "Ouvrir le menu admin" }).count(), 1);
      await page.getByRole("button", { name: "Ouvrir le menu admin" }).click();
    }
    assert.equal(await nav.getByRole("button", { name: "Gestion", exact: true }).getAttribute("aria-expanded"), "true");
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    checks++; console.log(`PASS navigation ${viewport.width}x${viewport.height}, ${groups.length} groupes, clavier, route, scroll (${scroll.scrollHeight}/${scroll.clientHeight})`);
    await page.close();
  }
  console.log(`${checks} formats de sidebar validés avec fixture locale.`);
} finally { await browser.close(); }
