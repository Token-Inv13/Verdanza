import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createOrderHandler } from "../api/create-order.js";
import { createQuoteOrderHandler } from "../api/quote-order.js";
import { createOrderStatusHandler } from "../api/_server/orderStatusRoute.js";
import { createOrderRefundHandler } from "../api/_server/orderRefundRoute.js";
import { CAGNOTTE_READ_SERVER_ENABLED, readCagnotte } from "../api/_server/cagnotteRead.js";
import { CAGNOTTE_SERVER_PROGRAM } from "../api/_server/cagnotteProgram.js";
import { CAGNOTTE_RESERVATION_PROGRAM } from "../api/_server/cagnotteReservations.js";
import {
  CAGNOTTE_REGULARIZATION_VERSION,
  CAGNOTTE_RESERVATION_VERSION,
  type CagnotteMovement,
  type CagnotteTestProgram,
} from "../api/_server/cagnotteLedgerTypes.js";
import type { CagnotteReservationTestProgram } from "../api/_server/cagnotteReservationTypes.js";
import { ORDER_REFUNDS_ENABLED } from "../api/_server/orderRefunds.js";
import type { VerifiedFirebaseUser } from "../api/_server/adminAuth.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import { CagnotteView } from "../src/components/cagnotte/CagnottePanel.js";
import { CagnotteCheckoutView, CheckoutCreationSummary } from "../src/components/cagnotte/CagnotteCheckoutPanel.js";
import {
  CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED,
  CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED,
  CAGNOTTE_READ_DISPLAY_ENABLED,
} from "../src/config/cagnotteFeatures.js";
import type { CagnotteCheckoutState } from "../src/services/cagnotteCheckoutService.js";
import type { CheckoutOrderResult } from "../src/services/ordersService.js";
import type { OrderQuote } from "../src/services/quoteService.js";
import type { CagnotteReadResponse } from "../src/types/cagnotteRead.js";
import { CAGNOTTE_DEMO, connectCagnotteEmulator, validateCagnotteTestEnvironment } from "./cagnotteEmulator.js";

validateCagnotteTestEnvironment(process.env);
assert.equal(CAGNOTTE_SERVER_PROGRAM, null);
assert.equal(CAGNOTTE_RESERVATION_PROGRAM, null);
assert.equal(CAGNOTTE_READ_SERVER_ENABLED, false);
assert.equal(CAGNOTTE_READ_DISPLAY_ENABLED, false);
assert.equal(CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED, false);
assert.equal(CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED, false);
assert.equal(ORDER_REFUNDS_ENABLED, false);

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const baseTime = Date.parse("2000-01-01T00:00:00.000Z");
const cursorSecret = "recette-v1-local-cursor-secret-0000000000000001";
const customer: VerifiedFirebaseUser = {
  uid: "recette-customer-v1",
  email: "recette-client@example.test",
  emailVerified: true,
};
const admin: VerifiedFirebaseUser = {
  uid: "recette-admin-v1",
  email: "recette-admin@example.test",
  emailVerified: true,
};
const reservationProgram: CagnotteReservationTestProgram = Object.freeze({
  mode: "local_test",
  programVersion: "recette-cagnotte-v1",
  calculationVersion: "cagnotte-math-v1",
  startsAtEpochMs: baseTime,
  reservationVersion: CAGNOTTE_RESERVATION_VERSION,
  reservationsEnabled: true,
});
const accrualProgram: CagnotteTestProgram = Object.freeze({
  mode: reservationProgram.mode,
  programVersion: reservationProgram.programVersion,
  calculationVersion: reservationProgram.calculationVersion,
  startsAtEpochMs: reservationProgram.startsAtEpochMs,
  newAccrualsEnabled: true,
});
const businessCollections = [
  "orders",
  "cagnotteAccruals",
  "cagnotteMovements",
  "cagnotteReservations",
  "cagnotteWallets",
  "cagnotteRefunds",
];
const cleanupCollections = [
  "adminUsers",
  "analyticsOperationalEvents",
  "analyticsOutbox",
  "cagnotteAccruals",
  "cagnotteMovements",
  "cagnotteReservations",
  "cagnotteWallets",
  "cagnotteRefunds",
  "checkoutRequests",
  "coupons",
  "invoices",
  "orders",
  "orderSideEffects",
  "paymentLinkRequests",
  "productCosts",
  "products",
  "publicRateLimits",
  "stockMovements",
  "supplierPurchases",
];

type JsonRecord = Record<string, unknown>;
type ApiResult = { status: number; body: unknown; headers: Map<string, unknown> };
type RecipeStage = Awaited<ReturnType<typeof observeStage>>;
type MovementDeltas = {
  pendingDeltaCents: number;
  availableDeltaCents: number;
  reservedDeltaCents: number;
  regularizationDeltaCents: number;
};
type ExpectedMovement = MovementDeltas & {
  id: string;
  eventKey: string;
  orderId: string;
  beneficiaryId: string;
  businessEvent: CagnotteMovement["businessEvent"];
  recordedAtEpochMs: number;
  schemaVersion: 3;
  regularizationVersion: typeof CAGNOTTE_REGULARIZATION_VERSION;
  reservationVersion: typeof CAGNOTTE_RESERVATION_VERSION;
  calculationVersion: typeof reservationProgram.calculationVersion;
  programVersion: typeof reservationProgram.programVersion;
  currency: "EUR";
  origin: "internal_server";
};
type ExpectedMovementGroups = readonly (readonly ExpectedMovement[])[];

