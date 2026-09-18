import {
  deepStrictEqual,
  equal,
  ok,
  rejects,
  throws,
} from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { isDeepStrictEqual } from "node:util";
import { connectCagnotteEmulator, CAGNOTTE_DEMO } from "./cagnotteEmulator.js";
import { expectBlockedNetwork } from "./cagnotteNetworkGuard.js";
import { commitCheckoutOrder } from "../api/_server/checkoutOrder.js";
import { priceCheckout, type CheckoutRequestBody, type PricedCheckout } from "../api/_server/checkout.js";
import {
  checkoutPayloadFingerprint,
  claimOrderSideEffectTask,
  orderSideEffectTaskNames,
  resetOrderSideEffectTask,
  runEmailSideEffect,
} from "../api/_server/orderSideEffects.js";
import { sendAdminOrderSms, sendAdminOrderWhatsapp } from "../api/_server/orderAlerts.js";
import {
  sendAdminManualOrderEmail,
  sendManualOrderConfirmationEmail,
  sendOrderStatusUpdateEmail,
} from "../api/_server/email.js";
import { executePaymentLinkDelivery } from "../api/_server/paymentLinkDelivery.js";
import { executeGuardedInvoiceSend } from "../api/_server/invoiceEmailSend.js";
import { processPurchaseAnalyticsOutbox } from "../api/_server/purchaseAnalytics.js";
import { executeOrderRefund } from "../api/_server/orderRefunds.js";
import {
  commitOrderStatusTransition,
  type OrderStatusChange,
} from "../api/_server/orderStatusTransition.js";
import { shouldMountCagnotteAdminTools } from "../src/lib/cagnotteAdminEligibility.js";
import {
  assertOrdinaryProductAdminMutationAllowed,
  ordinaryProductStockMutation,
} from "../src/lib/productionFixtureMarker.js";
import type { Invoice, Order, Product } from "../src/types/index.js";
import {
  CAGNOTTE_PRODUCTION_FIXTURE_CHALLENGE,
  CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_EMAIL,
  CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT,
  CAGNOTTE_PRODUCTION_FIXTURE_FIXED_PRICE_OPTION_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK,
  CAGNOTTE_PRODUCTION_FIXTURE_MARKER,
  CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT,
  CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_REMAINING_STOCK,
  CAGNOTTE_PRODUCTION_FIXTURE_SIDE_EFFECT_REASON,
  CAGNOTTE_PRODUCTION_FIXTURE_STOCK_MOVEMENT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_UID,
  cagnotteProductionFixtureCheckoutBody,
  cagnotteProductionFixtureCustomerDocument,
  cagnotteProductionFixtureDeliveredStatusChange,
  cagnotteProductionFixturePaidStatusChange,
  cagnotteProductionFixturePricedCheckout,
  cagnotteProductionFixtureProductDocument,
  cagnotteProductionFixtureStockMovementDocument,
  createCagnotteProductionFixtureCapability,
  createCagnotteProductionFixtureTestCapability,
  type CagnotteProductionFixtureCapability,
} from "../api/_server/cagnotteProductionFixture.js";
import {
  buildCagnotteProductionFixturePlan,
  assertCagnotteProductionFixtureProductionEnvironment,
  cagnotteProductionFixtureProgram,
  inspectCagnotteProductionFixture,
  runCagnotteProductionFixtureCommand,
} from "./createCagnotteProductionFixture.js";

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const capability = createCagnotteProductionFixtureTestCapability(() => {
  if (
    process.env.CAGNOTTE_TEST_SANDBOX !== "1" ||
    process.env.GCLOUD_PROJECT !== "demo-verdanza-cagnotte" ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:18085" ||
    process.env.METADATA_SERVER_DETECTION !== "none"
  ) {
    throw new Error("production_fixture_test_environment_invalid");
  }
});
const command = (name: "create" | "mark-paid" | "mark-delivered" | "inspect") =>
  runCagnotteProductionFixtureCommand({
    db,
    command: name,
    capability,
    firebaseProjectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
  });
let checks = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  checks += 1;
  console.log(`OK [fixture Production] ${name}`);
}

