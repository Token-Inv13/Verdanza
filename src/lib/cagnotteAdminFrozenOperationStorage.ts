import type { CagnotteAdminFrozenOperation } from "./cagnotteAdminController";
import type { RecordOrderRefundInput, RecordRefundCorrectionInput } from "../services/cagnotteAdminService";
import { cagnotteAdminSha256 as sha256, stableCagnotteAdminHashValue as stable } from "./cagnotteAdminHash";

export const CAGNOTTE_ADMIN_FROZEN_OPERATION_SCHEMA_VERSION = 1 as const;
export const CAGNOTTE_ADMIN_FROZEN_OPERATION_KEY_PREFIX = "verdanza:cagnotte-admin:frozen-operation:v1:";
export const CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_SCHEMA_VERSION = 2 as const;
export const CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_KEY_PREFIX = "verdanza:cagnotte-admin:frozen-resolution:v2:";
export const CAGNOTTE_ADMIN_LEGACY_TERMINAL_RESOLUTION_KEY_PREFIX = "verdanza:cagnotte-admin:frozen-resolution:v1:";
export const CAGNOTTE_ADMIN_CLAIM_LOCK_PREFIX = "verdanza:cagnotte-admin:claim:v1:";
export const CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE = "Impossible de sécuriser cette opération pour une reprise en cas de réponse interrompue. Aucun enregistrement n’a été envoyé.";
export const CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE = "Les données locales de reprise de cette commande sont invalides. Aucune nouvelle opération n’est autorisée tant que leur résolution n’est pas établie.";

export type CagnotteAdminFrozenOperationState = "in_flight" | "uncertain" | "awaiting_confirmation";

export type CagnotteAdminStoredFrozenOperation = {
  schemaVersion: typeof CAGNOTTE_ADMIN_FROZEN_OPERATION_SCHEMA_VERSION;
  state: CagnotteAdminFrozenOperationState;
  operation: CagnotteAdminFrozenOperation;
  createdAtEpochMs: number;
};

export type CagnotteAdminTerminalResolutionOutcome = "definitive_rejection" | "recorded";

export type CagnotteAdminTerminalResolution = {
  schemaVersion: typeof CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_SCHEMA_VERSION;
  orderId: string;
  operationFingerprint: string;
  outcome: CagnotteAdminTerminalResolutionOutcome;
  resolvedAtEpochMs: number;
};

export type CagnotteAdminFrozenOperationLoadResult =
  | { status: "empty" }
  | { status: "ready"; record: CagnotteAdminStoredFrozenOperation }
  | { status: "blocked"; reason: "invalid" | "unavailable"; message: string };

export type CagnotteAdminTerminalResolutionLoadResult =
  | { status: "empty" }
  | { status: "ready"; resolution: CagnotteAdminTerminalResolution }
  | { status: "blocked"; reason: "invalid" | "unavailable"; message: string };

export type CagnotteAdminRecoveryStorageSnapshot = {
  frozen: CagnotteAdminFrozenOperationLoadResult;
  resolution: CagnotteAdminTerminalResolutionLoadResult;
};

export interface CagnotteAdminStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CagnotteAdminExclusiveClaim {
  request<T>(name: string, run: () => T | Promise<T>): Promise<T>;
}

export interface CagnotteAdminFrozenOperationStore {
  key(orderId: string): string;
  resolutionKey(operation: CagnotteAdminFrozenOperation): string;
  load(orderId: string): CagnotteAdminFrozenOperationLoadResult;
  loadResolution(operation: CagnotteAdminFrozenOperation): CagnotteAdminTerminalResolutionLoadResult;
  loadRecovery(orderId: string, operation: CagnotteAdminFrozenOperation | null): CagnotteAdminRecoveryStorageSnapshot;
  claimBeforeSend(operation: CagnotteAdminFrozenOperation): Promise<CagnotteAdminStoredFrozenOperation>;
  persistBeforeSend(operation: CagnotteAdminFrozenOperation): CagnotteAdminStoredFrozenOperation;
  updateState(operation: CagnotteAdminFrozenOperation, state: CagnotteAdminFrozenOperationState): CagnotteAdminStoredFrozenOperation;
  clearAfterResolution(operation: CagnotteAdminFrozenOperation): void;
  clearAfterDefinitiveRejection(operation: CagnotteAdminFrozenOperation): void;
  subscribe(orderId: string, listener: () => void): () => void;
}

