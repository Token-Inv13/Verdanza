import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOrderHandler } from "../api/create-order.js";
import { createQuoteOrderHandler } from "../api/quote-order.js";
import { applyCagnotteLedgerOperation } from "../api/_server/cagnotteLedger.js";
import { CAGNOTTE_RESERVATION_VERSION, type CagnotteInternalOrder } from "../api/_server/cagnotteLedgerTypes.js";
import type { CagnotteReservationTestProgram } from "../api/_server/cagnotteReservationTypes.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import {
  CagnotteCheckoutController,
  CheckoutAttemptController,
  type CheckoutAttemptMarker,
} from "../src/services/cagnotteCheckoutService.js";
import { createCheckoutOrder, type CreateCheckoutOrderInput } from "../src/services/ordersService.js";
import { quoteOrder } from "../src/services/quoteService.js";
import type { CagnotteReadResponse } from "../src/types/cagnotteRead.js";
import { CAGNOTTE_DEMO, connectCagnotteEmulator, validateCagnotteTestEnvironment } from "./cagnotteEmulator.js";

validateCagnotteTestEnvironment(process.env);
const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const activeProgram: CagnotteReservationTestProgram = Object.freeze({
  mode: "local_test",
  programVersion: "checkout-client-contract-v1",
  calculationVersion: "cagnotte-math-v1",
  startsAtEpochMs: 1_000,
  newAccrualsEnabled: true,
  reservationVersion: CAGNOTTE_RESERVATION_VERSION,
  reservationsEnabled: true,
});
const suspendedProgram = Object.freeze({ ...activeProgram, reservationsEnabled: false, newAccrualsEnabled: false });
const collections = [
  "analyticsOperationalEvents", "analyticsOutbox", "cagnotteAccruals", "cagnotteMovements",
  "cagnotteReservations", "cagnotteWallets", "checkoutRequests", "coupons", "orderSideEffects",
  "orders", "products", "publicRateLimits", "stockMovements",
];

try {
  await clear();
  await db.collection("products").doc("product-main").set({
    name: "Produit synthétique", slug: "product-main", price: 10, stock: 1_000,
    isActive: true, category: "flowers", cultureType: "indoor",
  });
  await fund("customer-a");

  const quoteHandler = createQuoteOrderHandler({
    getDb: () => db,
    reservationProgram: activeProgram,
    now: () => 10_000,
    verifyToken: async () => ({ uid: "customer-a", email: "customer@example.test", emailVerified: true }),
  });
  const checkout = new CagnotteCheckoutController(() => undefined);
  checkout.setIdentity("customer-a");
  checkout.setContext("cart-v1|postal|address-v1");
  await checkout.loadWallet(async () => readWalletFixture("customer-a"));
  checkout.setSelectionEnabled(true);
  checkout.setAmountInput("8,00");
  const proposal = await checkout.requestProposal((requestedCents) => quoteOrder({
    items: [{ productId: "product-main", quantity: 10 }],
    deliveryMethod: "postal",
    address: address(),
    email: "customer@example.test",
    cagnotteUse: { requestedCents },
  }, {
    getToken: async () => "synthetic-customer-token",
    fetch: fetchAdapter(quoteHandler),
  }));
  assert.equal(proposal?.cagnotteUse?.proposedCagnotteCents, 800);
  assert.equal(proposal?.cagnotteUse?.payableCents, 9_200);
  assert.equal(proposal?.cagnotteUse?.loyaltyAccrualStatus, "estimated", "le statut de gain vient du serveur");
  const acceptance = checkout.acceptProposal();
  assert.deepEqual(acceptance, {
    quoteVersion: proposal?.cagnotteUse?.quoteVersion,
    quoteFingerprint: proposal?.cagnotteUse?.quoteFingerprint,
    acceptedCagnotteCents: 800,
    acceptedPayableCents: 9_200,
  });

  const checkoutRequestId = randomUUID();
  const request: CreateCheckoutOrderInput = {
    checkoutRequestId,
    items: [{ productId: "product-main", quantity: 10 }],
    deliveryMethod: "postal",
    preferredPaymentMethod: "card_payment_link",
    complianceAccepted: true,
    submissionSecurity: { formStartedAt: 9_000 },
    customer: {
      firstName: "Test", lastName: "Client", email: "customer@example.test", phone: "0600000000",
      address: address(),
    },
    cagnotteUse: { requestedCents: 800, acceptance: acceptance! },
  };

  const markers: CheckoutAttemptMarker[] = [];
  const attempts = new CheckoutAttemptController(() => undefined, {
    mark: (_identity, marker) => markers.push(marker),
    complete: () => undefined,
    refused: () => assert.fail("la tentative ne doit pas être déclarée refusée"),
  });
  attempts.setIdentity("customer-a");
  const firstHandler = createHandler(activeProgram);
  const sentBusinessBodies: string[] = [];
  let firstResponseLost = true;
  const firstResult = await attempts.submit(checkoutRequestId, request, (frozen) => createCheckoutOrder(frozen, {
    getToken: async () => "synthetic-customer-token",
    fetch: async (input, init) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sentBusinessBodies.push(stableBusinessBody(parsed));
      const response = await fetchAdapter(firstHandler)(input, init);
      if (firstResponseLost) {
        firstResponseLost = false;
        throw new TypeError("synthetic lost response after commit");
      }
      return response;
    },
  }));
  assert.equal(firstResult, null);
  assert.equal(attempts.snapshot().phase, "uncertain");
  assert.equal(markers.at(-1)?.requestId, checkoutRequestId);
  assert.equal(markers.at(-1)?.state, "uncertain");
  assert.equal((await db.collection("orders").get()).size, 1, "la réponse perdue suit une commande déjà enregistrée");

  await db.collection("cagnotteWallets").doc("customer-a").update({ availableCents: 0 });
  const replayHandler = createHandler(suspendedProgram);
  const replay = await attempts.retry((frozen) => createCheckoutOrder(frozen, {
    getToken: async () => "synthetic-customer-token-refreshed",
    fetch: async (input, init) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sentBusinessBodies.push(stableBusinessBody(parsed));
      return fetchAdapter(replayHandler)(input, init);
    },
  }));
  assert.equal(attempts.snapshot().phase, "success");
  assert.equal(replay?.orderId, attempts.snapshot().result?.orderId);
  assert.equal(replay?.total, 100);
  assert.equal(replay?.paymentAmount, 92);
  assert.deepEqual(replay?.cagnotteUse, { amountCents: 800, state: "reserved" });
  assert.equal(replay?.summary.subtotal, 100);
  assert.equal((await db.collection("orders").get()).size, 1, "la reprise retrouve la commande initiale");
  assert.equal(sentBusinessBodies.length, 2);
  assert.equal(sentBusinessBodies[0], sentBusinessBodies[1], "jeton renouvelé exclu : identifiant et contenu commercial inchangés");
  assert.equal(sentBusinessBodies[0].includes("customerId"), false);
  assert.equal(sentBusinessBodies[0].includes("beneficiaryId"), false);
  console.log("Cagnotte client/HTTP contract passed: quote, exact acceptance, lost response, same-attempt replay with zero available and suspended reservations");
} finally {
  await clear();
  await db.terminate();
}

