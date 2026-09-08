import { deepStrictEqual, equal, ok, rejects, throws } from "node:assert/strict";
import net from "node:net";
import dns from "node:dns";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { expectBlockedNetwork } from "./cagnotteNetworkGuard.js";
import { CAGNOTTE_DEMO, connectCagnotteEmulator } from "./cagnotteEmulator.js";
import { commitCheckoutOrder } from "../api/_server/checkoutOrder.js";
import { orderPayload, parseCheckoutBody, priceCheckout } from "../api/_server/checkout.js";
import { checkoutPayloadFingerprint, findCheckoutRequest } from "../api/_server/orderSideEffects.js";
import { commitOrderStatusTransition, processOrderStatusTransitionEffects, type OrderStatusChange } from "../api/_server/orderStatusTransition.js";
import { buildCagnotteOrderEnrollment, cagnotteCalculationForPricedCheckout, eurosToCagnotteCents } from "../api/_server/cagnotteOrders.js";
import {
  CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID,
  CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION,
  CAGNOTTE_PRODUCTION_PROGRAM_VERSION,
  CAGNOTTE_SERVER_PROGRAM,
  CagnotteProgramConfigurationError,
  resolveCagnotteProductionProgram,
  resolveCagnotteProductionReservationProgram,
} from "../api/_server/cagnotteProgram.js";
import type { CagnotteAccrualProgram, CagnotteProductionProgram, CagnotteTestProgram, CagnotteWallet } from "../api/_server/cagnotteLedgerTypes.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import type { Order } from "../src/types/index.js";
import { fixtureSpentGain, assertWalletJournal } from "./cagnotteRegularizationFixtures.js";

