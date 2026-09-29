import { equal, rejects } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { CAGNOTTE_DEMO, validateCagnotteTestEnvironment, assertCagnotteEmulatorAvailable } from "./cagnotteEmulator.js";
validateCagnotteTestEnvironment(process.env); await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId: CAGNOTTE_DEMO.projectId, firestore: { host: CAGNOTTE_DEMO.host, port: CAGNOTTE_DEMO.port, rules } });
const denied = (promise: Promise<unknown>) => rejects(promise, (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "permission-denied"); let checks = 0;
try {
  await env.withSecurityRulesDisabled(async (context) => { const db = context.firestore(); await db.doc("adminUsers/clients-rules-admin").set({ isActive: true }); await db.doc("customers/clients-rules-owner").set({ uid: "clients-rules-owner", email: "owner@example.test", role: "customer", loyaltyPoints: 7, orderCount: 0, totalSpent: 0, internalNote: "historique", displayName: "Alice", phone: "" }); await db.doc("customerAdminMetadata/clients-rules-owner").set({ note: "PRIVATE", tags: ["PRIVATE"], revision: 1 }); await db.doc("customerAdminAudit/clients-rules-audit").set({ customerId: "clients-rules-owner" }); });
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext("clients-rules-owner", { email: "owner@example.test" }), env.authenticatedContext("clients-rules-admin")]) {
    const db = context.firestore(); for (const path of ["customerAdminMetadata/clients-rules-owner", "customerAdminAudit/clients-rules-audit", "cagnotteWallets/clients-rules-owner", "referrals/clients-rules-owner", "referralCodes/owner_clients-rules-owner", "blogArticleComments/clients-rules-event"]) { await denied(db.doc(path).get()); await denied(db.doc(path).set({ forged: true })); checks += 2; }
    await denied(db.doc("customers/clients-rules-owner").update({ loyaltyPoints: 999 })); await denied(db.doc("customers/clients-rules-owner").update({ internalNote: "private" })); await denied(db.doc("customers/clients-rules-owner").update({ status: "archived" })); await denied(db.doc("loyaltyMovements/clients-rules-forged").set({ customerId: "clients-rules-owner", points: 999 })); checks += 4;
  }
  const owner = env.authenticatedContext("clients-rules-owner", { email: "owner@example.test" }).firestore(); equal((await owner.doc("customers/clients-rules-owner").get()).data()?.internalNote, "historique"); await owner.doc("customers/clients-rules-owner").update({ displayName: "Alice modifiée", phone: "0600000000" }); checks += 2;
  console.log(`${checks} contrôles de règles Clients V2 validés ; notes historiques inchangées, aucune ouverture SDK.`);
} finally { await env.cleanup(); }
