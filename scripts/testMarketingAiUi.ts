import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";
import { validateMarketingAiProposals } from "../api/_server/marketingAiContract.js";
import { aiContext, aiPayload } from "./fixtures/marketingAiData.js";
import type { MarketingContext, MarketingOperation, MarketingResult } from "../src/types/marketing.js";
import type { MarketingAiGeneration, MarketingAiRequest } from "../src/types/marketingAi.js";
const mocks = fileURLToPath(new URL("./fixtures/marketingMocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" }, define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" }, plugins: [{ name: "marketing-ai-local-fixture", enforce: "pre", resolveId(source) { if (/\/(AuthContext|firebaseAuth|firebase)(\.[jt]sx?)?$/.test(source)) return mocks; } }], build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/marketingFixture.tsx", import.meta.url)), name: "MarketingAiFixture", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } } } });
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput;
const script = output.output.find((item) => item.type === "chunk"); assert.ok(script?.type === "chunk");
const css = output.output.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => item.type === "asset" ? String(item.source) : "").join("\n");
const context: MarketingContext = { drafts: [], coupons: [], banners: [], contests: [], fingerprints: {}, products: [{
  ...aiContext.products[0], slug: "ai-fixture", category: "resins", isActive: true, isFeatured: false, lowStockThreshold: 5,
  shortDescription: "", longDescription: "", image: "", cbdRate: "", cbgRate: "", thcRate: "", origin: "", cultureType: "Autre", seoTitle: "", seoDescription: ""
}] };
const generations = new Map<string, MarketingAiGeneration>(), receipts = new Map<string, MarketingResult>();
const requests: MarketingAiRequest[] = [], operations: MarketingOperation[] = [];
let providerCalls = 0, activations = 0, loseResponse = true, configured = true, nextError = "";
const browser = await chromium.launch({ headless: true }); let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }); page.setDefaultTimeout(12000);
  const errors: string[] = [], unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname !== "marketing-fixture.test") { unexpected.push(url.href); return route.abort(); }
    if (url.pathname !== "/api/admin-contests") return route.fulfill({ status: 404, body: "" });
    const action = url.searchParams.get("action");
    if (action === "marketing-ai") {
      if (req.method() === "GET") { const id = url.searchParams.get("generationId"); return route.fulfill({ json: id ? generations.get(id) : { configured, state: configured ? "ready" : "disabled", maxProposals: 3 } }); }
      const body = req.postDataJSON() as MarketingAiRequest; requests.push(body);
      if (nextError) { const code = nextError; nextError = ""; return route.fulfill({ status: 429, json: { code, error: "Quota IA fixture atteint." } }); }
      let generation = generations.get(body.generationId);
      if (generation) return route.fulfill({ json: { ...generation, replayed: true } });
      providerCalls++; const raw = aiPayload(body.brief.kind === "free" ? "campaign" : body.brief.kind, body.brief.count);
      if (body.brief.period) for (const proposal of raw.proposals) {
        for (const config of [proposal.promotion, proposal.banner]) if (config) { config.startsAt = body.brief.period.startsAt; config.endsAt = body.brief.period.endsAt; }
      }
      generation = { id: body.generationId, proposals: validateMarketingAiProposals(raw, aiContext, body.brief), provider: "fixture", model: "actual-fixture-model", promptVersion: "verdanza-marketing-v1", createdAt: "2026-09-28T12:00:00.000Z", requestedBy: "fixture-admin", replayed: false };
      generations.set(body.generationId, generation);
      if (loseResponse) { loseResponse = false; return route.fulfill({ status: 503, json: { code: "ai_generation_pending", error: "Résultat incertain fixture." } }); }
      return route.fulfill({ json: generation });
    }
    if (action !== "marketing") { unexpected.push("Unexpected action " + action); return route.abort(); }
    if (req.method() === "GET") { const id = url.searchParams.get("draftId"); return route.fulfill({ json: id ? { draft: context.drafts.find((d) => d.id === id), audits: [] } : context }); }
    const op = req.postDataJSON().operation as MarketingOperation; operations.push(op);
    if (receipts.has(op.operationId)) return route.fulfill({ json: { ...receipts.get(op.operationId), replayed: true } });
    let draft = context.drafts.find((d) => d.id === op.draftId);
    if (op.action === "save") {
      const gen = op.aiSource ? generations.get(op.aiSource.generationId) : null;
      draft = { id: op.draftId, kind: op.kind || draft!.kind, title: op.title!, parameters: op.parameters!, references: draft?.references || {}, baseFingerprints: {}, revision: (draft?.revision || 0) + 1, origin: gen ? "ai" : draft?.origin || "manual", state: "draft", authorId: "fixture-admin", updatedBy: "fixture-admin", createdAt: "2026-09-28T12:00:00.000Z", updatedAt: "2026-09-28T12:00:00.000Z",
        ...(gen ? { ai: { generationId: gen.id, proposalId: op.aiSource!.proposalId, provider: gen.provider, model: gen.model, promptVersion: gen.promptVersion, generatedAt: gen.createdAt, requestedBy: "fixture-admin", allowedProductIds: ["ai-product"], referencedProductIds: ["ai-product"] } } : draft?.ai ? { ai: draft.ai } : {}) };
      context.drafts = [...context.drafts.filter((d) => d.id !== op.draftId), draft];
    }
    assert.ok(draft);
    if (op.action === "review") { draft.state = "reviewed"; draft.reviewedRevision = draft.revision; }
    if (op.action === "approve") { draft.state = "approved"; draft.approvedRevision = draft.revision; }
    if (op.action === "materialize") {
      draft.state = "materialized"; draft.materializedRevision = draft.revision; draft.references = { couponId: "ai-coupon", bannerId: "ai-banner" };
      context.coupons.push({ ...draft.parameters.promotion!, id: "ai-coupon", isActive: false, usedCount: 0 }); context.banners.push({ ...draft.parameters.banner!, id: "ai-banner", isActive: false });
    }
    if (op.action === "activate") { draft.state = "activated"; activations++; context.coupons[0].isActive = true; context.banners[0].isActive = true; }
    const result: MarketingResult = structuredClone({ operationId: op.operationId, replayed: false, draft }); receipts.set(op.operationId, result); return route.fulfill({ json: result });
  });
  await page.setContent('<html><head><base href="http://marketing-fixture.test/"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: "window.__name = (value) => value;" });
  await page.evaluate(() => {
    let sequence = 0; Object.defineProperty(crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
    const values = new Map<string, string>(); Object.defineProperty(window, "localStorage", { value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  });
  await page.addScriptTag({ content: script.code });
  const assistant = page.getByRole("region", { name: "Assistant IA", exact: true });
  await assistant.getByRole("button", { name: "Générer des propositions", exact: true }).waitFor(); await assistant.getByLabel(/^Objectif/).fill("Mettre en avant les résines");
  await assistant.getByText("Options avancées", { exact: true }).click();
  await assistant.getByLabel("Nombre de propositions", { exact: true }).selectOption("1"); await assistant.getByLabel("Type de proposition", { exact: true }).selectOption("campaign");
  await assistant.getByRole("button", { name: "Générer des propositions", exact: true }).evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
  await assistant.getByRole("button", { name: "Reprendre la génération conservée", exact: true }).waitFor(); assert.equal(providerCalls, 1); assert.equal(requests.length, 1); assert.equal(operations.length, 0); pass("brief / génération double clic : un seul appel, aucune opération métier");
  await page.getByRole("button", { name: "Nouveau chargement fixture", exact: true }).click(); await assistant.getByRole("button", { name: "Reprendre la génération conservée", exact: true }).click();
  await assistant.getByRole("article", { name: "Découverte résines 1", exact: true }).waitFor(); assert.equal(providerCalls, 1); assert.equal(requests[0].generationId, requests[1].generationId); pass("réponse perdue et rechargement : reprise exacte sans nouveau coût");
  const card = assistant.getByRole("article", { name: "Découverte résines 1", exact: true }); await card.getByRole("button", { name: "Prévisualiser", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Proposition IA — aperçu privé", exact: true }); await editor.getByText("Prévisualisation privée", { exact: true }).waitFor(); assert.equal(operations.length, 0); await editor.getByRole("button", { name: "Fermer la fenêtre", exact: true }).click(); pass("aperçu IA sans sauvegarde, activation, produit ou bannière publique");
  await card.getByRole("button", { name: "Ignorer", exact: true }).click(); await card.getByText("Proposition ignorée", { exact: false }).waitFor(); await card.getByRole("button", { name: "Restaurer la proposition", exact: true }).click(); assert.equal(operations.length, 0); pass("ignorer/restaurer conserve la proposition sans mutation métier");
  await card.getByRole("button", { name: "Modifier", exact: true }).click(); editor = page.getByRole("dialog", { name: "Campagne promotion + bannière — nouveau brouillon", exact: true });
  await editor.getByLabel("Nom du brouillon", { exact: true }).fill("Campagne IA revue"); await editor.getByLabel(/^Message court/).fill("Message corrigé humainement.");
  assert.equal(operations.length, 0); assert.equal(await editor.getByLabel("Actif", { exact: true }).count(), 0); pass("modifier utilise l’éditeur Phase 5 ; aucun champ ni commande d’activation");
  await editor.getByRole("button", { name: "Enregistrer le brouillon privé", exact: true }).first().click();
  let confirm = page.getByRole("dialog", { name: "Enregistrer le brouillon privé", exact: true }); await confirm.getByRole("button", { name: "Annuler", exact: true }).click(); assert.equal(operations.length, 0); pass("création du brouillon IA annulable avec confirmation distincte");
  await editor.getByRole("button", { name: "Enregistrer le brouillon privé", exact: true }).first().click(); confirm = page.getByRole("dialog", { name: "Enregistrer le brouillon privé", exact: true }); await confirm.getByRole("button", { name: "Confirmer cette étape", exact: true }).click();
  await page.getByRole("button", { name: "Marquer comme revu", exact: true }).waitFor(); assert.equal(context.drafts[0].origin, "ai"); assert.equal(context.drafts[0].state, "draft"); assert.equal(operations[0].aiSource?.generationId, requests[0].generationId); assert.equal(context.coupons.length, 0); assert.equal(context.banners.length, 0); pass("source IA transmise au backend et brouillon uniquement privé");
  async function stage(button: string, title: string) { await page.getByRole("button", { name: button, exact: true }).click(); await page.getByRole("dialog", { name: title, exact: true }).getByRole("button", { name: "Confirmer cette étape", exact: true }).click(); }
  await stage("Marquer comme revu", "Confirmer la revue"); await page.getByRole("button", { name: "Approuver cette révision", exact: true }).waitFor(); await stage("Approuver cette révision", "Approuver cette révision"); await page.getByRole("button", { name: "Préparer les objets métier", exact: true }).waitFor(); assert.equal(activations, 0); pass("revue et approbation IA utilisent deux confirmations Phase 5");
  await stage("Préparer les objets métier", "Préparer les objets métier"); await page.getByRole("button", { name: "Activer cette révision", exact: true }).waitFor(); assert.equal(context.coupons[0].isActive, false); assert.equal(context.banners[0].isActive, false); pass("matérialisation IA prépare la campagne inactive");
  await page.getByRole("button", { name: "Activer cette révision", exact: true }).click(); confirm = page.getByRole("dialog", { name: "Activer cette révision", exact: true }); await confirm.getByRole("button", { name: "Annuler", exact: true }).click(); assert.equal(activations, 0);
  await page.getByRole("button", { name: "Activer cette révision", exact: true }).click(); await page.getByRole("dialog", { name: "Activer cette révision", exact: true }).getByRole("button", { name: "Confirmer et activer", exact: true }).click(); await page.getByText("Activation confirmée", { exact: true }).waitFor(); assert.equal(activations, 1); pass("seule la confirmation humaine finale active la campagne");
  editor = page.getByRole("dialog", { name: "Campagne promotion + bannière — révision 1", exact: true }); await editor.getByRole("button", { name: "Fermer la fenêtre", exact: true }).click();
  assert.equal(await card.getByRole("button", { name: "Créer le brouillon", exact: true }).isEnabled(), false); pass("proposition déjà choisie : aucune seconde création de brouillon");
  await assistant.getByText("Options avancées", { exact: true }).click();
  await assistant.getByLabel(/^Objectif/).fill("Proposer d'autres idées"); await assistant.getByLabel("Nombre de propositions", { exact: true }).selectOption("3"); await assistant.getByLabel("Périmètre produits", { exact: true }).selectOption("category"); await assistant.getByLabel("Catégorie", { exact: true }).selectOption("resins");
  await assistant.getByLabel("Période", { exact: true }).selectOption("fixed"); await assistant.getByLabel("Début imposé (Europe/Paris)", { exact: true }).fill("2026-09-29T14:00"); await assistant.getByLabel("Fin imposée (Europe/Paris)", { exact: true }).fill("2026-10-04T14:00");
  await assistant.getByRole("button", { name: "Générer de nouvelles propositions", exact: true }).click(); await assistant.getByRole("article", { name: "Découverte résines 3", exact: true }).waitFor();
  assert.equal(await assistant.getByRole("article").count(), 4); assert.equal(context.drafts.length, 1); assert.equal(requests.at(-1)?.brief.period?.startsAt, "2026-09-29T12:00:00.000Z"); pass("régénération 3 propositions : anciennes idées et brouillon préservés, ciblage et dates Paris");
  await page.getByRole("button", { name: "Nouveau chargement fixture", exact: true }).click(); await assistant.getByRole("article", { name: "Découverte résines 3", exact: true }).waitFor(); assert.equal(await assistant.getByRole("article").count(), 4); assert.equal(providerCalls, 2); pass("historique relu après rechargement sans appel fournisseur");
  nextError = "ai_quota"; await assistant.getByLabel(/^Objectif/).fill("Nouvelle idée"); await assistant.getByRole("button", { name: "Générer de nouvelles propositions", exact: true }).click(); await assistant.getByRole("alert").filter({ hasText: "Quota IA" }).waitFor(); assert.equal(await assistant.getByRole("button", { name: "Reprendre la génération conservée", exact: true }).count(), 0); assert.equal(await assistant.getByRole("article").count(), 4); pass("quota explicite sans boucle de reprise ni perte des propositions");
  configured = false; await page.getByRole("button", { name: "Nouveau chargement fixture", exact: true }).click(); await assistant.getByText("Assistant IA désactivé", { exact: false }).waitFor(); assert.equal(await assistant.getByRole("button", { name: "Générer de nouvelles propositions", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Créer", exact: true }).click(); await page.getByRole("button", { name: "Préparer promotion", exact: true }).click(); await page.getByRole("dialog", { name: "Promotion — nouveau brouillon", exact: true }).waitFor(); pass("IA désactivée : formulaire masqué et workflow manuel disponible");
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); pass("aucune erreur navigateur, aucun service externe, fixture unique sans navigation réelle");
  console.log(`${checks} scénarios UI Assistant IA validés sur un seul viewport simulé.`);
} finally { await browser.close(); }
