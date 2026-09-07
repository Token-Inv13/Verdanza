import type { OrderQuote } from "./quoteService";
import type { CheckoutOrderResult, CreateCheckoutOrderInput } from "./ordersService";
import type { CagnotteUseAcceptance } from "../types/cagnotte";
import type { CagnotteReadResponse } from "../types/cagnotteRead";

export type CagnotteProposalPhase =
  | "idle"
  | "loading"
  | "ready"
  | "changed"
  | "invalidated"
  | "error";

export type CagnotteCheckoutState = {
  identityKey: string | null;
  contextKey: string;
  walletPhase: "idle" | "loading" | "ready" | "error";
  wallet: CagnotteReadResponse | null;
  walletErrorCode: string | null;
  selectionEnabled: boolean;
  amountInput: string;
  amountError: string | null;
  proposalPhase: CagnotteProposalPhase;
  proposal: OrderQuote | null;
  acceptance: CagnotteUseAcceptance | null;
  proposalErrorCode: string | null;
  fallbackPhase: "idle" | "loading" | "ready" | "error";
  fallbackQuote: OrderQuote | null;
  fallbackAccepted: boolean;
  announcement: string;
};

const preferences = new Map<string, number>();

export function parseFrenchEuroCents(raw: string): number {
  const value = raw.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(value)) {
    throw new Error("Saisissez un montant positif avec deux décimales au maximum, par exemple 8,50.");
  }
  const [euros, decimals = ""] = value.replace(",", ".").split(".");
  const cents = BigInt(euros) * 100n + BigInt(decimals.padEnd(2, "0"));
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Le montant doit être supérieur à zéro et rester dans la limite autorisée.");
  }
  return Number(cents);
}

export function euroInputFromCents(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) return "";
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

export function clearCagnottePreference(identityKey: string | null) {
  if (identityKey) preferences.delete(identityKey);
}

export class CagnotteCheckoutController {
  private identityGeneration = 0;
  private requestGeneration = 0;
  private state: CagnotteCheckoutState = emptyCagnotteState();

  constructor(private readonly publish: (state: CagnotteCheckoutState) => void) {}

  snapshot() {
    return this.state;
  }

  setIdentity(identityKey: string | null) {
    if (identityKey === this.state.identityKey) return;
    this.identityGeneration += 1;
    this.requestGeneration += 1;
    const preferred = identityKey ? preferences.get(identityKey) : undefined;
    this.state = {
      ...emptyCagnotteState(),
      identityKey,
      selectionEnabled: preferred !== undefined,
      amountInput: preferred === undefined ? "" : euroInputFromCents(preferred),
    };
    this.emit();
  }

  setContext(contextKey: string) {
    if (contextKey === this.state.contextKey) return;
    const hadAcceptedConditions = Boolean(this.state.acceptance || this.state.fallbackAccepted);
    this.requestGeneration += 1;
    this.state = {
      ...this.state,
      contextKey,
      proposal: null,
      acceptance: null,
      proposalErrorCode: null,
      proposalPhase: hadAcceptedConditions ? "invalidated" : "idle",
      fallbackPhase: "idle",
      fallbackQuote: null,
      fallbackAccepted: false,
      announcement: hadAcceptedConditions
        ? "Le panier ou la livraison a changé. Un nouveau devis doit être validé."
        : "",
    };
    this.emit();
  }

  async loadWallet(request: () => Promise<CagnotteReadResponse>) {
    const identityKey = this.state.identityKey;
    if (!identityKey) return;
    const generation = this.identityGeneration;
    this.state = { ...this.state, walletPhase: "loading", wallet: null, walletErrorCode: null };
    this.emit();
    try {
      const wallet = await request();
      if (generation !== this.identityGeneration || identityKey !== this.state.identityKey) return;
      this.state = { ...this.state, walletPhase: "ready", wallet, walletErrorCode: null };
      this.emit();
    } catch (error) {
      if (generation !== this.identityGeneration || identityKey !== this.state.identityKey) return;
      this.state = {
        ...this.state,
        walletPhase: "error",
        wallet: null,
        walletErrorCode: errorCode(error, "cagnotte_read_unavailable"),
      };
      this.emit();
    }
  }

