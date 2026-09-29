import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";
import type {} from "./fixtures/adminSettingsFixture";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(app, /path="parametres"\s+element=\{<AdminSettingsPage\s*\/>\}/);
const mocks = fileURLToPath(new URL("./fixtures/adminSettingsMocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" },
  define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" },
  plugins: [{ name: "settings-local-mocks", enforce: "pre", resolveId(source) { if (/\/(deliveryZonesService|invoicesService|marketingAiService)(\.[jt]sx?)?$/.test(source)) return mocks; } }],
  build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/adminSettingsFixture.tsx", import.meta.url)), name: "SettingsFixture", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } } } });
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput;
const script = output.output.find((entry) => entry.type === "chunk"); assert.ok(script?.type === "chunk");
const css = output.output.filter((entry) => entry.type === "asset" && entry.fileName.endsWith(".css")).map((entry) => entry.type === "asset" ? String(entry.source) : "").join("\n");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors: string[] = []; const unexpected: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== "settings-fixture.test" || !url.pathname.startsWith("/fonts/")) unexpected.push(route.request().url());
  await route.abort();
});
try {
  await page.setContent('<!doctype html><html><head><base href="http://settings-fixture.test/"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script.code });
  await page.getByRole("heading", { name: "Paramètres" }).waitFor();
  await page.getByText("Informations de facturation validées.").waitFor();
  assert.ok(await page.getByText("1 zone(s) enregistrée(s) en base.").isVisible());
  assert.ok(await page.getByText("Désactivée", { exact: true }).isVisible());
  assert.equal(await page.getByText(/à venir|placeholder/i).count(), 0);
  const links = await page.locator("a[href^='/admin/']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  for (const href of ["/admin/comptabilite?tab=facturation", "/admin/livraisons", "/admin/produits", "/admin/stocks", "/admin/selection", "/admin/marketing"]) assert.ok(links.includes(href), href);
  assert.equal(await page.getByText(/OPENAI_API_KEY|sk-[a-z0-9]{10}|fixture-secret/i).count(), 0);
  if (process.env.ADMIN_V3_SHOTS_DIR) await page.screenshot({ path: path.join(process.env.ADMIN_V3_SHOTS_DIR, "settings-ai-off-1440.png") });
  console.log("PASS F1 : vraie route Paramètres, états backend et liens, IA OFF, aucun secret ni placeholder");
  await page.evaluate(() => { window.adminSettingsFixture.billingSource = "local"; window.adminSettingsFixture.deliveryEmpty = true; window.adminSettingsFixture.aiState = "missing_configuration"; });
  await page.getByRole("button", { name: "Recharger les états" }).click();
  await page.getByText("Aucun réglage de facturation enregistré : modèle local non validé.").waitFor();
  await page.getByText("Aucune zone enregistrée en base.").waitFor();
  await page.getByText("Configuration incomplète", { exact: true }).waitFor();
  console.log("PASS F1/F2 : local dégradé, vide confirmé et IA incomplète distingués");
  await page.evaluate(() => { window.adminSettingsFixture.failure = "billing"; });
  await page.getByRole("button", { name: "Recharger les états" }).click();
  await page.getByText("Données indisponibles. Réessayez.").waitFor();
  if (process.env.ADMIN_V3_SHOTS_DIR) await page.screenshot({ path: path.join(process.env.ADMIN_V3_SHOTS_DIR, "settings-read-error-1440.png") });
  assert.equal(await page.getByText("Aucun réglage de facturation enregistré : modèle local non validé.").count(), 0);
  await page.evaluate(() => { window.adminSettingsFixture.failure = ""; window.adminSettingsFixture.billingSource = "firestore"; window.adminSettingsFixture.aiState = "disabled"; });
  await page.getByRole("button", { name: "Recharger les états" }).click();
  await page.getByText("Informations de facturation validées.").waitFor();
  console.log("PASS F2 : erreur de lecture jamais présentée comme valeur locale, retry réussi");
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 720 }, { width: 820, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= viewport.width, `Paramètres déborde à ${viewport.width}px (${width}px)`);
    if (process.env.ADMIN_V3_SHOTS_DIR && [1440, 390].includes(viewport.width))
      await page.screenshot({ path: path.join(process.env.ADMIN_V3_SHOTS_DIR, `settings-after-${viewport.width}.png`) });
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log("PASS Paramètres : quatre viewports, aucune exception ni requête distante");
} finally { await browser.close(); }