export class CagnotteAdminFrozenOperationStorageError extends Error {
  constructor(message: string, readonly reason: "conflict" | "invalid" | "unavailable") {
    super(message);
    this.name = "CagnotteAdminFrozenOperationStorageError";
  }
}

export function createCagnotteAdminFrozenOperationStore(options: {
  storage: CagnotteAdminStorageLike | (() => CagnotteAdminStorageLike);
  now?: () => number;
  subscribeToStorageChanges?: (listener: (key: string | null) => void) => () => void;
  exclusiveClaim?: CagnotteAdminExclusiveClaim;
}): CagnotteAdminFrozenOperationStore {
  const storageProvider = typeof options.storage === "function" ? options.storage : () => options.storage as CagnotteAdminStorageLike;
  const now = options.now ?? Date.now;

  const key = (orderId: string) => `${CAGNOTTE_ADMIN_FROZEN_OPERATION_KEY_PREFIX}${identifier(orderId, 128)}`;
  const resolutionOrderPrefix = (orderId: string) => `${CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_KEY_PREFIX}${identifier(orderId, 128)}:`;
  const resolutionKey = (operation: CagnotteAdminFrozenOperation) => {
    const validated = validateForMutation(operation);
    return `${resolutionOrderPrefix(validated.orderId)}${cagnotteAdminFrozenOperationFingerprint(validated)}`;
  };

  const load = (orderId: string): CagnotteAdminFrozenOperationLoadResult => {
    let raw: string | null;
    try {
      raw = storageProvider().getItem(key(orderId));
    } catch {
      return { status: "blocked", reason: "unavailable", message: CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE };
    }
    if (raw === null) return { status: "empty" };
    try {
      const record = storedRecord(JSON.parse(raw), orderId);
      return { status: "ready", record };
    } catch {
      return { status: "blocked", reason: "invalid", message: CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE };
    }
  };

  const loadResolution = (operation: CagnotteAdminFrozenOperation): CagnotteAdminTerminalResolutionLoadResult => {
    let validated: CagnotteAdminFrozenOperation;
    try {
      validated = validateForMutation(operation);
    } catch {
      return { status: "blocked", reason: "invalid", message: CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE };
    }
    const operationFingerprint = cagnotteAdminFrozenOperationFingerprint(validated);
    let raw: string | null;
    try {
      raw = storageProvider().getItem(resolutionKey(validated));
    } catch {
      return { status: "blocked", reason: "unavailable", message: CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE };
    }
    if (raw === null) return { status: "empty" };
    try {
      return { status: "ready", resolution: terminalResolution(JSON.parse(raw), validated.orderId, operationFingerprint) };
    } catch {
      return { status: "blocked", reason: "invalid", message: CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE };
    }
  };

  const writeAndConfirm = (orderId: string, record: CagnotteAdminStoredFrozenOperation) => {
    const storageKey = key(orderId);
    try {
      storageProvider().setItem(storageKey, JSON.stringify(record));
    } catch {
      throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE, "unavailable");
    }
    const confirmed = load(orderId);
    if (confirmed.status !== "ready" || !sameStoredRecord(confirmed.record, record)) {
      throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE, "unavailable");
    }
    return confirmed.record;
  };

  const writeResolutionAndConfirm = (
    operation: CagnotteAdminFrozenOperation,
    outcome: CagnotteAdminTerminalResolutionOutcome,
  ) => {
    const prior = loadResolution(operation);
    if (prior.status === "blocked") {
      throw new CagnotteAdminFrozenOperationStorageError(prior.message, prior.reason);
    }
    if (prior.status === "ready") {
      if (prior.resolution.outcome !== outcome) {
        throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE, "invalid");
      }
      return;
    }
    const resolvedAtEpochMs = now();
    if (!Number.isSafeInteger(resolvedAtEpochMs) || resolvedAtEpochMs < 0) {
      throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE, "unavailable");
    }
    const resolution: CagnotteAdminTerminalResolution = {
      schemaVersion: CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_SCHEMA_VERSION,
      orderId: operation.orderId,
      operationFingerprint: cagnotteAdminFrozenOperationFingerprint(operation),
      outcome,
      resolvedAtEpochMs,
    };
    try {
      storageProvider().setItem(resolutionKey(operation), JSON.stringify(resolution));
    } catch {
      throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE, "unavailable");
    }
    const confirmed = loadResolution(operation);
    if (confirmed.status !== "ready" || !sameTerminalResolution(confirmed.resolution, resolution)) {
      throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE, "unavailable");
    }
  };

  const resolveAndClear = (
    operation: CagnotteAdminFrozenOperation,
    outcome: CagnotteAdminTerminalResolutionOutcome,
    unavailableMessage: string,
    requireExisting: boolean,
  ) => {
    const validated = validateForMutation(operation);
    const existing = load(validated.orderId);
    if (existing.status === "blocked") {
      throw new CagnotteAdminFrozenOperationStorageError(existing.message, existing.reason);
    }
    if (existing.status === "empty") {
      if (requireExisting) {
        throw new CagnotteAdminFrozenOperationStorageError("L’opération durable à supprimer est introuvable.", "conflict");
      }
    } else if (!sameFrozenOperation(existing.record.operation, validated)) {
      throw new CagnotteAdminFrozenOperationStorageError("Une autre opération durable est enregistrée pour cette commande.", "conflict");
    }
    writeResolutionAndConfirm(validated, outcome);
    if (existing.status === "empty") return;
    try {
      storageProvider().removeItem(key(validated.orderId));
    } catch {
      throw new CagnotteAdminFrozenOperationStorageError(unavailableMessage, "unavailable");
    }
    const confirmed = load(validated.orderId);
    if (confirmed.status !== "empty") {
      throw new CagnotteAdminFrozenOperationStorageError(unavailableMessage, "unavailable");
    }
  };

  const persistBeforeSend = (operation: CagnotteAdminFrozenOperation) => {
    const validated = validateForMutation(operation);
    const existing = load(validated.orderId);
    if (existing.status === "ready") {
      throw new CagnotteAdminFrozenOperationStorageError("Une opération précédente reste à confirmer pour cette commande.", "conflict");
    }
    if (existing.status === "blocked") {
      throw new CagnotteAdminFrozenOperationStorageError(existing.message, existing.reason);
    }
    const resolution = loadResolution(validated);
    if (resolution.status === "blocked") {
      throw new CagnotteAdminFrozenOperationStorageError(resolution.message, resolution.reason);
    }
    const createdAtEpochMs = now();
    if (!Number.isSafeInteger(createdAtEpochMs) || createdAtEpochMs < 0) {
      throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE, "unavailable");
    }
    return writeAndConfirm(validated.orderId, {
      schemaVersion: CAGNOTTE_ADMIN_FROZEN_OPERATION_SCHEMA_VERSION,
      state: "in_flight",
      operation: validated,
      createdAtEpochMs,
    });
  };

  return {
    key,
    resolutionKey,
    load,
    loadResolution,
    loadRecovery(orderId, operation) {
      const frozen = load(orderId);
      if (!operation) return { frozen, resolution: { status: "empty" } };
      if (operation.orderId !== orderId) {
        return { frozen, resolution: { status: "blocked", reason: "invalid", message: CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE } };
      }
      return { frozen, resolution: loadResolution(operation) };
    },
    claimBeforeSend(operation) {
      const validated = validateForMutation(operation);
      if (!options.exclusiveClaim) {
        return Promise.reject(new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE, "unavailable"));
      }
      return options.exclusiveClaim.request(`${CAGNOTTE_ADMIN_CLAIM_LOCK_PREFIX}${validated.orderId}`, () => persistBeforeSend(validated));
    },
    persistBeforeSend,
    updateState(operation, state) {
      const validated = validateForMutation(operation);
      const existing = load(validated.orderId);
      if (existing.status !== "ready") {
        const reason = existing.status === "blocked" ? existing.reason : "conflict";
        const message = existing.status === "blocked" ? existing.message : "L’opération durable à mettre à jour est introuvable.";
        throw new CagnotteAdminFrozenOperationStorageError(message, reason);
      }
      if (!sameFrozenOperation(existing.record.operation, validated)) {
        throw new CagnotteAdminFrozenOperationStorageError("Une autre opération durable est déjà enregistrée pour cette commande.", "conflict");
      }
      return writeAndConfirm(validated.orderId, { ...existing.record, state });
    },
    clearAfterResolution(operation) {
      resolveAndClear(operation, "recorded", "La confirmation serveur est acquise, mais le verrou local n’a pas pu être supprimé. La commande reste verrouillée.", false);
    },
    clearAfterDefinitiveRejection(operation) {
      resolveAndClear(operation, "definitive_rejection", "Le rejet serveur est définitif, mais le verrou local n’a pas pu être supprimé. La commande reste verrouillée.", true);
    },
    subscribe(orderId, listener) {
      const watchedKey = key(orderId);
      const watchedResolutionPrefix = resolutionOrderPrefix(orderId);
      return options.subscribeToStorageChanges?.((changedKey) => {
        if (changedKey === watchedKey || changedKey?.startsWith(watchedResolutionPrefix)) listener();
      }) ?? (() => undefined);
    },
  };
}

