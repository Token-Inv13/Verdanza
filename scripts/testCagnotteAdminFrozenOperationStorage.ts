import { deepEqual, doesNotMatch, equal, match, ok, rejects, throws } from "node:assert/strict";
import {
  freezeCagnotteAdminCorrection,
  freezeCagnotteAdminRefund,
  resolveCagnotteAdminFrozenOperationFromInspection,
  retryCagnotteAdminFrozenOperationDurably,
  sendCagnotteAdminOperationWithDurableRecovery,
  type CagnotteAdminFrozenOperation,
} from "../src/lib/cagnotteAdminController.js";
import {
  CAGNOTTE_ADMIN_FROZEN_OPERATION_KEY_PREFIX,
  CAGNOTTE_ADMIN_STORAGE_INVALID_NOTICE,
  CAGNOTTE_ADMIN_STORAGE_UNAVAILABLE_NOTICE,
  createCagnotteAdminFrozenOperationStore,
  type CagnotteAdminStorageLike,
} from "../src/lib/cagnotteAdminFrozenOperationStorage.js";
import { cagnotteAdminRestoredOperationState, createCagnotteAdminInitialState } from "../src/lib/cagnotteAdminState.js";
import type { CagnotteAdminInspection } from "../src/types/cagnotteAdmin.js";

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
  const exact = inspection(ORDER_A, [{ type: "correction", targetEventId: operation.payload.targetEventId,
    revision: operation.payload.expectedRevision + 1, reference: operation.payload.correctionReference.toUpperCase() }]);
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

console.log(`HOTFIX 4F2-H5 : ${tests} contrôles storage/controller réussis.`);

function makeStore(storage: MemoryStorage, events?: StorageEvents) {
  return createCagnotteAdminFrozenOperationStore({ storage, now: () => NOW, subscribeToStorageChanges: events?.subscribe });
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
  return inspection(operation.orderId, [{ type: "initial_declaration", source: operation.payload.source, reference: operation.payload.reference.toUpperCase() }]);
}
