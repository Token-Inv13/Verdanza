import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { assertAdminUser, firebaseAuthHttpFailure, verifyFirebaseIdToken } from "./adminAuth.js";
import { getAdminDb } from "./firebaseAdmin.js";
import { sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import { assertOrdinaryProductAdminMutationAllowed } from "../../src/lib/productionFixtureMarker.js";
import { stockReasons, type StockAdjustment, type StockDetail, type StockOperationResult, type StockSnapshot } from "../../src/types/adminStock.js";

export class AdminStockError extends Error {
  constructor(readonly code: string, message: string, readonly status: number = 400, readonly current?: StockSnapshot) { super(message); }
}
export function stockQuantity(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AdminStockError("invalid_quantity", `${field} doit être un entier positif ou nul.`);
  }
  return value;
}
function productId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,150}$/.test(value)) throw new AdminStockError("invalid_product", "Identifiant produit invalide.");
  return value;
}
function operationId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AdminStockError("invalid_operation", "Identifiant d’opération invalide.");
  }
  return value.toLowerCase();
}
export function parseStockAdjustment(raw: unknown): StockAdjustment {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AdminStockError("invalid_request", "Correction invalide.");
  const input = raw as Record<string, unknown>;
  if (typeof input.reason !== "string" || !Object.hasOwn(stockReasons, input.reason)) throw new AdminStockError("invalid_reason", "Motif requis.");
  if (typeof input.note !== "string" || input.note.trim().length > 1000 || (input.reason === "other" && !input.note.trim())) {
    throw new AdminStockError("invalid_reason", "Une note est obligatoire pour Autre (1 000 caractères maximum).");
  }
  return {
    operationId: operationId(input.operationId), productId: productId(input.productId),
    expectedStock: stockQuantity(input.expectedStock, "Stock attendu"), targetStock: stockQuantity(input.targetStock, "Nouveau stock"),
    expectedLowStockThreshold: stockQuantity(input.expectedLowStockThreshold, "Seuil attendu"), lowStockThreshold: stockQuantity(input.lowStockThreshold, "Seuil"),
    reason: input.reason as StockAdjustment["reason"], note: input.note.trim(),
  };
}
function snapshot(id: string, data: FirebaseFirestore.DocumentData | undefined): StockSnapshot {
  if (!data) throw new AdminStockError("product_missing", "Produit introuvable.", 404);
  try { assertOrdinaryProductAdminMutationAllowed({ ...data, id }); }
  catch { throw new AdminStockError("protected_product", "Ce produit protégé ne peut pas être ajusté.", 403); }
  return {
    productId: id, name: String(data.name || id), internalReference: String(data.internalReference || ""),
    category: data.category, stock: stockQuantity(data.stock, "Stock serveur"),
    lowStockThreshold: stockQuantity(data.lowStockThreshold ?? 5, "Seuil serveur"), isActive: data.isActive === true,
  };
}
const movementId = (id: string) => `admin-stock-${id}`;
function replay(data: FirebaseFirestore.DocumentData, uid: string): StockOperationResult {
  if (data.adminUid !== uid) throw new AdminStockError("operation_owner", "Cette opération appartient à un autre administrateur.", 403);
  if (data.type !== "admin_adjustment" || data.status !== "applied") throw new AdminStockError("operation_unreadable", "Résultat d’opération illisible.", 503);
  return {
    status: "applied", operationId: data.operationId, productId: data.productId, productName: data.productName,
    beforeStock: data.beforeStock, afterStock: data.afterStock, delta: data.delta,
    beforeLowStockThreshold: data.beforeLowStockThreshold, afterLowStockThreshold: data.afterLowStockThreshold,
    reason: data.reason, note: data.operationNote, adminUid: data.adminUid, appliedAt: data.appliedAt, replayed: true,
  };
}