try {
  await check("fetch, http, https, DNS et sockets externes sont bloques", () => {
    expectBlockedNetwork(() => {
      throws(() => void fetch("https://api.resend.com/emails"), /TEST_NETWORK_BLOCKED/);
      throws(() => http.get("http://example.com"), /TEST_NETWORK_BLOCKED/);
      throws(() => https.get("https://api.twilio.com"), /TEST_NETWORK_BLOCKED/);
    });
  });

  await check("programme Production en memoire, runtime global non modifie", () => {
    const program = cagnotteProductionFixtureProgram();
    equal(program.mode, "production");
    equal(program.programVersion, "cagnotte-commercial-policy-v1");
    equal(program.calculationVersion, "cagnotte-math-v1");
    equal(program.newAccrualsEnabled, true);
  });

  await check("mutations admin flags et stock refusent toute ressource produit marquee", () => {
    const exactFixture = {
      id: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
      ...cagnotteProductionFixtureProductDocument(),
    } as unknown as Product;
    const partialFixture = {
      ...exactFixture,
      productionFixture: { marker: "partiel" },
    } as unknown as Product;
    const ordinaryProduct = {
      ...exactFixture,
      id: "produit-ordinaire",
      productionFixture: undefined,
      stock: 8,
      lowStockThreshold: 2,
    } as Product;
    delete (ordinaryProduct as { productionFixture?: unknown }).productionFixture;
    const exactBefore = structuredClone(exactFixture);
    const partialBefore = structuredClone(partialFixture);
    throws(
      () => assertOrdinaryProductAdminMutationAllowed(exactFixture),
      /production_fixture_product_admin_mutation_forbidden/,
    );
    throws(
      () => assertOrdinaryProductAdminMutationAllowed(partialFixture),
      /production_fixture_product_admin_mutation_forbidden/,
    );
    throws(
      () => ordinaryProductStockMutation(exactFixture, 12, 3),
      /production_fixture_product_admin_mutation_forbidden/,
    );
    throws(
      () => ordinaryProductStockMutation(partialFixture, 12, 3),
      /production_fixture_product_admin_mutation_forbidden/,
    );
    deepStrictEqual(exactFixture, exactBefore);
    deepStrictEqual(partialFixture, partialBefore);
    assertOrdinaryProductAdminMutationAllowed(ordinaryProduct);
    deepStrictEqual(
      ordinaryProductStockMutation(ordinaryProduct, 12, 3),
      { productId: ordinaryProduct.id, stock: 12, lowStockThreshold: 3 },
    );
    equal(ordinaryProduct.stock, 8);
    equal(ordinaryProduct.lowStockThreshold, 2);
  });

  await check("dry-run pur et cible strictement bornee", async () => {
    const before = await databaseCounts();
    const plan = buildCagnotteProductionFixturePlan({
      command: "create",
      write: false,
      projectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
    });
    equal(plan.mode, "dry-run");
    equal(plan.uid, CAGNOTTE_PRODUCTION_FIXTURE_UID);
    equal(plan.productId, CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID);
    equal(plan.orderId, CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID);
    deepStrictEqual(await databaseCounts(), before);
    throws(() => buildCagnotteProductionFixturePlan({
      command: "create",
      write: false,
      projectId: "wrong-project",
    }), /production_fixture_project_invalid/);
    throws(() => assertCagnotteProductionFixtureProductionEnvironment({ CI: "true" }),
      /production_fixture_environment_refused/);
    throws(() => assertCagnotteProductionFixtureProductionEnvironment({
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:18085",
    }), /production_fixture_environment_refused/);
    throws(() => createCagnotteProductionFixtureCapability({
      challenge: { ...CAGNOTTE_PRODUCTION_FIXTURE_CHALLENGE, uid: "other" },
      assertExecutionEnvironment: () => undefined,
    }), /production_fixture_challenge_invalid/);
  });

  await check("une capacite structurellement forgee est refusee avant toute ecriture", async () => {
    const before = await databaseCounts();
    const forgedCapability = {
      execution: "emulator_test",
      marker: { marker: CAGNOTTE_PRODUCTION_FIXTURE_MARKER },
    } as never;
    await rejects(() => runCagnotteProductionFixtureCommand({
      db,
      command: "inspect",
      capability: forgedCapability,
      firebaseProjectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
    }), /production_fixture_capability_required/);
    await rejects(() => commitFixtureCheckout({
      productionFixtureCapability: forgedCapability,
    }), /production_fixture_capability_required/);
    deepStrictEqual(await databaseCounts(), before);
  });

  await check("reservation residuelle seule refuse create avant toute autre ecriture", async () => {
    const reservationRef = db.collection("cagnotteReservations")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID);
    const orphan = { orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, status: "reserved" };
    await reservationRef.set(orphan);
    const before = await databaseCounts();
    await rejects(() => command("create"), /production_fixture_reservation_collision/);
    deepStrictEqual((await reservationRef.get()).data(), orphan);
    deepStrictEqual(await databaseCounts(), before);
    equal((await db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).exists, false);
    equal((await db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get()).exists, false);
    equal((await db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
    await reservationRef.delete();
  });

  await check("reservation residuelle preserve customer et produit preexistants", async () => {
    const customerRef = db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID);
    const productRef = db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID);
    const reservationRef = db.collection("cagnotteReservations")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID);
    const customer = cagnotteProductionFixtureCustomerDocument();
    const product = cagnotteProductionFixtureProductDocument();
    const reservation = { orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, status: "reserved" };
    await Promise.all([
      customerRef.set(customer),
      productRef.set(product),
      reservationRef.set(reservation),
    ]);
    const before = await databaseCounts();
    await rejects(() => command("create"), /production_fixture_reservation_collision/);
    deepStrictEqual((await customerRef.get()).data(), customer);
    deepStrictEqual((await productRef.get()).data(), product);
    deepStrictEqual((await reservationRef.get()).data(), reservation);
    deepStrictEqual(await databaseCounts(), before);
    equal((await db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
    await Promise.all([customerRef.delete(), productRef.delete(), reservationRef.delete()]);
  });

  await check("wallet preexistant seul refuse create sans aucune ecriture annexe", async () => {
    const walletRef = db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID);
    const orphan = fixtureWalletDocument();
    await walletRef.set(orphan);
    const before = await databaseCounts();
    await rejects(() => command("create"), /production_fixture_wallet_collision/);
    deepStrictEqual((await walletRef.get()).data(), orphan);
    deepStrictEqual(await databaseCounts(), before);
    equal((await db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).exists, false);
    equal((await db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get()).exists, false);
    equal((await db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
    await walletRef.delete();
  });

  await check("wallet disponible residuel sans fixture refuse create sans mutation", async () => {
    const walletRef = db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID);
    const orphan = fixtureWalletDocument({ availableCents: 500 });
    await walletRef.set(orphan);
    const before = await databaseCounts();
    await rejects(() => command("create"), /production_fixture_wallet_collision/);
    deepStrictEqual((await walletRef.get()).data(), orphan);
    deepStrictEqual(await databaseCounts(), before);
    equal((await db.collection("checkoutRequests").doc(CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID).get()).exists, false);
    equal((await db.collection("orderSideEffects").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
    equal((await db.collection("stockMovements").get()).size, 0);
    await walletRef.delete();
  });

  await check("collision mouvement stock divergente refusee sans aucune autre ecriture", async () => {
    const ref = db.collection("stockMovements").doc(CAGNOTTE_PRODUCTION_FIXTURE_STOCK_MOVEMENT_ID);
    const divergent = { productId: "produit-reel", quantity: -999, note: "ne pas ecraser" };
    await ref.set(divergent);
    const before = await databaseCounts();
    await rejects(() => command("create"), /production_fixture_stock_movement_collision/);
    deepStrictEqual((await ref.get()).data(), divergent);
    deepStrictEqual(await databaseCounts(), before);
    equal((await db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).exists, false);
    equal((await db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get()).exists, false);
    await ref.delete();
  });

  await check("mouvement stock identique mais orphelin reste fail-closed", async () => {
    const ref = db.collection("stockMovements").doc(CAGNOTTE_PRODUCTION_FIXTURE_STOCK_MOVEMENT_ID);
    const identicalOrphan = cagnotteProductionFixtureStockMovementDocument();
    await ref.set(identicalOrphan);
    const before = await databaseCounts();
    await rejects(() => command("create"), /production_fixture_stock_movement_collision/);
    deepStrictEqual((await ref.get()).data(), identicalOrphan);
    deepStrictEqual(await databaseCounts(), before);
    equal((await db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
    equal((await db.collection("checkoutRequests").doc(CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID).get()).exists, false);
    await ref.delete();
  });

  await check("transaction checkout fixture refuse elle-meme une collision stock", async () => {
    const customerRef = db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID);
    const productRef = db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID);
    const movementRef = db.collection("stockMovements").doc(CAGNOTTE_PRODUCTION_FIXTURE_STOCK_MOVEMENT_ID);
    const customer = cagnotteProductionFixtureCustomerDocument();
    const product = cagnotteProductionFixtureProductDocument();
    const collision = { productId: "collision-directe", quantity: -1 };
    await Promise.all([
      customerRef.set(customer),
      productRef.set(product),
      movementRef.set(collision),
    ]);
    const before = await databaseCounts();
    await rejects(() => commitFixtureCheckout(), /production_fixture_stock_movement_collision/);
    deepStrictEqual((await customerRef.get()).data(), customer);
    deepStrictEqual((await productRef.get()).data(), product);
    deepStrictEqual((await movementRef.get()).data(), collision);
    deepStrictEqual(await databaseCounts(), before);
    await Promise.all([customerRef.delete(), productRef.delete(), movementRef.delete()]);
  });

  await check("collision produit divergent refusee sans ecrasement", async () => {
    const ref = db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID);
    const divergent = { name: "Produit reel ou divergent", isActive: false, stock: 777 };
    await ref.set(divergent);
    await rejects(() => command("create"), /production_fixture_product_collision/);
    deepStrictEqual((await ref.get()).data(), divergent);
    equal((await db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).exists, false);
    await ref.delete();
  });

  await check("collision orderId partielle refusee sans ecrasement", async () => {
    const ref = db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID);
    const divergent = { customerEmail: "real.customer@example.test", total: 999 };
    await ref.set(divergent);
    await rejects(() => command("create"), /production_fixture_partial_collision/);
    deepStrictEqual((await ref.get()).data(), divergent);
    await ref.delete();
  });

  await check("produit reel non marque refuse par la capacite correcte", async () => {
    await db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID)
      .set(cagnotteProductionFixtureCustomerDocument());
    const unmarked = cagnotteProductionFixtureProductDocument();
    delete (unmarked as { productionFixture?: unknown }).productionFixture;
    await db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).set(unmarked);
    await rejects(() => commitFixtureCheckout(), /production_fixture_product_invalid/);
    equal((await db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
    equal((await db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get()).data()?.stock,
      CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK);
    await db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).delete();
    await db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).delete();
  });

  await check("checkout normal refuse le produit fixture exact inactif sans ecriture", async () => {
    await assertMarkedProductRejectedByOrdinaryCheckout(
      cagnotteProductionFixtureProductDocument(),
    );
  });

  await check("checkout normal refuse le produit fixture exact force actif sans ecriture", async () => {
    await assertMarkedProductRejectedByOrdinaryCheckout({
      ...cagnotteProductionFixtureProductDocument(),
      isActive: true,
    });
  });

  await check("checkout normal refuse un marqueur fixture partiel sans ecriture", async () => {
    await assertMarkedProductRejectedByOrdinaryCheckout({
      ...cagnotteProductionFixtureProductDocument(),
      isActive: true,
      productionFixture: { marker: "corrompu" },
    });
  });

  await check("checkout normal conserve un produit actif non marque", async () => {
    const productId = "ordinary-active-product";
    const orderId = "ordinary-active-order";
    const checkoutRequestId = "c011ec7e-0003-4000-8000-000000000003";
    const product = {
      ...cagnotteProductionFixtureProductDocument(),
      internalReference: "ORDINARY-ACTIVE",
      slug: productId,
      name: "Produit ordinaire actif",
      isActive: true,
    };
    delete (product as { productionFixture?: unknown }).productionFixture;
    await db.collection("products").doc(productId).set(product);
    const body = {
      ...fixtureBody(),
      checkoutRequestId,
      items: [{
        productId,
        quantity: 1,
        purchaseMode: "fixed_price" as const,
        fixedPriceOptionId: CAGNOTTE_PRODUCTION_FIXTURE_FIXED_PRICE_OPTION_ID,
      }],
    };
    const priced = await priceCheckout(db, body);
    const result = await commitCheckoutOrder({
      db,
      body,
      priced,
      checkoutRequestId,
      payloadFingerprint: checkoutPayloadFingerprint(body),
      orderId,
      accrualProgram: null,
      reservationProgram: null,
      firebaseProjectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
      nowEpochMs: Date.parse("2026-09-18T12:00:00.000Z"),
    });
    equal(result.created, true);
    equal((await db.collection("orders").doc(orderId).get()).exists, true);
    const movements = await db.collection("stockMovements").where("orderId", "==", orderId).get();
    equal(movements.size, 1);
    const ordinaryTransition = await commitOrderStatusTransition({
      db,
      body: { orderId, internalNote: "Commande ordinaire modifiable sans capacite fixture." },
      admin: { uid: "ordinary-admin", email: "admin@fixture.test" },
      accrualProgram: null,
      reservationProgram: null,
      now: () => CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT,
    });
    equal(ordinaryTransition.updatedOrder?.internalNote,
      "Commande ordinaire modifiable sans capacite fixture.");
    equal((await db.collection("orders").doc(orderId).get()).data()?.internalNote,
      "Commande ordinaire modifiable sans capacite fixture.");
    await Promise.all([
      db.collection("products").doc(productId).delete(),
      db.collection("orders").doc(orderId).delete(),
      db.collection("checkoutRequests").doc(checkoutRequestId).delete(),
      db.collection("orderSideEffects").doc(orderId).delete(),
      ...movements.docs.map((entry) => entry.ref.delete()),
    ]);
  });

  await check("creation transactionnelle exacte et produit invisible publiquement", async () => {
    await command("create");
    const customer = await db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get();
    const admin = await db.collection("adminUsers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get();
    const product = await db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get();
    const order = await storedOrder();
    equal(customer.exists, true);
    equal(admin.exists, false);
    equal(customer.data()?.email, CAGNOTTE_PRODUCTION_FIXTURE_EMAIL);
    equal(customer.data()?.isAdmin, false);
    deepStrictEqual(customer.data()?.providers, []);
    equal(product.data()?.isActive, false);
    equal(product.data()?.stock, CAGNOTTE_PRODUCTION_FIXTURE_REMAINING_STOCK);
    equal((await db.collection("products").where("isActive", "==", true).get()).docs
      .some((entry) => entry.id === CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID), false);
    equal(order.customerId, CAGNOTTE_PRODUCTION_FIXTURE_UID);
    equal(order.finalPaymentMethod, "other");
    equal(order.cagnotte?.programVersion, "cagnotte-commercial-policy-v1");
    equal(order.cagnotte?.calculationVersion, "cagnotte-math-v1");
    equal(order.cagnotte?.accrualEnrollment, "enrolled");
    equal(order.cagnotte?.snapshot.loyaltyCents, 500);
    equal(order.cagnotte?.snapshot.appliedCagnotteCents, 0);
    equal(order.cagnotteReservationIntent, undefined);
    equal(order.couponCode, null);
    equal(order.contestPrizeId, null);
    deepStrictEqual(order.appliedPromotions, []);
  });

  await check("fixture creee non payee refuse un wallet injecte au rejeu create", async () => {
    const walletRef = db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID);
    const injected = fixtureWalletDocument({ pendingCents: 500 });
    await walletRef.set(injected);
    const before = await stableFinancialState();
    await rejects(() => command("create"), /production_fixture_wallet_collision/);
    deepStrictEqual(await stableFinancialState(), before);
    equal((await db.collection("cagnotteAccruals").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
    await walletRef.delete();
  });

  await check("fixture complete refuse une reservation residuelle au rejeu create", async () => {
    const reservationRef = db.collection("cagnotteReservations")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID);
    const reservation = { orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, status: "reserved" };
    await reservationRef.set(reservation);
    const before = await stableFinancialState();
    await rejects(() => command("create"), /production_fixture_reservation_collision/);
    deepStrictEqual(await stableFinancialState(), before);
    await reservationRef.delete();
  });

  await check("toute mutation admin fixture sans capacite est refusee avant ecriture", async () => {
    const mutations: Array<readonly [string, Omit<OrderStatusChange, "orderId">]> = [
      ["paymentStatus", cagnotteProductionFixturePaidStatusChange()],
      ["orderStatus delivered", cagnotteProductionFixtureDeliveredStatusChange()],
      ["orderStatus cancelled", { orderStatus: "cancelled" }],
      ["archive", { archived: true }],
      ["hide", { hidden: true }],
      ["restore", { restore: true }],
      ["internalNote", { internalNote: "Mutation ordinaire interdite." }],
      ["trackingNumber", { trackingNumber: "FIXTURE-TRACKING" }],
      ["paymentReference", { paymentReference: "FIXTURE-PAYMENT" }],
      ["unpaidReview", {
        unpaidReview: {
          action: "record",
          outcome: "unpaid_confirmed",
          source: "fixture-test",
          reason: "Mutation fixture interdite",
          expectedStateVersion: "a".repeat(64),
        },
      }],
      ["paymentLink", {
        paymentLinkUrl: "https://payment.example.test/fixture",
        paymentLinkLabel: "Fixture",
        paymentLinkAmount: 100,
        paymentLinkCurrency: "EUR",
        paymentLinkChannel: "email",
        paymentLinkSent: true,
      }],
      ["deleteCancelled", { deleteCancelled: true }],
    ];
    for (const [name, mutation] of mutations) {
      const before = await stableFinancialState();
      await rejects(
        () => commitFixtureStatus(mutation),
        /production_fixture_status_mutation_forbidden/,
        name,
      );
      deepStrictEqual(await stableFinancialState(), before, name);
    }
  });

  await check("capacite fixture forgee refuse une transition exacte sans ecriture", async () => {
    const forgedCapability = {
      execution: capability.execution,
      marker: structuredClone(capability.marker),
    } as unknown as CagnotteProductionFixtureCapability;
    const before = await stableFinancialState();
    await rejects(
      () => commitFixtureStatus(
        cagnotteProductionFixturePaidStatusChange(),
        forgedCapability,
        CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT,
      ),
      /production_fixture_capability_required/,
    );
    deepStrictEqual(await stableFinancialState(), before);
  });

  await check("vraie capacite fixture ne permet aucun payload hors contrat", async () => {
    const invalidTransitions: Array<readonly [
      string,
      Omit<OrderStatusChange, "orderId">,
      string,
    ]> = [
      ["cancel", { orderStatus: "cancelled" }, CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT],
      ["archive", { archived: true }, CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT],
      ["hide", { hidden: true }, CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT],
      ["note", { internalNote: "Capacite non generique." }, CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT],
      ["tracking", { trackingNumber: "CAPABILITY-TRACKING" }, CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT],
      ["paid method", {
        ...cagnotteProductionFixturePaidStatusChange(),
        finalPaymentMethod: "bank_transfer",
      }, CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT],
      ["delivered extra field", {
        ...cagnotteProductionFixtureDeliveredStatusChange(),
        trackingNumber: "EXTRA-FIELD",
      }, CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT],
      ["paid wrong instant", cagnotteProductionFixturePaidStatusChange(),
        CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT],
    ];
    for (const [name, mutation, instant] of invalidTransitions) {
      const before = await stableFinancialState();
      await rejects(
        () => commitFixtureStatus(mutation, capability, instant),
        /production_fixture_status_transition_invalid/,
        name,
      );
      deepStrictEqual(await stableFinancialState(), before, name);
    }
  });

  await check("checkoutRequest, stock et outbox sont deterministes et neutres", async () => {
    const request = await db.collection("checkoutRequests")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID).get();
    equal(request.data()?.orderId, CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID);
    const movements = await db.collection("stockMovements").get();
    equal(movements.size, 1);
    equal(movements.docs[0]?.id, CAGNOTTE_PRODUCTION_FIXTURE_STOCK_MOVEMENT_ID);
    deepStrictEqual(movements.docs[0]?.data(), cagnotteProductionFixtureStockMovementDocument());
    const outbox = (await db.collection("orderSideEffects")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).data()!;
    for (const task of orderSideEffectTaskNames) {
      equal(outbox.tasks[task].status, "skipped");
      equal(outbox.tasks[task].attempts, 0);
      equal(outbox.tasks[task].lastErrorCode, CAGNOTTE_PRODUCTION_FIXTURE_SIDE_EFFECT_REASON);
      equal(outbox.tasks[task].skipReason, CAGNOTTE_PRODUCTION_FIXTURE_SIDE_EFFECT_REASON);
    }
    await rejects(
      () => resetOrderSideEffectTask(db, CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "customer_confirmation_email"),
      /production_fixture_external_effect_forbidden/,
    );
    equal(await claimOrderSideEffectTask(db, CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "draft_invoice"), false);
  });

  await check("aucune promotion, concours, rate limit, reservation ni effet annexe", async () => {
    for (const collection of [
      "coupons",
      "contestPrizes",
      "contestAudits",
      "securityRateLimits",
      "cagnotteReservations",
      "invoices",
      "analyticsOutbox",
      "paymentLinkRequests",
    ]) equal((await db.collection(collection).get()).size, 0, collection);
  });

  await check("emails, SMS, WhatsApp, facture, paiement et GA4 restent fail-closed", async () => {
    const order = await storedOrder();
    let providers = 0;
    await expectFixtureSkip(sendManualOrderConfirmationEmail(order));
    await expectFixtureSkip(sendAdminManualOrderEmail(order));
    await expectFixtureSkip(sendOrderStatusUpdateEmail(order, "contact_required", "confirmed"));
    await expectFixtureSkip(sendAdminOrderSms(order));
    await expectFixtureSkip(sendAdminOrderWhatsapp(order));
    const emailRetry = await runEmailSideEffect({
      db,
      orderId: order.id,
      task: "customer_confirmation_email",
      prefix: "orderConfirmation",
      send: async () => { providers += 1; return { status: "sent" }; },
    });
    equal(emailRetry.status, "skipped");
    await rejects(() => executePaymentLinkDelivery({
      db,
      admin: { uid: "fixture-admin", email: "admin@fixture.test" },
      request: {
        orderId: order.id,
        paymentLinkRequestId: "c011ec7e-0002-4000-8000-000000000002",
        intent: "initial",
        paymentLinkUrl: "https://payment.example.test/fixture",
        paymentLinkLabel: "Fixture",
        paymentLinkAmount: 100,
        paymentLinkCurrency: "EUR",
        channel: "email",
      },
      send: async () => { providers += 1; return { status: "sent" }; },
    }), /production_fixture_external_effect_forbidden/);
    const invoice = {
      id: "fixture-invoice",
      orderId: order.id,
      status: "draft",
    } as Invoice;
    await rejects(() => executeGuardedInvoiceSend({
      invoice,
      linkedOrder: order,
      send: async () => { providers += 1; return { status: "sent" as const }; },
      finalize: async () => { providers += 1; },
    }), /production_fixture_external_effect_forbidden/);
    const analytics = await processPurchaseAnalyticsOutbox(db, order.id);
    equal(analytics.status, "skipped");
    equal(providers, 0);
  });

  await check("wallet exact apres paiement autorise le rejeu create idempotent", async () => {
    await command("mark-paid");
    const wallet = (await db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).data()!;
    deepStrictEqual(wallet, fixtureWalletDocument({ pendingCents: 500 }));
    const accrual = (await db.collection("cagnotteAccruals").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).data()!;
    equal(accrual.initialGainCents, 500);
    equal(accrual.paymentConfirmed, true);
    equal(accrual.deliveryConfirmed, false);
    equal((await db.collection("cagnotteReservations")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
    const beforePaidReplay = await stableFinancialState();
    await command("mark-paid");
    deepStrictEqual(await stableFinancialState(), beforePaidReplay);
    const beforeReplay = await stableFinancialState();
    await command("create");
    deepStrictEqual(await stableFinancialState(), beforeReplay);
  });

  await check("fixture payee refuse une reservation residuelle au rejeu create", async () => {
    const reservationRef = db.collection("cagnotteReservations")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID);
    await reservationRef.set({
      orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
      status: "reserved",
    });
    const before = await stableFinancialState();
    await rejects(() => command("create"), /production_fixture_reservation_collision/);
    deepStrictEqual(await stableFinancialState(), before);
    equal((await db.collection("cagnotteWallets")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).data()?.pendingCents, 500);
    await reservationRef.delete();
  });

  await check("wallet exact apres livraison autorise le rejeu create idempotent", async () => {
    await command("mark-delivered");
    const wallet = (await db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).data()!;
    const accrual = (await db.collection("cagnotteAccruals").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).data()!;
    deepStrictEqual(wallet, fixtureWalletDocument({ availableCents: 500 }));
    equal(accrual.deliveryConfirmed, true);
    equal(accrual.credited, true);
    equal((await fixtureMovements()).length, 3);
    equal((await db.collection("cagnotteReservations")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
    const beforeDeliveredReplay = await stableFinancialState();
    await command("mark-delivered");
    deepStrictEqual(await stableFinancialState(), beforeDeliveredReplay);
    const beforeReplay = await stableFinancialState();
    await command("create");
    deepStrictEqual(await stableFinancialState(), beforeReplay);
  });

  await check("fixture livree refuse une reservation residuelle au rejeu create", async () => {
    const reservationRef = db.collection("cagnotteReservations")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID);
    await reservationRef.set({
      orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
      status: "reserved",
    });
    const before = await stableFinancialState();
    await rejects(() => command("create"), /production_fixture_reservation_collision/);
    deepStrictEqual(await stableFinancialState(), before);
    equal((await db.collection("cagnotteWallets")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).data()?.availableCents, 500);
    await reservationRef.delete();
  });

  await check("fixture complete refuse tout wallet divergent sans mutation", async () => {
    const walletRef = db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID);
    const exact = fixtureWalletDocument({ availableCents: 500 });
    const variants = [
      { ...exact, beneficiaryId: "autre-beneficiaire" },
      { ...exact, availableCents: 499 },
      { ...exact, pendingCents: 500, availableCents: 0 },
      { ...exact, reservedCents: 1 },
      { ...exact, regularizationCents: 1 },
      { ...exact, schemaVersion: 99 },
    ];
    for (const divergent of variants) {
      await walletRef.set(divergent);
      const before = await stableFinancialState();
      await rejects(() => command("create"), /production_fixture_wallet_collision/);
      deepStrictEqual(await stableFinancialState(), before);
    }
    await walletRef.set(exact);
  });

  await check("rejeu create, paid et delivered ne duplique aucun journal", async () => {
    const before = await stableFinancialState();
    await command("create");
    await command("mark-paid");
    await command("mark-delivered");
    deepStrictEqual(await stableFinancialState(), before);
    equal((await db.collection("cagnotteAccruals")
      .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).size, 1);
  });

  await check("admin monte et refunds inspect/preview restent sans ecriture", async () => {
    const order = await storedOrder();
    equal(shouldMountCagnotteAdminTools({
      displayEnabled: true,
      orderSource: "firestore",
      order,
    }), true);
    const actor = { uid: "fixture-admin", email: "admin@fixture.test" };
    const inspection = await executeOrderRefund({
      db,
      request: { action: "inspect", orderId: order.id },
      actor,
      now: () => "2026-09-18T15:00:00.000Z",
    });
    equal(inspection.kind, "administrative_refund_inspection");
    equal(inspection.accrual.initialGainCents, 500);
    const before = await stableFinancialState();
    const preview = await executeOrderRefund({
      db,
      request: {
        action: "preview",
        orderId: order.id,
        currency: "EUR",
        additionalReturns: [{ lineId: "order-line-0", additionalNetCents: 10_000 }],
        deliveryRefundCents: 0,
      },
      actor,
      now: () => "2026-09-18T15:00:00.000Z",
    });
    equal(preview.kind, "refund_preview");
    equal(preview.correction.theoreticalCents, 500);
    equal(preview.correction.availableDeltaCents, -500);
    deepStrictEqual(await stableFinancialState(), before);
    equal((await db.collection("cagnotteRefunds").get()).size, 0);
  });

  await check("inspection finale confirme l absence de tout effet externe", async () => {
    const inspection = await inspectCagnotteProductionFixture(db);
    equal(inspection.invoiceCount, 0);
    equal(inspection.analyticsOutboxCount, 0);
    equal(inspection.reservation.exists, false);
    equal(inspection.movements.length, 3);
    equal(inspection.product.data?.isActive, false);
    equal(hasOnlyFixtureIdentity(inspection.order.data), true);
  });

  console.log(`Fixture Production locale : ${checks} controles reussis, aucune destination externe appelee.`);
} finally {
  await db.terminate();
}

