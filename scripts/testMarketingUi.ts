import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";
import type { MarketingContext, MarketingOperation, MarketingResult } from "../src/types/marketing.js";
import type { Contest } from "../src/types/contests.js";
const mocks = fileURLToPath(new URL("./fixtures/marketingMocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" }, define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" }, plugins: [{ name: "marketing-local-fixture", enforce: "pre", resolveId(source) { if (/\/(AuthContext|firebaseAuth|firebase)(\.[jt]sx?)?$/.test(source)) return mocks; } }], build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/marketingFixture.tsx", import.meta.url)), name: "MarketingFixture", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } } } });
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput; const script = output.output.find((item) => item.type === "chunk"); assert.ok(script?.type === "chunk");
const css = output.output.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => item.type === "asset" ? String(item.source) : "").join("\n");
const nativeContest: Contest = { id: "native-fixture", sequenceNumber: 1, title: "Concours natif fixture", slug: "fixture", description: "Description", prizeValue: 30, prizeType: "store_credit", startAt: "2026-09-01T12:00:00Z", endAt: "2026-09-02T12:00:00Z", drawAt: "2026-09-03T12:00:00Z", rulesText: "Règlement fixture", eligibilityConditions: "Majeur", prizeExpirationDays: 30, status: "closed", entryCount: 1, createdBy: "fixture-admin", updatedBy: "fixture-admin" };
const context: MarketingContext = { drafts: [], coupons: [{ id: "existing-coupon", code: "OLD_FIXTURE", label: "Promotion existante", discountType: "percent", discountValue: 10, minimumOrder: 0, usedCount: 7, isActive: false }], banners: [{ id: "linked-banner", title: "Bannière liée fixture", message: "Message", type: "shop_card", placement: "shop", placements: ["shop"], priority: 10, variant: "default", dismissible: false, isActive: false, linkedCouponId: "existing-coupon" }], contests: [nativeContest], products: [], fingerprints: { "couponId:existing-coupon": "fixture-fingerprint", "bannerId:linked-banner": "fixture-fingerprint", "contestId:native-fixture": "fixture-fingerprint" } };
const operations: MarketingOperation[] = []; const receipts = new Map<string, MarketingResult>(); let activations = 0; let loseResponse = true; let drawCalls = 0;
const browser = await chromium.launch({ headless: true }); let checks = 0; const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }); page.setDefaultTimeout(12000); const errors: string[] = []; const unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname !== "marketing-fixture.test") { unexpected.push(url.href); return route.abort(); }
    if (url.pathname !== "/api/admin-contests") return route.fulfill({ status: 404, body: "" });
    if (request.method() === "GET") {
      if (url.searchParams.get("action") === "marketing") {
        const id = url.searchParams.get("draftId"); return route.fulfill({ json: id ? { draft: context.drafts.find((draft) => draft.id === id), audits: [] } : context });
      }
      if (url.searchParams.get("action") === "detail") return route.fulfill({ json: { contest: nativeContest, entries: [{ id: "entry", publicId: "PUBLIC-1", displayName: "Camille", email: "fixture@example.test", status: "eligible", enteredAt: "2026-09-01T14:00:00Z" }], entryTotal: 1, page: 1, pageSize: 50, draws: [], prizes: [], audits: [] } });
      return route.fulfill({ json: { contests: [nativeContest] } });
    }
    if (url.searchParams.get("action") !== "marketing") {
      const body = request.postDataJSON(); if (body.action === "draw") { drawCalls++; return route.fulfill({ json: { winnerPublicId: "PUBLIC-1" } }); }
      unexpected.push(`Unexpected contest action: ${body.action}`); return route.abort();
    }
    const op = request.postDataJSON().operation as MarketingOperation; operations.push(op);
    if (receipts.has(op.operationId)) return route.fulfill({ json: { ...receipts.get(op.operationId), replayed: true } });
    let draft = context.drafts.find((item) => item.id === op.draftId);
    const timestamp = "2026-09-28T12:00:00.000Z";
    if (op.action === "save") {
      draft = { id: op.draftId, kind: op.kind!, title: op.title!, parameters: op.parameters!, references: op.references || {}, baseFingerprints: op.baseFingerprints || {}, revision: (draft?.revision || 0) + 1, origin: "manual", state: "draft", authorId: "fixture-admin", updatedBy: "fixture-admin", createdAt: timestamp, updatedAt: timestamp };
      context.drafts = [...context.drafts.filter((item) => item.id !== draft!.id), draft];
    }
    assert.ok(draft);
    if (op.action === "review") { draft.state = "reviewed"; draft.reviewedRevision = draft.revision; }
    if (op.action === "approve") { draft.state = "approved"; draft.approvedRevision = draft.revision; }
    if (op.action === "materialize") {
      draft.state = "materialized"; draft.materializedRevision = draft.revision;
      if (draft.parameters.promotion) { draft.references.couponId = "new-campaign-coupon"; context.coupons.push({ ...draft.parameters.promotion, id: "new-campaign-coupon", isActive: false, usedCount: 0 }); }
      if (draft.parameters.banner) { draft.references.bannerId = "new-campaign-banner"; context.banners.push({ ...draft.parameters.banner, id: "new-campaign-banner", isActive: false, linkedCouponId: draft.references.couponId }); }
    }
    if (op.action === "activate") { draft.state = "activated"; draft.activatedRevision = draft.revision; activations++; for (const coupon of context.coupons) if (coupon.id === draft.references.couponId) coupon.isActive = true; for (const banner of context.banners) if (banner.id === draft.references.bannerId) banner.isActive = true; }
    const result: MarketingResult = JSON.parse(JSON.stringify({ draft, operationId: op.operationId, replayed: false })); receipts.set(op.operationId, result);
    if (op.action === "activate" && loseResponse) { loseResponse = false; return route.fulfill({ status: 503, json: { error: "Réponse perdue après application fixture", code: "operation_uncertain" } }); }
    return route.fulfill({ json: result });
  });
  await page.setContent('<html><head><base href="http://marketing-fixture.test/"></head><body><div id="root"></div></body></html>'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: "window.__name = (value) => value;" });
  await page.evaluate(() => { let sequence = 0; Object.defineProperty(crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` }); const values = new Map<string, string>(); Object.defineProperty(window, "localStorage", { value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } }); });
  await page.addScriptTag({ content: script.code });
  await page.getByRole("heading", { name: "Campagnes", exact: true }).waitFor();
  await page.getByText("0 brouillons", { exact: true }).waitFor();
  await page.getByText("Aucun brouillon dans cette vue.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Changer de vue fixture", exact: true }).click();
  await page.getByText("Aucun brouillon dans cette vue.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Changer de vue fixture", exact: true }).click();
  await page.getByRole("button", { name: "Changer de vue fixture", exact: true }).click();
  await page.getByRole("heading", { name: "Campagnes", exact: true }).waitFor();
  assert.equal(operations.length, 0); pass("vue cohérente Marketing, compteurs précis et vues sans brouillon explicites");
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 720 }, { width: 820, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(layout.pageWidth <= layout.viewport, `Marketing déborde à ${viewport.width}px (${layout.pageWidth}px)`);
    await page.getByRole("button", { name: "Créer", exact: true }).waitFor();
    await page.getByRole("region", { name: "Assistant IA", exact: true }).waitFor();
    if (process.env.ADMIN_V3_SHOTS_DIR && [1440, 390].includes(viewport.width))
      await page.screenshot({ path: path.join(process.env.ADMIN_V3_SHOTS_DIR, `marketing-after-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 1100, height: 850 }); pass("Marketing : 1440, 1280, 820 et 390 sans débordement horizontal");
  await page.getByRole("button", { name: "Créer", exact: true }).click(); await page.getByRole("button", { name: "Préparer promotion", exact: true }).click(); let editor = page.getByRole("dialog", { name: "Promotion — nouveau brouillon", exact: true }); await editor.waitFor(); assert.equal(await editor.getByLabel("Actif", { exact: true }).count(), 0); assert.equal(operations.length, 0); pass("nouvelle promotion en AdminDialog, activation absente du formulaire");
  await editor.getByLabel("Nom du brouillon", { exact: true }).fill("Promotion privée"); await editor.getByLabel("Code promo", { exact: true }).fill("NEW_FIXTURE"); await editor.getByLabel("Nom / libellé", { exact: true }).fill("Libellé privé"); assert.equal(operations.length, 0); pass("édition et aperçu sans mutation");
  await editor.getByRole("button", { name: "Enregistrer le brouillon privé", exact: true }).click(); let confirm = page.getByRole("dialog", { name: "Enregistrer le brouillon privé", exact: true }); await confirm.getByRole("button", { name: "Annuler", exact: true }).click(); assert.equal(operations.length, 0); await editor.getByRole("button", { name: "Fermer la fenêtre", exact: true }).click(); await page.getByRole("dialog", { name: "Abandonner les modifications privées ?", exact: true }).getByRole("button", { name: "Abandonner la saisie", exact: true }).click(); pass("annulation et abandon explicite de la saisie sans effet");
  await page.getByRole("button", { name: "Créer", exact: true }).click(); await page.getByRole("button", { name: "Préparer campagne promotion + bannière", exact: true }).click(); editor = page.getByRole("dialog", { name: "Campagne promotion + bannière — nouveau brouillon", exact: true }); await editor.getByLabel("Nom du brouillon", { exact: true }).fill("Campagne fixture"); await editor.getByLabel("Code promo", { exact: true }).fill("CAMPAIGN_FIXTURE"); await editor.getByLabel("Nom / libellé", { exact: true }).fill("Promotion campagne"); await editor.getByLabel("Titre", { exact: true }).fill("Bannière campagne"); await editor.getByLabel("Message court", { exact: true }).fill("Message préparé pour la campagne."); await editor.getByRole("button", { name: "Boutique", exact: true }).click(); await editor.getByLabel("Bouton optionnel", { exact: true }).fill("Voir"); await editor.getByLabel("Lien optionnel", { exact: true }).fill("/boutique"); assert.equal(operations.length, 0); pass("campagne complète et prévisualisation globale sans publication");
  await editor.getByRole("button", { name: "Enregistrer le brouillon privé", exact: true }).first().click(); confirm = page.getByRole("dialog", { name: "Enregistrer le brouillon privé", exact: true }); await confirm.getByRole("button", { name: "Confirmer cette étape", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); }); await page.getByRole("button", { name: "Marquer comme revu", exact: true }).waitFor(); assert.equal(operations.filter((op) => op.action === "save").length, 1); assert.equal(context.coupons.length, 1); pass("double clic bloqué, sauvegarde privée de la campagne");
  assert.equal("usedCount" in operations[0].parameters!.promotion!, false); assert.equal("isActive" in operations[0].parameters!.promotion!, false); pass("configuration envoyée sans compteur ni activation");
  async function stage(button: string, title: string) { await page.getByRole("button", { name: button, exact: true }).click(); await page.getByRole("dialog", { name: title, exact: true }).getByRole("button", { name: "Confirmer cette étape", exact: true }).click(); }
  await stage("Marquer comme revu", "Confirmer la revue"); await page.getByRole("button", { name: "Approuver cette révision", exact: true }).waitFor(); pass("revue distincte de l'approbation");
  await stage("Approuver cette révision", "Approuver cette révision"); await page.getByRole("button", { name: "Préparer les objets métier", exact: true }).waitFor(); assert.equal(activations, 0); pass("approbation de la révision sans activation");
  await stage("Préparer les objets métier", "Préparer les objets métier"); await page.getByRole("button", { name: "Activer cette révision", exact: true }).waitFor(); assert.equal(context.coupons[1].isActive, false); assert.equal(context.banners[1].isActive, false); pass("matérialisation des deux objets inactifs");
  await page.getByRole("button", { name: "Activer cette révision", exact: true }).click(); confirm = page.getByRole("dialog", { name: "Activer cette révision", exact: true }); await confirm.getByText("Cumul / priorité", { exact: true }).waitFor(); await confirm.getByText("Période", { exact: true }).first().waitFor(); await confirm.getByRole("button", { name: "Annuler", exact: true }).click(); assert.equal(activations, 0); pass("récapitulatif d'activation et annulation préservent l'inactivité");
  await page.getByRole("button", { name: "Activer cette révision", exact: true }).click(); confirm = page.getByRole("dialog", { name: "Activer cette révision", exact: true }); await confirm.getByRole("button", { name: "Confirmer et activer", exact: true }).click(); await confirm.getByRole("alert").waitFor(); assert.equal(activations, 1); assert.ok(await page.getByRole("button", { name: "Rejouer l'opération conservée", exact: true, includeHidden: true }).count()); pass("réponse perdue : confirmation reste ouverte et journal conservé");
  await confirm.getByRole("button", { name: "Annuler", exact: true }).click(); await page.getByRole("dialog", { name: "Campagne promotion + bannière — révision 1", exact: true }).getByRole("button", { name: "Fermer la fenêtre", exact: true }).click(); await page.getByRole("button", { name: "Nouveau chargement fixture", exact: true }).click(); await page.getByRole("button", { name: "Rejouer l'opération conservée", exact: true }).waitFor(); assert.equal(await page.getByRole("button", { name: "Créer", exact: true }).isEnabled(), false); pass("nouveau chargement retrouve le journal et bloque les nouvelles actions"); await page.getByRole("button", { name: "Rejouer l'opération conservée", exact: true }).click(); await page.getByText("résultat déjà appliqué retrouvé", { exact: false }).waitFor(); const activationOps = operations.filter((op) => op.action === "activate"); assert.equal(activationOps.length, 2); assert.equal(activationOps[0].operationId, activationOps[1].operationId); assert.equal(activations, 1); pass("reprise après fermeture du dialogue, même UUID et un seul effet");
  editor = page.getByRole("dialog", { name: "Campagne promotion + bannière — révision 1", exact: true }); await editor.getByRole("button", { name: "Modifier le brouillon", exact: true }).click(); await editor.getByLabel("Nom / libellé", { exact: true }).fill("Promotion campagne éditée"); assert.equal(await editor.getByRole("button", { name: "Activer cette révision", exact: true }).count(), 0); await editor.getByRole("button", { name: "Enregistrer le brouillon privé", exact: true }).first().click(); confirm = page.getByRole("dialog", { name: "Enregistrer le brouillon privé", exact: true }); await confirm.getByRole("button", { name: "Confirmer cette étape", exact: true }).click(); await page.getByRole("dialog", { name: "Campagne promotion + bannière — révision 2", exact: true }).waitFor(); assert.equal(context.drafts[0].approvedRevision, undefined); assert.equal(activations, 1); pass("édition incrémente la révision et bloque l'ancienne activation");
  editor = page.getByRole("dialog", { name: "Campagne promotion + bannière — révision 2", exact: true }); await editor.getByRole("button", { name: "Fermer la fenêtre", exact: true }).click(); await page.getByRole("button", { name: "Changer de vue fixture", exact: true }).click(); const bannerCard = page.locator("article").filter({ has: page.getByText("Bannière liée fixture", { exact: true }) }); await bannerCard.getByRole("button", { name: "Préparer une modification", exact: true }).click(); editor = page.getByRole("dialog", { name: "Bannière — nouveau brouillon", exact: true }); await editor.getByText("Promotion liée : inactive.", { exact: true }).waitFor(); assert.ok(await editor.getByText("Après confirmation", { exact: false }).count()); pass("bannière : promotion liée inactive signalée dans l'aperçu"); await editor.getByRole("button", { name: "Fermer la fenêtre", exact: true }).click();
  await page.getByRole("button", { name: "Changer de vue fixture", exact: true }).click(); await page.getByRole("button", { name: "Créer", exact: true }).click(); await page.getByRole("button", { name: "Préparer concours", exact: true }).click(); editor = page.getByRole("dialog", { name: "Concours — nouveau brouillon", exact: true }); await editor.getByLabel("Début (Europe/Paris)", { exact: true }).waitFor(); const before = operations.length; assert.equal(drawCalls, 0); await editor.getByRole("button", { name: "Fermer la fenêtre", exact: true }).click(); assert.equal(operations.length, before); pass("concours : éditeur privé, fuseau explicite et aucune action sensible");
  await page.getByRole("button", { name: "Ouvrir", exact: true }).click(); await page.getByRole("heading", { name: "Participants", exact: true }).waitFor(); await page.getByText("fixture@example.test", { exact: true }).waitFor(); pass("participants natifs et parcours concours conservés");
  await page.getByRole("button", { name: "Lancer le tirage", exact: true }).click(); confirm = page.getByRole("dialog", { name: "Lancer le tirage", exact: true }); assert.equal(await confirm.getByRole("button", { name: "Confirmer cette action", exact: true }).isEnabled(), false); await confirm.getByRole("button", { name: "Annuler", exact: true }).click(); assert.equal(drawCalls, 0); pass("tirage séparé, confirmation explicite et annulation sans effet");
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); pass("aucune erreur navigateur ni requête externe, quatre viewports fixture");
  console.log(`${checks} scénarios UI Marketing validés sans navigation réelle ni services externes.`);
} finally { await browser.close(); }