  setSelectionEnabled(enabled: boolean) {
    if (!enabled) {
      if (this.state.identityKey) preferences.delete(this.state.identityKey);
      this.requestGeneration += 1;
      this.state = {
        ...this.state,
        selectionEnabled: false,
        amountInput: "",
        amountError: null,
        proposalPhase: "idle",
        proposal: null,
        acceptance: null,
        proposalErrorCode: null,
        announcement: "La commande continuera sans cagnotte après validation du nouveau total.",
      };
      this.emit();
      return;
    }
    this.state = {
      ...this.state,
      selectionEnabled: true,
      fallbackPhase: "idle",
      fallbackQuote: null,
      fallbackAccepted: false,
      announcement: "",
    };
    this.emit();
  }

  setAmountInput(amountInput: string) {
    this.requestGeneration += 1;
    let amountError: string | null = null;
    if (amountInput.trim()) {
      try { parseFrenchEuroCents(amountInput); }
      catch (error) { amountError = error instanceof Error ? error.message : "Montant invalide."; }
    }
    this.state = {
      ...this.state,
      amountInput,
      amountError,
      proposalPhase: "idle",
      proposal: null,
      acceptance: null,
      proposalErrorCode: null,
      announcement: "",
    };
    this.emit();
  }

  async requestMaximum(load: (requestedCents: number) => Promise<OrderQuote>) {
    if (this.state.walletPhase !== "ready" || this.state.wallet?.capabilities.canRequestReservation !== true) {
      this.state = { ...this.state, proposalPhase: "error", proposalErrorCode: "RESERVATIONS_DISABLED" };
      this.emit();
      return null;
    }
    if ((this.state.wallet.wallet.regularizationCents ?? 0) > 0) {
      this.state = { ...this.state, amountError: "Une régularisation empêche une nouvelle utilisation." };
      this.emit();
      return null;
    }
    const available = this.state.wallet?.wallet.availableCents ?? 0;
    if (available <= 0) {
      this.state = { ...this.state, amountError: "Aucun montant disponible ne peut être demandé." };
      this.emit();
      return null;
    }
    this.state = { ...this.state, selectionEnabled: true, amountInput: euroInputFromCents(available), amountError: null };
    this.emit();
    return this.requestProposal(load, available);
  }