export async function commitAdminStock(db: Firestore, raw: unknown, admin: { uid: string }) {
  const input = parseStockAdjustment(raw);
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const productRef = db.collection("products").doc(input.productId);
  const movementRef = db.collection("stockMovements").doc(movementId(input.operationId));
  const appliedAt = new Date().toISOString();
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(movementRef);
    if (previous.exists) {
      const result = replay(previous.data()!, admin.uid);
      if (previous.data()?.requestFingerprint !== fingerprint) throw new AdminStockError("operation_mismatch", "Cet identifiant a déjà été utilisé pour une autre correction.", 409);
      return result;
    }
    const product = await transaction.get(productRef);
    const current = snapshot(input.productId, product.exists ? product.data() : undefined);
    if (current.stock !== input.expectedStock || current.lowStockThreshold !== input.expectedLowStockThreshold) {
      throw new AdminStockError("stock_conflict", "Le stock ou le seuil a changé depuis l’ouverture de cette fiche.", 409, current);
    }
    if (current.stock === input.targetStock && current.lowStockThreshold === input.lowStockThreshold) {
      throw new AdminStockError("no_change", "Aucune modification à enregistrer.");
    }
    const result: StockOperationResult = {
      status: "applied", operationId: input.operationId, productId: input.productId, productName: current.name,
      beforeStock: current.stock, afterStock: input.targetStock, delta: input.targetStock - current.stock,
      beforeLowStockThreshold: current.lowStockThreshold, afterLowStockThreshold: input.lowStockThreshold,
      reason: input.reason, note: input.note, adminUid: admin.uid, appliedAt, replayed: false,
    };
    transaction.update(productRef, { stock: result.afterStock, lowStockThreshold: input.lowStockThreshold, updatedAt: FieldValue.serverTimestamp() });
    transaction.create(movementRef, {
      ...result, type: "admin_adjustment", quantity: result.delta, note: `${stockReasons[input.reason]}${input.note ? ` — ${input.note}` : ""}`,
      operationNote: input.note, requestFingerprint: fingerprint, createdBy: admin.uid, createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

export async function readAdminStock(db: Firestore, id: unknown): Promise<StockDetail> {
  const key = productId(id);
  const product = await db.collection("products").doc(key).get();
  const current = snapshot(key, product.exists ? product.data() : undefined);
  const history = await db.collection("stockMovements").where("productId", "==", key).orderBy("createdAt", "desc").limit(25).get();
  return { product: current, movements: history.docs.map((entry) => {
    const data = entry.data();
    const createdAt = typeof data.createdAt === "string" ? data.createdAt : data.createdAt?.toDate?.().toISOString() || "";
    return { id: entry.id, type: String(data.type || ""), quantity: Number(data.quantity || 0), note: String(data.note || ""), createdAt,
      createdBy: String(data.createdBy || ""), ...(typeof data.beforeStock === "number" ? { beforeStock: data.beforeStock, afterStock: data.afterStock } : {}),
      ...(data.operationId ? { operationId: data.operationId } : {}) };
  }) };
}

export async function readStockOperation(db: Firestore, id: unknown, uid: string) {
  const operation = await db.collection("stockMovements").doc(movementId(operationId(id))).get();
  return operation.exists ? { status: "applied" as const, result: replay(operation.data()!, uid) } : { status: "not_executed" as const };
}

export function isAdminStockRequest(request: VercelRequestLike) {
  const action = request.method === "GET" ? new URL(request.url || "/", "https://verdanza.local").searchParams.get("action") :
    (request.body as { action?: unknown } | undefined)?.action;
  return typeof action === "string" && ["adminStockRead", "adminStockOperation", "adminStockStatus"].includes(action);
}
export function createAdminStockHandler(deps: { getDb?: () => Firestore; verifyToken?: typeof verifyFirebaseIdToken } = {}) {
  return async (request: VercelRequestLike, response: VercelResponseLike) => {
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "POST"].includes(request.method || "")) { sendJson(response, { code: "invalid_method", error: "Méthode non autorisée." }, 405); return; }
    const token = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) { sendJson(response, { code: "authentication_required", error: "Session admin requise." }, 401); return; }
    try {
      const db = (deps.getDb || getAdminDb)();
      const admin = await assertAdminUser(db, token, deps.verifyToken || verifyFirebaseIdToken);
      const query = new URL(request.url || "/", "https://verdanza.local").searchParams;
      const body = request.body as { action?: string; operation?: unknown } | undefined;
      const action = request.method === "GET" ? query.get("action") : body?.action;
      if (request.method === "POST" && action === "adminStockOperation") sendJson(response, { result: await commitAdminStock(db, body?.operation, admin) });
      else if (request.method === "GET" && action === "adminStockRead") sendJson(response, await readAdminStock(db, query.get("productId")));
      else if (request.method === "GET" && action === "adminStockStatus") sendJson(response, await readStockOperation(db, query.get("operationId"), admin.uid));
      else sendJson(response, { code: "invalid_action", error: "Action stock invalide." }, 400);
    } catch (error) {
      const auth = firebaseAuthHttpFailure(error);
      const stock = error instanceof AdminStockError ? error : null;
      const forbidden = error instanceof Error && error.message === "Acces admin requis.";
      sendJson(response, { code: auth?.code || stock?.code || (forbidden ? "admin_required" : "stock_unavailable"),
        error: stock?.message || (forbidden ? "Accès admin requis." : "Opération stock indisponible."), ...(stock?.current ? { current: stock.current } : {}) },
      auth?.status || stock?.status || (forbidden ? 403 : 503));
    }
  };
}
export const handleAdminStock = createAdminStockHandler();
