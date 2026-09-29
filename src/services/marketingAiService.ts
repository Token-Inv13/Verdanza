import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { MarketingAiGeneration, MarketingAiRequest } from "../types/marketingAi";

export class MarketingAiApiError extends Error {
  constructor(message: string, readonly code: string, readonly uncertain = false) { super(message); }
}
const terminalCodes = new Set(["invalid_brief", "invalid_dates", "brief_personal_data", "ai_not_configured", "ai_context_limit",
  "ai_product_unavailable", "ai_catalog_empty", "ai_rate_limit", "ai_generation_conflict", "ai_invalid_proposal", "ai_unknown_product",
  "ai_policy", "ai_timeout", "ai_unavailable", "ai_invalid_response", "ai_output_limit", "ai_quota", "ai_configuration", "ai_truncated", "ai_refused"]);
const endpoint = "/api/admin-contests?action=marketing-ai";
export function createMarketingAiClient(dependencies: { token: typeof getFirebaseIdToken; fetch: typeof fetch }) {
  async function request<T>(url: string, body?: MarketingAiRequest): Promise<T> {
    const token = await dependencies.token();
    if (!token) throw new MarketingAiApiError("Session admin requise.", "authentication_required");
    let response: Response;
    try {
      response = await dependencies.fetch(url, { method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(35000),
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new MarketingAiApiError("Réponse perdue : reprenez la génération conservée.", "response_lost", Boolean(body)); }
    let payload: Record<string, unknown>;
    try { payload = await response.json(); }
    catch { throw new MarketingAiApiError("Réponse illisible : reprenez la génération conservée.", "invalid_response", Boolean(body)); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new MarketingAiApiError("Réponse IA invalide.", "invalid_response", Boolean(body));
    if (!response.ok) {
      const code = typeof payload.code === "string" ? payload.code : "unknown_error";
      throw new MarketingAiApiError(String(payload.error || "Assistant IA indisponible."), code,
        Boolean(body && !terminalCodes.has(code) && !["authentication_required", "forbidden"].includes(code)));
    }
    return payload as T;
  }
  async function generation(url: string, body?: MarketingAiRequest) {
    const result = await request<MarketingAiGeneration>(url, body);
    if (!result.id || (body && result.id !== body.generationId) || !Array.isArray(result.proposals) || !result.proposals.length
      || result.proposals.length > 3 || !result.provider || !result.model || !result.promptVersion || !result.createdAt
      || !result.proposals.every((p) => p.id && p.title && p.concept && p.rationale && p.parameters && Array.isArray(p.referencedProductIds)))
      throw new MarketingAiApiError("Résultat incomplet : reprenez la génération conservée.", "invalid_response", Boolean(body));
    return result;
  }
  return {
    status: async () => {
      const result = await request<{ configured: boolean; maxProposals: number }>(endpoint);
      if (typeof result.configured !== "boolean" || result.maxProposals !== 3) throw new MarketingAiApiError("Assistant IA indisponible.", "invalid_response");
      return result;
    },
    generate: (body: MarketingAiRequest) => generation(endpoint, body),
    get: (id: string) => generation(`${endpoint}&generationId=${encodeURIComponent(id)}`),
  };
}
const client = createMarketingAiClient({ token: getFirebaseIdToken, fetch: (...args) => fetch(...args) });
export const getMarketingAiStatus = client.status;
export const generateMarketingAi = client.generate;
export const getMarketingAiGeneration = client.get;

const key = (uid: string) => `verdanza:marketing-ai-pending:v1:${uid}`;
const historyKey = (uid: string) => `verdanza:marketing-ai-history:v1:${uid}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function pendingMarketingAi(uid: string): MarketingAiRequest | null {
  if (!uid) return null;
  const value = localStorage.getItem(key(uid));
  if (!value) return null;
  try {
    const entry = JSON.parse(value);
    if (entry.ownerUid !== uid || !uuid.test(entry.request?.generationId) || typeof entry.request.brief?.objective !== "string") throw new Error();
    return entry.request as MarketingAiRequest;
  } catch { throw new Error("Journal IA illisible : vérification nécessaire avant une nouvelle génération."); }
}
export function rememberMarketingAi(uid: string, request: MarketingAiRequest) {
  if (!uid) throw new Error("Session admin requise.");
  const old = pendingMarketingAi(uid);
  if (old && JSON.stringify(old) !== JSON.stringify(request)) throw new Error("Une génération IA doit encore être vérifiée.");
  localStorage.setItem(key(uid), JSON.stringify({ ownerUid: uid, request }));
  if (JSON.stringify(pendingMarketingAi(uid)) !== JSON.stringify(request)) throw new Error("Identifiant non conservé : génération non envoyée.");
}
export function forgetMarketingAi(uid: string, id: string) {
  if (pendingMarketingAi(uid)?.generationId === id) localStorage.removeItem(key(uid));
}
export function marketingAiHistory(uid: string): string[] {
  if (!uid) return [];
  try {
    const ids = JSON.parse(localStorage.getItem(historyKey(uid)) || "[]");
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && uuid.test(id))) throw new Error();
    return [...new Set<string>(ids)];
  } catch { throw new Error("Historique IA illisible. Les générations serveur restent privées et conservées."); }
}
export function rememberMarketingAiHistory(uid: string, id: string) {
  if (!uid || !uuid.test(id)) throw new Error("Historique IA invalide.");
  localStorage.setItem(historyKey(uid), JSON.stringify([...new Set([...marketingAiHistory(uid), id])]));
}