const journalNegativeCases = [
  "mouvement manquant",
  "mouvement dupliqué",
  "type métier incorrect",
  "delta altéré",
  "rattachement commande/client incorrect",
] as const;

const stages: RecipeStage[] = [];
const screenshots: string[] = [];

try {
  await clearEmulator();
  await seedSyntheticData();

  const createdA = await createOrder(checkoutBody("00000000-0000-4000-8000-00000000000a"), baseTime + 1_000);
  assert.equal(createdA.status, 200, JSON.stringify(createdA.body));
  const orderAId = String(record(createdA.body).orderId);
  const expectedJournal: ExpectedMovement[][] = [];
  const aCreated = await observeStage("A — commande créée", orderAId);
  assert.deepEqual(walletTuple(aCreated), null);
  assert.equal(aCreated.order.snapshotLoyaltyCents, 500);
  assert.equal(aCreated.order.snapshotAppliedCents, 0);
  assert.deepEqual(aCreated.adminWallet, null);
  assert.deepEqual(aCreated.adminAccrual, { present: false, initialGainCents: 500, remainingGainCents: 0, compartment: "none" });
  assertMovementJournal(aCreated, expectedJournal);
  stages.push(aCreated);

  assert.equal((await changeStatus(orderAId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, baseTime + 2_000)).status, 200);
  expectedJournal.push([
    expectedLedgerMovement(orderAId, "payment_confirmed", baseTime + 2_000, deltas(500, 0, 0, 0)),
  ]);
  const aPaid = await observeStage("A — paiement confirmé", orderAId);
  assert.deepEqual(walletTuple(aPaid), [500, 0, 0, 0]);
  assert.deepEqual(accrualTuple(aPaid), [500, 500, "pending", true, false]);
  assertMovementJournal(aPaid, expectedJournal);
  stages.push(aPaid);

  assert.equal((await changeStatus(orderAId, { orderStatus: "delivered" }, baseTime + 3_000)).status, 200);
  expectedJournal.push([
    expectedLedgerMovement(orderAId, "delivery_confirmed", baseTime + 3_000, deltas(0, 0, 0, 0)),
    expectedLedgerMovement(orderAId, "made_available", baseTime + 3_000, deltas(-500, 500, 0, 0)),
  ]);
  const aDelivered = await observeStage("A — livraison confirmée", orderAId);
  assert.deepEqual(walletTuple(aDelivered), [0, 500, 0, 0]);
  assert.deepEqual(accrualTuple(aDelivered), [500, 500, "available", true, true]);
  assertMovementJournal(aDelivered, expectedJournal);
  const beforeReplayA = await financialStateDigest();
  const beforeReplayAOrder = record((await db.collection("orders").doc(orderAId).get()).data());
  const beforeReplayAHistoryLength = Array.isArray(beforeReplayAOrder.statusHistory) ? beforeReplayAOrder.statusHistory.length : 0;
  const beforeReplayAStock = record((await db.collection("products").doc("recette-product-v1").get()).data()).stock;
  assert.equal((await changeStatus(orderAId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, baseTime + 3_100)).status, 200);
  assert.equal((await changeStatus(orderAId, { orderStatus: "delivered" }, baseTime + 3_200)).status, 200);
  assert.equal(await financialStateDigest(), beforeReplayA, "les rejeux A ne doivent produire aucun effet financier");
  const afterReplayAOrder = record((await db.collection("orders").doc(orderAId).get()).data());
  assert.equal(Array.isArray(afterReplayAOrder.statusHistory) ? afterReplayAOrder.statusHistory.length : 0, beforeReplayAHistoryLength);
  assert.equal(record((await db.collection("products").doc("recette-product-v1").get()).data()).stock, beforeReplayAStock);
  const aReplay = await observeStage("A — rejeu paiement/livraison", orderAId);
  assertMovementJournal(aReplay, expectedJournal);
  assert.deepEqual(aReplay.movementEvents, aDelivered.movementEvents, "les rejeux A doivent conserver le journal complet");
  stages.push(aDelivered);

  const quotedB = await quoteOrder(500, baseTime + 4_000);
  assert.equal(quotedB.status, 200, JSON.stringify(quotedB.body));
  const quoteB = record(quotedB.body) as OrderQuote;
  const proposalB = record(quoteB.cagnotteUse);
  assert.deepEqual([
    proposalB.productsAfterDiscountsCents,
    proposalB.deliveryCents,
    proposalB.proposedCagnotteCents,
    proposalB.payableCents,
    proposalB.estimatedLoyaltyCents,
  ], [10_000, 0, 500, 9_500, 475]);
  const beforeBRead = aDelivered.clientRead;

  const createdB = await createOrder(
    acceptedCheckout("00000000-0000-4000-8000-00000000000b", proposalB, 500),
    baseTime + 4_000,
  );
  assert.equal(createdB.status, 200, JSON.stringify(createdB.body));
  const creationB = record(createdB.body) as CheckoutOrderResult;
  const orderBId = String(creationB.orderId);
  assert.equal(creationB.paymentAmount, 95);
  assert.deepEqual(creationB.cagnotteUse, { amountCents: 500, state: "reserved" });
  expectedJournal.push([
    expectedReservationMovement(orderBId, "credit_reserved", baseTime + 4_000, deltas(0, -500, 500, 0)),
  ]);
  const bReserved = await observeStage("B — cagnotte réservée", orderBId);
  assert.deepEqual(walletTuple(bReserved), [0, 0, 500, 0]);
  assert.deepEqual(reservationTuple(bReserved), [500, "reserved", 0]);
  assert.equal(bReserved.order.snapshotLoyaltyCents, 475);
  assert.equal(bReserved.order.snapshotAppliedCents, 500);
  assertMovementJournal(bReserved, expectedJournal);
  stages.push(bReserved);

  assert.equal((await changeStatus(orderBId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, baseTime + 5_000)).status, 200);
  expectedJournal.push([
    expectedLedgerMovement(orderBId, "payment_confirmed", baseTime + 5_000, deltas(475, 0, 0, 0)),
    expectedReservationMovement(orderBId, "credit_consumed", baseTime + 5_000, deltas(0, 0, -500, 0)),
  ]);
  const bPaid = await observeStage("B — paiement confirmé", orderBId);
  assert.deepEqual(walletTuple(bPaid), [475, 0, 0, 0]);
  assert.deepEqual(accrualTuple(bPaid), [475, 475, "pending", true, false]);
  assert.deepEqual(reservationTuple(bPaid), [500, "consumed", 0]);
  assertMovementJournal(bPaid, expectedJournal);
  stages.push(bPaid);

  assert.equal((await changeStatus(orderBId, { orderStatus: "delivered" }, baseTime + 6_000)).status, 200);
  expectedJournal.push([
    expectedLedgerMovement(orderBId, "delivery_confirmed", baseTime + 6_000, deltas(0, 0, 0, 0)),
    expectedLedgerMovement(orderBId, "made_available", baseTime + 6_000, deltas(-475, 475, 0, 0)),
  ]);
  const bDelivered = await observeStage("B — livraison confirmée", orderBId);
  assert.deepEqual(walletTuple(bDelivered), [0, 475, 0, 0]);
  assert.deepEqual(accrualTuple(bDelivered), [475, 475, "available", true, true]);
  assertMovementJournal(bDelivered, expectedJournal);
  stages.push(bDelivered);

  const orderB = record((await db.collection("orders").doc(orderBId).get()).data());
  const snapshotB = record(record(orderB.cagnotte).snapshot);
  const lineB = record((snapshotB.lines as unknown[])[0]);
  const refundSelection = {
    action: "preview",
    orderId: orderBId,
    currency: "EUR",
    additionalReturns: [{ lineId: String(lineB.lineId), additionalNetCents: 10_000 }],
    deliveryRefundCents: 0,
  };
  const refundPreview = await refund({ ...refundSelection, authToken: "synthetic-admin-token" }, baseTime + 8_000);
  assert.equal(refundPreview.status, 200, JSON.stringify(refundPreview.body));
  const preview = record(record(refundPreview.body).result);
  assert.deepEqual([
    preview.totalFinancialCents,
    preview.cagnotteRestitutionCents,
    record(preview.correction).theoreticalCents,
  ], [9_500, 500, 475]);

  const refundReference = "recette-v1-remboursement-b";
  const refundCommand = {
    ...refundSelection,
    action: "record_confirmed",
    source: "admin",
    reference: refundReference,
    declaredFinancialCents: preview.totalFinancialCents,
    reason: "product_return",
    confirmedAt: new Date(baseTime + 7_000).toISOString(),
    expectedPreviewVersion: preview.previewVersion,
    authToken: "synthetic-admin-token",
  };
  const refundRecorded = await refund(refundCommand, baseTime + 8_000);
  assert.equal(refundRecorded.status, 200, JSON.stringify(refundRecorded.body));
  const recordedResult = record(record(refundRecorded.body).result);
  assert.deepEqual([
    recordedResult.totalFinancialCents,
    recordedResult.cagnotteRestitutionCents,
    record(recordedResult.correction).appliedCents,
    record(recordedResult.restitution).availableIncreaseCents,
  ], [9_500, 500, 475, 500]);
  const refundId = refundBusinessEventId("admin", refundReference);
  expectedJournal.push([
    expectedLedgerMovement(orderBId, "refund_confirmed", baseTime + 8_000, deltas(0, -475, 0, 0), refundId),
    expectedReservationMovement(orderBId, "credit_refunded_after_return", baseTime + 8_000, deltas(0, 500, 0, 0), refundId),
  ]);
  const bRefunded = await observeStage("B — remboursement intégral enregistré", orderBId);
  assert.deepEqual(walletTuple(bRefunded), [0, 500, 0, 0]);
  assert.deepEqual(accrualTuple(bRefunded), [475, 0, "available", true, true]);
  assert.deepEqual(reservationTuple(bRefunded), [500, "consumed", 0]);
  assert.deepEqual(bRefunded.adminReservation, { amountCents: 500, state: "consumed", cumulativeRestitutedCents: 500 });
  assert.equal(bRefunded.adminRefundCount, 1);
  assertMovementJournal(bRefunded, expectedJournal);
  assertJournalNegativeCases(bRefunded, expectedJournal);
  stages.push(bRefunded);

  const beforeRefundReplay = await businessDigest();
  const refundReplay = await refund(refundCommand, baseTime + 9_000);
  assert.equal(refundReplay.status, 200, JSON.stringify(refundReplay.body));
  assert.equal(record(record(refundReplay.body).result).alreadyRecorded, true);
  assert.equal(await businessDigest(), beforeRefundReplay, "le rejeu du remboursement ne doit rien modifier");
  const bReplay = await observeStage("B — rejeu du remboursement", orderBId);
  assert.deepEqual(walletTuple(bReplay), [0, 500, 0, 0]);
  assert.equal(bReplay.adminRefundCount, 1);
  assertMovementJournal(bReplay, expectedJournal);
  assert.deepEqual(bReplay.movementEvents, bRefunded.movementEvents, "le rejeu du remboursement doit conserver le journal complet");
  stages.push(bReplay);

  const artifactRoot = resolve("node_modules/.cache/verdanza-cagnotte-recette-v1");
  await mkdir(artifactRoot, { recursive: true });
  const beforeBHtml = await renderRecipePage({
    title: "Commande B — proposition vérifiée",
    note: "Le portefeuille et le devis proviennent du même parcours Firestore local.",
    wallet: beforeBRead,
    checkout: checkoutState(beforeBRead, quoteB),
  });
  const finalHtml = await renderRecipePage({
    title: "Après remboursement intégral de la commande B",
    note: "Le solde et l’historique proviennent de la lecture du portefeuille après enregistrement idempotent.",
    wallet: bRefunded.clientRead,
    creation: creationB,
  });
  const beforeBHtmlPath = resolve(artifactRoot, "01-commande-b-proposition.html");
  const finalHtmlPath = resolve(artifactRoot, "02-remboursement-final.html");
  await writeFile(beforeBHtmlPath, beforeBHtml, "utf8");
  await writeFile(finalHtmlPath, finalHtml, "utf8");
  screenshots.push(
    resolve(artifactRoot, "01-commande-b-proposition-desktop.png"),
    resolve(artifactRoot, "01-commande-b-proposition-mobile.png"),
    resolve(artifactRoot, "02-remboursement-final-desktop.png"),
    resolve(artifactRoot, "02-remboursement-final-mobile.png"),
  );

  const evidencePath = resolve(artifactRoot, "recette-values.json");
  await writeFile(evidencePath, `${JSON.stringify({
    environment: CAGNOTTE_DEMO,
    programs: { accrual: accrualProgram, reservation: reservationProgram },
    continuousWallet: stages.map(({ label, wallet, reservation, accrual }) => ({ label, wallet, reservation, accrual })),
    continuousJournal: stages.map(({ label, movementEvents }) => ({
      label,
      movementCount: movementEvents.length,
      movements: movementEvents.map((movement) => movementEvidence(movement)),
    })),
    negativeJournalCases: journalNegativeCases,
    orderA: { orderId: orderAId, estimatedGainCents: 500 },
    orderB: {
      orderId: orderBId,
      productsCents: 10_000,
      usedCagnotteCents: 500,
      externalPaymentCents: 9_500,
      earnedCents: 475,
      refundFinancialCents: 9_500,
      restoredCagnotteCents: 500,
      cancelledGainCents: 475,
    },
    screenshots,
  }, null, 2)}\n`, "utf8");

  console.table(stages.map((stage) => ({
    étape: stage.label,
    attente: stage.wallet?.pendingCents ?? 0,
    disponible: stage.wallet?.availableCents ?? 0,
    réservé: stage.wallet?.reservedCents ?? 0,
    régularisation: stage.wallet?.regularizationCents ?? 0,
    mouvements: stage.movementEvents.length,
  })));
  console.log(`Preuve synthétique écrite : ${evidencePath}`);
  console.log(`Sources UI synthétiques : ${beforeBHtmlPath}, ${finalHtmlPath}`);
  console.log("RECETTE V1 : parcours A → B → remboursement validé sans réinitialisation du portefeuille.");
} finally {
  await clearEmulator();
  await db.terminate();
}

