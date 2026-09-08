import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { createOrderHandler } from "../api/create-order.js";
import { createQuoteOrderHandler } from "../api/quote-order.js";
import { createOrderStatusHandler } from "../api/_server/orderStatusRoute.js";
import { createSendPaymentLinkHandler } from "../api/_server/sendPaymentLinkRoute.js";
import { readUnpaidOrderContext } from "../api/_server/unpaidOrderReview.js";
import { applyCagnotteLedgerOperation } from "../api/_server/cagnotteLedger.js";
import { CAGNOTTE_RESERVATION_PROGRAM } from "../api/_server/cagnotteReservations.js";
import { CAGNOTTE_RESERVATION_VERSION, type CagnotteInternalOrder, type CagnotteWallet } from "../api/_server/cagnotteLedgerTypes.js";
import type { CagnotteReservationTestProgram } from "../api/_server/cagnotteReservationTypes.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { assertWalletJournal, fixtureSpentGain } from "./cagnotteRegularizationFixtures.js";
import { CAGNOTTE_DEMO, connectCagnotteEmulator, validateCagnotteTestEnvironment } from "./cagnotteEmulator.js";
import type { VerifiedFirebaseUser } from "../api/_server/adminAuth.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import type { Order } from "../src/types/index.js";

validateCagnotteTestEnvironment(process.env);
const rawDb = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const program: CagnotteReservationTestProgram = Object.freeze({
  mode: "local_test",
  programVersion: "checkout-use-test-v1",
  calculationVersion: "cagnotte-math-v1",
  startsAtEpochMs: 1_000,
  newAccrualsEnabled: true,
  reservationVersion: CAGNOTTE_RESERVATION_VERSION,
  reservationsEnabled: true,
});
const admin: VerifiedFirebaseUser = {
  uid: "checkout-admin",
  email: "checkout-admin@example.test",
  emailVerified: true,
};
const collections = [
  "adminUsers", "analyticsOperationalEvents", "analyticsOutbox", "cagnotteAccruals",
  "cagnotteMovements", "cagnotteReservations", "cagnotteWallets", "checkoutRequests",
  "coupons", "invoices", "orderSideEffects", "orders", "paymentLinkRequests",
  "productCosts", "products", "publicRateLimits", "stockMovements", "supplierPurchases",
];
let sequence = 0;
let passed = 0;
const counts = new Map<string, number>();

