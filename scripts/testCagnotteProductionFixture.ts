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
import {
  saveProductCost,
  saveSupplierProductAlias,
  saveSupplierPurchase,
  stripUndefinedFields,
} from "../api/invoices.js";
import { processPurchaseAnalyticsOutbox } from "../api/_server/purchaseAnalytics.js";
import { executeOrderRefund } from "../api/_server/orderRefunds.js";
import { cagnotteLedgerMovementId } from "../api/_server/cagnotteLedger.js";
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
import { cagnotteProductionFixtureReferences } from "../api/_server/cagnotteProductionFixtureState.js";
import {
  buildCagnotteProductionFixturePlan,
  assertCagnotteProductionFixtureAuthUidAvailable,
  assertCagnotteProductionFixtureProductionEnvironment,
  cagnotteProductionFixtureProgram,
  inspectCagnotteProductionFixture,
  isCagnotteProductionFixtureOutboundTargetAllowed,
  runCagnotteProductionFixtureCommand,
  type CagnotteProductionFixtureAuthLookup,
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
const fixtureAuthUidAbsent: CagnotteProductionFixtureAuthLookup = {
  getUser: async (uid) => {
    equal(uid, CAGNOTTE_PRODUCTION_FIXTURE_UID);
    throw Object.assign(new Error("synthetic user not found"), { code: "auth/user-not-found" });
  },
};
const command = (
  name: "create" | "mark-paid" | "mark-delivered" | "inspect",
  auth: CagnotteProductionFixtureAuthLookup = fixtureAuthUidAbsent,
) =>
  runCagnotteProductionFixtureCommand({
    db,
    command: name,
    capability,
    firebaseProjectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
    auth,
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

  await check("allowlist Firebase Admin borne exactement le endpoint Auth", () => {
    equal(isCagnotteProductionFixtureOutboundTargetAllowed(
      "https://identitytoolkit.googleapis.com/v1/projects/verdanza-1f621/accounts:lookup",
      true,
    ), true);
    equal(isCagnotteProductionFixtureOutboundTargetAllowed("https://firestore.googleapis.com", true), true);
    equal(isCagnotteProductionFixtureOutboundTargetAllowed("https://oauth2.googleapis.com/token", true), true);
    equal(isCagnotteProductionFixtureOutboundTargetAllowed("https://www.googleapis.com", true), false);
    equal(isCagnotteProductionFixtureOutboundTargetAllowed("https://example.googleapis.com", true), false);
    equal(isCagnotteProductionFixtureOutboundTargetAllowed("http://identitytoolkit.googleapis.com", false), false);
  });

  await check("UID fixture Auth absent, collision et panne restent fail-closed sans mutation Auth", async () => {
    let creates = 0;
    let deletes = 0;
    const auth = (getUser: CagnotteProductionFixtureAuthLookup["getUser"]) => ({
      getUser,
      createUser: async () => { creates += 1; },
      deleteUser: async () => { deletes += 1; },
    });
    await assertCagnotteProductionFixtureAuthUidAvailable(auth(async () => {
      throw Object.assign(new Error("absent"), { code: "auth/user-not-found" });
    }));
    await rejects(
      () => assertCagnotteProductionFixtureAuthUidAvailable(auth(async () => ({ uid: CAGNOTTE_PRODUCTION_FIXTURE_UID }))),
      /production_fixture_auth_collision/,
    );
    await rejects(
      () => assertCagnotteProductionFixtureAuthUidAvailable(auth(async () => {
        throw Object.assign(new Error("permission denied"), { code: "auth/insufficient-permission" });
      })),
      /production_fixture_auth_verification_failed/,
    );
    await rejects(
      () => assertCagnotteProductionFixtureAuthUidAvailable(undefined),
      /production_fixture_auth_verification_failed/,
    );
    equal(creates, 0);
    equal(deletes, 0);
  });

  await check("toute commande mutante verifie Auth avant Firestore, inspect reste passif", async () => {
    const collidingAuth: CagnotteProductionFixtureAuthLookup = {
      getUser: async () => ({ uid: CAGNOTTE_PRODUCTION_FIXTURE_UID }),
    };
    const before = await databaseCounts();
    for (const mutation of ["create", "mark-paid", "mark-delivered"] as const) {
      await rejects(() => command(mutation, collidingAuth), /production_fixture_auth_collision/);
      deepStrictEqual(await databaseCounts(), before);
    }
    let inspectAuthLookups = 0;
    await command("inspect", {
      getUser: async () => {
        inspectAuthLookups += 1;
        throw new Error("inspect must not query Auth");
      },
    });
    equal(inspectAuthLookups, 0);
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

  await check("achats, alias et couts fournisseur refusent tout produit fixture avant ecriture", async () => {
    const actor = { uid: "fixture-admin", email: "admin@fixture.test" };
    const ordinaryProductId = "supplier-ordinary-product";
    const exactFixtureProductId = "supplier-exact-fixture-product";
    const corruptFixtureProductId = "supplier-corrupt-fixture-product";
    const productRefs = [
      db.collection("products").doc(ordinaryProductId),
      db.collection("products").doc(exactFixtureProductId),
      db.collection("products").doc(corruptFixtureProductId),
    ];
    const purchaseIds = [
      "supplier-normal-purchase",
      "supplier-fixture-draft",
      "supplier-fixture-validated",
      "supplier-corrupt-draft",
      "supplier-edit-draft",
      "supplier-reserved-id-draft",
    ];
    let ordinaryAliasId = "";
    await Promise.all([
      productRefs[0].set({
        name: "Produit fournisseur ordinaire",
        internalReference: "SUPPLIER-ORDINARY",
      }),
      productRefs[1].set(cagnotteProductionFixtureProductDocument()),
      productRefs[2].set({
        name: "Produit fixture corrompu",
        internalReference: "SUPPLIER-CORRUPT",
        productionFixture: { marker: "corrompu" },
      }),
    ]);
    try {
      const serializationDate = new Date("2026-09-18T08:00:00.000Z");
      const serializationProbe = stripUndefinedFields({
        zero: 0,
        disabled: false,
        nullable: null,
        empty: "",
        omitted: undefined,
        nested: { kept: 0, omitted: undefined },
        lines: [{ kept: false, omitted: undefined }],
        date: serializationDate,
      });
      deepStrictEqual(serializationProbe, {
        zero: 0,
        disabled: false,
        nullable: null,
        empty: "",
        nested: { kept: 0 },
        lines: [{ kept: false }],
        date: serializationDate,
      });
      equal(serializationProbe.date, serializationDate);

      const normalPurchase = supplierPurchaseInput(
        purchaseIds[0],
        ordinaryProductId,
        "draft",
      );
      await saveSupplierPurchase(db, normalPurchase, actor);
      const normalDraft = (await db.collection("supplierPurchases")
        .doc(purchaseIds[0]).get()).data()!;
      equal(Object.hasOwn(normalDraft, "validatedAt"), false);
      equal(documentContainsUndefined(normalDraft), false);
      equal(Object.hasOwn(normalDraft.lines[0], "matchSource"), false);
      equal(Object.hasOwn(normalDraft.lines[0], "matchConfidence"), false);
      equal(normalDraft.globalDiscountExVat, 0);
      equal(normalDraft.shippingExVat, 0);
      await saveSupplierPurchase(
        db,
        supplierPurchaseInput(purchaseIds[0], ordinaryProductId, "validated"),
        actor,
      );
      const normalValidated = (await db.collection("supplierPurchases")
        .doc(purchaseIds[0]).get()).data()!;
      equal(typeof normalValidated.validatedAt, "string");
      equal(normalValidated.validatedAt.length > 0, true);
      equal(documentContainsUndefined(normalValidated), false);

      equal((await db.collection("products")
        .doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get()).exists, false);
      await rejects(
        () => saveSupplierPurchase(
          db,
          supplierPurchaseInput(
            purchaseIds[5],
            CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
            "draft",
          ),
          actor,
        ),
        /production_fixture_supplier_purchase_forbidden/,
      );
      equal((await db.collection("supplierPurchases").doc(purchaseIds[5]).get()).exists, false);

      await rejects(
        () => saveSupplierPurchase(
          db,
          supplierPurchaseInput(purchaseIds[1], exactFixtureProductId, "draft"),
          actor,
        ),
        /production_fixture_supplier_purchase_forbidden/,
      );
      equal((await db.collection("supplierPurchases").doc(purchaseIds[1]).get()).exists, false);
      await rejects(
        () => saveSupplierPurchase(
          db,
          supplierPurchaseInput(purchaseIds[2], exactFixtureProductId, "validated"),
          actor,
        ),
        /production_fixture_supplier_purchase_forbidden/,
      );
      equal((await db.collection("supplierPurchases").doc(purchaseIds[2]).get()).exists, false);
      await rejects(
        () => saveSupplierPurchase(
          db,
          supplierPurchaseInput(purchaseIds[3], corruptFixtureProductId, "draft"),
          actor,
        ),
        /production_fixture_supplier_purchase_forbidden/,
      );
      equal((await db.collection("supplierPurchases").doc(purchaseIds[3]).get()).exists, false);

      await saveSupplierPurchase(
        db,
        supplierPurchaseInput(purchaseIds[4], ordinaryProductId, "draft"),
        actor,
      );
      const editableBefore = (await db.collection("supplierPurchases")
        .doc(purchaseIds[4]).get()).data();
      await rejects(
        () => saveSupplierPurchase(
          db,
          supplierPurchaseInput(purchaseIds[4], exactFixtureProductId, "draft"),
          actor,
        ),
        /production_fixture_supplier_purchase_forbidden/,
      );
      deepStrictEqual(
        (await db.collection("supplierPurchases").doc(purchaseIds[4]).get()).data(),
        editableBefore,
      );

      const ordinaryAlias = await saveSupplierProductAlias(db, {
        supplierName: "Fournisseur ordinaire",
        originalLabel: "Produit ordinaire",
        productId: ordinaryProductId,
      }, actor);
      ordinaryAliasId = ordinaryAlias.aliasId;
      equal((await db.collection("supplierProductAliases").doc(ordinaryAliasId).get()).exists, true);
      const aliasCount = (await db.collection("supplierProductAliases").get()).size;
      await rejects(
        () => saveSupplierProductAlias(db, {
          supplierName: "Fournisseur fixture reserve",
          originalLabel: "Produit fixture reserve",
          productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
        }, actor),
        /production_fixture_supplier_alias_forbidden/,
      );
      await rejects(
        () => saveSupplierProductAlias(db, {
          supplierName: "Fournisseur fixture",
          originalLabel: "Produit fixture exact",
          productId: exactFixtureProductId,
        }, actor),
        /production_fixture_product_admin_mutation_forbidden/,
      );
      await rejects(
        () => saveSupplierProductAlias(db, {
          supplierName: "Fournisseur fixture",
          originalLabel: "Produit fixture corrompu",
          productId: corruptFixtureProductId,
        }, actor),
        /production_fixture_product_admin_mutation_forbidden/,
      );
      equal((await db.collection("supplierProductAliases").get()).size, aliasCount);

      await saveProductCost(db, ordinaryProductId, 2.5, actor);
      equal((await db.collection("productCosts").doc(ordinaryProductId).get()).exists, true);
      await rejects(
        () => saveProductCost(db, CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, 999, actor),
        /production_fixture_product_cost_forbidden/,
      );
      await rejects(
        () => saveProductCost(db, exactFixtureProductId, 999, actor),
        /production_fixture_product_admin_mutation_forbidden/,
      );
      await rejects(
        () => saveProductCost(db, corruptFixtureProductId, 999, actor),
        /production_fixture_product_admin_mutation_forbidden/,
      );
      equal((await db.collection("productCosts").doc(exactFixtureProductId).get()).exists, false);
      equal((await db.collection("productCosts").doc(corruptFixtureProductId).get()).exists, false);
    } finally {
      await Promise.all([
        ...productRefs.map((ref) => ref.delete()),
        ...purchaseIds.map((id) => db.collection("supplierPurchases").doc(id).delete()),
        db.collection("productCosts").doc(ordinaryProductId).delete(),
        db.collection("productCosts").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).delete(),
        db.collection("productCosts").doc(exactFixtureProductId).delete(),
        db.collection("productCosts").doc(corruptFixtureProductId).delete(),
        ...(ordinaryAliasId
          ? [db.collection("supplierProductAliases").doc(ordinaryAliasId).delete()]
          : []),
      ]);
    }
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

  await check("artefacts externes residuels refusent create avant toute ecriture", async () => {
    const collisions = [
      {
        collection: "invoices",
        id: "production-fixture-residual-invoice-v1",
        expected: /production_fixture_invoice_collision/,
      },
      {
        collection: "analyticsOutbox",
        id: "production-fixture-residual-analytics-v1",
        expected: /production_fixture_analytics_outbox_collision/,
      },
      {
        collection: "paymentLinkRequests",
        id: "production-fixture-residual-payment-link-v1",
        expected: /production_fixture_payment_link_collision/,
      },
      {
        collection: "cagnotteRefunds",
        id: "production-fixture-residual-refund-v1",
        expected: /production_fixture_refund_collision/,
        action: "record_confirmed",
      },
      {
        collection: "cagnotteRefunds",
        id: "production-fixture-residual-correction-v1",
        expected: /production_fixture_refund_collision/,
        action: "record_correction",
      },
    ] as const;
    for (const collision of collisions) {
      const ref = db.collection(collision.collection).doc(collision.id);
      await ref.set({
        orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
        status: "residual",
        ...("action" in collision ? { action: collision.action } : {}),
      });
      try {
        const before = await databaseCounts();
        await rejects(() => command("create"), collision.expected, collision.collection);
        deepStrictEqual(await databaseCounts(), before, collision.collection);
        equal((await db.collection("customers")
          .doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).exists, false);
        equal((await db.collection("products")
          .doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get()).exists, false);
        equal((await db.collection("orders")
          .doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get()).exists, false);
      } finally {
        await ref.delete();
      }
    }
  });

  await check("journal residuel par beneficiaire ou commande refuse create avant ecriture", async () => {
    const collisions = [
      {
        id: "production-fixture-beneficiary-other-order-before-create-v1",
        data: {
          orderId: "other-order",
          beneficiaryId: CAGNOTTE_PRODUCTION_FIXTURE_UID,
          businessEvent: "payment_confirmed",
        },
      },
      {
        id: "production-fixture-order-other-beneficiary-before-create-v1",
        data: {
          orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
          beneficiaryId: "other-beneficiary",
          businessEvent: "payment_confirmed",
        },
      },
    ];
    for (const collision of collisions) {
      const ref = db.collection("cagnotteMovements").doc(collision.id);
      await ref.set(collision.data);
      try {
        const before = await databaseCounts();
        await rejects(() => command("create"), /production_fixture_movement_collision/);
        deepStrictEqual(await databaseCounts(), before);
        deepStrictEqual((await ref.get()).data(), collision.data);
        equal((await db.collection("customers")
          .doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).exists, false);
        equal((await db.collection("products")
          .doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get()).exists, false);
      } finally {
        await ref.delete();
      }
    }
  });

  await check("artefacts comptables fixture residuels refusent create avant ecriture", async () => {
    for (const status of ["draft", "validated", "cancelled"] as const) {
      const ref = db.collection("supplierPurchases")
        .doc(`production-fixture-residual-supplier-${status}-v1`);
      const residual = fixtureSupplierPurchaseDocument(ref.id, status);
      await ref.set(residual);
      try {
        const before = await databaseCounts();
        await rejects(
          () => command("create"),
          /production_fixture_supplier_purchase_collision/,
        );
        deepStrictEqual(await databaseCounts(), before);
        deepStrictEqual((await ref.get()).data(), residual);
        equal((await db.collection("products")
          .doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get()).exists, false);
      } finally {
        await ref.delete();
      }
    }

    const productCostRef = db.collection("productCosts")
      .doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID);
    const productCost = { productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, purchasePricePerGram: 999 };
    await productCostRef.set(productCost);
    try {
      await rejects(() => command("create"), /production_fixture_product_cost_collision/);
      deepStrictEqual((await productCostRef.get()).data(), productCost);
    } finally {
      await productCostRef.delete();
    }

    const aliasRef = db.collection("supplierProductAliases")
      .doc("production-fixture-residual-alias-v1");
    const alias = { productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, supplierName: "Residual" };
    await aliasRef.set(alias);
    try {
      await rejects(() => command("create"), /production_fixture_supplier_alias_collision/);
      deepStrictEqual((await aliasRef.get()).data(), alias);
    } finally {
      await aliasRef.delete();
    }
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

  await check("tout mouvement lie par orderId ou productId refuse create avant ecriture", async () => {
    const collisions = [
      {
        id: "production-fixture-stock-order-only-v1",
        data: { orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, quantity: -1 },
      },
      {
        id: "production-fixture-stock-order-other-product-v1",
        data: {
          orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
          productId: "other-product",
          quantity: -1,
        },
      },
      {
        id: "production-fixture-stock-product-only-v1",
        data: { productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, quantity: -1 },
      },
      {
        id: "production-fixture-stock-product-other-order-v1",
        data: {
          orderId: "other-order",
          productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
          quantity: -1,
        },
      },
      {
        id: "production-fixture-stock-duplicate-axes-v1",
        data: {
          orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
          productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
          quantity: -1,
        },
      },
    ];
    for (const collision of collisions) {
      const ref = db.collection("stockMovements").doc(collision.id);
      await ref.set(collision.data);
      try {
        const before = await databaseCounts();
        await rejects(() => command("create"), /production_fixture_stock_movement_collision/);
        deepStrictEqual((await ref.get()).data(), collision.data);
        deepStrictEqual(await databaseCounts(), before);
        equal((await db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get()).exists, false);
        equal((await db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get()).exists, false);
      } finally {
        await ref.delete();
      }
    }
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

  await check("checkout ordinaire refuse le UID fixture avant acces au wallet de 500 cents", async () => {
    const productId = "ordinary-fixture-uid-guard-product";
    const orderId = "ordinary-fixture-uid-guard-order";
    const checkoutRequestId = "c011ec7e-0004-4000-8000-000000000004";
    const product = {
      ...cagnotteProductionFixtureProductDocument(),
      internalReference: "ORDINARY-UID-GUARD",
      slug: productId,
      name: "Produit ordinaire garde UID",
      isActive: true,
    };
    delete (product as { productionFixture?: unknown }).productionFixture;
    const walletRef = db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID);
    await Promise.all([
      db.collection("products").doc(productId).set(product),
      walletRef.set(fixtureWalletDocument({ availableCents: 500 })),
    ]);
    try {
      const body = {
        ...fixtureBody(),
        checkoutRequestId,
        items: [{
          productId,
          quantity: 1,
          purchaseMode: "fixed_price" as const,
          fixedPriceOptionId: CAGNOTTE_PRODUCTION_FIXTURE_FIXED_PRICE_OPTION_ID,
        }],
        cagnotteUse: { requestedCents: 500 },
      };
      const priced = await priceCheckout(db, body);
      const before = await databaseCounts();
      await rejects(() => commitCheckoutOrder({
        db,
        body,
        priced,
        checkoutRequestId,
        payloadFingerprint: checkoutPayloadFingerprint(body),
        customerId: CAGNOTTE_PRODUCTION_FIXTURE_UID,
        orderId,
        accrualProgram: null,
        reservationProgram: null,
        firebaseProjectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
      }), /production_fixture_customer_checkout_forbidden/);
      deepStrictEqual(await databaseCounts(), before);
      equal((await walletRef.get()).data()?.availableCents, 500);
      equal((await db.collection("products").doc(productId).get()).data()?.stock,
        CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK);
      equal((await db.collection("orders").doc(orderId).get()).exists, false);
      equal((await db.collection("checkoutRequests").doc(checkoutRequestId).get()).exists, false);
    } finally {
      await Promise.all([
        db.collection("products").doc(productId).delete(),
        walletRef.delete(),
      ]);
    }
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
      customerId: "ordinary-customer",
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

  await check("fixture creee refuse le journal d un autre order pour son beneficiaire", async () => {
    const ref = db.collection("cagnotteMovements")
      .doc("production-fixture-beneficiary-other-order-created-v1");
    const parasite = {
      orderId: "other-order",
      beneficiaryId: CAGNOTTE_PRODUCTION_FIXTURE_UID,
      businessEvent: "payment_confirmed",
    };
    await ref.set(parasite);
    try {
      const before = await stableFinancialState();
      await rejects(() => command("create"), /production_fixture_movement_collision/);
      await rejects(() => command("mark-paid"), /production_fixture_movement_collision/);
      deepStrictEqual(await stableFinancialState(), before);
      deepStrictEqual((await ref.get()).data(), parasite);
    } finally {
      await ref.delete();
    }
  });

  await check("fixture creee refuse chaque artefact comptable residuel", async () => {
    const collisions = [
      {
        collection: "supplierPurchases",
        id: "production-fixture-residual-supplier-created-v1",
        data: fixtureSupplierPurchaseDocument(
          "production-fixture-residual-supplier-created-v1",
          "draft",
        ),
        expected: /production_fixture_supplier_purchase_collision/,
      },
      {
        collection: "productCosts",
        id: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
        data: { productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, purchasePricePerGram: 999 },
        expected: /production_fixture_product_cost_collision/,
      },
      {
        collection: "supplierProductAliases",
        id: "production-fixture-residual-alias-created-v1",
        data: { productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, supplierName: "Residual" },
        expected: /production_fixture_supplier_alias_collision/,
      },
    ];
    for (const collision of collisions) {
      const ref = db.collection(collision.collection).doc(collision.id);
      await ref.set(collision.data);
      try {
        const before = await stableFinancialState();
        await rejects(() => command("create"), collision.expected);
        await rejects(() => command("mark-paid"), collision.expected);
        deepStrictEqual(await stableFinancialState(), before);
        deepStrictEqual((await ref.get()).data(), collision.data);
      } finally {
        await ref.delete();
      }
    }
  });

  await check("fixture creee refuse tout second mouvement sur les deux axes", async () => {
    const parasites = [
      {
        id: "production-fixture-created-extra-order-v1",
        data: {
          orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
          productId: "other-product",
          quantity: -1,
        },
      },
      {
        id: "production-fixture-created-extra-product-v1",
        data: {
          orderId: "other-order",
          productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
          quantity: -1,
        },
      },
      {
        id: "production-fixture-created-extra-product-no-order-v1",
        data: { productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, quantity: -1 },
      },
    ];
    for (const parasite of parasites) {
      const ref = db.collection("stockMovements").doc(parasite.id);
      await ref.set(parasite.data);
      try {
        const before = await stableFinancialState();
        await rejects(() => command("create"), /production_fixture_stock_movement_collision/);
        await rejects(() => command("mark-paid"), /production_fixture_stock_movement_collision/);
        deepStrictEqual(await stableFinancialState(), before);
        deepStrictEqual((await ref.get()).data(), parasite.data);
      } finally {
        await ref.delete();
      }
    }
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

  await check("artefacts externes residuels refusent le rejeu create sans mutation", async () => {
    const collisions = [
      {
        collection: "invoices",
        id: "production-fixture-existing-invoice-v1",
        expected: /production_fixture_invoice_collision/,
      },
      {
        collection: "analyticsOutbox",
        id: "production-fixture-existing-analytics-v1",
        expected: /production_fixture_analytics_outbox_collision/,
      },
      {
        collection: "paymentLinkRequests",
        id: "production-fixture-existing-payment-link-v1",
        expected: /production_fixture_payment_link_collision/,
      },
      {
        collection: "cagnotteRefunds",
        id: "production-fixture-existing-refund-v1",
        expected: /production_fixture_refund_collision/,
      },
    ] as const;
    for (const collision of collisions) {
      const ref = db.collection(collision.collection).doc(collision.id);
      await ref.set({
        orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
        status: "residual",
      });
      try {
        const before = await stableFinancialState();
        await rejects(() => command("create"), collision.expected, collision.collection);
        deepStrictEqual(await stableFinancialState(), before, collision.collection);
      } finally {
        await ref.delete();
      }
    }
  });

  await check("facture residuelle refuse mark-paid sans mutation", async () => {
    const invoiceRef = db.collection("invoices")
      .doc("production-fixture-before-paid-invoice-v1");
    await invoiceRef.set({
      orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
      status: "draft",
    });
    try {
      const before = await stableFinancialState();
      await rejects(() => command("mark-paid"), /production_fixture_invoice_collision/);
      deepStrictEqual(await stableFinancialState(), before);
    } finally {
      await invoiceRef.delete();
    }
  });

  await check("refund residuel refuse mark-paid sans mutation", async () => {
    const refundRef = db.collection("cagnotteRefunds")
      .doc("production-fixture-before-paid-refund-v1");
    const residual = {
      orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
      action: "record_confirmed",
      status: "recorded",
    };
    await refundRef.set(residual);
    try {
      const before = await stableFinancialState();
      await rejects(() => command("mark-paid"), /production_fixture_refund_collision/);
      deepStrictEqual(await stableFinancialState(), before);
      deepStrictEqual((await refundRef.get()).data(), residual);
    } finally {
      await refundRef.delete();
    }
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

  await check("mark-delivered refuse une fixture CREATED complete sans aucune mutation", async () => {
    const before = await stableFinancialState();
    await rejects(
      () => command("mark-delivered"),
      /production_fixture_state_transition_invalid/,
    );
    deepStrictEqual(await stableFinancialState(), before);
  });

  await check("snapshot cagnotte complet refuse chaque divergence avant mark-paid", async () => {
    const orderRef = cagnotteProductionFixtureReferences(db).order;
    const corruptions: Array<readonly [string, (snapshot: FixtureSnapshot) => void]> = [
      ["lineId avec totaux inchanges", (snapshot) => {
        snapshot.lines[0].lineId = "fixture-line-divergente";
      }],
      ["initialCents ligne", (snapshot) => {
        snapshot.lines[0].initialCents = 9_999;
      }],
      ["loyaltyCents", (snapshot) => {
        snapshot.loyaltyCents = 499;
      }],
      ["eligibleCents", (snapshot) => {
        snapshot.eligibleCents = 9_999;
      }],
      ["productsPaidCents", (snapshot) => {
        snapshot.productsPaidCents = 9_999;
      }],
      ["appliedCagnotteCents", (snapshot) => {
        snapshot.appliedCagnotteCents = 1;
      }],
      ["calculationVersion", (snapshot) => {
        snapshot.calculationVersion = "cagnotte-math-divergent";
      }],
      ["limitationReasons", (snapshot) => {
        snapshot.limitationReasons = ["available_balance"];
      }],
    ];
    for (const [name, mutateSnapshot] of corruptions) {
      await assertFixtureCorruptionRejected({
        name,
        ref: orderRef,
        mutate: fixtureSnapshotCorruption(mutateSnapshot),
        expected: /production_fixture_order_collision/,
      }, "mark-paid");
    }
  });

  await check("validation atomique refuse chaque divergence avant mark-paid", async () => {
    const refs = cagnotteProductionFixtureReferences(db);
    const unexpectedMovement = db.collection("cagnotteMovements")
      .doc("production-fixture-created-extra-movement-v1");
    const corruptions: FixtureCorruption[] = [
      {
        name: "customer divergent",
        ref: refs.customer,
        mutate: async (ref, original) => ref.set({ ...original, displayName: "Fixture divergente" }),
        expected: /production_fixture_customer_collision/,
      },
      {
        name: "admin fixture present",
        ref: refs.admin,
        mutate: async (ref) => ref.set({ role: "admin", isAdmin: true }),
        expected: /production_fixture_admin_collision/,
      },
      {
        name: "product divergent",
        ref: refs.product,
        mutate: async (ref, original) => ref.set({ ...original, stock: 9 }),
        expected: /production_fixture_product_collision/,
      },
      {
        name: "checkout request divergent",
        ref: refs.checkoutRequest,
        mutate: async (ref, original) => ref.set({ ...original, payloadFingerprint: "divergent" }),
        expected: /production_fixture_checkout_request_collision/,
      },
      {
        name: "outbox divergent",
        ref: refs.sideEffects,
        mutate: async (ref, original) => {
          const tasks = original?.tasks as Record<string, Record<string, unknown>>;
          await ref.set({
            ...original,
            tasks: {
              ...tasks,
              customer_confirmation_email: {
                ...tasks.customer_confirmation_email,
                status: "pending",
              },
            },
          });
        },
        expected: /production_fixture_outbox_collision/,
      },
      {
        name: "stock movement divergent",
        ref: refs.stockMovement,
        mutate: async (ref, original) => ref.set({ ...original, quantity: -9 }),
        expected: /production_fixture_stock_movement_collision/,
      },
      {
        name: "reservation presente",
        ref: refs.reservation,
        mutate: async (ref) => ref.set({
          orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
          status: "reserved",
        }),
        expected: /production_fixture_reservation_collision/,
      },
      {
        name: "wallet inattendu",
        ref: refs.wallet,
        mutate: async (ref) => ref.set(fixtureWalletDocument({ pendingCents: 500 })),
        expected: /production_fixture_wallet_collision/,
      },
      {
        name: "accrual inattendu",
        ref: refs.accrual,
        mutate: async (ref) => ref.set({
          orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
          beneficiaryId: CAGNOTTE_PRODUCTION_FIXTURE_UID,
        }),
        expected: /production_fixture_wallet_collision/,
      },
      {
        name: "mouvement inattendu",
        ref: unexpectedMovement,
        mutate: async (ref) => ref.set({
          orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
          businessEvent: "payment_confirmed",
        }),
        expected: /production_fixture_movement_collision/,
      },
      {
        name: "order divergent",
        ref: refs.order,
        mutate: async (ref, original) => ref.set({ ...original, total: 101 }),
        expected: /production_fixture_order_collision/,
      },
    ];
    for (const corruption of corruptions) {
      await assertFixtureCorruptionRejected(corruption, "mark-paid");
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
      "cagnotteRefunds",
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

  await check("fixture payee refuse un mouvement parasite avant mark-delivered", async () => {
    const ref = db.collection("stockMovements")
      .doc("production-fixture-paid-extra-product-v1");
    const parasite = { productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, quantity: -1 };
    await ref.set(parasite);
    try {
      const before = await stableFinancialState();
      await rejects(() => command("create"), /production_fixture_stock_movement_collision/);
      await rejects(() => command("mark-delivered"), /production_fixture_stock_movement_collision/);
      deepStrictEqual(await stableFinancialState(), before);
      deepStrictEqual((await ref.get()).data(), parasite);
    } finally {
      await ref.delete();
    }
  });

  await check("fixture payee refuse le journal d un autre order pour son beneficiaire", async () => {
    const ref = db.collection("cagnotteMovements")
      .doc("production-fixture-beneficiary-other-order-paid-v1");
    const parasite = {
      orderId: "other-order",
      beneficiaryId: CAGNOTTE_PRODUCTION_FIXTURE_UID,
      businessEvent: "delivery_confirmed",
    };
    await ref.set(parasite);
    try {
      const before = await stableFinancialState();
      await rejects(() => command("mark-delivered"), /production_fixture_movement_collision/);
      deepStrictEqual(await stableFinancialState(), before);
      deepStrictEqual((await ref.get()).data(), parasite);
    } finally {
      await ref.delete();
    }
  });

  await check("fixture payee refuse chaque artefact comptable residuel", async () => {
    const collisions = [
      {
        collection: "supplierPurchases",
        id: "production-fixture-residual-supplier-paid-v1",
        data: fixtureSupplierPurchaseDocument(
          "production-fixture-residual-supplier-paid-v1",
          "validated",
        ),
        expected: /production_fixture_supplier_purchase_collision/,
      },
      {
        collection: "productCosts",
        id: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
        data: { productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, purchasePricePerGram: 999 },
        expected: /production_fixture_product_cost_collision/,
      },
      {
        collection: "supplierProductAliases",
        id: "production-fixture-residual-alias-paid-v1",
        data: { productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID, supplierName: "Residual" },
        expected: /production_fixture_supplier_alias_collision/,
      },
    ];
    for (const collision of collisions) {
      const ref = db.collection(collision.collection).doc(collision.id);
      await ref.set(collision.data);
      try {
        const before = await stableFinancialState();
        await rejects(() => command("mark-delivered"), collision.expected);
        deepStrictEqual(await stableFinancialState(), before);
        deepStrictEqual((await ref.get()).data(), collision.data);
      } finally {
        await ref.delete();
      }
    }
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

  await check("facture residuelle refuse mark-delivered sans mutation", async () => {
    const invoiceRef = db.collection("invoices")
      .doc("production-fixture-before-delivery-invoice-v1");
    await invoiceRef.set({
      orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
      status: "draft",
    });
    try {
      const before = await stableFinancialState();
      await rejects(
        () => command("mark-delivered"),
        /production_fixture_invoice_collision/,
      );
      deepStrictEqual(await stableFinancialState(), before);
    } finally {
      await invoiceRef.delete();
    }
  });

  await check("correction residuelle refuse mark-delivered sans mutation", async () => {
    const refundRef = db.collection("cagnotteRefunds")
      .doc("production-fixture-before-delivery-correction-v1");
    const residual = {
      orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
      action: "record_correction",
      status: "recorded",
    };
    await refundRef.set(residual);
    try {
      const before = await stableFinancialState();
      await rejects(() => command("mark-delivered"), /production_fixture_refund_collision/);
      deepStrictEqual(await stableFinancialState(), before);
      deepStrictEqual((await refundRef.get()).data(), residual);
    } finally {
      await refundRef.delete();
    }
  });

  await check("validation atomique refuse chaque divergence avant mark-delivered", async () => {
    const refs = cagnotteProductionFixtureReferences(db);
    const paymentMovement = db.collection("cagnotteMovements").doc(
      cagnotteLedgerMovementId(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, "payment_confirmed"),
    );
    const unexpectedMovement = db.collection("cagnotteMovements")
      .doc("production-fixture-paid-extra-movement-v1");
    const corruptions: FixtureCorruption[] = [
      {
        name: "customer divergent",
        ref: refs.customer,
        mutate: async (ref, original) => ref.set({ ...original, email: "divergent@verdanza.test" }),
        expected: /production_fixture_customer_collision/,
      },
      {
        name: "admin fixture present",
        ref: refs.admin,
        mutate: async (ref) => ref.set({ role: "admin", isAdmin: true }),
        expected: /production_fixture_admin_collision/,
      },
      {
        name: "product divergent",
        ref: refs.product,
        mutate: async (ref, original) => ref.set({ ...original, isActive: true }),
        expected: /production_fixture_product_collision/,
      },
      {
        name: "checkout request divergent",
        ref: refs.checkoutRequest,
        mutate: async (ref, original) => ref.set({
          ...original,
          cagnotteBeneficiaryId: "autre-beneficiaire",
        }),
        expected: /production_fixture_checkout_request_collision/,
      },
      {
        name: "outbox divergente",
        ref: refs.sideEffects,
        mutate: async (ref, original) => {
          const tasks = original?.tasks as Record<string, Record<string, unknown>>;
          await ref.set({
            ...original,
            tasks: {
              ...tasks,
              draft_invoice: { ...tasks.draft_invoice, attempts: 1 },
            },
          });
        },
        expected: /production_fixture_outbox_collision/,
      },
      {
        name: "stock movement divergent",
        ref: refs.stockMovement,
        mutate: async (ref, original) => ref.set({ ...original, createdBy: "autre" }),
        expected: /production_fixture_stock_movement_collision/,
      },
      {
        name: "reservation presente",
        ref: refs.reservation,
        mutate: async (ref) => ref.set({
          orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
          status: "reserved",
        }),
        expected: /production_fixture_reservation_collision/,
      },
      {
        name: "wallet divergent",
        ref: refs.wallet,
        mutate: async (ref, original) => ref.set({ ...original, pendingCents: 499 }),
        expected: /production_fixture_wallet_collision/,
      },
      {
        name: "accrual divergent",
        ref: refs.accrual,
        mutate: async (ref, original) => ref.set({ ...original, remainingGainCents: 499 }),
        expected: /production_fixture_ledger_collision/,
      },
      {
        name: "mouvement divergent",
        ref: paymentMovement,
        mutate: async (ref, original) => ref.set({ ...original, pendingDeltaCents: 499 }),
        expected: /production_fixture_(ledger|movement)_collision/,
      },
      {
        name: "mouvement manquant",
        ref: paymentMovement,
        mutate: async (ref) => ref.delete(),
        expected: /production_fixture_movement_collision/,
      },
      {
        name: "mouvement supplementaire",
        ref: unexpectedMovement,
        mutate: async (ref) => ref.set({
          orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
          businessEvent: "unexpected",
        }),
        expected: /production_fixture_movement_collision/,
      },
      {
        name: "order divergent",
        ref: refs.order,
        mutate: async (ref, original) => ref.set({ ...original, subtotal: 101 }),
        expected: /production_fixture_order_collision/,
      },
    ];
    for (const corruption of corruptions) {
      await assertFixtureCorruptionRejected(corruption, "mark-delivered");
    }
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

  await check("fixture livree refuse un second mouvement au rejeu", async () => {
    const ref = db.collection("stockMovements")
      .doc("production-fixture-delivered-extra-order-v1");
    const parasite = {
      orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
      productId: "other-product",
      quantity: -1,
    };
    await ref.set(parasite);
    try {
      const before = await stableFinancialState();
      await rejects(() => command("create"), /production_fixture_stock_movement_collision/);
      await rejects(() => command("mark-delivered"), /production_fixture_stock_movement_collision/);
      deepStrictEqual(await stableFinancialState(), before);
      deepStrictEqual((await ref.get()).data(), parasite);
    } finally {
      await ref.delete();
    }
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
    equal(inspection.paymentLinkRequestCount, 0);
    equal(inspection.refundCount, 0);
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

function supplierPurchaseInput(
  id: string,
  productId: string,
  status: "draft" | "validated",
) {
  return {
    id,
    supplierName: "Fournisseur fixture test",
    invoiceNumber: `FIXTURE-${id}`,
    invoiceDate: "2026-09-18",
    globalDiscountExVat: 0,
    shippingExVat: 0,
    vatRate: 0,
    costBase: "HT" as const,
    status,
    lines: [{
      id: "line-1",
      productId,
      quantityGrams: 10,
      grossAmountExVat: 20,
      vatRate: 0,
      lineDiscountAmount: 0,
    }],
  };
}

function fixtureSupplierPurchaseDocument(
  id: string,
  status: "draft" | "validated" | "cancelled",
) {
  return {
    id,
    supplierName: "Fournisseur residuel fixture",
    invoiceNumber: `FIXTURE-RESIDUAL-${id}`,
    invoiceDate: "2026-09-18",
    status,
    lines: [{
      id: "line-fixture",
      productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
      quantityGrams: 10,
      grossAmountExVat: 20,
    }],
    ...(status === "validated" ? { validatedAt: "2026-09-18T10:00:00.000Z" } : {}),
    ...(status === "cancelled" ? { cancelledAt: "2026-09-18T11:00:00.000Z" } : {}),
  };
}

function documentContainsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(documentContainsUndefined);
  if (!value || typeof value !== "object") return false;
  if (value instanceof Date) return false;
  return Object.values(value).some(documentContainsUndefined);
}

function fixturePriced() {
  return cagnotteProductionFixturePricedCheckout() as PricedCheckout;
}

function commitFixtureCheckout(
  overrides: {
    productionFixtureCapability?: typeof capability;
    customerId?: string;
  } = {},
) {
  const body = fixtureBody();
  const selectedCapability = Object.prototype.hasOwnProperty.call(
    overrides,
    "productionFixtureCapability",
  ) ? overrides.productionFixtureCapability : capability;
  const customerId = Object.prototype.hasOwnProperty.call(overrides, "customerId")
    ? overrides.customerId
    : CAGNOTTE_PRODUCTION_FIXTURE_UID;
  return commitCheckoutOrder({
    db,
    body,
    priced: fixturePriced(),
    checkoutRequestId: CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
    payloadFingerprint: checkoutPayloadFingerprint(body),
    customerId,
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
  instant: string = CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT,
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

type FixtureCorruption = Readonly<{
  name: string;
  ref: FirebaseFirestore.DocumentReference;
  mutate: (
    ref: FirebaseFirestore.DocumentReference,
    original: FirebaseFirestore.DocumentData | undefined,
  ) => Promise<unknown>;
  expected: RegExp;
}>;

type FixtureSnapshot = Record<string, unknown> & {
  lines: Array<Record<string, unknown>>;
  loyaltyCents: number;
  eligibleCents: number;
  productsPaidCents: number;
  appliedCagnotteCents: number;
  calculationVersion: string;
  limitationReasons: string[];
};

function fixtureSnapshotCorruption(
  mutateSnapshot: (snapshot: FixtureSnapshot) => void,
): FixtureCorruption["mutate"] {
  return async (ref, original) => {
    if (!original) throw new Error("production_fixture_test_order_missing");
    const corrupted = structuredClone(original);
    const enrollment = corrupted.cagnotte as { snapshot?: FixtureSnapshot } | undefined;
    if (!enrollment?.snapshot) {
      throw new Error("production_fixture_test_snapshot_missing");
    }
    mutateSnapshot(enrollment.snapshot);
    return ref.set(corrupted);
  };
}

async function assertFixtureCorruptionRejected(
  corruption: FixtureCorruption,
  transition: "mark-paid" | "mark-delivered",
) {
  const original = await corruption.ref.get();
  const originalData = original.data();
  try {
    await corruption.mutate(corruption.ref, originalData);
    const before = await stableFinancialState();
    await rejects(() => command(transition), corruption.expected, corruption.name);
    deepStrictEqual(await stableFinancialState(), before, corruption.name);
  } finally {
    if (original.exists) await corruption.ref.set(originalData!);
    else await corruption.ref.delete();
  }
}

async function assertMarkedProductRejectedByOrdinaryCheckout(
  productDocument: Record<string, unknown>,
) {
  const productRef = db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID);
  await productRef.set(productDocument);
  const before = await databaseCounts();
  await rejects(() => priceCheckout(db, fixtureBody()), /Produit fixture refuse/);
  await rejects(
    () => commitFixtureCheckout({
      productionFixtureCapability: undefined,
      customerId: "ordinary-fixture-product-customer",
    }),
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
    customer,
    admin,
    order,
    checkoutRequest,
    wallet,
    accrual,
    movements,
    refunds,
    product,
    stockMovements,
    sideEffects,
    reservation,
    invoices,
    analyticsOutbox,
    paymentLinkRequests,
    supplierPurchases,
    productCost,
    supplierAliases,
  ] = await Promise.all([
    db.collection("customers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get(),
    db.collection("adminUsers").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get(),
    db.collection("orders").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("checkoutRequests").doc(CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID).get(),
    db.collection("cagnotteWallets").doc(CAGNOTTE_PRODUCTION_FIXTURE_UID).get(),
    db.collection("cagnotteAccruals").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("cagnotteMovements").get(),
    db.collection("cagnotteRefunds").get(),
    db.collection("products").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get(),
    db.collection("stockMovements").get(),
    db.collection("orderSideEffects").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("cagnotteReservations").doc(CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("invoices").where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("analyticsOutbox").where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("paymentLinkRequests").where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID).get(),
    db.collection("supplierPurchases").get(),
    db.collection("productCosts").doc(CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get(),
    db.collection("supplierProductAliases")
      .where("productId", "==", CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID).get(),
  ]);
  return {
    customer: customer.data(),
    admin: admin.data(),
    order: withoutUpdatedAt(order.data()),
    checkoutRequest: checkoutRequest.data(),
    wallet: wallet.data(),
    accrual: accrual.data(),
    movements: sortedDocuments(movements),
    refunds: refunds.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
    product: product.data(),
    stockMovements: stockMovements.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    sideEffects: sideEffects.data(),
    reservation: reservation.data(),
    invoices: sortedDocuments(invoices),
    analyticsOutbox: sortedDocuments(analyticsOutbox),
    paymentLinkRequests: sortedDocuments(paymentLinkRequests),
    supplierPurchases: sortedDocuments(supplierPurchases),
    productCost: productCost.data(),
    supplierAliases: sortedDocuments(supplierAliases),
  };
}

function sortedDocuments(snapshot: FirebaseFirestore.QuerySnapshot) {
  return snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .sort((left, right) => left.id.localeCompare(right.id));
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
    "cagnotteRefunds",
    "invoices",
    "analyticsOutbox",
    "paymentLinkRequests",
    "supplierPurchases",
    "productCosts",
    "supplierProductAliases",
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