async function seedSyntheticData() {
  await db.collection("products").doc("recette-product-v1").set({
    name: "Produit fictif recette V1",
    slug: "recette-product-v1",
    price: 10,
    stock: 100,
    isActive: true,
    category: "flowers",
    cultureType: "indoor",
  });
  await db.collection("adminUsers").doc(admin.uid).set({ isActive: true });
}

function checkoutBody(checkoutRequestId: string): JsonRecord {
  return {
    checkoutRequestId,
    items: [{ productId: "recette-product-v1", quantity: 10 }],
    deliveryMethod: "postal",
    complianceAccepted: true,
    preferredPaymentMethod: "card_payment_link",
    authToken: "synthetic-customer-token",
    customer: {
      firstName: "Camille",
      lastName: "Fictif",
      email: customer.email,
      phone: "0600000000",
      address: {
        firstName: "Camille",
        lastName: "Fictif",
        line1: "1 rue du Test",
        postalCode: "75001",
        city: "Paris",
        country: "FR",
      },
    },
  };
}

function quoteBody(requestedCents: number): JsonRecord {
  return {
    items: [{ productId: "recette-product-v1", quantity: 10 }],
    deliveryMethod: "postal",
    email: customer.email,
    address: {
      firstName: "Camille",
      lastName: "Fictif",
      line1: "1 rue du Test",
      postalCode: "75001",
      city: "Paris",
      country: "FR",
    },
    authToken: "synthetic-customer-token",
    cagnotteUse: { requestedCents },
  };
}

