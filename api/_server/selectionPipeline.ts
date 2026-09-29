import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { FieldValue, FieldPath, type Firestore } from "firebase-admin/firestore";
import type { Product, SupplierPurchase } from "../../src/types/index.js";
import { normalizeSelection, publicationMissing, selectionPublicName, selectionSlug, type ProductSelection } from "../../src/types/selection.js";
import { emptyWorkflow, normalizeCommercial, type PipelineContext, type PipelineOperation, type SelectionWorkflow } from "../../src/types/selectionPipeline.js";
import { invalidateWorkflow, preparePipelineProduct, selectionValidationMissing, supplierCostCandidates, validatePipelineProductFormats } from "../../src/lib/selectionPipeline.js";
import { validatePricingPolicy } from "../../src/lib/selectionPricing.js";
import { publicSelectionEntry } from "../../src/lib/selectionPublication.js";
import { productSheets } from "../../src/data/productSheets.js";
import { isLegacyProductInternalReference, isProductInternalReference } from "../../src/lib/productReferences.js";
import { catalogProductId } from "../../src/lib/selectionCatalog.js";
import { normalizeProductImages, PRODUCT_IMAGE_MAX_COUNT } from "../../src/lib/productImages.js";
import { reserveProductInternalReference } from "./productReferences.js";
import { assertAdminUser, firebaseAuthHttpFailure, verifyFirebaseIdToken } from "./adminAuth.js";
import { getAdminDb, getAdminStorageBucket } from "./firebaseAdmin.js";
import { createSelectionPdf } from "./selectionPdf.js";
import { sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";

export class PipelineError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
type Admin = { uid: string };
type Assets = { readImage: (path: string) => Promise<Buffer>; saveImage: (path: string, encoded: string) => Promise<void>; savePdf: (path: string, item: ProductSelection) => Promise<void> };
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(",")}}`;
  return JSON.stringify(v);
}
export const pipelineFingerprint = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const safeId = (value: unknown) => { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new PipelineError("Identifiant invalide."); return value; };
const safeSelectionId = (value: unknown) => { const id = safeId(value); if (id.length < 8) throw new PipelineError("Identifiant sélection invalide."); return id; };
const safeOperation = (v: unknown) => { if (typeof v !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)) throw new PipelineError("Identifiant d’opération UUID requis."); return v; };
const sourceKey = (item: ProductSelection) => pipelineFingerprint(item.url ? { url: item.url.replace(/\/$/, "").toLowerCase() } : { name: item.name.toLowerCase(), supplier: item.supplier.toLowerCase() });
const actions = ["save", "validateSelection", "prepareProduct", "createCatalog", "validatePublication", "activate", "publishSheet", "unpublishSheet"];
const preservedPublicFields = ["compareAtPrice", "legacyInternalReferences", "texture", "qualitySealEnabled", "experienceDescription", "whyChooseDescription", "advisedProfile"];
function assertRevision(actual: number, expected: number) { if (actual !== expected) throw new PipelineError("Révision modifiée. Rechargez la fiche et préparez une nouvelle confirmation.", 409); }
function readWorkflow(raw: unknown, revision: number, productId: string) { return raw && typeof raw === "object" ? { ...emptyWorkflow(revision, productId), ...raw } as SelectionWorkflow : emptyWorkflow(revision, productId); }
const defaultAssets: Assets = {
  readImage: async (path) => {
    if (!/^selection-images\/[a-zA-Z0-9_-]{8,100}\/[a-f0-9-]{36}\.jpg$/.test(path)) throw new PipelineError("Image de sélection invalide.");
    const [bytes] = await getAdminStorageBucket().file(path).download();
    if (bytes.length > 2000000) throw new PipelineError("Image trop volumineuse.");
    return bytes;
  },
  saveImage: async (path, encoded) => {
    if (encoded.length > 3000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new PipelineError("Image JPEG invalide.");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > 2000000 || bytes[0] !== 255 || bytes[1] !== 216) throw new PipelineError("Image JPEG de 2 Mo maximum requise.");
    try { await (await PDFDocument.create()).embedJpg(bytes); } catch { throw new PipelineError("JPEG illisible."); }
    await getAdminStorageBucket().file(path).save(bytes, { contentType: "image/jpeg", resumable: false });
  },
  savePdf: async (path, item) => {
    const bytes = await createSelectionPdf(item, await defaultAssets.readImage(item.imagePath));
    await getAdminStorageBucket().file(path).save(bytes, { contentType: "application/pdf", resumable: false });
  },
};
function replay(data: FirebaseFirestore.DocumentData | undefined, fingerprint: string, uid: string) {
  if (!data) return null;
  if (data.adminUid !== uid || data.fingerprint !== fingerprint) throw new PipelineError("Cette opération appartient à une autre demande ou un autre administrateur.", 409);
  return { ...data.result, replayed: true } as PipelineResult;
}
export type PipelineResult = { selection: ProductSelection; workflow: SelectionWorkflow; productId: string; replayed: boolean };

export async function readPipelineContext(db: Firestore, id: string, pricing?: { category: "flowers" | "resins"; positioning: "standard" | "premium" }): Promise<PipelineContext> {
  safeSelectionId(id);
  const [selection, workflow] = await Promise.all([db.collection("productSelections").doc(id).get(), db.collection("selectionWorkflows").doc(id).get()]);
  if (!selection.exists) throw new PipelineError("Sélection introuvable.", 404);
  const item = normalizeSelection({ ...selection.data(), id });
  const productId = item.catalogProductId || catalogProductId(id);
  const [product, policy] = await Promise.all([db.collection("products").doc(safeId(productId)).get(), db.collection("selectionPricingPolicies").doc(`${pricing?.category || (item.category === "Fleur" ? "flowers" : item.category === "Résine" ? "resins" : "unknown")}-${pricing?.positioning || item.commercial?.positioning || "standard"}`).get()]);
  let catalogue: PipelineContext["catalogue"] = { available: false, products: [], complete: false };
  try { const result = await db.collection("products").where("isActive", "==", true).limit(200).get(); catalogue = { available: true, products: result.docs.map((d) => plain({ ...d.data(), id: d.id }) as Product), complete: result.size < 200 }; } catch { /* Never substitute the storefront fallback. */ }
  let costs: PipelineContext["costs"] = [];
  if (item.catalogProductId) {
    try { const purchases = await db.collection("supplierPurchases").where("status", "==", "validated").limit(200).get(); costs = supplierCostCandidates(purchases.docs.map((d) => ({ ...d.data(), id: d.id }) as SupplierPurchase), item.catalogProductId, item.economics || []); } catch { /* Missing cost evidence leaves advice unavailable. */ }
  }
  let validatedPolicy = null;
  try { if (policy.exists) validatedPolicy = validatePricingPolicy(policy.data()); } catch { /* Invalid or incomplete policy never gains default values. */ }
  return { workflow: readWorkflow(workflow.data(), item.revision || 0, item.catalogProductId), product: product.exists ? plain({ ...product.data(), id: product.id }) as Product : null, policy: validatedPolicy, catalogue, costs };
}

export async function commitPipeline(db: Firestore, raw: unknown, admin: Admin, overrides: Partial<Assets> = {}): Promise<PipelineResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PipelineError("Opération invalide.");
  const operation = raw as PipelineOperation;
  if (!actions.includes(operation.action) || !Number.isSafeInteger(operation.expectedRevision) || operation.expectedRevision < 0) throw new PipelineError("Action ou révision invalide.");
  const operationId = safeOperation(operation.operationId);
  const id = operation.id ? safeSelectionId(operation.id) : operation.action === "save" ? operationId : safeSelectionId(operation.id);
  const normalizedOperation = plain({ action: operation.action, operationId, id, expectedRevision: operation.expectedRevision, ...(operation.action === "save" ? { selection: normalizeSelection(operation.selection), ...(operation.imageBase64 ? { imageBase64: operation.imageBase64 } : {}) } : {}) });
  const fingerprint = pipelineFingerprint(normalizedOperation);
  const opRef = db.collection("selectionOperations").doc(operationId);
  const prior = replay((await opRef.get()).data(), fingerprint, admin.uid);
  if (prior) return prior;
  const ref = db.collection("productSelections").doc(id);
  const workflowRef = db.collection("selectionWorkflows").doc(id);
  const assets = { ...defaultAssets, ...overrides };
  let newImagePath = "";
  let pdfPath = "";
  let pdfImagePath = "";
  // Storage happens only after an explicit mutation, with a deterministic operation path.
  if ((operation.action === "save" && operation.imageBase64) || operation.action === "publishSheet") {
    const before = await ref.get();
    assertRevision(Number(before.data()?.revision || 0), operation.expectedRevision);
    if (operation.action === "save") {
      const assetHash = fingerprint; const assetId = `${assetHash.slice(0, 8)}-${assetHash.slice(8, 12)}-${assetHash.slice(12, 16)}-${assetHash.slice(16, 20)}-${assetHash.slice(20, 32)}`;
      newImagePath = `selection-images/${id}/${assetId}.jpg`;
      await assets.saveImage(newImagePath, operation.imageBase64!);
    } else {
      if (!before.exists) throw new PipelineError("Sélection introuvable.", 404);
      const item = normalizeSelection({ ...before.data(), id });
      const missing = publicationMissing(item);
      if (missing.length) throw new PipelineError(`Fiche publique à compléter : ${missing.join(", ")}.`);
      const slug = selectionSlug(selectionPublicName(item));
      if (!slug || productSheets.some((s) => s.slug === slug)) throw new PipelineError("Nom de fiche publique déjà réservé.", 409);
      if (item.publishedSlug && item.publishedSlug !== slug) throw new PipelineError("Dépubliez l’ancienne fiche avant de changer son nom.", 409);
      const assetHash = fingerprint; const assetId = `${assetHash.slice(0, 8)}-${assetHash.slice(8, 12)}-${assetHash.slice(12, 16)}-${assetHash.slice(16, 20)}-${assetHash.slice(20, 32)}`;
      pdfPath = `selection-sheets/${slug}/${assetId}.pdf`;
      pdfImagePath = item.imagePath;
      await assets.savePdf(pdfPath, item);
    }
  }
  return db.runTransaction(async (tx) => {
    const [savedOperation, snap, workflowSnap] = await tx.getAll(opRef, ref, workflowRef);
    const replayed = replay(savedOperation.data(), fingerprint, admin.uid);
    if (replayed) return replayed;
    let item = normalizeSelection({ ...(snap.data() || {}), id });
    let w = readWorkflow(workflowSnap.data(), item.revision || 0, item.catalogProductId);
    assertRevision(w.revision, operation.expectedRevision);
    if (!snap.exists && operation.action !== "save") throw new PipelineError("Sélection introuvable.", 404);
    const now = new Date().toISOString();
    const productId = item.catalogProductId || catalogProductId(id);
    const productRef = db.collection("products").doc(safeId(productId));
    const productSnap = await tx.get(productRef);
    const current = productSnap.data();
    if (current?.productionFixture) throw new PipelineError("Produit protégé.", 409);
    if (operation.action === "save") {
      const input = normalizeSelection(operation.selection);
      if (!input.name) throw new PipelineError("Nom du produit requis.");
      if (snap.exists && input.updatedAt !== item.updatedAt) throw new PipelineError("Fiche modifiée ailleurs. Rechargez avant d’enregistrer.", 409);
      if (item.catalogProductId && item.catalogProductId !== input.catalogProductId) throw new PipelineError("Conservez le produit déjà lié.", 409);
      const linkedRef = input.catalogProductId ? db.collection("products").doc(safeId(input.catalogProductId)) : null;
      const linked = linkedRef ? linkedRef.id === productRef.id ? productSnap : await tx.get(linkedRef) : null;
      if (linked && (!linked.exists || linked.data()?.productionFixture || (linked.data()?.sourceSelectionId && linked.data()?.sourceSelectionId !== id))) throw new PipelineError("Produit lié absent, protégé ou réservé par une autre sélection.", 409);
      const keyRef = db.collection("selectionSources").doc(sourceKey(input));
      const keySnap = await tx.get(keyRef);
      if (keySnap.exists && keySnap.data()?.selectionId !== id) throw new PipelineError("Cette source possède déjà une sélection. Ouvrez la fiche existante.", 409);
      const previousKey = snap.exists ? sourceKey(item) : null;
      const previousKeyRef = previousKey && previousKey !== keyRef.id ? db.collection("selectionSources").doc(previousKey) : null;
      const previousKeySnap = previousKeyRef ? await tx.get(previousKeyRef) : null;
      if (!snap.exists) {
        const legacySelections = await tx.get(db.collection("productSelections").limit(500));
        if (legacySelections.size === 500) throw new PipelineError("Catalogue trop grand pour vérifier les doublons : utilisez une sélection existante.");
        if (legacySelections.docs.some((d) => sourceKey(normalizeSelection(d.data())) === sourceKey(input))) throw new PipelineError("Cette source possède déjà une ancienne sélection.", 409);
      }
      const oldPublicRef = item.publishedSlug ? db.collection("productSelectionSheets").doc(item.publishedSlug) : null;
      const oldPublic = oldPublicRef ? await tx.get(oldPublicRef) : null;
      if (oldPublic?.exists && oldPublic.data()?.selectionId !== id) throw new PipelineError("Fiche publique liée incohérente.", 409);
      const priorImagePath = item.imagePath;
      item = { ...input, id, revision: w.revision + 1, imagePath: newImagePath || item.imagePath, importedAt: item.importedAt || now, updatedAt: now, publishedSlug: item.publishedSlug, publishedAt: item.publishedAt };
      w = invalidateWorkflow(w, item.revision!); w.productId = item.catalogProductId;
      if (item.status !== "En boutique" && oldPublicRef) { tx.delete(oldPublicRef); item.publishedSlug = ""; item.publishedAt = ""; }
      if (item.status !== "En boutique" && current?.sourceSelectionId === id && current.isActive === true) tx.update(productRef, { isActive: false, updatedAt: FieldValue.serverTimestamp() });
      if (current?.sourceSelectionId === id && !current.selectionImagePath && priorImagePath) tx.update(productRef, { selectionImagePath: priorImagePath });
      if (previousKeyRef && previousKeySnap?.data()?.selectionId === id) tx.delete(previousKeyRef);
      tx.set(keyRef, { selectionId: id });
    } else if (operation.action === "validateSelection") {
      const missing = selectionValidationMissing(item);
      if (missing.length) throw new PipelineError(`Sélection à compléter : ${missing.join(", ")}.`);
      w.selectionValidatedRevision = w.revision; w.stale = false;
    } else if (operation.action === "prepareProduct") {
      if (w.selectionValidatedRevision !== w.revision) throw new PipelineError("Validez d’abord la sélection courante.", 409);
      let draft: Product;
      try { draft = preparePipelineProduct(item); } catch (error) { throw new PipelineError(error instanceof Error ? error.message : "Brouillon incomplet."); }
      // Existing format definitions remain authoritative unless the admin explicitly supplied new formats.
      if (current && !item.economics?.some((r) => r.finalPrice !== null) && !item.commercial?.fixedPriceOptions.length) { const formats = normalizeCommercial({ fixedPriceMode: current.fixedPriceMode, fixedPriceOptions: current.fixedPriceOptions }); draft.fixedPriceMode = formats.fixedPriceMode; draft.fixedPriceOptions = formats.fixedPriceOptions; }
      if (current) {
        for (const key of preservedPublicFields) if (current[key] !== undefined) Object.assign(draft, { [key]: current[key] });
        if (item.commercial?.positioning === "premium" && current.productTier === "Ultra premium") draft.productTier = "Ultra premium";
        draft.id = productId; draft.slug = current.slug || draft.slug; draft.isFeatured = current.isFeatured === true;
        const urls = new Set([draft.image]);
        const imageIds = new Set(draft.images!.map((image) => image.id));
        const gallery = normalizeProductImages({ id: productId, name: current.name || draft.name, image: current.image || "", imageAlt: current.imageAlt, images: current.images });
        // Keep secondary views when a full gallery receives a new primary image.
        // The replaced primary remains in the private publication snapshot; no file is deleted.
        gallery.sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary));
        for (const image of gallery) {
          if (urls.has(image.url) || draft.images!.length >= PRODUCT_IMAGE_MAX_COUNT) continue;
          let imageId = String(image.id || `existing-${urls.size}`); while (imageIds.has(imageId)) imageId = `existing-${imageId}`; imageIds.add(imageId);
          urls.add(image.url); draft.images!.push({ id: imageId, url: image.url, alt: String(image.alt || draft.name), sortOrder: draft.images!.length, isPrimary: false, ...(typeof image.storagePath === "string" ? { storagePath: image.storagePath } : {}) });
        }
      }
      try { validatePipelineProductFormats(draft); } catch (error) { throw new PipelineError(error instanceof Error ? error.message : "Formats invalides."); }
      await assets.readImage(item.imagePath);
      w.draft = plain(draft); w.productPreparedRevision = w.revision; w.catalogReadyRevision = null; w.publishReadyRevision = null; w.publishedRevision = null;
    } else if (operation.action === "createCatalog") {
      if (w.productPreparedRevision !== w.revision || !w.draft) throw new PipelineError("Préparez le brouillon produit courant.", 409);
      const matchingSlugs = await tx.get(db.collection("products").where("slug", "==", w.draft.slug).limit(2));
      if (matchingSlugs.docs.some((d) => d.id !== productId)) throw new PipelineError("Adresse produit déjà utilisée.", 409);
      if (current?.sourceSelectionId && current.sourceSelectionId !== id) throw new PipelineError("Produit réservé par une autre sélection.", 409);
      let internalReference = String(current?.internalReference || "");
      if (internalReference && !isProductInternalReference(internalReference) && !isLegacyProductInternalReference(internalReference)) throw new PipelineError("Référence historique invalide : vérifiez le produit dans Admin → Produits.", 409);
      const referenceRef = internalReference ? db.collection("productReferences").doc(internalReference) : null;
      const reserved = referenceRef ? await tx.get(referenceRef) : null;
      if (reserved?.exists && reserved.data()?.productId !== productId) throw new PipelineError("Référence réservée par un autre produit.", 409);
      if (!internalReference) internalReference = await reserveProductInternalReference({ db, transaction: tx, productId, category: w.draft.category });
      else if (!reserved?.exists && referenceRef) tx.create(referenceRef, { reference: internalReference, productId, createdAt: FieldValue.serverTimestamp() });
      if (!current) tx.create(productRef, { ...w.draft, id: productId, sourceSelectionId: id, internalReference, isActive: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      else tx.update(productRef, { sourceSelectionId: id, internalReference });
      item.catalogProductId = productId; w.productId = productId; w.catalogReadyRevision = w.revision; w.publishReadyRevision = null; w.publishedRevision = null;
    } else if (operation.action === "validatePublication" || operation.action === "activate") {
      if (w.catalogReadyRevision !== w.revision || !w.draft || !current) throw new PipelineError("Préparez le catalogue pour la révision courante.", 409);
      if (current.sourceSelectionId !== id || item.catalogProductId !== productId || w.productId !== productId) throw new PipelineError("Liaison produit/sélection incohérente.", 409);
      if (!Number.isSafeInteger(current.stock) || current.stock < 1 || current.stock > 100000) throw new PipelineError("Stock disponible requis ; utilisez la gestion Stock Phase 2.");
      if (!current.internalReference) throw new PipelineError("Référence produit requise.");
      const reference = await tx.get(db.collection("productReferences").doc(String(current.internalReference)));
      if (!reference.exists || reference.data()?.productId !== productId) throw new PipelineError("Réservation de référence incohérente.", 409);
      const matchingSlugs = await tx.get(db.collection("products").where("slug", "==", w.draft.slug).limit(2));
      if (matchingSlugs.docs.some((d) => d.id !== productId)) throw new PipelineError("Adresse produit déjà utilisée.", 409);
      try { preparePipelineProduct(item); validatePipelineProductFormats(w.draft); } catch (error) { throw new PipelineError(error instanceof Error ? error.message : "Données produit invalides."); }
      await assets.readImage(item.imagePath);
      const currentFingerprint = pipelineFingerprint(plain(current));
      if (operation.action === "validatePublication") { w.publishReadyRevision = w.revision; w.productFingerprint = currentFingerprint; }
      else {
        if (w.publishReadyRevision !== w.revision || w.productFingerprint !== currentFingerprint) throw new PipelineError("Publication obsolète ou produit modifié. Revalidez le récapitulatif.", 409);
        const { stock: _stock, lowStockThreshold: _threshold, ...commercial } = w.draft;
        void _stock; void _threshold;
        // Explicit publication replaces the commercial projection with a whitelist.
        // Preserve a private snapshot before stripping unknown historical fields.
        w.legacyProductSnapshot = plain(current);
        const retainedKeys = new Set([...Object.keys(commercial), "stock", "lowStockThreshold", "createdAt", "updatedAt", "internalReference", "sourceSelectionId"]);
        const removedFields = Object.keys(current).filter((key) => !retainedKeys.has(key));
        tx.update(productRef, { ...plain(commercial), sourceSelectionId: id, internalReference: current.internalReference, isActive: true, updatedAt: FieldValue.serverTimestamp() });
        for (const key of removedFields) tx.update(productRef, new FieldPath(key), FieldValue.delete());
        w.publishedRevision = w.revision; item.status = "En boutique"; item.updatedAt = now;
      }
    } else if (operation.action === "publishSheet") {
      const missing = publicationMissing(item);
      if (missing.length) throw new PipelineError(`Fiche publique à compléter : ${missing.join(", ")}.`);
      const slug = selectionSlug(selectionPublicName(item));
      const publicRef = db.collection("productSelectionSheets").doc(slug);
      const existing = await tx.get(publicRef);
      if (existing.exists && existing.data()?.selectionId !== id) throw new PipelineError("Fiche réservée par une autre sélection.", 409);
      if (!pdfPath || item.imagePath !== pdfImagePath) throw new PipelineError("Image modifiée pendant la préparation du PDF.", 409);
      tx.set(publicRef, publicSelectionEntry(item, slug, pdfPath, now)); item.publishedAt = now; item.publishedSlug = slug;
    } else if (operation.action === "unpublishSheet") {
      if (item.publishedSlug) { const publicRef = db.collection("productSelectionSheets").doc(item.publishedSlug); const publicSnap = await tx.get(publicRef); if (publicSnap.exists && publicSnap.data()?.selectionId !== id) throw new PipelineError("Fiche incohérente.", 409); tx.delete(publicRef); }
      item.publishedAt = ""; item.publishedSlug = "";
    }
    const result: PipelineResult = plain({ selection: item, workflow: w, productId: item.catalogProductId, replayed: false });
    tx.set(ref, { ...plain(item), updatedBy: admin.uid });
    tx.set(workflowRef, plain(w));
    tx.create(opRef, { adminUid: admin.uid, action: operation.action, selectionId: id, fingerprint, revision: w.revision, createdAt: FieldValue.serverTimestamp(), result });
    return result;
  });
}

export function createPipelineHandler(dependencies: { getDb?: () => Firestore; verifyToken?: typeof verifyFirebaseIdToken; assets?: Partial<Assets> } = {}) {
  return async (request: VercelRequestLike, response: VercelResponseLike) => {
    response.setHeader("Cache-Control", "private, no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "POST"].includes(request.method || "")) return sendJson(response, { error: "Méthode non autorisée." }, 405);
    try {
      const token = /^Bearer (.+)$/i.exec(request.headers.authorization || "")?.[1];
      if (!token) return sendJson(response, { error: "Connexion administrateur requise." }, 401);
      const db = (dependencies.getDb || getAdminDb)();
      const admin = await assertAdminUser(db, token, dependencies.verifyToken);
      if (request.method === "GET") {
        const q = new URL(request.url || "/", "https://verdanza.local").searchParams;
        const category = q.get("pricingCategory"); const positioning = q.get("positioning");
        if ((category && category !== "flowers" && category !== "resins") || (positioning && positioning !== "standard" && positioning !== "premium")) throw new PipelineError("Catégorie ou positionnement invalide.");
        const pricing = category && positioning ? { category: category as "flowers" | "resins", positioning: positioning as "standard" | "premium" } : undefined;
        return sendJson(response, await readPipelineContext(db, safeId(q.get("id")), pricing));
      }
      const body = (typeof request.body === "string" ? JSON.parse(request.body) : request.body) as Record<string, unknown>;
      if (body?.action === "pipelinePolicy") {
        const policy = validatePricingPolicy(body.policy); const operationId = safeOperation(body.operationId);
        const fingerprint = pipelineFingerprint({ policy, expectedPolicy: body.expectedPolicy || null });
        const opRef = db.collection("selectionOperations").doc(operationId); const ref = db.collection("selectionPricingPolicies").doc(`${policy.category}-${policy.positioning}`);
        await db.runTransaction(async (tx) => {
          const [op, snapshot] = await tx.getAll(opRef, ref);
          if (op.exists) { if (op.data()?.fingerprint !== fingerprint || op.data()?.adminUid !== admin.uid) throw new PipelineError("Opération incompatible.", 409); return; }
          if (pipelineFingerprint(snapshot.data()?.policy || (snapshot.exists ? validatePricingPolicy(snapshot.data()) : null)) !== pipelineFingerprint(body.expectedPolicy || null)) throw new PipelineError("Politique modifiée ailleurs. Rechargez avant confirmation.", 409);
          tx.set(ref, { ...policy, updatedBy: admin.uid, updatedAt: FieldValue.serverTimestamp() }); tx.create(opRef, { adminUid: admin.uid, fingerprint, action: "policy", createdAt: FieldValue.serverTimestamp() });
        });
        return sendJson(response, { policy });
      }
      return sendJson(response, await commitPipeline(db, body?.operation, admin, dependencies.assets));
    } catch (error) {
      const auth = firebaseAuthHttpFailure(error);
      const inputError = error instanceof SyntaxError || (error instanceof Error && /^Politique de prix|Produit invalide|Lien fournisseur|Lien image/.test(error.message));
      const status = auth?.status || (error instanceof PipelineError ? error.status : error instanceof Error && error.message === "Acces admin requis." ? 403 : inputError ? 400 : 500);
      if (status === 500) console.error("selection_pipeline_failed", error);
      sendJson(response, { error: auth ? "Authentification administrateur indisponible ou invalide." : status === 500 ? "Opération indisponible." : error instanceof Error ? error.message : "Opération invalide." }, status);
    }
  };
}
export const handlePipeline = createPipelineHandler();

export async function commitSelectionImport(db: Firestore, rows: unknown, operationId: string, admin: Admin) {
  safeOperation(operationId);
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new PipelineError("Import de 1 à 100 sélections requis.");
  const selections = rows.map(normalizeSelection); const fingerprint = pipelineFingerprint(selections);
  const opRef = db.collection("selectionOperations").doc(operationId);
  return db.runTransaction(async (tx) => {
    const op = await tx.get(opRef);
    if (op.exists) { if (op.data()?.adminUid !== admin.uid || op.data()?.fingerprint !== fingerprint) throw new PipelineError("Import incompatible.", 409); return op.data()!.result as { imported: number; skipped: number }; }
    const existing = await tx.get(db.collection("productSelections").limit(500));
    if (existing.size === 500) throw new PipelineError("Catalogue trop grand pour cet import borné.");
    const seen = new Set(existing.docs.map((d) => sourceKey(normalizeSelection(d.data()))));
    const refs = selections.map((s) => db.collection("selectionSources").doc(sourceKey(s)));
    const sources = await tx.getAll(...refs);
    const result = { imported: 0, skipped: 0 }; const now = new Date().toISOString();
    for (const [index, input] of selections.entries()) {
      const key = sourceKey(input);
      if (!input.name || seen.has(key) || sources[index].exists) { result.skipped++; continue; }
      seen.add(key);
      const hash = pipelineFingerprint({ operationId, index }); const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
      const item = plain({ ...input, id, revision: 1, imagePath: "", publishedAt: "", publishedSlug: "", catalogProductId: "", importedAt: input.importedAt || now, updatedAt: now });
      tx.create(db.collection("productSelections").doc(id), { ...item, updatedBy: admin.uid });
      tx.create(db.collection("selectionWorkflows").doc(id), emptyWorkflow(1));
      tx.set(refs[index], { selectionId: id }); result.imported++;
    }
    tx.create(opRef, { adminUid: admin.uid, fingerprint, result, action: "import", createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}
