import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { Coupon } from "../../src/types/index.js";
import type { MarketingAction, MarketingDraft, MarketingKind, MarketingOperation, MarketingParameters, MarketingReferences } from "../../src/types/marketing.js";
import { marketingUtcDate } from "../../src/lib/adminMarketingDates.js";
import { promotionAvailability } from "../../src/lib/promotionDates.js";
import { normalizeGiftTiers, validateTieredProductGift } from "../../src/lib/tieredProductGifts.js";
import { assertAdminUser, firebaseAuthHttpFailure, type verifyFirebaseIdToken } from "./adminAuth.js";
import { getAdminDb } from "./firebaseAdmin.js";
import { sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import { ContestError, createContestInTransaction, updateContestInTransaction, transitionContestInTransaction, validateContestInput, serializeContestResponse } from "./contests.js";
import { assertMarketingAiProducts, claimMarketingAiProposal, MarketingAiDraftError } from "./marketingAiDraft.js";

export const marketingCollections = { drafts: "marketingDrafts", operations: "marketingOperations", audits: "marketingAuditLogs", codes: "marketingCouponCodes" } as const;
import { promotionFields, bannerFields, contestFields } from "../../src/lib/marketingConfiguration.js";
const refCollections = { couponId: "coupons", bannerId: "promoBanners", contestId: "contests" } as const;
const kinds: MarketingKind[] = ["promotion", "banner", "contest", "campaign"];
const actions: MarketingAction[] = ["save", "review", "approve", "materialize", "activate", "deactivate", "archive"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RefKey = keyof MarketingReferences;
type LiveObjects = Partial<Record<RefKey, Record<string, unknown>>>;

export class MarketingError extends Error {
  constructor(message: string, readonly code = "invalid_draft", readonly status = 400) { super(message); }
}
function fail(message: string, code = "invalid_draft", status = 400): never { throw new MarketingError(message, code, status); }
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("Paramètres du brouillon invalides.");
  return raw as Record<string, unknown>;
}
function pick(raw: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
}
function canonical(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(canonical);
  if (raw && typeof raw === "object") return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)]));
  return raw;
}
function fingerprint(raw: unknown) { return createHash("sha256").update(JSON.stringify(canonical(raw))).digest("hex"); }
export function marketingBusinessFingerprint(key: RefKey, object: Record<string, unknown>) {
  const fields = key === "couponId" ? [...promotionFields, "isActive", "source", "contestId", "contestPrizeId", "redeemableByEmailHash"] : key === "bannerId" ? [...bannerFields, "isActive", "deletedLinkedCouponId"] : [...contestFields, "status"];
  return fingerprint(pick(object, fields));
}
function identifier(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || value.includes("/") || [".", ".."].includes(value) || Array.from(value).some((c) => c.charCodeAt(0) < 32)) return fail(`${label} invalide.`);
  return value;
}
function boundedText(raw: unknown, label: string, limit: number, required = false) {
  if (typeof raw !== "string" || raw.length > limit || (required && !raw.trim())) return fail(`${label} invalide.`);
  return raw.trim();
}
function sanitizeParameters(raw: unknown, kind: MarketingKind) {
  const source = record(raw);
  const allowed = kind === "campaign" ? ["promotion", "banner", "couponDocumentId"] : kind === "promotion" ? ["promotion", "couponDocumentId"] : [kind];
  if (Object.keys(source).some((key) => !allowed.includes(key))) fail("Paramètre marketing non autorisé.");
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key === "couponDocumentId") {
      if (source[key]) result[key] = identifier(source[key], "Identifiant de promotion");
      continue;
    }
    if (!source[key]) fail(`Configuration ${key} manquante.`);
    const value = record(source[key]);
    const fields = key === "promotion" ? promotionFields : key === "banner" ? bannerFields : contestFields;
    if (Object.keys(value).some((field) => !(fields as readonly string[]).includes(field))) fail("La configuration ne peut contenir ni état d'activation, ni compteur, ni champ serveur.", "server_field");
    result[key] = pick(value, fields);
  }
  return result as MarketingParameters;
}
function money(value: unknown, label: string, optional = false, integer = false) {
  if (optional && value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000 || (integer && !Number.isInteger(value))) fail(`${label} invalide.`);
}
function stringList(value: unknown, label: string, categories = false) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some((v) => typeof v !== "string" || !v || v.length > 120) || new Set(value).size !== value.length) return fail(`${label} invalide.`);
  if (categories && value.some((v) => !["flowers", "resins"].includes(v))) fail(`${label} : catégorie inconnue.`);
  return value as string[];
}
function period(config: Record<string, unknown>, start = "startsAt", end = "endsAt") {
  try {
    const startsAt = marketingUtcDate(config[start]);
    const endsAt = marketingUtcDate(config[end], "end");
    if (startsAt) config[start] = startsAt;
    if (endsAt) config[end] = endsAt;
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) fail("La fin doit suivre le début.", "invalid_dates");
  } catch (error) { if (error instanceof MarketingError) throw error; fail(error instanceof Error ? error.message : "Dates invalides.", "invalid_dates"); }
}
function safeUrl(value: unknown) {
  if (value === undefined || value === "") return;
  if (typeof value !== "string" || value.length > 2048 || /[\s\\]/.test(value) || Array.from(value).some((c) => c.charCodeAt(0) < 32)) fail("Lien CTA invalide.");
  if (value.startsWith("/") && !value.startsWith("//")) return;
  try { const url = new URL(value); if (url.protocol === "https:" && !url.username && !url.password) return; } catch { /* invalid URL */ }
  fail("Le lien doit être interne ou utiliser HTTPS.");
}
export function validateMarketingParameters(raw: MarketingParameters, kind: MarketingKind) {
  const parameters = sanitizeParameters(raw, kind);
  if (parameters.promotion) {
    const p = parameters.promotion;
    p.code = boundedText(p.code, "Code", 80, true).toUpperCase().replace(/\s+/g, "");
    if (Array.from(p.code).some((c) => c.charCodeAt(0) < 32)) fail("Code promotion invalide.");
    p.label = boundedText(p.label, "Nom de promotion", 200, true);
    if (!["percent", "fixed", "free_shipping"].includes(p.discountType)) fail("Type de remise invalide.");
    if (p.promotionType && !["fixed_cart_discount", "fixed_category_discount", "threshold_extra_discount", "percentage_cart_discount", "percentage_category_discount", "free_shipping", "tiered_product_gift"].includes(p.promotionType)) fail("Type de promotion invalide.");
    for (const key of ["discountValue", "minimumOrder"] as const) money(p[key], key);
    for (const key of ["minEligibleSubtotal", "paidThresholdAmount", "maxGiftAmount", "maxDiscountAmount", "priority"] as const) money(p[key], key, true);
    money(p.maxUses, "Limite d'utilisation", true, true);
    if (p.discountType === "percent" && (p.discountValue <= 0 || p.discountValue > 100)) fail("Pourcentage compris entre 0 et 100 requis.");
    if (p.discountType === "fixed" && p.promotionType !== "tiered_product_gift" && p.promotionType !== "threshold_extra_discount" && p.discountValue <= 0) fail("Montant de remise positif requis.");
    if (p.promotionType === "threshold_extra_discount" && (!p.paidThresholdAmount || !p.maxGiftAmount || !p.eligibleCategory)) fail("Seuil payé, montant offert et catégorie requis.");
    if (p.promotionType?.includes("category") && !p.eligibleCategory && !p.categories?.length) fail("Catégorie de promotion requise.");
    if (p.eligibleCategory && !["flowers", "resins"].includes(p.eligibleCategory)) fail("Catégorie inconnue.");
    for (const key of ["autoApply", "stackable", "isArchived", "isTemplate"] as const) if (p[key] !== undefined && typeof p[key] !== "boolean") fail(`${key} invalide.`);
    for (const key of ["productIds", "giftProductIds", "qualifyingProductIds"] as const) stringList(p[key], key);
    for (const key of ["categories", "qualifyingCategories"] as const) stringList(p[key], key, true);
    period(p as unknown as Record<string, unknown>);
    if (p.internalNote !== undefined) boundedText(p.internalNote, "Note", 4000);
    if (p.giftSelectionMode && !["customer_choice", "automatic_first_available"].includes(p.giftSelectionMode)) fail("Mode cadeau invalide.");
    if (p.qualifyingScope && !["cart_subtotal", "categories", "products"].includes(p.qualifyingScope)) fail("Périmètre cadeau invalide.");
    if (p.defaultGiftProductId) identifier(p.defaultGiftProductId, "Cadeau par défaut");
    if (p.giftTiers !== undefined && (!Array.isArray(p.giftTiers) || p.giftTiers.length > 30 || p.giftTiers.some((t) => !t || typeof t.id !== "string" || !t.id || !Number.isFinite(t.minimumSubtotal) || !Number.isInteger(t.quantityGrams) || t.quantityGrams <= 0) || new Set(p.giftTiers.map((t) => t.id)).size !== p.giftTiers.length)) fail("Paliers cadeau invalides.");
    if (p.promotionType === "tiered_product_gift") {
      const issues = validateTieredProductGift(p);
      if (issues.length) fail(issues.join(" "));
      p.giftTiers = normalizeGiftTiers(p.giftTiers || []);
    } else {
      // Same cleanup as the existing coupon configuration writer.
      for (const key of ["giftTiers", "giftProductIds", "giftSelectionMode", "defaultGiftProductId", "qualifyingScope", "qualifyingCategories", "qualifyingProductIds"] as const) delete p[key];
    }
  }
  if (parameters.banner) {
    const b = parameters.banner;
    b.title = boundedText(b.title, "Titre de bannière", 200, true);
    b.message = boundedText(b.message, "Message de bannière", 2000, true);
    if (!["top_bar", "shop_card", "checkout_notice", "modal"].includes(b.type)) fail("Type de bannière invalide.");
    const placements = b.placements?.length ? b.placements : [b.placement];
    const allowed = ["home", "shop", "flowers", "resins", "cart", "checkout", "all_public", "draft"];
    if (!Array.isArray(placements) || !placements.length || placements.some((p) => !allowed.includes(p)) || new Set(placements).size !== placements.length || (placements.includes("draft") && placements.length > 1)) fail("Placements invalides.");
    b.placements = placements; b.placement = placements[0];
    money(b.priority, "Priorité de bannière");
    if (!["default", "promo", "delivery", "info", "warning"].includes(b.variant)) fail("Variante invalide.");
    for (const key of ["dismissible", "isArchived", "isTemplate"] as const) if (b[key] !== undefined && typeof b[key] !== "boolean") fail(`${key} invalide.`);
    safeUrl(b.buttonUrl);
    if (b.buttonLabel !== undefined) boundedText(b.buttonLabel, "Libellé CTA", 120);
    if (Boolean(b.buttonLabel) !== Boolean(b.buttonUrl)) fail("Le CTA nécessite un libellé et un lien.");
    if (b.linkedCouponId) identifier(b.linkedCouponId, "Promotion liée");
    if (b.linkedPromoCode) b.linkedPromoCode = boundedText(b.linkedPromoCode, "Code lié", 80, true).toUpperCase().replace(/\s+/g, "");
    period(b as unknown as Record<string, unknown>);
  }
  if (parameters.contest) {
    const c = parameters.contest as unknown as Record<string, unknown>;
    period(c, "startAt", "endAt");
    try { c.drawAt = marketingUtcDate(c.drawAt); } catch { fail("Date de tirage invalide.", "invalid_dates"); }
    parameters.contest = validateContestInput(c);
  }
  return parameters;
}

