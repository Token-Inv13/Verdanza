import { deepEqual, doesNotMatch, equal, match, ok, rejects, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_REQUIRED_NOTICE,
  freezeCagnotteAdminCorrection,
  freezeCagnotteAdminRefund,
  reconcileCagnotteAdminFrozenOperationStorage,
  resolveCagnotteAdminFrozenOperationFromInspection,
  retryCagnotteAdminFrozenOperationDurably,
  sendCagnotteAdminOperationWithDurableRecovery,
  type CagnotteAdminFrozenOperation,
} from "../src/lib/cagnotteAdminController.js";
import {
  CAGNOTTE_ADMIN_FROZEN_OPERATION_KEY_PREFIX,
  CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_KEY_PREFIX,
  CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE,
  CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE,
  cagnotteAdminFrozenOperationFingerprint,
  createCagnotteAdminFrozenOperationStore,
  type CagnotteAdminExclusiveClaim,
  type CagnotteAdminStorageLike,
} from "../src/lib/cagnotteAdminFrozenOperationStorage.js";
import {
  cagnotteAdminCorrectionBusinessFingerprint,
  cagnotteAdminRefundBusinessFingerprint,
} from "../src/lib/cagnotteAdminOperationIdentity.js";
import { cagnotteAdminDefinitiveRejectionState, cagnotteAdminInspectionSuccessState, cagnotteAdminRestoredOperationState, cagnotteAdminTerminalReinspectionState, createCagnotteAdminInitialState } from "../src/lib/cagnotteAdminState.js";
import { CagnotteAdminRequestError, readCagnotteAdminResponse } from "../src/services/cagnotteAdminService.js";
import type { CagnotteAdminInspection } from "../src/types/cagnotteAdmin.js";
import { assertCagnotteAdminDurableSendOrdering } from "./cagnotteProductionReadinessAssertions.js";

let tests = 0;
function test(name: string, run: () => void | Promise<void>) {
  return Promise.resolve().then(run).then(() => { tests += 1; console.log(`OK [Admin recovery storage] ${name}`); });
}

class MemoryStorage implements CagnotteAdminStorageLike {
  readonly values = new Map<string, string>();
  readonly calls: string[] = [];
  failGet = false;
  failSet = false;
  failRemove = false;
  silentSet = false;
  silentRemove = false;

  getItem(key: string) {
    this.calls.push(`get:${key}`);
    if (this.failGet) throw new Error("SecurityError");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.calls.push(`set:${key}`);
    if (this.failSet) throw new Error("QuotaExceededError");
    if (!this.silentSet) this.values.set(key, value);
  }
  removeItem(key: string) {
    this.calls.push(`remove:${key}`);
    if (this.failRemove) throw new Error("SecurityError");
    if (!this.silentRemove) this.values.delete(key);
  }
}

class StorageEvents {
  readonly listeners = new Set<(key: string | null) => void>();
  subscribe = (listener: (key: string | null) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  emit(key: string | null) { for (const listener of this.listeners) listener(key); }
}

const immediateClaim: CagnotteAdminExclusiveClaim = {
  request: async (_name, run) => run(),
};
const durableSendFixtureSignature = "export async function sendCagnotteAdminOperationWithDurableRecovery() {";
const durableSendFixtureBoundary = "export async function retryCagnotteAdminFrozenOperationDurably() {}";

class SerialClaims implements CagnotteAdminExclusiveClaim {
  active = false;
  private tails = new Map<string, Promise<void>>();

  async request<T>(name: string, run: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const tail = previous.then(() => current);
    this.tails.set(name, tail);
    await previous;
    this.active = true;
    try {
      return await run();
    } finally {
      this.active = false;
      release();
      if (this.tails.get(name) === tail) this.tails.delete(name);
    }
  }
}

const ORDER_A = "CMD-FICTIVE-A";
const ORDER_B = "CMD-FICTIVE-B";
const NOW = 1_787_500_000_000;

await test("1 persist avant send et confirmation de relecture", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  const order: string[] = [];
  const result = await sendCagnotteAdminOperationWithDurableRecovery(store, operation, async () => {
    order.push("send");
    equal(store.load(ORDER_A).status, "ready");
    ok(storage.calls.some((call) => call.startsWith("set:")));
    return "ok";
  }, () => order.push("persisted"));
  equal(result, "ok");
  deepEqual(order, ["persisted", "send"]);
  const loaded = store.load(ORDER_A);
  equal(loaded.status === "ready" && loaded.record.state, "awaiting_confirmation");
});

