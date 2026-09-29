import { equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { connectCagnotteEmulator, CAGNOTTE_DEMO } from "./cagnotteEmulator.js";
import { AdminStockError, commitAdminStock, createAdminStockHandler, parseStockAdjustment, readAdminStock, readStockOperation } from "../api/_server/adminStock.js";
import { FirebaseIdTokenVerificationError } from "../api/_server/adminAuth.js";
import { upsertProductAdmin } from "../api/invoices.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";
import type { StockAdjustment } from "../src/types/adminStock.js";

const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const admin = { uid: "stock-admin", email: null };
let checks = 0;
const test = async (name: string, run: () => Promise<unknown>) => { await run(); console.log(`PASS ${name}`); checks++; };
const invalid = (code: string) => (error: unknown) => error instanceof AdminStockError && error.code === code;
async function setup() {
  const id = `stock-${randomUUID()}`;
  await db.collection("products").doc(id).set({ name: "Stock fixture", category: "resins", stock: 20, lowStockThreshold: 5, isActive: true, internalReference: "VDZ-RES-TEST" });
  const input: StockAdjustment = { productId: id, operationId: randomUUID(), expectedStock: 20, targetStock: 25, expectedLowStockThreshold: 5, lowStockThreshold: 5, reason: "inventory_correction", note: "Comptage local" };
  return { id, input, ref: db.collection("products").doc(id), ledger: db.collection("stockMovements").doc(`admin-stock-${input.operationId}`) };
}
async function call(token?: string, operation?: StockAdjustment, method = "POST") {
  let status = 200; let payload: Record<string, unknown> = {};
  const handler = createAdminStockHandler({ getDb: () => db, verifyToken: async (value) => {
    if (value === "invalid") throw new FirebaseIdTokenVerificationError("authentication");
    if (value === "verified-email") return { uid: "email-uid", email: "stock-email@example.test", emailVerified: true };
    if (value === "unverified-email") return { uid: "email-uid", email: "stock-email@example.test", emailVerified: false };
    return { uid: value, email: null };
  } });
  const response = { setHeader() {}, status(code: number) { status = code; return this; }, json(body: Record<string, unknown>) { payload = body; return this; } };
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: { action: "adminStockOperation", operation, adminUid: "stock-admin" }, url: "/api/invoices" } as VercelRequestLike, response as unknown as VercelResponseLike);
  return { status, payload };
}
try {
  await db.collection("adminUsers").doc(admin.uid).set({ isActive: true });
  await db.collection("adminUsers").doc("stock-inactive").set({ isActive: false });
  await db.collection("adminUsers").doc("stock-email@example.test").set({ isActive: true });
  await test("20 → 25, mouvement +5 atomique, valeurs et auteur serveur", async () => {
    const f = await setup(); const result = await commitAdminStock(db, { ...f.input, adminUid: "forged", delta: 999, beforeStock: 0 }, admin);
    equal(result.beforeStock, 20); equal(result.afterStock, 25); equal(result.delta, 5); equal(result.adminUid, admin.uid);
    equal((await f.ref.get()).data()?.stock, 25);
    const movement = (await f.ledger.get()).data()!;
    equal(movement.type, "admin_adjustment"); equal(movement.quantity, 5); equal(movement.createdBy, admin.uid); ok(movement.createdAt.toDate());
    equal(movement.reason, "inventory_correction"); equal(movement.operationId, f.input.operationId);
  });
  await test("20 → 15, mouvement -5", async () => {
    const f = await setup(); const result = await commitAdminStock(db, { ...f.input, targetStock: 15 }, admin); equal(result.delta, -5); equal((await f.ref.get()).data()?.stock, 15);
  });
  await test("vente concurrente 20 → 18, demande 25 refusée sans mouvement", async () => {
    const f = await setup(); await db.runTransaction(async (tx) => { const product = await tx.get(f.ref); tx.update(f.ref, { stock: product.data()!.stock - 2 }); tx.create(db.collection("stockMovements").doc(), { productId: f.id, type: "sale", quantity: -2, createdAt: FieldValue.serverTimestamp() }); });
    await rejects(commitAdminStock(db, f.input, admin), (error: unknown) => invalid("stock_conflict")(error) && (error as AdminStockError).current?.stock === 18);
    equal((await f.ref.get()).data()?.stock, 18); equal((await f.ledger.get()).exists, false);
  });
  await test("deux corrections simultanées : une seule appliquée", async () => {
    const f = await setup(); const results = await Promise.allSettled([commitAdminStock(db, f.input, admin), commitAdminStock(db, { ...f.input, operationId: randomUUID(), targetStock: 30 }, admin)]);
    equal(results.filter((result) => result.status === "fulfilled").length, 1);
    equal((await db.collection("stockMovements").where("productId", "==", f.id).get()).size, 1);
  });
  await test("échec du mouvement après programmation stock : rollback intégral", async () => {
    const f = await setup();
    const failing = { collection: db.collection.bind(db), runTransaction: (callback: (tx: Transaction) => Promise<unknown>) => db.runTransaction((tx) => callback(new Proxy(tx, { get(target, key) { if (key === "create") return () => { throw new Error("movement_failure"); }; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } }))) } as unknown as Firestore;
    await rejects(commitAdminStock(failing, f.input, admin), /movement_failure/); equal((await f.ref.get()).data()?.stock, 20); equal((await f.ledger.get()).exists, false);
  });
  await test("idempotence, rejeu concurrent et perdu, aucune seconde correction après vente", async () => {
    const f = await setup(); const results = await Promise.all([commitAdminStock(db, f.input, admin), commitAdminStock(db, f.input, admin)]);
    equal(results[0].afterStock, 25); equal(results[1].afterStock, 25);
    await f.ref.update({ stock: 23 }); const replay = await commitAdminStock(db, f.input, admin);
    equal(replay.replayed, true); equal(replay.afterStock, 25); equal((await f.ref.get()).data()?.stock, 23);
    equal((await db.collection("stockMovements").where("productId", "==", f.id).get()).size, 1);
    equal((await readStockOperation(db, f.input.operationId, admin.uid)).status, "applied");
    await rejects(commitAdminStock(db, { ...f.input, targetStock: 26 }, admin), invalid("operation_mismatch"));
    await rejects(readStockOperation(db, f.input.operationId, "other-admin"), invalid("operation_owner"));
  });
  await test("opération absente vérifiable", async () => equal((await readStockOperation(db, randomUUID(), admin.uid)).status, "not_executed"));
  await test("seuil concurrent protégé et changement seuil journalisé à delta zéro", async () => {
    const f = await setup(); await f.ref.update({ lowStockThreshold: 7 }); await rejects(commitAdminStock(db, f.input, admin), invalid("stock_conflict"));
    const result = await commitAdminStock(db, { ...f.input, expectedLowStockThreshold: 7, lowStockThreshold: 8, targetStock: 20 }, admin); equal(result.delta, 0); equal(result.afterLowStockThreshold, 8);
  });
  await test("produit absent et absence de modification refusés", async () => {
    const f = await setup(); await rejects(commitAdminStock(db, { ...f.input, productId: "missing-stock-fixture" }, admin), invalid("product_missing"));
    await rejects(commitAdminStock(db, { ...f.input, targetStock: 20 }, admin), invalid("no_change"));
  });
  await test("produit protégé et stock serveur invalide refusés sans mouvement", async () => {
    const f = await setup(); await f.ref.update({ productionFixture: {} });
    await rejects(commitAdminStock(db, f.input, admin), invalid("protected_product")); equal((await f.ledger.get()).exists, false);
    const bad = await setup(); await bad.ref.update({ stock: -1 }); await rejects(commitAdminStock(db, bad.input, admin), invalid("invalid_quantity")); equal((await bad.ledger.get()).exists, false);
  });
  await test("négatif, NaN, infini, fraction, chaîne, identifiants et motif invalides", async () => {
    const f = await setup();
    for (const field of ["targetStock", "expectedStock", "lowStockThreshold", "expectedLowStockThreshold"]) for (const value of [-1, NaN, Infinity, 1.5, "25", Number.MAX_SAFE_INTEGER + 1]) {
      await rejects(commitAdminStock(db, { ...f.input, [field]: value }, admin), invalid("invalid_quantity"));
    }
    for (const patch of [{ reason: "" }, { reason: "forged" }, { reason: "other", note: " " }, { note: "x".repeat(1001) }]) await rejects(commitAdminStock(db, { ...f.input, ...patch }, admin), invalid("invalid_reason"));
    await rejects(commitAdminStock(db, { ...f.input, operationId: "invalid" }, admin), invalid("invalid_operation"));
    await rejects(commitAdminStock(db, { ...f.input, productId: "../bad" }, admin), invalid("invalid_product"));
    equal(parseStockAdjustment({ ...f.input, reason: "other", note: "  note  " }).note, "note");
    equal((await f.ref.get()).data()?.stock, 20); equal((await f.ledger.get()).exists, false);
  });
  await test("auth manquante, invalide, non-admin et admin inactif refusés malgré UID forgé", async () => {
    const f = await setup();
    for (const [token, status] of [[undefined, 401], ["invalid", 401], ["customer", 403], ["stock-inactive", 403], ["unverified-email", 403]] as const) equal((await call(token, f.input)).status, status);
    equal((await f.ref.get()).data()?.stock, 20); equal((await f.ledger.get()).exists, false);
    equal((await call(admin.uid, f.input)).status, 200); equal((await f.ledger.get()).data()?.createdBy, admin.uid);
    const email = await setup(); equal((await call("verified-email", email.input)).status, 200); equal((await email.ledger.get()).data()?.createdBy, "email-uid");
  });
  await test("historique ancien et nouveau lisibles sans migration", async () => {
    const f = await setup(); await db.collection("stockMovements").doc().set({ productId: f.id, type: "manual_add", quantity: 3, createdAt: "2000-01-01T00:00:00Z", note: "Ancien", createdBy: "legacy" });
    await commitAdminStock(db, f.input, admin); const detail = await readAdminStock(db, f.id);
    equal(detail.product.stock, 25); equal(detail.movements.length, 2); ok(detail.movements.some((movement) => movement.type === "manual_add" && movement.note === "Ancien"));
  });
  await test("enregistrer une fiche Produits ancienne préserve stock et seuil serveur", async () => {
    const f = await setup(); await f.ref.update({ stock: 18, lowStockThreshold: 7 });
    await upsertProductAdmin(db, { id: f.id, name: "Nom corrigé", slug: "stock-fixture", category: "resins", stock: 20, lowStockThreshold: 5, fixedPriceMode: "disabled", images: [], price: 6 });
    const product = (await f.ref.get()).data()!; equal(product.name, "Nom corrigé"); equal(product.stock, 18); equal(product.lowStockThreshold, 7);
  });
  console.log(`${checks} groupes transaction/API stock validés sur émulateur uniquement.`);
} finally { await db.terminate(); }
