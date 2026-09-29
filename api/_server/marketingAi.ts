import { createHash } from "node:crypto";
import { FieldPath, FieldValue, type Firestore } from "firebase-admin/firestore";
import type { MarketingAiBrief, MarketingAiContext, MarketingAiGeneration, MarketingAiProduct, MarketingAiRequest } from "../../src/types/marketingAi.js";
import { assertAdminUser, firebaseAuthHttpFailure, type verifyFirebaseIdToken } from "./adminAuth.js";
import { getAdminDb } from "./firebaseAdmin.js";
import { sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import { serializeContestResponse } from "./contests.js";
import { validateMarketingAiBrief, validateMarketingAiProposals } from "./marketingAiContract.js";
import { MARKETING_AI_PROMPT_VERSION } from "./marketingAiSchema.js";
import { configuredMarketingAiProvider, MarketingAiError, marketingAiLimits, type MarketingAiProvider } from "./marketingAiProvider.js";
import { marketingAiCollection } from "./marketingAiDraft.js";
import { activeFixedPriceOptions, fixedPriceOptionPublicLabel } from "../../src/lib/fixedPriceOptions.js";
import type { Product } from "../../src/types/index.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const shortText = (value: unknown, length: number) => typeof value === "string" ? value.slice(0, length) : "";
const stringArray = (value: unknown) => Array.isArray(value) ? value.filter((s): s is string => typeof s === "string").slice(0, 5).map((s) => s.slice(0, 50)) : [];
export function marketingAiProductContext(id: string, data: Record<string, unknown>): MarketingAiProduct | null {
  if (data.isActive !== true || typeof data.stock !== "number" || !Number.isFinite(data.stock) || data.stock <= 0
    || typeof data.price !== "number" || !Number.isFinite(data.price) || data.price <= 0
    || typeof data.name !== "string" || !data.name.trim() || !["flowers", "resins", "oils", "packs"].includes(String(data.category))) return null;
  const formats = activeFixedPriceOptions(data as Product).slice(0, 8)
    .map((f) => ({ label: shortText(fixedPriceOptionPublicLabel(f), 60), totalPrice: f.totalPrice, quantityGrams: f.quantityGrams }));
  return { id, name: data.name.slice(0, 120), category: String(data.category), price: data.price, stock: data.stock,
    formats, aromas: stringArray(data.aromas), tags: stringArray(data.tags) };
}
export async function loadMarketingAiContext(db: Firestore, brief: MarketingAiBrief, now: Date): Promise<MarketingAiContext> {
  let query = db.collection("products").where("isActive", "==", true);
  if (brief.scope === "category") query = query.where("category", "==", brief.category);
  if (brief.scope === "products") query = query.where(FieldPath.documentId(), "in", brief.productIds);
  const snapshot = await query.select("name", "category", "price", "stock", "aromas", "tags", "fixedPriceMode", "fixedPriceOptions", "isActive")
    .limit(marketingAiLimits.maxProducts + 1).get();
  if (snapshot.size > marketingAiLimits.maxProducts) throw new MarketingAiError("Le catalogue dépasse 60 produits : choisissez une catégorie ou une sélection.", "ai_context_limit");
  const products = snapshot.docs.map((doc) => marketingAiProductContext(doc.id, doc.data())).filter((p): p is MarketingAiProduct => p !== null);
  if (brief.scope === "products" && products.length !== brief.productIds?.length)
    throw new MarketingAiError("Un produit sélectionné est supprimé, inactif, indisponible ou sans prix public valide.", "ai_product_unavailable", 409);
  if (!products.length) throw new MarketingAiError("Aucun produit actif et disponible dans ce périmètre. Le Marketing manuel reste utilisable.", "ai_catalog_empty", 409);
  const context: MarketingAiContext = { now: now.toISOString(), timeZone: "Europe/Paris", products };
  if (Buffer.byteLength(JSON.stringify(context)) > marketingAiLimits.maxContextBytes)
    throw new MarketingAiError("Contexte catalogue trop volumineux : réduisez la sélection.", "ai_context_limit");
  return context;
}
function publicGeneration(id: string, data: Record<string, unknown>, replayed: boolean): MarketingAiGeneration {
  return serializeContestResponse({ id, proposals: data.proposals, provider: data.provider, model: data.model,
    promptVersion: data.promptVersion, createdAt: data.createdAt, requestedBy: data.requestedBy, replayed,
    ...(data.providerResponseId ? { providerResponseId: data.providerResponseId } : {}), ...(data.usage ? { usage: data.usage } : {})
  }) as MarketingAiGeneration;
}
function existingGeneration(id: string, data: Record<string, unknown>, actorId: string, requestHash?: string): MarketingAiGeneration {
  if (data.requestedBy !== actorId || (requestHash && data.requestHash !== requestHash))
    throw new MarketingAiError("Génération non autorisée ou identifiant réutilisé.", "ai_generation_conflict", 403);
  if (data.state === "completed") return publicGeneration(id, data, true);
  if (data.state === "failed") throw new MarketingAiError(String(data.errorMessage), String(data.errorCode), Number(data.errorStatus));
  throw new MarketingAiError("Résultat de génération à vérifier. Reprenez le même identifiant ; aucun nouvel appel automatique.", "ai_generation_pending", 503);
}
export async function generateMarketingAi(db: Firestore, actorId: string, raw: MarketingAiRequest,
  provider: MarketingAiProvider | null, now = new Date(), timeoutMs: number = marketingAiLimits.timeoutMs) {
  if (!raw || Object.keys(raw).some((key) => !["generationId", "brief"].includes(key)) || !uuid.test(raw.generationId || ""))
    throw new MarketingAiError("Identifiant ou demande de génération invalide.", "invalid_brief");
  const brief = validateMarketingAiBrief(raw.brief);
  const requestHash = hash(brief), ref = db.collection(marketingAiCollection).doc(raw.generationId);
  const previous = await ref.get();
  if (previous.exists) return existingGeneration(raw.generationId, previous.data()!, actorId, requestHash);
  if (brief.period && Date.parse(brief.period.endsAt) <= now.getTime()) throw new MarketingAiError("La période imposée est expirée.", "invalid_dates");
  if (!provider) throw new MarketingAiError("Assistant IA non configuré. Le Marketing manuel reste disponible.", "ai_not_configured", 503);
  const context = await loadMarketingAiContext(db, brief, now);
  const quotaRef = db.collection(marketingAiCollection).doc("quota-" + hash(actorId));
  const prior = await db.runTransaction(async (tx) => {
    const [existing, quotaSnap] = await Promise.all([tx.get(ref), tx.get(quotaRef)]);
    if (existing.exists) return existing.data()!;
    const quota = quotaSnap.data() || {}, epoch = now.getTime();
    const sameWindow = typeof quota.windowStartedAt === "number" && epoch < quota.windowStartedAt + 3600000;
    const count = sameWindow ? Number(quota.count || 0) : 0;
    if (count >= marketingAiLimits.perHour || (typeof quota.lastStartedAt === "number" && epoch < quota.lastStartedAt + marketingAiLimits.minIntervalMs))
      throw new MarketingAiError("Limite de générations atteinte. Réessayez plus tard.", "ai_rate_limit", 429);
    tx.set(quotaRef, { type: "quota", windowStartedAt: sameWindow ? quota.windowStartedAt : epoch, count: count + 1, lastStartedAt: epoch });
    tx.create(ref, { type: "generation", state: "pending", requestedBy: actorId, requestHash,
      createdAt: FieldValue.serverTimestamp(), promptVersion: MARKETING_AI_PROMPT_VERSION, allowedProductIds: context.products.map((p) => p.id), drafts: {} });
    return null;
  });
  if (prior) return existingGeneration(raw.generationId, prior, actorId, requestHash);
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let completed: Record<string, unknown>;
  try {
    const result = await Promise.race([provider.generateMarketingProposals(context, brief, controller.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new MarketingAiError("Délai de génération dépassé.", "ai_timeout", 503)); }, timeoutMs); })]);
    const proposals = validateMarketingAiProposals(result.payload, context, brief);
    if (typeof result.provider !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(result.provider)
      || typeof result.model !== "string" || !/^[a-z0-9_.:/-]{1,150}$/i.test(result.model))
      throw new MarketingAiError("Métadonnées IA invalides.", "ai_invalid_response", 502);
    const usage = result.usage;
    completed = { state: "completed", proposals, provider: result.provider, model: result.model,
      completedAt: FieldValue.serverTimestamp(),
      ...(typeof result.responseId === "string" && result.responseId.length <= 200 ? { providerResponseId: result.responseId } : {}),
      ...(usage && Number.isInteger(usage.inputTokens) && usage.inputTokens >= 0 && Number.isInteger(usage.outputTokens)
        && usage.outputTokens >= 0 ? { usage } : {}) };
  } catch (error) {
    const failure = error instanceof MarketingAiError ? error : new MarketingAiError("Fournisseur IA indisponible.", "ai_unavailable", 503);
    await ref.update({ state: "failed", errorMessage: failure.message, errorCode: failure.code, errorStatus: failure.status,
      failedAt: FieldValue.serverTimestamp() });
    throw failure;
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
  // No automatic provider retry if this durable write has an uncertain outcome.
  await ref.update(completed);
  return publicGeneration(raw.generationId, (await ref.get()).data()!, false);
}
export async function handleMarketingAiAdmin(request: VercelRequestLike, response: VercelResponseLike,
  dependencies: { db?: Firestore; verify?: typeof verifyFirebaseIdToken; provider?: MarketingAiProvider | null; now?: Date; timeoutMs?: number } = {}) {
  response.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(request.method || "")) return sendJson(response, { error: "Méthode non autorisée." }, 405);
  try {
    const header = request.headers.authorization, value = Array.isArray(header) ? header[0] : header;
    const token = value?.startsWith("Bearer ") ? value.slice(7).trim() : "";
    if (!token) return sendJson(response, { error: "Session admin requise.", code: "authentication_required" }, 401);
    const db = dependencies.db || getAdminDb(), admin = await assertAdminUser(db, token, dependencies.verify);
    const provider = dependencies.provider === undefined ? configuredMarketingAiProvider() : dependencies.provider;
    if (request.method === "GET") {
      const generationId = new URL(request.url || "/", "https://verdanza.local").searchParams.get("generationId");
      if (!generationId) return sendJson(response, { configured: Boolean(provider), maxProposals: marketingAiLimits.maxProposals });
      if (!uuid.test(generationId)) throw new MarketingAiError("Identifiant invalide.", "invalid_brief");
      const snap = await db.collection(marketingAiCollection).doc(generationId).get();
      if (!snap.exists) throw new MarketingAiError("Génération introuvable.", "ai_generation_missing", 404);
      return sendJson(response, existingGeneration(generationId, snap.data()!, admin.uid));
    }
    let body: unknown;
    try { body = typeof request.body === "string" ? JSON.parse(request.body) : request.body; }
    catch { throw new MarketingAiError("JSON de demande invalide.", "invalid_brief"); }
    if (Buffer.byteLength(JSON.stringify(body) || "") > 12000) throw new MarketingAiError("Demande trop volumineuse.", "invalid_brief");
    return sendJson(response, await generateMarketingAi(db, admin.uid, body as MarketingAiRequest, provider, dependencies.now, dependencies.timeoutMs));
  } catch (error) {
    const auth = firebaseAuthHttpFailure(error);
    if (auth) return sendJson(response, { code: auth.code, error: "Authentification admin indisponible ou invalide." }, auth.status);
    if (error instanceof Error && error.message === "Acces admin requis.") return sendJson(response, { code: "forbidden", error: "Accès admin requis." }, 403);
    if (error instanceof MarketingAiError) return sendJson(response, { code: error.code, error: error.message }, error.status);
    return sendJson(response, { code: "ai_generation_pending", error: "Résultat de génération incertain. Reprenez le même identifiant." }, 503);
  }
}