try {
  await test("Gardes HTTP", "ordinaire conservé, positif authentifié et désactivé refusé", async () => {
    await seed();
    const ordinaryQuote = await quote({ ...quoteBody(), cagnotteUse: undefined }, null, undefined);
    assert.equal(ordinaryQuote.status, 200);
    assert.equal("cagnotteUse" in record(ordinaryQuote.body), false);
    const guestOrder = await create({ ...checkoutBody(), checkoutRequestId: randomUUID(), cagnotteUse: undefined }, null, undefined);
    assert.equal(guestOrder.status, 200);
    assert.equal((await orders()).length, 1);
    await clear(); await seed();
    const unauthenticated = await quote(quoteBody(), program, undefined);
    assert.equal(unauthenticated.status, 401);
    const disabled = await quote(quoteBody(), null, "customer-a");
    assert.equal(disabled.status, 409);
    const disabledCreate = await create(checkoutBody(), null, "customer-a");
    assert.equal(disabledCreate.status, 409);
    assert.equal((await orders()).length, 0);
    assert.equal(CAGNOTTE_RESERVATION_PROGRAM, null);
  });

  await test("Parcours HTTP", "100 EUR, devis 8 EUR, création, lien 92 EUR, paiement, livraison", async () => {
    await seed(); await fund("customer-a", "fund-main");
    const beforeQuote = await businessSnapshot();
    const quoted = await quote(quoteBody(), program, "customer-a");
    assert.equal(quoted.status, 200);
    const proposal = record(record(quoted.body).cagnotteUse);
    assert.deepEqual(
      [proposal.productsAfterDiscountsCents, proposal.deliveryCents, proposal.proposedCagnotteCents,
        proposal.payableCents, proposal.estimatedLoyaltyCents],
      [10_000, 0, 800, 9_200, 460],
    );
    assert.match(String(quoted.headers.get("Cache-Control")), /private/);
    assert.deepEqual(await businessSnapshot(), beforeQuote, "le devis ne doit rien écrire");
    const request = acceptedCheckout(proposal);
    const created = await create(request, program, "customer-a");
    assert.equal(created.status, 200);
    assert.equal(record(created.body).paymentAmount, 92);
    const orderId = String(record(created.body).orderId);
    assertWallet(await wallet("customer-a"), [0, 1_200, 800, 0]);
    assert.equal((await reservation(orderId)).state, "reserved");
    let sentAmount = 0;
    const linked = await sendLink(orderId, 92, async (_order, request) => {
      sentAmount = request.paymentLinkAmount;
      return { status: "sent", id: "synthetic-provider-acceptance" };
    });
    assert.equal(linked.status, 200);
    assert.equal(sentAmount, 92);
    assertWallet(await wallet("customer-a"), [0, 1_200, 800, 0]);
    await status(orderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program);
    assertWallet(await wallet("customer-a"), [460, 1_200, 0, 0]);
    assert.equal((await reservation(orderId)).state, "consumed");
    await status(orderId, { orderStatus: "delivered" }, program);
    assertWallet(await wallet("customer-a"), [0, 1_660, 0, 0]);
    await assertWalletJournal(rawDb, "customer-a");
  });

  await test("Parcours HTTP", "paiement et livraison combinés ont le même résultat", async () => {
    await seed(); await fund("customer-a", "fund-combined");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const created = await create(acceptedCheckout(proposal), program, "customer-a");
    const orderId = String(record(created.body).orderId);
    const result = await status(orderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link", orderStatus: "delivered" }, program);
    assert.equal(result.status, 200);
    assertWallet(await wallet("customer-a"), [0, 1_660, 0, 0]);
    const beforeMovements = (await rawDb.collection("cagnotteMovements").get()).size;
    const beforeStock = (await rawDb.collection("products").doc("product-main").get()).data()?.stock;
    assert.equal((await status(orderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link", orderStatus: "delivered" }, program)).status, 200);
    assertWallet(await wallet("customer-a"), [0, 1_660, 0, 0]);
    assert.equal((await rawDb.collection("cagnotteMovements").get()).size, beforeMovements);
    assert.equal((await rawDb.collection("products").doc("product-main").get()).data()?.stock, beforeStock);
  });

  await test("Ordre des événements", "livraison seule conserve la réservation puis paiement libère le gain", async () => {
    await seed(); await fund("customer-a", "fund-delivery-first");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const created = await create(acceptedCheckout(proposal), program, "customer-a");
    const orderId = String(record(created.body).orderId);
    await status(orderId, { orderStatus: "delivered" }, program);
    assertWallet(await wallet("customer-a"), [0, 1_200, 800, 0]);
    assert.equal((await reservation(orderId)).state, "reserved");
    await status(orderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program);
    assertWallet(await wallet("customer-a"), [0, 1_660, 0, 0]);
  });

  await test("Acceptation", "montants falsifiés et prix modifié imposent un nouveau devis sans écriture métier", async () => {
    await seed(); await fund("customer-a", "fund-conflict");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const forged = acceptedCheckout(proposal);
    forged.cagnotteUse.acceptance.acceptedCagnotteCents = 900;
    const beforeForged = await businessSnapshot();
    assert.equal((await create(forged, program, "customer-a")).status, 409);
    assertBusinessUnchanged(beforeForged, await businessSnapshot());
    const accepted = acceptedCheckout(proposal);
    await rawDb.collection("products").doc("product-main").update({ price: 11 });
    const beforePrice = await businessSnapshot();
    assert.equal((await create(accepted, program, "customer-a")).status, 409);
    assertBusinessUnchanged(beforePrice, await businessSnapshot());
  });

  await test("Solde", "variation suffisante tolérée, insuffisance refusée atomiquement", async () => {
    await seed(); await fund("customer-a", "fund-balance");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    await rawDb.collection("cagnotteWallets").doc("customer-a").update({ availableCents: 2_100 });
    const movementRef = rawDb.collection("cagnotteMovements").doc("synthetic-balance-plus");
    await movementRef.set(movement("customer-a", "synthetic-balance-plus", 100));
    assert.equal((await create(acceptedCheckout(proposal), program, "customer-a")).status, 200);
    await clear(); await seed(); await fund("customer-a", "fund-low");
    const lowProposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    await rawDb.collection("cagnotteWallets").doc("customer-a").update({ availableCents: 700 });
    await rawDb.collection("cagnotteMovements").doc("synthetic-balance-minus").set(movement("customer-a", "synthetic-balance-minus", -1_300));
    const before = await businessSnapshot();
    assert.equal((await create(acceptedCheckout(lowProposal), program, "customer-a")).status, 409);
    assertBusinessUnchanged(before, await businessSnapshot());
  });

  await test("Concurrence", "deux réservations dépassant ensemble le disponible : une seule commande", async () => {
    await seed(); await fund("customer-a", "fund-race");
    const requested = quoteBody(1_500);
    const proposal = record(record((await quote(requested, program, "customer-a")).body).cagnotteUse);
    const first = acceptedCheckout(proposal, randomUUID(), 1_500);
    const second = acceptedCheckout(proposal, randomUUID(), 1_500);
    const results = await Promise.all([create(first, program, "customer-a"), create(second, program, "customer-a")]);
    assert.equal(results.filter((entry) => entry.status === 200).length, 1);
    assert.equal(results.filter((entry) => entry.status === 409).length, 1);
    assert.equal((await orders()).length, 1);
    assertWallet(await wallet("customer-a"), [0, 500, 1_500, 0]);
  });

  await test("Idempotence", "deux créations identiques concurrentes retournent la même commande", async () => {
    await seed(); await fund("customer-a", "fund-identical");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const request = acceptedCheckout(proposal);
    const results = await Promise.all([create(request, program, "customer-a"), create(request, program, "customer-a")]);
    assert.deepEqual(results.map((entry) => entry.status), [200, 200]);
    assert.equal(record(results[0].body).orderId, record(results[1].body).orderId);
    assert.equal((await orders()).length, 1);
    assertWallet(await wallet("customer-a"), [0, 1_200, 800, 0]);
  });

  await test("Identité", "bénéficiaire et bloc cagnotte déclarés par le client ne font pas autorité", async () => {
    await seed(); await fund("customer-a", "fund-identity");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const request = {
      ...acceptedCheckout(proposal),
      customerId: "attacker",
      beneficiaryId: "attacker",
      cagnotte: { beneficiaryId: "attacker", availableCents: 999_999 },
    };
    const created = await create(request, program, "customer-a");
    assert.equal(created.status, 200);
    const stored = await order(String(record(created.body).orderId));
    assert.equal(stored.customerId, "customer-a");
    assert.equal(stored.cagnotte?.beneficiaryId, "customer-a");
    assert.equal(stored.cagnotte?.snapshot.appliedCagnotteCents, 800);
  });

  await test("Reprise", "réponse perdue, autre identité refusée, suspension tolérée", async () => {
    await seed(); await fund("customer-a", "fund-retry");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const request = acceptedCheckout(proposal);
    let effects = 0;
    const failedResponse = await create(request, program, "customer-a", async () => {
      effects += 1;
      throw new Error("synthetic effect failure after commit");
    });
    assert.equal(failedResponse.status, 400);
    assert.equal((await orders()).length, 1);
    const before = await businessSnapshot();
    const suspended = { ...program, reservationsEnabled: false };
    const replay = await create(request, suspended, "customer-a");
    assert.equal(replay.status, 200);
    assert.deepEqual(await businessSnapshot(), before);
    assert.equal(effects, 1);
    assert.equal((await create(request, suspended, "customer-b")).status, 409);
  });

  await test("Annulation", "avant paiement libère une fois et paiement tardif est refusé", async () => {
    await seed(); await fund("customer-a", "fund-cancel-before");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const orderId = String(record((await create(acceptedCheckout(proposal), program, "customer-a")).body).orderId);
    assert.equal((await status(orderId, await reviewedCancellationPatch(orderId), program)).status, 200);
    assertWallet(await wallet("customer-a"), [0, 2_000, 0, 0]);
    assert.equal((await reservation(orderId)).state, "released");
    const stock = (await rawDb.collection("products").doc("product-main").get()).data()?.stock;
    assert.equal((await status(orderId, { orderStatus: "cancelled" }, program)).status, 200);
    assert.equal((await rawDb.collection("products").doc("product-main").get()).data()?.stock, stock);
    assert.equal((await status(orderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program)).status, 409);
  });

  await test("Annulation", "après consommation ne restitue pas le crédit, même après libellé impayé", async () => {
    await seed(); await fund("customer-a", "fund-cancel-after");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const orderId = String(record((await create(acceptedCheckout(proposal), program, "customer-a")).body).orderId);
    await status(orderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link", orderStatus: "delivered" }, program);
    await status(orderId, { paymentStatus: "pending" }, program);
    await status(orderId, { orderStatus: "cancelled" }, program);
    assert.equal((await reservation(orderId)).state, "consumed");
    assertWallet(await wallet("customer-a"), [0, 1_200, 0, 0]);
  });

  await test("Annulation", "libération brute puis compensation de régularisation", async () => {
    await seed();
    const source = await fund("customer-a", "fund-regularized-release");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const orderId = String(record((await create(acceptedCheckout(proposal), program, "customer-a")).body).orderId);
    await fixtureSpentGain(rawDb, "customer-a", source.orderId, 1_200, program.programVersion);
    await applyCagnotteLedgerOperation({ db: rawDb, program: null, recordedAtEpochMs: 40_000, command: { order: source, event: "cancelled" } });
    assertWallet(await wallet("customer-a"), [0, 0, 800, 2_000]);
    await status(orderId, await reviewedCancellationPatch(orderId), program);
    assertWallet(await wallet("customer-a"), [0, 0, 0, 1_200]);
    assert.equal((await reservation(orderId)).releaseCompensationCents, 800);
    await assertWalletJournal(rawDb, "customer-a");
  });

  await test("Concurrence", "paiement et annulation concurrents aboutissent à un seul état terminal cohérent", async () => {
    await seed(); await fund("customer-a", "fund-terminal-race");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const orderId = String(record((await create(acceptedCheckout(proposal), program, "customer-a")).body).orderId);
    const cancellation = await reviewedCancellationPatch(orderId);
    const results = await Promise.all([
      status(orderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program),
      status(orderId, cancellation, program),
    ]);
    assert.ok(results.some((entry) => entry.status === 200));
    const stored = await order(orderId);
    if (stored.orderStatus === "cancelled") assert.equal(stored.paymentStatus, "cancelled");
    else assert.equal(stored.paymentStatus, "paid");
    const terminalReservation = await reservation(orderId);
    assert.ok(terminalReservation.state === "released" || terminalReservation.state === "consumed");
    const currentWallet = await wallet("customer-a");
    assert.equal(currentWallet.reservedCents, 0);
    if (stored.orderStatus === "cancelled") assertWallet(currentWallet, [0, 2_000, 0, 0]);
    else assertWallet(currentWallet, [460, 1_200, 0, 0]);
    await assertWalletJournal(rawDb, "customer-a");
  });

  await test("Intégrité", "réservation manquante bloque la confirmation sans paiement partiel", async () => {
    await seed(); await fund("customer-a", "fund-missing");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const orderId = String(record((await create(acceptedCheckout(proposal), program, "customer-a")).body).orderId);
    await rawDb.collection("cagnotteReservations").doc(orderId).delete();
    const before = await businessSnapshot();
    assert.equal((await status(orderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }, program)).status, 409);
    assertBusinessUnchanged(before, await businessSnapshot());
    assert.equal((await order(orderId)).paymentStatus, "to_confirm");
  });

  await test("Atomicité", "erreur forcée avant commit ne laisse aucune commande ni réservation", async () => {
    await seed(); await fund("customer-a", "fund-rollback");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const before = await businessSnapshot();
    const result = await create(acceptedCheckout(proposal), program, "customer-a", undefined, true);
    assert.equal(result.status, 400);
    assertBusinessUnchanged(before, await businessSnapshot());
  });

  await test("Lien", "montant brut 100 EUR refusé avant envoi pour une commande payable 92 EUR", async () => {
    await seed(); await fund("customer-a", "fund-link-mismatch");
    const proposal = record(record((await quote(quoteBody(), program, "customer-a")).body).cagnotteUse);
    const orderId = String(record((await create(acceptedCheckout(proposal), program, "customer-a")).body).orderId);
    let sends = 0;
    const result = await sendLink(orderId, 100, async () => { sends += 1; return { status: "sent", id: "unexpected" }; });
    assert.equal(result.status, 409);
    assert.equal(sends, 0);
    assertWallet(await wallet("customer-a"), [0, 1_200, 800, 0]);
  });

  await test("Suspension", "réservation existante finalisée sans gain nouveau", async () => {
    await seed(); await fund("customer-a", "fund-suspended-gains");
    const suspendedGains = { ...program, newAccrualsEnabled: false };
    const proposal = record(record((await quote(quoteBody(), suspendedGains, "customer-a")).body).cagnotteUse);
    const orderId = String(record((await create(acceptedCheckout(proposal), suspendedGains, "customer-a")).body).orderId);
    await status(orderId, { paymentStatus: "paid", finalPaymentMethod: "card_payment_link", orderStatus: "delivered" }, suspendedGains);
    assertWallet(await wallet("customer-a"), [0, 1_200, 0, 0]);
    assert.equal((await reservation(orderId)).state, "consumed");
  });

  await test("Cumuls", "code promotionnel reste visible et bloque l’utilisation", async () => {
    await seed(true); await fund("customer-a", "fund-promo");
    const result = await quote({ ...quoteBody(), couponCode: "TEST5" }, program, "customer-a");
    assert.equal(result.status, 200);
    const proposal = record(record(result.body).cagnotteUse);
    assert.equal(proposal.proposedCagnotteCents, 0);
    assert.equal(record(proposal.compatibility).status, "blocked");
    assert.ok((proposal.limitationReasons as string[]).includes("compatibility_blocked"));
  });

  console.table(Object.fromEntries(counts));
  console.log(`LOT 4B : ${passed} scénarios d’intégration locale réussis.`);
} finally {
  await clear();
  await rawDb.terminate();
}

async function test(group: string, name: string, run: () => Promise<void>) {
  await clear();
  try { await run(); }
  catch (error) { console.error(`FAIL [${group}] ${name}`); throw error; }
  counts.set(group, (counts.get(group) ?? 0) + 1);
  console.log(`OK ${++passed} - ${group} - ${name}`);
}

async function seed(withCoupon = false) {
  await rawDb.collection("products").doc("product-main").set({
    name: "Produit synthétique", slug: "product-main", price: 10, stock: 1_000,
    isActive: true, category: "flowers", cultureType: "indoor",
  });
  await rawDb.collection("adminUsers").doc(admin.uid).set({ isActive: true });
  if (withCoupon) await rawDb.collection("coupons").doc("test5").set({
    code: "TEST5", label: "Test 5", isActive: true, usedCount: 0,
    minimumOrder: 0, discountType: "fixed", discountValue: 5,
  });
}

function quoteBody(requestedCents = 800) {
  return {
    items: [{ productId: "product-main", quantity: 10 }],
    deliveryMethod: "postal",
    email: "customer@example.test",
    address: { firstName: "Test", lastName: "Client", line1: "1 rue Test", postalCode: "75001", city: "Paris", country: "FR" },
    authToken: "synthetic-customer-token",
    cagnotteUse: { requestedCents },
  };
}

function checkoutBody(requestedCents = 800) {
  return {
    checkoutRequestId: randomUUID(),
    items: [{ productId: "product-main", quantity: 10 }],
    deliveryMethod: "postal",
    complianceAccepted: true,
    preferredPaymentMethod: "card_payment_link",
    authToken: "synthetic-customer-token",
    customer: {
      firstName: "Test", lastName: "Client", email: "customer@example.test", phone: "0600000000",
      address: { firstName: "Test", lastName: "Client", line1: "1 rue Test", postalCode: "75001", city: "Paris", country: "FR" },
    },
    cagnotteUse: { requestedCents },
  };
}

function acceptedCheckout(proposal: Record<string, unknown>, requestId = randomUUID(), requestedCents = 800) {
  const body = checkoutBody(requestedCents);
  body.checkoutRequestId = requestId;
  return {
    ...body,
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

async function quote(body: Record<string, unknown>, selectedProgram: CagnotteReservationTestProgram | null, identity: string | undefined) {
  const handler = createQuoteOrderHandler({
    getDb: () => rawDb,
    reservationProgram: selectedProgram,
    now: () => 10_000,
    verifyToken: async () => ({ uid: identity || "", email: "customer@example.test", emailVerified: true }),
  });
  return invoke(handler, body);
}

async function create(
  body: Record<string, unknown>,
  selectedProgram: CagnotteReservationTestProgram | null,
  identity: string | undefined,
  processSideEffects?: () => Promise<never>,
  failBeforeCommit = false,
) {
  let transactionDepth = 0;
  const checked = checkedDatabase(() => transactionDepth, (value) => { transactionDepth = value; }, failBeforeCommit);
  const handler = createOrderHandler({
    getDb: () => checked,
    reservationProgram: selectedProgram,
    now: () => 10_000,
    verifyToken: async () => ({ uid: identity || "", email: "customer@example.test", emailVerified: true }),
    enforceRateLimit: async () => ({ allowed: true, code: "allowed", retryAfterSeconds: 0 }),
    processSideEffects: processSideEffects
      ? async () => processSideEffects()
      : async () => {
          assert.equal(transactionDepth, 0, "effet externe dans une transaction");
          return {
            client: { status: "skipped" as const, reason: "synthetic" },
            admin: { status: "skipped" as const, reason: "synthetic" },
          };
        },
  });
  return invoke(handler, body);
}

async function status(orderId: string, patch: Record<string, unknown>, selectedProgram: CagnotteReservationTestProgram | null) {
  const handler = createOrderStatusHandler({
    getDb: () => rawDb,
    verifyToken: async () => admin,
    program: selectedProgram,
    sendStatusEmail: async () => ({ status: "skipped", reason: "synthetic" }),
    processAnalytics: async () => ({ status: "skipped" }),
    now: () => new Date(30_000).toISOString(),
  });
  return invoke(handler, { orderId, authToken: "synthetic-admin-token", ...patch });
}

async function reviewedCancellationPatch(orderId: string) {
  const context = await rawDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rawDb.collection("orders").doc(orderId));
    const storedOrder = { id: snapshot.id, ...snapshot.data() } as Order;
    return readUnpaidOrderContext({ db: rawDb, transaction, order: storedOrder, nowEpochMs: 30_000 });
  });
  return {
    orderStatus: "cancelled",
    unpaidReview: {
      action: "record",
      outcome: "unpaid_confirmed",
      source: "fixture locale",
      reason: "Confirmation synthétique avant annulation",
      expectedStateVersion: context.stateVersion,
    },
  };
}

async function sendLink(
  orderId: string,
  amount: number,
  send: Parameters<typeof createSendPaymentLinkHandler>[0]["send"],
) {
  const handler = createSendPaymentLinkHandler({
    getDb: () => rawDb,
    verifyToken: async () => admin,
    send,
    now: (() => { let now = 20_000; return () => ++now; })(),
  });
  return invoke(handler, {
    orderId,
    authToken: "synthetic-admin-token",
    paymentLinkRequestId: randomUUID(),
    intent: "initial",
    paymentLinkUrl: "https://buy.stripe.com/test_synthetic_never_opened",
    paymentLinkLabel: `Paiement ${amount} EUR`,
    paymentLinkAmount: amount,
    paymentLinkCurrency: "EUR",
  });
}

async function invoke(
  handler: (request: VercelRequestLike, response: VercelResponseLike) => Promise<void>,
  body: unknown,
) {
  let status = 0;
  let responseBody: unknown;
  const headers = new Map<string, unknown>();
  const response = {
    setHeader(name: string, value: unknown) { headers.set(name, value); },
    status(value: number) { status = value; return this; },
    json(value: unknown) { responseBody = value; },
  };
  await handler({ method: "POST", url: "/synthetic", headers: {}, body } as VercelRequestLike, response as unknown as VercelResponseLike);
  return { status, body: responseBody, headers };
}

function checkedDatabase(getDepth: () => number, setDepth: (value: number) => void, failBeforeCommit: boolean) {
  return new Proxy(rawDb, {
    get(target, key, receiver) {
      if (key === "runTransaction") return async (callback: (transaction: Transaction) => Promise<unknown>) =>
        target.runTransaction(async (transaction) => {
          let wrote = false;
          let wroteOrder = false;
          setDepth(getDepth() + 1);
          const checkedTransaction = new Proxy(transaction, {
            get(tx, method, txReceiver) {
              const value = Reflect.get(tx, method, txReceiver);
              if (typeof value !== "function") return value;
              return (...args: unknown[]) => {
                if (method === "get" || method === "getAll") assert.equal(wrote, false, "lecture transactionnelle après écriture");
                if (["set", "update", "create", "delete"].includes(String(method))) {
                  wrote = true;
                  const path = String((args[0] as { path?: string } | undefined)?.path || "");
                  if (path.includes("/orders/") || path.startsWith("orders/")) wroteOrder = true;
                }
                return Reflect.apply(value, tx, args);
              };
            },
          });
          try {
            const result = await callback(checkedTransaction);
            if (failBeforeCommit && wroteOrder) throw new Error("synthetic failure before commit");
            return result;
          }
          finally { setDepth(getDepth() - 1); }
        });
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Firestore;
}

async function fund(beneficiaryId: string, orderId: string) {
  const source: CagnotteInternalOrder = {
    orderId,
    beneficiaryId,
    programVersion: program.programVersion,
    createdAtEpochMs: 2_000,
    snapshot: calculateCagnotte({
      lines: [{ lineId: "source", initialCents: 40_000 }],
      discounts: [], requestedCagnotteCents: 0, availableCagnotteCents: 0,
    }),
  };
  await applyCagnotteLedgerOperation({
    db: rawDb, program, recordedAtEpochMs: 3_000,
    command: { order: source, event: "payment_and_delivery_confirmed" },
  });
  return source;
}

function movement(beneficiaryId: string, eventKey: string, availableDeltaCents: number) {
  return {
    schemaVersion: 3,
    regularizationVersion: "cagnotte-regularization-v1",
    reservationVersion: CAGNOTTE_RESERVATION_VERSION,
    calculationVersion: "cagnotte-math-v1",
    programVersion: program.programVersion,
    currency: "EUR",
    origin: "internal_server",
    orderId: `balance-${++sequence}`,
    beneficiaryId,
    businessEvent: "refund_confirmed",
    eventKey,
    payload: "{}",
    pendingDeltaCents: 0,
    availableDeltaCents,
    reservedDeltaCents: 0,
    regularizationDeltaCents: 0,
    recordedAtEpochMs: 4_000 + sequence,
  };
}

async function wallet(id: string) {
  return (await rawDb.collection("cagnotteWallets").doc(id).get()).data() as CagnotteWallet;
}

async function reservation(orderId: string) {
  return (await rawDb.collection("cagnotteReservations").doc(orderId).get()).data()!;
}

async function order(orderId: string) {
  return { id: orderId, ...(await rawDb.collection("orders").doc(orderId).get()).data() } as Order;
}

async function orders() {
  return (await rawDb.collection("orders").get()).docs;
}

function assertWallet(value: CagnotteWallet, expected: [number, number, number, number]) {
  assert.deepEqual(
    [value.pendingCents, value.availableCents, value.reservedCents, value.regularizationCents],
    expected,
  );
}

async function businessSnapshot() {
  const names = ["cagnotteAccruals", "cagnotteMovements", "cagnotteReservations", "cagnotteWallets", "coupons", "orders", "stockMovements", "products"];
  return Promise.all(names.map(async (name) => ({
    name,
    docs: (await rawDb.collection(name).orderBy("__name__").get()).docs.map((document) => ({ id: document.id, data: document.data() })),
  })));
}

function assertBusinessUnchanged(before: Awaited<ReturnType<typeof businessSnapshot>>, after: Awaited<ReturnType<typeof businessSnapshot>>) {
  assert.deepEqual(after, before);
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function clear() {
  for (const name of collections) {
    const snapshot = await rawDb.collection(name).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
}
