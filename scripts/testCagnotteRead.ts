import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CAGNOTTE_SERVER_PROGRAM } from "../api/_server/cagnotteProgram.js";
import { CAGNOTTE_READ_MAX_LIMIT, CagnotteReadError, readCagnotte } from "../api/_server/cagnotteRead.js";
import { createCagnotteReadHandler } from "../api/_server/cagnotteReadRoute.js";
import { CAGNOTTE_REGULARIZATION_VERSION, CAGNOTTE_RESERVATION_VERSION } from "../api/_server/cagnotteLedgerTypes.js";
import { assertCagnotteEmulatorAvailable, CAGNOTTE_DEMO, connectCagnotteEmulator, validateCagnotteTestEnvironment } from "./cagnotteEmulator.js";

validateCagnotteTestEnvironment(process.env);
await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const collections = ["adminUsers", "cagnotteWallets", "cagnotteMovements"];
const cursorSecret = "local-only-cagnotte-cursor-secret-0001";

class FakeResponse {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, unknown>();
  setHeader(name: string, value: unknown) { this.headers.set(name, value); }
  status(code: number) { this.statusCode = code; return this; }
  json(value: unknown) { this.body = value; }
}

try {
  await clear();
  assert.equal(CAGNOTTE_SERVER_PROGRAM, null, "la suspension des gains reste indépendante de la lecture");

  let getDbCalls = 0;
  let readCalls = 0;
  let verifyCalls = 0;
  const disabled = createCagnotteReadHandler({
    enabled: false,
    getDb: () => { getDbCalls += 1; return db; },
    verifyToken: async () => { verifyCalls += 1; return { uid: "self", email: null }; },
    read: async () => { readCalls += 1; return emptyResponse(); },
    cursorSecret: () => cursorSecret,
  });
  const disabledResponse = new FakeResponse();
  await disabled(request("GET", "/api/cagnotte?scope=self", "token"), disabledResponse as never);
  assert.equal(disabledResponse.statusCode, 503);
  assert.equal(disabledResponse.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual([getDbCalls, verifyCalls, readCalls], [0, 0, 0]);

  const methodResponse = new FakeResponse();
  await disabled(request("POST", "/api/cagnotte?scope=self", "token"), methodResponse as never);
  assert.equal(methodResponse.statusCode, 405);

  const handler = createCagnotteReadHandler({ enabled: true, getDb: () => db,
    verifyToken: async (token) => {
      verifyCalls += 1;
      if (token === "expired") throw new Error("TOKEN_EXPIRED");
      return token === "admin" ? { uid: "admin-1", email: "admin@example.test", emailVerified: true }
        : { uid: "self", email: "self@example.test", emailVerified: true };
    },
    read: async (input) => { readCalls += 1; return readCagnotte(input); },
    cursorSecret: () => cursorSecret,
    capabilities: { canRequestReservation: true, canAccrueLoyalty: false },
  });

  const anonymous = new FakeResponse();
  await handler(request("GET", "/api/cagnotte?scope=self"), anonymous as never);
  assert.equal(anonymous.statusCode, 401);

  const expired = new FakeResponse();
  const beforeExpiredRead = readCalls;
  await handler(request("GET", "/api/cagnotte?scope=self", "expired"), expired as never);
  assert.equal(expired.statusCode, 401);
  assert.equal(readCalls, beforeExpiredRead, "un jeton refusé ne joint pas le service métier");

  const foreign = new FakeResponse();
  const beforeForeignVerify = verifyCalls;
  await handler(request("GET", "/api/cagnotte?scope=self&targetUid=other", "self"), foreign as never);
  assert.equal(foreign.statusCode, 403);
  assert.equal(verifyCalls, beforeForeignVerify);

  await seedWallet("self", 1234, 567, 0);
  await seedMovement("self-pay", "self", 1000, "payment_confirmed", 567, 0, 0, {
    payload: "sensitive-event-key", adminUid: "private-admin", refundReference: "private-refund", orderSnapshot: { address: "private" },
  });
  const selfResponse = new FakeResponse();
  await handler(request("GET", "/api/cagnotte?scope=self", "self"), selfResponse as never);
  assert.equal(selfResponse.statusCode, 200);
  assert.equal((selfResponse.body as ReturnType<typeof emptyResponse>).wallet.availableCents, 1234);
  assert.deepEqual((selfResponse.body as ReturnType<typeof emptyResponse>).capabilities, {
    canReadWallet: true,
    canRequestReservation: true,
    canAccrueLoyalty: false,
  }, "la suspension des gains reste distincte de la capacité de réservation");
  const serialized = JSON.stringify(selfResponse.body);
  for (const secret of ["self-pay", "sensitive-event-key", "private-admin", "private-refund", "orderSnapshot", "beneficiaryId", "programVersion"]) {
    assert.equal(serialized.includes(secret), false, `champ interne exposé: ${secret}`);
  }

  await db.collection("adminUsers").doc("admin-1").set({ isActive: true });
  await seedWallet("target", 2222, 0, 0);
  await seedMovement("target-pay", "target", 900, "payment_confirmed", 2222, 0, 0);
  const adminResponse = new FakeResponse();
  await handler(request("GET", "/api/cagnotte?scope=admin&targetUid=target", "admin"), adminResponse as never);
  assert.equal(adminResponse.statusCode, 200);
  assert.equal((adminResponse.body as ReturnType<typeof emptyResponse>).wallet.availableCents, 2222);

  const nonAdminResponse = new FakeResponse();
  const beforeNonAdminRead = readCalls;
  await handler(request("GET", "/api/cagnotte?scope=admin&targetUid=target&role=owner&email=owner@example.test", "self"), nonAdminResponse as never);
  assert.equal(nonAdminResponse.statusCode, 403);
  assert.equal(readCalls, beforeNonAdminRead, "le contrôle admin précède la lecture cible");
  const duplicatedTarget = new FakeResponse();
  await handler(request("GET", "/api/cagnotte?scope=admin&targetUid=target&targetUid=self", "admin"), duplicatedTarget as never);
  assert.equal(duplicatedTarget.statusCode, 400);

  await clear();
  const absent = await readCagnotte({ db, beneficiaryId: "absent", scope: "self", cursorSecret });
  assert.deepEqual(absent.wallet, { status: "not_created", availableCents: 0, pendingCents: 0, reservedCents: 0, regularizationCents: 0 });
  assert.deepEqual(absent.history, { items: [], nextCursor: null, completeness: "timestamped_movements_only", limitation: "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet." });

  await seedWallet("legacy", 80, 20, 0, 1);
  await seedMovement("legacy-pay", "legacy", 50, "payment_confirmed", 20, 0, 0);
  const legacyMovement = (await db.collection("cagnotteMovements").doc("legacy-pay").get()).data()!;
  delete legacyMovement.regularizationVersion;
  delete legacyMovement.regularizationDeltaCents;
  delete legacyMovement.reservationVersion;
  delete legacyMovement.reservedDeltaCents;
  legacyMovement.schemaVersion = 1;
  await db.collection("cagnotteMovements").doc("legacy-pay").set(legacyMovement);
  const legacy = await readCagnotte({ db, beneficiaryId: "legacy", scope: "self", cursorSecret });
  assert.deepEqual(legacy.wallet, { status: "active", availableCents: 80, pendingCents: 20, reservedCents: 0, regularizationCents: 0 });
  assert.equal(legacy.history.items.length, 1);
  await db.collection("cagnotteWallets").doc("legacy").set({ ...(await db.collection("cagnotteWallets").doc("legacy").get()).data(), schemaVersion: 99 });
  await assert.rejects(() => readCagnotte({ db, beneficiaryId: "legacy", scope: "self", cursorSecret }), (error: unknown) => error instanceof CagnotteReadError && error.code === "inconsistent_data");

  await clear();
  await seedMovement("orphan", "orphan-user", 100, "payment_confirmed", 100, 0, 0);
  const orphanMovement = (await db.collection("cagnotteMovements").doc("orphan").get()).data()!;
  delete orphanMovement.recordedAtEpochMs;
  await db.collection("cagnotteMovements").doc("orphan").set(orphanMovement);
  await assert.rejects(() => readCagnotte({ db, beneficiaryId: "orphan-user", scope: "self", cursorSecret }), /Historique présent sans portefeuille/);

  await clear();
  await seedWallet("pages", 300, 0, 0);
  await seedWallet("other", 9999, 0, 0);
  await seedMovement("c-money", "pages", 5000, "payment_confirmed", 103, 0, 0);
  await seedMovement("b-money", "pages", 5000, "payment_confirmed", 102, 0, 0);
  await seedMovement("a-money", "pages", 5000, "payment_confirmed", 101, 0, 0);
  await seedMovement("z-private", "other", 9999, "payment_confirmed", 9999, 0, 0);
  const firstServiceInstance = { read: readCagnotte };
  const secondServiceInstance = { read: readCagnotte };
  assert.notEqual(firstServiceInstance, secondServiceInstance);
  const page1 = await firstServiceInstance.read({ db, beneficiaryId: "pages", scope: "self", limit: 2, cursorSecret });
  assert.deepEqual(page1.history.items.map((item) => item.amountCents), [103, 102]);
  assert.ok(page1.history.nextCursor);
  assert.equal(page1.history.nextCursor!.includes("c-money"), false);
  const page2 = await secondServiceInstance.read({ db, beneficiaryId: "pages", scope: "self", limit: 2, cursor: page1.history.nextCursor!, cursorSecret });
  assert.deepEqual(page2.history.items.map((item) => item.amountCents), [101]);
  assert.equal(new Set([...page1.history.items, ...page2.history.items].map((item) => item.amountCents)).size, 3);
  assert.equal(JSON.stringify([page1, page2]).includes("z-private"), false);
  await assert.rejects(() => readCagnotte({ db, beneficiaryId: "other", scope: "self", limit: 2, cursor: page1.history.nextCursor!, cursorSecret }), /Curseur invalide/);
  await assert.rejects(() => readCagnotte({ db, beneficiaryId: "pages", scope: "admin", limit: 2, cursor: page1.history.nextCursor!, cursorSecret }), /Curseur invalide/);
  await assert.rejects(() => readCagnotte({ db, beneficiaryId: "pages", scope: "self", limit: 2, cursor: page1.history.nextCursor!, cursorSecret: "other-local-only-cagnotte-secret-0002" }), /Curseur invalide/);
  await assert.rejects(() => readCagnotte({ db, beneficiaryId: "pages", scope: "self", limit: 0, cursorSecret }), /Limite invalide/);
  await assert.rejects(() => readCagnotte({ db, beneficiaryId: "pages", scope: "self", limit: CAGNOTTE_READ_MAX_LIMIT + 1, cursorSecret }), /Limite invalide/);
  await assert.rejects(() => readCagnotte({ db, beneficiaryId: "pages", scope: "self", cursor: "not-a-valid-cursor", cursorSecret }), /Curseur invalide/);

  await clear();
  await seedWallet("technical", 50, 0, 0);
  await seedMovement("z-tech", "technical", 8000, "delivery_confirmed", 0, 0, 0);
  await seedMovement("a-visible", "technical", 7000, "payment_confirmed", 50, 0, 0);
  const technical = await readCagnotte({ db, beneficiaryId: "technical", scope: "self", limit: 1, cursorSecret });
  assert.deepEqual(technical.history.items, []);
  assert.ok(technical.history.nextCursor, "le curseur avance après une page technique");
  const visible = await readCagnotte({ db, beneficiaryId: "technical", scope: "self", limit: 1, cursor: technical.history.nextCursor!, cursorSecret });
  assert.deepEqual(visible.history.items.map((item) => item.amountCents), [50]);

  await clear();
  await seedWallet("labels", 0, 0, 325);
  await seedMovement("pay", "labels", 600, "payment_confirmed", 500, 0, 0);
  await seedMovement("release", "labels", 500, "made_available", -500, 300, -200);
  await seedMovement("cancel", "labels", 400, "cancelled", 0, 0, 125);
  await seedMovement("refund", "labels", 300, "refund_confirmed", 0, -100, 0);
  await seedMovement("regularization", "labels", 200, "refund_confirmed", 0, 0, 200);
  await seedMovement("absorbed", "labels", 100, "made_available", -125, 0, -125);
  const labels = (await readCagnotte({ db, beneficiaryId: "labels", scope: "self", limit: 20, cursorSecret })).history.items.map((item) => item.label);
  for (const label of ["Gain en attente", "Gain devenu disponible", "Gain annulé", "Ajustement de fidélité après retour", "Régularisation des avantages", "Gain affecté à une régularisation"]) assert.ok(labels.includes(label as never));

  const beforeRead = await snapshot();
  await readCagnotte({ db, beneficiaryId: "labels", scope: "self", limit: 2, cursorSecret });
  assert.deepEqual(await snapshot(), beforeRead, "la consultation ne produit aucune écriture");

  await clear();
  await seedWallet("reservation-labels", 600, 0, 0, 3, 800);
  await seedMovement("reserve-label", "reservation-labels", 300, "credit_reserved", 0, -800, 0, { reservedDeltaCents: 800 });
  await seedMovement("release-label", "reservation-labels", 200, "credit_released", 0, 600, -200, { reservedDeltaCents: -800 });
  await seedMovement("refund-label", "reservation-labels", 100, "credit_refunded_after_return", 0, 85, -15);
  const reservationLabels = await readCagnotte({ db, beneficiaryId: "reservation-labels", scope: "self", cursorSecret });
  assert.deepEqual(reservationLabels.history.items.map((item) => item.label), ["Cagnotte réservée", "Cagnotte libérée", "Cagnotte restituée après retour"]);
  assert.equal(reservationLabels.history.items[1].amountCents, 800, "la libération expose le brut sans le présenter comme un gain");
  assert.equal(reservationLabels.history.items[2].amountCents, 100, "la restitution expose le brut avant compensation");

  await clear();
  await seedWallet("old-history", 50, 0, 0);
  await seedMovement("old-undated", "old-history", 100, "payment_confirmed", 50, 0, 0);
  const oldUndated = (await db.collection("cagnotteMovements").doc("old-undated").get()).data()!;
  delete oldUndated.recordedAtEpochMs;
  delete oldUndated.reservationVersion;
  delete oldUndated.reservedDeltaCents;
  delete oldUndated.regularizationVersion;
  delete oldUndated.regularizationDeltaCents;
  oldUndated.schemaVersion = 1;
  await db.collection("cagnotteMovements").doc("old-undated").set(oldUndated);
  const partialHistory = await readCagnotte({ db, beneficiaryId: "old-history", scope: "self", cursorSecret });
  assert.equal(partialHistory.history.items.length, 0);
  assert.equal(partialHistory.history.completeness, "timestamped_movements_only");
  assert.match(partialHistory.history.limitation, /peut être incomplet/);

  await clear();
  await seedWallet("broken", 0, 0, 0);
  await seedMovement("broken-movement", "broken", 1, "payment_confirmed", 10, 0, 0, { schemaVersion: 99 });
  await assert.rejects(() => readCagnotte({ db, beneficiaryId: "broken", scope: "self", cursorSecret }), /Mouvement incompatible/);

  const source = await readFile(new URL("../api/_server/cagnotteRead.ts", import.meta.url), "utf8");
  assert.match(source, /where\("beneficiaryId", "==", beneficiaryId\)/);
  assert.doesNotMatch(source, /collection\("cagnotteMovements"\)\.get\(/);
  assert.match(source, /\.limit\(limit \+ 1\)/);
  console.log("Cagnotte read API tests passed: filtered bounded reads, auth, schemas, cursors and no writes");
} finally {
  await clear();
  await db.terminate();
}

async function seedWallet(uid: string, availableCents: number, pendingCents: number, regularizationCents: number, schemaVersion: 1 | 2 | 3 = 3, reservedCents = 0) {
  const value = schemaVersion === 1
    ? { schemaVersion: 1, currency: "EUR", beneficiaryId: uid, availableCents, pendingCents }
    : schemaVersion === 2
      ? { schemaVersion: 2, regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION, currency: "EUR", beneficiaryId: uid, availableCents, pendingCents, regularizationCents }
      : { schemaVersion: 3, regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION, reservationVersion: CAGNOTTE_RESERVATION_VERSION, currency: "EUR", beneficiaryId: uid, availableCents, pendingCents, reservedCents, regularizationCents };
  await db.collection("cagnotteWallets").doc(uid).set(value);
}

async function seedMovement(id: string, uid: string, recordedAtEpochMs: number, businessEvent: string, pendingDeltaCents: number, availableDeltaCents: number, regularizationDeltaCents: number, extra: Record<string, unknown> = {}) {
  await db.collection("cagnotteMovements").doc(id).set({
    schemaVersion: 3, regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION, reservationVersion: CAGNOTTE_RESERVATION_VERSION, calculationVersion: "cagnotte-math-v1", programVersion: "local-test-v1",
    currency: "EUR", origin: "internal_server", orderId: `order-${id}`, beneficiaryId: uid, businessEvent, eventKey: id, payload: JSON.stringify({ event: businessEvent }),
    pendingDeltaCents, availableDeltaCents, reservedDeltaCents: 0, regularizationDeltaCents, recordedAtEpochMs, ...extra,
  });
}

async function clear() {
  for (const name of collections) {
    const documents = await db.collection(name).get();
    await Promise.all(documents.docs.map((document) => document.ref.delete()));
  }
}

async function snapshot() {
  const result: Record<string, unknown[]> = {};
  for (const name of collections) {
    result[name] = (await db.collection(name).orderBy("__name__").get()).docs.map((document) => ({ id: document.id, data: document.data() }));
  }
  return result;
}

function request(method: string, url: string, token?: string) {
  return { method, url, headers: token ? { authorization: `Bearer ${token}` } : {} } as never;
}

function emptyResponse() {
  return { currency: "EUR" as const, capabilities: { canReadWallet: true as const, canRequestReservation: true, canAccrueLoyalty: true }, wallet: { status: "not_created" as const, availableCents: 0, pendingCents: 0, reservedCents: 0, regularizationCents: 0 }, history: { items: [], nextCursor: null, completeness: "timestamped_movements_only" as const, limitation: "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet." as const }, freshness: { readAt: "2026-09-05T10:00:00.000Z", consistency: "wallet_and_page" as const, refreshStartsAtFirstPage: true as const } };
}
