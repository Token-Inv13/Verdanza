import { deepStrictEqual as eq, equal, ok, rejects } from "node:assert/strict";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { connectCagnotteEmulator, CAGNOTTE_DEMO } from "./cagnotteEmulator.js";
import { applyCagnotteLedgerOperation } from "../api/_server/cagnotteLedger.js";
import { applyCagnotteReservationOperation, createCagnotteReservationIntent } from "../api/_server/cagnotteReservations.js";
import { commitOrderStatusTransition } from "../api/_server/orderStatusTransition.js";
import { createOrderStatusHandler } from "../api/_server/orderStatusRoute.js";
import { paymentLinkRequestDocumentId, paymentLinkRequestsCollection } from "../api/_server/paymentLinkDelivery.js";
import { readUnpaidOrderContext, UnpaidReviewError } from "../api/_server/unpaidOrderReview.js";
import type { CagnotteReservationTestProgram } from "../api/_server/cagnotteReservationTypes.js";
import type { CagnotteTestProgram } from "../api/_server/cagnotteLedgerTypes.js";
import type { Order } from "../src/types/index.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const actor = { uid: "review-admin", email: "review-admin@example.test" };
const program: CagnotteReservationTestProgram = { mode: "local_test", programVersion: "admin-review-v1", calculationVersion: "cagnotte-math-v1",
  startsAtEpochMs: 1000, reservationVersion: "cagnotte-reservation-v1", reservationsEnabled: true };
const accrualProgram: CagnotteTestProgram = { mode: "local_test", programVersion: program.programVersion,
  calculationVersion: program.calculationVersion, startsAtEpochMs: program.startsAtEpochMs, newAccrualsEnabled: true };
const reviewNow = "2026-09-06T12:00:00.000Z";
let sequence = 0, tests = 0;

async function test(name: string, run: () => Promise<void>) {
  try { await run(); tests += 1; console.log(`OK [Revues admin] ${name}`); }
  catch (error) { console.error(`FAIL [Revues admin] ${name}`); throw error; }
}

async function fixture(status: "unknown" | "sending" | "none" = "unknown") {
  const id = `review-order-${++sequence}`, beneficiaryId = `review-user-${sequence}`, requestId = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  const fundingSnapshot = calculateCagnotte({ lines: [{ lineId: "fund", initialCents: 20000 }], discounts: [], requestedCagnotteCents: 0, availableCagnotteCents: 0, advantages: [] });
  await applyCagnotteLedgerOperation({ db, program: accrualProgram, recordedAtEpochMs: Date.parse("2026-08-01T10:00:00.000Z"), command: { event: "payment_and_delivery_confirmed", order: {
    orderId: `${id}-fund`, beneficiaryId, programVersion: program.programVersion, createdAtEpochMs: 2000, snapshot: fundingSnapshot } } });
  const calculation = { lines: [{ lineId: "line-0", initialCents: 10000 }], discounts: [], requestedCagnotteCents: 800, availableCagnotteCents: 1000, advantages: [] };
  const snapshot = calculateCagnotte(calculation);
  const intent = createCagnotteReservationIntent({ orderId: id, beneficiaryId, createdAtEpochMs: 3000, calculation }, program)!;
  const summary = status === "none" ? undefined : { requestId, intent: "initial" as const, status, attempts: 1, amount: 92, currency: "EUR" as const,
    channel: "email" as const, createdAt: "2026-09-02T08:00:00.000Z", lastAttemptAt: "2026-09-02T08:00:00.000Z",
    ...(status === "unknown" ? { transportStatus: "unknown" as const } : {}) };
  const order = { id, customerId: beneficiaryId, customerName: "Client fictif", customerEmail: "client@example.test", customerPhone: "0600000000", orderStatus: "confirmed" as const,
    paymentStatus: "payment_link_sent" as const, deliveryMethod: "postal" as const, deliveryFee: 0, subtotal: 100, total: 100, paymentAmount: 92,
    deliveryAddress: { firstName: "Client", lastName: "Fictif", line1: "1 rue du Test", postalCode: "13100", city: "Aix-en-Provence", country: "FR" },
    discountAmount: 0, promotionDiscountTotal: 0, createdAt: "2026-09-02T08:00:00.000Z", updatedAt: "2026-09-02T08:00:00.000Z",
    items: [{ lineId: "line-0", productId: "review-product", name: "Produit fictif", quantity: 1, unitPrice: 100, lineTotal: 100 }],
    cagnotte: { schemaVersion: 1 as const, beneficiaryId, programVersion: program.programVersion, calculationVersion: "cagnotte-math-v1" as const, createdAtEpochMs: 3000, snapshot },
    cagnotteReservationIntent: intent, ...(summary ? { paymentLinkDelivery: summary } : {}) } satisfies Order;
  await db.collection("orders").doc(id).set(order);
  await applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: Date.parse("2026-09-02T08:00:00.000Z") });
  if (summary) await db.collection(paymentLinkRequestsCollection).doc(paymentLinkRequestDocumentId(id, requestId)).set({
    schemaVersion: 2, orderId: id, requestId, intent: "initial", status, ...(status === "unknown" ? { transportStatus: "unknown" } : {}),
    payloadFingerprint: `payload-${sequence}`, contentFingerprint: `content-${sequence}`, dispatchStartedAt: status === "sending" ? { seconds: 1 } : null,
  });
  return { id, beneficiaryId, requestId, intent };
}