await test("2 echec storage avant send interdit tout appel record", async () => {
  const storage = new MemoryStorage();
  storage.failSet = true;
  let sent = 0;
  await rejects(() => sendCagnotteAdminOperationWithDurableRecovery(makeStore(storage), refundOperation(), async () => { sent += 1; }),
    new RegExp(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  equal(sent, 0);
});

await test("3 reload restaure exactement un remboursement", () => {
  const storage = new MemoryStorage();
  makeStore(storage).persistBeforeSend(refundOperation());
  const restored = makeStore(storage).load(ORDER_A);
  equal(restored.status, "ready");
  if (restored.status === "ready") deepEqual(restored.record.operation, refundOperation());
});

await test("4 reload restaure exactement une correction", () => {
  const storage = new MemoryStorage();
  makeStore(storage).persistBeforeSend(correctionOperation());
  const restored = makeStore(storage).load(ORDER_A);
  equal(restored.status, "ready");
  if (restored.status === "ready") deepEqual(restored.record.operation, correctionOperation());
});

await test("5 remount avec nouveau store conserve le verrou", () => {
  const storage = new MemoryStorage();
  let store = makeStore(storage);
  store.persistBeforeSend(refundOperation());
  store = makeStore(storage);
  const restored = store.load(ORDER_A);
  ok(restored.status === "ready");
  const model = cagnotteAdminRestoredOperationState({ ...createCagnotteAdminInitialState(), phase: "ready" }, restored.status === "ready" ? restored.record.operation : refundOperation());
  equal(model.uncertain, true);
  equal(model.pendingOperation?.orderId, ORDER_A);
});

await test("6 navigation A vers B puis A isole les commandes", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  store.persistBeforeSend(refundOperation(ORDER_A));
  equal(store.load(ORDER_B).status, "empty");
  const restored = store.load(ORDER_A);
  equal(restored.status === "ready" && restored.record.operation.orderId, ORDER_A);
});

await test("7 cleanup listener et unmount ne suppriment pas le journal", () => {
  const storage = new MemoryStorage();
  const events = new StorageEvents();
  const store = makeStore(storage, events);
  store.persistBeforeSend(refundOperation());
  const unsubscribe = store.subscribe(ORDER_A, () => undefined);
  unsubscribe();
  equal(store.load(ORDER_A).status, "ready");
  equal(storage.calls.some((call) => call.startsWith("remove:")), false);
});

await test("8 in_flight restaure devient incertain dans le modele", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  store.persistBeforeSend(refundOperation());
  const restored = store.load(ORDER_A);
  ok(restored.status === "ready" && restored.record.state === "in_flight");
  const model = cagnotteAdminRestoredOperationState({ ...createCagnotteAdminInitialState(), phase: "ready" }, restored.status === "ready" ? restored.record.operation : refundOperation());
  equal(model.uncertain, true);
  match(model.notice, /opération précédente reste à confirmer/i);
});

await test("9 inspection sans evenement exact conserve le stockage", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  store.persistBeforeSend(operation);
  equal(resolveCagnotteAdminFrozenOperationFromInspection(store, operation, inspection(ORDER_A, [])), false);
  equal(store.load(ORDER_A).status, "ready");
});

await test("10 inspection avec remboursement exact supprime apres preuve", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  store.persistBeforeSend(operation);
  equal(resolveCagnotteAdminFrozenOperationFromInspection(store, operation, refundInspection(operation)), true);
  equal(store.load(ORDER_A).status, "empty");
});

await test("11 retry exact apres reload reutilise le meme payload", async () => {
  const storage = new MemoryStorage();
  let store = makeStore(storage);
  store.persistBeforeSend(refundOperation());
  store.updateState(refundOperation(), "uncertain");
  store = makeStore(storage);
  const restored = store.load(ORDER_A);
  ok(restored.status === "ready");
  let replayed = "";
  await retryCagnotteAdminFrozenOperationDurably(store, restored.status === "ready" ? restored.record.operation : refundOperation(), ORDER_A, {
    refund: async (payload) => { replayed = JSON.stringify(payload); return { alreadyRecorded: false }; },
    correction: async () => ({ alreadyRecorded: false }),
  });
  equal(replayed, JSON.stringify(refundOperation().payload));
});

await test("12 alreadyRecorded attend inspection exacte avant clear", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  store.persistBeforeSend(operation);
  const result = await retryCagnotteAdminFrozenOperationDurably(store, operation, ORDER_A, {
    refund: async () => ({ alreadyRecorded: true }), correction: async () => ({ alreadyRecorded: true }),
  });
  equal(result.alreadyRecorded, true);
  equal(store.load(ORDER_A).status === "ready" && (store.load(ORDER_A) as { status: "ready"; record: { state: string } }).record.state, "awaiting_confirmation");
  equal(resolveCagnotteAdminFrozenOperationFromInspection(store, operation, inspection(ORDER_A, [])), false);
  equal(store.load(ORDER_A).status, "ready");
  equal(resolveCagnotteAdminFrozenOperationFromInspection(store, operation, refundInspection(operation)), true);
});

await test("13 JSON corrompu reste fail-closed", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  storage.values.set(store.key(ORDER_A), "{invalid");
  const loaded = store.load(ORDER_A);
  equal(loaded.status, "blocked");
  if (loaded.status === "blocked") { equal(loaded.reason, "invalid"); equal(loaded.message, CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE); }
});

await test("14 schemaVersion inconnue reste fail-closed", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  storage.values.set(store.key(ORDER_A), JSON.stringify({ schemaVersion: 2, state: "in_flight", operation: refundOperation(), createdAtEpochMs: NOW }));
  equal(store.load(ORDER_A).status, "blocked");
});

await test("15 mauvais orderId dans la valeur ne sera jamais rejoue", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  storage.values.set(store.key(ORDER_A), JSON.stringify({ schemaVersion: 1, state: "in_flight", operation: refundOperation(ORDER_B), createdAtEpochMs: NOW }));
  const loaded = store.load(ORDER_A);
  equal(loaded.status, "blocked");
  let sent = 0;
  await rejects(() => sendCagnotteAdminOperationWithDurableRecovery(store, refundOperation(ORDER_A), async () => { sent += 1; }));
  equal(sent, 0);
});

await test("16 propriete payload inattendue interdit le rejeu", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation() as CagnotteAdminFrozenOperation & { payload: Record<string, unknown> };
  const malformed = { ...operation, payload: { ...operation.payload, authorization: "Bearer interdit" } };
  storage.values.set(store.key(ORDER_A), JSON.stringify({ schemaVersion: 1, state: "uncertain", operation: malformed, createdAtEpochMs: NOW }));
  equal(store.load(ORDER_A).status, "blocked");
});