function acceptedCheckout(checkoutRequestId: string, proposal: JsonRecord, requestedCents: number): JsonRecord {
  return {
    ...checkoutBody(checkoutRequestId),
    cagnotteUse: {
      requestedCents,
      acceptance: {
        quoteVersion: proposal.quoteVersion,
        quoteFingerprint: proposal.quoteFingerprint,
        acceptedCagnotteCents: proposal.proposedCagnotteCents,
        acceptedPayableCents: proposal.payableCents,
      },
    },
  };
}

async function quoteOrder(requestedCents: number, nowEpochMs: number) {
  return invoke(createQuoteOrderHandler({
    getDb: () => db,
    verifyToken: async () => customer,
    accrualProgram,
    reservationProgram,
    getFirebaseProjectId: () => CAGNOTTE_DEMO.projectId,
    now: () => nowEpochMs,
  }), quoteBody(requestedCents));
}

async function createOrder(body: JsonRecord, nowEpochMs: number) {
  return invoke(createOrderHandler({
    getDb: () => db,
    verifyToken: async () => customer,
    accrualProgram,
    reservationProgram,
    getFirebaseProjectId: () => CAGNOTTE_DEMO.projectId,
    now: () => nowEpochMs,
    enforceRateLimit: async () => ({ allowed: true, code: "allowed", retryAfterSeconds: 0 }),
    processSideEffects: async () => ({
      client: { status: "skipped", reason: "synthetic" },
      admin: { status: "skipped", reason: "synthetic" },
    }),
  }), body);
}

