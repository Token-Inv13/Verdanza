import type { CagnotteAdminFrozenOperation } from "./cagnotteAdminController";
import type { RecordOrderRefundInput, RecordRefundCorrectionInput } from "../services/cagnotteAdminService";

export const CAGNOTTE_ADMIN_FROZEN_OPERATION_SCHEMA_VERSION = 1 as const;
export const CAGNOTTE_ADMIN_FROZEN_OPERATION_KEY_PREFIX = "verdanza:cagnotte-admin:frozen-operation:v1:";
export const CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_SCHEMA_VERSION = 1 as const;
export const CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_KEY_PREFIX = "verdanza:cagnotte-admin:frozen-resolution:v1:";
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

export interface CagnotteAdminFrozenOperationStore {
  key(orderId: string): string;
  resolutionKey(orderId: string): string;
  load(orderId: string): CagnotteAdminFrozenOperationLoadResult;
  loadResolution(orderId: string): CagnotteAdminTerminalResolutionLoadResult;
  loadRecovery(orderId: string): CagnotteAdminRecoveryStorageSnapshot;
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
}): CagnotteAdminFrozenOperationStore {
  const storageProvider = typeof options.storage === "function" ? options.storage : () => options.storage as CagnotteAdminStorageLike;
  const now = options.now ?? Date.now;

  const key = (orderId: string) => `${CAGNOTTE_ADMIN_FROZEN_OPERATION_KEY_PREFIX}${identifier(orderId, 128)}`;
  const resolutionKey = (orderId: string) => `${CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_KEY_PREFIX}${identifier(orderId, 128)}`;

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

  const loadResolution = (orderId: string): CagnotteAdminTerminalResolutionLoadResult => {
    let raw: string | null;
    try {
      raw = storageProvider().getItem(resolutionKey(orderId));
    } catch {
      return { status: "blocked", reason: "unavailable", message: CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE };
    }
    if (raw === null) return { status: "empty" };
    try {
      return { status: "ready", resolution: terminalResolution(JSON.parse(raw), orderId) };
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
    const prior = loadResolution(operation.orderId);
    if (prior.status === "blocked") {
      throw new CagnotteAdminFrozenOperationStorageError(prior.message, prior.reason);
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
      storageProvider().setItem(resolutionKey(operation.orderId), JSON.stringify(resolution));
    } catch {
      throw new CagnotteAdminFrozenOperationStorageError(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE, "unavailable");
    }
    const confirmed = loadResolution(operation.orderId);
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

  return {
    key,
    resolutionKey,
    load,
    loadResolution,
    loadRecovery(orderId) {
      return { frozen: load(orderId), resolution: loadResolution(orderId) };
    },
    persistBeforeSend(operation) {
      const validated = validateForMutation(operation);
      const existing = load(validated.orderId);
      if (existing.status === "ready") {
        throw new CagnotteAdminFrozenOperationStorageError("Une opération précédente reste à confirmer pour cette commande.", "conflict");
      }
      if (existing.status === "blocked") {
        throw new CagnotteAdminFrozenOperationStorageError(existing.message, existing.reason);
      }
      const resolution = loadResolution(validated.orderId);
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
    },
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
      const watchedResolutionKey = resolutionKey(orderId);
      return options.subscribeToStorageChanges?.((changedKey) => {
        if (changedKey === watchedKey || changedKey === watchedResolutionKey) listener();
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

function terminalResolution(value: unknown, expectedOrderId: string): CagnotteAdminTerminalResolution {
  const resolution = strictObject(value, ["schemaVersion", "orderId", "operationFingerprint", "outcome", "resolvedAtEpochMs"]);
  if (resolution.schemaVersion !== CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_SCHEMA_VERSION) throw new Error("Unknown terminal resolution schema");
  const orderId = identifier(resolution.orderId, 128);
  if (orderId !== expectedOrderId) throw new Error("Terminal resolution order mismatch");
  if (typeof resolution.operationFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(resolution.operationFingerprint)) throw new Error("Invalid operation fingerprint");
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

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = BigInt(bytes.length) * 8n;
  for (let index = 0; index < 8; index += 1) padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = ((padded[wordOffset] << 24) | (padded[wordOffset + 1] << 16) | (padded[wordOffset + 2] << 8) | padded[wordOffset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}