  async requestProposal(
    load: (requestedCents: number) => Promise<OrderQuote>,
    requestedOverride?: number,
  ): Promise<OrderQuote | null> {
    const identityKey = this.state.identityKey;
    if (!identityKey) {
      this.state = { ...this.state, proposalPhase: "error", proposalErrorCode: "AUTH_REQUIRED" };
      this.emit();
      return null;
    }
    let requestedCents: number;
    try {
      requestedCents = requestedOverride ?? parseFrenchEuroCents(this.state.amountInput);
    } catch (error) {
      this.state = {
        ...this.state,
        amountError: error instanceof Error ? error.message : "Montant invalide.",
        proposalPhase: "idle",
      };
      this.emit();
      return null;
    }
    const requestGeneration = ++this.requestGeneration;
    const identityGeneration = this.identityGeneration;
    const contextKey = this.state.contextKey;
    const previousAcceptance = this.state.acceptance;
    this.state = {
      ...this.state,
      selectionEnabled: true,
      amountError: null,
      proposalPhase: "loading",
      proposalErrorCode: null,
      announcement: "Calcul de la proposition en cours.",
    };
    this.emit();
    try {
      const proposal = await load(requestedCents);
      if (
        requestGeneration !== this.requestGeneration ||
        identityGeneration !== this.identityGeneration ||
        identityKey !== this.state.identityKey ||
        contextKey !== this.state.contextKey
      ) return null;
      if (!proposal.cagnotteUse || proposal.cagnotteUse.requestedCagnotteCents !== requestedCents) {
        throw new Error("Réponse de devis cagnotte invalide.");
      }
      const unchanged = previousAcceptance
        ? acceptanceMatches(previousAcceptance, proposal)
        : false;
      const changed = Boolean(previousAcceptance && !unchanged);
      if (this.state.identityKey) preferences.set(this.state.identityKey, requestedCents);
      this.state = {
        ...this.state,
        proposal,
        proposalPhase: changed ? "changed" : "ready",
        acceptance: unchanged ? previousAcceptance : null,
        proposalErrorCode: null,
        announcement: changed
          ? "Le montant proposé a changé. Validez le nouveau récapitulatif avant la commande."
          : "Proposition mise à jour par le serveur.",
      };
      this.emit();
      return proposal;
    } catch (error) {
      if (
        requestGeneration !== this.requestGeneration ||
        identityGeneration !== this.identityGeneration ||
        identityKey !== this.state.identityKey ||
        contextKey !== this.state.contextKey
      ) return null;
      this.state = {
        ...this.state,
        proposal: null,
        acceptance: null,
        proposalPhase: "error",
        proposalErrorCode: errorCode(error, "QUOTE_UNAVAILABLE"),
        announcement: "La proposition n’a pas pu être obtenue.",
      };
      this.emit();
      return null;
    }
  }

  acceptProposal() {
    const quote = this.state.proposal?.cagnotteUse;
    if (!quote || quote.proposedCagnotteCents <= 0 || quote.payableCents < 0) return null;
    const acceptance: CagnotteUseAcceptance = {
      quoteVersion: quote.quoteVersion,
      quoteFingerprint: quote.quoteFingerprint,
      acceptedCagnotteCents: quote.proposedCagnotteCents,
      acceptedPayableCents: quote.payableCents,
    };
    this.state = {
      ...this.state,
      acceptance,
      proposalPhase: "ready",
      announcement: "Montant de cagnotte et reste à régler acceptés.",
    };
    this.emit();
    return acceptance;
  }

  async revalidate(load: (requestedCents: number) => Promise<OrderQuote>) {
    const accepted = this.state.acceptance;
    if (!accepted) return { accepted: false, proposal: this.state.proposal, acceptance: null };
    const requested = this.state.proposal?.cagnotteUse?.requestedCagnotteCents;
    if (!requested) return { accepted: false, proposal: null, acceptance: null };
    const proposal = await this.requestProposal(load, requested);
    return {
      accepted: Boolean(proposal && this.state.acceptance),
      proposal,
      acceptance: this.state.acceptance,
    };
  }

  async continueWithout(load: () => Promise<OrderQuote>) {
    this.requestGeneration += 1;
    const requestGeneration = this.requestGeneration;
    const identityGeneration = this.identityGeneration;
    const contextKey = this.state.contextKey;
    if (this.state.identityKey) preferences.delete(this.state.identityKey);
    this.state = {
      ...this.state,
      selectionEnabled: false,
      proposal: null,
      acceptance: null,
      proposalPhase: "idle",
      fallbackPhase: "loading",
      fallbackQuote: null,
      fallbackAccepted: false,
      announcement: "Nouveau devis sans cagnotte en cours.",
    };
    this.emit();
    try {
      const quote = await load();
      if (requestGeneration !== this.requestGeneration || identityGeneration !== this.identityGeneration || contextKey !== this.state.contextKey) return null;
      this.state = {
        ...this.state,
        fallbackPhase: "ready",
        fallbackQuote: quote,
        announcement: "Le nouveau total sans cagnotte doit être validé.",
      };
      this.emit();
      return quote;
    } catch (error) {
      if (requestGeneration !== this.requestGeneration || identityGeneration !== this.identityGeneration || contextKey !== this.state.contextKey) return null;
      this.state = {
        ...this.state,
        fallbackPhase: "error",
        fallbackQuote: null,
        announcement: error instanceof Error ? error.message : "Le devis sans cagnotte est indisponible.",
      };
      this.emit();
      return null;
    }
  }

