import { equal, rejects } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, deleteDoc, deleteField, doc, getDoc, getDocs, increment, query, setDoc, setLogLevel, updateDoc, where, writeBatch } from "firebase/firestore";
import { assertCagnotteEmulatorAvailable, CAGNOTTE_DEMO, validateCagnotteTestEnvironment } from "./cagnotteEmulator.js";

validateCagnotteTestEnvironment(process.env);
await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const rulesPath = fileURLToPath(new URL("../firestore.rules", import.meta.url));
const rules = await readFile(rulesPath, "utf8");
if (!rules.trim()) throw new Error("Fichier complet de règles vide.");
console.log(`Fichier complet chargé via rules-unit-testing : ${rulesPath}\nSHA-256 : ${createHash("sha256").update(rules).digest("hex")}`);
const env = await initializeTestEnvironment({ projectId: CAGNOTTE_DEMO.projectId, firestore: { host: CAGNOTTE_DEMO.host, port: CAGNOTTE_DEMO.port, rules } });
setLogLevel("silent");
const counts = new Map<string, number>();
async function test(category: string, name: string, run: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`TIMEOUT ${name}`)), 20000); })]);
    counts.set(category, (counts.get(category) || 0) + 1);
  } catch (error) { console.error(`FAIL [${category}] ${name}`); throw error; }
  finally { clearTimeout(timer); }
}
// A connection failure/timeout is NEVER accepted as a permission denial.
const denied = (operation: Promise<unknown>) => rejects(operation, (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === "permission-denied"));
const internal = ["cagnotteWallets", "cagnotteMovements", "cagnotteAccruals", "cagnotteReservations", "cagnotteRefunds"];
const values = [{ beneficiaryId: "client-a", snapshot: { loyaltyCents: 500 } }, null, {}, "invalid", false];
const ordinary = { customerId: "client-a", orderStatus: "contact_required", paymentStatus: "to_confirm", total: 100 };
const profiles = [
  ["visiteur", env.unauthenticatedContext()],
  ["proprietaire", env.authenticatedContext("client-a", { email: "a@example.test", email_verified: true })],
  ["autre client", env.authenticatedContext("client-b", { email: "b@example.test", email_verified: true })],
  ["admin navigateur", env.authenticatedContext("admin-uid", { email: "uid-admin@example.test", email_verified: true })],
] as const;

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(); const batch = writeBatch(db);
    batch.set(doc(db, "adminUsers/admin-uid"), { isActive: true });
    batch.set(doc(db, "adminUsers/email-admin@example.test"), { isActive: true });
    batch.set(doc(db, "adminUsers/inactive"), { isActive: false });
    batch.set(doc(db, "products/public"), { isActive: true, stock: 10 });
    batch.set(doc(db, "products/private"), { isActive: false, stock: 10 });
    batch.set(doc(db, "categories/public"), { name: "Synthetic" });
    batch.set(doc(db, "customers/client-a"), { uid: "client-a", email: "a@example.test", role: "customer", loyaltyPoints: 0, orderCount: 0, totalSpent: 0 });
    batch.set(doc(db, "customers/client-b"), { uid: "client-b", email: "b@example.test", role: "customer", loyaltyPoints: 0, orderCount: 0, totalSpent: 0 });
    batch.set(doc(db, "orders/historical"), ordinary);
    batch.set(doc(db, "orders/cancelled"), { ...ordinary, orderStatus: "cancelled", paymentStatus: "cancelled", cagnotte: values[0] });
    for (let i = 0; i < values.length; i++) batch.set(doc(db, `orders/enrolled-${i}`), { ...ordinary, cagnotte: values[i] });
    for (const name of internal) for (const path of [`${name}/client-a`, `${name}/client-a/children/entry`]) batch.set(doc(db, path), { beneficiaryId: "client-a", amountCents: 500 });
    await batch.commit();
  });

  for (const [profile, context] of profiles) {
    const db = context.firestore();
    for (const name of internal) for (const path of [`${name}/client-a`, `${name}/client-a/children/entry`]) {
      const ref = doc(db, path);
      const operations: [string, () => Promise<unknown>][] = [
        ["get", () => getDoc(ref)], ["list", () => getDocs(ref.parent)],
        ["create", () => setDoc(doc(ref.parent, `new-${profile}`), { beneficiaryId: "client-a" })],
        ["update", () => updateDoc(ref, { amountCents: 0 })],
        ["increment", () => updateDoc(ref, { amountCents: increment(1000) })],
        ["replace", () => setDoc(ref, { amountCents: 999 })],
        ["delete", () => deleteDoc(ref)],
        ["batch", () => { const b = writeBatch(db); b.update(ref, { amountCents: 0 }); b.set(doc(ref.parent, "batch-forged"), { amountCents: 999 }); return b.commit(); }],
      ];
      for (const [op, run] of operations) await test("Cagnotte", `${profile} ${path} ${op}`, () => denied(run()));
    }
    await test("Descendants", `${profile} collection group`, () => denied(getDocs(collectionGroup(db, "children"))));
    await test("Descendants", `${profile} orders descendant`, () => denied(setDoc(doc(db, "orders/enrolled-0/children/forged"), { paymentStatus: "paid" })));
    for (let i = 0; i < values.length; i++) {
      await test("Inscriptions forgees", `${profile} create ${i}`, () => denied(setDoc(doc(db, `orders/forged-${profile}-${i}`), { ...ordinary, cagnotte: values[i] })));
      await test("Inscriptions forgees", `${profile} add ${i}`, () => denied(updateDoc(doc(db, "orders/historical"), { cagnotte: values[i] })));
      const ref = doc(db, `orders/enrolled-${i}`);
      for (const [op, run] of [
        ["payment", () => updateDoc(ref, { paymentStatus: "paid" })],
        ["delivery", () => updateDoc(ref, { orderStatus: "delivered" })],
        ["beneficiary", () => updateDoc(ref, { customerId: "client-b" })],
        ["remove key", () => updateDoc(ref, { cagnotte: deleteField() })],
        ["replace without key", () => setDoc(ref, ordinary)],
        ["delete", () => deleteDoc(ref)],
      ] as const) await test("Commandes protegees", `${profile} ${i} ${op}`, () => denied(run()));
    }
    const enrolled = doc(db, "orders/enrolled-0");
    for (const patch of [{ "cagnotte.snapshot.loyaltyCents": 99999 }, { "cagnotte.beneficiaryId": "client-b" }, { cagnotte: null }, { cagnotte: {} }, { "cagnotte.snapshot": deleteField() }]) {
      await test("Commandes protegees", `${profile} nested/value`, () => denied(updateDoc(enrolled, patch)));
    }
    await test("Commandes protegees", `${profile} cancelled delete`, () => denied(deleteDoc(doc(db, "orders/cancelled"))));
    for (const remove of [false, true]) {
      await test("Groupes atomiques", `${profile} remove then ${remove ? "delete" : "update"}`, () => {
        const batch = writeBatch(db); batch.update(enrolled, { cagnotte: deleteField() });
        if (remove) batch.delete(enrolled); else batch.update(enrolled, { paymentStatus: "paid" });
        return denied(batch.commit());
      });
    }
    await test("Groupes atomiques", `${profile} authorized neighbor rolled back`, async () => {
      const batch = writeBatch(db); batch.set(doc(db, `categories/rolled-back-${profile}`), { name: "forged" }); batch.delete(enrolled);
      await denied(batch.commit());
      equal((await getDoc(doc(db, `categories/rolled-back-${profile}`))).exists(), false);
    });
    const canRead = profile === "proprietaire" || profile === "admin navigateur";
    for (const id of ["enrolled-0", "historical", "cancelled"]) {
      await test("Lectures commandes", `${profile} ${id}`, async () => {
        const read = getDoc(doc(db, `orders/${id}`));
        if (canRead) equal((await read).exists(), true); else await denied(read);
      });
    }
    await test("Lectures commandes", `${profile} scoped list`, async () => {
      const read = getDocs(query(collection(db, "orders"), where("customerId", "==", "client-a")));
      if (canRead) equal((await read).size, 7); else await denied(read);
    });
    await test("Lectures commandes", `${profile} unscoped list`, async () => {
      const read = getDocs(collection(db, "orders"));
      if (profile === "admin navigateur") equal((await read).size, 7); else await denied(read);
    });
    await test("Non regression", `${profile} public catalog`, async () => {
      equal((await getDoc(doc(db, "products/public"))).exists(), true);
      equal((await getDocs(query(collection(db, "products"), where("isActive", "==", true)))).size, 1);
      equal((await getDoc(doc(db, "categories/public"))).exists(), true);
    });
  }

  const a = profiles[1][1].firestore(), b = profiles[2][1].firestore(), admin = profiles[3][1].firestore();
  await test("Non regression", "own profile read/update", async () => {
    equal((await getDoc(doc(a, "customers/client-a"))).exists(), true);
    await updateDoc(doc(a, "customers/client-a"), { displayName: "Synthetic updated" });
    await denied(getDoc(doc(b, "customers/client-a")));
  });
  await test("Non regression", "admin ordinary create/update/delete, product stock", async () => {
    const ref = doc(admin, "orders/admin-ordinary"); await setDoc(ref, ordinary);
    await updateDoc(ref, { paymentStatus: "paid", internalNote: "Synthetic" });
    await setDoc(ref, { ...ordinary, orderStatus: "cancelled" }); await deleteDoc(ref);
    await updateDoc(doc(admin, "products/public"), { stock: 9 });
    await denied(updateDoc(doc(a, "products/public"), { stock: 999 }));
  });
  for (const [name, ctx] of profiles.slice(0, 3)) {
    await test("Non regression", `${name} ordinary writes still denied`, async () => {
      const db = ctx.firestore(); await denied(setDoc(doc(db, "orders/client-created"), ordinary));
      await denied(updateDoc(doc(db, "orders/historical"), { paymentStatus: "paid" }));
      await denied(deleteDoc(doc(db, "orders/historical")));
    });
  }
  await test("Administration", "profile role/admin flags cannot promote", async () => {
    await denied(updateDoc(doc(a, "customers/client-a"), { role: "admin" }));
    await denied(updateDoc(doc(a, "customers/client-a"), { isAdmin: true }));
    await denied(setDoc(doc(a, "adminUsers/client-a"), { isActive: true }));
    const self = env.authenticatedContext("self-profile", { email: "self@example.test", email_verified: true }).firestore();
    await setDoc(doc(self, "customers/self-profile"), { uid: "self-profile", email: "self@example.test", role: "customer", isAdmin: true });
    await denied(setDoc(doc(self, "categories/forged"), { name: "Denied" }));
    await denied(setDoc(doc(self, "adminUsers/self-profile"), { isActive: true }));
  });
  for (const verified of [false, true]) {
    await test("Administration", `email fallback verified=${verified}`, async () => {
      const db = env.authenticatedContext(`email-identity-${verified}`, { email: "email-admin@example.test", email_verified: verified }).firestore();
      const op = getDoc(doc(db, "products/private"));
      if (verified) equal((await op).exists(), true); else await denied(op);
      await denied(getDoc(doc(db, "cagnotteWallets/client-a")));
      await denied(updateDoc(doc(db, "orders/enrolled-0"), { paymentStatus: "paid" }));
    });
  }
  await test("Administration", "claimed admin role and inactive registry denied", async () => {
    for (const uid of ["claimed-admin", "inactive"]) {
      const db = env.authenticatedContext(uid, { email: "nobody@example.test", email_verified: true, role: "admin", isAdmin: true, admin: true }).firestore();
      await denied(getDoc(doc(db, "products/private")));
      await denied(setDoc(doc(db, `adminUsers/${uid}`), { isActive: true }));
    }
  });
  await test("Non regression", "admin legitimate registry operation retained", async () => {
    await setDoc(doc(admin, "adminUsers/synthetic-delegate"), { isActive: true });
    await deleteDoc(doc(admin, "adminUsers/synthetic-delegate"));
  });
  console.table(Object.fromEntries(counts));
  console.log(`Règles : ${[...counts.values()].reduce((a, b) => a + b, 0)} cas réussis ; refus strictement permission-denied.`);
} finally {
  await env.cleanup();
}