async function changeStatus(orderId: string, patch: JsonRecord, nowEpochMs: number) {
  return invoke(createOrderStatusHandler({
    getDb: () => db,
    verifyToken: async () => admin,
    accrualProgram,
    reservationProgram,
    getFirebaseProjectId: () => CAGNOTTE_DEMO.projectId,
    sendStatusEmail: async () => ({ status: "skipped", reason: "synthetic" }),
    processAnalytics: async () => ({ status: "skipped" }),
    now: () => new Date(nowEpochMs).toISOString(),
  }), { orderId, authToken: "synthetic-admin-token", ...patch });
}

async function refund(body: JsonRecord, nowEpochMs: number) {
  return invoke(createOrderRefundHandler({
    enabled: true,
    getDb: () => db,
    verifyToken: async () => admin,
    now: () => new Date(nowEpochMs).toISOString(),
  }), body);
}

async function invoke(
  handler: (request: VercelRequestLike, response: VercelResponseLike) => Promise<void>,
  body: unknown,
): Promise<ApiResult> {
  let status = 0;
  let responseBody: unknown;
  const headers = new Map<string, unknown>();
  const response = {
    setHeader(name: string, value: unknown) { headers.set(name, value); },
    status(value: number) { status = value; return this; },
    json(value: unknown) { responseBody = value; },
  };
  await handler({ method: "POST", url: "/synthetic-local", headers: {}, body } as VercelRequestLike, response as unknown as VercelResponseLike);
  return { status, body: responseBody, headers };
}

async function observeStage(label: string, orderId: string) {
  const beforeRead = await businessDigest();
  const clientRead = await readCagnotte({
    db,
    beneficiaryId: customer.uid,
    scope: "self",
    limit: 50,
    cursorSecret,
    capabilities: { canRequestReservation: true, canAccrueLoyalty: true },
  });
  const inspectionResponse = await refund({ action: "inspect", orderId, authToken: "synthetic-admin-token" }, baseTime + 20_000);
  assert.equal(inspectionResponse.status, 200, JSON.stringify(inspectionResponse.body));
  assert.equal(await businessDigest(), beforeRead, `${label}: les lectures client/admin ne doivent rien écrire`);

  const [orderDoc, accrualDoc, reservationDoc, walletDoc, movements] = await Promise.all([
    db.collection("orders").doc(orderId).get(),
    db.collection("cagnotteAccruals").doc(orderId).get(),
    db.collection("cagnotteReservations").doc(orderId).get(),
    db.collection("cagnotteWallets").doc(customer.uid).get(),
    db.collection("cagnotteMovements").where("beneficiaryId", "==", customer.uid).get(),
  ]);
  assert.equal(orderDoc.exists, true, `${label}: commande absente`);
  const order = record(orderDoc.data());
  const cagnotte = record(order.cagnotte);
  const snapshot = record(cagnotte.snapshot);
  const adminInspection = record(record(inspectionResponse.body).result);
  const adminAccrualRaw = record(adminInspection.accrual);
  const adminWalletRaw = adminInspection.wallet === null ? null : record(adminInspection.wallet);
  const adminReservationRaw = record(adminInspection.reservation);
  const adminHistory = Array.isArray(adminInspection.history) ? adminInspection.history : [];
  const wallet = walletDoc.exists ? record(walletDoc.data()) : null;
  if (wallet) {
    assert.deepEqual([
      clientRead.wallet.pendingCents,
      clientRead.wallet.availableCents,
      clientRead.wallet.reservedCents,
      clientRead.wallet.regularizationCents,
    ], [wallet.pendingCents, wallet.availableCents, wallet.reservedCents, wallet.regularizationCents]);
  } else {
    assert.equal(clientRead.wallet.status, "not_created");
  }
  return {
    label,
    orderId,
    order: {
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      paymentAmountCents: Math.round(Number(order.paymentAmount ?? order.total) * 100),
      snapshotLoyaltyCents: snapshot.loyaltyCents as number,
      snapshotAppliedCents: snapshot.appliedCagnotteCents as number,
    },
    accrual: accrualDoc.exists ? record(accrualDoc.data()) : null,
    reservation: reservationDoc.exists ? record(reservationDoc.data()) : null,
    wallet,
    movementEvents: movements.docs
      .map((document) => ({ id: document.id, ...record(document.data()) }))
      .sort((a, b) => Number(a.recordedAtEpochMs) - Number(b.recordedAtEpochMs) || a.id.localeCompare(b.id)),
    clientRead,
    adminWallet: adminWalletRaw ? {
      pendingCents: adminWalletRaw.pendingCents,
      availableCents: adminWalletRaw.availableCents,
      reservedCents: adminWalletRaw.reservedCents,
      regularizationCents: adminWalletRaw.regularizationCents,
    } : null,
    adminAccrual: {
      present: adminAccrualRaw.present,
      initialGainCents: adminAccrualRaw.initialGainCents,
      remainingGainCents: adminAccrualRaw.remainingGainCents,
      compartment: adminAccrualRaw.compartment,
    },
    adminReservation: {
      amountCents: adminReservationRaw.amountCents,
      state: adminReservationRaw.state,
      cumulativeRestitutedCents: adminReservationRaw.cumulativeRestitutedCents,
    },
    adminRefundCount: adminHistory.length,
  };
}

