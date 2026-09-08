import { deepStrictEqual as eq, equal, ok } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { CAGNOTTE_DEMO, connectCagnotteEmulator } from "./cagnotteEmulator.js";
import { createSendPaymentLinkHandler } from "../api/_server/sendPaymentLinkRoute.js";
import { createOrderStatusHandler } from "../api/_server/orderStatusRoute.js";
import { buildCagnotteOrderEnrollment } from "../api/_server/cagnotteOrders.js";
import { CAGNOTTE_SERVER_PROGRAM } from "../api/_server/cagnotteProgram.js";
import type { VerifiedFirebaseUser } from "../api/_server/adminAuth.js";
import type { EmailResult } from "../api/_server/email.js";
import type { CagnotteTestProgram } from "../api/_server/cagnotteLedgerTypes.js";
import type { PaymentLinkDeliveryRequest, PaymentLinkDeliveryResult } from "../api/_server/paymentLinkDelivery.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import type { Order } from "../src/types/index.js";

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const admin: VerifiedFirebaseUser = { uid: "links-admin", email: "links-admin@example.test", emailVerified: true };
const program: CagnotteTestProgram = { mode: "local_test", programVersion: "links-fixture-v1", calculationVersion: "cagnotte-math-v1", startsAtEpochMs: 1000, newAccrualsEnabled: true };
const url = "https://buy.stripe.com/test_synthetic_never_opened";
const accepted = { status: "sent", id: "synthetic-acceptance" } as const;
let count = 0, sequence = 0, sends = 0;
async function test(name: string, run: () => Promise<unknown>) {
  try { await run(); count++; console.log(`OK [Liens 2E] ${name}`); }
  catch (error) { console.error(`FAIL [Liens 2E] ${name}`); throw error; }
}
async function fixture(overrides: Record<string, unknown> = {}, enrolled = true) {
  const id = `link-order-${++sequence}`, uid = `link-customer-${sequence}`;
  const data: Record<string, unknown> = {
    customerId: uid, customerEmail: "synthetic@example.test", customerName: "Synthetic",
    createdAt: "2000-01-01T00:00:00.000Z", orderStatus: "confirmed", paymentStatus: "to_confirm",
    deliveryMethod: "postal", subtotal: 100, discountAmount: 0, promotionDiscountTotal: 0, deliveryFee: 0, total: 100,
    items: [{ lineId: "line", productId: "links-product", name: "Synthetic", quantity: 10, unitPrice: 10, lineTotal: 100 }],
  };
  if (enrolled) data.cagnotte = buildCagnotteOrderEnrollment(data, uid, program, 2000);
  Object.assign(data, overrides);
  await db.collection("orders").doc(id).set(data);
  return { id, uid, data };
}
function body(orderId: string, overrides: Record<string, unknown> = {}) {
  return { orderId, authToken: "synthetic", paymentLinkRequestId: randomUUID(), intent: "initial",
    paymentLinkUrl: url, paymentLinkLabel: "Synthetic 100 EUR", paymentLinkAmount: 100, paymentLinkCurrency: "EUR", ...overrides };
}
async function stored(id: string) { return (await db.collection("orders").doc(id).get()).data()!; }
async function ledger() {
  return Promise.all(["cagnotteWallets", "cagnotteAccruals", "cagnotteMovements"].map(async (name) =>
    (await db.collection(name).get()).docs.map((entry) => ({ id: entry.id, ...entry.data() }))));
}
async function balances(uid: string) {
  const data = (await db.collection("cagnotteWallets").doc(uid).get()).data();
  return data ? [data.pendingCents, data.availableCents, data.regularizationCents] : null;
}
type Hooks = {
  beforeTransaction?: (index: number) => Promise<void>;
  afterTransaction?: (index: number) => Promise<void>;
  failTransaction?: number; retryReservation?: boolean;
};
function checkedDatabase(hooks: Hooks = {}) {
  let transactions = 0, callbacks = 0, inCallback = 0, retried = false;
  const proxy = new Proxy(db, { get(target, key) {
    if (key === "collection") return (name: string) => {
      if (name.startsWith("cagnotte")) throw new Error("An email must never access cagnotte collections.");
      return target.collection(name);
    };
    if (key === "runTransaction") return async (run: (tx: Transaction) => Promise<unknown>) => {
      const index = ++transactions;
      await hooks.beforeTransaction?.(index);
      const result = await target.runTransaction(async (tx) => {
        let wrote = false; callbacks++; inCallback++;
        const wrapped = new Proxy(tx, { get(transaction, method) {
          const value = Reflect.get(transaction, method);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (method === "get" || method === "getAll") equal(wrote, false, "Read after write");
            if (["set", "update", "create", "delete"].includes(String(method))) wrote = true;
            return Reflect.apply(value, transaction, args);
          };
        } });
        try {
          const result = await run(wrapped);
          if (hooks.retryReservation && index === 1 && !retried) {
            retried = true; throw Object.assign(new Error("Synthetic ABORTED before commit"), { code: 10 });
          }
          if (hooks.failTransaction === index) throw new Error("Synthetic failure before commit");
          return result;
        } finally { inCallback--; }
      });
      await hooks.afterTransaction?.(index);
      return result;
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  return { proxy, stats: () => ({ transactions, callbacks, inCallback }) };
}
async function invoke(handler: ReturnType<typeof createSendPaymentLinkHandler>, payload: Record<string, unknown>, method = "POST") {
  let status = 0;
  let result: { delivery?: PaymentLinkDeliveryResult; code?: string } = {};
  const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: typeof result) { result = value; } };
  await handler({ method, headers: {}, body: payload } as VercelRequestLike, response as unknown as VercelResponseLike);
  return { status, ...result };
}
async function link(payload: Record<string, unknown>, options: Hooks & {
  identity?: VerifiedFirebaseUser | Error; now?: () => number; method?: string;
  send?: (order: Order, request: PaymentLinkDeliveryRequest) => Promise<EmailResult>;
} = {}) {
  const monitor = checkedDatabase(options);
  const handler = createSendPaymentLinkHandler({
    getDb: () => monitor.proxy, now: options.now,
    verifyToken: async () => { if (options.identity instanceof Error) throw options.identity; return options.identity ?? admin; },
    send: async (order, request) => {
      equal(monitor.stats().inCallback, 0, "External send inside transaction callback"); sends++;
      return options.send ? options.send(order, request) : accepted;
    },
  });
  return { ...await invoke(handler, payload, options.method), stats: monitor.stats() };
}
async function transition(id: string, payload: Record<string, unknown>, selectedProgram: CagnotteTestProgram | null = program) {
  const handler = createOrderStatusHandler({ getDb: () => db, verifyToken: async () => admin, accrualProgram: selectedProgram, reservationProgram: null,
    sendStatusEmail: async () => ({ status: "skipped", reason: "synthetic" }), processAnalytics: async () => ({ status: "skipped" }) });
  const result = await invoke(handler, { orderId: id, authToken: "synthetic", ...payload });
  equal(result.status, 200); return result;
}
const pay = { paymentStatus: "paid", finalPaymentMethod: "card_payment_link" };
const cancel = { orderStatus: "cancelled", paymentStatus: "cancelled" };
function gate() {
  let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release };
}
async function requests(id: string) { return (await db.collection("paymentLinkRequests").where("orderId", "==", id).get()).docs.map((doc) => doc.data()); }