await test("17 localStorage inaccessible reste fail-closed", async () => {
  const storage = new MemoryStorage();
  storage.failGet = true;
  const store = makeStore(storage);
  const loaded = store.load(ORDER_A);
  equal(loaded.status, "blocked");
  if (loaded.status === "blocked") equal(loaded.reason, "unavailable");
  let sent = 0;
  await rejects(() => sendCagnotteAdminOperationWithDurableRecovery(store, refundOperation(), async () => { sent += 1; }));
  equal(sent, 0);
});

await test("18 aucun token auth PII ou secret n est persiste", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  store.persistBeforeSend(refundOperation());
  const raw = storage.values.get(store.key(ORDER_A)) ?? "";
  doesNotMatch(raw, /authorization|bearer|authToken|email|customer|cookie|session|password|secret|address|card/i);
  match(raw, /expectedPreviewVersion/);
});

await test("19 autre remboursement ne supprime pas le verrou", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  store.persistBeforeSend(operation);
  const other = inspection(ORDER_A, [{ type: "initial_declaration", source: "admin", reference: "autre-ref" }]);
  equal(resolveCagnotteAdminFrozenOperationFromInspection(store, operation, other), false);
  equal(store.load(ORDER_A).status, "ready");
});

await test("20 autre correction ne supprime pas le verrou", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = correctionOperation();
  store.persistBeforeSend(operation);
  const other = inspection(ORDER_A, [{ type: "correction", targetEventId: operation.payload.targetEventId, revision: operation.payload.expectedRevision + 1, reference: "autre-correction" }]);
  equal(resolveCagnotteAdminFrozenOperationFromInspection(store, operation, other), false);
  equal(store.load(ORDER_A).status, "ready");
});

await test("21 race reload avant commit conserve puis resout une seule operation", async () => {
  const storage = new MemoryStorage();
  const firstStore = makeStore(storage);
  const operation = refundOperation();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let mutationCalls = 0;
  const request = sendCagnotteAdminOperationWithDurableRecovery(firstStore, operation, async () => {
    mutationCalls += 1;
    await gate;
    throw new Error("Réponse perdue après commit");
  });
  const reloadedStore = makeStore(storage);
  const restored = reloadedStore.load(ORDER_A);
  ok(restored.status === "ready" && restored.record.state === "in_flight");
  equal(resolveCagnotteAdminFrozenOperationFromInspection(reloadedStore, operation, inspection(ORDER_A, [])), false);
  release();
  await rejects(() => request, /Réponse perdue/);
  equal(mutationCalls, 1);
  equal(reloadedStore.load(ORDER_A).status, "ready");
  equal(reloadedStore.loadResolution(ORDER_A).status, "empty");
  equal(resolveCagnotteAdminFrozenOperationFromInspection(reloadedStore, operation, refundInspection(operation)), true);
  equal(reloadedStore.load(ORDER_A).status, "empty");
});

await test("22 multi-tab verrouille B et une suppression seule ne le deverrouille pas", () => {
  const storage = new MemoryStorage();
  const events = new StorageEvents();
  const tabA = makeStore(storage, events);
  const tabB = makeStore(storage, events);
  const operation = refundOperation();
  let frozenInB: CagnotteAdminFrozenOperation | null = null;
  const unsubscribe = tabB.subscribe(ORDER_A, () => {
    const loaded = tabB.load(ORDER_A);
    if (loaded.status === "ready") frozenInB = loaded.record.operation;
  });
  tabA.persistBeforeSend(operation);
  events.emit(tabA.key(ORDER_A));
  deepEqual(frozenInB, operation);
  tabA.clearAfterResolution(operation);
  events.emit(tabA.key(ORDER_A));
  deepEqual(frozenInB, operation);
  equal(resolveCagnotteAdminFrozenOperationFromInspection(tabB, frozenInB!, refundInspection(operation)), true);
  frozenInB = null;
  unsubscribe();
  equal(frozenInB, null);
});

await test("23 etats de journal conservent createdAt sans TTL", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  const created = store.persistBeforeSend(operation);
  const uncertain = store.updateState(operation, "uncertain");
  const awaiting = store.updateState(operation, "awaiting_confirmation");
  equal(created.createdAtEpochMs, NOW);
  equal(uncertain.createdAtEpochMs, NOW);
  equal(awaiting.createdAtEpochMs, NOW);
  equal(store.load(ORDER_A).status, "ready");
});

await test("24 echec de suppression apres preuve conserve le verrou", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  store.persistBeforeSend(operation);
  storage.failRemove = true;
  throws(() => resolveCagnotteAdminFrozenOperationFromInspection(store, operation, refundInspection(operation)), /verrou local/);
  storage.failRemove = false;
  equal(store.load(ORDER_A).status, "ready");
});

await test("25 quota silencieux est detecte avant appel reseau", async () => {
  const storage = new MemoryStorage();
  storage.silentSet = true;
  let sent = 0;
  await rejects(() => sendCagnotteAdminOperationWithDurableRecovery(makeStore(storage), refundOperation(), async () => { sent += 1; }), /Aucun enregistrement n’a été envoyé/);
  equal(sent, 0);
});

await test("26 retry correction restauree garde le payload semantiquement identique", async () => {
  const storage = new MemoryStorage();
  let store = makeStore(storage);
  const operation = correctionOperation();
  store.persistBeforeSend(operation);
  store = makeStore(storage);
  const restored = store.load(ORDER_A);
  ok(restored.status === "ready");
  let replayed = "";
  await retryCagnotteAdminFrozenOperationDurably(store, restored.status === "ready" ? restored.record.operation : operation, ORDER_A, {
    refund: async () => ({ alreadyRecorded: false }),
    correction: async (payload) => { replayed = JSON.stringify(payload); return { alreadyRecorded: true }; },
  });
  equal(replayed, JSON.stringify(operation.payload));
});