async function order(id: string) { return { id, ...(await db.collection("orders").doc(id).get()).data() } as Order; }
async function context(id: string, now = reviewNow) {
  return db.runTransaction(async (transaction) => readUnpaidOrderContext({ db, transaction, order: await order(id), nowEpochMs: Date.parse(now) }));
}
async function change(id: string, body: Parameters<typeof commitOrderStatusTransition>[0]["body"], now = reviewNow) {
  return commitOrderStatusTransition({ db, body: { ...body, orderId: id }, admin: actor, accrualProgram: null, reservationProgram: null, now: () => now });
}
async function review(id: string, outcome: "unpaid_confirmed" | "payment_uncertain", stateVersion: string) {
  return change(id, { orderId: id, unpaidReview: { action: "record", outcome, source: "Console prestataire fictive", reason: "Contrôle manuel du dossier synthétique", expectedStateVersion: stateVersion } });
}
async function dump(id: string) {
  const names = ["orders", "cagnotteWallets", "cagnotteReservations", "cagnotteMovements", "stockMovements", paymentLinkRequestsCollection];
  return Promise.all(names.map(async (name) => (await db.collection(name).get()).docs.filter((doc) => doc.id.includes(id) || doc.data().orderId === id).map((doc) => ({ id: doc.id, ...doc.data() }))));
}