async function loadReferences(tx: Transaction, db: Firestore, refs: MarketingReferences) {
  const live: LiveObjects = {};
  for (const key of Object.keys(refs) as RefKey[]) {
    if (!refs[key]) continue;
    const snap = await tx.get(db.collection(refCollections[key]).doc(identifier(refs[key], "Référence métier")));
    if (!snap.exists) fail("Objet métier supprimé ou introuvable. Rechargez le Marketing.", "reference_missing", 409);
    live[key] = snap.data()!;
    if (key === "couponId" && (live[key]?.source === "contest" || ["contestId", "contestPrizeId", "redeemableByEmailHash"].some((field) => field in live[key]!))) fail("Les coupons concours sont protégés.", "protected_coupon", 403);
  }
  return live;
}
function assertBases(draft: MarketingDraft, live: LiveObjects) {
  for (const key of Object.keys(draft.references) as RefKey[]) {
    if (live[key] && draft.baseFingerprints[key] !== marketingBusinessFingerprint(key, live[key]!)) fail("La configuration métier a changé. Préparez un nouveau brouillon depuis l'état actuel.", "business_conflict", 409);
  }
}
async function validateReferences(tx: Transaction, db: Firestore, draft: MarketingDraft, parameters: MarketingParameters, live: LiveObjects, activating: boolean, now: Date) {
  if (draft.origin === "ai" && draft.ai) await assertMarketingAiProducts(tx, db, draft.ai, parameters);
  const p = parameters.promotion;
  if (p) {
    const productIds = new Set([...(p.productIds || []), ...(p.giftProductIds || []), ...(p.qualifyingProductIds || [])]);
    for (const id of productIds) {
      const product = await tx.get(db.collection("products").doc(identifier(id, "Produit")));
      if (!product.exists || product.data()?.isActive !== true) fail(`Produit ${id} introuvable ou inactif.`, "product_missing", 409);
    }
    const sameCode = await tx.get(db.collection("coupons").where("code", "==", p.code));
    if (sameCode.docs.some((doc) => doc.id !== draft.references.couponId)) fail("Ce code promotion est déjà utilisé.", "code_conflict", 409);
    const codeRef = db.collection(marketingCollections.codes).doc(fingerprint(p.code));
    const reserved = await tx.get(codeRef);
    if (reserved.exists && reserved.data()?.couponId !== draft.references.couponId) fail("Ce code est réservé à une autre promotion.", "code_conflict", 409);
    if (activating && Number(p.maxUses || 0) > 0 && Number(live.couponId?.usedCount || 0) >= Number(p.maxUses)) fail("La limite d'utilisation est atteinte.", "max_uses", 409);
  }
  const b = parameters.banner;
  if (b && draft.kind !== "campaign" && (b.linkedCouponId || b.linkedPromoCode)) {
    let linked: (Record<string, unknown> & { id?: string }) | undefined;
    if (b.linkedCouponId) {
      const snap = await tx.get(db.collection("coupons").doc(b.linkedCouponId));
      if (snap.exists) linked = { ...snap.data(), id: snap.id };
    } else {
      const matching = await tx.get(db.collection("coupons").where("code", "==", b.linkedPromoCode));
      if (matching.size !== 1) fail("Promotion liée absente ou ambiguë.", "linked_promotion_missing", 409);
      linked = { ...matching.docs[0].data(), id: matching.docs[0].id };
    }
    if (!linked) fail("Promotion liée introuvable.", "linked_promotion_missing", 409);
    if (linked.source === "contest" || ["contestId", "contestPrizeId", "redeemableByEmailHash"].some((field) => field in linked!)) fail("Une bannière ne peut exposer un coupon concours protégé.", "protected_coupon", 403);
    if (b.linkedCouponId && b.linkedPromoCode && linked.code !== b.linkedPromoCode) fail("Le code et l'identifiant lié désignent des promotions différentes.", "linked_promotion_conflict", 409);
    if (activating) {
      const state = promotionAvailability(linked as Partial<Coupon>, now);
      if (!["active", "scheduled"].includes(state)) fail(`Promotion liée ${state === "inactive" ? "inactive" : "expirée ou épuisée"} : bannière non activable.`, "linked_promotion_inactive", 409);
      if (linked.isTemplate) fail("La promotion liée est un modèle.", "linked_promotion_inactive", 409);
      const start = Math.max(Date.parse(String(linked.startsAt || "")) || 0, Date.parse(b.startsAt || "") || 0, now.getTime());
      const end = Math.min(Date.parse(String(linked.endsAt || "")) || Infinity, Date.parse(b.endsAt || "") || Infinity);
      if (start >= end) fail("Les périodes de la bannière et de la promotion ne se recouvrent pas.", "invalid_dates", 409);
    }
  }
  if (draft.kind === "campaign" && b && p) {
    if (draft.references.couponId) b.linkedCouponId = draft.references.couponId;
    else delete b.linkedCouponId;
    b.linkedPromoCode = p.autoApply ? "" : p.code;
    const start = Math.max(Date.parse(p.startsAt || "") || 0, Date.parse(b.startsAt || "") || 0, now.getTime());
    const end = Math.min(Date.parse(p.endsAt || "") || Infinity, Date.parse(b.endsAt || "") || Infinity);
    if (activating && start >= end) fail("Les périodes de campagne ne se recouvrent pas.", "invalid_dates", 409);
  }
  if (activating) {
    for (const config of [p, b]) {
      if (config?.isArchived || config?.isTemplate) fail("Un modèle ou une archive ne peut être activé.", "archived_object", 409);
      if (config?.endsAt && Date.parse(config.endsAt) <= now.getTime()) fail("La période est expirée.", "expired", 409);
    }
    if (b && (b.placements || [b.placement]).includes("draft")) fail("Choisissez un placement public avant l'activation.");
    if (parameters.contest && Date.parse(parameters.contest.endAt) <= now.getTime()) fail("Le concours est expiré.", "expired", 409);
  }
  if (parameters.contest && live.contestId && !["draft", "scheduled"].includes(String(live.contestId.status))) fail("La configuration du concours est verrouillée après ouverture.", "contest_configuration_locked", 409);
  if (parameters.contest && activating) {
    const contest = parameters.contest;
    const scheduled = await tx.get(db.collection("contests").where("status", "in", ["active", "scheduled"]));
    if (scheduled.docs.some((doc) => doc.id !== draft.references.contestId && Date.parse(String(doc.data().startAt)) < Date.parse(contest.endAt) && Date.parse(String(doc.data().endAt)) > Date.parse(contest.startAt))) fail("Une autre période de concours active ou programmée chevauche cette période.", "contest_period_conflict", 409);
  }
}

