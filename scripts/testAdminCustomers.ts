import { equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { connectCagnotteEmulator, CAGNOTTE_DEMO } from "./cagnotteEmulator.js";
import { AdminCustomerError, commitCustomerMutation, createAdminCustomerHandler, parseCustomerMutation, readCustomerActivity, readCustomerIdentity, readCustomerLegacyLoyalty, readCustomerList, readCustomerMetadata, readCustomerOrders, readCustomerReferral, readCustomerSummary } from "../api/_server/adminCustomers.js";
import { REFERRAL_CLOSED_RUNTIME } from "../api/_server/referralRuntimeConfig.js";
import type { CustomerMutation } from "../src/types/adminCustomers.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
const db = await connectCagnotteEmulator(CAGNOTTE_DEMO); let checks = 0;
const test = async (name: string, run: () => Promise<unknown>) => { await run(); checks++; console.log(`PASS ${name}`); };
const invalid = (code: string) => (error: unknown) => error instanceof AdminCustomerError && error.code === code;
const adminUid = "clients-admin";
async function setup() { const key = `client-${randomUUID()}`; const ref = db.collection("customers").doc(key); await ref.set({ uid: key, displayName: "Alice locale", email: `${key}@example.test`, phone: "0601020304", status: "active", archived: false, hidden: false, loyaltyPoints: 7, orderCount: 999, totalSpent: 9999, internalNote: "ancienne note", role: "customer", createdAt: FieldValue.serverTimestamp() }); return { ref, customer: await readCustomerIdentity(db, key) }; }
function operation(customerId: string, fields: Omit<Extract<CustomerMutation, { kind: "metadata" }>, "customerId" | "expectedRevision">, expectedRevision = 0) { return { customerId, expectedRevision, operationId: randomUUID(), ...fields }; }
async function atTime<T>(instant: string, run: () => Promise<T>): Promise<T> {
  const now = Date.parse(instant);
  ok(Number.isFinite(now));
  const originalNow = Date.now;
  Date.now = () => now;
  try { return await run(); } finally { Date.now = originalNow; }
}
async function promoFixture(fields: Record<string, unknown> = {}) {
  const fixture = await setup();
  const couponId = `coupon-${randomUUID()}`;
  const coupon = db.collection("coupons").doc(couponId);
  await coupon.set({ code: "CLIENT10", isActive: true, ...fields });
  const input: Extract<CustomerMutation, { kind: "promo" }> & { operationId: string } = {
    customerId: fixture.customer.id, expectedRevision: 0, operationId: randomUUID(),
    kind: "promo", couponId, reason: "Suivi privé",
  };
  return { ...fixture, coupon, input };
}
async function assignPromoAt(fields: Record<string, unknown>, instant: string, allowed: boolean) {
  const fixture = await promoFixture(fields);
  const mutation = () => commitCustomerMutation(db, fixture.input, adminUid);
  if (allowed) {
    const result = await atTime(instant, mutation);
    equal(result.revision, 1);
    equal(result.replayed, false);
  } else {
    await rejects(atTime(instant, mutation), invalid("coupon_unavailable"));
  }
  const profile = (await fixture.ref.get()).data()!;
  const meta = await readCustomerMetadata(db, fixture.customer, null);
  equal(profile.assignedPromos?.length ?? 0, allowed ? 1 : 0);
  equal(meta.revision, allowed ? 1 : 0);
  equal(meta.audit.items.length, allowed ? 1 : 0);
  equal(profile.internalNote, "ancienne note");
  equal(JSON.stringify(profile).includes("Suivi privé"), false);
  equal((await db.collection("customerAdminAudit").doc(fixture.input.operationId).get()).exists, allowed);
  if (allowed) {
    equal(profile.assignedPromos[0].couponId, fixture.input.couponId);
    equal(profile.assignedPromos[0].assignedBy, adminUid);
    equal(profile.assignedPromos[0].code, "CLIENT10");
  }
}
async function call(action: string, token: string | null, params: Record<string, string> = {}, operationValue?: unknown) {
  let status = 200; let body: Record<string, unknown> = {}; const headers: Record<string, string> = {};
  const handler = createAdminCustomerHandler({ getDb: () => db, verifyToken: async (value) => ({ uid: value, email: null }), referralRuntime: () => REFERRAL_CLOSED_RUNTIME });
  const res = { setHeader(key: string, value: string) { headers[key] = value; }, status(value: number) { status = value; return this; }, json(value: Record<string, unknown>) { body = value; } };
  await handler({ method: operationValue ? "POST" : "GET", headers: token ? { authorization: `Bearer ${token}` } : {}, url: `/api/invoices?${new URLSearchParams({ action, ...params })}`, body: operationValue ? { action, operation: operationValue } : undefined } as VercelRequestLike, res as unknown as VercelResponseLike);
  return { status, body, headers };
}
try {
  await db.collection("adminUsers").doc(adminUid).set({ isActive: true });
  await test("API admin obligatoire, session absente, profil absent, méthodes/actions séparées", async () => { const f = await setup(); equal((await call("adminCustomerSummary", null, { customerId: f.customer.id })).status, 401); equal((await call("adminCustomerSummary", "ordinary", { customerId: f.customer.id })).status, 403); equal((await call("adminCustomerSummary", adminUid, { customerId: "missing-client" })).status, 404); equal((await call("adminCustomerMutate", adminUid)).status, 400); equal((await call("adminCustomerUnknown", adminUid)).status, 400); const response = await call("adminCustomerSummary", adminUid, { customerId: f.customer.id }); equal(response.status, 200); equal(response.headers["Cache-Control"], "private, no-store"); });
  await test("notes privées, tags et audit atomiques, ancienne note conservée", async () => { const f = await setup(); const input = operation(f.customer.id, { kind: "metadata", note: "Note privée", tags: ["suivi"] }); await commitCustomerMutation(db, input, adminUid); equal((await f.ref.get()).data()?.internalNote, "ancienne note"); const meta = await readCustomerMetadata(db, f.customer, null); equal(meta.note, "Note privée"); equal(meta.tags[0], "suivi"); equal(meta.revision, 1); equal(meta.updatedBy, adminUid); ok(meta.updatedAt); equal(meta.audit.items.length, 1); equal(meta.audit.items[0].adminUid, adminUid); ok(meta.audit.items[0].date); equal(JSON.stringify(meta.audit.items).includes("Note privée"), false); });
  await test("journal admin paginé et curseur lié au profil", async () => { const f = await setup(); const batch = db.batch(); for (let index = 0; index < 23; index++) batch.set(db.collection("customerAdminAudit").doc(randomUUID()), { customerId: f.customer.id, action: "fixture_read", adminUid, createdAt: FieldValue.serverTimestamp(), reason: "", before: {}, after: {} }); await batch.commit(); const first = await readCustomerMetadata(db, f.customer, null); equal(first.audit.items.length, 20); ok(first.audit.nextCursor); const second = await readCustomerMetadata(db, f.customer, first.audit.nextCursor); equal(second.audit.items.length, 3); await rejects(readCustomerMetadata(db, (await setup()).customer, first.audit.nextCursor), invalid("invalid_cursor")); });
  await test("rejeu idempotent et changement d’identité/payload rejeté", async () => { const f = await setup(); const input = operation(f.customer.id, { kind: "metadata", note: "A", tags: [] }); await commitCustomerMutation(db, input, adminUid); equal((await commitCustomerMutation(db, input, adminUid)).replayed, true); equal((await readCustomerMetadata(db, f.customer, null)).audit.items.length, 1); await rejects(commitCustomerMutation(db, { ...input, note: "B" }, adminUid), invalid("operation_conflict")); await rejects(commitCustomerMutation(db, input, "other-admin"), invalid("operation_conflict")); });
  await test("révisions concurrentes : une seule note et un audit", async () => { const f = await setup(); const results = await Promise.allSettled([commitCustomerMutation(db, operation(f.customer.id, { kind: "metadata", note: "A", tags: [] }), adminUid), commitCustomerMutation(db, operation(f.customer.id, { kind: "metadata", note: "B", tags: [] }), adminUid)]); equal(results.filter((result) => result.status === "fulfilled").length, 1); equal((await readCustomerMetadata(db, f.customer, null)).audit.items.length, 1); });
  await test("statut courant contrôlé, archivage/restauration et motif journalisés", async () => { const f = await setup(); const input = { customerId: f.customer.id, expectedRevision: 0, operationId: randomUUID(), kind: "status", status: "archived", archived: true, hidden: false, expectedStatus: "active", expectedArchived: false, expectedHidden: false, reason: "Doublon à examiner" }; await commitCustomerMutation(db, input, adminUid); const profile = (await f.ref.get()).data()!; equal(profile.archived, true); equal(profile.archivedBy, adminUid); ok(profile.archivedAt.toDate()); await rejects(commitCustomerMutation(db, { ...input, operationId: randomUUID(), expectedRevision: 1 }, adminUid), invalid("customer_conflict")); await commitCustomerMutation(db, { ...input, operationId: randomUUID(), expectedRevision: 1, expectedStatus: "archived", expectedArchived: true, archived: false, status: "active" }, adminUid); equal((await f.ref.get()).data()?.archivedAt, null); equal((await readCustomerMetadata(db, f.customer, null)).audit.items.length, 2); });
  await test("points historiques transactionnels, aucune mutation de cagnotte", async () => { const f = await setup(); const input = { customerId: f.customer.id, expectedRevision: 0, operationId: randomUUID(), kind: "points", expectedPoints: 7, targetPoints: 9, reason: "Correction historique" }; await commitCustomerMutation(db, input, adminUid); await commitCustomerMutation(db, input, adminUid); equal((await f.ref.get()).data()?.loyaltyPoints, 9); equal((await f.ref.get()).data()?.internalNote, "ancienne note"); const ledger = await readCustomerLegacyLoyalty(db, await readCustomerIdentity(db, f.customer.id), null); equal(ledger.points, 9); equal(ledger.items.length, 1); equal(ledger.items[0].points, 2); equal((await db.collection("cagnotteWallets").doc(f.customer.uid).get()).exists, false); });
  await test("ancien historique de points préservé sans migration", async () => { const f = await setup(); await f.ref.update({ loyaltyHistory: [{ points: 2, reason: "ancienne récompense", createdAt: "2026-09-01" }] }); const result = await readCustomerLegacyLoyalty(db, f.customer, null); equal(result.source, "profile_history"); equal(result.items.length, 1); equal(result.items[0].reason, "ancienne récompense"); });
  await test("échec journal : rollback note, statut et points", async () => { const f = await setup(); const broken = { collection: db.collection.bind(db), runTransaction: (callback: (tx: Transaction) => Promise<unknown>) => db.runTransaction((tx) => callback(new Proxy(tx, { get(target, key) { if (key === "create") return () => { throw new Error("audit_failure"); }; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } }))) } as unknown as Firestore; await rejects(commitCustomerMutation(broken, operation(f.customer.id, { kind: "metadata", note: "Lost", tags: [] }), adminUid), /audit_failure/); equal((await db.collection("customerAdminMetadata").doc(f.customer.id).get()).exists, false); equal((await f.ref.get()).data()?.internalNote, "ancienne note"); });
  await test("payload strict : auteur forgé, champs arbitraires, motif, tags, points et identifiants", async () => { const f = await setup(); const input = operation(f.customer.id, { kind: "metadata", note: "A", tags: [] }); for (const patch of [{ adminUid: "forged" }, { kind: "generic", path: "cagnotteWallets/x" }, { note: "a".repeat(4001) }, { tags: [""] }, { customerId: "bad/id" }, { expectedRevision: -1 }]) await rejects(commitCustomerMutation(db, { ...input, ...patch }, adminUid), (error) => error instanceof AdminCustomerError); await rejects(commitCustomerMutation(db, { ...input, kind: "points", note: undefined, tags: undefined, reason: "", targetPoints: -1 }, adminUid), (error) => error instanceof AdminCustomerError); equal((await call("adminCustomerMutate", adminUid, {}, { ...input, adminUid: "forged" })).status, 400); ok(parseCustomerMutation(input)); });
  await test("profils protégés exclus et toute mutation refusée", async () => { const f = await setup(); await f.ref.update({ productionFixture: {} }); await rejects(readCustomerIdentity(db, f.customer.id), invalid("protected_customer")); await rejects(commitCustomerMutation(db, operation(f.customer.id, { kind: "metadata", note: "A", tags: [] }), adminUid), invalid("protected_customer")); equal((await readCustomerList(db, null)).items.some((customer) => customer.id === f.customer.id), false); });
  await test("liste bornée et paginée sans méta privée en sortie", async () => { const batch = db.batch(); for (let index = 0; index < 53; index++) batch.set(db.collection("customers").doc(`zz-client-${index.toString().padStart(2, "0")}`), { uid: `zz-client-${index}`, displayName: `Client ${index}`, role: "customer" }); await batch.commit(); const first = await readCustomerList(db, null); equal(first.items.length <= 50, true); ok(first.nextCursor); const second = await readCustomerList(db, first.nextCursor); ok(second.items.length > 0); equal(first.items.some((item) => second.items.some((other) => item.id === other.id)), false); equal(JSON.stringify(first).includes("Note privée"), false); });
  await test("UID confirmé, rapprochement email, autre UID exclu même email", async () => { const f = await setup(); for (const [suffix, fields] of [["confirmed", { customerId: f.customer.uid, customerEmail: "other" }], ["probable", { customerEmail: f.customer.email }], ["foreign", { customerId: "someone-else", customerEmail: f.customer.email }]] as const) await db.collection("orders").doc(`${f.customer.id}-${suffix}`).set({ ...fields, total: 10, createdAt: "2026-09-01" }); const page = await readCustomerOrders(db, f.customer, null, true); equal(page.items.length, 2); equal(page.items.find((order) => order.id.endsWith("probable"))?.confidence, "probable"); const summary = await readCustomerSummary(db, f.customer.id); equal(summary.metrics.count, 1); equal(summary.metrics.orderedCents, 1000); equal(summary.metrics.paidCents, null); equal(summary.metrics.netCents, null); });
  await test("pagination commandes et métriques inconnues sur historique partiel", async () => { const f = await setup(); const batch = db.batch(); for (let index = 0; index < 23; index++) batch.set(db.collection("orders").doc(`${f.customer.id}-${String(index).padStart(2, "0")}`), { customerId: f.customer.uid, total: 10, createdAt: "2026-09-01" }); await batch.commit(); const first = await readCustomerOrders(db, f.customer, null); equal(first.items.length, 20); ok(first.nextCursor); const last = await readCustomerOrders(db, f.customer, first.nextCursor); equal(last.items.length, 3); equal(last.nextCursor, null); equal((await readCustomerSummary(db, f.customer.id)).metrics.orderedCents, null); await rejects(readCustomerOrders(db, (await setup()).customer, first.nextCursor), invalid("invalid_cursor")); });
  await test("parrainage off ne crée ni code ni relation", async () => { const f = await setup(); const data = await readCustomerReferral(db, f.customer, null, REFERRAL_CLOSED_RUNTIME); equal(data.mode, "off"); equal(data.items.length, 0); equal((await db.collection("referralCodes").doc(`owner_${f.customer.uid}`).get()).exists, false); });
  await test("parrainage actif et historique off : parrain, filleuls paginés, projection sans identité HMAC", async () => { const f = await setup(); await db.collection("referralCodes").doc(`owner_${f.customer.uid}`).set({ ownerUid: f.customer.uid, code: "EXISTING" }); await db.collection("referrals").doc(f.customer.uid).set({ refereeUid: f.customer.uid, sponsorUid: "sponsor", state: "linked", rewardCompartment: "none", linkedAtEpochMs: Date.now() - 1000, secret: "NEVER_PROJECT" }); const batch = db.batch(); for (let index = 0; index < 22; index++) batch.set(db.collection("referrals").doc(`${f.customer.id}-${index.toString().padStart(2, "0")}`), { schemaVersion: 1, programVersion: "referral-commercial-policy-v1", refereeUid: `child-${index}`, sponsorUid: f.customer.uid, state: "pending", qualifyingOrderId: "qualifier", rewardCompartment: "pending", linkedAtEpochMs: Date.now() - 1000 }); await batch.commit(); const runtime = { mode: "active" as const, operational: true, startsAtEpochMs: 1 }; const first = await readCustomerReferral(db, f.customer, null, runtime); equal(first.code, "EXISTING"); equal(first.sponsor?.sponsorUid, "sponsor"); equal(first.items.length, 20); equal(first.items[0].rewardCents, 1000); equal(JSON.stringify(first).includes("NEVER_PROJECT"), false); equal((await readCustomerReferral(db, f.customer, first.nextCursor, runtime)).items.length, 2); const off = await readCustomerReferral(db, f.customer, null, REFERRAL_CLOSED_RUNTIME); equal(off.mode, "off"); equal(off.items.length, 20); });
  await test("activité réelle limitée à l’UID, dates absentes et données sensibles omises", async () => { const f = await setup(); for (const [kind, collection] of [["favorites", "favorites"], ["reviews", "productReviews"], ["comments", "blogArticleComments"]] as const) { await db.collection(collection).doc(`${f.customer.id}-event`).set({ userId: f.customer.uid, productName: "Produit", text: "Commentaire réel", comment: "Avis réel", slug: "test", secret: "PRIVATE_OMITTED" }); await db.collection(collection).doc(`${f.customer.id}-foreign`).set({ userId: "other", customerEmail: f.customer.email }); const data = await readCustomerActivity(db, f.customer, kind, null); equal(data.items.length, 1); equal(data.items[0].date, null); equal(JSON.stringify(data).includes("PRIVATE_OMITTED"), false); } await rejects(readCustomerActivity(db, f.customer, "tracking", null), invalid("invalid_activity")); });
  await test("promotion existante : suivi uniquement, code vérifié, motif privé", async () => { const f = await setup(); const couponId = `coupon-${randomUUID()}`; await db.collection("coupons").doc(couponId).set({ code: "CLIENT10", isActive: true }); await commitCustomerMutation(db, { customerId: f.customer.id, expectedRevision: 0, operationId: randomUUID(), kind: "promo", couponId, reason: "Suivi privé" }, adminUid); const data = (await f.ref.get()).data()!; equal(data.assignedPromos[0].code, "CLIENT10"); equal(JSON.stringify(data.assignedPromos).includes("Suivi privé"), false); equal(data.internalNote, "ancienne note"); });
  await test("coupon date-only : milieu de la dernière journée de Paris autorisé", async () => {
    await assignPromoAt({ endsAt: "2026-09-29" }, "2026-09-29T12:00:00+02:00", true);
  });
  await test("coupon date-only : dernière milliseconde de la journée de Paris incluse", async () => {
    await assignPromoAt({ endsAt: "2026-09-29" }, "2026-09-29T23:59:59.999+02:00", true);
  });
  await test("coupon date-only : première milliseconde du lendemain refusée sans mutation", async () => {
    await assignPromoAt({ endsAt: "2026-09-29" }, "2026-09-30T00:00:00.000+02:00", false);
  });
  await test("coupon ISO explicite : timestamp exact inclus, milliseconde suivante refusée", async () => {
    const fields = { endsAt: "2026-09-29T15:45:00.123+02:00" };
    await assignPromoAt(fields, "2026-09-29T13:45:00.122Z", true);
    await assignPromoAt(fields, "2026-09-29T13:45:00.123Z", true);
    await assignPromoAt(fields, "2026-09-29T13:45:00.124Z", false);
  });
  await test("coupon sans expiration : attribution inchangée à horloge fixe", async () => {
    await assignPromoAt({}, "2026-09-29T12:00:00+02:00", true);
  });
  await test("coupon inactif : refus conservé", async () => {
    await assignPromoAt({ isActive: false, endsAt: "2026-09-29" }, "2026-09-29T12:00:00+02:00", false);
  });
  await test("coupon archived : refus conservé", async () => {
    await assignPromoAt({ archived: true, endsAt: "2026-09-29" }, "2026-09-29T12:00:00+02:00", false);
  });
  await test("coupon isArchived : refus conservé", async () => {
    await assignPromoAt({ isArchived: true, endsAt: "2026-09-29" }, "2026-09-29T12:00:00+02:00", false);
  });
  await test("coupon date-only en hiver : fin de journée de Paris à UTC+01 incluse", async () => {
    const fields = { endsAt: "2026-12-15" };
    await assignPromoAt(fields, "2026-12-15T12:00:00+01:00", true);
    await assignPromoAt(fields, "2026-12-15T23:59:59.999+01:00", true);
    await assignPromoAt(fields, "2026-12-16T00:00:00.000+01:00", false);
  });
  await test("coupon Timestamp Firestore : sémantique exacte historique conservée", async () => {
    const fields = { endsAt: Timestamp.fromDate(new Date("2026-09-29T13:45:00.123Z")) };
    await assignPromoAt(fields, "2026-09-29T13:45:00.123Z", true);
    await assignPromoAt(fields, "2026-09-29T13:45:00.124Z", false);
  });
  await test("expiration zéro et date invalide : comportements historiques conservés", async () => {
    await assignPromoAt({ endsAt: "1970-01-01T00:00:00.000Z" }, "2026-09-29T12:00:00+02:00", false);
    await assignPromoAt({ endsAt: "invalid-date" }, "2026-09-29T12:00:00+02:00", true);
  });
  await test("coupon inexistant ou sans code : refus sans révision ni audit", async () => {
    await assignPromoAt({ code: "" }, "2026-09-29T12:00:00+02:00", false);
    const fixture = await promoFixture();
    await fixture.coupon.delete();
    await rejects(atTime("2026-09-29T12:00:00+02:00", () => commitCustomerMutation(db, fixture.input, adminUid)), invalid("coupon_unavailable"));
    equal((await fixture.ref.get()).data()?.assignedPromos, undefined);
    equal((await readCustomerMetadata(db, fixture.customer, null)).revision, 0);
    equal((await db.collection("customerAdminAudit").doc(fixture.input.operationId).get()).exists, false);
  });
  await test("attribution : révision, rejeu après expiration, doublon et audit conservés", async () => {
    const fixture = await promoFixture({ endsAt: "2026-09-29" });
    await atTime("2026-09-29T12:00:00+02:00", () => commitCustomerMutation(db, fixture.input, adminUid));
    await rejects(atTime("2026-09-29T12:00:00+02:00", () => commitCustomerMutation(db, { ...fixture.input, operationId: randomUUID() }, adminUid)), invalid("customer_conflict"));
    await rejects(atTime("2026-09-29T12:00:00+02:00", () => commitCustomerMutation(db, { ...fixture.input, expectedRevision: 1, operationId: randomUUID() }, adminUid)), invalid("no_change"));
    const replay = await atTime("2026-09-30T00:00:00.000+02:00", () => commitCustomerMutation(db, fixture.input, adminUid));
    equal(replay.replayed, true);
    equal(replay.revision, 1);
    await rejects(atTime("2026-09-29T12:00:00+02:00", () => commitCustomerMutation(db, { ...fixture.input, reason: "Autre motif" }, adminUid)), invalid("operation_conflict"));
    await rejects(atTime("2026-09-29T12:00:00+02:00", () => commitCustomerMutation(db, fixture.input, "other-admin")), invalid("operation_conflict"));
    const meta = await readCustomerMetadata(db, fixture.customer, null);
    equal(meta.revision, 1);
    equal(meta.audit.items.length, 1);
    equal((await fixture.ref.get()).data()?.assignedPromos.length, 1);
    const audit = (await db.collection("customerAdminAudit").doc(fixture.input.operationId).get()).data()!;
    equal(audit.adminUid, adminUid);
    equal(audit.reason, "Suivi privé");
    equal(audit.before.promoCount, 0);
    equal(audit.after.promoCount, 1);
  });
  await test("attribution de suivi : startsAt et quota ne deviennent pas de nouvelles règles", async () => {
    await assignPromoAt({ endsAt: "2026-09-29", startsAt: "2026-12-31", maxUses: 1, usedCount: 1 }, "2026-09-29T12:00:00+02:00", true);
  });
  console.log(`${checks} groupes de contrôles API/transactions Clients V2 validés sur émulateur uniquement.`);
} finally { await db.terminate(); }
