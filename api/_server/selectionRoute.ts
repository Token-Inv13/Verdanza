import { assertAdminUser, firebaseAuthHttpFailure } from "./adminAuth.js";
import { getAdminDb, getAdminStorageBucket } from "./firebaseAdmin.js";
import { sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import { createSelectionPdf } from "./selectionPdf.js";
import { publicSelectionView, type PublishedSelectionSheet } from "../../src/lib/selectionPublication.js";
import { handlePipeline, commitSelectionImport, PipelineError } from "./selectionPipeline.js";
import { extractSupplierPage, SupplierExtractionError } from "./supplierExtraction.js";
export { parseSupplierHtml } from "./supplierExtraction.js";
import {
  normalizeSelection, selectionPublicName, selectionSlug,
  type ProductSelection,
} from "../../src/types/selection.js";

const PRIVATE_COLLECTION = "productSelections";
const PUBLIC_COLLECTION = "productSelectionSheets";

export async function handleSelection(request: VercelRequestLike, response: VercelResponseLike) {
  const query = new URL(request.url || "/", "https://verdanza.local").searchParams;
  const action = query.get("action") || "";
  if (!request.method || !["GET", "POST"].includes(request.method)) {
    sendJson(response, { error: "Méthode non autorisée." }, 405);
    return;
  }
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const posted = request.method === "POST" ? parseBody(request.body) : null;
    if (action === "pipeline" || posted?.action === "pipeline" || posted?.action === "pipelinePolicy") return handlePipeline(request, response);
    if (request.method === "GET" && action === "library") {
      await sendPublicLibrary(response);
      return;
    }
    if (request.method === "GET" && action === "asset") {
      await sendPublicAsset(response, query.get("slug") || "", query.get("kind") || "");
      return;
    }
    if (request.method === "GET" && action === "catalogImage") {
      const id = safeId(query.get("id"));
      const selection = await getAdminDb().collection(PRIVATE_COLLECTION).doc(id).get();
      if (!selection.exists) throw new SelectionError("Image introuvable.", 404);
      const item = normalizeSelection({ ...selection.data(), id });
      if (item.status !== "En boutique" || !item.catalogProductId || !item.imagePath) {
        throw new SelectionError("Image introuvable.", 404);
      }
      const product = await getAdminDb().collection("products").doc(item.catalogProductId).get();
      if (!product.exists || product.data()?.sourceSelectionId !== id || product.data()?.isActive !== true) {
        throw new SelectionError("Image introuvable.", 404);
      }
      response.setHeader("Content-Type", "image/jpeg");
      response.setHeader("Cache-Control", "public, max-age=300");
      const productImagePath = product.data()?.selectionImagePath || (product.data()?.image === `/api/selection?action=catalogImage&id=${encodeURIComponent(id)}` ? item.imagePath : "");
      if (!productImagePath) throw new SelectionError("Image introuvable.", 404);
      response.end(await readImage(String(productImagePath)));
      return;
    }
    const token = bearerToken(request);
    if (!token) {
      sendJson(response, { error: "Connexion administrateur requise." }, 401);
      return;
    }
    const db = getAdminDb();
    const admin = await assertAdminUser(db, token);
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET") {
      if (action === "adminImage") {
        const id = safeId(query.get("id"));
        const snapshot = await db.collection(PRIVATE_COLLECTION).doc(id).get();
        if (!snapshot.exists) throw new SelectionError("Sélection introuvable.", 404);
        const item = normalizeSelection({ ...snapshot.data(), id });
        if (!item.imagePath) throw new SelectionError("Image indisponible.", 404);
        response.setHeader("Content-Type", "image/jpeg");
        response.end(await readImage(item.imagePath));
        return;
      }
      if (action === "preview") {
        const id = safeId(query.get("id"));
        const snapshot = await db.collection(PRIVATE_COLLECTION).doc(id).get();
        if (!snapshot.exists) throw new SelectionError("Sélection introuvable.", 404);
        const item = normalizeSelection({ ...snapshot.data(), id });
        if (!item.imagePath) throw new SelectionError("Ajoutez une image avant de créer le PDF.");
        const image = await readImage(item.imagePath);
        const pdf = await makePdf(item, image);
        response.setHeader("Content-Type", "application/pdf");
        response.setHeader("Content-Disposition", `inline; filename="verdanza-${selectionSlug(selectionPublicName(item))}.pdf"`);
        response.end(pdf);
        return;
      }
      const snapshot = await db.collection(PRIVATE_COLLECTION).limit(500).get();
      const selections = snapshot.docs.map((doc) => normalizeSelection({ ...doc.data(), id: doc.id }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      sendJson(response, { selections });
      return;
    }
    const body = parseBody(request.body);
    const postAction = String(body.action || "");
    if (postAction === "import") {
      const result = await commitSelectionImport(db, body.selections, String(body.operationId || ""), admin);
      sendJson(response, result); return;
    }
    if (postAction === "extract") {
      sendJson(response, { selection: await extractSupplierPage(String(body.url || "")) }); return;
    }
    if (["save", "uploadImage", "publishCatalog", "publish", "unpublish"].includes(postAction)) throw new SelectionError("Action remplacée par le pipeline confirmé. Rechargez l’administration.", 409);
    throw new SelectionError("Action inconnue.", 400);
  } catch (error) {
    const authFailure = firebaseAuthHttpFailure(error);
    if (authFailure) return sendJson(response, {
      code: authFailure.code,
      error: authFailure.status === 401 ? "Token admin invalide." : "Authentification indisponible.",
    }, authFailure.status);
    const status = error instanceof SelectionError || error instanceof PipelineError ? error.status : error instanceof SupplierExtractionError ? 400 : 500;
    if (status === 500) console.error("selection_api_failed", error);
    sendJson(response, { error: error instanceof SelectionError || error instanceof PipelineError || error instanceof SupplierExtractionError ? error.message : "Opération indisponible." }, status);
  }
}

class SelectionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function bearerToken(request: VercelRequestLike) {
  const value = request.headers.authorization || "";
  return /^Bearer .+/i.test(value) ? value.slice(7).trim() : "";
}

function parseBody(value: unknown): Record<string, unknown> {
  const body = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SelectionError("Requête invalide.");
  return body as Record<string, unknown>;
}

function safeId(value: unknown) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new SelectionError("Identifiant invalide.");
  return id;
}