function deltas(
  pendingDeltaCents: number,
  availableDeltaCents: number,
  reservedDeltaCents: number,
  regularizationDeltaCents: number,
): MovementDeltas {
  return { pendingDeltaCents, availableDeltaCents, reservedDeltaCents, regularizationDeltaCents };
}

function expectedLedgerMovement(
  orderId: string,
  businessEvent: "payment_confirmed" | "delivery_confirmed" | "made_available" | "refund_confirmed",
  recordedAtEpochMs: number,
  movementDeltas: MovementDeltas,
  refundId = "",
): ExpectedMovement {
  return expectedMovement(
    ledgerMovementKey(orderId, businessEvent, refundId),
    orderId,
    businessEvent,
    recordedAtEpochMs,
    movementDeltas,
  );
}

function expectedReservationMovement(
  orderId: string,
  businessEvent: "credit_reserved" | "credit_consumed" | "credit_refunded_after_return",
  recordedAtEpochMs: number,
  movementDeltas: MovementDeltas,
  reference?: string,
): ExpectedMovement {
  return expectedMovement(
    reservationMovementKey(orderId, businessEvent, reference),
    orderId,
    businessEvent,
    recordedAtEpochMs,
    movementDeltas,
  );
}

function expectedMovement(
  id: string,
  orderId: string,
  businessEvent: CagnotteMovement["businessEvent"],
  recordedAtEpochMs: number,
  movementDeltas: MovementDeltas,
): ExpectedMovement {
  return {
    id,
    eventKey: id,
    orderId,
    beneficiaryId: customer.uid,
    businessEvent,
    recordedAtEpochMs,
    schemaVersion: 3,
    regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION,
    reservationVersion: CAGNOTTE_RESERVATION_VERSION,
    calculationVersion: reservationProgram.calculationVersion,
    programVersion: reservationProgram.programVersion,
    currency: "EUR",
    origin: "internal_server",
    ...movementDeltas,
  };
}

function assertMovementJournal(stage: RecipeStage, expectedGroups: ExpectedMovementGroups) {
  for (const group of expectedGroups) {
    if (group.length < 2) continue;
    assert.equal(
      group.every((movement) => movement.recordedAtEpochMs === group[0].recordedAtEpochMs),
      true,
      `${stage.label}: un groupe de transition doit partager le même horodatage`,
    );
  }
  const expected = expectedGroups.flat();
  assert.equal(stage.movementEvents.length, expected.length, `${stage.label}: nombre exact de mouvements`);

  const actual = stage.movementEvents.map((movement) => {
    const evidence = movementEvidence(movement);
    assert.match(evidence.id, /^[a-f0-9]{64}$/, `${stage.label}: identifiant de mouvement canonique`);
    assert.equal(evidence.eventKey, evidence.id, `${stage.label}: eventKey doit égaler l'identifiant Firestore`);
    assert.equal(
      evidence.id,
      canonicalMovementKey(movement),
      `${stage.label}: clé canonique incorrecte pour ${evidence.businessEvent}`,
    );
    return evidence;
  });
  assert.equal(new Set(actual.map((movement) => movement.id)).size, actual.length, `${stage.label}: identifiants de mouvements uniques`);

  // Several writes in one business transition share a timestamp. Compare an
  // unordered canonical set instead of inventing an order within that group.
  const unordered = (values: readonly ExpectedMovement[]) => [...values]
    .sort((left, right) => stable(left).localeCompare(stable(right)));
  assert.deepEqual(unordered(actual), unordered(expected), `${stage.label}: journal métier exact`);

  const sums = actual.reduce<[number, number, number, number]>((current, movement) => [
    current[0] + movement.pendingDeltaCents,
    current[1] + movement.availableDeltaCents,
    current[2] + movement.reservedDeltaCents,
    current[3] + movement.regularizationDeltaCents,
  ], [0, 0, 0, 0]);
  const persisted = stage.wallet === null ? [0, 0, 0, 0] : [
    integerField(stage.wallet, "pendingCents", stage.label),
    integerField(stage.wallet, "availableCents", stage.label),
    integerField(stage.wallet, "reservedCents", stage.label),
    integerField(stage.wallet, "regularizationCents", stage.label),
  ];
  assert.deepEqual(sums, persisted, `${stage.label}: la somme du journal doit reconstituer le portefeuille persisté`);
}

