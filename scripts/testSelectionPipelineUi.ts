import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";
import sharp from "sharp";
import { emptySelection, type ProductSelection } from "../src/types/selection.js";
import { emptyCommercial, emptyWorkflow, type PipelineOperation } from "../src/types/selectionPipeline.js";
import { preparePipelineProduct } from "../src/lib/selectionPipeline.js";
import type { Product } from "../src/types/index.js";
const mocks = fileURLToPath(new URL("./fixtures/selectionPipelineMocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" }, define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" }, plugins: [{ name: "selection-fixture-only", enforce: "pre", resolveId(source) { if (/\/(firebaseAuth|productsService)(\.[jt]sx?)?$/.test(source)) return mocks; } }], build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/selectionPipelineFixture.tsx", import.meta.url)), name: "SelectionFixture", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } } } });
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput; const script = output.output.find((e) => e.type === "chunk"); assert.ok(script?.type === "chunk");
const css = output.output.filter((e) => e.type === "asset" && e.fileName.endsWith(".css")).map((e) => e.type === "asset" ? String(e.source) : "").join("\n");
const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#557744" } }).png().toBuffer(); const jpeg = await sharp(png).jpeg().toBuffer();
const imported: ProductSelection = { ...emptySelection(), name: "Fleur fixture", publicName: "Fleur fixture", url: "https://originecbd.fr/fixture", supplier: "Source privée", category: "Fleur", origin: "France", taste: "Fruité", aromas: "Fruit", intensity: "moyenne", aromaFamily: "fruite", appearance: "Compact", prices: [{ format: "3 g", price: "5" }], economics: [{ id: "3g", label: "3 g", quantity: 3, unit: "g", cost: 5, costBasis: "", costSource: "web_unqualified", evidence: "https://originecbd.fr/fixture", capturedAt: "2026-09-28", finalPrice: 11 }], commercial: { ...emptyCommercial(), description: "Une description client suffisamment longue pour la fiche.", pricePerGram: 4, initialStock: 25, seoTitle: "Fleur fixture", seoDescription: "Profil fruité." } };
let selections: ProductSelection[] = []; let w = emptyWorkflow(); let product: Product | null = null; const operations: PipelineOperation[] = []; const receipts = new Map<string, unknown>(); let activations = 0; let loseActivationResponse = true;
const browser = await chromium.launch({ headless: true }); let checks = 0; const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }); page.setDefaultTimeout(12000); const errors: string[] = []; const unexpected: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname !== "selection-fixture.test") { unexpected.push(request.url()); return route.abort(); }
    if (url.pathname !== "/api/selection") return route.fulfill({ status: 404, body: "" });
    if (request.method() === "GET") {
      if (url.searchParams.get("action") === "adminImage") return route.fulfill({ status: 200, contentType: "image/jpeg", body: jpeg });
      if (url.searchParams.get("action") === "pipeline") return route.fulfill({ json: { workflow: w, product, policy: null, catalogue: { available: false, products: [], complete: false }, costs: [] } });
      return route.fulfill({ json: { selections } });
    }
    const body = request.postDataJSON() as { action: string; operation: PipelineOperation };
    if (body.action === "extract") return route.fulfill({ json: { selection: imported } });
    assert.equal(body.action, "pipeline"); const op = body.operation; operations.push(op);
    if (receipts.has(op.operationId)) return route.fulfill({ json: receipts.get(op.operationId) });
    let item = selections[0];
    if (op.action === "save") { item = { ...op.selection as ProductSelection, id: "fixture-selection", revision: 1, imagePath: "selection-images/fixture-selection/12345678-1234-1234-1234-123456789012.jpg", updatedAt: "2026-09-28T10:00:00Z" }; selections = [item]; w = emptyWorkflow(1); }
    if (op.action === "validateSelection") w.selectionValidatedRevision = 1;
    if (op.action === "prepareProduct") { w.draft = preparePipelineProduct(item); w.productPreparedRevision = 1; }
    if (op.action === "createCatalog") { product = { ...w.draft!, internalReference: "VDZ-FLR-ABCDEF", isActive: false }; item.catalogProductId = product.id; w.productId = product.id; w.catalogReadyRevision = 1; }
    if (op.action === "validatePublication") w.publishReadyRevision = 1;
    if (op.action === "activate") { product!.isActive = true; activations++; w.publishedRevision = 1; item.status = "En boutique"; }
    const result = JSON.parse(JSON.stringify({ selection: item, workflow: w, productId: item.catalogProductId, replayed: false })); receipts.set(op.operationId, result);
    if (op.action === "activate" && loseActivationResponse) { loseActivationResponse = false; return route.fulfill({ status: 503, json: { error: "Réponse perdue après traitement (fixture)" } }); }
    return route.fulfill({ json: result });
  });
  await page.setContent('<html><head><base href="http://selection-fixture.test/"></head><body><div id="root"></div></body></html>'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: "window.__name = (value) => value;" }); await page.evaluate(() => { let sequence = 0; Object.defineProperty(crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` }); }); await page.addScriptTag({ content: script.code });
  await page.getByRole("button", { name: "Ajouter depuis un fournisseur" }).click(); await page.getByLabel("Lien de fiche fournisseur").fill(imported.url); await page.getByRole("button", { name: "Importer le lien", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Nouvelle sélection privée" }); await editor.waitFor(); assert.equal(operations.length, 0); pass("URL → éditeur AdminDialog, zéro mutation");
  await editor.getByLabel("Ajouter une image produit").setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: png }); await editor.getByAltText("Aperçu du produit").waitFor(); assert.equal(operations.length, 0); pass("image optimisée prévisualisée localement, aucun upload");
  assert.ok(await editor.getByText("prix web non qualifié ; confirmez une source de coût.", { exact: false }).isVisible()); assert.ok(await editor.getByText("Comparaison catalogue indisponible").isVisible()); pass("prix web et catalogue indisponible explicitement signalés");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click(); let confirm = page.getByRole("dialog", { name: "Créer la sélection privée", exact: true }); await confirm.getByRole("button", { name: "Annuler", exact: true }).click(); assert.equal(operations.length, 0); pass("annulation de création sans écriture");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click(); confirm = page.getByRole("dialog", { name: "Créer la sélection privée", exact: true }); await confirm.getByRole("button", { name: "Confirmer et continuer" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await page.getByRole("button", { name: "Valider la sélection", exact: true }).waitFor(); assert.equal(operations.filter((o) => o.action === "save").length, 1); assert.ok(operations[0].imageBase64); pass("confirmation unique crée la sélection et transmet l’image");
  await page.getByRole("button", { name: "Valider la sélection", exact: true }).click(); confirm = page.getByRole("dialog", { name: "Valider la sélection", exact: true }); await confirm.getByText("Provenance : France", { exact: false }).waitFor(); await confirm.getByRole("button", { name: "Annuler", exact: true }).click(); assert.equal(w.selectionValidatedRevision, null); pass("récapitulatif sélection, annulation conserve le brouillon");
  async function confirmStage(label: string) { await page.getByRole("button", { name: label, exact: true }).click(); await page.getByRole("dialog", { name: label, exact: true }).getByRole("button", { name: "Confirmer cette étape" }).click(); }
  await confirmStage("Valider la sélection"); await page.getByRole("button", { name: "Préparer le brouillon produit", exact: true }).waitFor(); pass("validation de la révision sélection");
  await confirmStage("Préparer le brouillon produit"); await page.getByRole("button", { name: "Préparer le catalogue", exact: true }).waitFor(); assert.equal(product, null); pass("brouillon produit privé, aucun catalogue créé");
  await confirmStage("Préparer le catalogue"); await page.getByRole("button", { name: "Valider le récapitulatif", exact: true }).waitFor(); assert.equal((product as Product | null)?.isActive, false); pass("création catalogue inactive");
  await confirmStage("Valider le récapitulatif"); await page.getByRole("button", { name: "Publier dans la boutique", exact: true }).waitFor(); assert.equal(activations, 0); pass("validation finale sans activation");
  await page.getByRole("button", { name: "Publier dans la boutique", exact: true }).click(); confirm = page.getByRole("dialog", { name: "Publier dans la boutique", exact: true }); await confirm.getByRole("button", { name: "Confirmer et publier", exact: true }).click(); await confirm.getByRole("alert").waitFor(); assert.equal(activations, 1); pass("réponse perdue après activation, confirmation reste ouverte");
  await confirm.getByRole("button", { name: "Confirmer et publier", exact: true }).click(); await page.getByText("Publication validée", { exact: false }).waitFor(); const activationsOps = operations.filter((o) => o.action === "activate"); assert.equal(activationsOps.length, 2); assert.equal(activationsOps[0].operationId, activationsOps[1].operationId); assert.equal(activations, 1); assert.equal(selections[0].publishedSlug, ""); pass("rejeu du même UUID, un seul effet, fiche/PDF toujours séparée");
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); pass("aucune erreur navigateur ni requête externe, viewport unique");
  console.log(`${checks} scénarios UI Pipeline sur fixture locale, sans serveur ni navigation réelle.`);
} finally { await browser.close(); }