  acceptWithoutCagnotte() {
    if (this.state.fallbackPhase !== "ready" || !this.state.fallbackQuote) return false;
    this.state = { ...this.state, fallbackAccepted: true, announcement: "Nouveau total sans cagnotte accepté." };
    this.emit();
    return true;
  }

  private emit() {
    this.publish(this.state);
  }
}

export type CheckoutAttemptPhase =
  | "idle"
  | "submitting"
  | "uncertain"
  | "reload_check"
  | "refused"
  | "success";

export type CheckoutAttemptState = {
  identityKey: string | null;
  phase: CheckoutAttemptPhase;
  requestId: string | null;
  error: string;
  result: CheckoutOrderResult | null;
};

export type CheckoutAttemptMarker = {
  requestId: string;
  state: "prepared" | "pending" | "uncertain";
};

export class CheckoutAttemptController {
  private generation = 0;
  private locked = false;
  private active: Promise<CheckoutOrderResult | null> | null = null;
  private frozen: { identityKey: string; requestId: string; request: CreateCheckoutOrderInput } | null = null;
  private state: CheckoutAttemptState = emptyAttemptState();

  constructor(
    private readonly publish: (state: CheckoutAttemptState) => void,
    private readonly persist: {
      mark: (identityKey: string, marker: CheckoutAttemptMarker) => void;
      complete: (identityKey: string) => void;
      refused: (identityKey: string) => void;
    },
  ) {}

  snapshot() {
    return this.state;
  }

  setIdentity(identityKey: string | null, marker?: CheckoutAttemptMarker | null) {
    if (identityKey === this.state.identityKey && !marker) return;
    this.generation += 1;
    this.locked = false;
    this.active = null;
    this.frozen = null;
    this.state = {
      ...emptyAttemptState(),
      identityKey,
      requestId: marker?.requestId ?? null,
      phase: marker && marker.state !== "prepared" ? "reload_check" : "idle",
      error: marker && marker.state !== "prepared"
        ? "L’issue de la tentative précédente doit être vérifiée dans les commandes du compte."
        : "",
    };
    this.emit();
  }

  submit(
    requestId: string,
    request: CreateCheckoutOrderInput,
    send: (request: CreateCheckoutOrderInput) => Promise<CheckoutOrderResult>,
  ) {
    if (this.locked) return this.active ?? Promise.resolve(null);
    const identityKey = this.state.identityKey;
    if (!identityKey || this.state.phase === "reload_check" || this.state.phase === "uncertain") return Promise.resolve(null);
    this.locked = true;
    const generation = this.generation;
    const frozenRequest = cloneCheckoutRequest(request);
    this.frozen = { identityKey, requestId, request: frozenRequest };
    this.persist.mark(identityKey, { requestId, state: "pending" });
    this.state = { ...this.state, phase: "submitting", requestId, error: "", result: null };
    this.emit();
    this.active = send(frozenRequest)
      .then((result) => {
        if (generation !== this.generation || identityKey !== this.state.identityKey) return null;
        this.persist.complete(identityKey);
        this.frozen = null;
        this.state = { ...this.state, phase: "success", result, error: "" };
        this.emit();
        return result;
      })
      .catch((error: unknown) => {
        if (generation !== this.generation || identityKey !== this.state.identityKey) return null;
        const outcome = error && typeof error === "object" && "outcome" in error
          ? String((error as { outcome?: unknown }).outcome)
          : "uncertain";
        const message = error instanceof Error ? error.message : "Résultat de commande inconnu.";
        if (outcome === "refused") {
          this.persist.refused(identityKey);
          this.frozen = null;
          this.state = { ...this.state, phase: "refused", error: message, result: null };
        } else {
          this.persist.mark(identityKey, { requestId, state: "uncertain" });
          this.state = {
            ...this.state,
            phase: "uncertain",
            error: "La réponse n’est pas arrivée. La commande peut avoir été enregistrée : reprenez cette même tentative.",
            result: null,
          };
        }
        this.emit();
        return null;
      })
      .finally(() => {
        if (generation === this.generation) {
          this.locked = false;
          this.active = null;
        }
      });
    return this.active;
  }