const categories = new Map<string, number>();
async function test(category: string, name: string, run: () => void | Promise<void>) {
  await run(); categories.set(category, (categories.get(category) || 0) + 1);
  console.log(`OK [${category}] ${name}`);
}
const program: CagnotteTestProgram = { mode: "local_test", programVersion: "cagnotte-orders-test-v1", calculationVersion: "cagnotte-math-v1", startsAtEpochMs: 123_000, newAccrualsEnabled: true };
const admin = { uid: "fixture-admin", email: "admin@example.test" };
const rawDb = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const monitor = { denyCagnotte: false, failBeforeCommit: false, transactionsChecked: 0, accesses: [] as string[] };
// Instrument the REAL Firestore transaction, not a second implementation or memory double.
const db = new Proxy(rawDb, {
  get(target, key) {
    if (key === "collection") return (name: string) => {
      monitor.accesses.push(name);
      if (monitor.denyCagnotte && name.startsWith("cagnotte")) throw new Error("Forbidden cagnotte access on ordinary order.");
      return target.collection(name);
    };
    if (key === "runTransaction") return (run: (transaction: Transaction) => Promise<unknown>) => target.runTransaction(async (tx) => {
      let wrote = false; monitor.transactionsChecked += 1;
      const checked = new Proxy(tx, { get(transaction, method) {
        const value = Reflect.get(transaction, method);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (method === "get" || method === "getAll") equal(wrote, false, "Read after first write.");
          if (["set", "update", "create", "delete"].includes(String(method))) wrote = true;
          return Reflect.apply(value, transaction, args);
        };
      } });
      const result = await run(checked);
      if (monitor.failBeforeCommit) throw new Error("Fixture forced failure before commit.");
      return result;
    });
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as Firestore;

let sequence = 0;
async function create(options: { active?: boolean; guest?: boolean; promotion?: "code" | "automatic" | "gift"; catalogPromotion?: boolean; fixed?: boolean; beneficiary?: string; forged?: boolean; nowEpochMs?: number; accrualProgram?: CagnotteAccrualProgram; firebaseProjectId?: string } = {}) {
  const n = ++sequence;
  const productId = `product-${n}`; const giftId = `gift-${n}`; const couponId = `offer-${n}`;
  await rawDb.collection("products").doc(productId).set({
    name: `Synthetic product ${n}`, price: 10, stock: 1_000, isActive: true, category: "flowers", cultureType: "indoor", slug: productId,
    ...(options.fixed ? { fixedPriceMode: "manual", fixedPriceOptions: [{ id: "pack", totalPrice: 19.99, quantityGrams: 3, isActive: true }] } : {}),
  });
  if (options.promotion || options.catalogPromotion) {
    await rawDb.collection("coupons").doc(couponId).set({
      code: couponId.toUpperCase(), label: "Synthetic offer", isActive: true, usedCount: 0,
      minimumOrder: options.catalogPromotion ? 1_000 : 0,
      autoApply: options.catalogPromotion || options.promotion !== "code",
      discountType: "fixed", discountValue: options.promotion === "gift" ? 0 : 5,
      ...(options.promotion === "gift" ? { promotionType: "tiered_product_gift", giftProductIds: [giftId],
        productIds: [productId], giftTiers: [{ id: "tier-50", minimumSubtotal: 50, quantityGrams: 5 }], stackable: false } : {}),
    });
  }
  if (options.promotion === "gift") await rawDb.collection("products").doc(giftId).set({ name: "Synthetic gift", slug: giftId, price: 2, stock: 100, isActive: true, category: "flowers" });
  const requestId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const body = parseCheckoutBody({
    checkoutRequestId: requestId,
    items: [{ productId, quantity: options.fixed ? 2 : 10, ...(options.fixed ? { purchaseMode: "fixed_price", fixedPriceOptionId: "pack" } : {}), ...(options.forged ? { unitPrice: 0, lineTotal: 0 } : {}) }],
    deliveryMethod: "postal", complianceAccepted: true, preferredPaymentMethod: "card_payment_link",
    customer: { firstName: "Synthetic", lastName: "Customer", email: "customer@example.test", phone: "0600000000",
      address: { firstName: "Synthetic", lastName: "Customer", line1: "1 rue de Test", postalCode: "75001", city: "Paris", country: "FR" } },
    ...(options.promotion === "code" ? { couponCode: couponId } : {}),
    ...(options.promotion === "gift" ? { promotionSelections: [{ promotionId: couponId, giftProductId: giftId }] } : {}),
    ...(options.forged ? { customerId: "attacker", total: 0, cagnotte: { beneficiaryId: "attacker", snapshot: { loyaltyCents: 999999 } }, cagnotteProgram: program, VITE_CAGNOTTE_ENABLED: true } : {}),
  });
  const priced = await priceCheckout(db, body);
  const input = { db, body, priced, customerId: options.guest ? undefined : options.beneficiary || `customer-${n}`,
    checkoutRequestId: requestId, payloadFingerprint: checkoutPayloadFingerprint(body), orderId: `order-${n}`,
    ...(options.active ? { accrualProgram: options.accrualProgram ?? program, nowEpochMs: options.nowEpochMs ?? 124_000,
      ...(options.firebaseProjectId ? { firebaseProjectId: options.firebaseProjectId } : {}) } : {}),
  };
  const result = await commitCheckoutOrder(input);
  if (options.promotion || options.catalogPromotion) await rawDb.collection("coupons").doc(couponId).update({ isActive: false });
  return { id: result.orderId, input, productId, giftId, couponId };
}
type Fixture = Awaited<ReturnType<typeof create>>;
async function stored(f: Fixture) { return { id: f.id, ...(await rawDb.collection("orders").doc(f.id).get()).data() } as Order; }
async function balances(f: Fixture) {
  const snapshot = await rawDb.collection("cagnotteWallets").doc(f.input.customerId!).get();
  const wallet = snapshot.data() as CagnotteWallet | undefined;
  return [wallet?.pendingCents || 0, wallet?.availableCents || 0];
}
async function movements(f: Fixture) { return (await rawDb.collection("cagnotteMovements").where("orderId", "==", f.id).get()).docs.map((doc) => doc.data()); }
async function change(f: Fixture, body: Omit<OrderStatusChange, "orderId">, config: CagnotteAccrualProgram | null = program, firebaseProjectId?: string) {
  return commitOrderStatusTransition({ db, body: { orderId: f.id, ...body }, admin, accrualProgram: config,
    reservationProgram: null, firebaseProjectId, now: () => "2000-01-01T00:00:00.000Z" });
}
const paid = { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } as const;
const delivered = { orderStatus: "delivered" } as const;
const cancelled = { orderStatus: "cancelled" } as const;
async function dump() {
  return Promise.all(["orders", "products", "coupons", "invoices", "stockMovements", "checkoutRequests", "orderSideEffects", "analyticsOutbox", "cagnotteWallets", "cagnotteAccruals", "cagnotteMovements"].map(async (name) => {
    const snapshot = await rawDb.collection(name).get(); return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }));
}
async function failsAtomically(run: () => Promise<unknown>, pattern?: RegExp) {
  const before = await dump();
  if (pattern) await rejects(run(), pattern); else await rejects(run());
  deepStrictEqual(await dump(), before);
}

try {
  await test("Isolation", "reseau sortant et metadonnees refuses avant connexion", () => {
    expectBlockedNetwork(() => {
      throws(() => new net.Socket().connect({ host: "169.254.169.254", port: 80 }), /TEST_NETWORK_BLOCKED/);
      throws(() => new net.Socket().connect({ host: "127.0.0.1", port: 443 }), /TEST_NETWORK_BLOCKED/);
      throws(() => dns.lookup("firestore.googleapis.com", () => undefined), /TEST_NETWORK_BLOCKED/);
      throws(() => dns.resolve4("metadata.google.internal", () => undefined), /TEST_NETWORK_BLOCKED/);
    });
  });
  await test("Unitaire", "conversion decimale centralisee et rejets", () => {
    deepStrictEqual([0, 0.1 + 0.2, 1.01, 19.99, 39.98, 100].map(eurosToCagnotteCents), [0, 30, 101, 1999, 3998, 10000]);
    for (const value of [-1, "1", NaN, Infinity, 1.005, 0.001, 100_000_000_000_000]) throws(() => eurosToCagnotteCents(value));
    equal(CAGNOTTE_SERVER_PROGRAM, null);
    equal(buildCagnotteOrderEnrollment({ items: "legacy data" }, "verified"), undefined);
  });
  for (const guest of [false, true]) for (const promotion of ["code", "automatic", "gift"] as const) {
    await test("Desactive", `${guest ? "invite" : "connecte"}, ${promotion} : aucun acces cagnotte`, async () => {
      monitor.denyCagnotte = true;
      try {
        const f = await create({ guest, promotion, forged: true });
        const initial = await stored(f);
        equal(initial.cagnotte, undefined); equal(initial.subtotal, 100);
        equal(initial.discountAmount, promotion === "gift" ? 0 : 5);
        equal(initial.items.some((item) => item.isGift), promotion === "gift");
        if (promotion === "gift") equal(initial.items.find((item) => item.isGift)!.lineTotal, 0);
        await change(f, { ...paid, ...delivered }, null); await change(f, cancelled, null); await change(f, cancelled, null);
        equal((await rawDb.collection("products").doc(f.productId).get()).data()?.stock, 1000);
        equal((await rawDb.collection("coupons").doc(f.couponId).get()).data()?.usedCount, 0);
        if (promotion === "gift") equal((await rawDb.collection("products").doc(f.giftId).get()).data()?.stock, 100);
      } finally { monitor.denyCagnotte = false; }
    });
  }
  await test("Creation", "instantane serveur, falsifications ignorees, aucun gain cree", async () => {
    const f = await create({ active: true, forged: true }); const result = await stored(f);
    equal(result.customerId, f.input.customerId); equal(result.cagnotte!.beneficiaryId, f.input.customerId);
    equal(result.cagnotte!.snapshot.productsPaidCents, 10000); equal(result.cagnotte!.snapshot.loyaltyCents, 500);
    equal(result.cagnotte!.snapshot.appliedCagnotteCents, 0);
    equal((await rawDb.collection("cagnotteWallets").doc(f.input.customerId!).get()).exists, false);
    equal((await movements(f)).length, 0);
  });
  await test("Creation", "fixture activee : invite sans inscription", async () => {
    const f = await create({ active: true, guest: true }); equal((await stored(f)).cagnotte, undefined);
  });
  await test("Production inerte", "definition sans date et entrees normales nulles", () => {
    equal(CAGNOTTE_SERVER_PROGRAM, null);
    equal(Object.hasOwn(CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION, "startsAtEpochMs"), false);
    equal(Object.isFrozen(CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION), true);
    equal(CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION.programVersion, "cagnotte-commercial-policy-v1");
    equal(resolveCagnotteProductionProgram({ runtimeEnvironment: "preview", mode: "off" }), null);
    equal(resolveCagnotteProductionReservationProgram({ runtimeEnvironment: "local", mode: "off" }), null);
  });
  await test("Production inerte", "preview local date absente mode inconnu et projet divergent echouent fermes", () => {
    const valid = { startsAtEpochMs: 123_000, firebaseProjectId: CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID };
    throws(() => resolveCagnotteProductionProgram({ runtimeEnvironment: "preview", mode: "accrue", ...valid }), CagnotteProgramConfigurationError);
    throws(() => resolveCagnotteProductionProgram({ runtimeEnvironment: "local", mode: "drain", ...valid }), CagnotteProgramConfigurationError);
    throws(() => resolveCagnotteProductionProgram({ runtimeEnvironment: "production", mode: "accrue", firebaseProjectId: CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID }), CagnotteProgramConfigurationError);
    throws(() => resolveCagnotteProductionProgram({ runtimeEnvironment: "production", mode: "accrue", startsAtEpochMs: 123_000, firebaseProjectId: "other-project" }), CagnotteProgramConfigurationError);
    throws(() => resolveCagnotteProductionProgram({ runtimeEnvironment: "production", mode: "unknown" as never, ...valid }), CagnotteProgramConfigurationError);
  });
  await test("Creation", "startsAt exclut avant, inclut exactement et apres", async () => {
    const before = await create({ active: true, nowEpochMs: 122_999 });
    const exact = await create({ active: true, nowEpochMs: 123_000 });
    const after = await create({ active: true, nowEpochMs: 123_001 });
    equal((await stored(before)).cagnotte, undefined);
    equal((await stored(exact)).cagnotte?.createdAtEpochMs, 123_000);
    equal((await stored(after)).cagnotte?.createdAtEpochMs, 123_001);
  });
  await test("Creation", "commande avant lancement payee apres reste historique", async () => {
    const f = await create({ active: true, nowEpochMs: 122_999 });
    await change(f, { ...paid, ...delivered }, program);
    equal((await stored(f)).cagnotte, undefined);
    equal((await movements(f)).length, 0);
  });
  await test("Production inerte", "acquisition 5 pourcent fonctionne sans programme de reservation", async () => {
    const active: CagnotteProductionProgram = resolveCagnotteProductionProgram({
      runtimeEnvironment: "production",
      mode: "accrue",
      startsAtEpochMs: 123_000,
      firebaseProjectId: CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID,
    })!;
    equal(active.programVersion, CAGNOTTE_PRODUCTION_PROGRAM_VERSION);
    const f = await create({ active: true, accrualProgram: active, firebaseProjectId: CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID });
    const order = await stored(f);
    equal(order.cagnotte?.accrualEnrollment, "enrolled");
    equal(order.cagnotte?.snapshot.loyaltyCents, 500);
    equal((await rawDb.collection("cagnotteReservations").where("orderId", "==", f.id).get()).size, 0);
    const drain = resolveCagnotteProductionProgram({ runtimeEnvironment: "production", mode: "drain",
      startsAtEpochMs: 123_000, firebaseProjectId: CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID })!;
    equal(buildCagnotteOrderEnrollment({}, "new-customer", drain, 124_000, CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID), undefined);
    await change(f, paid, drain, CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID);
    deepStrictEqual(await balances(f), [500, 0]);
    await change(f, delivered, drain, CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID);
    deepStrictEqual(await balances(f), [0, 500]);
  });
  await test("Creation", "format fixe exact et livraison hors base", async () => {
    const f = await create({ active: true, fixed: true }); const result = await stored(f);
    equal(result.items[0].lineTotal, 39.98); equal(result.cagnotte!.snapshot.productsPaidCents, 3998);
    equal(result.cagnotte!.snapshot.loyaltyCents, 200);
    equal(result.cagnotte!.snapshot.compatibility.status, "allowed");
    equal(eurosToCagnotteCents(result.total), 3998 + eurosToCagnotteCents(result.deliveryFee));
  });
  for (const promotion of ["code", "automatic", "gift"] as const) {
    await test("Creation", `${promotion} : avantage appliqué, gain conservé et utilisation bloquée`, async () => {
      const f = await create({ active: true, promotion }); const result = await stored(f);
      const pricedPromotions = JSON.stringify(f.input.priced.appliedPromotions);
      const pricedItems = JSON.stringify(f.input.priced.orderItems);
      const refusedUse = calculateCagnotte(cagnotteCalculationForPricedCheckout(f.input.priced, 800, 2_000));
      equal(result.cagnotte!.snapshot.discountCents, promotion === "gift" ? 0 : 500);
      equal(result.cagnotte!.snapshot.loyaltyCents, promotion === "gift" ? 500 : 475);
      equal(result.cagnotte!.snapshot.compatibility.status, "blocked");
      equal(refusedUse.appliedCagnotteCents, 0);
      equal(refusedUse.loyaltyCents, promotion === "gift" ? 500 : 475);
      equal(JSON.stringify(f.input.priced.appliedPromotions), pricedPromotions);
      equal(JSON.stringify(f.input.priced.orderItems), pricedItems);
      deepStrictEqual(result.cagnotte!.snapshot.compatibility.blockingAdvantages, [
        promotion === "code" ? "promotion_code" : promotion === "automatic" ? "automatic_promotion" : "promotional_gift",
      ]);
      if (promotion === "gift") {
        equal(result.appliedPromotions![0].giftProductId, f.giftId);
        equal(result.appliedPromotions![0].giftTierId, "tier-50");
        equal(result.cagnotte!.snapshot.lines.find((line) => line.isGift)!.netCents, 0);
      }
    });
  }
  await test("Creation", "promotion automatique appliquée sans remise produits : base intacte et utilisation bloquée", async () => {
    const f = await create();
    const snapshot = calculateCagnotte(cagnotteCalculationForPricedCheckout({
      ...f.input.priced,
      promoApplied: true,
      appliedPromotions: [{
        id: "synthetic-applied-delivery-offer",
        label: "Synthetic applied delivery offer",
        type: "free_shipping",
        applicationMode: "automatic",
        discountAmount: 0,
      }],
    }, 800, 2_000));
    equal(snapshot.productsPaidCents, 10_000);
    equal(snapshot.loyaltyCents, 500);
    equal(snapshot.appliedCagnotteCents, 0);
    equal(snapshot.compatibility.status, "blocked");
    deepStrictEqual(snapshot.compatibility.blockingAdvantages, ["automatic_promotion"]);
  });
  await test("Creation", "prix concours réellement appliqué : gain conservé et utilisation bloquée", async () => {
    const f = await create({ active: true, promotion: "code" });
    const contestPriced = { ...f.input.priced, contestPrizeId: "synthetic-contest-prize" };
    const payload = orderPayload(f.input.body, contestPriced, f.input.customerId);
    equal(payload.contestPrizeId, "synthetic-contest-prize");
    const snapshot = buildCagnotteOrderEnrollment(payload, f.input.customerId, program, 124_000)!.snapshot;
    equal(snapshot.discountCents, 500);
    equal(snapshot.loyaltyCents, 475);
    equal(snapshot.compatibility.status, "blocked");
    deepStrictEqual(snapshot.compatibility.blockingAdvantages, ["contest_prize"]);
  });
  await test("Creation", "promotion seulement présente au catalogue : aucun blocage induit", async () => {
    const f = await create({ active: true, catalogPromotion: true });
    const result = await stored(f);
    equal(result.discountAmount, 0);
    equal(result.appliedPromotions?.length || 0, 0);
    equal(result.cagnotte!.snapshot.compatibility.status, "allowed");
    equal(result.cagnotte!.snapshot.loyaltyCents, 500);
  });
  await test("Creation", "reprise conserve l'original malgre config/prix modifies", async () => {
    const f = await create({ active: true }); const before = await stored(f);
    const result = await commitCheckoutOrder({ ...f.input, accrualProgram: null, priced: { ...f.input.priced, total: 999 } });
    equal(result.created, false); deepStrictEqual(await stored(f), before);
    const found = await findCheckoutRequest(db, f.input.checkoutRequestId, f.input.payloadFingerprint, async () => f.input.customerId);
    equal(found?.orderId, f.id);
  });
  await test("Creation", "reprise par autre identite refusee dans les deux chemins", async () => {
    const f = await create({ active: true });
    await failsAtomically(() => commitCheckoutOrder({ ...f.input, customerId: "attacker" }));
    await rejects(findCheckoutRequest(db, f.input.checkoutRequestId, f.input.payloadFingerprint, async () => "attacker"));
    await rejects(findCheckoutRequest(db, f.input.checkoutRequestId, f.input.payloadFingerprint));
  });
  await test("Creation", "ancienne tentative non inscrite conserve son contrat", async () => {
    const f = await create(); const before = await stored(f);
    equal((await commitCheckoutOrder({ ...f.input, customerId: "other", accrualProgram: program })).created, false);
    deepStrictEqual(await stored(f), before);
    monitor.denyCagnotte = true;
    try { await change(f, paid); } finally { monitor.denyCagnotte = false; }
    equal((await stored(f)).cagnotte, undefined);
  });
  await test("Creation", "empreinte de selection cadeau preservee lors des reprises", async () => {
    const f = await create({ active: true, promotion: "gift" });
    const changedBody = { ...f.input.body, promotionSelections: [{ promotionId: f.couponId, giftProductId: "different-gift" }] };
    const changedFingerprint = checkoutPayloadFingerprint(changedBody);
    ok(changedFingerprint !== f.input.payloadFingerprint);
    await failsAtomically(() => commitCheckoutOrder({ ...f.input, body: changedBody, payloadFingerprint: changedFingerprint }));
  });
  const example = await create({ active: true });
  const cycle: { step: string; orderStatus: string; paymentStatus: string; pending: number; available: number; movements: number }[] = [];
  async function capture(step: string) { const o = await stored(example); const [pending, available] = await balances(example); cycle.push({ step, orderStatus: o.orderStatus, paymentStatus: o.paymentStatus, pending, available, movements: (await movements(example)).length }); }
  await test("Cycle", "creation puis paiement puis livraison", async () => {
    await capture("creation"); await change(example, paid); await capture("paiement"); deepStrictEqual(await balances(example), [500, 0]);
    await change(example, delivered); await capture("livraison"); deepStrictEqual(await balances(example), [0, 500]);
  });
  await test("Cycle", "livraison avant paiement", async () => {
    const f = await create({ active: true }); await change(f, delivered); deepStrictEqual(await balances(f), [0, 0]);
    await change(f, paid); deepStrictEqual(await balances(f), [0, 500]); equal((await movements(f)).length, 3);
  });
  await test("Cycle", "paiement et livraison en une requete", async () => {
    const f = await create({ active: true }); await change(f, { ...paid, ...delivered });
    deepStrictEqual(await balances(f), [0, 500]); equal((await movements(f)).length, 3);
    equal((await movements(f)).filter((m) => m.businessEvent === "payment_confirmed").length, 1);
  });
  await test("Cycle", "confirmation combinee apres livraison seule", async () => {
    const f = await create({ active: true }); await change(f, delivered); await change(f, { ...paid, ...delivered });
    deepStrictEqual(await balances(f), [0, 500]); equal((await movements(f)).length, 3);
  });
  await test("Cycle", "repetitions et aller-retour de statut sans nouveau gain", async () => {
    const before = await movements(example);
    await change(example, { ...paid, ...delivered }); await change(example, { orderStatus: "preparing", paymentStatus: "pending" });
    await change(example, { ...paid, ...delivered }); deepStrictEqual(await movements(example), before); deepStrictEqual(await balances(example), [0, 500]);
  });
  await test("Cycle", "deux confirmations simultanees", async () => {
    const f = await create({ active: true }); await Promise.all([change(f, { ...paid, ...delivered }), change(f, { ...paid, ...delivered })]);
    deepStrictEqual(await balances(f), [0, 500]); equal((await movements(f)).length, 3);
  });
  await test("Cycle", "deux commandes simultanees du meme beneficiaire", async () => {
    const first = await create({ active: true, beneficiary: "shared-order-customer" }); const second = await create({ active: true, beneficiary: "shared-order-customer" });
    await Promise.all([change(first, { ...paid, ...delivered }), change(second, { ...paid, ...delivered })]);
    deepStrictEqual(await balances(first), [0, 1000]);
  });
  await test("Cycle", "suspension apres attribution : finalisation puis neutralisation", async () => {
    const f = await create({ active: true }); await change(f, paid); await change(f, delivered, null); deepStrictEqual(await balances(f), [0, 500]);
    await change(f, cancelled, null); deepStrictEqual(await balances(f), [0, 0]);
  });
  await test("Cycle", "drain avant attribution : la commande inscrite termine son gain", async () => {
    const f = await create({ active: true });
    await change(f, { ...paid, ...delivered }, { ...program, newAccrualsEnabled: false });
    deepStrictEqual(await balances(f), [0, 500]); equal((await movements(f)).length, 3);
  });
  await test("Cycle", "lien de paiement et facture payee ne creditent pas le gain", async () => {
    const f = await create({ active: true });
    await rawDb.collection("invoices").doc(`invoice-${f.id}`).set({ orderId: f.id, status: "paid" });
    await change(f, { paymentLinkSent: true, paymentLinkUrl: "https://example.invalid/payment" });
    deepStrictEqual(await balances(f), [0, 0]); equal((await movements(f)).length, 0);
  });
  await test("Cycle", "bloc cagnotte falsifie dans la transition ignore", async () => {
    const f = await create({ active: true });
    const forged = { ...paid, ...delivered, customerId: "attacker", cagnotte: { beneficiaryId: "attacker", snapshot: { loyaltyCents: 999999 } } };
    await change(f, forged); deepStrictEqual(await balances(f), [0, 500]);
    equal((await stored(f)).cagnotte!.beneficiaryId, f.input.customerId);
  });
  await test("Annulation", "exemple apres disponibilite", async () => {
    await change(example, cancelled); await capture("annulation"); deepStrictEqual(await balances(example), [0, 0]);
  });
  for (const afterPayment of [false, true]) {
    await test("Annulation", afterPayment ? "gain en attente" : "avant paiement et confirmation tardive", async () => {
      const f = await create({ active: true }); if (afterPayment) await change(f, paid);
      await change(f, cancelled); deepStrictEqual(await balances(f), [0, 0]);
      await failsAtomically(() => change(f, paid), /réactivée/);
    });
  }
  await test("Annulation", "stock, coupon et facture restaures/annules une fois", async () => {
    const f = await create({ active: true, promotion: "code" }); await change(f, { ...paid, ...delivered });
    const invoiceId = `invoice-${f.id}`;
    await rawDb.collection("invoices").doc(invoiceId).set({ orderId: f.id, status: "draft" });
    await rawDb.collection("orders").doc(f.id).update({ invoiceId });
    await change(f, cancelled);
    const before = await movements(f); const stockCount = (await rawDb.collection("stockMovements").where("orderId", "==", f.id).get()).size;
    await change(f, cancelled); deepStrictEqual(await movements(f), before);
    equal((await rawDb.collection("products").doc(f.productId).get()).data()?.stock, 1000);
    equal((await rawDb.collection("coupons").doc(f.couponId).get()).data()?.usedCount, 0);
    equal((await rawDb.collection("invoices").doc(invoiceId).get()).data()?.status, "cancelled");
    equal((await rawDb.collection("stockMovements").where("orderId", "==", f.id).get()).size, stockCount);
  });
  await test("Atomicite", "paiement et annulation concurrents", async () => {
    const f = await create({ active: true }); const results = await Promise.allSettled([change(f, paid), change(f, cancelled)]);
    equal(results[1].status, "fulfilled"); const o = await stored(f);
    equal(o.orderStatus, "cancelled"); equal(o.paymentStatus, "cancelled"); deepStrictEqual(await balances(f), [0, 0]);
    await failsAtomically(() => change(f, { ...paid, ...delivered }));
  });
  await test("Atomicite", "echec avant commit de creation", async () => {
    const f = await create({ active: true });
    monitor.failBeforeCommit = true;
    try { await failsAtomically(() => commitCheckoutOrder({ ...f.input, checkoutRequestId: "99999999-0000-4000-8000-000000000000", orderId: "failed-creation" })); }
    finally { monitor.failBeforeCommit = false; }
  });
  await test("Atomicite", "echec avant commit de confirmation combinee", async () => {
    const f = await create({ active: true }); monitor.failBeforeCommit = true;
    try { await failsAtomically(() => change(f, { ...paid, ...delivered }), /forced failure/); } finally { monitor.failBeforeCommit = false; }
  });
  await test("Atomicite", "gain depense : annulation atomique et regularisation, stock et cadeau restaures une fois", async () => {
    const f = await create({ active: true, promotion: "gift" }); await change(f, { ...paid, ...delivered });
    await fixtureSpentGain(rawDb, f.input.customerId!, f.id, 500, program.programVersion);
    monitor.failBeforeCommit = true;
    try { await failsAtomically(() => change(f, cancelled), /forced failure/); } finally { monitor.failBeforeCommit = false; }
    await change(f, cancelled); await change(f, cancelled);
    const o = await stored(f); equal(o.orderStatus, "cancelled"); equal(o.paymentStatus, "cancelled");
    deepStrictEqual(await balances(f), [0, 0]);
    equal((await rawDb.collection("cagnotteWallets").doc(f.input.customerId!).get()).data()!.regularizationCents, 500);
    equal((await rawDb.collection("products").doc(f.productId).get()).data()!.stock, 1000);
    equal((await rawDb.collection("products").doc(f.giftId).get()).data()!.stock, 100);
    equal((await rawDb.collection("coupons").doc(f.couponId).get()).data()!.usedCount, 0);
    equal((await rawDb.collection("cagnotteAccruals").doc(f.id).get()).data()!.remainingGainCents, 0);
    await assertWalletJournal(rawDb, f.input.customerId!);
  });
  await test("Atomicite", "methode finale requise et inscription incoherente refusees", async () => {
    const f = await create({ active: true }); await failsAtomically(() => change(f, { paymentStatus: "paid" }), /Methode/);
    await rawDb.collection("orders").doc(f.id).update({ customerId: "tampered" });
    await failsAtomically(() => change(f, paid), /incohérente/);
  });
  await test("Effets", "echec apres commit puis reprise sans duplication du gain", async () => {
    const f = await create({ active: true }); const body = { orderId: f.id, ...paid, ...delivered };
    const committed = await change(f, body);
    await rejects(processOrderStatusTransitionEffects({ db, body, committed,
      sendStatusEmail: async () => { throw new Error("Synthetic email failure."); },
      processAnalytics: async () => { throw new Error("Unexpected analytics effect."); },
    }), /Synthetic email/);
    deepStrictEqual(await balances(f), [0, 500]); const before = await movements(f);
    const retried = await change(f, body);
    await processOrderStatusTransitionEffects({ db, body, committed: retried,
      sendStatusEmail: async () => { throw new Error("Repeated status email should not run."); },
      processAnalytics: async () => ({ status: "skipped" }),
    });
    deepStrictEqual(await movements(f), before);
  });
  await test("Conservation", "chaque portefeuille correspond au journal", async () => {
    const wallets = await rawDb.collection("cagnotteWallets").get(); const journal = await rawDb.collection("cagnotteMovements").get();
    for (const doc of wallets.docs) {
      const entries = journal.docs.map((m) => m.data()).filter((m) => m.beneficiaryId === doc.id);
      equal(doc.data().pendingCents, entries.reduce((sum, m) => sum + m.pendingDeltaCents, 0));
      equal(doc.data().availableCents, entries.reduce((sum, m) => sum + m.availableDeltaCents, 0));
      await assertWalletJournal(rawDb, doc.id);
    }
    ok(monitor.transactionsChecked > 0);
    console.log(`Transactions reelles controlees (rejeux inclus) : ${monitor.transactionsChecked}; aucune lecture apres ecriture.`);
  });
  console.table(cycle);
  console.table(Object.fromEntries(categories));
  console.log(`LOT 2B : ${[...categories.values()].reduce((a, b) => a + b, 0)} cas reussis.`);
} finally { await rawDb.terminate(); }