await test("27 stockage indisponible au retry interdit le nouvel envoi", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  store.persistBeforeSend(operation);
  storage.failSet = true;
  let sent = 0;
  await rejects(() => retryCagnotteAdminFrozenOperationDurably(store, operation, ORDER_A, {
    refund: async () => { sent += 1; return {}; }, correction: async () => ({}),
  }));
  equal(sent, 0);
  storage.failSet = false;
  equal(store.load(ORDER_A).status, "ready");
});

await test("28 cle versionnee distincte par commande", () => {
  const store = makeStore(new MemoryStorage());
  equal(store.key(ORDER_A), `${CAGNOTTE_ADMIN_FROZEN_OPERATION_KEY_PREFIX}${ORDER_A}`);
  ok(store.key(ORDER_A) !== store.key(ORDER_B));
});

await test("29 correction exacte est seule a autoriser le clear", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = correctionOperation();
  store.persistBeforeSend(operation);
  const exact = correctionInspection(operation);
  equal(resolveCagnotteAdminFrozenOperationFromInspection(store, operation, exact), true);
  equal(store.load(ORDER_A).status, "empty");
});

await test("30 arrays bornes et centimes entiers sont valides strictement", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const oversized = refundOperation() as CagnotteAdminFrozenOperation & { payload: { additionalReturns: Array<{ lineId: string; additionalNetCents: number }> } };
  oversized.payload.additionalReturns = Array.from({ length: 201 }, (_, index) => ({ lineId: `line-${index}`, additionalNetCents: 1 }));
  throws(() => store.persistBeforeSend(oversized), /données locales de reprise/i);
  const unsafe = refundOperation() as CagnotteAdminFrozenOperation & { payload: { deliveryRefundCents: number } };
  unsafe.payload.deliveryRefundCents = Number.MAX_SAFE_INTEGER + 1;
  throws(() => store.persistBeforeSend(unsafe), /données locales de reprise/i);
  equal(store.load(ORDER_A).status, "empty");
});

await test("31 premier envoi refund ou correction libere exactement un rejet definitif 400 401 ou 409", async () => {
  for (const operation of [refundOperation(), correctionOperation()]) {
    for (const code of ["refund_payload_invalid", "admin_token_required", operation.kind === "refund" ? "refund_preview_stale" : "correction_preview_stale"]) {
      const storage = new MemoryStorage();
      const store = makeStore(storage);
      let cleared = 0;
      await rejects(() => sendCagnotteAdminOperationWithDurableRecovery(store, operation, async () => {
        throw new CagnotteAdminRequestError(code, code, false);
      }, () => undefined, () => { cleared += 1; }), (error: unknown) => error instanceof CagnotteAdminRequestError && error.code === code);
      equal(cleared, 1, `${operation.kind}:${code}`);
      equal(store.load(operation.orderId).status, "empty", `${operation.kind}:${code}`);
      const resolution = store.loadResolution(operation.orderId);
      equal(resolution.status === "ready" && resolution.resolution.outcome, "definitive_rejection", `${operation.kind}:${code}`);
      const refreshed = operation.kind === "refund"
        ? freezeCagnotteAdminRefund({ ...operation.payload, reference: `${operation.payload.reference}-next`, expectedPreviewVersion: "e".repeat(64) })
        : freezeCagnotteAdminCorrection({ ...operation.payload, correctionReference: `${operation.payload.correctionReference}-next`, expectedPreviewVersion: "f".repeat(64) });
      equal(await sendCagnotteAdminOperationWithDurableRecovery(store, refreshed, async () => "accepted"), "accepted");
      equal(store.load(operation.orderId).status, "ready");
      store.clearAfterResolution(refreshed);
    }
  }
});

await test("32 rejet definitif invalide les previews et deverrouille le modele", () => {
  const operation = refundOperation();
  const state = cagnotteAdminDefinitiveRejectionState({
    ...createCagnotteAdminInitialState(),
    phase: "ready",
    refundPreview: {} as never,
    correctionPreview: {} as never,
    uncertain: true,
    pendingOperation: operation,
    recoveryBlocked: true,
  }, new CagnotteAdminRequestError("Prévisualisation périmée.", "refund_preview_stale", false));
  equal(state.phase, "ready");
  equal(state.refundPreview, null);
  equal(state.correctionPreview, null);
  equal(state.uncertain, false);
  equal(state.pendingOperation, null);
  equal(state.recoveryBlocked, false);
  match(state.notice, /périmée/i);
});

await test("33 echec de suppression apres rejet definitif conserve le verrou fail closed", async () => {
  for (const operation of [refundOperation(), correctionOperation()]) {
    for (const failure of ["throw", "silent"] as const) {
      const storage = new MemoryStorage();
      const store = makeStore(storage);
      let cleared = 0;
      if (failure === "throw") storage.failRemove = true;
      else storage.silentRemove = true;
      await rejects(() => sendCagnotteAdminOperationWithDurableRecovery(store, operation, async () => {
        throw new CagnotteAdminRequestError("Conflit définitif.", "conflict", false);
      }, () => undefined, () => { cleared += 1; }), /verrou local/);
      storage.failRemove = false;
      storage.silentRemove = false;
      equal(cleared, 0);
      equal(store.load(operation.orderId).status, "ready");
    }
  }
});