  retry(send: (request: CreateCheckoutOrderInput) => Promise<CheckoutOrderResult>) {
    const frozen = this.frozen;
    if (!frozen || this.state.phase !== "uncertain" || frozen.identityKey !== this.state.identityKey) {
      return Promise.resolve(null);
    }
    this.state = { ...this.state, phase: "idle", error: "" };
    this.emit();
    return this.submit(frozen.requestId, frozen.request, send);
  }

  private emit() {
    this.publish(this.state);
  }
}

const attemptKeyPrefix = "verdanza:checkout-attempt:";

export function readCheckoutAttemptMarker(identityKey: string): CheckoutAttemptMarker | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(attemptStorageKey(identityKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CheckoutAttemptMarker>;
    if (!validRequestId(parsed.requestId) || !["prepared", "pending", "uncertain"].includes(String(parsed.state))) return null;
    return parsed as CheckoutAttemptMarker;
  } catch {
    return null;
  }
}

export function getOrCreateCheckoutRequestId(identityKey: string) {
  const existing = readCheckoutAttemptMarker(identityKey);
  if (existing) return existing.requestId;
  const requestId = window.crypto.randomUUID();
  writeCheckoutAttemptMarker(identityKey, { requestId, state: "prepared" });
  return requestId;
}

export function writeCheckoutAttemptMarker(identityKey: string, marker: CheckoutAttemptMarker) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(attemptStorageKey(identityKey), JSON.stringify(marker));
}

export function clearCheckoutAttemptMarker(identityKey: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(attemptStorageKey(identityKey));
}

export function rotateCheckoutAttempt(identityKey: string) {
  clearCheckoutAttemptMarker(identityKey);
  return getOrCreateCheckoutRequestId(identityKey);
}

function acceptanceMatches(acceptance: CagnotteUseAcceptance, quote: OrderQuote) {
  const next = quote.cagnotteUse;
  return Boolean(
    next &&
    acceptance.quoteVersion === next.quoteVersion &&
    acceptance.quoteFingerprint === next.quoteFingerprint &&
    acceptance.acceptedCagnotteCents === next.proposedCagnotteCents &&
    acceptance.acceptedPayableCents === next.payableCents
  );
}

function errorCode(error: unknown, fallback: string) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || fallback)
    : fallback;
}

function emptyCagnotteState(): CagnotteCheckoutState {
  return {
    identityKey: null,
    contextKey: "",
    walletPhase: "idle",
    wallet: null,
    walletErrorCode: null,
    selectionEnabled: false,
    amountInput: "",
    amountError: null,
    proposalPhase: "idle",
    proposal: null,
    acceptance: null,
    proposalErrorCode: null,
    fallbackPhase: "idle",
    fallbackQuote: null,
    fallbackAccepted: false,
    announcement: "",
  };
}

function emptyAttemptState(): CheckoutAttemptState {
  return { identityKey: null, phase: "idle", requestId: null, error: "", result: null };
}

function attemptStorageKey(identityKey: string) {
  return `${attemptKeyPrefix}${encodeURIComponent(identityKey)}`;
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cloneCheckoutRequest(request: CreateCheckoutOrderInput): CreateCheckoutOrderInput {
  return JSON.parse(JSON.stringify(request)) as CreateCheckoutOrderInput;
}
