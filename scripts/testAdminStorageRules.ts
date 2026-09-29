import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

const projectId = "demo-verdanza-admin-storage";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18087");
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:18088");
const rules = await readFile(fileURLToPath(new URL("../storage.rules", import.meta.url)), "utf8");
const env = await initializeTestEnvironment({ projectId,
  firestore: { host: "127.0.0.1", port: 18087 },
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
    await context.firestore().doc("adminUsers/storage-uid-admin").set({ isActive: true });
    await context.firestore().doc("adminUsers/storage-admin@example.test").set({ isActive: true });
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
  console.log(`Storage : ${count} groupes validés sur émulateurs uniquement ; aucun objet Production.`);
} finally { await env.cleanup(); }
