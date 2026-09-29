import { equal, rejects } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { CAGNOTTE_DEMO, validateCagnotteTestEnvironment, assertCagnotteEmulatorAvailable } from "./cagnotteEmulator.js";
validateCagnotteTestEnvironment(process.env); await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const env = await initializeTestEnvironment({ projectId: CAGNOTTE_DEMO.projectId, firestore: { host: CAGNOTTE_DEMO.host, port: CAGNOTTE_DEMO.port, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
const denied = (op: Promise<unknown>) => rejects(op, (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "permission-denied")); let checks = 0;
try {
  const collections = ["productSelections", "selectionWorkflows", "selectionOperations", "selectionSources", "selectionPricingPolicies", "productSelectionSheets"];
  await env.withSecurityRulesDisabled(async (c) => { const db = c.firestore(); await db.doc("adminUsers/pipeline-rules-admin").set({ isActive: true }); for (const collection of collections) await db.doc(`${collection}/fixture`).set({ secret: "cost or note" }); await db.doc("products/pipeline-inactive").set({ isActive: false, name: "Projection propre", stock: 20 }); await db.doc("products/pipeline-active").set({ isActive: true, name: "Projection propre", stock: 20 }); });
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext("customer"), env.authenticatedContext("pipeline-rules-admin")]) {
    const db = context.firestore();
    for (const collection of collections) { await denied(db.doc(`${collection}/fixture`).get()); await denied(db.doc(`${collection}/forged`).set({ secret: "forged" })); await denied(db.doc(`${collection}/fixture`).update({ secret: "changed" })); await denied(db.doc(`${collection}/fixture`).delete()); checks += 4; }
    await denied(db.doc("products/pipeline-active").update({ stock: 100 })); checks++;
  }
  for (const c of [env.unauthenticatedContext(), env.authenticatedContext("customer")]) { await denied(c.firestore().doc("products/pipeline-inactive").get()); equal((await c.firestore().doc("products/pipeline-active").get()).data()?.name, "Projection propre"); checks += 2; }
  equal((await env.authenticatedContext("pipeline-rules-admin").firestore().doc("products/pipeline-inactive").get()).data()?.stock, 20); checks++;
  console.log(`${checks} contrôles de confidentialité/règles pipeline validés.`);
} finally { await env.cleanup(); }
