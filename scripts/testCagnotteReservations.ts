import assert from "node:assert/strict";
import { applyCagnotteLedgerOperation, prepareCagnotteLedgerOperation } from "../api/_server/cagnotteLedger.js";
import { CAGNOTTE_RESERVATION_VERSION, type CagnotteInternalOrder, type CagnotteTestProgram, type CagnotteWallet } from "../api/_server/cagnotteLedgerTypes.js";
import {
  applyCagnotteReservationOperation,
  CAGNOTTE_RESERVATION_PROGRAM,
  CagnotteReservationError,
  createCagnotteReservationIntent,
  prepareCagnottePaymentComposition,
  prepareCagnotteReservationOperation,
} from "../api/_server/cagnotteReservations.js";
import type { CagnotteReservation, CagnotteReservationIntent, CagnotteReservationTestProgram } from "../api/_server/cagnotteReservationTypes.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { assertWalletJournal, fixtureSpentGain } from "./cagnotteRegularizationFixtures.js";
import { assertCagnotteEmulatorAvailable, CAGNOTTE_DEMO, connectCagnotteEmulator, validateCagnotteTestEnvironment } from "./cagnotteEmulator.js";

validateCagnotteTestEnvironment(process.env);
await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const collections = ["cagnotteAccruals", "cagnotteMovements", "cagnotteReservations", "cagnotteWallets", "orders"];
const counts = new Map<string, number>();
let passed = 0;

const program: CagnotteReservationTestProgram = Object.freeze({
  mode: "local_test",
  programVersion: "reservation-test-v1",
  calculationVersion: "cagnotte-math-v1",
  startsAtEpochMs: 1_000,
  reservationVersion: CAGNOTTE_RESERVATION_VERSION,
  reservationsEnabled: true,
});
const accrualProgram: CagnotteTestProgram = Object.freeze({
  mode: program.mode,
  programVersion: program.programVersion,
  calculationVersion: program.calculationVersion,
  startsAtEpochMs: program.startsAtEpochMs,
  newAccrualsEnabled: true,
});