function fixtureBody() {
  return cagnotteProductionFixtureCheckoutBody() as CheckoutRequestBody;
}

function fixturePriced() {
  return cagnotteProductionFixturePricedCheckout() as PricedCheckout;
}

function commitFixtureCheckout(
  overrides: { productionFixtureCapability?: typeof capability } = {},
) {
  const body = fixtureBody();
  const selectedCapability = Object.prototype.hasOwnProperty.call(
    overrides,
    "productionFixtureCapability",
  ) ? overrides.productionFixtureCapability : capability;
  return commitCheckoutOrder({
    db,
    body,
    priced: fixturePriced(),
    checkoutRequestId: CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
    payloadFingerprint: checkoutPayloadFingerprint(body),
    customerId: CAGNOTTE_PRODUCTION_FIXTURE_UID,
    orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
    accrualProgram: cagnotteProductionFixtureProgram(),
    reservationProgram: null,
    firebaseProjectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
    nowEpochMs: Date.parse("2026-09-18T12:00:00.000Z"),
    productionFixtureCapability: selectedCapability,
  });
}

function commitFixtureStatus(
  body: Omit<OrderStatusChange, "orderId">,
  productionFixtureCapability?: CagnotteProductionFixtureCapability,
  instant = CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT,
) {
  return commitOrderStatusTransition({
    db,
    body: { orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, ...body },
    admin: { uid: "fixture-admin", email: "admin@fixture.test" },
    accrualProgram: cagnotteProductionFixtureProgram(),
    reservationProgram: null,
    firebaseProjectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
    productionFixtureCapability,
    now: () => instant,
  });
}