export const browserCagnotteAdminFrozenOperationStore = createCagnotteAdminFrozenOperationStore({
  storage: () => {
    if (typeof window === "undefined") throw new Error("Browser storage unavailable");
    return window.localStorage;
  },
  subscribeToStorageChanges: (listener) => {
    if (typeof window === "undefined") return () => undefined;
    const onStorage = (event: StorageEvent) => listener(event.key);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
  exclusiveClaim: {
    request: async <T,>(name: string, run: () => T | Promise<T>) => {
      const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
      if (!locks) throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE, "unavailable");
      return locks.request(name, { mode: "exclusive" }, () => run());
    },
  },
});

export function sameFrozenOperation(left: CagnotteAdminFrozenOperation, right: CagnotteAdminFrozenOperation) {
  return stable(left) === stable(right);
}

export function cagnotteAdminFrozenOperationFingerprint(operation: CagnotteAdminFrozenOperation) {
  return sha256(stable(validateForMutation(operation)));
}

function storedRecord(value: unknown, expectedOrderId: string): CagnotteAdminStoredFrozenOperation {
  const record = strictObject(value, ["schemaVersion", "state", "operation", "createdAtEpochMs"]);
  if (record.schemaVersion !== CAGNOTTE_ADMIN_FROZEN_OPERATION_SCHEMA_VERSION) throw new Error("Unknown schema");
  if (record.state !== "in_flight" && record.state !== "uncertain" && record.state !== "awaiting_confirmation") throw new Error("Unknown state");
  if (!Number.isSafeInteger(record.createdAtEpochMs) || (record.createdAtEpochMs as number) < 0) throw new Error("Invalid creation time");
  return {
    schemaVersion: CAGNOTTE_ADMIN_FROZEN_OPERATION_SCHEMA_VERSION,
    state: record.state,
    operation: frozenOperation(record.operation, expectedOrderId),
    createdAtEpochMs: record.createdAtEpochMs as number,
  };
}

