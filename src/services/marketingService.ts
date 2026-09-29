import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { MarketingAudit, MarketingContext, MarketingDraft, MarketingOperation, MarketingResult } from "../types/marketing";

export class MarketingApiError extends Error {
  constructor(message: string, readonly code: string, readonly uncertain = false) { super(message); }
}
const endpoint = "/api/admin-contests?action=marketing";
export function createMarketingClient(dependencies: { token: typeof getFirebaseIdToken; fetch: typeof fetch }) {
  async function request<T>(url: string, operation?: MarketingOperation): Promise<T> {
    const token = await dependencies.token();
    if (!token) throw new MarketingApiError("Session admin requise.", "authentication_required");
    let response: Response;
    try {
      response = await dependencies.fetch(url, { method: operation ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(20000),
        headers: { authorization: `Bearer ${token}`, ...(operation ? { "content-type": "application/json" } : {}) },
        ...(operation ? { body: JSON.stringify({ operation }) } : {}) });
    } catch { throw new MarketingApiError("Résultat incertain : rejouez l'opération conservée avant toute nouvelle action.", "response_lost", Boolean(operation)); }
    let payload: Record<string, unknown>;
    try { payload = await response.json(); }
    catch { throw new MarketingApiError("Réponse illisible : rechargez ou rejouez l'opération conservée.", "invalid_response", Boolean(operation)); }
    if (!payload || typeof payload !== "object") throw new MarketingApiError("Réponse serveur invalide.", "invalid_response", Boolean(operation));
    if (!response.ok) throw new MarketingApiError(String(payload.error || "Action Marketing impossible."), String(payload.code || "unknown_error"), Boolean(operation && (response.status >= 500 || !payload.code)));
    return payload as T;
  }
  return {
    context: async () => {
      const result = await request<MarketingContext>(endpoint);
      if (![result.drafts, result.coupons, result.banners, result.contests, result.products].every(Array.isArray) || !result.fingerprints) throw new MarketingApiError("Le Marketing est indisponible. Aucun état vide supposé.", "invalid_response");
      return result;
    },
    detail: (draftId: string) => request<{ draft: MarketingDraft; audits: MarketingAudit[] }>(`${endpoint}&draftId=${encodeURIComponent(draftId)}`),
    execute: async (operation: MarketingOperation) => {
      const result = await request<MarketingResult>(endpoint, operation);
      if (result.operationId !== operation.operationId || result.draft?.id !== operation.draftId || !Number.isInteger(result.draft.revision) || typeof result.replayed !== "boolean") throw new MarketingApiError("Résultat incomplet : rejouez l'opération conservée.", "invalid_response", true);
      return result;
    },
  };
}
const client = createMarketingClient({ token: getFirebaseIdToken, fetch: (...args) => fetch(...args) });
export const getMarketingContext = client.context;
export const getMarketingDraftDetail = client.detail;
export const executeMarketing = client.execute;

const journalKey = (uid: string) => `verdanza:marketing-pending:v1:${uid}`;
export function pendingMarketingOperation(uid: string): MarketingOperation | null {
  if (!uid) return null;
  const text = localStorage.getItem(journalKey(uid));
  if (!text) return null;
  try {
    const entry = JSON.parse(text);
    if (entry.ownerUid !== uid || !entry.operation?.operationId || !entry.operation?.draftId || !entry.operation?.action || !Number.isInteger(entry.operation.expectedRevision)) throw new Error();
    return entry.operation as MarketingOperation;
  } catch { throw new Error("Journal Marketing illisible : aucune nouvelle action possible avant vérification."); }
}
export function rememberMarketingOperation(uid: string, operation: MarketingOperation) {
  if (!uid) throw new Error("Session admin requise ; aucune opération envoyée.");
  const old = pendingMarketingOperation(uid);
  if (old && JSON.stringify(old) !== JSON.stringify(operation)) throw new Error("Une opération Marketing doit encore être vérifiée.");
  localStorage.setItem(journalKey(uid), JSON.stringify({ ownerUid: uid, operation }));
  if (!pendingMarketingOperation(uid)) throw new Error("Identifiant non conservé : aucune opération envoyée.");
}
export function forgetMarketingOperation(uid: string, operationId: string) {
  if (pendingMarketingOperation(uid)?.operationId === operationId) localStorage.removeItem(journalKey(uid));
}
