import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase-admin/firestore";
import { assertAdminUser, type VerifiedFirebaseUser } from "../api/_server/adminAuth.js";
import { isAdminRecordForAuthUser } from "../src/services/adminUsersService.js";

const projectId = "demo-verdanza-admin-storage";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18087");
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:18088");
const rules = await readFile(fileURLToPath(new URL("../storage.rules", import.meta.url)), "utf8");
const firestoreRules = await readFile(fileURLToPath(new URL("../firestore.rules", import.meta.url)), "utf8");
const env = await initializeTestEnvironment({ projectId,
  firestore: { host: "127.0.0.1", port: 18087, rules: firestoreRules },
  storage: { host: "127.0.0.1", port: 18088, rules },
});
const bucket = `${projectId}.appspot.com`;
const bytes = new Uint8Array([1, 2, 3, 4]);
let count = 0;
async function test(label: string, run: () => Promise<unknown>) {
  await run(); count += 1; console.log(`PASS ${label}`);
}
const denied = (operation: PromiseLike<unknown>) => assert.rejects(Promise.resolve(operation), (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === "storage/unauthorized"));
const uidAdmin = env.authenticatedContext("storage-uid-admin", { email: "uid@example.test", email_verified: true });
const emailAdmin = env.authenticatedContext("email-admin", { email: "storage-admin@example.test", email_verified: true });
const rejected = [
  ["email admin non vérifié", env.authenticatedContext("email-unverified", { email: "storage-admin@example.test", email_verified: false })],
  ["email admin sans preuve", env.authenticatedContext("email-missing-proof", { email: "storage-admin@example.test" })],
  ["non admin", env.authenticatedContext("customer", { email: "customer@example.test", email_verified: true })],
  ["visiteur", env.unauthenticatedContext()],
] as const;
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("adminUsers/storage-uid-admin").set({ isActive: true, uid: "storage-uid-admin", email: "uid@example.test" });
    await context.firestore().doc("adminUsers/storage-admin@example.test").set({ isActive: true, email: "storage-admin@example.test" });
    await context.storage(bucket).ref("products/fixture/public.jpg").put(bytes, { contentType: "image/jpeg" });
  });
  for (const [name, context] of [["UID admin", uidAdmin], ["email admin vérifié", emailAdmin]] as const) {
    const ref = context.storage(bucket).ref(`products/fixture/${name}.jpg`);
    await test(`${name} création/modification/suppression conservées`, async () => {
      await ref.put(bytes, { contentType: "image/jpeg" });
      await ref.put(bytes, { contentType: "image/jpeg" });
      await ref.delete();
    });
  }
  for (const [name, context] of rejected) {
    await test(`${name} écritures refusées, lecture publique conservée`, async () => {
      const storage = context.storage(bucket);
      await denied(storage.ref(`products/fixture/rejected-${name}.jpg`).put(bytes, { contentType: "image/jpeg" }));
      await denied(storage.ref("products/fixture/public.jpg").put(bytes, { contentType: "image/jpeg" }));
      await denied(storage.ref("products/fixture/public.jpg").delete());
      assert.equal((await storage.ref("products/fixture/public.jpg").getMetadata()).size, bytes.length);
    });
  }
  await test("UID admin indépendant du statut de vérification email, comme Firestore", async () => {
    const context = env.authenticatedContext("storage-uid-admin", { email: "uid@example.test", email_verified: false });
    const ref = context.storage(bucket).ref("products/fixture/uid-only.jpg");
    await ref.put(bytes, { contentType: "image/jpeg" }); await ref.delete();
  });
  for (const path of ["selection-images/private/image.jpg", "selection-sheets/private/sheet.pdf", "outside/private.jpg"]) {
    await test(`chemin privé fermé ${path}`, async () => {
      await denied(emailAdmin.storage(bucket).ref(path).put(bytes, { contentType: "image/jpeg" }));
    });
  }
  await test("MIME et taille inchangés", async () => {
    const storage = emailAdmin.storage(bucket);
    await denied(storage.ref("products/fixture/bad.pdf").put(bytes, { contentType: "application/pdf" }));
    await denied(storage.ref("products/fixture/large.jpg").put(new Uint8Array(8 * 1024 * 1024 + 1), { contentType: "image/jpeg" }));
    for (const contentType of ["image/jpeg", "image/png", "image/webp"]) {
      const ref = storage.ref(`products/fixture/mime-${contentType.split("/")[1]}`);
      await ref.put(bytes, { contentType }); await ref.delete();
    }
  });
  type RecordData = { isActive?: unknown; email?: unknown; uid?: unknown; id?: unknown };
  const validUid = { isActive: true, email: "bound@example.test", uid: "bound-admin" };
  const validEmail = { isActive: true, email: "bound@example.test" };
  const cases: Array<{
    name: string; uidRecord?: RecordData; emailRecord?: RecordData;
    email?: string; verified: boolean; allowed: boolean;
  }> = [
    { name: "UID lie", uidRecord: validUid, verified: true, allowed: true },
    { name: "UID lie email non verifie", uidRecord: validUid, verified: false, allowed: true },
    { name: "UID legacy sans uid", uidRecord: { isActive: true, email: "bound@example.test" }, verified: true, allowed: true },
    { name: "UID legacy uid null", uidRecord: { isActive: true, email: "bound@example.test", uid: null }, verified: true, allowed: true },
    { name: "UID email different", uidRecord: { ...validUid, email: "other@example.test" }, verified: true, allowed: false },
    { name: "UID autre uid", uidRecord: { ...validUid, uid: "other-admin" }, verified: true, allowed: false },
    { name: "UID email absent", uidRecord: { isActive: true, uid: "bound-admin" }, verified: true, allowed: false },
    { name: "UID invalide bloque fallback", uidRecord: { ...validUid, email: "other@example.test" }, emailRecord: validEmail, verified: true, allowed: false },
    { name: "email legacy verifie", emailRecord: validEmail, verified: true, allowed: true },
    { name: "email legacy uid null", emailRecord: { ...validEmail, uid: null }, verified: true, allowed: true },
    { name: "email legacy mauvais email", emailRecord: { ...validEmail, email: "other@example.test" }, verified: true, allowed: false },
    { name: "email legacy autre uid", emailRecord: { ...validEmail, uid: "other-admin" }, verified: true, allowed: false },
    { name: "email legacy non verifie", emailRecord: validEmail, verified: false, allowed: false },
    { name: "email legacy id forge", emailRecord: { ...validEmail, id: "bound-admin" }, verified: false, allowed: false },
    { name: "UID inactif", uidRecord: { ...validUid, isActive: false }, verified: true, allowed: false },
    { name: "email inactif", emailRecord: { ...validEmail, isActive: false }, verified: true, allowed: false },
    { name: "email exact requis", uidRecord: validUid, email: "Bound@example.test", verified: true, allowed: false },
  ];
  for (const [index, scenario] of cases.entries()) {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      if (scenario.uidRecord) await db.doc("adminUsers/bound-admin").set(scenario.uidRecord);
      if (scenario.emailRecord) await db.doc("adminUsers/bound@example.test").set(scenario.emailRecord);
      await db.doc("productReferences/binding-probe").set({ marker: true });
    });
    const identity: VerifiedFirebaseUser = {
      uid: "bound-admin", email: scenario.email ?? "bound@example.test", emailVerified: scenario.verified,
    };
    const selected = scenario.uidRecord
      ? { ...scenario.uidRecord, id: identity.uid }
      : scenario.emailRecord
        ? { ...scenario.emailRecord, id: "bound@example.test" }
        : null;
    assert.equal(isAdminRecordForAuthUser(selected as Parameters<typeof isAdminRecordForAuthUser>[0],
      identity as Parameters<typeof isAdminRecordForAuthUser>[1]), scenario.allowed, `client facade ${scenario.name}`);
    const documents = new Map<string, RecordData>();
    if (scenario.uidRecord) documents.set(identity.uid, scenario.uidRecord);
    if (scenario.emailRecord) documents.set("bound@example.test", scenario.emailRecord);
    const reads: string[] = [];
    const fakeDb = { collection(name: string) {
      assert.equal(name, "adminUsers");
      return { doc(id: string) { return { async get() {
        reads.push(id);
        const value = documents.get(id);
        return { exists: value !== undefined, data: () => value };
      } }; } };
    } } as unknown as Firestore;
    if (scenario.allowed) {
      assert.deepEqual(await assertAdminUser(fakeDb, "synthetic", async () => identity), identity);
    } else {
      await assert.rejects(assertAdminUser(fakeDb, "synthetic", async () => identity), /Acces admin requis/);
    }
    if (scenario.uidRecord || !scenario.verified) assert.deepEqual(reads, [identity.uid], `UID prioritaire ${scenario.name}`);
    const token = { email: identity.email, email_verified: scenario.verified };
    const context = env.authenticatedContext(identity.uid, token);
    const firestore = context.firestore();
    const category = firestore.doc(`categories/binding-${index}`);
    const reference = firestore.doc("productReferences/binding-probe");
    const storage = context.storage(bucket);
    const object = storage.ref(`products/binding/probe-${index}.jpg`);
    if (scenario.allowed) {
      await reference.get();
      await category.set({ name: "binding test" });
      await object.put(bytes, { contentType: "image/jpeg" });
      await object.delete();
    } else {
      await assert.rejects(reference.get(), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "permission-denied"));
      await assert.rejects(category.set({ name: "binding test" }), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "permission-denied"));
      await denied(object.put(bytes, { contentType: "image/jpeg" }));
      await denied(storage.ref("products/fixture/public.jpg").delete());
    }
    count += 4;
    console.log(`PASS contrat admin commun ${scenario.name}`);
  }
  console.log(`Storage : ${count} groupes validés sur émulateurs uniquement ; aucun objet Production.`);
} finally { await env.cleanup(); }