function assertJournalNegativeCases(stage: RecipeStage, expectedGroups: ExpectedMovementGroups) {
  const expectRejected = (name: typeof journalNegativeCases[number], mutate: (movements: JsonRecord[]) => void) => {
    const movements = stage.movementEvents.map((movement) => structuredClone(movement) as JsonRecord);
    mutate(movements);
    assert.throws(
      () => assertMovementJournal({ ...stage, movementEvents: movements as RecipeStage["movementEvents"] }, expectedGroups),
      { name: "AssertionError" },
      `le cas négatif « ${name} » doit faire échouer l'assertion du journal`,
    );
  };

  expectRejected(journalNegativeCases[0], (movements) => { movements.pop(); });
  expectRejected(journalNegativeCases[1], (movements) => { movements.push(structuredClone(movements[0])); });
  expectRejected(journalNegativeCases[2], (movements) => { movements[0].businessEvent = "cancelled"; });
  expectRejected(journalNegativeCases[3], (movements) => {
    movements[0].pendingDeltaCents = integerField(movements[0], "pendingDeltaCents", "cas négatif") + 1;
  });
  expectRejected(journalNegativeCases[4], (movements) => {
    movements[0].orderId = "recette-order-foreign";
    movements[0].beneficiaryId = "recette-customer-foreign";
  });
}

function movementEvidence(value: JsonRecord): ExpectedMovement {
  assert.equal(value.schemaVersion, 3, "journal: schemaVersion");
  assert.equal(value.regularizationVersion, CAGNOTTE_REGULARIZATION_VERSION, "journal: regularizationVersion");
  assert.equal(value.reservationVersion, CAGNOTTE_RESERVATION_VERSION, "journal: reservationVersion");
  assert.equal(value.calculationVersion, reservationProgram.calculationVersion, "journal: calculationVersion");
  assert.equal(value.programVersion, reservationProgram.programVersion, "journal: programVersion");
  assert.equal(value.currency, "EUR", "journal: devise");
  assert.equal(value.origin, "internal_server", "journal: origine");
  const recordedAtEpochMs = integerField(value, "recordedAtEpochMs", "journal");
  assert.ok(recordedAtEpochMs >= 0, "journal: horodatage positif");
  return {
    id: stringField(value, "id", "journal"),
    eventKey: stringField(value, "eventKey", "journal"),
    orderId: stringField(value, "orderId", "journal"),
    beneficiaryId: stringField(value, "beneficiaryId", "journal"),
    businessEvent: stringField(value, "businessEvent", "journal") as CagnotteMovement["businessEvent"],
    recordedAtEpochMs,
    schemaVersion: 3,
    regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION,
    reservationVersion: CAGNOTTE_RESERVATION_VERSION,
    calculationVersion: reservationProgram.calculationVersion,
    programVersion: reservationProgram.programVersion,
    currency: "EUR",
    origin: "internal_server",
    pendingDeltaCents: integerField(value, "pendingDeltaCents", "journal"),
    availableDeltaCents: integerField(value, "availableDeltaCents", "journal"),
    reservedDeltaCents: integerField(value, "reservedDeltaCents", "journal"),
    regularizationDeltaCents: integerField(value, "regularizationDeltaCents", "journal"),
  };
}

function canonicalMovementKey(movement: JsonRecord): string {
  const orderId = stringField(movement, "orderId", "journal");
  const event = stringField(movement, "businessEvent", "journal");
  if (["credit_reserved", "credit_consumed", "credit_released"].includes(event)) {
    return reservationMovementKey(orderId, event);
  }
  if (event === "credit_refunded_after_return") {
    const payload = record(JSON.parse(stringField(movement, "payload", "journal")));
    return reservationMovementKey(orderId, event, stringField(payload, "refundId", "journal payload"));
  }
  if (["payment_confirmed", "delivery_confirmed", "made_available", "cancelled"].includes(event)) {
    return ledgerMovementKey(orderId, event);
  }
  if (event === "refund_confirmed") {
    const payload = record(JSON.parse(stringField(movement, "payload", "journal")));
    return ledgerMovementKey(orderId, event, stringField(payload, "refundId", "journal payload"));
  }
  assert.fail(`journal: événement inattendu ${event}`);
}

function ledgerMovementKey(orderId: string, event: string, refundId = "") {
  return createHash("sha256").update(JSON.stringify([orderId, event, refundId])).digest("hex");
}

function reservationMovementKey(orderId: string, event: string, reference?: string) {
  return createHash("sha256").update(JSON.stringify(reference
    ? ["reservation", orderId, event, reference]
    : ["reservation", orderId, event])).digest("hex");
}

function refundBusinessEventId(source: string, reference: string) {
  return createHash("sha256").update(stable([source, reference])).digest("hex");
}

