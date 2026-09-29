import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";
import type {} from "./fixtures/adminReadStatesFixture";

const mocks = fileURLToPath(new URL("./fixtures/adminReadStatesMocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" },
  define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" },
  plugins: [{ name: "admin-read-states-mocks", enforce: "pre", resolveId(source) { if (/\/(contestsService|blogEngagementService)(\.[jt]sx?)?$/.test(source)) return mocks; } }],
  build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/adminReadStatesFixture.tsx", import.meta.url)), name: "AdminReadStatesFixture", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } } } });
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput;
const script = output.output.find((entry) => entry.type === "chunk"); assert.ok(script?.type === "chunk");
const css = output.output.filter((entry) => entry.type === "asset" && entry.fileName.endsWith(".css")).map((entry) => entry.type === "asset" ? String(entry.source) : "").join("\n");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(10000);
  const errors: string[] = []; const unexpected: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => { const url = new URL(route.request().url()); if (url.hostname !== "read-states-fixture.test" || !url.pathname.startsWith("/fonts/")) unexpected.push(url.href); await route.abort(); });
  await page.setContent('<!doctype html><html><head><base href="http://read-states-fixture.test/"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script.code });
  await page.getByText("Concours indisponibles (fixture)").waitFor();
  assert.equal(await page.getByText("Aucun concours").count(), 0);
  assert.ok(await page.getByText("— concours").isVisible());
  await page.evaluate(() => { window.adminReadStates.contestsFail = false; });
  await page.getByRole("button", { name: "Réessayer la lecture" }).click();
  await page.getByText("Aucun concours").waitFor();
  console.log("PASS Concours : erreur principale, compteur indisponible, vide réel après retry");
  await page.evaluate(() => window.renderAdminReadState("comments"));
  await page.getByText("Commentaires indisponibles (fixture)").waitFor();
  assert.equal(await page.getByText("Aucun commentaire").count(), 0);
  assert.ok(await page.getByText("— commentaire(s)").isVisible());
  await page.evaluate(() => { window.adminReadStates.commentsFail = false; });
  await page.getByRole("button", { name: "Réessayer la lecture" }).click();
  await page.getByText("Aucun commentaire").waitFor();
  console.log("PASS Commentaires : erreur principale, compteur indisponible, vide réel après retry");
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
} finally { await browser.close(); }
