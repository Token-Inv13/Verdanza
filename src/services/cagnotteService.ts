import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { CagnotteReadResponse, CagnotteReadScope } from "../types/cagnotteRead";

export type CagnotteReadRequest = {
  scope: CagnotteReadScope;
  targetUid?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
};

export class CagnotteHttpError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "CagnotteHttpError";
  }
}

export async function fetchCagnotte(
  input: CagnotteReadRequest,
  dependencies: {
    getToken?: typeof getFirebaseIdToken;
    fetch?: typeof fetch;
  } = {},
): Promise<CagnotteReadResponse> {
  const token = await (dependencies.getToken ?? getFirebaseIdToken)();
  if (!token) throw new CagnotteHttpError("session_expired", 401, "Session expirée.");
  const query = new URLSearchParams({ scope: input.scope });
  if (input.scope === "admin") {
    if (!input.targetUid) throw new CagnotteHttpError("invalid_request", 400, "Client cible manquant.");
    query.set("targetUid", input.targetUid);
  }
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  const response = await (dependencies.fetch ?? fetch)(`/api/cagnotte?${query}`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: input.signal,
  });
  const payload = (await response.json().catch(() => ({}))) as CagnotteReadResponse & { code?: string; error?: string };
  if (!response.ok) throw new CagnotteHttpError(payload.code || "cagnotte_read_unavailable", response.status, payload.error || "Historique indisponible.");
  return validateCagnotteResponse(payload);
}

function validateCagnotteResponse(value: CagnotteReadResponse): CagnotteReadResponse {
  const wallet = value?.wallet;
  const history = value?.history;
  const capabilities = value?.capabilities;
  if (value?.currency !== "EUR" || !capabilities || capabilities.canReadWallet !== true ||
    typeof capabilities.canRequestReservation !== "boolean" || typeof capabilities.canAccrueLoyalty !== "boolean" ||
    !wallet || !["active", "not_created"].includes(wallet.status) ||
    ![wallet.availableCents, wallet.pendingCents, wallet.reservedCents, wallet.regularizationCents].every(Number.isSafeInteger) ||
    [wallet.availableCents, wallet.pendingCents, wallet.reservedCents, wallet.regularizationCents].some((entry) => entry < 0) ||
    !history || !Array.isArray(history.items) || !(history.nextCursor === null || typeof history.nextCursor === "string") ||
    history.completeness !== "timestamped_movements_only" ||
    history.limitation !== "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet." ||
    !value.freshness || Number.isNaN(Date.parse(value.freshness.readAt)) || value.freshness.consistency !== "wallet_and_page" ||
    value.freshness.refreshStartsAtFirstPage !== true) {
    throw new CagnotteHttpError("invalid_response", 502, "Réponse de consultation invalide.");
  }
  return value;
}

export type CagnottePanelState =
  | { phase: "idle" | "loading"; data: null; errorCode: null }
  | { phase: "ready" | "loading_more"; data: CagnotteReadResponse; errorCode: null }
  | { phase: "error"; data: null; errorCode: string };

type Identity = { identityKey: string; scope: CagnotteReadScope; targetUid?: string };
type Request = (input: CagnotteReadRequest) => Promise<CagnotteReadResponse>;

/** Small state coordinator used by React and directly tested for stale-response isolation. */
export class CagnotteReadController {
  private generation = 0;
  private abortController: AbortController | null = null;
  private identity: Identity | null = null;
  private state: CagnottePanelState = { phase: "idle", data: null, errorCode: null };

  constructor(private readonly request: Request, private readonly publish: (state: CagnottePanelState) => void) {}

  setIdentity(identity: Identity | null) {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.identity = identity;
    this.setState({ phase: identity ? "loading" : "idle", data: null, errorCode: null });
    if (identity) void this.load(null, false, this.generation);
  }

  refresh() {
    if (!this.identity) return;
    this.generation += 1;
    this.abortController?.abort();
    this.setState({ phase: "loading", data: null, errorCode: null });
    void this.load(null, false, this.generation);
  }

  loadMore() {
    if (!this.identity || this.state.phase !== "ready" || !this.state.data.history.nextCursor) return;
    const generation = this.generation;
    const previous = this.state.data;
    this.setState({ phase: "loading_more", data: previous, errorCode: null });
    void this.load(previous.history.nextCursor, true, generation);
  }

  snapshot() {
    return this.state;
  }

  dispose() {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.identity = null;
  }

  private async load(cursor: string | null, append: boolean, generation: number) {
    const identity = this.identity;
    if (!identity) return;
    const abortController = new AbortController();
    this.abortController = abortController;
    try {
      const next = await this.request({
        scope: identity.scope,
        ...(identity.targetUid ? { targetUid: identity.targetUid } : {}),
        ...(cursor ? { cursor } : {}),
        signal: abortController.signal,
      });
      if (generation !== this.generation || identity !== this.identity) return;
      if (!append) return this.setState({ phase: "ready", data: next, errorCode: null });
      const previous = this.state.data;
      if (!previous) return;
      const items = [...previous.history.items, ...next.history.items];
      this.setState({ phase: "ready", data: { ...next, history: { ...next.history, items } }, errorCode: null });
    } catch (error) {
      if (generation !== this.generation || abortController.signal.aborted) return;
      this.setState({ phase: "error", data: null, errorCode: error instanceof CagnotteHttpError ? error.code : "cagnotte_read_unavailable" });
    }
  }

  private setState(state: CagnottePanelState) {
    this.state = state;
    this.publish(state);
  }
}