async function readImage(path: string) {
  if (!/^selection-images\/[a-zA-Z0-9_-]{8,100}\/[a-f0-9-]{36}\.jpg$/.test(path)) {
    throw new SelectionError("Image de sélection invalide.");
  }
  const [bytes] = await getAdminStorageBucket().file(path).download();
  if (bytes.length > 2_000_000) throw new SelectionError("Image trop volumineuse.");
  return bytes;
}

async function makePdf(item: ProductSelection, image: Buffer) {
  try { return await createSelectionPdf(item, image); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("Texte trop long pour le PDF")) {
      throw new SelectionError(`${error.message}. Raccourcissez ce champ avant publication.`);
    }
    throw error;
  }
}

async function sendPublicLibrary(response: VercelResponseLike) {
  const snapshot = await getAdminDb().collection(PUBLIC_COLLECTION).where("published", "==", true).limit(200).get();
  const sheets = snapshot.docs.map((doc) => publicSelectionView({ ...doc.data(), slug: doc.id } as PublishedSelectionSheet));
  response.setHeader("Cache-Control", "no-store");
  sendJson(response, { sheets });
}

async function sendPublicAsset(response: VercelResponseLike, slug: string, kind: string) {
  if (!/^[a-z0-9-]{1,60}$/.test(slug) || !["pdf", "image"].includes(kind)) {
    throw new SelectionError("Fiche introuvable.", 404);
  }
  const snapshot = await getAdminDb().collection(PUBLIC_COLLECTION).doc(slug).get();
  if (!snapshot.exists || snapshot.data()?.published !== true) throw new SelectionError("Fiche introuvable.", 404);
  const path = String(snapshot.data()?.[kind === "pdf" ? "pdfPath" : "imagePath"] || "");
  if (kind === "pdf" && !/^selection-sheets\/[a-z0-9-]{1,60}\/[a-f0-9-]{36}\.pdf$/.test(path)) {
    throw new SelectionError("PDF indisponible.", 404);
  }
  if (kind === "image" && !/^selection-images\/[a-zA-Z0-9_-]{8,100}\/[a-f0-9-]{36}\.jpg$/.test(path)) {
    throw new SelectionError("Image indisponible.", 404);
  }
  const [bytes] = await getAdminStorageBucket().file(path).download();
  response.setHeader("Content-Type", kind === "pdf" ? "application/pdf" : "image/jpeg");
  response.setHeader("Cache-Control", "no-store");
  response.end(bytes);
}