export async function executeMarketingOperation(db: Firestore, actorId: string, raw: MarketingOperation, now = new Date()) {
  if (Object.keys(raw).some((key) => !["action", "operationId", "draftId", "expectedRevision", "kind", "title", "parameters", "references", "baseFingerprints", "aiSource"].includes(key)))
    fail("Champ d'opération non autorisé.", "server_field");
  if (!uuid.test(raw.operationId || "") || !uuid.test(raw.draftId || "")) fail("Identifiant d'opération ou de brouillon invalide.");
  if (!actions.includes(raw.action) || !Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 0) fail("Action ou révision invalide.");
  const requestHash = fingerprint(raw);
  const receiptRef = db.collection(marketingCollections.operations).doc(raw.operationId);
  const draftRef = db.collection(marketingCollections.drafts).doc(raw.draftId);
  const replayed = await db.runTransaction(async (tx) => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data()?.actorId !== actorId || receipt.data()?.requestHash !== requestHash) fail("Identifiant d'opération déjà utilisé pour une autre demande.", "operation_conflict", 409);
      return true;
    }
    const snap = await tx.get(draftRef);
    const old = snap.exists ? { ...snap.data(), id: snap.id } as MarketingDraft : undefined;
    if ((!old && (raw.action !== "save" || raw.expectedRevision !== 0)) || (old && old.revision !== raw.expectedRevision)) fail("Révision obsolète. Rechargez le brouillon avant de continuer.", "stale_revision", 409);
    if (old?.state === "archived") fail("Brouillon archivé. Créez une nouvelle proposition.", "archived_draft", 409);
    const kind = old?.kind || raw.kind;
    if (!kind || !kinds.includes(kind) || (raw.kind && raw.kind !== kind)) fail("Type de brouillon invalide.");
    let next: MarketingDraft;
    const serverDate = FieldValue.serverTimestamp();
    if (raw.action === "save") {
      const parameters = raw.aiSource && !old ? validateMarketingParameters(raw.parameters!, kind) : sanitizeParameters(raw.parameters, kind);
      if (raw.aiSource && old) fail("La provenance IA d'un brouillon ne peut être remplacée.", "ai_source_invalid", 409);
      if (raw.aiSource && Object.values(raw.references || {}).some(Boolean)) fail("La proposition IA crée un brouillon privé sans objet métier lié.", "ai_source_invalid", 409);
      const claim = raw.aiSource ? await claimMarketingAiProposal(tx, db, actorId, raw.draftId, raw.aiSource, kind, parameters) : null;
      const ai = old?.ai || claim?.provenance;
      if (ai) await assertMarketingAiProducts(tx, db, ai, parameters);
      const references: MarketingReferences = old?.references || {};
      if (!old) {
        const supplied = raw.references || {};
        const allowedRefs = kind === "campaign" ? ["couponId", "bannerId"] : kind === "promotion" ? ["couponId"] : kind === "banner" ? ["bannerId"] : ["contestId"];
        for (const key of Object.keys(supplied) as RefKey[]) {
          if (!allowedRefs.includes(key)) fail("Référence incompatible avec le brouillon.");
          if (supplied[key]) references[key] = identifier(supplied[key], "Référence métier");
        }
      } else if (raw.references && fingerprint(raw.references) !== fingerprint(old.references)) fail("Les références d'un brouillon ne peuvent être remplacées.", "business_conflict", 409);
      const live = await loadReferences(tx, db, references);
      const bases = old?.baseFingerprints || raw.baseFingerprints || {};
      const candidate = { references, baseFingerprints: bases } as MarketingDraft;
      assertBases(candidate, live);
      const title = boundedText(raw.title, "Nom du brouillon", 200, true);
      next = { id: raw.draftId, kind, title, origin: old?.origin || (claim ? "ai" : "manual"), ...(ai ? { ai } : {}), parameters, references, baseFingerprints: bases,
        revision: (old?.revision || 0) + 1, state: "draft", authorId: old?.authorId || actorId, updatedBy: actorId,
        createdAt: old?.createdAt || serverDate as unknown as string, updatedAt: serverDate as unknown as string };
      if (claim) tx.update(claim.ref, { drafts: claim.drafts });
    } else {
      if (!old) return fail("Brouillon introuvable.", "draft_missing", 404);
      next = { ...old, updatedBy: actorId, updatedAt: serverDate as unknown as string };
      const live = await loadReferences(tx, db, old.references);
      assertBases(old, live);
      if (["review", "approve", "materialize", "activate"].includes(raw.action)) {
        const parameters = validateMarketingParameters(old.parameters, kind);
        // Stable IDs are selected before validation and all transaction writes.
        const references = { ...old.references };
        const newKeys: RefKey[] = [];
        if (raw.action === "materialize") {
          if (old.approvedRevision !== old.revision || old.state !== "approved") fail("Approuvez cette révision avant matérialisation.", "approval_required", 409);
          if (parameters.promotion && !references.couponId) { references.couponId = parameters.couponDocumentId || parameters.promotion.code.toLowerCase(); newKeys.push("couponId"); }
          if (parameters.banner && !references.bannerId) { references.bannerId = `marketing-${old.id}`; newKeys.push("bannerId"); }
          if (parameters.contest && !references.contestId) { references.contestId = `marketing-${old.id}`; newKeys.push("contestId"); }
          for (const key of newKeys) {
            const exists = await tx.get(db.collection(refCollections[key]).doc(identifier(references[key], "Identifiant métier")));
            if (exists.exists) fail("L'identifiant métier existe déjà. Préparez un brouillon de modification.", "business_conflict", 409);
          }
        }
        next.references = references;
        await validateReferences(tx, db, next, parameters, live, raw.action === "activate", now);
        const oldCode = String(live.couponId?.code || "");
        const oldCodeRef = parameters.promotion && raw.action === "activate" && oldCode && oldCode !== parameters.promotion.code ? db.collection(marketingCollections.codes).doc(fingerprint(oldCode)) : null;
        const oldReservation = oldCodeRef ? await tx.get(oldCodeRef) : null;
        next.parameters = parameters;
        if (raw.action === "review") {
          if (old.state !== "draft") fail("Seul un brouillon modifié peut être revu.", "invalid_state", 409);
          next.state = "reviewed"; next.reviewedRevision = old.revision;
        } else if (raw.action === "approve") {
          if (old.state !== "reviewed" || old.reviewedRevision !== old.revision) fail("Prévisualisez et revoyez cette révision avant approbation.", "review_required", 409);
          next.state = "approved"; next.approvedRevision = old.revision;
          next.approval = { actorId, at: serverDate as unknown as string, revision: old.revision };
        } else if (raw.action === "materialize") {
          if (parameters.contest && newKeys.includes("contestId")) {
            await createContestInTransaction(tx, db, db.collection("contests").doc(references.contestId!), parameters.contest, { actorType: "admin", actorId });
            live.contestId = { ...parameters.contest, status: "draft" };
          }
          for (const key of newKeys.filter((key) => key !== "contestId")) {
            const config = key === "couponId" ? parameters.promotion! : parameters.banner!;
            const payload = { ...config, isActive: false, isArchived: Boolean(config.isArchived), isTemplate: Boolean(config.isTemplate), ...(key === "couponId" ? { usedCount: 0 } : {}), createdAt: serverDate, updatedAt: serverDate };
            tx.set(db.collection(refCollections[key]).doc(references[key]!), payload);
            live[key] = payload;
          }
          if (parameters.promotion && newKeys.includes("couponId")) tx.set(db.collection(marketingCollections.codes).doc(fingerprint(parameters.promotion.code)), { couponId: references.couponId, createdAt: serverDate });
          next.baseFingerprints = { ...old.baseFingerprints };
          for (const key of Object.keys(live) as RefKey[]) next.baseFingerprints[key] = marketingBusinessFingerprint(key, live[key]!);
          next.state = "materialized"; next.materializedRevision = old.revision;
        } else {
          if (old.state !== "materialized" || old.materializedRevision !== old.revision || old.approvedRevision !== old.revision) fail("Cette révision n'est pas approuvée et matérialisée.", "approval_required", 409);
          if (parameters.contest) {
            const target = Date.parse(parameters.contest.startAt) > now.getTime() ? "scheduled" : "active";
            if (live.contestId?.status === "scheduled" && target === "scheduled") await updateContestInTransaction(tx, db, references.contestId!, parameters.contest, { actorType: "admin", actorId });
            else await transitionContestInTransaction(tx, db, references.contestId!, target, { actorType: "admin", actorId }, now, parameters.contest);
            live.contestId = { ...live.contestId, ...parameters.contest, status: target };
          }
          for (const key of ["couponId", "bannerId"] as const) {
            const config = key === "couponId" ? parameters.promotion : parameters.banner;
            if (!config) continue;
            // Replace only configuration fields; usage and other server fields survive.
            const fields = key === "couponId" ? promotionFields : bannerFields;
            const update = Object.fromEntries(fields.map((field) => [field, (config as unknown as Record<string, unknown>)[field] ?? FieldValue.delete()]));
            tx.update(db.collection(refCollections[key]).doc(references[key]!), { ...update, ...(key === "bannerId" ? { deletedLinkedCouponId: FieldValue.delete() } : {}), isActive: true, isArchived: false, isTemplate: false, updatedAt: serverDate });
            live[key] = { ...(key === "couponId" ? pick(live[key]!, ["source", "usedCount"]) : {}), ...config, isActive: true, isArchived: false, isTemplate: false };
          }
          if (parameters.promotion) tx.set(db.collection(marketingCollections.codes).doc(fingerprint(parameters.promotion.code)), { couponId: references.couponId, updatedAt: serverDate }, { merge: true });
          if (oldCodeRef && oldReservation?.data()?.couponId === references.couponId) tx.delete(oldCodeRef);
          next.baseFingerprints = { ...old.baseFingerprints };
          for (const key of Object.keys(live) as RefKey[]) next.baseFingerprints[key] = marketingBusinessFingerprint(key, live[key]!);
          next.state = "activated"; next.activatedRevision = old.revision;
        }
      } else {
        if (raw.action === "deactivate" && kind === "contest") fail("Utilisez les actions de statut du concours pour le fermer ou l'annuler.", "contest_action_required", 409);
        if (raw.action === "archive" && live.contestId && !["draft", "completed", "cancelled"].includes(String(live.contestId.status))) fail("Fermez ou annulez d'abord le concours depuis ses actions dédiées.", "contest_action_required", 409);
        for (const key of ["couponId", "bannerId"] as const) {
          if (!live[key]) continue;
          const update = { isActive: false, ...(raw.action === "archive" ? { isArchived: true, archivedAt: serverDate } : {}), updatedAt: serverDate };
          tx.update(db.collection(refCollections[key]).doc(old.references[key]!), update);
          live[key] = { ...live[key], ...update };
          next.baseFingerprints[key] = marketingBusinessFingerprint(key, live[key]!);
        }
        next.state = raw.action === "archive" ? "archived" : "draft";
        delete next.approvedRevision; delete next.reviewedRevision; delete next.materializedRevision; delete next.activatedRevision; delete next.approval;
      }
    }
    const payload = { ...next }; delete (payload as Partial<MarketingDraft>).id;
    tx.set(draftRef, payload);
    tx.set(db.collection(marketingCollections.audits).doc(raw.operationId), { draftId: raw.draftId, kind, revision: next.revision, action: raw.action, event: raw.action === "save" ? old ? "draft_updated" : "draft_created" : raw.action, actorId, operationId: raw.operationId, references: next.references, createdAt: serverDate, ...(kind === "contest" ? { contestAuditCollection: "contestAuditLogs" } : {}) });
    tx.set(receiptRef, { actorId, requestHash, result: { draft: next, operationId: raw.operationId }, createdAt: serverDate });
    return false;
  });
  const receipt = await receiptRef.get();
  return serializeContestResponse({ ...receipt.data()!.result, replayed }) as { draft: MarketingDraft; operationId: string; replayed: boolean };
}