function terminalResolution(value: unknown, expectedOrderId: string, expectedOperationFingerprint: string): CagnotteAdminTerminalResolution {
  const resolution = strictObject(value, ["schemaVersion", "orderId", "operationFingerprint", "outcome", "resolvedAtEpochMs"]);
  if (resolution.schemaVersion !== CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_SCHEMA_VERSION) throw new Error("Unknown terminal resolution schema");
  const orderId = identifier(resolution.orderId, 128);
  if (orderId !== expectedOrderId) throw new Error("Terminal resolution order mismatch");
  if (typeof resolution.operationFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(resolution.operationFingerprint)) throw new Error("Invalid operation fingerprint");
  if (resolution.operationFingerprint !== expectedOperationFingerprint) throw new Error("Terminal resolution operation mismatch");
  if (resolution.outcome !== "definitive_rejection" && resolution.outcome !== "recorded") throw new Error("Invalid terminal outcome");
  if (!Number.isSafeInteger(resolution.resolvedAtEpochMs) || (resolution.resolvedAtEpochMs as number) < 0) throw new Error("Invalid resolution time");
  return {
    schemaVersion: CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_SCHEMA_VERSION,
    orderId,
    operationFingerprint: resolution.operationFingerprint,
    outcome: resolution.outcome,
    resolvedAtEpochMs: resolution.resolvedAtEpochMs as number,
  };
}

function validateForMutation(operation: CagnotteAdminFrozenOperation) {
  try {
    return frozenOperation(operation, operation.orderId);
  } catch {
    throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE, "invalid");
  }
}

