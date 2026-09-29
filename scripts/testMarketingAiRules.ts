import { rejects } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { CAGNOTTE_DEMO, validateCagnotteTestEnvironment, assertCagnotteEmulatorAvailable } from "./cagnotteEmulator.js";
validateCagnotteTestEnvironment(process.env); await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const env = await initializeTestEnvironment({ projectId: CAGNOTTE_DEMO.projectId, firestore: { host: CAGNOTTE_DEMO.host, port: CAGNOTTE_DEMO.port, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
let checks = 0;
const denied = (op: Promise<unknown>) => rejects(op, (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "permission-denied"));
try {
  await env.withSecurityRulesDisabled(async (context) => { const db = context.firestore(); await db.doc("adminUsers/ai-rules-admin").set({ isActive: true }); await db.doc("marketingAiGenerations/generation-fixture").set({ proposals: [], model: "private" }); await db.doc("marketingAiGenerations/quota-fixture").set({ count: 1 }); });
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext("customer"), env.authenticatedContext("ai-rules-admin")]) {
    const db = context.firestore(); for (const id of ["generation-fixture", "quota-fixture"]) {
      await denied(db.doc("marketingAiGenerations/" + id).get()); await denied(db.doc("marketingAiGenerations/" + id).set({ forged: true })); await denied(db.doc("marketingAiGenerations/" + id).update({ forged: true })); await denied(db.doc("marketingAiGenerations/" + id).delete()); checks += 4;
    }
    await denied(db.collection("marketingAiGenerations").get()); checks++;
  }
  console.log(`${checks} contrôles de règles IA : générations et quotas backend-only.`);
} finally { await env.cleanup(); }
