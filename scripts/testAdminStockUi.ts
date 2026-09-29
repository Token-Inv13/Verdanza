import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";
import type {} from "./fixtures/adminV3Fixture";
import type { StockAdjustment, StockHistoryEntry, StockOperationResult, StockSnapshot } from "../src/types/adminStock";

declare global {
  interface Window {
    stockApi: { product: StockSnapshot; movements: StockHistoryEntry[]; requests: StockAdjustment[];
      results: Record<string, StockOperationResult>; blocked: boolean; lost: "" | "applied" | "not_received";
      verifyFails: boolean; release: () => void; store: Map<string, string>; };
  }
}
const mocksPath = fileURLToPath(new URL("./fixtures/adminV3Mocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" },
  define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" },
  plugins: [{ name: "stock-fixture-mocks", enforce: "pre", resolveId(source) {
    if (/\/(productsService|productImagesService|useAdminData|AuthContext|firebase|firebaseAuth)(\.[jt]sx?)?$/.test(source)) return mocksPath;
  } }],
  build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/adminV3Fixture.tsx", import.meta.url)), name: "StockFixture", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } } },
});
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput;
const script = output.output.find((entry) => entry.type === "chunk"); assert.ok(script?.type === "chunk");
const css = output.output.filter((entry) => entry.type === "asset" && entry.fileName.endsWith(".css")).map((entry) => entry.type === "asset" ? String(entry.source) : "").join("\n");
const browser = await chromium.launch({ headless: true });
let checks = 0; const passed = (name: string) => { checks++; console.log(`PASS ${name}`); };
const errors: string[] = [];
try {
  // One fixed viewport, local in-memory fixture, no navigation or live services.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));
  await page.setContent('<html><head><base href="http://stock-fixture.test/"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: "window.__name = (value) => value;" });
  await page.evaluate(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
    let seq = 0; Object.defineProperty(crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}` });
    window.stockApi = { product: { productId: "admin-v3-fixture", name: "Produit témoin", category: "resins", internalReference: "VDZ-RES-ABCDEF", stock: 20, lowStockThreshold: 2, isActive: false }, movements: [], requests: [], results: {}, blocked: false, lost: "", verifyFails: false, release: () => {}, store };
    window.fetch = async (url, options) => {
      const api = window.stockApi;
      if (!String(url).startsWith("/api/invoices")) throw new Error("Unexpected fixture network request");
      if ((options?.headers as Record<string, string>)?.authorization !== "Bearer fixture-admin-token") throw new Error("Missing authentication");
      if (options?.method === "GET") {
        const query = new URL(String(url), "https://fixture.test").searchParams;
        if (query.get("action") === "adminStockStatus") {
          if (api.verifyFails) throw new Error("Verification unavailable");
          const result = api.results[query.get("operationId")!]; return Response.json(result ? { status: "applied", result } : { status: "not_executed" });
        }
        return Response.json({ product: api.product, movements: api.movements });
      }
      const operation: StockAdjustment = JSON.parse(String(options?.body)).operation; api.requests.push(operation);
      if (api.blocked) await new Promise<void>((resolve) => { api.release = resolve; });
      if (api.lost === "not_received") { api.lost = ""; throw new Error("Request lost"); }
      const previous = api.results[operation.operationId]; if (previous) return Response.json({ result: previous });
      if (api.product.stock !== operation.expectedStock) return Response.json({ code: "stock_conflict", error: "Le stock a changé.", current: api.product }, { status: 409 });
      const result: StockOperationResult = { status: "applied", operationId: operation.operationId, productId: operation.productId, productName: api.product.name, beforeStock: api.product.stock, afterStock: operation.targetStock, delta: operation.targetStock - api.product.stock, beforeLowStockThreshold: api.product.lowStockThreshold, afterLowStockThreshold: operation.lowStockThreshold, reason: operation.reason, note: operation.note, adminUid: "fixture-admin", appliedAt: "2000-01-01T00:00:00Z", replayed: false };
      api.results[operation.operationId] = result; api.product.stock = result.afterStock; api.product.lowStockThreshold = result.afterLowStockThreshold;
      api.movements.unshift({ id: operation.operationId, type: "admin_adjustment", quantity: result.delta, note: operation.note, createdAt: result.appliedAt, createdBy: result.adminUid, beforeStock: result.beforeStock, afterStock: result.afterStock });
      if (api.lost === "applied") { api.lost = ""; throw new Error("Response lost after commit"); }
      return Response.json({ result });
    };
    XMLHttpRequest.prototype.open = () => { throw new Error("Unexpected live XHR"); };
  });
  await page.addScriptTag({ content: script.code });
  const dialog = () => page.getByRole("dialog", { name: "Modifier le stock", exact: true });
  const confirm = () => page.getByRole("dialog", { name: "Confirmer la correction du stock", exact: true });
  async function render() { await page.evaluate(() => window.renderAdminV3("stocks")); }
  async function open() {
    await page.getByRole("button", { name: "Produit témoin", exact: true }).click();
    await page.waitForFunction(() => { const input = document.querySelector<HTMLInputElement>('input[type="number"]'); return Boolean(input && !input.disabled && !input.closest("fieldset")?.disabled); });
  }
  async function draft(value: string) { await dialog().getByLabel("Nouveau stock", { exact: true }).fill(value); await dialog().getByLabel("Motif", { exact: true }).selectOption("inventory_correction"); await dialog().getByRole("button", { name: "Vérifier la correction", exact: true }).click(); }
  async function success() { await confirm().waitFor({ state: "detached" }); await dialog().getByRole("status").filter({ hasText: "Correction appliquée" }).waitFor(); }
  await render(); await open(); assert.equal(await dialog().getByLabel("Nouveau stock", { exact: true }).inputValue(), "20");
  await draft("25"); assert.match(await confirm().innerText(), /Variation : \+5/); assert.equal(await page.evaluate(() => window.stockApi.requests.length), 0);
  await confirm().getByRole("button", { name: "Retour au formulaire", exact: true }).click(); assert.equal(await dialog().getByLabel("Nouveau stock", { exact: true }).inputValue(), "25");
  passed("ouverture, valeur serveur, aperçu et annulation sans mutation");
  await dialog().getByLabel("Motif", { exact: true }).selectOption("other"); assert.equal(await dialog().getByRole("button", { name: "Vérifier la correction", exact: true }).isDisabled(), true);
  await dialog().getByLabel("Note (obligatoire)", { exact: true }).fill("Recomptage"); await dialog().getByRole("button", { name: "Vérifier la correction", exact: true }).click();
  await page.evaluate(() => { window.stockApi.blocked = true; }); await confirm().getByRole("button", { name: "Confirmer la correction", exact: true }).click();
  await page.waitForFunction(() => window.stockApi.requests.length === 1);
  assert.equal(await confirm().getByRole("button", { name: "Retour au formulaire", exact: true }).isDisabled(), true); await page.keyboard.press("Escape"); assert.ok(await confirm().isVisible());
  await page.evaluate(() => { window.stockApi.blocked = false; window.stockApi.release(); }); await success();
  assert.equal(await dialog().getByLabel("Nouveau stock", { exact: true }).inputValue(), "25"); assert.match(await dialog().getByRole("region", { name: "Historique des mouvements" }).innerText(), /\+5/);
  await dialog().getByRole("button", { name: "Fermer", exact: true }).click(); assert.match(await page.locator("article").filter({ hasText: "Produit témoin" }).innerText(), /Stock 25/); passed("motif Autre, confirmation, verrouillage pending, historique et mise à jour liste");
  await open(); await draft("30"); await page.evaluate(() => { window.stockApi.product.stock = 23; });
  await confirm().getByRole("button", { name: "Confirmer la correction", exact: true }).click();
  await confirm().getByText(/Conflit : valeur attendue 25, stock serveur 23, valeur demandée 30/).waitFor();
  assert.equal(await confirm().getByRole("button", { name: "Confirmer la correction", exact: true }).isDisabled(), true);
  await confirm().getByRole("button", { name: "Retour au formulaire", exact: true }).click();
  await dialog().getByRole("button", { name: "Recharger les valeurs", exact: true }).click(); await confirm().waitFor({ state: "detached" });
  assert.equal(await dialog().getByLabel("Nouveau stock", { exact: true }).inputValue(), "30"); assert.equal(await page.evaluate(() => window.stockApi.requests.length), 2);
  await dialog().getByRole("button", { name: "Vérifier la correction", exact: true }).click(); assert.match(await confirm().innerText(), /Stock actuel : 23/);
  await confirm().getByRole("button", { name: "Confirmer la correction", exact: true }).click(); await success(); passed("conflit visible, rechargement, aucune relance automatique, nouvelle confirmation");
  await draft("35"); await page.evaluate(() => { window.stockApi.lost = "applied"; window.stockApi.verifyFails = true; });
  await confirm().getByRole("button", { name: "Confirmer la correction", exact: true }).click(); await confirm().waitFor({ state: "detached" });
  await dialog().getByText("Résultat encore incertain. L’identifiant est conservé.").waitFor();
  const pendingId = await page.evaluate(() => window.stockApi.requests.at(-1)!.operationId);
  assert.equal(await dialog().getByRole("button", { name: "Vérifier la correction", exact: true }).isDisabled(), true);
  await dialog().getByRole("button", { name: "Fermer", exact: true }).click(); await page.evaluate(() => window.renderAdminV3("dialog")); await render();
  await page.getByRole("button", { name: "Vérifier l’opération", exact: true }).waitFor();
  await page.evaluate(() => { window.stockApi.verifyFails = false; }); await page.getByRole("button", { name: "Vérifier l’opération", exact: true }).click();
  await dialog().getByRole("status").filter({ hasText: "Correction appliquée" }).waitFor();
  assert.equal(await page.evaluate(() => window.stockApi.requests.filter((operation) => operation.operationId === window.stockApi.requests.at(-1)!.operationId).length), 1);
  assert.equal(await page.evaluate(() => window.stockApi.store.size), 0); assert.equal(await page.evaluate(() => window.stockApi.requests.at(-1)!.operationId), pendingId);
  passed("réponse perdue après application, journal persistant, récupération après remontage sans seconde mutation");
  await draft("40"); await page.evaluate(() => { window.stockApi.lost = "not_received"; }); await confirm().getByRole("button", { name: "Confirmer la correction", exact: true }).click(); await confirm().waitFor({ state: "detached" });
  await dialog().getByRole("button", { name: "Reprendre la même opération", exact: true }).click(); await success();
  const last = await page.evaluate(() => window.stockApi.requests.slice(-2)); assert.deepEqual(last[0], last[1]); passed("requête non reçue : reprise explicite avec même ID et mêmes données");
  await dialog().getByRole("button", { name: "Fermer", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.adminV3.refreshes), 0); assert.deepEqual(errors, []); passed("fermeture après succès, aucune actualisation globale ni erreur runtime");
  console.log(`${checks} scénarios UI stock validés dans une fixture locale unique.`);
} finally { await browser.close(); }