async function assertMarkedProductRejectedByOrdinaryCheckout(
  productDocument: Record<string, unknown>,
) {
  const productRef = db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID);
  await productRef.set(productDocument);
  const before = await databaseCounts();
  await rejects(() => priceCheckout(db, fixtureBody()), /Produit fixture refuse/);
  await rejects(
    () => commitFixtureCheckout({ productionFixtureCapability: undefined }),
    /Produit fixture indisponible/,
  );
  deepStrictEqual(await databaseCounts(), before);
  equal((await db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
  equal((await db.collection("checkoutRequests").doc(CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID).get()).exists, false);
  equal((await db.collection("orderSideEffects").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
  equal((await db.collection("stockMovements").get()).size, 0);
  await productRef.delete();
}

async function storedOrder() {
  const snapshot = await db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get();
  ok(snapshot.exists);
  return { id: snapshot.id, ...snapshot.data() } as Order;
}

async function fixtureMovements() {
  return (await db.collection("cagnotteMovements")
    .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
    .get()).docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

async function stableFinancialState() {
  const [
    order,
    wallet,
    accrual,
    movements,
    refunds,
    product,
    stockMovements,
    sideEffects,
    reservation,
  ] = await Promise.all([
    db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get(),
    db.collection("cagnotteAccruals").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    fixtureMovements(),
    db.collection("cagnotteRefunds").get(),
    db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get(),
    db.collection("stockMovements").where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("orderSideEffects").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("cagnotteReservations").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
  ]);
  return {
    order: withoutUpdatedAt(order.data()),
    wallet: wallet.data(),
    accrual: accrual.data(),
    movements: movements.sort((left, right) => left.id.localeCompare(right.id)),
    refunds: refunds.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
    product: product.data(),
    stockMovements: stockMovements.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    sideEffects: sideEffects.data(),
    reservation: reservation.data(),
  };
}

function withoutUpdatedAt(value: FirebaseFirestore.DocumentData | undefined) {
  if (!value) return value;
  const copy = { ...value };
  delete copy.updatedAt;
  return copy;
}

async function databaseCounts() {
  const names = [
    "customers",
    "products",
    "orders",
    "checkoutRequests",
    "orderSideEffects",
    "stockMovements",
    "cagnotteWallets",
    "cagnotteAccruals",
    "cagnotteMovements",
    "cagnotteReservations",
  ];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [
    name,
    (await db.collection(name).get()).size,
  ])));
}

function fixtureWalletDocument(
  overrides: Partial<{
    pendingCents: number;
    availableCents: number;
    reservedCents: number;
    regularizationCents: number;
  }> = {},
) {
  return {
    schemaVersion: 3,
    regularizationVersion: "cagnotte-regularization-v1",
    reservationVersion: "cagnotte-reservation-v1",
    currency: "EUR",
    beneficiaryId: CAGNOTTE_PRODUCTION_FIXTURE_UID,
    pendingCents: overrides.pendingCents ?? 0,
    availableCents: overrides.availableCents ?? 0,
    reservedCents: overrides.reservedCents ?? 0,
    regularizationCents: overrides.regularizationCents ?? 0,
  };
}

function hasOnlyFixtureIdentity(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const order = value as Record<string, unknown>;
  const marker = order.productionFixture as Record<string, unknown> | undefined;
  return isDeepStrictEqual(marker, {
    schemaVersion: 1,
    marker: CAGNOTTE_PRODUCTION_FIXTURE_MARKER,
    projectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
    uid: CAGNOTTE_PRODUCTION_FIXTURE_UID,
    productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
    orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
    checkoutRequestId: CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
  });
}

async function expectFixtureSkip(
  resultPromise: Promise<{ status: string; reason?: string }>,
) {
  const result = await resultPromise;
  equal(result.status, "skipped");
  equal(result.reason, "production_fixture");
}