await test("34 retry deja incertain reste verrouille sur auth refus reseau et serveur", async () => {
  for (const operation of [refundOperation(), correctionOperation()]) {
    for (const [code, uncertain] of [["admin_token_required", false], ["admin_required", false], ["request_failed", true], ["server_unavailable", true], ["response_unknown", true]] as const) {
      const storage = new MemoryStorage();
      const store = makeStore(storage);
      store.persistBeforeSend(operation);
      store.updateState(operation, "uncertain");
      await rejects(() => retryCagnotteAdminFrozenOperationDurably(store, operation, operation.orderId, {
        refund: async () => {
          const during = store.load(operation.orderId);
          equal(during.status === "ready" && during.record.state, "uncertain");
          throw new CagnotteAdminRequestError(code, code, uncertain);
        },
        correction: async () => {
          const during = store.load(operation.orderId);
          equal(during.status === "ready" && during.record.state, "uncertain");
          throw new CagnotteAdminRequestError(code, code, uncertain);
        },
      }), (error: unknown) => error instanceof CagnotteAdminRequestError && error.code === code);
      const after = store.load(operation.orderId);
      equal(after.status === "ready" && after.record.state, "uncertain", `${operation.kind}:${code}`);
      equal(store.loadResolution(operation.orderId).status, "empty", `${operation.kind}:${code}`);
    }
  }
});

await test("35 retry exact perime est terminal et exige une nouvelle preview", async () => {
  for (const operation of [refundOperation(), correctionOperation()]) {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    store.persistBeforeSend(operation);
    store.updateState(operation, "uncertain");
    const code = operation.kind === "refund" ? "refund_preview_stale" : "correction_preview_stale";
    let cleared = 0;
    await rejects(() => retryCagnotteAdminFrozenOperationDurably(store, operation, operation.orderId, {
      refund: async () => { throw new CagnotteAdminRequestError("Prévisualisation périmée.", code, false); },
      correction: async () => { throw new CagnotteAdminRequestError("Prévisualisation périmée.", code, false); },
    }, () => { cleared += 1; }), (error: unknown) => error instanceof CagnotteAdminRequestError && error.code === code);
    equal(cleared, 1);
    equal(store.load(operation.orderId).status, "empty");
    equal(store.loadResolution(operation.orderId).status, "ready");
    const next = operation.kind === "refund"
      ? freezeCagnotteAdminRefund({ ...operation.payload, reference: `${operation.payload.reference}-fresh`, expectedPreviewVersion: "e".repeat(64) })
      : freezeCagnotteAdminCorrection({ ...operation.payload, correctionReference: `${operation.payload.correctionReference}-fresh`, expectedPreviewVersion: "f".repeat(64) });
    equal(await sendCagnotteAdminOperationWithDurableRecovery(store, next, async () => "accepted"), "accepted");
    store.clearAfterResolution(next);
  }
});

await test("H10 retry exact en conflit d idempotence libere le frozen et reconcilie l autre onglet", async () => {
  for (const operation of [refundOperation(), correctionOperation()]) {
    const storage = new MemoryStorage();
    const tabA = makeStore(storage);
    const tabB = makeStore(storage);
    tabA.persistBeforeSend(operation);
    tabA.updateState(operation, "uncertain");
    const restored = tabB.load(operation.orderId);
    ok(restored.status === "ready");
    const current = restored.status === "ready" ? restored.record.operation : operation;
    const code = operation.kind === "refund" ? "refund_event_conflict" : "correction_event_conflict";
    let cleared = 0;

    await rejects(() => retryCagnotteAdminFrozenOperationDurably(tabA, operation, operation.orderId, {
      refund: async () => { throw new CagnotteAdminRequestError("Conflit d’idempotence.", code, false); },
      correction: async () => { throw new CagnotteAdminRequestError("Conflit d’idempotence.", code, false); },
    }, () => { cleared += 1; }), (error: unknown) => error instanceof CagnotteAdminRequestError && error.code === code);

    equal(cleared, 1, operation.kind);
    equal(tabA.load(operation.orderId).status, "empty", operation.kind);
    const resolution = tabA.loadResolution(operation.orderId);
    equal(resolution.status === "ready" && resolution.resolution.outcome, "definitive_rejection", operation.kind);
    equal(reconcileCagnotteAdminFrozenOperationStorage(tabB, operation.orderId, current, null).status, "definitive_rejection", operation.kind);

    const awaitingInspection = cagnotteAdminTerminalReinspectionState({
      ...createCagnotteAdminInitialState(), phase: "ready", refundPreview: {} as never, correctionPreview: {} as never,
      uncertain: true, pendingOperation: current,
    }, "Réinspection serveur en cours.");
    equal(awaitingInspection.refundPreview, null);
    equal(awaitingInspection.correctionPreview, null);
    equal(awaitingInspection.pendingOperation, null);
    equal(awaitingInspection.uncertain, true);
    const ready = cagnotteAdminInspectionSuccessState(awaitingInspection, inspection(operation.orderId, []));
    equal(ready.phase, "ready");
    equal(ready.uncertain, false);

    const next = operation.kind === "refund"
      ? freezeCagnotteAdminRefund({ ...operation.payload, reference: `${operation.payload.reference}-after-conflict`, expectedPreviewVersion: "e".repeat(64) })
      : freezeCagnotteAdminCorrection({ ...operation.payload, correctionReference: `${operation.payload.correctionReference}-after-conflict`, expectedPreviewVersion: "f".repeat(64) });
    equal(await sendCagnotteAdminOperationWithDurableRecovery(tabA, next, async () => "accepted"), "accepted");
    tabA.clearAfterResolution(next);
  }
});

