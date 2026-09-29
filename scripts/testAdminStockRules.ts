import { equal, rejects } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

import { CAGNOTTE_DEMO, validateCagnotteTestEnvironment, assertCagnotteEmulatorAvailable } from "./cagnotteEmulator.js";

validateCagnotteTestEnvironment(process.env);
await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId: CAGNOTTE_DEMO.projectId, firestore: { host: CAGNOTTE_DEMO.host, port: CAGNOTTE_DEMO.port, rules } });

const denied = (operation: Promise<unknown>) => rejects(operation, (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "permission-denied"));
let checks = 0;
try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("adminUsers/rules-stock-admin").set({ isActive: true });
    await db.doc("products/rules-stock-product").set({ isActive: true, isFeatured: false, stock: 20, lowStockThreshold: 5 });
    await db.doc("stockMovements/rules-stock-legacy").set({ productId: "rules-stock-product", type: "sale", quantity: -2 });
  });
  for (const context of [env.authenticatedContext("rules-stock-admin"), env.authenticatedContext("customer"), env.unauthenticatedContext()]) {
    const db = context.firestore();
    await denied(db.doc("products/rules-stock-product").update({ stock: 25 }));
    await denied(db.doc("products/rules-stock-product").update({ lowStockThreshold: 7 }));
    await denied(db.doc("products/rules-stock-forged").set({ isActive: true, stock: 100 }));
    await denied(db.doc("stockMovements/rules-stock-forged").set({ type: "admin_adjustment", quantity: 999 }));
    await denied(db.doc("stockMovements/rules-stock-legacy").update({ quantity: 999 }));
    await denied(db.doc("stockMovements/rules-stock-legacy").delete()); checks += 6;
  }
  const admin = env.authenticatedContext("rules-stock-admin").firestore();
  await admin.doc("products/rules-stock-product").update({ isFeatured: true, updatedAt: "fixture" }); checks++;
  equal((await admin.doc("stockMovements/rules-stock-legacy").get()).data()?.quantity, -2); checks++;
  equal((await env.unauthenticatedContext().firestore().doc("products/rules-stock-product").get()).data()?.stock, 20); checks++;
  await denied(env.authenticatedContext("customer").firestore().doc("stockMovements/rules-stock-legacy").get()); checks++;
  console.log(`${checks} contrôles des règles stock validés sur émulateur uniquement.`);
} finally { await env.cleanup(); }
