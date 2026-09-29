import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { StockAdjustment, StockDetail, StockOperationResult, StockOperationStatus, StockSnapshot } from "../types/adminStock";

export class AdminStockApiError extends Error {
  constructor(message: string, readonly code: string, readonly uncertain = false, readonly current?: StockSnapshot) { super(message); }
}
const quantity = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const readableResult = (result: StockOperationResult | undefined, id: string) => Boolean(result && result.status === "applied" && result.operationId === id &&
  typeof result.productId === "string" && typeof result.adminUid === "string" && quantity(result.beforeStock) && quantity(result.afterStock) &&
  quantity(result.beforeLowStockThreshold) && quantity(result.afterLowStockThreshold) && result.delta === result.afterStock - result.beforeStock);
export function createAdminStockClient(deps: { token: () => Promise<string | null | undefined>; fetch: typeof fetch }) {
  async function request<T>(url: string, operation?: StockAdjustment): Promise<T> {
    const token = await deps.token();
    if (!token) throw new AdminStockApiError("Session admin requise.", "authentication_required");
    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: operation ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(15000),
        headers: { authorization: `Bearer ${token}`, ...(operation ? { "content-type": "application/json" } : {}) },
        ...(operation ? { body: JSON.stringify({ action: "adminStockOperation", operation }) } : {}),
      });
    } catch { throw new AdminStockApiError("La réponse n’a pas été reçue. Vérifiez l’opération avant toute nouvelle correction.", "response_lost", true); }
    let payload: Record<string, unknown>;
    try { payload = await response.json(); }
    catch { throw new AdminStockApiError("Réponse illisible : vérification nécessaire.", "response_lost", true); }
    if (!response.ok) {
      throw new AdminStockApiError(String(payload.error || "Opération stock impossible."), String(payload.code || "unknown_error"), response.status >= 500 || !payload.code, payload.current as StockSnapshot | undefined);
    }
    if (!payload || typeof payload !== "object") throw new AdminStockApiError("Réponse illisible : vérification nécessaire.", "response_lost", true);
    return payload as T;
  }
  return {
    read: async (productId: string) => {
      const detail = await request<StockDetail>(`/api/invoices?action=adminStockRead&productId=${encodeURIComponent(productId)}`);
      if (detail.product?.productId !== productId || !quantity(detail.product.stock) || !quantity(detail.product.lowStockThreshold) || !Array.isArray(detail.movements)) {
        throw new AdminStockApiError("Valeurs serveur illisibles. Rechargez la fiche avant de corriger le stock.", "invalid_response", true);
      }
      return detail;
    },
    status: async (operationId: string) => {
      const status = await request<StockOperationStatus>(`/api/invoices?action=adminStockStatus&operationId=${encodeURIComponent(operationId)}`);
      if (status.status !== "not_executed" && (status.status !== "applied" || !readableResult(status.result, operationId))) {
        throw new AdminStockApiError("Résultat de vérification illisible.", "response_lost", true);
      }
      return status;
    },
    adjust: async (operation: StockAdjustment) => {
      const payload = await request<{ result: StockOperationResult }>("/api/invoices", operation);
      if (!readableResult(payload.result, operation.operationId) || payload.result.productId !== operation.productId) {
        throw new AdminStockApiError("Résultat incomplet : vérification nécessaire.", "response_lost", true);
      }
      return payload.result;
    },
  };
}
const client = createAdminStockClient({ token: getFirebaseIdToken, fetch: (...args) => fetch(...args) });
export const readAdminStockDetail = client.read;
export const getAdminStockOperation = client.status;
export const adjustAdminStock = client.adjust;

type PendingStockOperation = { ownerUid: string; operation: StockAdjustment; productName: string };
const journalKey = (uid: string) => `verdanza:admin-stock-pending:v1:${uid}`;
export function pendingStockOperations(uid: string): PendingStockOperation[] {
  if (!uid) return [];
  const raw = localStorage.getItem(journalKey(uid));
  if (!raw) return [];
  const entries: PendingStockOperation[] = JSON.parse(raw);
  if (!Array.isArray(entries) || entries.some((entry) => entry.ownerUid !== uid || !entry.operation?.operationId || !entry.operation.productId)) {
    throw new Error("Journal stock illisible. Ne lancez pas de nouvelle correction avant vérification.");
  }
  return entries;
}
export function rememberStockOperation(uid: string, operation: StockAdjustment, productName: string) {
  if (!uid) throw new Error("Session admin requise ; aucune correction envoyée.");
  const entries = pendingStockOperations(uid);
  const existing = entries.find((entry) => entry.operation.productId === operation.productId);
  if (existing && existing.operation.operationId !== operation.operationId) throw new Error("Une opération doit encore être vérifiée pour ce produit.");
  const next = [...entries.filter((entry) => entry.operation.operationId !== operation.operationId), { ownerUid: uid, operation, productName }];
  localStorage.setItem(journalKey(uid), JSON.stringify(next));
  if (!pendingStockOperations(uid).some((entry) => entry.operation.operationId === operation.operationId)) throw new Error("Impossible de conserver l’identifiant d’opération ; aucune correction envoyée.");
}
export function forgetStockOperation(uid: string, operationId: string) {
  const entries = pendingStockOperations(uid).filter((entry) => entry.operation.operationId !== operationId);
  if (entries.length) localStorage.setItem(journalKey(uid), JSON.stringify(entries));
  else localStorage.removeItem(journalKey(uid));
}