export async function getMarketingContext(db: Firestore) {
  const [drafts, coupons, banners, contests, products] = await Promise.all([db.collection(marketingCollections.drafts).get(), db.collection("coupons").get(), db.collection("promoBanners").get(), db.collection("contests").get(), db.collection("products").get()]);
  const values = (snapshot: FirebaseFirestore.QuerySnapshot) => snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  const fingerprints: Record<string, string> = {};
  for (const [key, snapshot] of [["couponId", coupons], ["bannerId", banners], ["contestId", contests]] as const) for (const doc of snapshot.docs) fingerprints[`${key}:${doc.id}`] = marketingBusinessFingerprint(key, doc.data());
  return serializeContestResponse({ drafts: values(drafts), coupons: values(coupons), banners: values(banners), contests: values(contests), products: values(products), fingerprints });
}

export async function handleMarketingAdmin(request: VercelRequestLike, response: VercelResponseLike, dependencies: { db?: Firestore; verify?: typeof verifyFirebaseIdToken } = {}) {
  response.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(request.method || "")) return sendJson(response, { error: "Méthode non autorisée." }, 405);
  try {
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const token = value?.startsWith("Bearer ") ? value.slice(7).trim() : "";
    if (!token) return sendJson(response, { error: "Authentification admin requise.", code: "authentication_required" }, 401);
    const db = dependencies.db || getAdminDb();
    const admin = await assertAdminUser(db, token, dependencies.verify);
    if (request.method === "GET") {
      const query = new URL(request.url || "/", "https://verdanza.local").searchParams;
      const draftId = query.get("draftId");
      if (draftId) {
        if (!uuid.test(draftId)) fail("Identifiant de brouillon invalide.");
        const [draft, audits] = await Promise.all([db.collection(marketingCollections.drafts).doc(draftId).get(), db.collection(marketingCollections.audits).where("draftId", "==", draftId).get()]);
        if (!draft.exists) fail("Brouillon introuvable.", "draft_missing", 404);
        return sendJson(response, serializeContestResponse({ draft: { ...draft.data(), id: draft.id }, audits: audits.docs.map((doc) => ({ ...doc.data(), id: doc.id })) }));
      }
      return sendJson(response, await getMarketingContext(db));
    }
    let body: Record<string, unknown>;
    try { body = record(typeof request.body === "string" ? JSON.parse(request.body) : request.body); } catch { return sendJson(response, { error: "Corps JSON invalide." }, 400); }
    if (JSON.stringify(body).length > 150_000) fail("Brouillon trop volumineux.");
    const result = await executeMarketingOperation(db, admin.uid, record(body.operation) as MarketingOperation);
    return sendJson(response, result);
  } catch (error) {
    const auth = firebaseAuthHttpFailure(error);
    if (auth) return sendJson(response, { code: auth.code, error: "Authentification admin indisponible ou invalide." }, auth.status);
    if (error instanceof Error && error.message === "Acces admin requis.") return sendJson(response, { error: "Accès admin requis.", code: "forbidden" }, 403);
    if (error instanceof MarketingError) return sendJson(response, { error: error.message, code: error.code }, error.status);
    if (error instanceof MarketingAiDraftError) return sendJson(response, { error: error.message, code: error.code }, error.status);
    if (error instanceof ContestError) return sendJson(response, { error: error.message, code: error.code }, error.statusCode);
    return sendJson(response, { error: "Résultat incertain : rechargez ou rejouez exactement la même opération.", code: "operation_uncertain" }, 503);
  }
}
