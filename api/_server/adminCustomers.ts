import { createHash } from "node:crypto";
import { FieldPath, FieldValue, Filter, type Firestore, type Query } from "firebase-admin/firestore";
import { assertAdminUser, firebaseAuthHttpFailure, verifyFirebaseIdToken } from "./adminAuth.js";
import { getAdminDb } from "./firebaseAdmin.js";
import { getReferralRuntime, type ReferralRuntime } from "./referralRuntimeConfig.js";
import { sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import { REFERRAL_PROGRAM_VERSION, REFERRAL_SPONSOR_REWARD_CENTS } from "../../src/types/referral.js";
import { commercialMetrics, customerStatus, knownDate, knownInteger, matchCustomerOrder, projectCustomerOrder } from "../../src/lib/adminCustomersV2.js";
import { exactEuroCents } from "../../src/lib/orderFinancing.js";
import type { CustomerActivityItem, CustomerAudit, CustomerIdentity, CustomerLegacyLoyalty, CustomerMetadata, CustomerMutation, CustomerPage, CustomerReferralRelation, CustomerSummary } from "../../src/types/adminCustomers.js";

type Data = Record<string, unknown>;
export class AdminCustomerError extends Error { constructor(readonly code: string, message: string, readonly status = 400) { super(message); } }
const text = (value: unknown) => typeof value === "string" ? value : "";
function id(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9@._+-]{1,128}$/.test(value)) throw new AdminCustomerError("invalid_id", "Identifiant invalide."); return value; }
function revision(value: unknown): number { const result = knownInteger(value); if (result === null) throw new AdminCustomerError("invalid_revision", "Révision invalide."); return result; }
function metadata(data: Data = {}): Omit<CustomerMetadata, "audit"> {
  return { revision: revision(data.revision ?? 0), note: text(data.note), tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string") : [], updatedAt: knownDate(data.updatedAt), updatedBy: text(data.updatedBy) || null };
}
function identity(key: string, data: Data, meta: Data = {}): CustomerIdentity {
  if (Object.hasOwn(data, "productionFixture")) throw new AdminCustomerError("protected_customer", "Profil protégé exclu de Clients V2.", 403);
  let historicalOrderedCents: number | null = null;
  try { historicalOrderedCents = exactEuroCents(data.totalSpent); } catch { /* Historical counter missing. */ }
  return { id: key, uid: text(data.uid) || key, name: text(data.displayName), email: text(data.email), phone: text(data.phone), status: customerStatus(data.status), archived: data.archived === true, hidden: data.hidden === true,
    createdAt: knownDate(data.createdAt), points: knownInteger(data.loyaltyPoints), historicalOrderCount: knownInteger(data.orderCount), historicalOrderedCents, historicalNote: text(data.internalNote),
    hasNote: !!text(meta.note).trim() || !!text(data.internalNote).trim(), hasPromo: Array.isArray(data.assignedPromos) && data.assignedPromos.some((promo) => !!promo && typeof promo === "object" && "isActive" in promo && promo.isActive === true),
    promos: Array.isArray(data.assignedPromos) ? (data.assignedPromos as Data[]).filter((promo) => promo && typeof promo === "object" && text(promo.code)).map((promo) => ({ code: text(promo.code), isActive: promo.isActive === true, assignedAt: knownDate(promo.assignedAt) })) : [], tags: metadata(meta).tags };
}
export async function readCustomerIdentity(db: Firestore, key: unknown): Promise<CustomerIdentity> {
  const customerId = id(key); const [profile, meta] = await db.getAll(db.collection("customers").doc(customerId), db.collection("customerAdminMetadata").doc(customerId));
  if (!profile.exists) throw new AdminCustomerError("customer_missing", "Client introuvable.", 404);
  return identity(customerId, profile.data()!, meta.data());
}
function decodeCursor(raw: unknown, scope: string): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 1000) throw new AdminCustomerError("invalid_cursor", "Curseur invalide.");
  try { const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); if (parsed.scope !== scope) throw new Error(); return id(parsed.after); }
  catch { throw new AdminCustomerError("invalid_cursor", "Curseur invalide pour cette fiche."); }
}
function encodeCursor(scope: string, after: string): string { return Buffer.from(JSON.stringify({ scope, after })).toString("base64url"); }
async function page(query: Query, scope: string, raw: unknown, limit = 20) {
  const after = decodeCursor(raw, scope); let bounded = query.orderBy(FieldPath.documentId()).limit(limit + 1); if (after) bounded = bounded.startAfter(after);
  const result = await bounded.get(); const docs = result.docs.slice(0, limit);
  return { docs, nextCursor: result.size > limit ? encodeCursor(scope, docs.at(-1)!.id) : null };
}
export async function readCustomerList(db: Firestore, rawCursor: unknown): Promise<CustomerPage<CustomerIdentity>> {
  const result = await page(db.collection("customers"), "list", rawCursor, 50);
  const refs = result.docs.map((doc) => db.collection("customerAdminMetadata").doc(doc.id)); const metas = refs.length ? await db.getAll(...refs) : [];
  return { items: result.docs.flatMap((doc, index) => Object.hasOwn(doc.data(), "productionFixture") ? [] : [identity(doc.id, doc.data(), metas[index]?.data())]), nextCursor: result.nextCursor };
}
export async function readCustomerOrders(db: Firestore, customer: CustomerIdentity, cursor: unknown, probable = false) {
  const filters = [Filter.where("customerId", "==", customer.uid)];
  if (probable && customer.email) { filters.push(Filter.where("customerEmail", "==", customer.email)); filters.push(Filter.where("customerEmailNormalized", "==", customer.email.trim().toLowerCase())); }
  if (probable && customer.phone) filters.push(Filter.where("customerPhone", "==", customer.phone));
  const result = await page(db.collection("orders").where(Filter.or(...filters)), `${customer.id}:orders:${probable}`, cursor);
  return { items: result.docs.flatMap((doc) => { const data = doc.data(); const link = matchCustomerOrder(customer, data); return !Object.hasOwn(data, "productionFixture") && link ? [projectCustomerOrder(doc.id, data, link)] : []; }), nextCursor: result.nextCursor };
}
export async function readCustomerSummary(db: Firestore, key: unknown): Promise<CustomerSummary> {
  const customer = await readCustomerIdentity(db, key); const orders = await readCustomerOrders(db, customer, null);
  const metrics = commercialMetrics(orders.items, !orders.nextCursor);
  return { customer, metrics, lastActivityAt: metrics.lastOrderAt, activityScope: "Commandes liées par UID consultées ; les autres événements sont chargés dans Activité. La date est limitée à ce périmètre." };
}
function projectAudit(key: string, data: Data): CustomerAudit { return { id: key, action: text(data.action), adminUid: text(data.adminUid), date: knownDate(data.createdAt), reason: text(data.reason), before: (data.before || {}) as Data, after: (data.after || {}) as Data }; }
export async function readCustomerMetadata(db: Firestore, customer: CustomerIdentity, cursor: unknown): Promise<CustomerMetadata> {
  const [meta, audit] = await Promise.all([db.collection("customerAdminMetadata").doc(customer.id).get(), page(db.collection("customerAdminAudit").where("customerId", "==", customer.id), `${customer.id}:audit`, cursor)]);
  return { ...metadata(meta.data()), audit: { items: audit.docs.map((entry) => projectAudit(entry.id, entry.data())), nextCursor: audit.nextCursor } };
}
export async function readCustomerLegacyLoyalty(db: Firestore, customer: CustomerIdentity, cursor: unknown): Promise<CustomerLegacyLoyalty> {
  const result = await page(db.collection("loyaltyMovements").where("customerId", "==", customer.id), `${customer.id}:points`, cursor);
  if (!result.docs.length && !cursor) {
    const profile = await db.collection("customers").doc(customer.id).get(); const historical = profile.data()?.loyaltyHistory;
    if (Array.isArray(historical) && historical.length) return { points: customer.points, source: "profile_history", items: historical.slice(-20).reverse().map((entry: Data, index: number) => ({ id: `history-${index}`, points: typeof entry.points === "number" && Number.isSafeInteger(entry.points) ? entry.points : null, reason: text(entry.reason), date: knownDate(entry.createdAt) })), nextCursor: null };
  }
  return { points: customer.points, source: result.docs.length ? "movements" : "none", items: result.docs.map((doc) => { const data = doc.data(); return { id: doc.id, points: typeof data.points === "number" && Number.isSafeInteger(data.points) ? data.points : null, reason: text(data.reason), date: knownDate(data.createdAt) }; }), nextCursor: result.nextCursor };
}
function relation(key: string, data: Data): CustomerReferralRelation {
  const epoch = knownInteger(data.linkedAtEpochMs); const compartment = text(data.rewardCompartment) || null;
  const date = epoch !== null && Number.isFinite(new Date(epoch).getTime()) ? new Date(epoch).toISOString() : null;
  return { id: key, sponsorUid: text(data.sponsorUid) || null, refereeUid: text(data.refereeUid) || null, state: text(data.state) || null, orderId: text(data.qualifyingOrderId) || null,
    rewardCents: data.schemaVersion === 1 && data.programVersion === REFERRAL_PROGRAM_VERSION && (compartment === "pending" || compartment === "available") ? REFERRAL_SPONSOR_REWARD_CENTS : null, compartment, date, reason: text(data.rewardIneligibilityReason) || null };
}
export async function readCustomerReferral(db: Firestore, customer: CustomerIdentity, cursor: unknown, runtime: ReferralRuntime) {
  const enabled = runtime.operational && runtime.mode !== "off" && runtime.startsAtEpochMs !== null && Date.now() >= runtime.startsAtEpochMs;
  const [code, sponsor, children] = await Promise.all([db.collection("referralCodes").doc(`owner_${customer.uid}`).get(), db.collection("referrals").doc(customer.uid).get(), page(db.collection("referrals").where("sponsorUid", "==", customer.uid), `${customer.id}:referrals`, cursor)]);
  return { mode: enabled ? runtime.mode : "off" as const, code: code.data()?.ownerUid === customer.uid ? text(code.data()?.code) || null : null,
    sponsor: sponsor.exists && sponsor.data()?.refereeUid === customer.uid ? relation(sponsor.id, sponsor.data()!) : null,
    items: children.docs.map((doc) => relation(doc.id, doc.data())), nextCursor: children.nextCursor };
}
const activityKinds = ["orders", "favorites", "reviews", "comments"] as const;
export async function readCustomerActivity(db: Firestore, customer: CustomerIdentity, kind: unknown, cursor: unknown): Promise<CustomerPage<CustomerActivityItem>> {
  if (!activityKinds.includes(kind as CustomerActivityItem["kind"])) throw new AdminCustomerError("invalid_activity", "Type d’activité invalide.");
  const type = kind as CustomerActivityItem["kind"];
  const collections = { orders: "orders", favorites: "favorites", reviews: "productReviews", comments: "blogArticleComments" };
  const result = await page(db.collection(collections[type]).where(type === "orders" ? "customerId" : "userId", "==", customer.uid), `${customer.id}:activity:${type}`, cursor);
  return { items: result.docs.filter((doc) => !Object.hasOwn(doc.data(), "productionFixture")).map((doc) => {
    const data = doc.data(); const product = text(data.productName) || text(data.productId); const slug = text(data.slug);
    return { id: doc.id, kind: type, date: knownDate(data.createdAt), summary: type === "orders" ? `Commande ${doc.id.slice(0, 12)} · ${text(data.orderStatus) || "Non disponible"}` : type === "favorites" ? `Favori · ${product || "Non disponible"}` : type === "reviews" ? `Avis · ${product || "Non disponible"} · ${text(data.comment).slice(0, 200)}` : `Commentaire · ${text(data.text).slice(0, 200) || "Non disponible"}`,
      href: type === "orders" ? `/admin/commandes?search=${encodeURIComponent(doc.id)}` : type === "reviews" ? "/admin/avis" : type === "favorites" ? "/admin/favoris" : slug ? `/blog/${encodeURIComponent(slug)}` : null };
  }), nextCursor: result.nextCursor };
}
export function parseCustomerMutation(raw: unknown): CustomerMutation & { operationId: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AdminCustomerError("invalid_payload", "Opération invalide.");
  const value = raw as Data; const common = ["kind", "customerId", "expectedRevision", "operationId"];
  const fields: Record<string, string[]> = { metadata: ["note", "tags"], status: ["status", "archived", "hidden", "expectedStatus", "expectedArchived", "expectedHidden", "reason"], points: ["expectedPoints", "targetPoints", "reason"], promo: ["couponId", "reason"] };
  if (!Object.hasOwn(fields, text(value.kind)) || Object.keys(value).some((key) => ![...common, ...fields[text(value.kind)]].includes(key))) throw new AdminCustomerError("invalid_payload", "Champs non autorisés.");
  if (typeof value.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.operationId)) throw new AdminCustomerError("invalid_operation", "Opération invalide.");
  const base = { customerId: id(value.customerId), expectedRevision: revision(value.expectedRevision), operationId: value.operationId.toLowerCase() };
  if (value.kind === "metadata") {
    if (typeof value.note !== "string" || value.note.length > 4000 || !Array.isArray(value.tags) || value.tags.length > 12 || value.tags.some((tag) => typeof tag !== "string" || tag.trim().length < 1 || tag.trim().length > 40)) throw new AdminCustomerError("invalid_metadata", "Note (4 000 caractères) ou tags (12 de 40 caractères) invalides.");
    return { ...base, kind: "metadata", note: value.note.trim(), tags: [...new Set((value.tags as string[]).map((tag) => tag.trim()))] };
  }
  if (typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 500) throw new AdminCustomerError("reason_required", "Motif requis (500 caractères maximum).");
  const reason = value.reason.trim();
  if (value.kind === "points") return { ...base, kind: "points", reason, expectedPoints: revision(value.expectedPoints), targetPoints: revision(value.targetPoints) };
  if (value.kind === "promo") return { ...base, kind: "promo", reason, couponId: id(value.couponId) };
  if (!customerStatus(value.status) || (value.expectedStatus !== null && !customerStatus(value.expectedStatus)) || ["archived", "hidden", "expectedArchived", "expectedHidden"].some((key) => typeof value[key] !== "boolean") || (value.status === "archived") !== value.archived) throw new AdminCustomerError("invalid_status", "État client invalide.");
  return { ...base, kind: "status", reason, status: customerStatus(value.status)!, archived: value.archived as boolean, hidden: value.hidden as boolean, expectedStatus: customerStatus(value.expectedStatus), expectedArchived: value.expectedArchived as boolean, expectedHidden: value.expectedHidden as boolean };
}
export async function commitCustomerMutation(db: Firestore, raw: unknown, adminUid: string) {
  const input = parseCustomerMutation(raw); const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const profileRef = db.collection("customers").doc(input.customerId), metaRef = db.collection("customerAdminMetadata").doc(input.customerId), auditRef = db.collection("customerAdminAudit").doc(input.operationId);
  return db.runTransaction(async (tx) => {
    const [profile, meta, audit] = await tx.getAll(profileRef, metaRef, auditRef);
    if (!profile.exists) throw new AdminCustomerError("customer_missing", "Client introuvable.", 404);
    const current = identity(input.customerId, profile.data()!, meta.data()), privateState = metadata(meta.data());
    if (audit.exists) { if (audit.data()?.fingerprint !== fingerprint || audit.data()?.adminUid !== adminUid) throw new AdminCustomerError("operation_conflict", "Identifiant d’opération déjà utilisé.", 409); return { revision: audit.data()!.revision as number, replayed: true }; }
    if (privateState.revision !== input.expectedRevision) throw new AdminCustomerError("customer_conflict", "La fiche a changé. Rechargez-la avant de sauvegarder.", 409);
    const before: Data = {}, after: Data = {}; const patch: Data = {}; const metaPatch: Data = { revision: privateState.revision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: adminUid };
    let action: string = input.kind;
    if (input.kind === "metadata") {
      if (privateState.note === input.note && JSON.stringify(privateState.tags) === JSON.stringify(input.tags)) throw new AdminCustomerError("no_change", "Aucune modification à enregistrer.");
      Object.assign(metaPatch, { note: input.note, tags: input.tags }); Object.assign(before, { notePresent: !!privateState.note, noteLength: privateState.note.length, tags: privateState.tags }); Object.assign(after, { notePresent: !!input.note, noteLength: input.note.length, tags: input.tags });
    } else if (input.kind === "status") {
      if (current.status !== input.expectedStatus || current.archived !== input.expectedArchived || current.hidden !== input.expectedHidden) throw new AdminCustomerError("customer_conflict", "Le statut client a changé. Rechargez la fiche.", 409);
      Object.assign(before, { status: current.status, archived: current.archived, hidden: current.hidden }); Object.assign(after, { status: input.status, archived: input.archived, hidden: input.hidden });
      if (JSON.stringify(before) === JSON.stringify(after)) throw new AdminCustomerError("no_change", "Aucune modification à enregistrer.");
      Object.assign(patch, after);
      if (current.archived !== input.archived) { Object.assign(patch, { archivedAt: input.archived ? FieldValue.serverTimestamp() : null, archivedBy: input.archived ? adminUid : null }); action = input.archived ? "archive" : "restore"; }
      if (current.hidden !== input.hidden) Object.assign(patch, { hiddenAt: input.hidden ? FieldValue.serverTimestamp() : null, hiddenBy: input.hidden ? adminUid : null });
    } else if (input.kind === "points") {
      if (current.points === null || current.points !== input.expectedPoints) throw new AdminCustomerError("customer_conflict", "Solde historique absent ou modifié.", 409);
      if (current.points === input.targetPoints) throw new AdminCustomerError("no_change", "Aucune modification à enregistrer.");
      before.points = current.points; after.points = input.targetPoints; patch.loyaltyPoints = input.targetPoints;
      tx.create(db.collection("loyaltyMovements").doc(`admin-v2-${input.operationId}`), { customerId: current.id, points: input.targetPoints - current.points, reason: "admin_adjustment", createdBy: adminUid, createdAt: FieldValue.serverTimestamp() });
    } else {
      const coupon = await tx.get(db.collection("coupons").doc(input.couponId)); const data = coupon.data();
      if (!coupon.exists || !data?.code || data.isActive !== true || data.archived === true || data.isArchived === true || (knownDate(data.endsAt) && Date.parse(knownDate(data.endsAt)!) < Date.now())) throw new AdminCustomerError("coupon_unavailable", "Code promo indisponible.");
      const assigned = Array.isArray(profile.data()?.assignedPromos) ? profile.data()!.assignedPromos as Data[] : [];
      if (assigned.some((promo) => promo.couponId === input.couponId && promo.isActive === true)) throw new AdminCustomerError("no_change", "Ce code est déjà attribué.");
      before.promoCount = assigned.length; after.promoCount = assigned.length + 1; after.couponId = input.couponId;
      patch.assignedPromos = [...assigned, { code: data.code, couponId: input.couponId, label: text(data.label), isActive: true, assignedAt: new Date().toISOString(), assignedBy: adminUid }];
    }
    if (Object.keys(patch).length) tx.update(profileRef, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    tx.set(metaRef, metaPatch, { merge: true });
    tx.create(auditRef, { customerId: current.id, action, adminUid, createdAt: FieldValue.serverTimestamp(), reason: input.kind === "metadata" ? "" : input.reason, before, after, fingerprint, revision: privateState.revision + 1 });
    return { revision: privateState.revision + 1, replayed: false };
  });
}
const actions = ["adminCustomersList", "adminCustomerSummary", "adminCustomerOrders", "adminCustomerMetadata", "adminCustomerLoyalty", "adminCustomerReferral", "adminCustomerActivity", "adminCustomerMutate"];
export function isAdminCustomerRequest(request: VercelRequestLike): boolean { const action = request.method === "GET" ? new URL(request.url || "/", "https://verdanza.local").searchParams.get("action") : (request.body as Data | undefined)?.action; return typeof action === "string" && action.startsWith("adminCustomer"); }
export function createAdminCustomerHandler(deps: { getDb?: () => Firestore; verifyToken?: typeof verifyFirebaseIdToken; referralRuntime?: () => ReferralRuntime } = {}) {
  return async (request: VercelRequestLike, response: VercelResponseLike) => {
    response.setHeader("Cache-Control", "private, no-store");
    if (!["GET", "POST"].includes(request.method || "")) return sendJson(response, { code: "invalid_method", error: "Méthode non autorisée." }, 405);
    const token = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]; if (!token) return sendJson(response, { code: "authentication_required", error: "Session admin requise." }, 401);
    try {
      const db = (deps.getDb || getAdminDb)(); const admin = await assertAdminUser(db, token, deps.verifyToken || verifyFirebaseIdToken);
      const query = new URL(request.url || "/", "https://verdanza.local").searchParams; const body = request.body as Data | undefined; const action = request.method === "GET" ? query.get("action") : text(body?.action);
      if (!action || !actions.includes(action) || (action === "adminCustomerMutate") !== (request.method === "POST")) throw new AdminCustomerError("invalid_action", "Action invalide.");
      if (action === "adminCustomerMutate") return sendJson(response, await commitCustomerMutation(db, body?.operation, admin.uid));
      if (action === "adminCustomersList") return sendJson(response, await readCustomerList(db, query.get("cursor")));
      if (action === "adminCustomerSummary") return sendJson(response, await readCustomerSummary(db, query.get("customerId")));
      const customer = await readCustomerIdentity(db, query.get("customerId")); const cursor = query.get("cursor");
      if (action === "adminCustomerOrders") return sendJson(response, await readCustomerOrders(db, customer, cursor, true));
      if (action === "adminCustomerMetadata") return sendJson(response, await readCustomerMetadata(db, customer, cursor));
      if (action === "adminCustomerLoyalty") return sendJson(response, await readCustomerLegacyLoyalty(db, customer, cursor));
      if (action === "adminCustomerReferral") return sendJson(response, await readCustomerReferral(db, customer, cursor, (deps.referralRuntime || getReferralRuntime)()));
      return sendJson(response, await readCustomerActivity(db, customer, query.get("kind"), cursor));
    } catch (error) {
      const auth = firebaseAuthHttpFailure(error); const customer = error instanceof AdminCustomerError ? error : null; const forbidden = error instanceof Error && error.message === "Acces admin requis.";
      return sendJson(response, { code: auth?.code || customer?.code || (forbidden ? "admin_required" : "customers_unavailable"), error: customer?.message || (forbidden ? "Accès admin requis." : "Données clients indisponibles. Réessayez.") }, auth?.status || customer?.status || (forbidden ? 403 : 503));
    }
  };
}
export const handleAdminCustomer = createAdminCustomerHandler();
