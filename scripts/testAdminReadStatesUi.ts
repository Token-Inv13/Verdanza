import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";
import type {} from "./fixtures/adminReadStatesFixture";

const mocks = fileURLToPath(new URL("./fixtures/adminReadStatesMocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" },
  define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" },
  plugins: [{ name: "admin-read-states-mocks", enforce: "pre", resolveId(source) { if (/\/(contestsService|firebaseAuth)(\.[jt]sx?)?$/.test(source)) return mocks; } }],
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
  const commentRequests: string[] = [];
  let commentsFail = true;
  let commentsHaveRow = false;
  await page.route("**/api/blog-interactions?*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    commentRequests.push(url.pathname + url.search);
    assert.equal(request.method(), "GET");
    assert.equal(request.headers().authorization, "Bearer fixture-admin-token");
    const comments = commentsHaveRow ? [{ id: "comment-fixture", slug: "incertitude-mesure-arrondis-analyse-cbd", status: "pending",
      displayName: "Camille", userId: "reader-fixture", text: "Commentaire fixture local", createdAt: "2026-09-30T12:00:00.000Z" }] : [];
    await route.fulfill({ status: commentsFail ? 503 : 200, contentType: "application/json",
      body: JSON.stringify(commentsFail ? { error: "Commentaires indisponibles (fixture)" } : { comments, total: comments.length, page: 1, pageSize: 50 }) });
  });
  await page.setContent('<!doctype html><html><head><base href="http://read-states-fixture.test/"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script.code });
  await page.getByText("Concours indisponibles (fixture)").waitFor();
  assert.equal(await page.getByText("Aucun concours").count(), 0);
  assert.ok(await page.getByText("— concours").isVisible());
  await page.evaluate(() => { window.adminReadStates.contestsFail = false; });
  await page.getByRole("button", { name: "Réessayer la lecture" }).click();
  await page.getByText("Aucun concours").waitFor();
  console.log("PASS Concours : erreur principale, compteur indisponible, vide réel après retry");
  await page.evaluate(() => { window.adminReadStates.contestAvailable = true; });
  await page.getByRole("button", { name: "Rafraîchir" }).click();
  await page.getByRole("button", { name: "Ouvrir", exact: true }).click();
  await page.getByRole("heading", { name: "Concours fixture" }).waitFor();
  await page.getByRole("button", { name: "Annulé", exact: true }).click();
  await page.getByRole("dialog", { name: "Passer le concours à Annulé" }).getByRole("button", { name: "Confirmer cette action" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Détail concours indisponible après mutation (fixture)"));
  await page.evaluate(() => { window.adminReadStates.releaseList?.(); });
  await page.getByRole("button", { name: "Réessayer la lecture" }).waitFor();
  assert.ok(await page.getByText("Détail concours indisponible après mutation (fixture)").isVisible());
  assert.equal(await page.getByRole("heading", { name: "Concours fixture" }).count(), 0);
  await page.evaluate(() => { window.adminReadStates.detailFailAfterMutation = false; });
  await page.getByRole("button", { name: "Réessayer la lecture" }).click();
  await page.getByRole("heading", { name: "Concours fixture" }).waitFor();
  console.log("PASS Concours : échec détail après mutation conservé malgré liste rafraîchie, retry rétablit le détail");
  await page.evaluate(() => window.renderAdminReadState("comments"));
  await page.getByText("Commentaires indisponibles (fixture)").waitFor();
  assert.equal(await page.getByText("Aucun commentaire").count(), 0);
  assert.ok(await page.getByText("— commentaire(s)").isVisible());
  assert.ok(commentRequests.includes("/api/blog-interactions?action=adminComments&status=pending&page=1&pageSize=50"));
  commentsFail = false;
  await page.getByRole("button", { name: "Réessayer la lecture" }).click();
  await page.getByText("Aucun commentaire").waitFor();
  assert.ok(commentRequests.length >= 2);
  console.log("PASS Commentaires : URL réelle Admin, auth, erreur visible et vide réel après retry");
  commentsHaveRow = true;
  await page.getByRole("button", { name: "Actualiser" }).click();
  await page.getByRole("row").filter({ hasText: "Commentaire fixture local" }).waitFor();
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 900 }, { width: 1280, height: 720 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(geometry.document <= geometry.viewport && geometry.body <= geometry.viewport,
      `Commentaires global overflow at ${viewport.width}px: ${JSON.stringify(geometry)}`);
    if (viewport.width === 390) {
      const scroll = await page.getByRole("table").evaluate((table) => {
        const wrapper = table.parentElement as HTMLElement;
        wrapper.scrollLeft = wrapper.scrollWidth;
        return { scrollable: wrapper.scrollWidth > wrapper.clientWidth,
          lastColumnRight: table.querySelector("thead th:last-child")!.getBoundingClientRect().right,
          wrapperRight: wrapper.getBoundingClientRect().right };
      });
      assert.ok(scroll.scrollable && scroll.lastColumnRight <= scroll.wrapperRight + 1, "Commentaires final column remains accessible inside the table scroll");
    }
  }
  console.log("PASS Commentaires : ligne réelle fixture, 390/820/1280/1440 sans overflow global, table scrollable");
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
} finally { await browser.close(); }