try {
  equal(CAGNOTTE_SERVER_PROGRAM, null);
  await db.collection("adminUsers").doc(admin.uid).set({ isActive: true });
  await db.collection("adminUsers").doc("inactive-links").set({ isActive: false });
  await db.collection("adminUsers").doc("fallback-links@example.test").set({ isActive: true });
  await db.collection("products").doc("links-product").set({ stock: 1000, name: "Synthetic", price: 10, isActive: true });
  await test("100 EUR : lien sans journal, paiement 500 pending, livraison 500 available", async () => {
    const f = await fixture(), before = await ledger(); const original = await stored(f.id);
    const result = await link(body(f.id)); equal(result.status, 200); equal(result.delivery?.transportStatus, "accepted");
    eq(await ledger(), before); equal(await balances(f.uid), null);
    const sent = await stored(f.id); equal(sent.paymentStatus, "payment_link_sent"); equal(sent.orderStatus, "confirmed");
    for (const field of ["cagnotte", "customerId", "total", "items"]) eq(sent[field], original[field]);
    await transition(f.id, pay); eq(await balances(f.uid), [500, 0, 0]);
    await transition(f.id, { orderStatus: "delivered" }); eq(await balances(f.uid), [0, 500, 0]);
  });
  await test("livree impayee : aucun marqueur par le lien puis paiement normal", async () => {
    const f = await fixture({ orderStatus: "delivered" }), before = await ledger();
    equal((await link(body(f.id))).status, 200); eq(await ledger(), before);
    equal((await stored(f.id)).orderStatus, "delivered"); await transition(f.id, pay); eq(await balances(f.uid), [0, 500, 0]);
  });
  await test("drain : le lien reste neutre et la commande inscrite peut terminer", async () => {
    const f = await fixture({ orderStatus: "delivered" });
    const drain = { ...program, newAccrualsEnabled: false };
    await transition(f.id, { internalNote: "Synthetic drain delivery" }, drain);
    const before = await ledger(); equal((await link(body(f.id))).status, 200); eq(await ledger(), before);
    eq(await balances(f.uid), [0, 0, 0]);
    await transition(f.id, pay, drain); eq(await balances(f.uid), [0, 500, 0]);
  });
  await test("declaration manuelle partagee : livree impayee sans reconciliation", async () => {
    const f = await fixture({ orderStatus: "delivered" }), before = await ledger();
    await transition(f.id, { paymentLinkSent: true, paymentLinkChannel: "sms" }); eq(await ledger(), before);
    equal((await stored(f.id)).paymentStatus, "payment_link_sent");
  });
  for (const [name, overrides] of [
    ["paid", { paymentStatus: "paid" }], ["cancelled", cancel], ["cancelledAt", { cancelledAt: "2000-01-01" }],
    ["deleted", { deletedAt: "2000-01-01" }], ["null enrollment", { cagnotte: null }], ["empty enrollment", { cagnotte: {} }],
    ["recipient invalid", { customerEmail: "bad\n@example.test" }], ["amount altered", { total: 101 }],
  ] as const) await test(`refus avant envoi : ${name}`, async () => {
    const f = await fixture(overrides), before = await stored(f.id), start = sends;
    equal((await link(body(f.id))).status, 409); equal(sends, start); eq(await stored(f.id), before); equal((await requests(f.id)).length, 0);
  });
  for (const field of ["beneficiary", "snapshot", "version", "createdAt"] as const) await test(`inscription falsifiee : ${field}`, async () => {
    const f = await fixture(); const registration = (await stored(f.id)).cagnotte;
    if (field === "beneficiary") registration.beneficiaryId = "forged";
    if (field === "snapshot") registration.snapshot.loyaltyCents = 999;
    if (field === "version") registration.programVersion = "";
    if (field === "createdAt") registration.createdAtEpochMs = -1;
    await db.collection("orders").doc(f.id).update({ cagnotte: registration });
    const start = sends; equal((await link(body(f.id))).status, 409); equal(sends, start);
  });
  for (const [name, identity, token, expected] of [
    ["missing token", admin, "", 401], ["invalid token", new Error("Token Firebase invalide."), "synthetic", 401],
    ["self declared admin", { uid: "not-admin", email: admin.email, emailVerified: false }, "synthetic", 403],
    ["inactive uid", { uid: "inactive-links", email: "fallback-links@example.test", emailVerified: true }, "synthetic", 403],
    ["unverified email", { uid: "absent-links", email: "fallback-links@example.test", emailVerified: false }, "synthetic", 403],
  ] as const) await test(`autorisation reelle : ${name}`, async () => {
    const f = await fixture(), start = sends;
    const r = await link(body(f.id, { authToken: token, role: "admin", uid: admin.uid, email: admin.email }), { identity });
    equal(r.status, expected); equal(sends, start); equal(r.stats.transactions, 0);
  });
  await test("email administrateur verifie en repli autorise", async () => {
    const f = await fixture(); equal((await link(body(f.id), { identity: { uid: "absent-links", email: "fallback-links@example.test", emailVerified: true } })).status, 200);
  });
  await test("reference canonique et champs HTTP ignores", async () => {
    const decoy = await fixture(), f = await fixture({ id: decoy.id }), otherBefore = await stored(decoy.id);
    equal((await link(body(f.id, { id: decoy.id, total: 1, customerEmail: "attacker@example.test", beneficiaryId: "forged", paymentStatus: "paid" }), {
      send: async (order, request) => { equal(order.id, f.id); equal(order.customerEmail, "synthetic@example.test"); equal(request.paymentLinkAmount, 100); return accepted; },
    })).status, 200); eq(await stored(decoy.id), otherBefore);
    equal((await requests(f.id))[0].orderId, f.id);
  });
  for (const change of [{ paymentLinkAmount: 1 }, { paymentLinkCurrency: "USD" }, { paymentLinkUrl: "https://buy.stripe.com.evil.test/link" }, { paymentLinkUrl: "https://buy.stripe.com@evil.test/link" }, { paymentLinkUrl: "file:///test" }]) await test(`montant et URL refuses : ${Object.keys(change)[0]} ${count}`, async () => {
    const f = await fixture(), start = sends; ok((await link(body(f.id, change))).status >= 400); equal(sends, start);
  });
  await test("doublons simultanes, puis repetition connue", async () => {
    const f = await fixture(), b = body(f.id), entered = gate(), release = gate(), start = sends;
    const first = link(b, { send: async () => { entered.release(); await release.promise; return accepted; } });
    await entered.promise;
    try { const duplicate = await link(b); equal(duplicate.delivery?.status, "sending"); equal(sends, start + 1); }
    finally { release.release(); }
    equal((await first).status, 200); equal((await link(b)).delivery?.existing, true); equal(sends, start + 1);
  });
  await test("identifiants concurrents differents : une intention courante", async () => {
    const f = await fixture(), entered = gate(), release = gate(), start = sends;
    const first = link(body(f.id), { send: async () => { entered.release(); await release.promise; return accepted; } }); await entered.promise;
    try { equal((await link(body(f.id))).status, 409); equal(sends, start + 1); } finally { release.release(); }
    await first;
  });
  await test("meme identifiant, changement lien/label/montant/intention/destinataire : conflits", async () => {
    const f = await fixture(), b = body(f.id); await link(b); const start = sends;
    for (const changes of [{ paymentLinkUrl: url + "2" }, { paymentLinkLabel: "changed" }, { paymentLinkAmount: 99 }, { intent: "resend" }]) equal((await link({ ...b, ...changes })).code, "payment_link_request_conflict");
    await db.collection("orders").doc(f.id).update({ customerEmail: "new@example.test" });
    equal((await link(b)).code, "payment_link_request_conflict"); equal(sends, start);
  });
  await test("callback Firestore rejoue, aucune emission avant commit", async () => {
    const f = await fixture(), start = sends; const r = await link(body(f.id), { retryReservation: true });
    equal(r.status, 200); equal(r.stats.callbacks, 4); equal(sends, start + 1); equal((await requests(f.id))[0].attempts, 1);
  });
  await test("echec certain : trace not_sent, meme intention non relancee", async () => {
    const f = await fixture(), b = body(f.id), before = await ledger(), start = sends;
    const r = await link(b, { send: async () => ({ status: "failed", reason: "provider_rejected", statusCode: 422 }) });
    equal(r.status, 502); equal(r.delivery?.transportStatus, "not_sent"); equal((await stored(f.id)).paymentLinkSent, false);
    equal((await link(b)).status, 502); equal(sends, start + 1); eq(await ledger(), before);
    equal((await link(body(f.id))).status, 200); // New explicit initial attempt after a certain rejection.
  });
  await test("acceptation possible, reponse perdue : unknown sans relance meme apres delai", async () => {
    const f = await fixture(), b = body(f.id), start = sends;
    const r = await link(b, { send: async () => { throw new Error("Synthetic response lost after possible acceptance"); } });
    equal(r.delivery?.status, "unknown"); equal(r.delivery?.transportStatus, "unknown");
    equal((await link(b, { now: () => Date.now() + 999999 })).delivery?.status, "unknown");
    equal((await link(body(f.id))).code, "delivery_result_requires_verification"); equal(sends, start + 1);
  });
  await test("acceptation puis finalisation avortee : reprise sans nouvel appel", async () => {
    const f = await fixture(), b = body(f.id), start = sends;
    const failed = await link(b, { failTransaction: 3 }); equal(failed.status, 202);
    equal(failed.delivery?.errorCode, "delivery_finalization_requires_verification"); equal(failed.delivery?.transportStatus, "accepted");
    const state = (await requests(f.id))[0]; equal(state.status, "sending"); ok(state.dispatchStartedAt);
    const r = await link(b, { now: () => Date.now() + 999999 }); equal(r.delivery?.status, "unknown");
    equal(r.delivery?.errorCode, "delivery_result_requires_verification"); equal(sends, start + 1);
    equal((await stored(f.id)).paymentStatus, "to_confirm");
  });
  for (const [name, change] of [["paiement", pay], ["annulation", cancel]] as const) {
    await test(`${name} connu avant adaptateur : zero envoi`, async () => {
      const f = await fixture(), start = sends; let ledgerAfter: unknown;
      const r = await link(body(f.id), { beforeTransaction: async (index) => { if (index === 2) { await transition(f.id, change); ledgerAfter = await ledger(); } } });
      equal(sends, start); equal(r.delivery?.transportStatus, "not_sent"); ok(r.delivery?.errorCode?.endsWith("_before_provider_call")); eq(await ledger(), ledgerAfter);
    });
    await test(`${name} pendant appel : statut et journal preserves`, async () => {
      const f = await fixture(), entered = gate(), release = gate();
      const first = link(body(f.id), { send: async () => { entered.release(); await release.promise; return accepted; } }); await entered.promise;
      let after: unknown;
      try { await transition(f.id, change); after = await ledger(); } finally { release.release(); }
      const r = await first; equal(r.delivery?.status, "unknown"); equal(r.delivery?.transportStatus, "accepted");
      equal((await stored(f.id)).paymentStatus, change.paymentStatus); eq(await ledger(), after);
      equal((await requests(f.id))[0].providerId, accepted.id);
    });
  }
  for (const [name, changes] of [["lien", { paymentLinkUrl: url + "-changed" }], ["destinataire", { customerEmail: "new@example.test" }],
    ["contenu", { customerName: "Changed Name" }], ["intention", { paymentLinkDelivery: { requestId: randomUUID(), status: "pending" } }]] as const) await test(`changement concurrent ${name} : ancien transport trace seulement`, async () => {
      const f = await fixture(), before = await ledger();
      const r = await link(body(f.id), { send: async () => { await db.collection("orders").doc(f.id).update(changes); return accepted; } });
      equal(r.delivery?.status, "unknown"); equal(r.delivery?.transportStatus, "accepted"); equal(r.delivery?.errorCode, "payment_link_content_changed_after_provider_call");
      const current = await stored(f.id); equal(current.paymentLinkSent, false); equal(current.paymentStatus, "to_confirm");
      for (const [field, value] of Object.entries(changes)) eq(current[field], value);
      equal(current.paymentLinkDeliveryHistory[0].transportStatus, "accepted"); eq(await ledger(), before);
  });
  await test("changement de lien avant adaptateur : aucun appel", async () => {
    const f = await fixture(), start = sends; const r = await link(body(f.id), { beforeTransaction: async (index) => {
      if (index === 2) await db.collection("orders").doc(f.id).update({ paymentLinkUrl: url + "-new" });
    } }); equal(sends, start); equal(r.delivery?.transportStatus, "not_sent");
  });
  for (const phase of [1, 2]) await test(`echec avant commit phase ${phase} : pas envoi ni ecriture partielle`, async () => {
    const f = await fixture(), before = await stored(f.id), start = sends;
    equal((await link(body(f.id), { failTransaction: phase })).status, 500); equal(sends, start);
    if (phase === 1) { eq(await stored(f.id), before); equal((await requests(f.id)).length, 0); }
    else { equal((await requests(f.id))[0].dispatchStartedAt, undefined); equal((await stored(f.id)).paymentStatus, "to_confirm"); }
  });
  await test("commande ordinaire, lien prepare et renvoi explicite existant", async () => {
    const f = await fixture({ paymentLinkUrl: url }, false), start = sends, before = await ledger();
    equal((await link(body(f.id))).status, 200);
    equal((await link(body(f.id))).code, "resend_confirmation_required");
    equal((await link(body(f.id, { intent: "resend" }))).status, 200);
    equal(sends, start + 2); eq(await ledger(), before); equal(Object.hasOwn(await stored(f.id), "cagnotte"), false);
    equal((await requests(f.id)).length, 2);
  });
  await test("finalisation commise, accuse perdu : reprise retourne sent sans appel", async () => {
    const f = await fixture(), b = body(f.id), start = sends;
    const first = await link(b, { afterTransaction: async (index) => { if (index === 3) throw new Error("Synthetic commit acknowledgement lost"); } });
    equal(first.delivery?.status, "unknown"); equal((await requests(f.id))[0].status, "sent");
    equal((await link(b)).delivery?.status, "sent"); equal(sends, start + 1);
  });
  await test("expiration pendant appel : pas de second proprietaire, finalisation originale possible", async () => {
    const f = await fixture(), b = body(f.id), entered = gate(), release = gate(), start = sends;
    const first = link(b, { send: async () => { entered.release(); await release.promise; return accepted; } }); await entered.promise;
    try {
      equal((await link(b, { now: () => Date.now() + 999999 })).delivery?.status, "unknown");
      equal((await link(body(f.id))).status, 409); equal(sends, start + 1);
    } finally { release.release(); }
    equal((await first).status, 200); equal(sends, start + 1);
  });
  await test("renvoi historique sans journal apres rejet certain conserve son intention", async () => {
    const f = await fixture({ paymentLinkSent: true, paymentLinkChannel: "email" }, false);
    equal((await link(body(f.id, { intent: "resend" }), { send: async () => ({ status: "failed", reason: "provider_rejected" }) })).status, 502);
    equal((await link(body(f.id))).code, "resend_confirmation_required");
    equal((await link(body(f.id, { intent: "resend" }))).status, 200);
  });
  await test("gains anterieurs en attente puis disponibles preserves par les envois", async () => {
    const previous = await fixture(); await transition(previous.id, pay);
    const next = await fixture(); const enrollment = (await stored(next.id)).cagnotte;
    enrollment.beneficiaryId = previous.uid;
    await db.collection("orders").doc(next.id).update({ customerId: previous.uid, cagnotte: enrollment });
    let before = await ledger(); equal((await link(body(next.id))).status, 200); eq(await ledger(), before);
    eq(await balances(previous.uid), [500, 0, 0]);
    await transition(previous.id, { orderStatus: "delivered" }); before = await ledger();
    equal((await link(body(next.id, { intent: "resend" }))).status, 200); eq(await ledger(), before);
    eq(await balances(previous.uid), [0, 500, 0]);
  });
  console.log(`Liens cagnotte 2E : ${count} cas reussis, ${sends} appels simules, zero service reel.`);
} finally { await db.terminate(); }
