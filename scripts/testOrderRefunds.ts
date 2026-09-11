import { deepStrictEqual as eq, equal, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { connectCagnotteEmulator, CAGNOTTE_DEMO } from "./cagnotteEmulator.js";
import { createOrderRefundHandler, handleOrderRefund } from "../api/_server/orderRefundRoute.js";
import { ORDER_REFUNDS_ENABLED, type OrderRefundOperationalLog } from "../api/_server/orderRefunds.js";
import { CAGNOTTE_SERVER_PROGRAM } from "../api/_server/cagnotteProgram.js";
import { commitOrderStatusTransition, type OrderStatusChange } from "../api/_server/orderStatusTransition.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { fixtureSpentGain, assertWalletJournal } from "./cagnotteRegularizationFixtures.js";
import { applyCagnotteLedgerOperation, validateCagnotteLedgerMovementForRead } from "../api/_server/cagnotteLedger.js";
import { applyCagnotteReservationOperation, createCagnotteReservationIntent } from "../api/_server/cagnotteReservations.js";
import type { CagnotteReservationTestProgram } from "../api/_server/cagnotteReservationTypes.js";
import type { CagnotteTestProgram } from "../api/_server/cagnotteLedgerTypes.js";
import type { VerifiedFirebaseUser } from "../api/_server/adminAuth.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import { readUnpaidOrderContext } from "../api/_server/unpaidOrderReview.js";

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const actor: VerifiedFirebaseUser = { uid: "refund-admin", email: "refund-admin@example.test", emailVerified: true };
const program: CagnotteReservationTestProgram = { mode: "local_test", programVersion: "refund-fixture-v1", calculationVersion: "cagnotte-math-v1", startsAtEpochMs: 1000,
  reservationVersion: "cagnotte-reservation-v1", reservationsEnabled: true };
const accrualProgram: CagnotteTestProgram = { mode: "local_test", programVersion: program.programVersion,
  calculationVersion: program.calculationVersion, startsAtEpochMs: program.startsAtEpochMs, newAccrualsEnabled: true };
const clock = () => "2000-01-03T00:00:00.000Z";
const confirmDate = "2000-01-02T00:00:00.000Z";
const paid = { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" } as const;
let seq = 0, tests = 0;
async function test(name: string, run: () => Promise<unknown>) { try { await run(); tests++; console.log(`OK [Remboursements 4C] ${name}`); } catch (error) { console.error(`FAIL ${name}`); throw error; } }
async function captureWarnings<T>(run: () => Promise<T>) {
  const warnings: string[] = [];
  const previous = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try { return { result: await run(), warnings }; }
  finally { console.warn = previous; }
}
async function fundWallet(uid: string, amountCents: number, orderId: string) {
  const snapshot = calculateCagnotte({ lines: [{ lineId: "funding-line", initialCents: amountCents * 20 }], discounts: [],
    requestedCagnotteCents: 0, availableCagnotteCents: 0, advantages: [] });
  equal(snapshot.loyaltyCents, amountCents);
  await applyCagnotteLedgerOperation({ db, program: accrualProgram, command: { event: "payment_and_delivery_confirmed", order: {
    orderId, beneficiaryId: uid, programVersion: program.programVersion, createdAtEpochMs: 2000, snapshot,
  } } });
}
async function fixture(options: { amounts?: number[]; delivery?: number; discount?: number; gift?: boolean; enrolled?: boolean; ready?: boolean; beneficiary?: string;
  usedCagnotteCents?: number; initialWalletCents?: number; paymentProgram?: CagnotteTestProgram | null;
  accrualEnrollment?: "enrolled" | "not_enrolled" } = {}) {
  const id = `refund-order-${++seq}`, uid = options.beneficiary ?? `refund-customer-${seq}`;
  const amounts = options.amounts ?? [10000];
  const lines = amounts.map((initialCents, index) => ({ lineId: `line-${index}`, initialCents }));
  const requestedCagnotteCents = options.usedCagnotteCents ?? 0;
  if (requestedCagnotteCents > 0) {
    const initialWalletCents = options.initialWalletCents ?? 2000;
    if (initialWalletCents > 0) await fundWallet(uid, initialWalletCents, `${id}-funding`);
  }
  const wallet = (await db.collection("cagnotteWallets").doc(uid).get()).data();
  const availableCagnotteCents = wallet?.availableCents ?? 0;
  const snapshot = calculateCagnotte({ lines: [...lines, ...(options.gift ? [{ lineId: "gift", initialCents: 0, isGift: true }] : [])],
    discounts: options.discount ? [{ discountId: "discount", amountCents: options.discount, kind: "automatic_promotion", lineIds: lines.map((l) => l.lineId) }] : [],
    requestedCagnotteCents, availableCagnotteCents, advantages: [] });
  const delivery = options.delivery ?? 0;
  const data: Record<string, unknown> = { customerId: uid, customerName: "Synthetic", customerEmail: "synthetic@example.test",
    orderStatus: "confirmed", paymentStatus: "to_confirm", deliveryMethod: "postal", deliveryFee: delivery / 100,
    subtotal: snapshot.subtotalCents / 100, total: (snapshot.eligibleCents + delivery) / 100,
    ...(snapshot.appliedCagnotteCents > 0 ? { paymentAmount: (snapshot.productsPaidCents + delivery) / 100 } : {}),
    discountAmount: snapshot.discountCents / 100, promotionDiscountTotal: snapshot.discountCents / 100,
    createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z",
    items: snapshot.lines.map((l) => ({ lineId: l.lineId, productId: "refund-product", name: "Synthetic", quantity: 1, unitPrice: l.initialCents / 100, lineTotal: l.initialCents / 100 })),
  };
  if (options.enrolled !== false) data.cagnotte = { schemaVersion: 1, beneficiaryId: uid, programVersion: program.programVersion,
    calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000, snapshot,
    ...(options.accrualEnrollment ? { accrualEnrollment: options.accrualEnrollment } : {}) };
  if (snapshot.appliedCagnotteCents > 0) {
    const intent = createCagnotteReservationIntent({ orderId: id, beneficiaryId: uid, createdAtEpochMs: 2000,
      calculation: { lines: [...lines, ...(options.gift ? [{ lineId: "gift", initialCents: 0, isGift: true as const }] : [])],
        discounts: options.discount ? [{ discountId: "discount", amountCents: options.discount, kind: "automatic_promotion" as const, lineIds: lines.map((l) => l.lineId) }] : [],
        requestedCagnotteCents, availableCagnotteCents, advantages: [] } }, program);
    ok(intent); data.cagnotteReservationIntent = intent;
  }
  await db.collection("orders").doc(id).set(data);
  const f = { id, uid, snapshot, data };
  if (snapshot.appliedCagnotteCents > 0) await applyCagnotteReservationOperation({ db, action: "reserve",
    intent: data.cagnotteReservationIntent as NonNullable<ReturnType<typeof createCagnotteReservationIntent>>, program, recordedAtEpochMs: 2000 });
  const paymentProgram = Object.hasOwn(options, "paymentProgram") ? options.paymentProgram! : accrualProgram;
  if (options.ready !== false) await change(f, { ...paid, orderStatus: "delivered" }, paymentProgram);
  return f;
}
async function lineIdentityFixture(explicitLineIds: boolean) {
  const id = `refund-order-${++seq}`, uid = `refund-customer-${seq}`;
  const calculationLines = explicitLineIds
    ? [{ lineId: "B", initialCents: 2000 }, { lineId: "A", initialCents: 1000 }, { lineId: "gift", initialCents: 0, isGift: true as const }]
    : [{ lineId: "order-line-0", initialCents: 2000 }, { lineId: "order-line-1", initialCents: 1000 }];
  const snapshot = calculateCagnotte({ lines: calculationLines, discounts: [], requestedCagnotteCents: 0, availableCagnotteCents: 0, advantages: [] });
  const items = explicitLineIds
    ? [
      { lineId: "B", productId: "refund-product", name: "Produit B", quantity: 1, unitPrice: 20, lineTotal: 20 },
      { lineId: "A", productId: "refund-product", name: "Produit A", quantity: 1, unitPrice: 10, lineTotal: 10 },
      { lineId: "gift", productId: "refund-product", name: "Cadeau promotionnel", quantity: 1, unitPrice: 0, lineTotal: 0, isGift: true },
    ]
    : [
      { productId: "refund-product", name: "Ligne historique 1", quantity: 1, unitPrice: 20, lineTotal: 20 },
      { productId: "refund-product", name: "Ligne historique 2", quantity: 1, unitPrice: 10, lineTotal: 10 },
    ];
  const data: Record<string, unknown> = {
    customerId: uid, customerName: "Synthetic", customerEmail: "synthetic@example.test",
    orderStatus: "confirmed", paymentStatus: "to_confirm", deliveryMethod: "postal", deliveryFee: 0,
    subtotal: snapshot.subtotalCents / 100, total: snapshot.eligibleCents / 100,
    discountAmount: 0, promotionDiscountTotal: 0,
    createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z", items,
    cagnotte: { schemaVersion: 1, beneficiaryId: uid, programVersion: program.programVersion,
      calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 2000, snapshot },
  };
  await db.collection("orders").doc(id).set(data);
  return { id, uid, snapshot, data };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function rewriteOneMovementSchema(f: Fixture, schemaVersion: 1 | 2 | 3, recordedAtEpochMs?: unknown) {
  const snapshot = await db.collection("cagnotteMovements").where("orderId", "==", f.id).get();
  const document = snapshot.docs[0];
  ok(document, "un mouvement de fixture est requis");
  const movement = { ...document.data(), schemaVersion };
  if (schemaVersion !== 3) {
    delete movement.reservationVersion;
    delete movement.reservedDeltaCents;
  }
  if (schemaVersion === 1) {
    delete movement.regularizationVersion;
    delete movement.regularizationDeltaCents;
  }
  if (recordedAtEpochMs === undefined) delete movement.recordedAtEpochMs;
  else movement.recordedAtEpochMs = recordedAtEpochMs;
  await document.ref.set(movement);
  return document.id;
}
async function rejectMovementMutation(f: Fixture, businessEvent: string, patch: Record<string, unknown>) {
  const snapshot = await db.collection("cagnotteMovements").where("orderId", "==", f.id).get();
  const document = snapshot.docs.find((doc) => doc.data().businessEvent === businessEvent);
  ok(document, `mouvement ${businessEvent} requis`);
  const original = document.data();
  await document.ref.set({ ...original, ...patch });
  try {
    const response = await refused({ action: "inspect", orderId: f.id }, "refund_journal_requires_verification");
    equal(response.stats.writes, 0);
  } finally {
    await document.ref.set(original);
  }
}
async function change(f: Fixture, patch: Omit<OrderStatusChange, "orderId">, config: CagnotteTestProgram | null = accrualProgram) {
  return commitOrderStatusTransition({ db, body: { orderId: f.id, ...patch }, admin: actor,
    accrualProgram: config, reservationProgram: program, now: () => "2000-01-01T00:00:00.000Z" });
}
async function cancelReviewedUnpaid(f: Fixture) {
  const context = await db.runTransaction(async (transaction) => {
    const order = { id: f.id, ...(await transaction.get(db.collection("orders").doc(f.id))).data() } as import("../src/types/index.js").Order;
    return readUnpaidOrderContext({ db, transaction, order, nowEpochMs: Date.parse("2000-01-01T00:00:00.000Z") });
  });
  return change(f, { orderStatus: "cancelled", unpaidReview: { action: "record", outcome: "unpaid_confirmed", source: "fixture locale",
    reason: "Impayé synthétique vérifié", expectedStateVersion: context.stateVersion } }, null);
}
async function stored(f: Fixture) { return (await db.collection("orders").doc(f.id).get()).data()!; }
async function balance(f: Fixture) { const w = (await db.collection("cagnotteWallets").doc(f.uid).get()).data()!; return [w.pendingCents, w.availableCents, w.regularizationCents]; }
async function walletBalance(f: Fixture) { const w = (await db.collection("cagnotteWallets").doc(f.uid).get()).data()!; return [w.pendingCents, w.availableCents, w.reservedCents, w.regularizationCents]; }
async function remaining(f: Fixture) { return (await db.collection("cagnotteAccruals").doc(f.id).get()).data()!.remainingGainCents; }
const collections = ["orders", "products", "coupons", "invoices", "stockMovements", "analyticsOperationalEvents", "orderSideEffects", "cagnotteWallets", "cagnotteAccruals", "cagnotteMovements", "cagnotteReservations", "cagnotteRefunds"];
async function dump() { return Promise.all(collections.map(async (name) => (await db.collection(name).get()).docs.map((d) => ({ id: d.id, ...d.data() })))); }
function selection(f: Fixture, amount = 2500, deliveryRefundCents = 0) {
  return { action: "preview", orderId: f.id, currency: "EUR", additionalReturns: amount ? [{ lineId: "line-0", additionalNetCents: amount }] : [], deliveryRefundCents };
}
type ResponseResult = Awaited<ReturnType<typeof import("../api/_server/orderRefunds.js").executeOrderRefund>>;
type Payload = { code?: string; result?: ResponseResult; bankingOperationExecuted?: boolean; bankingTransferVerified?: boolean };
async function invoke(handler: ReturnType<typeof createOrderRefundHandler>, body: unknown, method = "POST", headers = {}) {
  let status = 0, payload: Payload = {};
  const response = { setHeader() {}, status(code: number) { status = code; return this; }, json(value: Payload) { payload = value; } };
  await handler({ method, body, headers } as VercelRequestLike, response as unknown as VercelResponseLike);
  return { status, ...payload };
}
type Options = { identity?: VerifiedFirebaseUser | Error; noToken?: boolean; enabled?: boolean; fail?: boolean; loseAck?: boolean; before?: () => Promise<void>; betweenAttempts?: () => Promise<void>; logs?: OrderRefundOperationalLog[]; loggerThrows?: boolean };
async function call(body: Record<string, unknown>, options: Options = {}) {
  let transactions = 0, writes = 0, walletWrites = 0, callbacks = 0, verificationCalls = 0;
  const checked = new Proxy(db, { get(target, key) {
    if (key === "runTransaction") return async (run: (tx: Transaction) => Promise<unknown>) => {
      transactions++; await options.before?.(); let abort = Boolean(options.betweenAttempts);
      const callback = async (tx: Transaction) => {
        callbacks++; let wrote = false;
        const wrapped = new Proxy(tx, { get(t, method) {
          const value = Reflect.get(t, method); if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (["get", "getAll"].includes(String(method))) equal(wrote, false, "Read after first write");
            if (["create", "set", "update", "delete"].includes(String(method))) {
              wrote = true; writes++;
              if (typeof (args[0] as { path?: unknown })?.path === "string" && String((args[0] as { path: string }).path).startsWith("cagnotteWallets/")) walletWrites++;
            }
            return Reflect.apply(value, t, args);
          };
        } });
        const result = await run(wrapped);
        if (abort) { abort = false; throw Object.assign(new Error("Synthetic transaction abort"), { code: 10 }); }
        if (options.fail) throw new Error("Synthetic failure before commit");
        return result;
      };
      let result;
      try { result = await target.runTransaction(callback, options.betweenAttempts ? { maxAttempts: 1 } : undefined); }
      catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === 10 && options.betweenAttempts)) throw error;
        await options.betweenAttempts(); result = await target.runTransaction(callback);
      }
      if (options.loseAck) throw new Error("Synthetic acknowledgement lost after commit");
      return result;
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }) as Firestore;
  const handler = createOrderRefundHandler({ enabled: options.enabled ?? true, getDb: () => checked, now: clock,
    verifyToken: async () => { verificationCalls++; if (options.identity instanceof Error) throw options.identity; return options.identity ?? actor; },
    log: (entry) => { options.logs?.push(entry); if (options.loggerThrows) throw new Error("Synthetic logger failure"); } });
  return { ...await invoke(handler, { ...body, ...(options.noToken ? {} : { authToken: "synthetic" }) }), stats: { transactions, writes, walletWrites, callbacks, verificationCalls } };
}
async function preview(body: Record<string, unknown>) { const r = await call(body); equal(r.status, 200, JSON.stringify(r)); equal(r.stats.writes, 0); return r.result!; }
function confirmation(body: Record<string, unknown>, p: ResponseResult, reference: string) {
  return { ...body, action: "record_confirmed", source: "admin", reference, declaredFinancialCents: p.totalFinancialCents,
    reason: "product_return", confirmedAt: confirmDate, expectedPreviewVersion: p.previewVersion };
}
async function record(f: Fixture, amount: number, ref: string, delivery = 0) {
  const body = selection(f, amount, delivery), p = await preview(body), command = confirmation(body, p, ref), r = await call(command);
  equal(r.status, 200, JSON.stringify(r)); return { result: r.result!, command };
}
async function correctionTarget(f: Fixture) {
  const docs = await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get();
  const originals = docs.docs.filter((doc) => doc.data().kind !== "refund_correction").sort((a, b) => b.data().sequence - a.data().sequence);
  ok(originals[0]); return originals[0].id;
}
function correctionSelection(f: Fixture, targetEventId: string, expectedRevision: number, amount: number, declaredFinancialCents: number) {
  return { action: "preview_correction", orderId: f.id, currency: "EUR", targetEventId, expectedRevision,
    replacementReturns: amount ? [{ lineId: "line-0", additionalNetCents: amount }] : [], deliveryRefundCents: 0,
    declaredFinancialCents, correctionReason: "Erreur de saisie vérifiée dans le dossier fictif", externalVerificationConfirmed: true };
}
async function recordCorrection(f: Fixture, targetEventId: string, expectedRevision: number, amount: number, declaredFinancialCents: number, reference: string) {
  const body = correctionSelection(f, targetEventId, expectedRevision, amount, declaredFinancialCents);
  const p = await preview(body);
  const command = { ...body, action: "record_correction", correctionReference: reference, expectedPreviewVersion: p.previewVersion };
  const response = await call(command); equal(response.status, 200, JSON.stringify(response));
  return { result: response.result!, command };
}
async function refused(body: Record<string, unknown>, code?: string, options: Options = {}) {
  const before = await dump(), r = await call(body, options); ok(r.status >= 400, JSON.stringify(r));
  if (code) equal(r.code, code); eq(await dump(), before); return r;
}
function gate() { let release!: () => void; const promise = new Promise<void>((r) => { release = r; }); return { promise, release }; }
function stableHashValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableHashValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableHashValue((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function testHash(value: unknown) { return createHash("sha256").update(stableHashValue(value)).digest("hex"); }
async function expectCorruptHistoryRejectedEverywhere(
  f: Fixture,
  inspectCode: "refund_history_requires_verification" | "refund_journal_requires_verification" = "refund_history_requires_verification",
) {
  await refused({ action: "inspect", orderId: f.id }, inspectCode);
  await refused({
    action: "preview", orderId: f.id, currency: "EUR",
    additionalReturns: [{ lineId: "line-0", additionalNetCents: 100 }], deliveryRefundCents: 0,
  }, "refund_history_requires_verification");
  await refused({
    action: "record_confirmed", orderId: f.id, currency: "EUR",
    additionalReturns: [{ lineId: "line-0", additionalNetCents: 100 }], deliveryRefundCents: 0,
    source: "admin", reference: `h6-chain-${++seq}`, declaredFinancialCents: 100,
    reason: "product_return", confirmedAt: confirmDate, expectedPreviewVersion: "e".repeat(64),
  }, "refund_history_requires_verification");
  const originals = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs
    .filter((doc) => doc.data().kind !== "refund_correction")
    .sort((left, right) => left.data().sequence - right.data().sequence);
  const targetEventId = originals[originals.length - 1]?.id;
  if (!targetEventId) return;
  const correction = correctionSelection(f, targetEventId, 0, 100, 100);
  await refused(correction, "refund_history_requires_verification");
  await refused({ ...correction, action: "record_correction", correctionReference: `h8-chain-${++seq}`,
    expectedPreviewVersion: "f".repeat(64) }, "refund_history_requires_verification");
}

try {
  equal(CAGNOTTE_SERVER_PROGRAM, null); equal(ORDER_REFUNDS_ENABLED, false);
  await db.collection("adminUsers").doc(actor.uid).set({ isActive: true });
  await db.collection("adminUsers").doc("inactive-refund").set({ isActive: false });
  await db.collection("adminUsers").doc("fallback-refund@example.test").set({ isActive: true });
  await db.collection("products").doc("refund-product").set({ name: "Synthetic", stock: 1000, price: 10 });
  await test("entree normale desactivee pour toutes les actions, aucun commutateur HTTP", async () => {
    for (const action of ["preview", "record_confirmed", "inspect", "preview_correction", "record_correction"]) {
      const r = await invoke(handleOrderRefund, { action, enabled: true, authToken: "synthetic", VITE_REFUNDS_ENABLED: true }, "POST", { "x-enable-refunds": "true", host: "localhost" });
      equal(r.status, 503); equal(r.code, "order_refunds_disabled");
    }
    equal((await invoke(handleOrderRefund, {}, "GET")).status, 405);
  });
  await test("preview sans ecriture, evenement ou changement annexe", async () => {
    const f = await fixture(), before = await dump(), p = await preview(selection(f)); eq(await dump(), before);
    equal(p.kind, "refund_preview"); equal(p.totalFinancialCents, 2500); equal(p.correction.theoreticalCents, 125);
    equal(p.recordedAt, undefined);
  });
  await test("100 EUR -> 25 -> 75 et reprises anciennes", async () => {
    const f = await fixture(); const original = await stored(f); const a = await record(f, 2500, "main-25");
    equal(a.result.kind, "administrative_refund_recorded"); equal(a.result.productFinancialCents, 2500); equal(a.result.correction.appliedCents, 125);
    eq(await balance(f), [0, 375, 0]); equal(await remaining(f), 375);
    const b = await record(f, 7500, "main-75"); equal(b.result.correction.appliedCents, 375); eq(await balance(f), [0, 0, 0]); equal(await remaining(f), 0);
    equal(b.result.after.totalFinancialCents, 10000); equal(b.result.entirePaymentRefunded, true);
    const before = await dump(); for (const command of [a.command, b.command]) { const r = await call(command); equal(r.status, 200); equal(r.result!.alreadyRecorded, true); }
    eq(await dump(), before); const current = await stored(f);
    for (const field of ["cagnotte", "items", "total", "paymentStatus", "orderStatus"]) eq(current[field], original[field]);
    equal(JSON.stringify(current.refundSummary).includes("main-"), false); await assertWalletJournal(db, f.uid);
  });
  await test("evenement 2F historique sans champs 4C reste rejouable et cumulable", async () => {
    const f = await fixture(), first = await record(f, 2500, "legacy-2f-shape");
    const eventDoc = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs[0];
    const event = eventDoc.data();
    for (const field of ["returnedProductNetCents", "cagnotteRestitutionCents", "loyaltyAccrualDecision", "restitution"]) delete event.result[field];
    for (const cumul of [event.result.before, event.result.after]) {
      delete cumul.returnedProductNetCents; delete cumul.cagnotteRestitutionCents;
    }
    await eventDoc.ref.set(event);
    const replay = await call(first.command); equal(replay.status, 200, JSON.stringify(replay)); equal(replay.result!.alreadyRecorded, true);
    equal(replay.result!.cagnotteRestitutionCents, 0); equal(replay.result!.returnedProductNetCents, 2500);
    const second = await record(f, 7500, "legacy-2f-rest"); equal(second.result.after.totalFinancialCents, 10000);
  });
  await test("paiement mixte 100 EUR, cagnotte 8 EUR, retours 25 puis 75", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    eq(await walletBalance(f), [0, 1660, 0, 0]);
    const reservationBefore = (await db.collection("cagnotteReservations").doc(f.id).get()).data()!;
    equal(reservationBefore.state, "consumed"); equal(reservationBefore.amountCents, 800);
    const firstSelection = selection(f, 2500), firstPreview = await preview(firstSelection);
    eq({ net: firstPreview.returnedProductNetCents, financial: firstPreview.productFinancialCents,
      wallet: firstPreview.cagnotteRestitutionCents, loyalty: firstPreview.correction.theoreticalCents,
      available: firstPreview.restitution.availableAfterCents }, { net: 2500, financial: 2300, wallet: 200, loyalty: 115, available: 1745 });
    const firstCommand = confirmation(firstSelection, firstPreview, "mixed-main-25");
    const first = await call(firstCommand); equal(first.status, 200, JSON.stringify(first)); equal(first.stats.walletWrites, 1);
    equal(first.result!.correction.remainingGainCents, 345); eq(await walletBalance(f), [0, 1745, 0, 0]);
    const second = await record(f, 7500, "mixed-main-75");
    eq({ financial: second.result.productFinancialCents, wallet: second.result.cagnotteRestitutionCents,
      loyalty: second.result.correction.appliedCents }, { financial: 6900, wallet: 600, loyalty: 345 });
    eq({ financial: second.result.after.productFinancialCents, wallet: second.result.after.cagnotteRestitutionCents,
      net: second.result.after.returnedProductNetCents }, { financial: 9200, wallet: 800, net: 10000 });
    eq(await walletBalance(f), [0, 2000, 0, 0]); equal(second.result.correction.remainingGainCents, 0);
    const reservation = (await db.collection("cagnotteReservations").doc(f.id).get()).data()!;
    equal(reservation.state, "consumed"); equal(reservation.refundProjection.cumulativeRestitutedCents, 800);
    equal(reservation.refundProjection.events.length, 2); ok(reservation.events.consumed); equal(reservation.events.released, undefined);
    const beforeReplay = await dump();
    for (const command of [firstCommand, second.command]) {
      const replay = await call(command); equal(replay.status, 200); equal(replay.result!.alreadyRecorded, true); equal(replay.stats.walletWrites, 0);
    }
    eq(await dump(), beforeReplay); await assertWalletJournal(db, f.uid);
  });
  await test("rejeu mixte apres reutilisation reelle du credit restitue", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    const s = selection(f, 2500), p = await preview(s), command = confirmation(s, p, "mixed-reused");
    const recorded = await call(command); equal(recorded.status, 200); eq(await walletBalance(f), [0, 1745, 0, 0]);
    await fixture({ beneficiary: f.uid, amounts: [10000], usedCagnotteCents: 1745, initialWalletCents: 0, paymentProgram: null });
    eq(await walletBalance(f), [0, 0, 0, 0]); const before = await dump();
    const replay = await call(command); equal(replay.status, 200); equal(replay.result!.alreadyRecorded, true); equal(replay.stats.walletWrites, 0);
    eq(await dump(), before);
  });
  await test("gain mixte depense par une autre consommation : correction, compensation, reliquat", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    const s = selection(f, 2500), p = await preview(s); equal(p.productFinancialCents, 2300);
    equal(p.cagnotteRestitutionCents, 200); equal(p.restitution.compensationCents, 0); equal(p.restitution.availableAfterCents, 1745);
    await fixture({ beneficiary: f.uid, amounts: [10000], usedCagnotteCents: 1660, initialWalletCents: 0, paymentProgram: null });
    eq(await walletBalance(f), [0, 0, 0, 0]);
    const response = await call(confirmation(s, p, "mixed-spent-gain")); equal(response.status, 200, JSON.stringify(response)); const r = { result: response.result! };
    equal(r.result.totalFinancialCents, 2300); equal(r.result.correction.regularizationDeltaCents, 115);
    eq(r.result.restitution, { grossCents: 200, compensationCents: 115, availableIncreaseCents: 85,
      availableAfterCents: 85, cumulativeCents: 200, reservationState: "consumed" });
    eq(await walletBalance(f), [0, 85, 0, 0]); await assertWalletJournal(db, f.uid);
  });
  await test("regularisation d une autre commande compensee sans reduire le financier", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    const otherGain = await fixture({ beneficiary: f.uid, amounts: [10000] });
    await fixture({ beneficiary: f.uid, amounts: [20000], usedCagnotteCents: 2160, initialWalletCents: 0, paymentProgram: null });
    eq(await walletBalance(f), [0, 0, 0, 0]);
    await record(otherGain, 10000, "other-order-regularization"); eq(await walletBalance(f), [0, 0, 0, 500]);
    const beforeOwnRefund = await call({ action: "inspect", orderId: f.id }); equal(beforeOwnRefund.status, 200);
    equal((beforeOwnRefund.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection).operationalState.code, "delivered_available");
    const r = await record(f, 2500, "mixed-other-regularization");
    equal(r.result.productFinancialCents, 2300); equal(r.result.correction.regularizationDeltaCents, 115);
    equal(r.result.restitution.compensationCents, 200); equal(r.result.restitution.availableIncreaseCents, 0);
    eq(await walletBalance(f), [0, 0, 0, 415]);
    const inspected = await call({ action: "inspect", orderId: f.id }); equal(inspected.status, 200);
    equal((inspected.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection).operationalState.code, "refund_recorded");
    const cancelled = await fixture({ beneficiary: f.uid, ready: false }); await change(cancelled, { orderStatus: "cancelled" }, null);
    const notEnrolled = await fixture({ beneficiary: f.uid, ready: false, accrualEnrollment: "not_enrolled" });
    const paymentPending = await fixture({ beneficiary: f.uid, ready: false }); await change(paymentPending, paid);
    for (const [candidate, expected] of [[cancelled, "cancelled"], [notEnrolled, "accrual_not_enrolled"], [paymentPending, "payment_confirmed_pending"]] as const) {
      const response = await call({ action: "inspect", orderId: candidate.id }); equal(response.status, 200);
      const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
      equal(result.operationalState.code, expected); equal(result.wallet?.regularizationCents, 415);
    }
    await assertWalletJournal(db, f.uid);
  });
  await test("gain suspendu : consommation prouvee et restitution sans droit retroactif", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, paymentProgram: null });
    eq(await walletBalance(f), [0, 1200, 0, 0]);
    equal((await stored(f)).cagnottePaymentEvidence.loyaltyAccrualDecision, "not_attributed");
    equal((await db.collection("cagnotteAccruals").doc(f.id).get()).exists, false);
    const r = await record(f, 10000, "mixed-no-gain");
    equal(r.result.loyaltyAccrualDecision, "not_attributed"); equal(r.result.correction.theoreticalCents, 460);
    equal(r.result.correction.appliedCents, 0); equal(r.result.cagnotteRestitutionCents, 800);
    eq(await walletBalance(f), [0, 2000, 0, 0]); equal((await db.collection("cagnotteAccruals").doc(f.id).get()).exists, false);
  });
  await test("annulation apres paiement restitue le consomme sans seconde correction", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await change(f, { orderStatus: "cancelled" }); eq(await walletBalance(f), [0, 1200, 0, 0]);
    const r = await record(f, 10000, "mixed-cancelled-full");
    equal(r.result.correction.theoreticalCents, 460); equal(r.result.correction.appliedCents, 0);
    equal(r.result.restitution.grossCents, 800); eq(await walletBalance(f), [0, 2000, 0, 0]);
  });
  await test("retour partiel, annulation, puis restitution du reste", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "mixed-before-cancel"); await change(f, { orderStatus: "cancelled" });
    eq(await walletBalance(f), [0, 1400, 0, 0]); const r = await record(f, 7500, "mixed-after-cancel");
    equal(r.result.correction.appliedCents, 0); equal(r.result.restitution.grossCents, 600); eq(await walletBalance(f), [0, 2000, 0, 0]);
  });
  await test("gain mixte en attente corrige avant restitution", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, ready: false }); await change(f, paid);
    eq(await walletBalance(f), [460, 1200, 0, 0]); const r = await record(f, 2500, "mixed-pending");
    equal(r.result.correction.pendingDeltaCents, -115); equal(r.result.restitution.availableIncreaseCents, 200);
    eq(await walletBalance(f), [345, 1400, 0, 0]);
  });
  await test("une autre reservation active reste intacte", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    const other = await fixture({ beneficiary: f.uid, amounts: [10000], usedCagnotteCents: 500, initialWalletCents: 0, ready: false });
    eq(await walletBalance(f), [0, 1160, 500, 0]); await record(f, 2500, "mixed-other-reservation");
    eq(await walletBalance(f), [0, 1245, 500, 0]); equal((await db.collection("cagnotteReservations").doc(other.id).get()).data()!.state, "reserved");
  });
  await test("arrondi final avec financier produit nul et restitution positive", async () => {
    const f = await fixture({ amounts: [5], usedCagnotteCents: 1, initialWalletCents: 100 });
    const first = await record(f, 4, "mixed-cent-first"); equal(first.result.productFinancialCents, 4); equal(first.result.cagnotteRestitutionCents, 0);
    const s = selection(f, 1), p = await preview(s); equal(p.productFinancialCents, 0); equal(p.cagnotteRestitutionCents, 1); equal(p.totalFinancialCents, 0);
    const r = await call(confirmation(s, p, "mixed-cent-final")); equal(r.status, 200, JSON.stringify(r)); equal(r.result!.totalFinancialCents, 0);
    equal(r.bankingOperationExecuted, false); eq(await walletBalance(f), [0, 100, 0, 0]);
  });
  await test("retours multi-lignes, remise et cadeau ne forcent pas une cagnotte incompatible", async () => {
    const f = await fixture({ amounts: [6000, 4000], discount: 1000, gift: true, usedCagnotteCents: 800, initialWalletCents: 2000 });
    const firstSelection = { ...selection(f), additionalReturns: [{ lineId: "line-1", additionalNetCents: 1000 }, { lineId: "line-0", additionalNetCents: 2000 }] };
    const first = await call(confirmation(firstSelection, await preview(firstSelection), "mixed-discount-a")); equal(first.status, 200, JSON.stringify(first));
    equal(first.result!.returnedProductNetCents, 3000); equal(first.result!.productFinancialCents + first.result!.cagnotteRestitutionCents, 3000);
    await refused({ ...selection(f), additionalReturns: [{ lineId: "gift", additionalNetCents: 1 }] });
    const secondSelection = { ...selection(f), additionalReturns: [{ lineId: "line-0", additionalNetCents: 3400 }, { lineId: "line-1", additionalNetCents: 2600 }] };
    const second = await call(confirmation(secondSelection, await preview(secondSelection), "mixed-discount-b")); equal(second.status, 200, JSON.stringify(second));
    equal(f.snapshot.appliedCagnotteCents, 0); equal(second.result!.after.returnedProductNetCents, 9000);
    equal(second.result!.after.productFinancialCents, 9000); equal(second.result!.after.cagnotteRestitutionCents, 0);
    equal(second.result!.productsFullyRefunded, true);
  });
  await test("livraison mixte reste separee des produits et de la cagnotte", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, delivery: 600 });
    const deliveryOnly = await record(f, 0, "mixed-delivery-only", 100);
    equal(deliveryOnly.result.productFinancialCents, 0); equal(deliveryOnly.result.cagnotteRestitutionCents, 0);
    equal(deliveryOnly.result.deliveryFinancialCents, 100); equal(deliveryOnly.result.correction.appliedCents, 0);
    const products = await record(f, 10000, "mixed-products-all"); equal(products.result.totalFinancialCents, 9200);
    equal(products.result.productsFullyRefunded, true); equal(products.result.entirePaymentRefunded, false);
    await refused(selection(f, 0, 501), "refund_delivery_exceeds_remaining");
    const rest = await record(f, 0, "mixed-delivery-rest", 500); equal(rest.result.entirePaymentRefunded, true);
    equal(rest.result.after.totalFinancialCents, 9800); equal(rest.result.after.cagnotteRestitutionCents, 800);
  });
  await test("preuve de non-attribution conservee apres annulation", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, paymentProgram: null });
    await change(f, { orderStatus: "cancelled" }, null); const r = await record(f, 10000, "mixed-no-gain-cancelled");
    equal(r.result.loyaltyAccrualDecision, "not_attributed"); equal(r.result.correction.appliedCents, 0);
    equal(r.result.restitution.grossCents, 800); eq(await walletBalance(f), [0, 2000, 0, 0]);
  });
  await test("droit attendu anormalement absent exige verification", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await db.collection("cagnotteAccruals").doc(f.id).delete(); await refused(selection(f), "refund_ledger_requires_verification");
  });
  await test("preuve de paiement mixte absente ou alteree exige verification", async () => {
    const a = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await db.collection("orders").doc(a.id).update({ cagnottePaymentEvidence: FieldValue.delete() });
    await refused(selection(a), "refund_payment_evidence_requires_verification");
    const b = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await db.collection("orders").doc(b.id).update({ "cagnottePaymentEvidence.recordedAt": "2000-01-02T00:00:00.000Z" });
    await refused(selection(b), "refund_payment_evidence_requires_verification");
    const c = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await db.collection("orders").doc(c.id).update({ paymentAmount: 91.99 }); await refused(selection(c), "refund_original_amounts_require_verification");
  });
  await test("reservation consommee absente ou alteree refusee", async () => {
    const a = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await db.collection("cagnotteReservations").doc(a.id).delete(); await refused(selection(a), "refund_reservation_requires_verification");
    const b = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await db.collection("cagnotteReservations").doc(b.id).update({ amountCents: 799 }); await refused(selection(b), "refund_reservation_requires_verification");
  });
  await test("reservations encore reservee ou deja liberee refusees", async () => {
    const reserved = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, ready: false });
    await db.collection("orders").doc(reserved.id).update({ paymentStatus: "paid", finalPaymentMethod: "card_payment_link",
      paidAt: "2000-01-01T00:00:00.000Z", paymentConfirmedAt: "2000-01-01T00:00:00.000Z", paymentConfirmedBy: actor.email,
      cagnottePaymentEvidence: { schemaVersion: 1, version: "cagnotte-payment-evidence-v1", reservationState: "consumed",
        loyaltyAccrualDecision: "not_attributed", loyaltyAccrualReason: "server_program_ineligible", recordedAt: "2000-01-01T00:00:00.000Z" } });
    await refused(selection(reserved), "refund_reservation_requires_verification");
    const released = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, ready: false });
    await cancelReviewedUnpaid(released);
    await db.collection("orders").doc(released.id).update({ finalPaymentMethod: "card_payment_link",
      paidAt: "2000-01-01T00:00:00.000Z", paymentConfirmedAt: "2000-01-01T00:00:00.000Z", paymentConfirmedBy: actor.email,
      cagnottePaymentEvidence: { schemaVersion: 1, version: "cagnotte-payment-evidence-v1", reservationState: "consumed",
        loyaltyAccrualDecision: "not_attributed", loyaltyAccrualReason: "server_program_ineligible", recordedAt: "2000-01-01T00:00:00.000Z" } });
    await refused(selection(released), "refund_reservation_requires_verification");
  });
  await test("projection ou mouvement de restitution altere exige rapprochement", async () => {
    const a = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 }); await record(a, 2500, "mixed-corrupt-projection");
    await db.collection("cagnotteReservations").doc(a.id).update({ "refundProjection.cumulativeRestitutedCents": 199 });
    await refused(selection(a), "refund_reservation_requires_verification");
    const b = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 }); await record(b, 2500, "mixed-corrupt-movement");
    const movement = (await db.collection("cagnotteMovements").where("orderId", "==", b.id).where("businessEvent", "==", "credit_refunded_after_return").get()).docs[0];
    await movement.ref.update({ availableDeltaCents: 199 }); await refused(selection(b), "refund_reservation_requires_verification");
    await movement.ref.update({ availableDeltaCents: 200 });
  });
  await test("deux confirmations mixtes identiques simultanees ne restituent qu une fois", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 }), s = selection(f), c = confirmation(s, await preview(s), "mixed-concurrent-same");
    const release = gate(), entered = gate(); let n = 0; const before = async () => { if (++n === 2) entered.release(); await release.promise; };
    const a = call(c, { before }), b = call(c, { before }); await entered.promise; release.release(); const results = await Promise.all([a, b]);
    eq(results.map((result) => result.status), [200, 200]); equal(results.filter((result) => result.result!.alreadyRecorded).length, 1);
    eq(await walletBalance(f), [0, 1745, 0, 0]);
  });
  await test("deux references mixtes sur la meme preview : conflit puis nouvelle preview", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 }), s = selection(f), p = await preview(s);
    const release = gate(), entered = gate(); let n = 0; const before = async () => { if (++n === 2) entered.release(); await release.promise; };
    const ca = confirmation(s, p, "mixed-concurrent-a"), cb = confirmation(s, p, "mixed-concurrent-b");
    const a = call(ca, { before }), b = call(cb, { before }); await entered.promise; release.release(); const results = await Promise.all([a, b]);
    eq(results.map((result) => result.status).sort(), [200, 409]); equal(results.find((result) => result.status === 409)!.code, "refund_preview_stale");
    const retry = results[0].status === 409 ? ca : cb, fresh = await preview(s);
    equal((await call({ ...retry, expectedPreviewVersion: fresh.previewVersion })).status, 200); eq(await walletBalance(f), [0, 1830, 0, 0]);
  });
  await test("echec mixte avant commit annule evenement restitution et portefeuille", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 }), s = selection(f), c = confirmation(s, await preview(s), "mixed-rollback");
    await refused(c, undefined, { fail: true });
  });
  await test("gain depense fictivement : 125 puis 500 de regularisation, financier 10000", async () => {
    const f = await fixture(); await fixtureSpentGain(db, f.uid, f.id, 500, program.programVersion);
    const a = await record(f, 2500, "spent-25"); equal(a.result.correction.regularizationDeltaCents, 125); eq(await balance(f), [0, 0, 125]);
    const b = await record(f, 7500, "spent-75"); eq(await balance(f), [0, 0, 500]); equal(b.result.after.totalFinancialCents, 10000); await assertWalletJournal(db, f.uid);
  });
  for (const [name, identity, noToken, code] of [
    ["visiteur", actor, true, "admin_token_required"], ["jeton invalide", new Error("Token Firebase invalide."), false, "admin_token_invalid"],
    ["client", { uid: "ordinary", email: "ordinary@example.test", emailVerified: true }, false, "admin_required"],
    ["email non verifie", { uid: "unverified", email: "fallback-refund@example.test", emailVerified: false }, false, "admin_required"],
    ["UID inactif prioritaire", { uid: "inactive-refund", email: "fallback-refund@example.test", emailVerified: true }, false, "admin_required"],
  ] as const) await test(`autorisation ${name}`, async () => { const f = await fixture(); const r = await refused(selection(f), code, { identity, noToken }); equal(r.stats.transactions, 0); });
  await test("administrateur reconnu via email verifie", async () => {
    const f = await fixture(); equal((await call(selection(f), { identity: { uid: "fallback", email: "fallback-refund@example.test", emailVerified: true } })).status, 200);
  });
  for (const forged of [{ role: "admin" }, { actor: { uid: "forged" } }, { beneficiaryId: "other" }, { id: "other" }, { bankStatement: "forbidden" }, { quantityGrams: 1 }]) await test(`contrat strict refuse ${Object.keys(forged)[0]}`, async () => {
    const f = await fixture(); await refused({ ...selection(f), ...forged }, "refund_unexpected_field");
  });
  await test("identifiant stocke contradictoire ne redirige pas", async () => {
    const decoy = await fixture(), f = await fixture(); await db.collection("orders").doc(f.id).update({ id: decoy.id });
    const before = await stored(decoy); const r = await record(f, 2500, "canonical"); equal(r.result.orderId, f.id); eq(await stored(decoy), before);
  });
  for (const [name, patch] of [["impayee", {}], ["facture payee", { invoicePaymentStatus: "paid" }], ["lien envoye", { paymentStatus: "payment_link_sent", paymentLinkSent: true }], ["statut paid seul", { paymentStatus: "paid" }]] as const) await test(`preuve paiement manquante : ${name}`, async () => {
    const f = await fixture({ ready: false }); if (Object.keys(patch).length) await db.collection("orders").doc(f.id).update(patch); await refused(selection(f), "refund_prior_payment_requires_verification");
  });
  await test("presence seule de gain ne prouve pas le paiement", async () => {
    const f = await fixture(); await db.collection("orders").doc(f.id).update({ paymentConfirmedAt: FieldValue.delete() }); await refused(selection(f), "refund_prior_payment_requires_verification");
  });
  await test("historique non inscrit refuse inspect refund et correction sans ecriture", async () => {
    const f = await fixture({ enrolled: false });
    for (const request of [selection(f), { action: "inspect", orderId: f.id }, correctionSelection(f, "a".repeat(64), 0, 0, 0)]) {
      await refused(request, "refund_historical_order_not_supported");
    }
  });
  for (const malformed of [null, {}, { snapshot: { appliedCagnotteCents: 1 } }]) await test(`inscription invalide ou mixte ${JSON.stringify(malformed)}`, async () => {
    const f = await fixture(); await db.collection("orders").doc(f.id).update({ cagnotte: malformed }); await refused(selection(f), "refund_enrollment_invalid");
  });
  await test("beneficiaire et instantane falsifies refuses", async () => {
    const f = await fixture(); const data = await stored(f); await db.collection("orders").doc(f.id).update({ "cagnotte.beneficiaryId": "forged" }); await refused(selection(f), "refund_enrollment_invalid");
    await db.collection("orders").doc(f.id).update({ cagnotte: data.cagnotte, "customerId": f.uid });
    await db.collection("orders").doc(f.id).update({ "cagnotte.snapshot.loyaltyCents": 999 }); await refused(selection(f), "refund_enrollment_invalid");
  });
  await test("paiement pendant suspension sans droit : verification sans rattrapage", async () => {
    const f = await fixture({ ready: false }); await change(f, paid, null); await refused(selection(f), "refund_ledger_requires_verification");
  });
  await test("payee puis annulee, pas de deuxieme retrait", async () => {
    const f = await fixture(); await change(f, { orderStatus: "cancelled" }); const before = await balance(f);
    const r = await record(f, 10000, "cancelled-paid"); equal(r.result.correction.appliedCents, 0); equal(r.result.correction.theoreticalCents, 500); eq(await balance(f), before); equal((await stored(f)).paymentStatus, "cancelled");
  });
  await test("retour partiel puis annulation du seul gain restant", async () => {
    const f = await fixture(); await record(f, 2500, "before-cancel"); await change(f, { orderStatus: "cancelled" }); eq(await balance(f), [0, 0, 0]); await assertWalletJournal(db, f.uid);
  });
  await test("retour avant livraison puis disponibilite du reste", async () => {
    const f = await fixture({ ready: false }); await change(f, paid); const r = await record(f, 2500, "pending-return"); equal(r.result.correction.pendingDeltaCents, -125);
    eq(await balance(f), [375, 0, 0]); await change(f, { orderStatus: "delivered" }); eq(await balance(f), [0, 375, 0]);
  });
  await test("correction en suspension et droit ayant compense une regularisation", async () => {
    const a = await fixture(); await fixtureSpentGain(db, a.uid, a.id, 500, program.programVersion); await change(a, { orderStatus: "cancelled" }, null);
    const b = await fixture({ beneficiary: a.uid }); eq(await balance(b), [0, 0, 0]);
    const r = await record(b, 2500, "compensated-return"); equal(r.result.correction.regularizationDeltaCents, 125); eq(await balance(b), [0, 0, 125]); await assertWalletJournal(db, b.uid);
  });
  await test("livraison seule, produits puis reste livraison : perimetres distincts", async () => {
    const f = await fixture({ delivery: 600 }); const a = await record(f, 0, "delivery-only", 100); equal(a.result.correction.appliedCents, 0); eq(await balance(f), [0, 500, 0]);
    const b = await record(f, 10000, "all-products"); equal(b.result.productsFullyRefunded, true); equal(b.result.entirePaymentRefunded, false);
    await refused(selection(f, 0, 501), "refund_delivery_exceeds_remaining");
    const c = await record(f, 0, "delivery-rest", 500); equal(c.result.entirePaymentRefunded, true); equal(c.result.after.totalFinancialCents, 10600);
  });
  await test("remises reparties, cadeau nul, cumuls complets multi-lignes", async () => {
    const f = await fixture({ amounts: [6000, 4000], discount: 1000, gift: true });
    await refused({ ...selection(f), additionalReturns: [{ lineId: "gift", additionalNetCents: 1 }] });
    const first = { ...selection(f), additionalReturns: [{ lineId: "line-1", additionalNetCents: 1000 }, { lineId: "line-0", additionalNetCents: 2000 }] };
    const a = await call(confirmation(first, await preview(first), "discount-a")); equal(a.status, 200); equal(a.result!.totalFinancialCents, 3000);
    const b = await record(f, 3400, "discount-b"); eq(b.result.after.lines, [{ lineId: "gift", returnedNetCents: 0 }, { lineId: "line-0", returnedNetCents: 5400 }, { lineId: "line-1", returnedNetCents: 1000 }]);
    await refused(selection(f, 1));
    const last = { ...selection(f), additionalReturns: [{ lineId: "line-1", additionalNetCents: 2600 }] };
    equal((await call(confirmation(last, await preview(last), "discount-c"))).status, 200); eq(await balance(f), [0, 0, 0]);
  });
  await test("demi-centimes : recalcul global apres chaque retour", async () => {
    const f = await fixture({ amounts: [10, 10] }); equal(await remaining(f), 1);
    const a = await record(f, 10, "rounding-a"); equal(a.result.correction.appliedCents, 0);
    const b = { ...selection(f), additionalReturns: [{ lineId: "line-1", additionalNetCents: 10 }] };
    const r = await call(confirmation(b, await preview(b), "rounding-b")); equal(r.status, 200); equal(r.result!.correction.appliedCents, 1); equal(await remaining(f), 0);
  });
  await test("reponse perdue apres commit, acteur et dates serveur, reponse filtree", async () => {
    const f = await fixture(), s = selection(f), c = confirmation(s, await preview(s), "lost-response");
    await call(c, { loseAck: true }); const before = await dump(); const retry = await call({ ...c, reference: " LOST-RESPONSE " });
    equal(retry.status, 200); equal(retry.result!.alreadyRecorded, true); eq(await dump(), before);
    const event = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs[0].data();
    equal(event.actor.uid, actor.uid); equal(event.recordedAt, clock()); equal(event.confirmedAt, confirmDate);
    const serialized = JSON.stringify(retry); for (const secret of [actor.email!, f.uid, "lost-response", "fingerprint", "movementIds"]) equal(serialized.includes(secret), false);
    equal(retry.bankingOperationExecuted, false); equal(retry.bankingTransferVerified, false);
  });
  await test("meme reference avec autre contenu ou commande : conflits", async () => {
    const f = await fixture(), g = await fixture(), a = await record(f, 2500, "global-reference");
    await refused({ ...a.command, reason: "order_cancellation" }, "refund_event_conflict");
    await refused({ ...a.command, orderId: g.id }, "refund_event_conflict");
    await refused({ ...a.command, additionalReturns: [{ lineId: "line-0", additionalNetCents: 2000 }] }, "refund_event_conflict");
  });
  await test("deux confirmations simultanees du meme evenement", async () => {
    const f = await fixture(), s = selection(f), c = confirmation(s, await preview(s), "concurrent-same"); const release = gate(), entered = gate(); let n = 0;
    const before = async () => { if (++n === 2) entered.release(); await release.promise; };
    const a = call(c, { before }), b = call(c, { before }); await entered.promise; release.release(); const results = await Promise.all([a, b]);
    eq(results.map((r) => r.status), [200, 200]); equal(results.filter((r) => r.result!.alreadyRecorded).length, 1); eq(await balance(f), [0, 375, 0]);
  });
  await test("deux references pour meme version : conflit puis nouvelle preview", async () => {
    const f = await fixture(), s = selection(f), p = await preview(s), release = gate(), entered = gate(); let n = 0;
    const before = async () => { if (++n === 2) entered.release(); await release.promise; };
    const ca = confirmation(s, p, "concurrent-a"), cb = confirmation(s, p, "concurrent-b");
    const a = call(ca, { before }), b = call(cb, { before }); await entered.promise; release.release(); const results = await Promise.all([a, b]);
    eq(results.map((r) => r.status).sort(), [200, 409]); equal(results.find((r) => r.status === 409)!.code, "refund_preview_stale");
    const retry = results[0].status === 409 ? ca : cb; const fresh = await preview(s);
    equal((await call({ ...retry, expectedPreviewVersion: fresh.previewVersion })).status, 200); eq(await balance(f), [0, 250, 0]);
  });
  await test("retry exact stale ne peut pas apparaitre apres un remboursement concurrent", async () => {
    const f = await fixture();
    const body = selection(f, 2500);
    const stale = confirmation(body, await preview(body), "h8-stale-refund");
    const response = await call(stale, { betweenAttempts: async () => {
      await record(f, 1000, "h8-competing-refund");
    } });
    equal(response.status, 409, JSON.stringify(response));
    equal(response.code, "refund_preview_stale");
    equal(response.stats.callbacks, 2);
    const events = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs.map((doc) => doc.data());
    equal(events.some((event) => event.reference === "h8-stale-refund"), false);
    equal(events.filter((event) => event.reference === "h8-competing-refund").length, 1);
  });
  await test("retry exact stale ne peut pas apparaitre apres une correction concurrente", async () => {
    const f = await fixture();
    await record(f, 2500, "h8-correction-original");
    const target = await correctionTarget(f);
    const body = correctionSelection(f, target, 0, 1000, 1000);
    const stale = { ...body, action: "record_correction", correctionReference: "h8-stale-correction",
      expectedPreviewVersion: (await preview(body)).previewVersion };
    const response = await call(stale, { betweenAttempts: async () => {
      await recordCorrection(f, target, 0, 1500, 1500, "h8-competing-correction");
    } });
    equal(response.status, 409, JSON.stringify(response));
    equal(response.code, "correction_preview_stale");
    equal(response.stats.callbacks, 2);
    const events = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs.map((doc) => doc.data());
    equal(events.some((event) => event.correctionReference === "h8-stale-correction"), false);
    equal(events.filter((event) => event.correctionReference === "h8-competing-correction").length, 1);
  });
  for (const event of ["delivered", "cancelled"] as const) await test(`callback avorte puis ${event} entre lectures et commit, plan recalcule`, async () => {
    const f = await fixture({ ready: false }); await change(f, paid); const s = selection(f), c = confirmation(s, await preview(s), `race-${event}`);
    const r = await call(c, { betweenAttempts: async () => { await change(f, { orderStatus: event }); } });
    equal(r.status, 200, JSON.stringify(r)); equal(r.stats.callbacks, 2); equal(r.result!.totalFinancialCents, 2500);
    eq(await balance(f), event === "delivered" ? [0, 375, 0] : [0, 0, 0]); equal(r.result!.correction.appliedCents, event === "delivered" ? 125 : 0); await assertWalletJournal(db, f.uid);
  });
  await test("variation portefeuille apres preview : financier stable, regularisation recalculee", async () => {
    const f = await fixture(), s = selection(f), p = await preview(s); equal(p.correction.availableDeltaCents, -125);
    await fixtureSpentGain(db, f.uid, f.id, 500, program.programVersion);
    const r = await call(confirmation(s, p, "wallet-changed")); equal(r.status, 200); equal(r.result!.totalFinancialCents, p.totalFinancialCents); equal(r.result!.correction.regularizationDeltaCents, 125);
  });
  for (const invalid of [{ additionalReturns: [{ lineId: "unknown", additionalNetCents: 1 }] }, { additionalReturns: [{ lineId: "line-0", additionalNetCents: 10001 }] },
    { additionalReturns: [{ lineId: "line-0", additionalNetCents: -1 }] }, { additionalReturns: [{ lineId: "line-0", additionalNetCents: 0.5 }] },
    { additionalReturns: [{ lineId: "line-0", additionalNetCents: 1 }, { lineId: "line-0", additionalNetCents: 2 }] }, { deliveryRefundCents: Number.MAX_SAFE_INTEGER + 1 }, { currency: "USD" }]) await test(`validation sans ecriture ${tests}`, async () => {
    const f = await fixture(); await refused({ ...selection(f), ...invalid });
  });
  await test("date valide acceptee, dates future ancienne ou mal formee refusees", async () => {
    const f = await fixture(), s = selection(f), c = confirmation(s, await preview(s), "bad-amount");
    await refused({ ...c, declaredFinancialCents: 2499 }, "refund_declared_amount_requires_verification");
    await refused({ ...c, confirmedAt: "2001-01-01T00:00:00.000Z" }, "refund_confirmation_date_invalid");
    await refused({ ...c, confirmedAt: "1999-12-31T23:59:59.000Z" }, "refund_confirmation_date_invalid");
    await refused({ ...c, confirmedAt: "02/01/2000 12:00" }, "refund_date_invalid");
    const valid = await call(c); equal(valid.status, 200, JSON.stringify(valid));
  });
  await test("echec avant commit : tous les documents et effets annexes inchanges", async () => {
    const f = await fixture(), s = selection(f), c = confirmation(s, await preview(s), "rollback"); await refused(c, undefined, { fail: true });
  });
  await test("cumuls de journal sans confirmation financiere : aucune fabrication", async () => {
    const f = await fixture(); await applyCagnotteLedgerOperation({ db, program: accrualProgram, command: { event: "refund_confirmed", refundId: "legacy-loyalty-only",
      order: { orderId: f.id, beneficiaryId: f.uid, programVersion: program.programVersion, createdAtEpochMs: 2000, snapshot: f.snapshot }, additionalReturns: [{ lineId: "line-0", additionalNetCents: 1000 }] } });
    await refused(selection(f), "refund_history_requires_verification");
  });
  await test("historique financier corrompu refuse sans reecriture", async () => {
    const f = await fixture(); const original = await record(f, 2500, "corrupt-event"); const doc = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs[0];
    await doc.ref.update({ "result.after.totalFinancialCents": 999 }); await refused(selection(f), "refund_history_requires_verification");
    await refused(original.command, "refund_history_requires_verification");
  });
  await test("H6 parite inspect record refuse sequence initiale duplicatee ou trouee", async () => {
    for (const mode of ["start_at_two", "duplicate", "gap"] as const) {
      const f = await fixture();
      await record(f, 1000, `h6-${mode}-first`);
      if (mode !== "start_at_two") await record(f, 1000, `h6-${mode}-second`);
      const docs = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs
        .filter((doc) => doc.data().kind !== "refund_correction").sort((a, b) => a.data().sequence - b.data().sequence);
      const target = mode === "start_at_two" ? docs[0] : docs[1];
      ok(target);
      await target.ref.update({ sequence: mode === "gap" ? 3 : mode === "duplicate" ? 1 : 2 });
      await expectCorruptHistoryRejectedEverywhere(f);
    }
  });
  await test("H6 parite inspect record refuse un before initial non nul et une ligne cumul orpheline", async () => {
    const initial = await fixture();
    await record(initial, 2500, "h6-before-nonzero");
    const initialDoc = (await db.collection("cagnotteRefunds").where("orderId", "==", initial.id).get()).docs[0];
    const initialEvent = initialDoc.data();
    await initialDoc.ref.set({ ...initialEvent, result: { ...initialEvent.result,
      before: { ...initialEvent.result.before, lines: [{ lineId: "line-0", returnedNetCents: 100 }],
        returnedProductNetCents: 100, productFinancialCents: 100, totalFinancialCents: 100 },
      after: { ...initialEvent.result.after, lines: [{ lineId: "line-0", returnedNetCents: 2600 }],
        returnedProductNetCents: 2600, productFinancialCents: 2600, totalFinancialCents: 2600 },
    } });
    await expectCorruptHistoryRejectedEverywhere(initial);

    const orphanLine = await fixture();
    await record(orphanLine, 2500, "h6-orphan-line");
    const orphanDoc = (await db.collection("cagnotteRefunds").where("orderId", "==", orphanLine.id).get()).docs[0];
    const orphanEvent = orphanDoc.data();
    await orphanDoc.ref.set({ ...orphanEvent, result: { ...orphanEvent.result,
      before: { ...orphanEvent.result.before, lines: [...orphanEvent.result.before.lines, { lineId: "orphan", returnedNetCents: 0 }] },
      after: { ...orphanEvent.result.after, lines: [...orphanEvent.result.after.lines, { lineId: "orphan", returnedNetCents: 0 }] },
    } });
    await expectCorruptHistoryRejectedEverywhere(orphanLine);
  });
  await test("H6 parite inspect record refuse second before different du premier after", async () => {
    const f = await fixture();
    await record(f, 1000, "h6-continuity-first");
    await record(f, 1000, "h6-continuity-second");
    const docs = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs
      .filter((doc) => doc.data().kind !== "refund_correction").sort((a, b) => a.data().sequence - b.data().sequence);
    const second = docs[1];
    ok(second);
    const event = second.data();
    await second.ref.set({ ...event, result: { ...event.result,
      before: { ...event.result.before, lines: [{ lineId: "line-0", returnedNetCents: 1100 }],
        returnedProductNetCents: 1100, productFinancialCents: 1100, totalFinancialCents: 1100 },
      after: { ...event.result.after, lines: [{ lineId: "line-0", returnedNetCents: 2100 }],
        returnedProductNetCents: 2100, productFinancialCents: 2100, totalFinancialCents: 2100 },
    } });
    await expectCorruptHistoryRejectedEverywhere(f);
  });
  await test("H6 parite inspect record recalcule after financier et restitution depuis le snapshot", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "h6-after-recompute");
    const doc = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs.find((entry) => entry.data().kind !== "refund_correction");
    ok(doc);
    const event = doc.data();
    await doc.ref.set({ ...event, result: { ...event.result,
      productFinancialCents: 2200, cagnotteRestitutionCents: 300, totalFinancialCents: 2200,
      after: { ...event.result.after, productFinancialCents: 2200, cagnotteRestitutionCents: 300, totalFinancialCents: 2200 },
      restitution: { ...event.result.restitution, grossCents: 300, availableIncreaseCents: 300, cumulativeCents: 300 },
    } });
    await expectCorruptHistoryRejectedEverywhere(f);
  });
  await test("H6 parite inspect record refuse correction orpheline revision trouee previous et effective falsifies", async () => {
    for (const mode of ["orphan", "revision_gap", "previous", "effective"] as const) {
      const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
      await record(f, 2500, `h6-correction-${mode}-original`);
      const target = await correctionTarget(f);
      await recordCorrection(f, target, 0, 1000, 920, `h6-correction-${mode}`);
      const doc = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs.find((entry) => entry.data().kind === "refund_correction");
      ok(doc);
      const event = doc.data();
      if (mode === "orphan") {
        const targetEventId = "a".repeat(64);
        const content = { ...event.content, targetEventId };
        await doc.ref.set({ ...event, targetEventId, content, fingerprint: testHash(content),
          result: { ...event.result, targetEventId } });
      } else if (mode === "revision_gap") {
        const content = { ...event.content, expectedRevision: 1 };
        await doc.ref.set({ ...event, previousRevision: 1, revision: 2, content, fingerprint: testHash(content),
          result: { ...event.result, previousRevision: 1, revision: 2 } });
      } else if (mode === "previous") {
        await doc.ref.update({ "result.previousEffective.totalFinancialCents": event.result.previousEffective.totalFinancialCents + 1 });
      } else {
        await doc.ref.update({ "result.effective.totalFinancialCents": event.result.effective.totalFinancialCents + 1 });
      }
      await expectCorruptHistoryRejectedEverywhere(f);
    }
  });
  await test("H6 parite inspect record refuse revision correction dupliquee", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "h6-correction-duplicate-original");
    const target = await correctionTarget(f);
    await recordCorrection(f, target, 0, 1000, 920, "h6-correction-duplicate-first");
    await recordCorrection(f, target, 1, 1500, 1380, "h6-correction-duplicate-second");
    const corrections = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs
      .filter((entry) => entry.data().kind === "refund_correction").sort((a, b) => a.data().revision - b.data().revision);
    const duplicate = corrections[1];
    ok(duplicate);
    const event = duplicate.data();
    const content = { ...event.content, expectedRevision: 0 };
    await duplicate.ref.set({ ...event, previousRevision: 0, revision: 1, content, fingerprint: testHash(content),
      result: { ...event.result, previousRevision: 0, revision: 1 } });
    await expectCorruptHistoryRejectedEverywhere(f);
  });
  await test("H6 parite inspect record refuse corrections revision 1 puis 3", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "h6-correction-gap-original");
    const target = await correctionTarget(f);
    await recordCorrection(f, target, 0, 1000, 920, "h6-correction-gap-first");
    await recordCorrection(f, target, 1, 1500, 1380, "h6-correction-gap-second");
    const corrections = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs
      .filter((entry) => entry.data().kind === "refund_correction").sort((a, b) => a.data().revision - b.data().revision);
    const gap = corrections[1];
    ok(gap);
    const event = gap.data();
    const content = { ...event.content, expectedRevision: 2 };
    await gap.ref.set({ ...event, previousRevision: 2, revision: 3, content, fingerprint: testHash(content),
      result: { ...event.result, previousRevision: 2, revision: 3 } });
    await expectCorruptHistoryRejectedEverywhere(f);
  });
  await test("H6 parite inspect record refuse movement reutilise ou remboursement non lie", async () => {
    const reused = await fixture();
    await record(reused, 1000, "h6-movement-first");
    await record(reused, 1000, "h6-movement-second");
    const events = (await db.collection("cagnotteRefunds").where("orderId", "==", reused.id).get()).docs
      .filter((entry) => entry.data().kind !== "refund_correction").sort((a, b) => a.data().sequence - b.data().sequence);
    await events[1].ref.update({ movementIds: events[0].data().movementIds });
    await expectCorruptHistoryRejectedEverywhere(reused, "refund_journal_requires_verification");

    const unlinked = await fixture();
    await record(unlinked, 1000, "h6-movement-unlinked");
    const movement = (await db.collection("cagnotteMovements").where("orderId", "==", unlinked.id)
      .where("businessEvent", "==", "refund_confirmed").get()).docs[0];
    ok(movement);
    const unlinkedRef = db.collection("cagnotteMovements").doc("b".repeat(64));
    await unlinkedRef.set({ ...movement.data(), eventKey: "b".repeat(64) });
    try {
      await expectCorruptHistoryRejectedEverywhere(unlinked, "refund_journal_requires_verification");
    } finally {
      await unlinkedRef.delete();
    }
  });
  await test("finalisation 2 scenario 100/8/92 puis neutralisation differentielle", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    eq(await walletBalance(f), [0, 1660, 0, 0]);
    const original = await record(f, 2500, "final2-original-25");
    equal(original.result.totalFinancialCents, 2300); equal(original.result.restitution.grossCents, 200);
    equal(original.result.correction.appliedCents, 115); eq(await walletBalance(f), [0, 1745, 0, 0]);
    const target = await correctionTarget(f);
    const correction = await recordCorrection(f, target, 0, 0, 0, "final2-neutralize");
    equal(correction.result.kind, "administrative_refund_correction_recorded");
    equal(correction.result.effective.returnedProductNetCents, 0); equal(correction.result.differential.availableDeltaCents, -85);
    eq(await walletBalance(f), [0, 1660, 0, 0]); equal(await remaining(f), 460);
    const reservation = (await db.collection("cagnotteReservations").doc(f.id).get()).data()!;
    equal(reservation.state, "consumed"); equal(reservation.refundProjection.cumulativeRestitutedCents, 0);
    equal((await stored(f)).total, 100); equal((await stored(f)).paymentAmount, 92);
    const summary = (await stored(f)).refundSummary;
    equal(summary.kind, "administrative_correction"); equal(summary.returnedProductNetCents, 0); equal(summary.totalFinancialCents, 0);
    const inspected = await call({ action: "inspect", orderId: f.id }); equal(inspected.status, 200, JSON.stringify(inspected));
    const history = (inspected.result as unknown as { history: Array<Record<string, unknown>> }).history;
    equal(history.length, 2);
    const originalHistory = history.find((entry) => entry.type === "initial_declaration")!;
    const correctionHistory = history.find((entry) => entry.type === "correction")!;
    eq([originalHistory.returnedProductNetCents, originalHistory.financialCents, originalHistory.cagnotteRestitutionCents,
      originalHistory.resultingAvailableCents, originalHistory.effective], [2500, 2300, 200, 1745, false]);
    eq([correctionHistory.returnedProductNetCents, correctionHistory.financialCents, correctionHistory.cagnotteRestitutionCents,
      correctionHistory.resultingAvailableCents, correctionHistory.effective], [0, 0, 0, 1660, true]);
    equal(correctionHistory.targetReference, "final2-original-25");
    const persistedCorrection = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs
      .find((doc) => doc.data().kind === "refund_correction")!.data();
    equal(correctionHistory.businessFingerprint, persistedCorrection.fingerprint);
    const originalReplay = await call(original.command); equal(originalReplay.status, 200); equal((originalReplay.result as unknown as { corrected: boolean }).corrected, true);
    const before = await dump(); const replay = await call(correction.command); equal(replay.status, 200); equal(replay.result!.alreadyRecorded, true); eq(await dump(), before);
    await assertWalletJournal(db, f.uid);
  });
  await test("correction remplace les montants et conserve la declaration originale", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "final2-replace-original"); const target = await correctionTarget(f);
    const corrected = await recordCorrection(f, target, 0, 1000, 920, "final2-replace-correction");
    equal(corrected.result.effective.returnedProductNetCents, 1000); equal(corrected.result.effective.productFinancialCents, 920);
    equal(corrected.result.effective.cagnotteRestitutionCents, 80); equal(corrected.result.remainingGainCents, 414);
    eq(await walletBalance(f), [0, 1694, 0, 0]);
    const docs = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs;
    equal(docs.filter((doc) => doc.data().kind === "refund_correction").length, 1);
    equal(docs.filter((doc) => doc.data().kind !== "refund_correction")[0].data().result.after.returnedProductNetCents, 2500);
    await assertWalletJournal(db, f.uid);
  });
  await test("une nouvelle declaration repart de l etat corrige", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "final2-followup-original"); const target = await correctionTarget(f);
    await recordCorrection(f, target, 0, 1000, 920, "final2-followup-correction");
    const followup = await record(f, 1500, "final2-followup-refund");
    equal(followup.result.before.returnedProductNetCents, 1000); equal(followup.result.after.returnedProductNetCents, 2500);
    equal(followup.result.after.productFinancialCents, 2300); equal(followup.result.after.cagnotteRestitutionCents, 200);
    equal(followup.result.correction.remainingGainCents, 345); eq(await walletBalance(f), [0, 1745, 0, 0]);
    await assertWalletJournal(db, f.uid);
  });
  await test("correction du compartiment en attente restaure exactement l etat precedent", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, ready: false });
    await change(f, paid); eq(await walletBalance(f), [460, 1200, 0, 0]);
    await record(f, 2500, "final2-pending-original"); eq(await walletBalance(f), [345, 1400, 0, 0]);
    const target = await correctionTarget(f);
    const corrected = await recordCorrection(f, target, 0, 0, 0, "final2-pending-correction");
    equal(corrected.result.differential.pendingDeltaCents, 115); equal(corrected.result.differential.availableDeltaCents, -200);
    eq(await walletBalance(f), [460, 1200, 0, 0]); equal(corrected.result.remainingGainCents, 460);
    await assertWalletJournal(db, f.uid);
  });
  await test("echec avant commit d une correction ne laisse aucune ecriture partielle", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "final2-rollback-original"); const target = await correctionTarget(f);
    const body = correctionSelection(f, target, 0, 0, 0), p = await preview(body);
    await refused({ ...body, action: "record_correction", correctionReference: "final2-rollback-correction", expectedPreviewVersion: p.previewVersion }, undefined, { fail: true });
  });
  await test("correction repetee, cle modifiee et preview ancien", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "final2-idem-original"); const target = await correctionTarget(f);
    const first = await recordCorrection(f, target, 0, 0, 0, "final2-idem-correction");
    const before = await dump(); const replay = await call(first.command); equal(replay.status, 200); equal(replay.result!.alreadyRecorded, true); eq(await dump(), before);
    await refused({ ...first.command, correctionReason: "Contenu différent mais même clé de correction" }, "correction_event_conflict");
    await refused({ ...first.command, correctionReference: "final2-stale-correction" }, "correction_preview_stale");
  });
  await test("deux corrections concurrentes : une seule revision appliquee", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "final2-race-original"); const target = await correctionTarget(f);
    const body = correctionSelection(f, target, 0, 0, 0), p = await preview(body);
    const a = { ...body, action: "record_correction", correctionReference: "final2-race-a", expectedPreviewVersion: p.previewVersion };
    const b = { ...body, action: "record_correction", correctionReference: "final2-race-b", expectedPreviewVersion: p.previewVersion };
    const results = await Promise.all([call(a), call(b)]); eq(results.map((entry) => entry.status).sort(), [200, 409]);
    equal(results.find((entry) => entry.status === 409)!.code, "correction_preview_stale"); eq(await walletBalance(f), [0, 1660, 0, 0]);
  });
  await test("correction refusee si le credit restitue a ete reserve ou utilise", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "final2-spent-original"); const target = await correctionTarget(f);
    const calculation = { lines: [{ lineId: "other-line", initialCents: 1000 }], discounts: [], requestedCagnotteCents: 100, availableCagnotteCents: 1745, advantages: [] };
    const intent = createCagnotteReservationIntent({ orderId: `${f.id}-other`, beneficiaryId: f.uid, createdAtEpochMs: Date.parse("2000-01-04T00:00:00.000Z"), calculation }, program)!;
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: Date.parse("2000-01-04T00:00:00.000Z") });
    const body = correctionSelection(f, target, 0, 0, 0), p = await preview(body);
    equal(p.kind, "correction_requires_review"); const before = await dump();
    await refused({ ...body, action: "record_correction", correctionReference: "final2-spent-correction", expectedPreviewVersion: p.previewVersion }, "CORRECTION_REQUIRES_REVIEW");
    eq(await dump(), before); equal((await db.collection("cagnotteReservations").doc(intent.order.orderId).get()).data()!.state, "reserved");
  });
  await test("correction avec compensation anterieure exige un rapprochement manuel", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    const otherGain = await fixture({ beneficiary: f.uid, amounts: [10000] });
    await fixture({ beneficiary: f.uid, amounts: [20000], usedCagnotteCents: 2160, initialWalletCents: 0, paymentProgram: null });
    await record(otherGain, 10000, "final2-compensated-other");
    await record(f, 2500, "final2-compensated-original"); const target = await correctionTarget(f);
    const body = correctionSelection(f, target, 0, 0, 0), p = await preview(body);
    equal(p.kind, "correction_requires_review");
    await refused({ ...body, action: "record_correction", correctionReference: "final2-compensated-correction", expectedPreviewVersion: p.previewVersion }, "CORRECTION_REQUIRES_REVIEW");
  });
  await test("correction apres annulation ne reactive pas le gain", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "final2-cancelled-original"); const target = await correctionTarget(f);
    await change(f, { orderStatus: "cancelled" }, null); equal(await remaining(f), 0);
    const corrected = await recordCorrection(f, target, 0, 0, 0, "final2-cancelled-correction");
    equal(corrected.result.remainingGainCents, 0); equal(await remaining(f), 0);
  });
  await test("correction pendant suspension ne cree aucun gain retroactif", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, paymentProgram: null });
    await record(f, 2500, "final2-suspended-original"); const target = await correctionTarget(f);
    const corrected = await recordCorrection(f, target, 0, 0, 0, "final2-suspended-correction");
    equal(corrected.result.remainingGainCents, 0); equal((await db.collection("cagnotteAccruals").doc(f.id).get()).exists, false);
  });
  await test("inspection admin filtree distingue initial correction et etat effectif", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "final2-inspect-original"); const target = await correctionTarget(f);
    await recordCorrection(f, target, 0, 0, 0, "final2-inspect-correction");
    const response = await call({ action: "inspect", orderId: f.id }); equal(response.status, 200);
    const serialized = JSON.stringify(response.result); for (const forbidden of ["movementIds", "actor", "intentFingerprint", "paymentReference"]) equal(serialized.includes(forbidden), false);
    const inspection = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    equal(inspection.history.length, 2); equal(inspection.refund.latest?.type, "correction"); equal(inspection.refund.latestRevision, 1);
    ok(inspection.history.every((entry) => /^[a-f0-9]{64}$/.test(entry.businessFingerprint)));
  });
  await test("H6 associe les libelles et retours par lineId malgre tri et cadeau promotionnel", async () => {
    const f = await lineIdentityFixture(true);
    await change(f, { ...paid, orderStatus: "delivered" });
    const response = await call({ action: "inspect", orderId: f.id });
    equal(response.status, 200, JSON.stringify(response));
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    eq(Object.fromEntries(result.lines.map((line) => [line.lineId, line.label])), {
      A: "Produit A", B: "Produit B", gift: "Cadeau promotionnel",
    });
    const returnedA = await preview({ action: "preview", orderId: f.id, currency: "EUR",
      additionalReturns: [{ lineId: "A", additionalNetCents: 1000 }], deliveryRefundCents: 0 });
    eq(returnedA.additionalReturns, [{ lineId: "A", additionalNetCents: 1000 }]);
    const returnedB = await preview({ action: "preview", orderId: f.id, currency: "EUR",
      additionalReturns: [{ lineId: "B", additionalNetCents: 2000 }], deliveryRefundCents: 0 });
    eq(returnedB.additionalReturns, [{ lineId: "B", additionalNetCents: 2000 }]);
    await refused({ action: "preview", orderId: f.id, currency: "EUR",
      additionalReturns: [{ lineId: "gift", additionalNetCents: 1 }], deliveryRefundCents: 0 });
  });
  await test("H6 conserve les identites historiques order-line par index source", async () => {
    const f = await lineIdentityFixture(false);
    const response = await call({ action: "inspect", orderId: f.id });
    equal(response.status, 200, JSON.stringify(response));
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    eq(Object.fromEntries(result.lines.map((line) => [line.lineId, line.label])), {
      "order-line-0": "Ligne historique 1", "order-line-1": "Ligne historique 2",
    });
  });
  await test("H6 refuse les lignes commande absentes dupliquees ou incompatibles avec le snapshot", async () => {
    for (const mutate of [
      (items: Array<Record<string, unknown>>) => items.slice(1),
      (items: Array<Record<string, unknown>>) => items.map((item, index) => index === 1 ? { ...item, lineId: "B" } : item),
      (items: Array<Record<string, unknown>>) => items.map((item, index) => index === 0 ? { ...item, lineTotal: 19 } : item),
    ]) {
      const f = await lineIdentityFixture(true);
      const orderRef = db.collection("orders").doc(f.id);
      const order = (await orderRef.get()).data()!;
      await orderRef.update({ items: mutate(order.items as Array<Record<string, unknown>>) });
      await refused({ action: "inspect", orderId: f.id }, "refund_order_lines_require_verification");
    }
  });
  await test("inspection structuree avant acquisition reste une lecture sans portefeuille artificiel", async () => {
    const f = await fixture({ ready: false }); const before = await dump();
    const response = await call({ action: "inspect", orderId: f.id }); equal(response.status, 200, JSON.stringify(response));
    equal(response.stats.writes, 0); eq(await dump(), before);
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    equal(result.enrollment.enrolled, true); equal(result.enrollment.accrualEnrollment, "enrolled"); equal(result.enrollment.beneficiaryId, f.uid);
    equal(result.accrual.present, false); equal(result.accrual.initialGainCents, 500); equal(result.accrual.compartment, "none");
    equal(result.wallet, null); equal(result.reservation.applicable, false);
    equal(result.operationalState.code, "enrolled_payment_pending"); equal(result.operationalState.detail, "PAIEMENT À CONFIRMER");
  });
  await test("inspection fail closed si acquisition inscrite manque apres paiement meme avec metadonnees invalides", async () => {
    const paidMetadataCases: Array<[string, Record<string, unknown>]> = [
      ["metadonnees completes", {}],
      ["paidAt absent", { paidAt: FieldValue.delete() }],
      ["paidAt invalide", { paidAt: "date-invalide" }],
      ["paymentConfirmedAt absent", { paymentConfirmedAt: FieldValue.delete() }],
      ["paymentConfirmedAt different", { paymentConfirmedAt: "2000-01-02T00:00:00.000Z" }],
      ["paymentConfirmedBy absent", { paymentConfirmedBy: FieldValue.delete() }],
      ["finalPaymentMethod absent", { finalPaymentMethod: FieldValue.delete() }],
      ["finalPaymentMethod invalide", { finalPaymentMethod: "methode-invalide" }],
    ];
    for (const [label, metadataPatch] of paidMetadataCases) {
      const paidWithoutAccrual = await fixture({ ready: false });
      await change(paidWithoutAccrual, paid, null);
      if (Object.keys(metadataPatch).length) {
        await db.collection("orders").doc(paidWithoutAccrual.id).update(metadataPatch);
      }
      equal((await db.collection("cagnotteAccruals").doc(paidWithoutAccrual.id).get()).exists, false, label);
      const paidResponse = await refused({ action: "inspect", orderId: paidWithoutAccrual.id }, "refund_journal_requires_verification");
      equal(paidResponse.stats.writes, 0, label);
    }
  });
  await test("inspection fail closed si acquisition inscrite manque apres livraison", async () => {
    const deliveredWithoutAccrual = await fixture({ ready: false });
    await change(deliveredWithoutAccrual, { orderStatus: "delivered" }, null);
    equal((await db.collection("cagnotteAccruals").doc(deliveredWithoutAccrual.id).get()).exists, false);
    const deliveredResponse = await refused({ action: "inspect", orderId: deliveredWithoutAccrual.id }, "refund_journal_requires_verification");
    equal(deliveredResponse.stats.writes, 0);
  });
  await test("annulation enrolled exige le tombstone garanti par chaque marqueur lifecycle", async () => {
    const cancelledWithTombstone = await fixture({ ready: false, accrualEnrollment: "enrolled" });
    await change(cancelledWithTombstone, { orderStatus: "cancelled" }, null);
    const accrual = (await db.collection("cagnotteAccruals").doc(cancelledWithTombstone.id).get()).data()!;
    equal(accrual.cancelled, true); equal(accrual.credited, false); equal(accrual.compartment, "none"); equal(accrual.remainingGainCents, 0);
    const accepted = await call({ action: "inspect", orderId: cancelledWithTombstone.id });
    equal(accepted.status, 200, JSON.stringify(accepted)); equal(accepted.stats.writes, 0);

    for (const [label, lifecyclePatch] of [
      ["orderStatus cancelled", { orderStatus: "cancelled" }],
      ["paymentStatus cancelled", { paymentStatus: "cancelled" }],
      ["cancelledAt present", { cancelledAt: "2000-01-01T00:00:00.000Z" }],
    ] as const) {
      const cancelledWithoutAccrual = await fixture({ ready: false, accrualEnrollment: "enrolled" });
      await db.collection("orders").doc(cancelledWithoutAccrual.id).update(lifecyclePatch);
      equal((await db.collection("cagnotteAccruals").doc(cancelledWithoutAccrual.id).get()).exists, false, label);
      const rejected = await refused({ action: "inspect", orderId: cancelledWithoutAccrual.id }, "refund_journal_requires_verification");
      equal(rejected.stats.writes, 0, label);
    }
  });
  await test("inscription acquisition explicite conserve le comportement existant", async () => {
    const f = await fixture({ ready: false, accrualEnrollment: "enrolled" });
    const response = await call({ action: "inspect", orderId: f.id }); equal(response.status, 200, JSON.stringify(response));
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    equal(result.enrollment.enrolled, true); equal(result.enrollment.accrualEnrollment, "enrolled");
    equal(result.accrual.initialGainCents, 500); equal(result.operationalState.code, "enrolled_payment_pending");
  });
  await test("acquisition drain et reservation consommee restent inspectables sans gain hypothetique", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, accrualEnrollment: "not_enrolled" });
    equal((await stored(f)).cagnotte.accrualEnrollment, "not_enrolled");
    equal((await db.collection("cagnotteAccruals").doc(f.id).get()).exists, false);
    equal((await db.collection("cagnotteReservations").doc(f.id).get()).data()!.state, "consumed");
    const response = await call({ action: "inspect", orderId: f.id }); equal(response.status, 200, JSON.stringify(response)); equal(response.stats.writes, 0);
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    equal(result.enrollment.enrolled, false); equal(result.enrollment.accrualEnrollment, "not_enrolled");
    eq(result.accrual, { present: false, initialGainCents: 0, remainingGainCents: 0, paymentConfirmed: false,
      deliveryConfirmed: false, credited: false, compartment: "none", cancelled: false });
    equal(result.operationalState.code, "accrual_not_enrolled");
    equal(result.operationalState.label, "AUCUN GAIN POUR CETTE COMMANDE");
    equal(result.reservation.applicable, true); equal(result.reservation.state, "consumed"); equal(result.reservation.amountCents, 800);
    equal(result.financing.cagnotteCents, 800); equal(result.financing.externalProductsCents, 9200);
    const refundPreview = await call(selection(f)); equal(refundPreview.status, 200, JSON.stringify(refundPreview)); equal(refundPreview.stats.writes, 0);
  });
  await test("acquisition not_enrolled refuse les vrais droits pending et available", async () => {
    for (const event of ["payment_confirmed", "payment_and_delivery_confirmed"] as const) {
      const f = await fixture({ ready: false, usedCagnotteCents: 800, initialWalletCents: 2000, accrualEnrollment: "not_enrolled" });
      await applyCagnotteLedgerOperation({ db, program: accrualProgram, command: { event, order: {
        orderId: f.id, beneficiaryId: f.uid, programVersion: program.programVersion, createdAtEpochMs: 2000, snapshot: f.snapshot,
      } } });
      const storedAccrual = (await db.collection("cagnotteAccruals").doc(f.id).get()).data()!;
      equal(storedAccrual.credited, true); equal(storedAccrual.compartment, event === "payment_confirmed" ? "pending" : "available");
      const response = await refused({ action: "inspect", orderId: f.id }, "refund_journal_requires_verification");
      equal(response.stats.writes, 0);
    }
  });
  await test("annulation not_enrolled accepte seulement le tombstone canonique sans credit", async () => {
    const f = await fixture({ ready: false, usedCagnotteCents: 800, initialWalletCents: 2000, accrualEnrollment: "not_enrolled" });
    await cancelReviewedUnpaid(f);
    const response = await call({ action: "inspect", orderId: f.id }); equal(response.status, 200, JSON.stringify(response)); equal(response.stats.writes, 0);
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    equal(result.enrollment.enrolled, false); equal(result.operationalState.code, "cancelled");
    eq(result.accrual, { present: true, initialGainCents: 0, remainingGainCents: 0, paymentConfirmed: false,
      deliveryConfirmed: false, credited: false, compartment: "none", cancelled: true });
    equal(result.reservation.state, "released");
    await rejectMovementMutation(f, "cancelled", { currency: "USD" });
    const accrualRef = db.collection("cagnotteAccruals").doc(f.id);
    const original = (await accrualRef.get()).data()!;
    try {
      await accrualRef.set({ ...original, credited: true, compartment: "pending", remainingGainCents: 1 });
      const rejected = await refused({ action: "inspect", orderId: f.id }, "refund_journal_requires_verification");
      equal(rejected.stats.writes, 0);
    } finally { await accrualRef.set(original); }
  });
  await test("inspection derive les etats pending available et cancelled du journal valide", async () => {
    const pendingOrder = await fixture({ ready: false }); await change(pendingOrder, paid);
    const pendingInspection = (await call({ action: "inspect", orderId: pendingOrder.id })).result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    equal(pendingInspection.operationalState.code, "payment_confirmed_pending"); equal(pendingInspection.accrual.compartment, "pending");
    const availableOrder = await fixture();
    const availableInspection = (await call({ action: "inspect", orderId: availableOrder.id })).result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    equal(availableInspection.operationalState.code, "delivered_available"); equal(availableInspection.accrual.compartment, "available");
    const cancelledOrder = await fixture(); await change(cancelledOrder, { orderStatus: "cancelled" }, null);
    const cancelledInspection = (await call({ action: "inspect", orderId: cancelledOrder.id })).result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    equal(cancelledInspection.operationalState.code, "cancelled"); equal(cancelledInspection.accrual.cancelled, true);
  });
  await test("inspection structuree reutilise acquisition portefeuille reservation refund et mouvements filtres", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "readiness-inspection");
    const response = await call({ action: "inspect", orderId: f.id }); equal(response.status, 200, JSON.stringify(response));
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    eq(result.accrual, { present: true, initialGainCents: 460, remainingGainCents: 345, paymentConfirmed: true,
      deliveryConfirmed: true, credited: true, compartment: "available", cancelled: false });
    equal(result.wallet?.availableCents, 1745); equal(result.reservation.applicable, true); equal(result.reservation.state, "consumed");
    equal(result.reservation.amountCents, 800); equal(result.reservation.cumulativeRestitutedCents, 200);
    equal(result.refund.history.length, 1); equal(result.refund.latestRevision, 0); equal(result.operationalState.code, "refund_recorded");
    equal(result.history[0].source, "admin"); equal(result.history[0].reference, "readiness-inspection");
    const storedEvent = (await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).docs[0].data();
    equal(result.history[0].businessFingerprint, storedEvent.fingerprint); equal(result.history[0].businessFingerprint.length, 64);
    ok(result.movements.some((movement) => movement.event === "credit_refunded_after_return"));
    const movements = JSON.stringify(result.movements);
    for (const forbidden of [f.uid, actor.email!, "Synthetic", "synthetic@example.test", "readiness-inspection", "payload"]) equal(movements.includes(forbidden), false);
  });
  await test("H2 refuse un mouvement supplementaire meme derive d un mouvement canonique", async () => {
    const f = await fixture();
    const journal = await db.collection("cagnotteMovements").where("orderId", "==", f.id).get();
    const payment = journal.docs.find((doc) => doc.data().businessEvent === "payment_confirmed");
    ok(payment);
    const forgedId = "f".repeat(64);
    const forgedRef = db.collection("cagnotteMovements").doc(forgedId);
    await forgedRef.set({ ...payment.data(), eventKey: forgedId });
    try {
      const response = await refused({ action: "inspect", orderId: f.id }, "refund_journal_requires_verification");
      equal(response.stats.writes, 0);
    } finally {
      await forgedRef.delete();
    }
  });
  await test("parite inspection et validateur canonique ledger", async () => {
    const f = await fixture();
    const accrual = (await db.collection("cagnotteAccruals").doc(f.id).get()).data() as import("../api/_server/cagnotteLedgerTypes.js").CagnotteAccrual;
    const journal = await db.collection("cagnotteMovements").where("orderId", "==", f.id).get();
    const delivery = journal.docs.find((doc) => doc.data().businessEvent === "delivery_confirmed");
    ok(delivery);
    validateCagnotteLedgerMovementForRead(delivery.data(), delivery.id, accrual);
    equal((await call({ action: "inspect", orderId: f.id })).status, 200);
    let canonicalRefused = false;
    try { validateCagnotteLedgerMovementForRead({ ...delivery.data(), currency: "USD" }, delivery.id, accrual); }
    catch { canonicalRefused = true; }
    equal(canonicalRefused, true);
    await rejectMovementMutation(f, "delivery_confirmed", { currency: "USD" });
  });
  await test("H2 refuse independamment les invariants canoniques ledger falsifies", async () => {
    const mutations: Array<[string, Record<string, unknown>]> = [
      ["currency", { currency: "USD" }],
      ["origin", { origin: "client" }],
      ["programVersion", { programVersion: "forged-program" }],
      ["calculationVersion", { calculationVersion: "forged-calculation" }],
      ["regularizationVersion", { regularizationVersion: "forged-regularization" }],
      ["reservationVersion", { reservationVersion: "forged-reservation" }],
      ["payload", { payload: "{\"event\":\"delivery_confirmed\",\"forged\":true}" }],
      ["eventKey", { eventKey: "0".repeat(64) }],
      ["businessEvent", { businessEvent: "payment_confirmed" }],
    ];
    for (const [field, patch] of mutations) {
      const f = await fixture();
      await rejectMovementMutation(f, "delivery_confirmed", patch);
      ok(field);
    }
  });
  await test("H2 refuse les versions incompatibles des schemas legacy", async () => {
    for (const [schemaVersion, patch] of [
      [1, { regularizationVersion: "cagnotte-regularization-v1" }],
      [2, { regularizationVersion: "forged-regularization" }],
      [2, { reservationVersion: "cagnotte-reservation-v1" }],
    ] as const) {
      const f = await fixture();
      const id = await rewriteOneMovementSchema(f, schemaVersion, 2000);
      const ref = db.collection("cagnotteMovements").doc(id);
      const original = (await ref.get()).data()!;
      await ref.set({ ...original, ...patch });
      try { await refused({ action: "inspect", orderId: f.id }, "refund_journal_requires_verification"); }
      finally { await ref.set(original); }
    }
  });
  await test("H2 refuse les deltas incompatibles payment et made available", async () => {
    const payment = await fixture();
    await rejectMovementMutation(payment, "payment_confirmed", { availableDeltaCents: 1 });
    const release = await fixture();
    await rejectMovementMutation(release, "made_available", { availableDeltaCents: 499 });
  });
  await test("H2 refuse les mouvements reservation reserve consume et release falsifies", async () => {
    const consumed = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await rejectMovementMutation(consumed, "credit_reserved", { payload: "{}" });
    await rejectMovementMutation(consumed, "credit_consumed", { reservationVersion: "forged-reservation" });
    const released = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000, ready: false });
    await cancelReviewedUnpaid(released);
    await rejectMovementMutation(released, "credit_released", { reservedDeltaCents: 0 });
  });
  await test("H2 refuse les mouvements refund et restitution falsifies", async () => {
    const simple = await fixture();
    await record(simple, 2500, "h2-refund-ledger");
    await rejectMovementMutation(simple, "refund_confirmed", { payload: "{}" });
    const mixed = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(mixed, 2500, "h2-refund-reservation");
    await rejectMovementMutation(mixed, "credit_refunded_after_return", { origin: "client" });
  });
  await test("H2 refuse chaque famille de mouvement de correction falsifiee", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "h2-correction-original");
    const target = await correctionTarget(f);
    await recordCorrection(f, target, 0, 0, 0, "h2-correction");
    await rejectMovementMutation(f, "refund_declaration_corrected", { currency: "USD" });
    await rejectMovementMutation(f, "credit_refund_corrected", { payload: "{\"event\":\"credit_refund_corrected\",\"forged\":true}" });
  });
  await test("schema v1 sans horodatage garde l inspection disponible avec historique partiel sans ecriture", async () => {
    const f = await fixture();
    const beforeProjection = (await call({ action: "inspect", orderId: f.id })).result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    const omittedId = await rewriteOneMovementSchema(f, 1);
    const before = await dump();
    const response = await call({ action: "inspect", orderId: f.id });
    equal(response.status, 200, JSON.stringify(response));
    equal(response.stats.writes, 0);
    eq(await dump(), before);
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    eq(result.movementHistory, { complete: false, omittedLegacyUndatedCount: 1 });
    equal(result.movements.some((movement) => movement.id === omittedId), false);
    ok(result.movements.length > 0, "les mouvements v3 horodates restent affiches");
    eq(result.wallet, beforeProjection.wallet);
    eq(result.accrual, beforeProjection.accrual);
    eq(result.refund, beforeProjection.refund);
    eq(result.effective, beforeProjection.effective);
  });
  await test("schema v2 sans horodatage est omis explicitement de la seule chronologie", async () => {
    const f = await fixture();
    const omittedId = await rewriteOneMovementSchema(f, 2);
    const before = await dump();
    const response = await call({ action: "inspect", orderId: f.id });
    equal(response.status, 200, JSON.stringify(response));
    equal(response.stats.writes, 0);
    eq(await dump(), before);
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    eq(result.movementHistory, { complete: false, omittedLegacyUndatedCount: 1 });
    equal(result.movements.some((movement) => movement.id === omittedId), false);
  });
  await test("schema v1 et v2 avec horodatage valide restent affiches", async () => {
    for (const schemaVersion of [1, 2] as const) {
      const f = await fixture();
      const displayedId = await rewriteOneMovementSchema(f, schemaVersion, 1234 + schemaVersion);
      const before = await dump();
      const response = await call({ action: "inspect", orderId: f.id });
      equal(response.status, 200, JSON.stringify(response));
      equal(response.stats.writes, 0);
      eq(await dump(), before);
      const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
      eq(result.movementHistory, { complete: true, omittedLegacyUndatedCount: 0 });
      equal(result.movements.find((movement) => movement.id === displayedId)?.recordedAtEpochMs, 1234 + schemaVersion);
    }
  });
  await test("schema v1 et v2 avec horodatage present mais invalide restent refuses", async () => {
    for (const schemaVersion of [1, 2] as const) for (const invalid of ["1234", -1, 1.5]) {
      const f = await fixture();
      await rewriteOneMovementSchema(f, schemaVersion, invalid);
      await refused({ action: "inspect", orderId: f.id }, "refund_journal_requires_verification");
      await rewriteOneMovementSchema(f, schemaVersion, 2000);
    }
  });
  await test("schema v3 exige un horodatage valide et affiche le mouvement", async () => {
    const missing = await fixture();
    await rewriteOneMovementSchema(missing, 3);
    await refused({ action: "inspect", orderId: missing.id }, "refund_journal_requires_verification");
    await rewriteOneMovementSchema(missing, 3, 2000);
    for (const invalid of ["4321", -1, 1.5]) {
      const malformed = await fixture();
      await rewriteOneMovementSchema(malformed, 3, invalid);
      await refused({ action: "inspect", orderId: malformed.id }, "refund_journal_requires_verification");
      await rewriteOneMovementSchema(malformed, 3, 2000);
    }
    const valid = await fixture();
    const displayedId = await rewriteOneMovementSchema(valid, 3, 4321);
    const before = await dump();
    const response = await call({ action: "inspect", orderId: valid.id });
    equal(response.status, 200, JSON.stringify(response));
    equal(response.stats.writes, 0);
    eq(await dump(), before);
    const result = response.result as unknown as import("../src/types/cagnotteAdmin.js").CagnotteAdminInspection;
    eq(result.movementHistory, { complete: true, omittedLegacyUndatedCount: 0 });
    equal(result.movements.find((movement) => movement.id === displayedId)?.recordedAtEpochMs, 4321);
  });
  await test("schema de mouvement inconnu reste refuse", async () => {
    const f = await fixture();
    const snapshot = await db.collection("cagnotteMovements").where("orderId", "==", f.id).get();
    const document = snapshot.docs[0];
    ok(document);
    await document.ref.set({ ...document.data(), schemaVersion: 99 });
    await refused({ action: "inspect", orderId: f.id }, "refund_journal_requires_verification");
    await document.ref.set({ ...document.data(), schemaVersion: 3 });
  });
  await test("logs operationnels sont structures, idempotents et sans PII ni reference brute", async () => {
    const f = await fixture(), body = selection(f), p = await preview(body), command = confirmation(body, p, "sensitive-business-reference");
    const firstLogs: OrderRefundOperationalLog[] = []; const first = await call(command, { logs: firstLogs }); equal(first.status, 200);
    equal(firstLogs.length, 1); equal(firstLogs[0].event, "cagnotte_refund_recorded"); equal(firstLogs[0].idempotent, false);
    const replayLogs: OrderRefundOperationalLog[] = []; const replay = await call(command, { logs: replayLogs }); equal(replay.status, 200);
    equal(replayLogs.length, 1); equal(replayLogs[0].idempotent, true); equal(replayLogs[0].eventId, firstLogs[0].eventId);
    const target = await correctionTarget(f); const correctionBody = correctionSelection(f, target, 0, 1000, 1000);
    const correctionPreview = await preview(correctionBody); const correctionLogs: OrderRefundOperationalLog[] = [];
    const correction = await call({ ...correctionBody, action: "record_correction", correctionReference: "sensitive-correction-reference",
      expectedPreviewVersion: correctionPreview.previewVersion }, { logs: correctionLogs }); equal(correction.status, 200);
    equal(correctionLogs.length, 1); equal(correctionLogs[0].event, "cagnotte_refund_correction_recorded"); equal(correctionLogs[0].idempotent, false);
    const serialized = JSON.stringify([...firstLogs, ...replayLogs, ...correctionLogs]);
    for (const forbidden of [f.id, f.uid, actor.email!, "sensitive-business-reference", "sensitive-correction-reference", "synthetic@example.test"]) equal(serialized.includes(forbidden), false);
    ok(/^[a-f0-9]{64}$/.test(firstLogs[0].orderHash)); ok(Object.keys(firstLogs[0].deltas).every((key) => key.endsWith("Cents")));
  });
  await test("correction a revoir emet uniquement le diagnostic structure", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "readiness-review-original"); const target = await correctionTarget(f);
    const intent = createCagnotteReservationIntent({ orderId: `${f.id}-later`, beneficiaryId: f.uid, createdAtEpochMs: Date.parse("2000-01-04T00:00:00.000Z"),
      calculation: { lines: [{ lineId: "later", initialCents: 1000 }], discounts: [], requestedCagnotteCents: 100, availableCagnotteCents: 1745, advantages: [] } }, program)!;
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: Date.parse("2000-01-04T00:00:00.000Z") });
    const logs: OrderRefundOperationalLog[] = [];
    const response = await call(correctionSelection(f, target, 0, 0, 0), { logs }); equal(response.status, 200);
    equal(response.result!.kind, "correction_requires_review"); equal(response.stats.writes, 0);
    equal(logs.length, 1); equal(logs[0].event, "cagnotte_correction_requires_review"); equal(logs[0].idempotent, false);
  });
  await test("echec logger apres refund conserve succes et rejeu idempotent", async () => {
    const f = await fixture(); const body = selection(f), p = await preview(body);
    const command = confirmation(body, p, "logger-refund-sensitive-reference");
    const first = await captureWarnings(() => call(command, { loggerThrows: true }));
    equal(first.result.status, 200, JSON.stringify(first.result)); equal(first.result.result!.alreadyRecorded, false);
    equal((await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get()).size, 1);
    eq(await balance(f), [0, 375, 0]); equal(first.warnings.length, 1);
    const fallback = JSON.parse(first.warnings[0]) as Record<string, unknown>;
    eq(Object.keys(fallback).sort(), ["event", "orderHash", "originalEvent"]);
    equal(fallback.event, "cagnotte_operational_log_failed"); equal(fallback.originalEvent, "cagnotte_refund_recorded");
    equal(String(fallback.orderHash).length, 64); equal(first.warnings[0].includes(f.id), false);
    equal(first.warnings[0].includes(f.uid), false); equal(first.warnings[0].includes("logger-refund-sensitive-reference"), false);
    const beforeRetry = await dump();
    const replay = await captureWarnings(() => call(command, { loggerThrows: true }));
    equal(replay.result.status, 200); equal(replay.result.result!.alreadyRecorded, true); equal(replay.result.stats.writes, 0);
    eq(await dump(), beforeRetry);
  });
  await test("echec logger apres correction conserve succes et rejeu idempotent", async () => {
    const f = await fixture(); await record(f, 2500, "logger-correction-original"); const target = await correctionTarget(f);
    const body = correctionSelection(f, target, 0, 0, 0); const p = await preview(body);
    const command = { ...body, action: "record_correction", correctionReference: "logger-correction-sensitive-reference", expectedPreviewVersion: p.previewVersion };
    const first = await captureWarnings(() => call(command, { loggerThrows: true }));
    equal(first.result.status, 200, JSON.stringify(first.result)); equal(first.result.result!.alreadyRecorded, false);
    const history = await db.collection("cagnotteRefunds").where("orderId", "==", f.id).get();
    equal(history.docs.filter((doc) => doc.data().kind === "refund_correction").length, 1); equal(first.warnings.length, 1);
    equal(first.warnings[0].includes(f.id), false); equal(first.warnings[0].includes("logger-correction-sensitive-reference"), false);
    const beforeRetry = await dump();
    const replay = await captureWarnings(() => call(command, { loggerThrows: true }));
    equal(replay.result.status, 200); equal(replay.result.result!.alreadyRecorded, true); equal(replay.result.stats.writes, 0);
    eq(await dump(), beforeRetry);
  });
  await test("echec logger conserve correction_requires_review", async () => {
    const f = await fixture({ usedCagnotteCents: 800, initialWalletCents: 2000 });
    await record(f, 2500, "logger-review-original"); const target = await correctionTarget(f);
    const intent = createCagnotteReservationIntent({ orderId: `${f.id}-later`, beneficiaryId: f.uid, createdAtEpochMs: Date.parse("2000-01-04T00:00:00.000Z"),
      calculation: { lines: [{ lineId: "later", initialCents: 1000 }], discounts: [], requestedCagnotteCents: 100, availableCagnotteCents: 1745, advantages: [] } }, program)!;
    await applyCagnotteReservationOperation({ db, action: "reserve", intent, program, recordedAtEpochMs: Date.parse("2000-01-04T00:00:00.000Z") });
    const before = await dump();
    const response = await captureWarnings(() => call(correctionSelection(f, target, 0, 0, 0), { loggerThrows: true }));
    equal(response.result.status, 200, JSON.stringify(response.result)); equal(response.result.result!.kind, "correction_requires_review");
    equal(response.result.stats.writes, 0); eq(await dump(), before); equal(response.warnings.length, 1);
  });
  await test("concordance finale de tous les portefeuilles et journaux", async () => { for (const wallet of (await db.collection("cagnotteWallets").get()).docs) await assertWalletJournal(db, wallet.id); });
  console.log(`LOT 4C : ${tests} scenarios HTTP/emulateur reussis. Confirmation administrative seulement, aucune operation bancaire.`);
} finally { await db.terminate(); }