try {
  await db.collection("adminUsers").doc(actor.uid).set({ isActive: true });
  await db.collection("products").doc("review-product").set({ name: "Produit fictif", stock: 10 });
  await test("seuil 72 heures : repere de revue seulement, aucune liberation", async () => {
    const f = await fixture("none"), before = await dump(f.id), current = await context(f.id);
    equal(current.reviewRequired, true); equal(current.ageHours, 100); equal(current.reservedAmountCents, 800); eq(await dump(f.id), before);
    equal((await db.collection("cagnotteReservations").doc(f.id).get()).data()!.state, "reserved");
  });
  await test("transport unknown et paiement incertain restent deux informations", async () => {
    const f = await fixture("unknown"), current = await context(f.id);
    equal(current.linkTransmission.status, "unknown"); equal(current.linkTransmission.uncertain, true);
    equal(current.payment.status, "payment_link_sent"); equal(current.payment.uncertain, true);
  });
  await test("envoi sending bloque revue concluante et annulation", async () => {
    const f = await fixture("sending"), current = await context(f.id), before = await dump(f.id);
    await rejects(() => review(f.id, "unpaid_confirmed", current.stateVersion), (error) => error instanceof UnpaidReviewError && error.code === "payment_link_delivery_active");
    await rejects(() => change(f.id, { orderId: f.id, orderStatus: "cancelled" }), (error) => error instanceof UnpaidReviewError && error.code === "payment_link_delivery_active");
    eq(await dump(f.id), before);
  });
  await test("paiement incertain conserve la reservation", async () => {
    const f = await fixture("unknown"), current = await context(f.id); await review(f.id, "payment_uncertain", current.stateVersion);
    await rejects(() => change(f.id, { orderId: f.id, orderStatus: "cancelled" }), (error) => error instanceof UnpaidReviewError && error.code === "unpaid_review_required");
    equal((await db.collection("cagnotteReservations").doc(f.id).get()).data()!.state, "reserved");
  });
  await test("revue explicite autorise une annulation impayee coherente", async () => {
    const f = await fixture("unknown"), current = await context(f.id); await review(f.id, "unpaid_confirmed", current.stateVersion);
    await change(f.id, { orderId: f.id, orderStatus: "cancelled" });
    const storedOrder = await order(f.id), reservation = (await db.collection("cagnotteReservations").doc(f.id).get()).data()!;
    equal(storedOrder.orderStatus, "cancelled"); equal(storedOrder.paymentStatus, "cancelled"); equal(reservation.state, "released");
    equal(storedOrder.paymentLinkDelivery?.status, "unknown");
  });
  await test("nouvel envoi apres revue rend la revue ancienne", async () => {
    const f = await fixture("unknown"), current = await context(f.id); await review(f.id, "unpaid_confirmed", current.stateVersion);
    await db.collection("orders").doc(f.id).update({ "paymentLinkDelivery.status": "sent", "paymentLinkDelivery.transportStatus": "accepted" });
    await db.collection(paymentLinkRequestsCollection).doc(paymentLinkRequestDocumentId(f.id, f.requestId)).update({ status: "sent", transportStatus: "accepted" });
    await rejects(() => change(f.id, { orderId: f.id, orderStatus: "cancelled" }), (error) => error instanceof UnpaidReviewError && error.code === "unpaid_review_stale");
    equal((await db.collection("cagnotteReservations").doc(f.id).get()).data()!.state, "reserved");
  });
  await test("paiement concurrent et annulation : une seule issue terminale", async () => {
    const f = await fixture("unknown"), current = await context(f.id); await review(f.id, "unpaid_confirmed", current.stateVersion);
    const results = await Promise.allSettled([
      change(f.id, { orderId: f.id, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, "2026-09-06T12:01:00.000Z"),
      change(f.id, { orderId: f.id, orderStatus: "cancelled" }, "2026-09-06T12:01:00.000Z"),
    ]);
    equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
    const storedOrder = await order(f.id); ok(storedOrder.paymentStatus === "paid" || storedOrder.paymentStatus === "cancelled");
    const reservation = (await db.collection("cagnotteReservations").doc(f.id).get()).data()!;
    equal(reservation.state, storedOrder.paymentStatus === "paid" ? "consumed" : "released");
  });
  await test("visiteur et non administrateur refuses avant mutation", async () => {
    const f = await fixture("unknown"), current = await context(f.id), before = await dump(f.id);
    const handler = createOrderStatusHandler({ getDb: () => db, verifyToken: async () => ({ uid: "ordinary-user", email: "ordinary@example.test", emailVerified: true }),
      sendStatusEmail: async () => ({ status: "skipped", reason: "fixture" }), processAnalytics: async () => ({ status: "skipped", code: "fixture" }), accrualProgram: null, reservationProgram: null, now: () => reviewNow });
    let status = 0;
    const response = { setHeader() {}, status(value: number) { status = value; return this; }, json() {} };
    await handler({ method: "POST", body: { orderId: f.id, authToken: "invalid-role", unpaidReview: { action: "record", outcome: "unpaid_confirmed", source: "fixture", reason: "tentative sans droit", expectedStateVersion: current.stateVersion } }, headers: {} } as VercelRequestLike, response as unknown as VercelResponseLike);
    equal(status, 403); eq(await dump(f.id), before);
  });
  console.log(`FINALISATION 2 : ${tests} scénarios de revue impayée réussis, sans envoi ni service externe.`);
} finally { await db.terminate(); }