function createHandler(program: CagnotteReservationTestProgram) {
  return createOrderHandler({
    getDb: () => db,
    reservationProgram: program,
    now: () => 10_000,
    verifyToken: async () => ({ uid: "customer-a", email: "customer@example.test", emailVerified: true }),
    processSideEffects: async () => ({
      client: { status: "skipped" as const, reason: "synthetic" },
      admin: { status: "skipped" as const, reason: "synthetic" },
    }),
  });
}

function fetchAdapter(handler: (request: VercelRequestLike, response: VercelResponseLike) => Promise<void>): typeof fetch {
  return async (_input, init) => {
    let status = 0;
    let payload: unknown;
    const headers = new Headers({ "content-type": "application/json" });
    const response = {
      setHeader(name: string, value: unknown) { headers.set(name, String(value)); },
      status(value: number) { status = value; return this; },
      json(value: unknown) { payload = value; },
    };
    await handler({ method: "POST", url: "/synthetic", headers: {}, body: JSON.parse(String(init?.body)) } as VercelRequestLike, response as unknown as VercelResponseLike);
    return new Response(JSON.stringify(payload), { status, headers });
  };
}

async function fund(beneficiaryId: string) {
  const order: CagnotteInternalOrder = {
    orderId: "fund-client-contract",
    beneficiaryId,
    programVersion: activeProgram.programVersion,
    createdAtEpochMs: 2_000,
    snapshot: calculateCagnotte({
      lines: [{ lineId: "source", initialCents: 40_000 }], discounts: [],
      requestedCagnotteCents: 0, availableCagnotteCents: 0,
    }),
  };
  await applyCagnotteLedgerOperation({
    db,
    program: activeProgram,
    recordedAtEpochMs: 3_000,
    command: { order, event: "payment_and_delivery_confirmed" },
  });
}

async function readWalletFixture(beneficiaryId: string): Promise<CagnotteReadResponse> {
  const data = (await db.collection("cagnotteWallets").doc(beneficiaryId).get()).data()!;
  return {
    currency: "EUR",
    capabilities: { canReadWallet: true, canRequestReservation: true, canAccrueLoyalty: true },
    wallet: {
      status: "active",
      availableCents: Number(data.availableCents), pendingCents: Number(data.pendingCents),
      reservedCents: Number(data.reservedCents), regularizationCents: Number(data.regularizationCents),
    },
    history: { items: [], nextCursor: null, completeness: "timestamped_movements_only", limitation: "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet." },
    freshness: { readAt: "2000-01-01T00:00:10.000Z", consistency: "wallet_and_page", refreshStartsAtFirstPage: true },
  };
}

function address() {
  return { firstName: "Test", lastName: "Client", line1: "1 rue Test", postalCode: "75001", city: "Paris", country: "FR" };
}

function stableBusinessBody(body: Record<string, unknown>) {
  const business = { ...body };
  delete business.authToken;
  return JSON.stringify(business);
}

async function clear() {
  for (const name of collections) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
}