await test("36 reponse 2xx malformee ou sans resultat garde refund et correction incertains", async () => {
  const responses = [
    () => new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
    () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    () => new Response('{"result":null}', { status: 200, headers: { "content-type": "application/json" } }),
    () => new Response('{"result":[]}', { status: 200, headers: { "content-type": "application/json" } }),
  ];
  for (const operation of [refundOperation(), correctionOperation()]) {
    for (const response of responses) {
      const storage = new MemoryStorage();
      const store = makeStore(storage);
      await rejects(() => sendCagnotteAdminOperationWithDurableRecovery(store, operation,
        async () => readCagnotteAdminResponse<Record<string, unknown>>(response())),
      (error: unknown) => error instanceof CagnotteAdminRequestError && error.code === "response_invalid" && error.uncertain);
      const frozen = store.load(operation.orderId);
      equal(frozen.status === "ready" && frozen.record.state, "uncertain");
      await rejects(() => retryCagnotteAdminFrozenOperationDurably(store, operation, operation.orderId, {
        refund: async () => readCagnotteAdminResponse<Record<string, unknown>>(response()),
        correction: async () => readCagnotteAdminResponse<Record<string, unknown>>(response()),
      }), (error: unknown) => error instanceof CagnotteAdminRequestError && error.code === "response_invalid" && error.uncertain);
      const afterRetry = store.load(operation.orderId);
      equal(afterRetry.status === "ready" && afterRetry.record.state, "uncertain");
      equal(store.loadResolution(operation.orderId).status, "empty");
    }
  }
});

await test("37 claim inter onglets est atomique et libere avant HTTP", async () => {
  const storage = new MemoryStorage();
  const claims = new SerialClaims();
  const tabA = makeStore(storage, undefined, claims);
  const tabB = makeStore(storage, undefined, claims);
  const firstOperation = refundOperation();
  const secondOperation = freezeCagnotteAdminRefund({ ...firstOperation.payload, reference: "refund-concurrent-tab" });
  let releaseSend!: () => void;
  let enteredSend!: () => void;
  const entered = new Promise<void>((resolvePromise) => { enteredSend = resolvePromise; });
  const hold = new Promise<void>((resolvePromise) => { releaseSend = resolvePromise; });
  let sends = 0;
  const first = sendCagnotteAdminOperationWithDurableRecovery(tabA, firstOperation, async () => {
    sends += 1;
    equal(claims.active, false);
    enteredSend();
    await hold;
    return "accepted";
  });
  await entered;
  const second = sendCagnotteAdminOperationWithDurableRecovery(tabB, secondOperation, async () => { sends += 1; return "unexpected"; });
  await rejects(() => second, /opération précédente/i);
  equal(sends, 1);
  releaseSend();
  equal(await first, "accepted");
});

await test("38 absence de Web Locks echoue ferme avant HTTP", async () => {
  const storage = new MemoryStorage();
  const store = createCagnotteAdminFrozenOperationStore({ storage, now: () => NOW });
  let sends = 0;
  await rejects(() => sendCagnotteAdminOperationWithDurableRecovery(store, refundOperation(), async () => { sends += 1; }),
    new RegExp(CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  equal(sends, 0);
  equal(store.load(ORDER_A).status, "empty");
});

await test("39 resolution exige l empreinte metier complete et ignore seulement la version de preview", () => {
  for (const operation of [refundOperation(), correctionOperation()]) {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    store.persistBeforeSend(operation);
    const changed = operation.kind === "refund"
      ? freezeCagnotteAdminRefund({ ...operation.payload, additionalReturns: [{ ...operation.payload.additionalReturns[0], additionalNetCents: 2400 }] })
      : freezeCagnotteAdminCorrection({ ...operation.payload, declaredFinancialCents: operation.payload.declaredFinancialCents + 1 });
    const wrong = operation.kind === "refund" ? refundInspection(changed as ReturnType<typeof refundOperation>) : correctionInspection(changed as ReturnType<typeof correctionOperation>);
    equal(resolveCagnotteAdminFrozenOperationFromInspection(store, operation, wrong), false);
    const refreshed = operation.kind === "refund"
      ? freezeCagnotteAdminRefund({ ...operation.payload, expectedPreviewVersion: "9".repeat(64) })
      : freezeCagnotteAdminCorrection({ ...operation.payload, expectedPreviewVersion: "8".repeat(64) });
    const originalFingerprint = operation.kind === "refund"
      ? cagnotteAdminRefundBusinessFingerprint(operation.payload)
      : cagnotteAdminCorrectionBusinessFingerprint(operation.payload);
    const refreshedFingerprint = refreshed.kind === "refund"
      ? cagnotteAdminRefundBusinessFingerprint(refreshed.payload)
      : cagnotteAdminCorrectionBusinessFingerprint(refreshed.payload);
    equal(originalFingerprint, refreshedFingerprint);
    const exact = operation.kind === "refund" ? refundInspection(operation) : correctionInspection(operation);
    equal(resolveCagnotteAdminFrozenOperationFromInspection(store, operation, exact), true);
  }
});

await test("40 marqueur terminal versionne contient seulement empreinte resultat et horodatage", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  store.persistBeforeSend(operation);
  store.clearAfterDefinitiveRejection(operation);
  equal(store.resolutionKey(ORDER_A), `${CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_KEY_PREFIX}${ORDER_A}`);
  const raw = storage.values.get(store.resolutionKey(ORDER_A)) ?? "";
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  deepEqual(Object.keys(parsed).sort(), ["operationFingerprint", "orderId", "outcome", "resolvedAtEpochMs", "schemaVersion"]);
  equal(parsed.outcome, "definitive_rejection");
  equal(parsed.resolvedAtEpochMs, NOW);
  equal(parsed.operationFingerprint, createHash("sha256").update(stableForTest(operation)).digest("hex"));
  equal(cagnotteAdminFrozenOperationFingerprint(operation), parsed.operationFingerprint);
  doesNotMatch(raw, /additionalReturns|reference|confirmedAt|previewVersion|authorization|bearer|email|customer|cookie|session|password|secret/i);
});

await test("36 rejet definitif A vers B libere refund et correction apres reinspection fraiche", () => {
  for (const operation of [refundOperation(), correctionOperation()]) {
    const storage = new MemoryStorage();
    const tabA = makeStore(storage);
    const tabB = makeStore(storage);
    tabA.persistBeforeSend(operation);
    const restored = tabB.load(operation.orderId);
    ok(restored.status === "ready");
    const current = restored.status === "ready" ? restored.record.operation : operation;
    tabA.clearAfterDefinitiveRejection(operation);
    equal(reconcileCagnotteAdminFrozenOperationStorage(tabB, operation.orderId, current, null).status, "definitive_rejection");
    const awaitingInspection = cagnotteAdminTerminalReinspectionState({
      ...createCagnotteAdminInitialState(), phase: "ready", refundPreview: {} as never, correctionPreview: {} as never,
      uncertain: true, pendingOperation: current,
    }, "Réinspection serveur en cours.");
    equal(awaitingInspection.phase, "loading");
    equal(awaitingInspection.refundPreview, null);
    equal(awaitingInspection.correctionPreview, null);
    equal(awaitingInspection.pendingOperation, null);
    equal(awaitingInspection.uncertain, true);
    const ready = cagnotteAdminInspectionSuccessState(awaitingInspection, inspection(operation.orderId, []));
    equal(ready.phase, "ready");
    equal(ready.uncertain, false);
  }
});

await test("37 resolution recorded conserve l operation jusqu a la preuve serveur exacte", () => {
  for (const operation of [refundOperation(), correctionOperation()]) {
    const storage = new MemoryStorage();
    const tabA = makeStore(storage);
    const tabB = makeStore(storage);
    tabA.persistBeforeSend(operation);
    tabA.clearAfterResolution(operation);
    equal(reconcileCagnotteAdminFrozenOperationStorage(tabB, operation.orderId, operation, null).status, "recorded");
    equal(resolveCagnotteAdminFrozenOperationFromInspection(tabB, operation, inspection(operation.orderId, [])), false);
    const exact = operation.kind === "refund"
      ? refundInspection(operation)
      : correctionInspection(operation);
    equal(resolveCagnotteAdminFrozenOperationFromInspection(tabB, operation, exact), true);
  }
});

await test("38 suppression simple sans marqueur ne deverrouille jamais", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  store.persistBeforeSend(operation);
  storage.values.delete(store.key(ORDER_A));
  const result = reconcileCagnotteAdminFrozenOperationStorage(store, ORDER_A, operation, null);
  equal(result.status, "blocked");
  if (result.status === "blocked") equal(result.message, CAGNOTTE_ADMIN_TERMINAL_RESOLUTION_REQUIRED_NOTICE);
});