function stringField(value: JsonRecord, key: string, context: string): string {
  assert.equal(typeof value[key], "string", `${context}: ${key} doit être une chaîne`);
  return value[key] as string;
}

function integerField(value: JsonRecord, key: string, context: string): number {
  assert.equal(Number.isSafeInteger(value[key]), true, `${context}: ${key} doit être un entier sûr`);
  const integer = value[key] as number;
  return integer === 0 ? 0 : integer;
}

function walletTuple(stage: RecipeStage): [unknown, unknown, unknown, unknown] | null {
  if (!stage.wallet) return null;
  return [stage.wallet.pendingCents, stage.wallet.availableCents, stage.wallet.reservedCents, stage.wallet.regularizationCents];
}

function accrualTuple(stage: RecipeStage): [unknown, unknown, unknown, unknown, unknown] | null {
  if (!stage.accrual) return null;
  return [stage.accrual.initialGainCents, stage.accrual.remainingGainCents, stage.accrual.compartment, stage.accrual.paymentConfirmed, stage.accrual.deliveryConfirmed];
}

function reservationTuple(stage: RecipeStage): [unknown, unknown, unknown] | null {
  if (!stage.reservation) return null;
  return [stage.reservation.amountCents, stage.reservation.state, stage.reservation.cumulativeRestitutedCents ?? 0];
}

function checkoutState(wallet: CagnotteReadResponse, quote: OrderQuote): CagnotteCheckoutState {
  const proposal = quote.cagnotteUse;
  assert.ok(proposal);
  return {
    identityKey: customer.uid,
    contextKey: "recette-order-b",
    walletPhase: "ready",
    wallet,
    walletErrorCode: null,
    selectionEnabled: true,
    amountInput: "5,00",
    amountError: null,
    proposalPhase: "ready",
    proposal: quote,
    acceptance: {
      quoteVersion: proposal.quoteVersion,
      quoteFingerprint: proposal.quoteFingerprint,
      acceptedCagnotteCents: proposal.proposedCagnotteCents,
      acceptedPayableCents: proposal.payableCents,
    },
    proposalErrorCode: null,
    fallbackPhase: "idle",
    fallbackQuote: null,
    fallbackAccepted: false,
    announcement: "Montant vérifié et accepté.",
  };
}

async function renderRecipePage(input: {
  title: string;
  note: string;
  wallet: CagnotteReadResponse;
  checkout?: CagnotteCheckoutState;
  creation?: CheckoutOrderResult;
}) {
  const styles = await Promise.all([
    readFile(resolve("src/styles/cagnotte.css"), "utf8"),
    readFile(resolve("src/styles/cagnotte-checkout.css"), "utf8"),
  ]);
  const markup = renderToStaticMarkup(<>
    <header className="recipe-heading">
      <p>Recette locale isolée · données fictives</p>
      <h1>{input.title}</h1>
      <span>{input.note}</span>
    </header>
    <CagnotteView
      state={{ phase: "ready", data: input.wallet, errorCode: null }}
      instanceId="recette-wallet"
      demonstration
    />
    {input.checkout && <CagnotteCheckoutView
      mode="checkout"
      state={input.checkout}
      authenticated
      instanceId="recette-checkout"
      demonstration
      onToggle={() => undefined}
      onAmountChange={() => undefined}
      onRequest={() => undefined}
      onMaximum={() => undefined}
      onAccept={() => undefined}
      onContinueWithout={() => undefined}
      onAcceptWithout={() => undefined}
    />}
    {input.creation && <CheckoutCreationSummary result={input.creation} demonstration />}
  </>);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box}body{margin:0;background:#f4f0e7;color:#111;font-family:Inter,Arial,sans-serif}main{display:grid;gap:24px;width:min(1120px,calc(100% - 32px));margin:32px auto 64px}.recipe-heading{display:grid;gap:8px}.recipe-heading p{margin:0;color:#6f5527;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.recipe-heading h1{margin:0;color:#0e3726;font:700 clamp(2rem,5vw,3.5rem)/1.05 Georgia,serif}.recipe-heading span{max-width:70ch;color:#38443d;line-height:1.5}${styles.join("\n")}
    @media(max-width:640px){main{width:min(100% - 20px,1120px);margin:20px auto 40px;gap:16px}}
  </style></head><body><main>${markup}</main></body></html>`;
}

async function businessDigest() {
  const documents = await Promise.all(businessCollections.map(async (collection) => ({
    collection,
    documents: (await db.collection(collection).get()).docs
      .map((document) => ({ id: document.id, data: document.data() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })));
  return stable(documents);
}

async function financialStateDigest() {
  const documents = await Promise.all(businessCollections.filter((collection) => collection !== "orders").map(async (collection) => ({
    collection,
    documents: (await db.collection(collection).get()).docs
      .map((document) => ({ id: document.id, data: document.data() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })));
  return stable(documents);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const candidate = value as JsonRecord & { toJSON?: () => unknown };
    if (typeof candidate.toJSON === "function") return stable(candidate.toJSON());
    return `{${Object.keys(candidate).sort().map((key) => `${JSON.stringify(key)}:${stable(candidate[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): JsonRecord {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

async function clearEmulator() {
  for (const collection of cleanupCollections) {
    const documents = await db.collection(collection).get();
    if (documents.empty) continue;
    const batch = db.batch();
    documents.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}
