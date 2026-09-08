import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { CAGNOTTE_DEMO, connectCagnotteEmulator } from "./cagnotteEmulator.js";
import { assertAdminUser, type VerifiedFirebaseUser } from "../api/_server/adminAuth.js";
import { createOrderStatusHandler } from "../api/_server/orderStatusRoute.js";
import { commitOrderStatusTransition } from "../api/_server/orderStatusTransition.js";
import { createCheckoutIdentityResolver } from "../api/_server/checkoutIdentity.js";
import { parseCheckoutBody, priceCheckout } from "../api/_server/checkout.js";
import { commitCheckoutOrder } from "../api/_server/checkoutOrder.js";
import { checkoutPayloadFingerprint } from "../api/_server/orderSideEffects.js";
import { buildCagnotteOrderEnrollment } from "../api/_server/cagnotteOrders.js";
import { hasCagnotteEnrollment, orderFromSnapshot, deleteUnenrolledOrderCandidates } from "../api/_server/orderProtection.js";
import { executePaymentLinkDelivery, type PaymentLinkDeliveryRequest } from "../api/_server/paymentLinkDelivery.js";
import { CAGNOTTE_SERVER_PROGRAM } from "../api/_server/cagnotteProgram.js";
import type { CagnotteTestProgram } from "../api/_server/cagnotteLedgerTypes.js";
import type { Order } from "../src/types/index.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const counts = new Map<string, number>();
async function test(category: string, name: string, run: () => Promise<unknown>) {
  try { await run(); } catch (error) { console.error(`FAIL [${category}] ${name}`); throw error; }
  counts.set(category, (counts.get(category) || 0) + 1); console.log(`OK [${category}] ${name}`);
}
const admin: VerifiedFirebaseUser = { uid: "security-admin", email: "security-admin@example.test", emailVerified: true };
const program: CagnotteTestProgram = { mode: "local_test", programVersion: "security-test-v1", calculationVersion: "cagnotte-math-v1", startsAtEpochMs: 1000, newAccrualsEnabled: true };
const now = () => "2000-01-01T00:00:00.000Z";
const paid = { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } as const;
const cancelled = { orderStatus: "cancelled", paymentStatus: "cancelled" } as const;
let sequence = 0;
async function fixture(options: { enrollment?: boolean; overrides?: Record<string, unknown> } = {}) {
  const id = `security-order-${++sequence}`;
  const data: Record<string, unknown> = {
    customerId: `security-customer-${sequence}`, customerEmail: "synthetic@example.test", customerName: "Synthetic",
    orderStatus: "contact_required", paymentStatus: "to_confirm", deliveryMethod: "postal", subtotal: 100,
    discountAmount: 0, promotionDiscountTotal: 0, deliveryFee: 0, total: 100,
    items: [{ lineId: "line", productId: "security-product", name: "Synthetic", quantity: 10, unitPrice: 10, lineTotal: 100 }],
    ...options.overrides,
  };
  if (options.enrollment) data.cagnotte = buildCagnotteOrderEnrollment(data, String(data.customerId), program, 2000);
  await db.collection("orders").doc(id).set(data);
  return { id, data };
}
async function stored(id: string) { return (await db.collection("orders").doc(id).get()).data()!; }
async function ledgerState() {
  return Promise.all(["cagnotteWallets", "cagnotteAccruals", "cagnotteMovements"].map(async (name) =>
    (await db.collection(name).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }))));
}
async function route(body: Record<string, unknown>, identity: VerifiedFirebaseUser | Error = admin, options: { method?: string; bearer?: string } = {}) {
  let businessTransactions = 0, verifications = 0, effects = 0;
  const checkedDb = new Proxy(db, { get(target, key) {
    if (key === "runTransaction") return (...args: Parameters<Firestore["runTransaction"]>) => { businessTransactions++; return target.runTransaction(...args); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const handler = createOrderStatusHandler({
    getDb: () => checkedDb,
    verifyToken: async () => { verifications++; if (identity instanceof Error) throw identity; return identity; },
    sendStatusEmail: async () => { effects++; return { status: "skipped", reason: "synthetic" }; },
    processAnalytics: async () => { effects++; return { status: "skipped" }; },
  });
  let status = 0, payload: unknown;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { payload = value; } };
  await handler({ method: options.method || "POST", headers: options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}, body } as VercelRequestLike, response as VercelResponseLike);
  return { status, payload, businessTransactions, verifications, effects };
}

try {
  equal(CAGNOTTE_SERVER_PROGRAM, null);
  await db.collection("adminUsers").doc(admin.uid).set({ isActive: true });
  await db.collection("adminUsers").doc("verified-fallback@example.test").set({ isActive: true });
  await db.collection("adminUsers").doc("inactive-security").set({ isActive: false });
  await db.collection("adminUsers").doc("truthy-security").set({ isActive: "yes" });
  await db.collection("customers").doc("self-admin").set({ role: "admin", isAdmin: true, email: admin.email, uid: admin.uid });
  await db.collection("products").doc("security-product").set({ stock: 1000, price: 10, name: "Synthetic", isActive: true, category: "flowers", slug: "synthetic" });
  for (const [name, body, identity, status] of [
    ["sans authentification", {}, admin, 401],
    ["verification jeton en echec", { authToken: "invalid-synthetic" }, new Error("synthetic token failure"), 400],
    ["identite valide non admin", { authToken: "valid-synthetic" }, { uid: "customer-only", email: "customer@example.test", emailVerified: true }, 403],
    ["profil auto-declare admin sans autorite", { authToken: "valid-synthetic", uid: admin.uid, email: admin.email, role: "admin", isAdmin: true, admin }, { uid: "self-admin", email: "self@example.test", emailVerified: true }, 403],
    ["email non verifie refuse", { authToken: "valid-synthetic" }, { uid: "unverified", email: "verified-fallback@example.test", emailVerified: false }, 403],
    ["isActive non booleen refuse", { authToken: "valid-synthetic" }, { uid: "truthy-security", email: null }, 403],
    ["registre UID inactif conserve sa priorite", { authToken: "valid-synthetic" }, { uid: "inactive-security", email: "verified-fallback@example.test", emailVerified: true }, 403],
  ] as const) {
    await test("Autorisation HTTP", name, async () => {
      const f = await fixture(); const before = await stored(f.id);
      const result = await route({ orderId: f.id, ...paid, ...body }, identity);
      equal(result.status, status); equal(result.businessTransactions, 0); equal(result.effects, 0);
      equal(result.verifications, "authToken" in body ? 1 : 0); deepStrictEqual(await stored(f.id), before);
    });
  }
  await test("Autorisation HTTP", "methode refusee avant verification", async () => {
    const result = await route({ authToken: "synthetic", orderId: "unused" }, admin, { method: "GET" });
    equal(result.status, 405); equal(result.verifications, 0); equal(result.businessTransactions, 0);
  });
  for (const fallback of [false, true]) await test("Autorisation HTTP", `admin ${fallback ? "email verifie" : "UID"} transition reelle`, async () => {
    const f = await fixture();
    const identity = fallback ? { uid: "verified-fallback", email: "verified-fallback@example.test", emailVerified: true } : admin;
    const result = await route({ orderId: f.id, ...paid }, identity, { bearer: "synthetic" });
    equal(result.status, 200); equal(result.businessTransactions, 1); equal(result.verifications, 1);
    equal((await stored(f.id)).paymentStatus, "paid");
  });
  await test("Autorisation HTTP", "verificateur en echec sans lecture de registre", async () => {
    const forbiddenDb = { collection() { throw new Error("Registry must not be read"); } } as unknown as Firestore;
    await rejects(assertAdminUser(forbiddenDb, "synthetic", async () => { throw new Error("expected verification failure"); }), /expected verification failure/);
  });
  await test("Champs serveur", "mise a jour admin limitee aux champs autorises", async () => {
    const f = await fixture({ enrollment: true }); const before = await stored(f.id); const ledgerBefore = await ledgerState();
    const result = await route({ orderId: f.id, authToken: "synthetic", internalNote: "allowed",
      customerId: "attacker", beneficiaryId: "attacker", id: "redirect", items: [], total: 0,
      cagnotte: null, "cagnotte.snapshot.loyaltyCents": 999999, programVersion: "forged", cagnotteProgram: program, isAdmin: true });
    equal(result.status, 200);
    const after = await stored(f.id); equal(after.internalNote, "allowed"); equal(after.customerId, before.customerId);
    equal(after.total, before.total); deepStrictEqual(after.items, before.items); deepStrictEqual(after.cagnotte, before.cagnotte);
    equal(after.id, undefined); equal(after.beneficiaryId, undefined); equal(after.programVersion, undefined);
    deepStrictEqual(await ledgerState(), ledgerBefore);
  });
  await test("Champs serveur", "champ id contradictoire : reference, journal et effets restent canoniques", async () => {
    const target = await fixture(); const targetBefore = await stored(target.id);
    const f = await fixture({ enrollment: true, overrides: { id: target.id } });
    const committed = await commitOrderStatusTransition({ db, body: { orderId: f.id, ...paid, orderStatus: "delivered" }, admin, program, now });
    equal(committed.updatedOrder!.id, f.id); deepStrictEqual(await stored(target.id), targetBefore);
    equal((await stored(f.id)).paymentStatus, "paid"); equal((await stored(f.id)).orderStatus, "delivered");
    const wallet = (await db.collection("cagnotteWallets").doc(String(f.data.customerId)).get()).data()!;
    equal(wallet.availableCents, 500); equal(wallet.pendingCents, 0);
    const moves = await db.collection("cagnotteMovements").where("orderId", "==", f.id).get(); equal(moves.size, 3);
    equal((await db.collection("cagnotteAccruals").doc(target.id).get()).exists, false);
    equal(orderFromSnapshot({ id: "reference", data: () => ({ id: "stored-conflict" }) }).id, "reference");
  });
  await test("Creation", "identite verifiee partagee et echec memorise", async () => {
    let calls = 0; const resolver = createCheckoutIdentityResolver("synthetic", async () => { calls++; return { uid: "verified-customer", email: null }; });
    deepStrictEqual(await Promise.all([resolver(), resolver(), resolver()]), ["verified-customer", "verified-customer", "verified-customer"]); equal(calls, 1);
    equal(await createCheckoutIdentityResolver(undefined, async () => { throw new Error("Guest verification forbidden"); })(), undefined);
    const failed = createCheckoutIdentityResolver("invalid", async () => { throw new Error("verification failed"); });
    await rejects(failed(), /verification failed/); await rejects(failed(), /verification failed/);
  });
  await test("Creation", "corps forge sans autorite sur la commande et son inscription", async () => {
    const raw = { checkoutRequestId: "11111111-1111-4111-8111-111111111111", authToken: "synthetic", customerId: admin.uid,
      cagnotte: { beneficiaryId: "attacker", snapshot: { loyaltyCents: 999999 } }, total: 0, role: "admin", isAdmin: true,
      items: [{ productId: "security-product", quantity: 10 }], deliveryMethod: "postal", complianceAccepted: true,
      preferredPaymentMethod: "card_payment_link", customer: { firstName: "Synthetic", lastName: "Customer", email: "synthetic@example.test", phone: "0600000000", address: { firstName: "Synthetic", lastName: "Customer", line1: "1 rue de Test", postalCode: "75001", city: "Paris", country: "FR" } } };
    const body = parseCheckoutBody(raw); const priced = await priceCheckout(db, body);
    const verifiedUid = createCheckoutIdentityResolver(body.authToken, async () => ({ uid: "verified-checkout-customer", email: null }));
    const input = { db, body, priced, checkoutRequestId: body.checkoutRequestId!, payloadFingerprint: checkoutPayloadFingerprint(body), customerId: await verifiedUid(), orderId: "security-checkout", cagnotteProgram: program, nowEpochMs: 2000 };
    await commitCheckoutOrder(input); const result = await stored(input.orderId) as unknown as Order;
    equal(result.customerId, "verified-checkout-customer"); equal(result.cagnotte!.beneficiaryId, result.customerId);
    equal(result.cagnotte!.snapshot.loyaltyCents, 500); equal(result.total, priced.total);
    equal((await db.collection("cagnotteWallets").doc(result.customerId!).get()).exists, false);
  });
  for (const value of [null, {}, false, "invalid"]) await test("Inscription malformee", `cle presente ${JSON.stringify(value)}`, async () => {
    const f = await fixture({ overrides: { cagnotte: value } }); const before = await stored(f.id);
    equal(hasCagnotteEnrollment(before), true);
    const result = await route({ orderId: f.id, ...paid, authToken: "synthetic" });
    equal(result.status, 409); deepStrictEqual(await stored(f.id), before);
  });
  for (const state of ["sans gain", "gain annule", "gain zero"]) await test("Conservation", `suppression HTTP refusee ${state}`, async () => {
    const f = await fixture({ enrollment: true, ...(state === "gain zero" ? { overrides: { items: [], subtotal: 0, total: 0 } } : {}) });
    if (state !== "sans gain") await commitOrderStatusTransition({ db, body: { orderId: f.id, ...paid, orderStatus: "delivered" }, admin, program, now });
    await commitOrderStatusTransition({ db, body: { orderId: f.id, ...cancelled }, admin, program, now });
    const before = await stored(f.id); const ledger = await ledgerState();
    const result = await route({ orderId: f.id, deleteCancelled: true, authToken: "synthetic", cagnotte: null });
    equal(result.status, 400); ok(JSON.stringify(result.payload).includes("tracabilite"));
    deepStrictEqual(await stored(f.id), before); deepStrictEqual(await ledgerState(), ledger);
  });
  for (const value of [null, {}, false, "invalid"]) await test("Conservation", `suppression malformee ${JSON.stringify(value)}`, async () => {
    const f = await fixture({ overrides: { cagnotte: value, ...cancelled, stockRestoredAt: now() } });
    await rejects(commitOrderStatusTransition({ db, body: { orderId: f.id, deleteCancelled: true }, admin }), /tracabilite/);
    equal((await db.collection("orders").doc(f.id).get()).exists, true);
  });
  await test("Conservation", "suppression ordinaire et gardes historiques preserves", async () => {
    for (const overrides of [{}, { ...cancelled }, { ...cancelled, stockRestoredAt: now(), invoiceId: "linked" }, { ...cancelled, stockRestoredAt: now(), invoiceNumber: "linked" }]) {
      const f = await fixture({ overrides });
      await rejects(commitOrderStatusTransition({ db, body: { orderId: f.id, deleteCancelled: true }, admin }));
      equal((await db.collection("orders").doc(f.id).get()).exists, true);
    }
    const invoiced = await fixture({ overrides: { ...cancelled, stockRestoredAt: now(), id: "contradictory-invoice-query" } });
    await db.collection("invoices").doc("security-linked-invoice").set({ orderId: invoiced.id });
    await rejects(commitOrderStatusTransition({ db, body: { orderId: invoiced.id, deleteCancelled: true }, admin }), /facture/);
    const f = await fixture({ overrides: { ...cancelled, stockRestoredAt: now() } });
    const response = await route({ orderId: f.id, deleteCancelled: true, authToken: "synthetic" }); equal(response.status, 200);
    equal((await db.collection("orders").doc(f.id).get()).exists, false);
  });
  await test("Conservation", "controle sur la relecture transactionnelle de suppression", async () => {
    const f = await fixture({ overrides: { ...cancelled, stockRestoredAt: now() } });
    const outside = await stored(f.id); equal(hasCagnotteEnrollment(outside), false);
    // Enrollment occurs after the outside lookup but before the deleting transaction reads.
    const checked = new Proxy(db, { get(target, key) {
      if (key === "runTransaction") return async (run: (tx: Transaction) => Promise<unknown>) => {
        await target.collection("orders").doc(f.id).update({ cagnotte: null }); return target.runTransaction(run);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    await rejects(commitOrderStatusTransition({ db: checked, body: { orderId: f.id, deleteCancelled: true }, admin }), /tracabilite/);
    equal((await db.collection("orders").doc(f.id).get()).exists, true);
  });
  await test("Conservation", "purge maintenance relit et refuse atomiquement un groupe inscrit", async () => {
    const ordinary = await fixture({ overrides: cancelled }); const enrolled = await fixture({ overrides: cancelled });
    const selectedIds = [ordinary.id, enrolled.id];
    await db.collection("orders").doc(enrolled.id).update({ cagnotte: null });
    let audit = 0;
    await rejects(deleteUnenrolledOrderCandidates({ db, orderIds: selectedIds, writeAudit() { audit++; } }), /tracabilite/);
    equal(audit, 0); equal((await db.collection("orders").doc(ordinary.id).get()).exists, true);
    equal((await db.collection("orders").doc(enrolled.id).get()).exists, true);
    await deleteUnenrolledOrderCandidates({ db, orderIds: [ordinary.id], writeAudit(tx, ref) { tx.set(db.collection("adminAuditLogs").doc("security-cleanup"), { orderId: ref.id }); } });
    equal((await db.collection("orders").doc(ordinary.id).get()).exists, false);
    equal((await db.collection("adminAuditLogs").doc("security-cleanup").get()).data()!.orderId, ordinary.id);
  });
  const link = (orderId: string): PaymentLinkDeliveryRequest => ({ orderId, paymentLinkRequestId: "22222222-2222-4222-8222-222222222222", intent: "initial", paymentLinkUrl: "https://example.test/payment", paymentLinkLabel: "Synthetic", paymentLinkAmount: 100, paymentLinkCurrency: "EUR", channel: "email" });
  for (const value of ["valid", null, {}]) await test("Autre transition", `lien paiement valide ou refuse selon inscription ${JSON.stringify(value)}`, async () => {
    const f = await fixture(value === "valid" ? { enrollment: true } : { overrides: { cagnotte: value } });
    const before = await stored(f.id); let sends = 0;
    const delivery = executePaymentLinkDelivery({ db, request: link(f.id), admin, send: async () => { sends++; return { status: "sent", id: "synthetic" }; } });
    if (value === "valid") {
      equal((await delivery).status, "sent"); equal(sends, 1);
      equal((await stored(f.id)).paymentStatus, "payment_link_sent");
      equal((await db.collection("cagnotteAccruals").where("orderId", "==", f.id).get()).size, 0);
      return;
    }
    await rejects(delivery, /cagnotte_order_invalid/);
    equal(sends, 0); deepStrictEqual(await stored(f.id), before);
    equal((await db.collection("paymentLinkRequests").where("orderId", "==", f.id).get()).size, 0);
  });
  await test("Autre transition", "lien paiement recontrole au retour du fournisseur simule", async () => {
    const f = await fixture();
    const result = await executePaymentLinkDelivery({ db, request: link(f.id), admin, send: async () => {
      await db.collection("orders").doc(f.id).update({ cagnotte: null }); return { status: "sent", id: "synthetic" };
    } });
    equal(result.status, "unknown"); equal(result.transportStatus, "accepted");
    equal(result.errorCode, "cagnotte_order_invalid_after_provider_call");
    equal((await stored(f.id)).paymentStatus, "to_confirm");
  });
  console.table(Object.fromEntries(counts));
  console.log(`Sécurité serveur : ${[...counts.values()].reduce((a, b) => a + b, 0)} cas réussis. Jetons et livraisons simulés ; transactions Firestore réelles, règles candidates chargées.`);
} finally { await db.terminate(); }
