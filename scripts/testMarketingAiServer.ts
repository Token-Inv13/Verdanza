import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateMarketingAi, handleMarketingAiAdmin, loadMarketingAiContext } from "../api/_server/marketingAi.js";
import { MarketingAiError, type MarketingAiProvider } from "../api/_server/marketingAiProvider.js";
import { marketingAiCollection, MarketingAiDraftError } from "../api/_server/marketingAiDraft.js";
import { executeMarketingOperation, MarketingError } from "../api/_server/marketingAdmin.js";
import type { MarketingAction, MarketingOperation, MarketingResult } from "../src/types/marketing.js";
import type { MarketingAiGeneration, MarketingAiRequest } from "../src/types/marketingAi.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import { CAGNOTTE_DEMO, connectCagnotteEmulator } from "./cagnotteEmulator.js";
import { aiBrief, aiNow, aiPayload } from "./fixtures/marketingAiData.js";
const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
let checks = 0, calls = 0;
const test = async (name: string, run: () => Promise<unknown>) => { await run(); checks++; console.log(`PASS ${name}`); };
const actor = () => "ai-fixture-" + randomUUID();
const failure = (code: string) => (e: unknown) => e instanceof MarketingAiError && e.code === code;
const draftFailure = (code: string) => (e: unknown) => (e instanceof MarketingError || e instanceof MarketingAiDraftError) && e.code === code;
const provider: MarketingAiProvider = { async generateMarketingProposals(context, brief) {
  calls++; ok(context.products.every((p) => p.stock > 0));
  return { provider: "fixture", model: "actual-model-fixture", responseId: "response-fixture", usage: { inputTokens: 100, outputTokens: 200 }, payload: aiPayload(brief.kind === "free" ? "campaign" : brief.kind, brief.count) };
} };
const request = (count = 1): MarketingAiRequest => ({ generationId: randomUUID(), brief: { ...aiBrief, count } });
const publicCollections = ["coupons", "promoBanners", "contests", "contestEntries", "contestDraws", "contestPrizes", "contestAuditLogs", "emailDeliveryLogs"];
const sizes = () => Promise.all(publicCollections.map(async (name) => (await db.collection(name).get()).size));
function save(gen: MarketingAiGeneration, admin: string, parameters = gen.proposals[0].parameters) {
  const operation: MarketingOperation = { action: "save", operationId: randomUUID(), draftId: randomUUID(), expectedRevision: 0, kind: gen.proposals[0].kind, title: "Proposition revue humainement", parameters,
    aiSource: { generationId: gen.id, proposalId: gen.proposals[0].id } };
  return { operation, run: () => executeMarketingOperation(db, admin, operation, aiNow) };
}
const step = (result: MarketingResult, action: MarketingAction, admin: string, operationId = randomUUID()) => executeMarketingOperation(db, admin, { action, operationId, draftId: result.draft.id, expectedRevision: result.draft.revision }, aiNow);
async function generated(kind: "promotion" | "banner" | "contest" | "campaign" = "campaign", admin = actor()) {
  const gen = await generateMarketingAi(db, admin, { ...request(), brief: { ...aiBrief, kind, count: 1 } }, provider, aiNow); return { gen, admin };
}
async function api(token: string, method = "POST", body: unknown = request(), query = "") {
  let status = 200, payload: unknown;
  const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; } };
  await handleMarketingAiAdmin({ method, url: "/api/admin-contests?action=marketing-ai" + query, headers: token ? { authorization: "Bearer " + token } : {}, body } as VercelRequestLike, response as unknown as VercelResponseLike,
    { db, verify: async (value) => ({ uid: value, email: null }), provider, now: aiNow });
  return { status, payload: payload as Record<string, unknown> };
}
try {
  await db.collection("products").doc("ai-product").set({ name: "Résine fixture", category: "resins", isActive: true, price: 10, stock: 100,
    description: "client@example.test", supplierCost: 3, internalNote: "Confidentiel", fixedPriceMode: "none" });
  await test("auth requise et non-admin bloqué avant génération / quota / fournisseur", async () => {
    const before = calls; equal((await api("")).status, 401); equal((await api("customer")).status, 403); equal(calls, before);
    equal((await db.collection(marketingAiCollection).get()).size, 0);
  });
  await test("quatre types et 1/3 propositions, zéro mutation publique ou stock", async () => {
    const before = await sizes();
    for (const kind of ["promotion", "banner", "contest", "campaign"] as const) for (const count of [1, 3]) {
      const result = await generateMarketingAi(db, actor(), { ...request(), brief: { ...aiBrief, kind, count } }, provider, aiNow); equal(result.proposals.length, count); equal(result.proposals[0].kind, kind); equal(result.model, "actual-model-fixture"); ok(result.createdAt.endsWith("Z"));
    }
    deepEqual(await sizes(), before); equal((await db.collection("products").doc("ai-product").get()).data()?.stock, 100);
  });
  await test("périmètres catalogue et sélection absente/inactive/rupture sans données privées", async () => {
    for (const scope of ["all", "category", "products"] as const) {
      const context = await loadMarketingAiContext(db, { ...aiBrief, scope, category: "resins", productIds: ["ai-product"] }, aiNow);
      equal(context.products.length, 1); ok(!JSON.stringify(context).includes("Confidentiel")); ok(!JSON.stringify(context).includes("client@example"));
    }
    await rejects(loadMarketingAiContext(db, { ...aiBrief, scope: "products", productIds: ["missing"] }, aiNow), failure("ai_product_unavailable"));
    for (const changes of [{ isActive: false }, { stock: 0 }]) { await db.collection("products").doc("ai-product").update(changes); await rejects(loadMarketingAiContext(db, { ...aiBrief, scope: "products", productIds: ["ai-product"] }, aiNow), failure("ai_product_unavailable")); await db.collection("products").doc("ai-product").update({ isActive: true, stock: 100 }); }
    await rejects(loadMarketingAiContext(db, { ...aiBrief, scope: "category", category: "oils" }, aiNow), failure("ai_catalog_empty"));
  });
  await test("double clic simultané même UUID : un appel fournisseur, reprise du résultat exact", async () => {
    const admin = actor(), req = request(); let complete: (() => void) | undefined; let start: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { start = resolve; }); const gate = new Promise<void>((resolve) => { complete = resolve; }); let once = 0;
    const delayed: MarketingAiProvider = { async generateMarketingProposals(context, brief, signal) { once++; start!(); await gate; return provider.generateMarketingProposals(context, brief, signal); } };
    const first = generateMarketingAi(db, admin, req, delayed, aiNow); await started;
    await rejects(generateMarketingAi(db, admin, req, delayed, aiNow), failure("ai_generation_pending")); complete!(); const result = await first;
    const replay = await generateMarketingAi(db, admin, req, delayed, aiNow); equal(once, 1); equal(replay.replayed, true); deepEqual(replay.proposals, result.proposals);
    await rejects(generateMarketingAi(db, admin, { ...req, brief: { ...req.brief, objective: "autre" } }, delayed, aiNow), failure("ai_generation_conflict"));
  });
  await test("quotas atomiques : intervalle de 10 s et 6 générations par heure", async () => {
    const admin = actor(); await generateMarketingAi(db, admin, request(), provider, aiNow);
    await rejects(generateMarketingAi(db, admin, request(), provider, aiNow), failure("ai_rate_limit"));
    for (let i = 1; i < 6; i++) await generateMarketingAi(db, admin, request(), provider, new Date(aiNow.getTime() + i * 11000));
    const before = calls; await rejects(generateMarketingAi(db, admin, request(), provider, new Date(aiNow.getTime() + 66000)), failure("ai_rate_limit")); equal(calls, before);
  });
  await test("rejeu après expiration d'une période imposée retrouve la génération sans appel ni activation", async () => {
    const admin = actor(), req = request(); req.brief.period = { startsAt: "2026-09-29T12:00:00.000Z", endsAt: "2026-10-04T12:00:00.000Z" };
    const result = await generateMarketingAi(db, admin, req, provider, aiNow), before = calls;
    const replay = await generateMarketingAi(db, admin, req, null, new Date("2026-10-06T12:00:00Z")); equal(replay.replayed, true); deepEqual(replay.proposals, result.proposals); equal(calls, before);
  });
  await test("absence de clé / modèle n'empêche pas le Marketing manuel, aucune réservation IA", async () => {
    const admin = actor(), req = request(), before = calls; await rejects(generateMarketingAi(db, admin, req, null, aiNow), failure("ai_not_configured")); equal(calls, before); equal((await db.collection(marketingAiCollection).doc(req.generationId).get()).exists, false);
    const manual = await executeMarketingOperation(db, admin, { action: "save", operationId: randomUUID(), draftId: randomUUID(), expectedRevision: 0, kind: "promotion", title: "Manuel", parameters: { promotion: { code: "", label: "", discountType: "percent", discountValue: 10, minimumOrder: 0 } } }, aiNow); equal(manual.draft.origin, "manual"); equal(manual.draft.state, "draft");
  });
  await test("timeout même si le fournisseur ignore AbortSignal : échec durable, jamais rappel automatique", async () => {
    const admin = actor(), req = request(); let count = 0;
    const hanging: MarketingAiProvider = { async generateMarketingProposals() { count++; return new Promise(() => {}); } };
    await rejects(generateMarketingAi(db, admin, req, hanging, aiNow, 15), failure("ai_timeout")); await rejects(generateMarketingAi(db, admin, req, hanging, aiNow, 15), failure("ai_timeout")); equal(count, 1); equal((await db.collection(marketingAiCollection).doc(req.generationId).get()).data()?.state, "failed");
  });
  await test("malformation ou activation injectée : lot entier rejeté sans brouillon / publication", async () => {
    const before = await sizes(), drafts = (await db.collection("marketingDrafts").get()).size;
    for (const payload of ["not json", { proposals: [] }, { ...aiPayload(), isActive: true }, { proposals: aiPayload().proposals.map((p) => ({ ...p, winner: "forged" })) }]) {
      const fake: MarketingAiProvider = { async generateMarketingProposals() { return { payload, provider: "fixture", model: "model" }; } };
      await rejects(generateMarketingAi(db, actor(), request(), fake, aiNow), failure("ai_invalid_proposal"));
    }
    deepEqual(await sizes(), before); equal((await db.collection("marketingDrafts").get()).size, drafts);
  });
  await test("régénération conserve toutes les propositions et la provenance minimale privée", async () => {
    const admin = actor(), first = await generateMarketingAi(db, admin, request(), provider, aiNow);
    const second = await generateMarketingAi(db, admin, request(3), provider, new Date(aiNow.getTime() + 11000));
    ok(first.id !== second.id); const firstStored = (await db.collection(marketingAiCollection).doc(first.id).get()).data()!;
    equal(firstStored.proposals.length, 1); equal(firstStored.requestedBy, admin); equal(firstStored.provider, "fixture"); equal(firstStored.promptVersion, "verdanza-marketing-v1");
    for (const field of ["key", "apiKey", "brief", "context", "reasoning", "rawResponse"]) equal(field in firstStored, false);
    equal((await db.collection(marketingAiCollection).doc(second.id).get()).data()?.proposals.length, 3);
  });
  await test("API : lecture admin propriétaire uniquement, résultat existant retrouvé sans nouveau fournisseur", async () => {
    const { gen, admin } = await generated(); await db.collection("adminUsers").doc(admin).set({ isActive: true }); const other = actor(); await db.collection("adminUsers").doc(other).set({ isActive: true });
    equal((await api(admin, "GET", undefined)).payload.configured, true); const before = calls;
    const result = await api(admin, "GET", undefined, "&generationId=" + gen.id); equal(result.status, 200); equal(result.payload.id, gen.id); equal(calls, before);
    equal((await api(other, "GET", undefined, "&generationId=" + gen.id)).status, 403);
  });
  await test("API POST authentifiée, JSON et brief malformés rejetés sans nouvelle génération", async () => {
    const admin = actor(); await db.collection("adminUsers").doc(admin).set({ isActive: true });
    const req = request(), before = calls, result = await api(admin, "POST", JSON.stringify(req)); equal(result.status, 200); equal(result.payload.id, req.generationId); equal(calls, before + 1);
    equal((await api(admin, "POST", "{broken")).status, 400); equal((await api(admin, "POST", { ...request(), action: "activate" })).status, 400); equal(calls, before + 1);
  });
  await test("proposition modifiée → AI draft : origine/date/auteur serveur, pas de métadonnées client forgées", async () => {
    const { gen, admin } = await generated(); const before = await sizes(); const parameters = structuredClone(gen.proposals[0].parameters); parameters.promotion!.discountValue = 12; parameters.banner!.message = "Message revu par l’admin.";
    const op = save(gen, admin, parameters), result = await op.run(); equal(result.draft.origin, "ai"); equal(result.draft.state, "draft"); equal(result.draft.parameters.promotion?.discountValue, 12); equal(result.draft.ai?.model, "actual-model-fixture"); equal(result.draft.ai?.generationId, gen.id); equal(result.draft.ai?.requestedBy, admin); deepEqual(await sizes(), before);
    deepEqual((await executeMarketingOperation(db, admin, op.operation, aiNow)).draft, result.draft);
    await rejects(save(gen, admin).run(), draftFailure("ai_draft_exists"));
    await rejects(executeMarketingOperation(db, admin, { ...save(gen, admin).operation, origin: "ai" } as MarketingOperation, aiNow), draftFailure("server_field"));
    await rejects(save(gen, "other-admin").run(), draftFailure("ai_source_invalid"));
  });
  await test("AI campagne : revue → approbation → objets inactifs → confirmation finale atomique et compteur conservé", async () => {
    const { gen, admin } = await generated(); const draft = await save(gen, admin).run(); await rejects(step(draft, "activate", admin), draftFailure("approval_required"));
    const reviewed = await step(draft, "review", admin), approved = await step(reviewed, "approve", admin); deepEqual(approved.draft.references, {});
    const materialized = await step(approved, "materialize", admin), coupon = db.collection("coupons").doc(materialized.draft.references.couponId!), banner = db.collection("promoBanners").doc(materialized.draft.references.bannerId!);
    equal((await coupon.get()).data()?.isActive, false); equal((await banner.get()).data()?.isActive, false); await coupon.update({ usedCount: 7 });
    const id = randomUUID(), activated = await step(materialized, "activate", admin, id); equal(activated.draft.state, "activated"); equal((await coupon.get()).data()?.isActive, true); equal((await banner.get()).data()?.isActive, true); equal((await banner.get()).data()?.linkedCouponId, coupon.id); equal((await coupon.get()).data()?.usedCount, 7);
    await coupon.update({ usedCount: 8 }); equal((await step(materialized, "activate", admin, id)).replayed, true); equal((await coupon.get()).data()?.usedCount, 8);
  });
  await test("édition AI N+1 conserve la provenance mais invalide l'approbation de N", async () => {
    const { gen, admin } = await generated("banner"); const saved = await save(gen, admin).run(); const approved = await step(await step(saved, "review", admin), "approve", admin);
    const edited = await executeMarketingOperation(db, admin, { action: "save", operationId: randomUUID(), draftId: approved.draft.id, expectedRevision: 1, title: "Version N+1", parameters: { banner: { ...approved.draft.parameters.banner!, message: "Version revue." } } }, aiNow);
    equal(edited.draft.revision, 2); equal(edited.draft.approvedRevision, undefined); deepEqual(edited.draft.ai, approved.draft.ai); await rejects(step(edited, "activate", admin), draftFailure("approval_required"));
  });
  await test("produit supprimé, inactif ou en rupture APRÈS génération bloque la création", async () => {
    for (const changes of [{ isActive: false }, { stock: 0 }]) {
      const { gen, admin } = await generated(); await db.collection("products").doc("ai-product").update(changes); await rejects(save(gen, admin).run(), draftFailure("ai_product_unavailable")); await db.collection("products").doc("ai-product").update({ isActive: true, stock: 100 });
    }
    const { gen, admin } = await generated(); const product = (await db.collection("products").doc("ai-product").get()).data()!; await db.collection("products").doc("ai-product").delete(); await rejects(save(gen, admin).run(), draftFailure("ai_product_unavailable")); await db.collection("products").doc("ai-product").set(product);
  });
  await test("stock perdu après approbation et après matérialisation : aucun passage ni activation", async () => {
    const { gen, admin } = await generated(); const approved = await step(await step(await save(gen, admin).run(), "review", admin), "approve", admin);
    await db.collection("products").doc("ai-product").update({ stock: 0 }); await rejects(step(approved, "materialize", admin), draftFailure("ai_product_unavailable")); await db.collection("products").doc("ai-product").update({ stock: 100 });
    const m = await step(approved, "materialize", admin); await db.collection("products").doc("ai-product").update({ stock: 0 }); await rejects(step(m, "activate", admin), draftFailure("ai_product_unavailable")); equal((await db.collection("coupons").doc(m.draft.references.couponId!).get()).data()?.isActive, false); equal((await db.collection("promoBanners").doc(m.draft.references.bannerId!).get()).data()?.isActive, false); await db.collection("products").doc("ai-product").update({ stock: 100 });
  });
  await test("human edit hors contexte et coupon concours protégé ne contournent pas les validations", async () => {
    const { gen, admin } = await generated(); const changed = structuredClone(gen.proposals[0].parameters); changed.promotion!.productIds = ["invented"];
    await rejects(save(gen, admin, changed).run(), draftFailure("ai_unknown_product"));
    const other = await generated("banner"); await db.collection("coupons").doc("protected-ai-contest").set({ code: "PROTECTED_AI", source: "contest", isActive: true, usedCount: 0 });
    const linked = structuredClone(other.gen.proposals[0].parameters); linked.banner!.linkedCouponId = "protected-ai-contest";
    const draft = await save(other.gen, other.admin, linked).run(); await rejects(step(draft, "review", other.admin), draftFailure("protected_coupon"));
  });
  await test("AI concours suit la machine native : préparation privée et ouverture distincte, aucun tirage/gain/email", async () => {
    const before = await sizes(), { gen, admin } = await generated("contest"), draft = await save(gen, admin).run(); const m = await step(await step(await step(draft, "review", admin), "approve", admin), "materialize", admin);
    const ref = db.collection("contests").doc(m.draft.references.contestId!); equal((await ref.get()).data()?.status, "draft"); await step(m, "activate", admin); equal((await ref.get()).data()?.status, "scheduled");
    const after = await sizes(); for (const name of ["contestEntries", "contestDraws", "contestPrizes", "emailDeliveryLogs"]) equal(after[publicCollections.indexOf(name)], before[publicCollections.indexOf(name)]);
  });
  await test("plus de 60 produits actifs : contexte refusé avant fournisseur, pas de troncature silencieuse", async () => {
    const batch = db.batch(); for (let i = 0; i < 60; i++) batch.set(db.collection("products").doc("ai-limit-" + i), { name: "Fixture", category: "oils", price: 10, stock: 100, isActive: true }); await batch.commit(); const before = calls;
    await rejects(generateMarketingAi(db, actor(), request(), provider, aiNow), failure("ai_context_limit")); equal(calls, before);
  });
  console.log(`${checks} groupes serveur IA / workflow humain validés sur l’émulateur isolé.`);
} finally { await db.terminate(); }
