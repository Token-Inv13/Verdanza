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
import { shouldMountCagnotteAdminTools } from "../src/lib/cagnotteAdminEligibility.js";
import { assertOrdinaryProductAdminMutationAllowed } from "../src/lib/productionFixtureMarker.js";
import type { Invoice, Order } from "../src/types/index.js";
import {
  CAGNOTTE_PRODUCTION_FIXTURE_CHALLENGE,
  CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_EMAIL,
  CAGNOTTE_PRODUCTION_FIXTURE_FIXED_PRICE_OPTION_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK,
  CAGNOTTE_PRODUCTION_FIXTURE_MARKER,
  CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_REMAINING_STOCK,
  CAGNOTTE_PRODUCTION_FIXTURE_SIDE_EFFECT_REASON,
  CAGNOTTE_PRODUCTION_FIXTURE_STOCK_MOVEMENT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_UID,
  cagnotteProductionFixtureCheckoutBody,
  cagnotteProductionFixtureCustomerDocument,
  cagnotteProductionFixturePricedCheckout,
  cagnotteProductionFixtureProductDocument,
  cagnotteProductionFixtureStockMovementDocument,
  createCagnotteProductionFixtureCapability,
  createCagnotteProductionFixtureTestCapability,
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

  await check("mutation admin ordinaire refuse toute ressource produit marquee", () => {
    throws(
      () => assertOrdinaryProductAdminMutationAllowed(cagnotteProductionFixtureProductDocument()),
      /production_fixture_product_admin_mutation_forbidden/,
    );
    throws(
      () => assertOrdinaryProductAdminMutationAllowed({ productionFixture: { marker: "partiel" } }),
      /production_fixture_product_admin_mutation_forbidden/,
    );
    assertOrdinaryProductAdminMutationAllowed({ id: "produit-ordinaire", isActive: true });
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

  await check("paiement puis livraison utilisent le journal reel et le gain exact", async () => {
    await command("mark-paid");
    let wallet = (await db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).data()!;
    equal(wallet.pendingCents, 500);
    equal(wallet.availableCents, 0);
    let accrual = (await db.collection("cagnotteAccruals").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).data()!;
    equal(accrual.initialGainCents, 500);
    equal(accrual.paymentConfirmed, true);
    equal(accrual.deliveryConfirmed, false);
    await command("mark-delivered");
    wallet = (await db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).data()!;
    accrual = (await db.collection("cagnotteAccruals").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).data()!;
    equal(wallet.pendingCents, 0);
    equal(wallet.availableCents, 500);
    equal(accrual.deliveryConfirmed, true);
    equal(accrual.credited, true);
    equal((await fixtureMovements()).length, 3);
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
  const [wallet, accrual, movements, refunds, product, stockMovements] = await Promise.all([
    db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get(),
    db.collection("cagnotteAccruals").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    fixtureMovements(),
    db.collection("cagnotteRefunds").get(),
    db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get(),
    db.collection("stockMovements").where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
  ]);
  return {
    wallet: wallet.data(),
    accrual: accrual.data(),
    movements: movements.sort((left, right) => left.id.localeCompare(right.id)),
    refunds: refunds.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
    product: product.data(),
    stockMovements: stockMovements.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
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
  ];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [
    name,
    (await db.collection(name).get()).size,
  ])));
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