function frozenOperation(value: unknown, expectedOrderId: string): CagnotteAdminFrozenOperation {
  const operation = strictObject(value, ["kind", "orderId", "payload"]);
  const orderId = identifier(operation.orderId, 128);
  if (orderId !== expectedOrderId) throw new Error("Order mismatch");
  if (operation.kind === "refund") return { kind: "refund", orderId, payload: refundPayload(operation.payload, orderId) };
  if (operation.kind === "correction") return { kind: "correction", orderId, payload: correctionPayload(operation.payload, orderId) };
  throw new Error("Unknown operation kind");
}

function refundPayload(value: unknown, expectedOrderId: string): RecordOrderRefundInput {
  const payload = strictObject(value, ["orderId", "additionalReturns", "deliveryRefundCents", "source", "reference", "declaredFinancialCents", "reason", "confirmedAt", "expectedPreviewVersion"]);
  const orderId = identifier(payload.orderId, 128);
  if (orderId !== expectedOrderId) throw new Error("Payload order mismatch");
  if (payload.source !== "admin" && payload.source !== "provider_reference") throw new Error("Invalid source");
  if (payload.reason !== "product_return" && payload.reason !== "order_cancellation" && payload.reason !== "delivery_refund") throw new Error("Invalid reason");
  return {
    orderId,
    additionalReturns: returnLines(payload.additionalReturns),
    deliveryRefundCents: cents(payload.deliveryRefundCents),
    source: payload.source,
    reference: identifier(payload.reference, 80),
    declaredFinancialCents: cents(payload.declaredFinancialCents),
    reason: payload.reason,
    confirmedAt: instant(payload.confirmedAt),
    expectedPreviewVersion: shaIdentifier(payload.expectedPreviewVersion),
  };
}

function correctionPayload(value: unknown, expectedOrderId: string): RecordRefundCorrectionInput {
  const payload = strictObject(value, ["orderId", "targetEventId", "expectedRevision", "replacementReturns", "deliveryRefundCents", "declaredFinancialCents", "correctionReason", "correctionReference", "expectedPreviewVersion"]);
  const orderId = identifier(payload.orderId, 128);
  if (orderId !== expectedOrderId) throw new Error("Payload order mismatch");
  if (!Number.isSafeInteger(payload.expectedRevision) || (payload.expectedRevision as number) < 0) throw new Error("Invalid revision");
  if (typeof payload.correctionReason !== "string" || payload.correctionReason !== payload.correctionReason.trim() || payload.correctionReason.length < 3 || payload.correctionReason.length > 300) throw new Error("Invalid correction reason");
  return {
    orderId,
    targetEventId: shaIdentifier(payload.targetEventId),
    expectedRevision: payload.expectedRevision as number,
    replacementReturns: returnLines(payload.replacementReturns),
    deliveryRefundCents: cents(payload.deliveryRefundCents),
    declaredFinancialCents: cents(payload.declaredFinancialCents),
    correctionReason: payload.correctionReason,
    correctionReference: identifier(payload.correctionReference, 80),
    expectedPreviewVersion: shaIdentifier(payload.expectedPreviewVersion),
  };
}

function returnLines(value: unknown) {
  if (!Array.isArray(value) || value.length > 200) throw new Error("Invalid return lines");
  const seen = new Set<string>();
  return value.map((entry) => {
    const line = strictObject(entry, ["lineId", "additionalNetCents"]);
    const lineId = identifier(line.lineId, 128);
    const additionalNetCents = cents(line.additionalNetCents);
    if (additionalNetCents === 0 || seen.has(lineId)) throw new Error("Invalid return line");
    seen.add(lineId);
    return { lineId, additionalNetCents };
  });
}

function strictObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("Unexpected properties");
  return record;
}

function identifier(value: unknown, max: number) {
  if (typeof value !== "string" || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid identifier");
  return value;
}

function shaIdentifier(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid sha identifier");
  return value;
}

function instant(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid instant");
  const normalized = new Date(value).toISOString();
  if (normalized !== value && normalized.replace(".000Z", "Z") !== value) throw new Error("Invalid instant");
  return value;
}

function cents(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid cents");
  return value;
}

function sameStoredRecord(left: CagnotteAdminStoredFrozenOperation, right: CagnotteAdminStoredFrozenOperation) {
  return stable(left) === stable(right);
}

function sameTerminalResolution(left: CagnotteAdminTerminalResolution, right: CagnotteAdminTerminalResolution) {
  return stable(left) === stable(right);
}