await test("39 un ancien marqueur exact pour X ne deverrouille pas une nouvelle operation Y", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operationX = refundOperation();
  const operationY = freezeCagnotteAdminRefund({ ...operationX.payload, reference: "refund-h7-operation-y" });
  store.persistBeforeSend(operationX);
  store.clearAfterDefinitiveRejection(operationX);
  store.persistBeforeSend(operationY);
  storage.values.delete(store.key(ORDER_A));
  equal(reconcileCagnotteAdminFrozenOperationStorage(store, ORDER_A, operationY, null).status, "blocked");
});

await test("40 marqueur d une autre commande est invalide et fail closed", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  storage.values.set(store.resolutionKey(ORDER_A), JSON.stringify({
    schemaVersion: 1, orderId: ORDER_B, operationFingerprint: cagnotteAdminFrozenOperationFingerprint(refundOperation(ORDER_B)),
    outcome: "definitive_rejection", resolvedAtEpochMs: NOW,
  }));
  equal(store.loadResolution(ORDER_A).status, "blocked");
  equal(reconcileCagnotteAdminFrozenOperationStorage(store, ORDER_A, refundOperation(), null).status, "blocked");
});

await test("41 marqueur corrompu schema outcome ou empreinte inconnus reste fail closed", () => {
  const operation = refundOperation();
  const invalidValues = [
    "{invalid",
    JSON.stringify({ schemaVersion: 2, orderId: ORDER_A, operationFingerprint: "a".repeat(64), outcome: "definitive_rejection", resolvedAtEpochMs: NOW }),
    JSON.stringify({ schemaVersion: 1, orderId: ORDER_A, operationFingerprint: "a".repeat(64), outcome: "unknown", resolvedAtEpochMs: NOW }),
    JSON.stringify({ schemaVersion: 1, orderId: ORDER_A, operationFingerprint: "not-a-hash", outcome: "recorded", resolvedAtEpochMs: NOW }),
  ];
  for (const raw of invalidValues) {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    storage.values.set(store.resolutionKey(ORDER_A), raw);
    equal(reconcileCagnotteAdminFrozenOperationStorage(store, ORDER_A, operation, null).status, "blocked");
  }
});

await test("42 ordre des evenements storage ne change pas la resolution finale", () => {
  for (const eventOrder of [["resolution", "frozen"], ["frozen", "resolution"]] as const) {
    const storage = new MemoryStorage();
    const events = new StorageEvents();
    const tabA = makeStore(storage, events);
    const tabB = makeStore(storage, events);
    const operation = refundOperation();
    tabA.persistBeforeSend(operation);
    let lastStatus = "";
    const unsubscribe = tabB.subscribe(ORDER_A, () => {
      lastStatus = reconcileCagnotteAdminFrozenOperationStorage(tabB, ORDER_A, operation, null).status;
    });
    tabA.clearAfterDefinitiveRejection(operation);
    for (const event of eventOrder) events.emit(event === "resolution" ? tabA.resolutionKey(ORDER_A) : tabA.key(ORDER_A));
    equal(lastStatus, "definitive_rejection");
    unsubscribe();
  }
});