try {
  await test("Garde", "configuration normale inactive et arrêt avant tout accès Firestore", async () => {
    assert.equal(CAGNOTTE_RESERVATION_PROGRAM, null);
    const candidate = makeIntent("disabled-order", "disabled-user");
    let databaseAccess = 0;
    const forbiddenDb = new Proxy(db, { get(target, key, receiver) {
      if (key === "collection" || key === "runTransaction") databaseAccess += 1;
      return Reflect.get(target, key, receiver);
    } });
    await assert.rejects(
      () => applyCagnotteReservationOperation({ db: forbiddenDb, action: "reserve", intent: candidate, program: null }),
      reservationError("RESERVATIONS_DISABLED"),
    );
    assert.equal(databaseAccess, 0);
    assert.equal(createCagnotteReservationIntent({ orderId: "off", beneficiaryId: "off", createdAtEpochMs: 2_000, calculation: calculation() }, null), null);
  });
  await test("Garde", "drain bloque les nouveaux intents mais termine consume, release et cancel", async () => {
    const drain = { ...program, reservationsEnabled: false };
    assert.equal(createCagnotteReservationIntent({ orderId: "drain-new", beneficiaryId: "drain-user", createdAtEpochMs: 2_000, calculation: calculation() }, drain), null);

    await fund("drain-consume-user", "drain-consume-fund", 40_000);
    const consumed = makeIntent("drain-consume-order", "drain-consume-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent: consumed, program });
    assert.equal((await applyCagnotteReservationOperation({ db, action: "consume", intent: consumed, program: drain })).status, "consumed");

    await fund("drain-release-user", "drain-release-fund", 40_000);
    const released = makeIntent("drain-release-order", "drain-release-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent: released, program });
    assert.equal((await applyCagnotteReservationOperation({ db, action: "release", intent: released, program: drain })).status, "released");

    await fund("drain-cancel-user", "drain-cancel-fund", 40_000);
    const cancelled = makeIntent("drain-cancel-order", "drain-cancel-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent: cancelled, program });
    assert.equal((await applyCagnotteReservationOperation({ db, action: "cancel", intent: cancelled, program: drain })).status, "released");
  });

  await test("Calcul", "montant nul sans document et plafond exact après réductions", async () => {
    const zero = requiredIntent("zero-order", "zero-user", { requestedCagnotteCents: 0, availableCagnotteCents: 2_000 });
    assert.equal((await applyCagnotteReservationOperation({ db, action: "reserve", intent: zero, program })).status, "not_required");
    assert.equal((await snapshot()).flat().length, 0);
    const capped = requiredIntent("cap-order", "cap-user", { requestedCagnotteCents: 9_000, availableCagnotteCents: 9_000 });
    assert.equal(capped.amountCents, 2_000);
    assert.equal(capped.order.snapshot.productsPaidCents, 8_000);
    assert.equal(capped.order.snapshot.loyaltyCents, 400);
  });

  await test("Calcul", "réductions, cadeaux et cumuls bloqués restent ceux du calcul pur", async () => {
    const discounted = requiredIntent("discount-order", "discount-user", {
      lines: [{ lineId: "product", initialCents: 10_000 }],
      discounts: [{ discountId: "d", amountCents: 2_000, lineIds: ["product"], kind: "product_discount" }],
      requestedCagnotteCents: 9_000,
      availableCagnotteCents: 9_000,
    });
    assert.equal(discounted.amountCents, 1_600);
    for (const [orderId, advantage] of [["promo-order", "promotion_code"], ["contest-order", "contest_prize"], ["auto-order", "automatic_promotion"]] as const) {
      const blocked = requiredIntent(orderId, `${orderId}-user`, { advantages: [advantage] });
      assert.equal(blocked.amountCents, 0);
      assert.notEqual(blocked.order.snapshot.compatibility.status, "allowed");
    }
    const gift = requiredIntent("gift-order", "gift-user", {
      lines: [{ lineId: "paid", initialCents: 10_000 }, { lineId: "gift", initialCents: 0, isGift: true, giftCommercialValueCents: 2_000 }],
      advantages: [], requestedCagnotteCents: 800, availableCagnotteCents: 2_000,
    });
    assert.equal(gift.amountCents, 0);
    assert.equal(gift.order.snapshot.lines.find((line) => line.lineId === "gift")!.productsPaidCents, 0);
  });

  await test("Cycle", "20 euros disponibles, réservation 8 euros, paiement puis livraison", async () => {
    const source = await fund("main-user", "main-fund", 40_000);
    assertWallet(await wallet("main-user"), [0, 2_000, 0, 0]);
    const intent = makeIntent("main-order", "main-user");
    assert.deepEqual([intent.amountCents, intent.order.snapshot.productsPaidCents, intent.order.snapshot.loyaltyCents], [800, 9_200, 460]);
    const orderRef = db.collection("orders").doc(intent.order.orderId);
    await db.runTransaction(async (transaction) => {
      assert.equal((await transaction.get(orderRef)).exists, false);
      const reservation = await prepareCagnotteReservationOperation({ db, transaction, action: "reserve", intent, program, recordedAtEpochMs: 10_000 });
      transaction.create(orderRef, { status: "awaiting_payment", paymentStatus: "pending", reservationIntent: intent });
      reservation.write();
    });
    assertWallet(await wallet("main-user"), [0, 1_200, 800, 0]);
    await db.runTransaction(async (transaction) => {
      const payment = await prepareCagnottePaymentComposition({ db, transaction, intent, accrualProgram, reservationProgram: program, delivered: false, recordedAtEpochMs: 11_000 });
      assert.deepEqual([payment.reservation.status, payment.ledger.status, payment.walletAfter?.pendingCents, payment.walletAfter?.availableCents, payment.walletAfter?.reservedCents], ["consumed", "applied", 460, 1_200, 0]);
      transaction.update(orderRef, { paymentStatus: "paid" });
      payment.write();
    });
    assertWallet(await wallet("main-user"), [460, 1_200, 0, 0]);
    await db.runTransaction(async (transaction) => {
      const delivery = await prepareCagnotteLedgerOperation({ db, transaction, program: accrualProgram, recordedAtEpochMs: 12_000, command: { order: intent.order, event: "delivery_confirmed" } });
      transaction.update(orderRef, { status: "delivered" });
      delivery.write();
    });
    assertWallet(await wallet("main-user"), [0, 1_660, 0, 0]);
    assert.deepEqual((await orderRef.get()).data(), { status: "delivered", paymentStatus: "paid", reservationIntent: intent });
    const persisted = await reservation(intent);
    assert.equal(persisted.state, "consumed");
    assert.deepEqual(persisted.order, intent.order);
    assert.equal(source.snapshot.loyaltyCents, 2_000);
    await assertWalletJournal(db, "main-user");
  });

  await test("Atomicité", "création préparée puis erreur : commande, réservation et mouvement sont annulés ensemble", async () => {
    await fund("rollback-user", "rollback-fund", 40_000);
    const intent = makeIntent("rollback-order", "rollback-user");
    const before = await snapshot();
    await assert.rejects(() => db.runTransaction(async (transaction) => {
      const plan = await prepareCagnotteReservationOperation({ db, transaction, action: "reserve", intent, program, recordedAtEpochMs: 20_000 });
      transaction.create(db.collection("orders").doc(intent.order.orderId), { status: "awaiting_payment" });
      plan.write();
      throw new Error("synthetic rollback");
    }), /synthetic rollback/);
    assert.deepEqual(await snapshot(), before);
  });

  await test("Atomicité", "paiement et livraison combinés partagent une seule évolution du portefeuille", async () => {
    await fund("combined-user", "combined-fund", 40_000);
    const intent = makeIntent("combined-order", "combined-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: 21_000 });
    const orderRef = db.collection("orders").doc(intent.order.orderId);
    await orderRef.set({ status: "awaiting_payment" });
    await db.runTransaction(async (transaction) => {
      const plan = await prepareCagnottePaymentComposition({ db, transaction, intent, accrualProgram, reservationProgram: program, delivered: true, recordedAtEpochMs: 22_000 });
      assert.deepEqual([plan.walletAfter?.pendingCents, plan.walletAfter?.availableCents, plan.walletAfter?.reservedCents], [0, 1_660, 0]);
      transaction.update(orderRef, { status: "delivered", paymentStatus: "paid" });
      plan.write();
    });
    assertWallet(await wallet("combined-user"), [0, 1_660, 0, 0]);
    const beforeReplay = await snapshot();
    await db.runTransaction(async (transaction) => {
      const replay = await prepareCagnottePaymentComposition({ db, transaction, intent, accrualProgram, reservationProgram: program, delivered: true, recordedAtEpochMs: 99_999 });
      assert.deepEqual([replay.reservation.status, replay.ledger.status], ["already_consumed", "already_applied"]);
      replay.write();
    });
    assert.deepEqual(await snapshot(), beforeReplay, "le rejeu exact ne réécrit même pas le portefeuille");
  });

  await test("Idempotence", "réservation identique concurrente : une création et un rejeu", async () => {
    await fund("same-user", "same-fund", 40_000);
    const intent = makeIntent("same-order", "same-user");
    const results = await Promise.all([
      applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: 30_000 }),
      applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: 30_000 }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), ["already_reserved", "reserved"]);
    assertWallet(await wallet("same-user"), [0, 1_200, 800, 0]);
    assert.equal((await movements("same-order")).length, 1);
  });

  await test("Revue manuelle", "après 72 h la réservation impayée reste réservée sans expiration automatique", async () => {
    await fund("review-user", "review-fund", 40_000);
    const intent = makeIntent("review-order", "review-user");
    const createdAtEpochMs = 31_000;
    assert.equal((await applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: createdAtEpochMs })).status, "reserved");
    const afterThreshold = await applyCagnotteReservationOperation({
      db,
      action: "reserve",
      intent,
      program,
      recordedAtEpochMs: createdAtEpochMs + (72 * 60 * 60 * 1_000) + 1,
    });
    assert.equal(afterThreshold.status, "already_reserved");
    const persisted = await reservation(intent);
    assert.equal(persisted.state, "reserved");
    assert.equal("expiresAt" in (persisted as unknown as Record<string, unknown>), false);
    assertWallet(await wallet("review-user"), [0, 1_200, 800, 0]);
  });

  await test("Concurrence", "deux commandes de 15 euros sur 20 : aucune réservation partielle", async () => {
    await fund("race-user", "race-fund", 40_000);
    const a = makeIntent("race-order-a", "race-user", { requestedCagnotteCents: 1_500 });
    const b = makeIntent("race-order-b", "race-user", { requestedCagnotteCents: 1_500 });
    const results = await Promise.allSettled([
      applyCagnotteReservationOperation({ db, action: "reserve", intent: a, program }),
      applyCagnotteReservationOperation({ db, action: "reserve", intent: b, program }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assertWallet(await wallet("race-user"), [0, 500, 1_500, 0]);
  });

  await test("Exactitude", "intention calculée sur un ancien solde refusée sans repli partiel", async () => {
    await fund("stale-user", "stale-fund", 40_000);
    const stale = makeIntent("stale-order", "stale-user");
    const other = makeIntent("other-order", "stale-user", { requestedCagnotteCents: 1_500 });
    await applyCagnotteReservationOperation({ db, action: "reserve", intent: other, program });
    await unchanged(() => applyCagnotteReservationOperation({ db, action: "reserve", intent: stale, program }), reservationError("CONFLICT"));
    assertWallet(await wallet("stale-user"), [0, 500, 1_500, 0]);
  });

  await test("Concurrence", "consommation et libération simultanées donnent un seul état terminal", async () => {
    await fund("terminal-race-user", "terminal-race-fund", 40_000);
    const intent = makeIntent("terminal-race-order", "terminal-race-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program });
    const results = await Promise.allSettled([
      applyCagnotteReservationOperation({ db, action: "consume", intent, program: null }),
      applyCagnotteReservationOperation({ db, action: "release", intent, program: null }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const state = (await reservation(intent)).state;
    assert.ok(state === "consumed" || state === "released");
    assertWallet(await wallet("terminal-race-user"), state === "consumed" ? [0, 1_200, 0, 0] : [0, 2_000, 0, 0]);
  });

  await test("Libération", "clôture avant paiement : retour à 20 euros et rejeu sans changement", async () => {
    await fund("release-user", "release-fund", 40_000);
    const intent = makeIntent("release-order", "release-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: 35_000 });
    assertWallet(await wallet("release-user"), [0, 1_200, 800, 0]);
    assert.equal((await applyCagnotteReservationOperation({ db, action: "release", intent, program: null, recordedAtEpochMs: 36_000 })).status, "released");
    assertWallet(await wallet("release-user"), [0, 2_000, 0, 0]);
    const beforeReplay = await snapshot();
    assert.equal((await applyCagnotteReservationOperation({ db, action: "release", intent, program: null, recordedAtEpochMs: 99_999 })).status, "already_released");
    assert.deepEqual(await snapshot(), beforeReplay);
  });

  await test("Terminaux", "consommée non libérable, libérée non consommable et aucune réouverture", async () => {
    await fund("terminal-user", "terminal-fund", 40_000);
    const consumed = makeIntent("consumed-order", "terminal-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent: consumed, program });
    await applyCagnotteReservationOperation({ db, action: "consume", intent: consumed, program: null });
    await unchanged(() => applyCagnotteReservationOperation({ db, action: "release", intent: consumed, program: null }), reservationError("CONFLICT"));
    const released = makeIntent("released-order", "terminal-user", { availableCagnotteCents: 1_200 });
    await applyCagnotteReservationOperation({ db, action: "reserve", intent: released, program });
    await applyCagnotteReservationOperation({ db, action: "release", intent: released, program: null });
    await unchanged(() => applyCagnotteReservationOperation({ db, action: "consume", intent: released, program: null }), reservationError("CONFLICT"));
    assert.equal((await applyCagnotteReservationOperation({ db, action: "reserve", intent: released, program })).status, "already_released");
    const altered = makeIntent("released-order", "terminal-user", { requestedCagnotteCents: 500, availableCagnotteCents: 1_200 });
    await unchanged(() => applyCagnotteReservationOperation({ db, action: "reserve", intent: altered, program }), reservationError("CONFLICT"));
  });

  await test("Conflits", "même commande avec autre bénéficiaire, montant ou instantané : aucun transfert", async () => {
    await fund("binding-user", "binding-fund", 40_000);
    const intent = makeIntent("binding-order", "binding-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program });
    const candidates = [
      makeIntent("binding-order", "other-user"),
      makeIntent("binding-order", "binding-user", { requestedCagnotteCents: 500 }),
      makeIntent("binding-order", "binding-user", { lines: [{ lineId: "other-product", initialCents: 10_000 }] }),
    ];
    for (const candidate of candidates) {
      await unchanged(() => applyCagnotteReservationOperation({ db, action: "reserve", intent: candidate, program }), reservationError("CONFLICT"));
    }
    assertWallet(await wallet("binding-user"), [0, 1_200, 800, 0]);
    assert.equal((await db.collection("cagnotteWallets").doc("other-user").get()).exists, false);
  });

  await test("Annulation", "après consommation, seul le gain est neutralisé et les 8 euros ne sont pas restitués", async () => {
    await fund("cancel-user", "cancel-fund", 40_000);
    const intent = makeIntent("cancel-order", "cancel-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: 39_000 });
    await db.runTransaction(async (transaction) => {
      const plan = await prepareCagnottePaymentComposition({ db, transaction, intent, accrualProgram, reservationProgram: program, delivered: true, recordedAtEpochMs: 40_000 });
      plan.write();
    });
    assertWallet(await wallet("cancel-user"), [0, 1_660, 0, 0]);
    await cancel(intent.order);
    assertWallet(await wallet("cancel-user"), [0, 1_200, 0, 0]);
    assert.equal((await reservation(intent)).state, "consumed");
    await unchanged(() => applyCagnotteReservationOperation({ db, action: "release", intent, program: null }), reservationError("CONFLICT"));
  });

  await test("Suspension", "une réservation existante se consomme avec le programme normal désactivé", async () => {
    await fund("suspended-user", "suspended-fund", 40_000);
    const intent = makeIntent("suspended-order", "suspended-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program });
    const result = await applyCagnotteReservationOperation({ db, action: "consume", intent, program: null });
    assert.equal(result.status, "consumed");
    assertWallet(await wallet("suspended-user"), [0, 1_200, 0, 0]);
  });

  await test("Régularisation", "D inférieur à R : le brut revient, puis la compensation est distinguée", async () => {
    const first = await fund("less-user", "less-fund-a", 20_000);
    await fund("less-user", "less-fund-b", 20_000);
    const intent = makeIntent("less-order", "less-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program });
    await fixtureSpentGain(db, "less-user", "less-spend", 500, program.programVersion);
    await cancel(first);
    assertWallet(await wallet("less-user"), [0, 0, 800, 300]);
    const released = await applyCagnotteReservationOperation({ db, action: "release", intent, program: null });
    assert.equal(released.compensationCents, 300);
    assertWallet(await wallet("less-user"), [0, 500, 0, 0]);
    await assertReleaseMovement(intent, 500, -800, -300, 300);
  });

  await test("Régularisation", "D égal à R : libération entièrement compensée", async () => {
    const source = await fund("equal-user", "equal-fund", 40_000);
    const intent = makeIntent("equal-order", "equal-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program });
    await cancel(source);
    assertWallet(await wallet("equal-user"), [0, 0, 800, 800]);
    const released = await applyCagnotteReservationOperation({ db, action: "release", intent, program: null });
    assert.equal(released.compensationCents, 800);
    assertWallet(await wallet("equal-user"), [0, 0, 0, 0]);
  });

  await test("Régularisation", "D supérieur à R et gain ultérieur : réservé préservé, compensations successives", async () => {
    const source = await fund("greater-user", "greater-fund", 40_000);
    const intent = makeIntent("greater-order", "greater-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program });
    await fixtureSpentGain(db, "greater-user", "greater-spend", 700, program.programVersion);
    await cancel(source);
    assertWallet(await wallet("greater-user"), [0, 0, 800, 1_500]);
    const compensatingGain = await fund("greater-user", "greater-new-gain", 10_000);
    assertWallet(await wallet("greater-user"), [0, 0, 800, 1_000]);
    await cancel(compensatingGain);
    assertWallet(await wallet("greater-user"), [0, 0, 800, 1_500]);
    const released = await applyCagnotteReservationOperation({ db, action: "release", intent, program: null });
    assert.equal(released.compensationCents, 800);
    assertWallet(await wallet("greater-user"), [0, 0, 0, 700]);
  });

  await test("Régularisation", "un déficit bloque toute nouvelle réservation", async () => {
    const source = await fund("blocked-user", "blocked-fund", 40_000);
    const first = makeIntent("blocked-first", "blocked-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent: first, program });
    await cancel(source);
    const second = makeIntent("blocked-second", "blocked-user", { requestedCagnotteCents: 1, availableCagnotteCents: 1 });
    await unchanged(() => applyCagnotteReservationOperation({ db, action: "reserve", intent: second, program }), reservationError("CONFLICT"));
  });

  await test("Compatibilité", "portefeuille v2 lu avec réservé nul puis écrit en v3", async () => {
    await fund("legacy-user", "legacy-fund", 40_000);
    const current = await wallet("legacy-user") as unknown as Record<string, unknown>;
    delete current.reservationVersion;
    delete current.reservedCents;
    current.schemaVersion = 2;
    await db.collection("cagnotteWallets").doc("legacy-user").set(current);
    const intent = makeIntent("legacy-order", "legacy-user");
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program });
    const upgraded = await wallet("legacy-user");
    assert.deepEqual([upgraded.schemaVersion, upgraded.reservedCents], [3, 800]);
  });

  await test("Validation", "versions, valeurs et mouvement de réservation altérés sont refusés atomiquement", async () => {
    await fund("corrupt-user", "corrupt-fund", 40_000);
    const intent = makeIntent("corrupt-order", "corrupt-user");
    const originalWallet = await wallet("corrupt-user");
    for (const patch of [{ schemaVersion: 99 }, { reservedCents: -1 }, { reservedCents: 0.5 }, { reservationVersion: "unknown" }]) {
      await db.collection("cagnotteWallets").doc("corrupt-user").set({ ...originalWallet, ...patch });
      await unchanged(() => applyCagnotteReservationOperation({ db, action: "reserve", intent, program }));
    }
    await db.collection("cagnotteWallets").doc("corrupt-user").set(originalWallet);
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: 50_000 });
    const movement = (await movements(intent.order.orderId))[0];
    const movementRef = db.collection("cagnotteMovements").doc(movement.eventKey);
    await movementRef.update({ payload: "{}" });
    await unchanged(() => applyCagnotteReservationOperation({ db, action: "reserve", intent, program }), reservationError("CORRUPT_RESERVATION"));
    await movementRef.set(movement);
  });

  await test("Journal", "les quatre compartiments concordent et le réservé égale les réservations actives", async () => {
    await fund("journal-user", "journal-fund", 40_000);
    const active = makeIntent("journal-active", "journal-user", { requestedCagnotteCents: 600 });
    const terminal = makeIntent("journal-terminal", "journal-user", { requestedCagnotteCents: 500 });
    await applyCagnotteReservationOperation({ db, action: "reserve", intent: active, program });
    await applyCagnotteReservationOperation({ db, action: "reserve", intent: terminal, program });
    await applyCagnotteReservationOperation({ db, action: "consume", intent: terminal, program: null });
    await assertWalletJournal(db, "journal-user");
    const held = (await db.collection("cagnotteReservations").where("beneficiaryId", "==", "journal-user").where("state", "==", "reserved").get()).docs
      .reduce((sum, document) => sum + document.data().amountCents, 0);
    assert.equal((await wallet("journal-user")).reservedCents, held);
    for (const document of (await db.collection("cagnotteMovements").get()).docs) {
      const value = document.data();
      for (const field of ["pendingDeltaCents", "availableDeltaCents", "reservedDeltaCents", "regularizationDeltaCents", "recordedAtEpochMs"]) {
        assert.ok(Number.isSafeInteger(value[field]), `${field} absent ou non entier`);
      }
    }
  });

  console.table(Object.fromEntries(counts));
  console.log(`Cagnotte reservations: ${passed} cas Firestore réussis, données synthétiques uniquement.`);
} finally {
  await clear();
  await db.terminate();
}

async function test(group: string, name: string, run: () => Promise<void>) {
  await clear();
  await run();
  counts.set(group, (counts.get(group) ?? 0) + 1);
  console.log(`OK ${++passed} - ${group} - ${name}`);
}

function calculation(overrides: Partial<Parameters<typeof calculateCagnotte>[0]> = {}): Parameters<typeof calculateCagnotte>[0] {
  return {
    lines: [{ lineId: "product", initialCents: 10_000 }],
    discounts: [],
    requestedCagnotteCents: 800,
    availableCagnotteCents: 2_000,
    ...overrides,
  };
}

function requiredIntent(orderId: string, beneficiaryId: string, overrides: Partial<Parameters<typeof calculateCagnotte>[0]> = {}) {
  const value = createCagnotteReservationIntent({ orderId, beneficiaryId, createdAtEpochMs: 2_000, calculation: calculation(overrides) }, program);
  assert.ok(value);
  return value;
}

function makeIntent(orderId: string, beneficiaryId: string, overrides: Partial<Parameters<typeof calculateCagnotte>[0]> = {}): CagnotteReservationIntent {
  return requiredIntent(orderId, beneficiaryId, overrides);
}

async function fund(beneficiaryId: string, orderId: string, productsCents: number): Promise<CagnotteInternalOrder> {
  const order: CagnotteInternalOrder = {
    orderId,
    beneficiaryId,
    programVersion: program.programVersion,
    createdAtEpochMs: 2_000,
    snapshot: calculateCagnotte({ lines: [{ lineId: "product", initialCents: productsCents }], discounts: [], requestedCagnotteCents: 0, availableCagnotteCents: 0 }),
  };
  const result = await applyCagnotteLedgerOperation({ db, program: accrualProgram, recordedAtEpochMs: 3_000 + passed, command: { order, event: "payment_and_delivery_confirmed" } });
  assert.equal(result.status, "applied");
  return order;
}

async function cancel(order: CagnotteInternalOrder) {
  const result = await applyCagnotteLedgerOperation({ db, program: null, recordedAtEpochMs: 4_000 + passed, command: { order, event: "cancelled" } });
  assert.equal(result.status, "applied");
}

async function wallet(beneficiaryId: string) {
  return (await db.collection("cagnotteWallets").doc(beneficiaryId).get()).data() as CagnotteWallet;
}

async function reservation(intent: CagnotteReservationIntent) {
  return (await db.collection("cagnotteReservations").doc(intent.order.orderId).get()).data() as CagnotteReservation;
}

async function movements(orderId: string) {
  return (await db.collection("cagnotteMovements").where("orderId", "==", orderId).get()).docs.map((document) => document.data());
}

function assertWallet(value: CagnotteWallet, expected: [number, number, number, number]) {
  assert.deepEqual([value.pendingCents, value.availableCents, value.reservedCents, value.regularizationCents], expected);
}

async function assertReleaseMovement(intent: CagnotteReservationIntent, available: number, reserved: number, regularization: number, compensation: number) {
  const entry = (await movements(intent.order.orderId)).find((movement) => movement.businessEvent === "credit_released");
  assert.ok(entry);
  assert.deepEqual([entry.availableDeltaCents, entry.reservedDeltaCents, entry.regularizationDeltaCents], [available, reserved, regularization]);
  assert.match(entry.payload, new RegExp(`\\"amountCents\\":${intent.amountCents}`));
  assert.match(entry.payload, new RegExp(`\\"compensationCents\\":${compensation}`));
}

async function unchanged(run: () => Promise<unknown>, predicate?: (error: unknown) => boolean) {
  const before = await snapshot();
  if (predicate) await assert.rejects(run, predicate);
  else await assert.rejects(run);
  assert.deepEqual(await snapshot(), before);
}

function reservationError(code: CagnotteReservationError["code"]) {
  return (error: unknown) => error instanceof CagnotteReservationError && error.code === code;
}

async function snapshot() {
  return Promise.all(collections.map(async (name) => (await db.collection(name).orderBy("__name__").get()).docs.map((document) => ({ collection: name, id: document.id, data: document.data() }))));
}

async function clear() {
  for (const name of collections) {
    const documents = await db.collection(name).get();
    await Promise.all(documents.docs.map((document) => document.ref.delete()));
  }
}