await test("43 marker observe avant suppression laisse le frozen autoritaire", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const operation = refundOperation();
  store.persistBeforeSend(operation);
  storage.values.set(store.resolutionKey(ORDER_A), JSON.stringify({
    schemaVersion: 1, orderId: ORDER_A, operationFingerprint: cagnotteAdminFrozenOperationFingerprint(operation),
    outcome: "definitive_rejection", resolvedAtEpochMs: NOW,
  }));
  equal(reconcileCagnotteAdminFrozenOperationStorage(store, ORDER_A, operation, null).status, "frozen");
  storage.values.delete(store.key(ORDER_A));
  equal(reconcileCagnotteAdminFrozenOperationStorage(store, ORDER_A, operation, null).status, "definitive_rejection");
});

await test("44 evenement terminal pendant requete en vol est differe puis traite", () => {
  const storage = new MemoryStorage();
  const tabA = makeStore(storage);
  const tabB = makeStore(storage);
  const operation = correctionOperation();
  tabA.persistBeforeSend(operation);
  tabA.clearAfterDefinitiveRejection(operation);
  equal(reconcileCagnotteAdminFrozenOperationStorage(tabB, ORDER_A, operation, operation).status, "deferred");
  equal(reconcileCagnotteAdminFrozenOperationStorage(tabB, ORDER_A, operation, null).status, "definitive_rejection");
});

await test("45 echec ou silence d ecriture du marqueur conserve le verrou", () => {
  for (const failure of ["throw", "silent"] as const) {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    const operation = refundOperation();
    store.persistBeforeSend(operation);
    if (failure === "throw") storage.failSet = true;
    else storage.silentSet = true;
    throws(() => store.clearAfterDefinitiveRejection(operation), /enregistrement|reprise/i);
    storage.failSet = false;
    storage.silentSet = false;
    equal(store.load(ORDER_A).status, "ready");
    equal(store.loadResolution(ORDER_A).status, "empty");
  }
});

await test("46 lecture indisponible du snapshot de reprise reste fail closed", () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  storage.failGet = true;
  equal(reconcileCagnotteAdminFrozenOperationStorage(store, ORDER_A, refundOperation(), null).status, "blocked");
});

await test("H10 readiness refuse claim absent tardif ou ancien persist seul", () => {
  const fixture = (body: string) => `${durableSendFixtureSignature}\n${body}\n}\n${durableSendFixtureBoundary}`;
  const positive = fixture("await store.claimBeforeSend(operation);\nonPersisted(operation);\nconst result = await send(operation);");
  const indices = assertCagnotteAdminDurableSendOrdering(positive);
  ok(indices.claimIndex < indices.persistedCallbackIndex && indices.persistedCallbackIndex < indices.sendIndex);

  throws(() => assertCagnotteAdminDurableSendOrdering(fixture("onPersisted(operation);\nconst result = await send(operation);")), /claimBeforeSend/);
  throws(() => assertCagnotteAdminDurableSendOrdering(fixture("onPersisted(operation);\nconst result = await send(operation);\nawait store.claimBeforeSend(operation);")), /doit précéder/);
  throws(() => assertCagnotteAdminDurableSendOrdering(fixture("store.persistBeforeSend(operation);\nonPersisted(operation);\nconst result = await send(operation);")), /claimBeforeSend/);
  throws(() => assertCagnotteAdminDurableSendOrdering(fixture("// await store.claimBeforeSend(operation);\nonPersisted(operation);\nconst result = await send(operation);")), /claimBeforeSend/);
});

console.log(`HOTFIX 4F2-H10 : ${tests} contrôles storage/controller réussis.`);

function makeStore(storage: MemoryStorage, events?: StorageEvents, exclusiveClaim: CagnotteAdminExclusiveClaim = immediateClaim) {
  return createCagnotteAdminFrozenOperationStore({ storage, now: () => NOW, subscribeToStorageChanges: events?.subscribe, exclusiveClaim });
}

function refundOperation(orderId = ORDER_A) {
  return freezeCagnotteAdminRefund({
    orderId,
    additionalReturns: [{ lineId: "line-1", additionalNetCents: 2500 }],
    deliveryRefundCents: 400,
    source: "admin",
    reference: "refund-h5-fixture",
    declaredFinancialCents: 2900,
    reason: "product_return",
    confirmedAt: "2026-09-09T10:00:00.000Z",
    expectedPreviewVersion: "c".repeat(64),
  });
}

function correctionOperation(orderId = ORDER_A) {
  return freezeCagnotteAdminCorrection({
    orderId,
    targetEventId: "a".repeat(64),
    expectedRevision: 1,
    replacementReturns: [{ lineId: "line-1", additionalNetCents: 2000 }],
    deliveryRefundCents: 300,
    declaredFinancialCents: 2300,
    correctionReason: "Correction fixture H5",
    correctionReference: "correction-h5-fixture",
    expectedPreviewVersion: "d".repeat(64),
  });
}

function inspection(orderId: string, history: Array<Record<string, unknown>>) {
  return { order: { id: orderId }, history } as unknown as CagnotteAdminInspection;
}

function refundInspection(operation: ReturnType<typeof refundOperation>) {
  return inspection(operation.orderId, [{ type: "initial_declaration", source: operation.payload.source, reference: operation.payload.reference.toUpperCase(),
    businessFingerprint: cagnotteAdminRefundBusinessFingerprint(operation.payload) }]);
}

function correctionInspection(operation: ReturnType<typeof correctionOperation>) {
  return inspection(operation.orderId, [{ type: "correction", targetEventId: operation.payload.targetEventId,
    revision: operation.payload.expectedRevision + 1, reference: operation.payload.correctionReference.toUpperCase(),
    businessFingerprint: cagnotteAdminCorrectionBusinessFingerprint(operation.payload) }]);
}

function stableForTest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableForTest).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableForTest(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
