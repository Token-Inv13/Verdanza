import { deepEqual, equal, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AdminStockApiError, createAdminStockClient, forgetStockOperation, pendingStockOperations, rememberStockOperation } from "../src/services/adminStockService.js";
import type { StockAdjustment, StockOperationResult } from "../src/types/adminStock.js";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
} });
const input: StockAdjustment = { operationId: randomUUID(), productId: "fixture", expectedStock: 20, targetStock: 25, expectedLowStockThreshold: 5, lowStockThreshold: 5, reason: "other", note: "Comptage" };
const result: StockOperationResult = { status: "applied", operationId: input.operationId, productId: input.productId, productName: "Fixture", beforeStock: 20, afterStock: 25, delta: 5, beforeLowStockThreshold: 5, afterLowStockThreshold: 5, reason: input.reason, note: input.note, adminUid: "admin", appliedAt: "2000-01-01T00:00:00Z", replayed: true };
let checks = 0;
const test = async (name: string, run: () => Promise<unknown>) => { await run(); checks++; console.log(`PASS ${name}`); };
const uncertain = (error: unknown) => error instanceof AdminStockApiError && error.uncertain;
await test("journal durable, propriétaire distinct, nouveau ID bloqué tant que résultat incertain", async () => {
  rememberStockOperation("admin", input, "Fixture"); deepEqual(pendingStockOperations("admin")[0].operation, input); equal(pendingStockOperations("other-admin").length, 0);
  await rejects(async () => rememberStockOperation("admin", { ...input, operationId: randomUUID() }, "Fixture"), /vérifiée/);
  await rejects(async () => rememberStockOperation("", input, "Fixture"), /Session/);
});
await test("réponse perdue après application : récupération conserve ID puis résultat appliqué", async () => {
  let mutations = 0;
  const client = createAdminStockClient({ token: async () => "fixture-token", fetch: async (url, options) => {
    equal((options?.headers as Record<string, string>).authorization, "Bearer fixture-token");
    if (options?.method === "POST") { mutations++; equal(JSON.parse(String(options.body)).operation.operationId, input.operationId); throw new Error("lost after commit"); }
    equal(String(url).includes(input.operationId), true); return Response.json({ status: "applied", result });
  } });
  await rejects(client.adjust(input), uncertain); equal(pendingStockOperations("admin")[0].operation.operationId, input.operationId);
  const recovered = pendingStockOperations("admin")[0].operation; equal((await client.status(recovered.operationId)).status, "applied"); equal(mutations, 1);
  forgetStockOperation("admin", recovered.operationId); equal(pendingStockOperations("admin").length, 0);
});
await test("requête non reçue, reprise avec même ID et mêmes paramètres", async () => {
  const calls: StockAdjustment[] = []; let first = true;
  const client = createAdminStockClient({ token: async () => "token", fetch: async (_url, options) => {
    if (options?.method === "GET") return Response.json({ status: "not_executed" });
    calls.push(JSON.parse(String(options?.body)).operation);
    if (first) { first = false; throw new Error("not delivered"); }
    return Response.json({ result });
  } });
  rememberStockOperation("admin", input, "Fixture"); await rejects(client.adjust(input), uncertain); equal((await client.status(input.operationId)).status, "not_executed");
  await client.adjust(pendingStockOperations("admin")[0].operation); deepEqual(calls, [input, input]); forgetStockOperation("admin", input.operationId);
});
await test("réponse HTTP 503, JSON illisible et résultat mal identifié restent incertains", async () => {
  for (const response of [Response.json({ error: "failure", code: "unavailable" }, { status: 503 }), new Response("broken"), Response.json({ result: { ...result, operationId: randomUUID() } })]) {
    const client = createAdminStockClient({ token: async () => "token", fetch: async () => response }); await rejects(client.adjust(input), uncertain);
  }
  const client = createAdminStockClient({ token: async () => "token", fetch: async () => Response.json({ status: "applied", result: { ...result, operationId: randomUUID() } }) });
  await rejects(client.status(input.operationId), uncertain);
});
await test("conflit certain expose la valeur serveur", async () => {
  const current = { productId: input.productId, stock: 18 };
  const client = createAdminStockClient({ token: async () => "token", fetch: async () => Response.json({ code: "stock_conflict", error: "Conflit", current }, { status: 409 }) });
  await rejects(client.adjust(input), (error: unknown) => error instanceof AdminStockApiError && !error.uncertain && error.current?.stock === 18);
});
await test("auth absente n’envoie aucune requête", async () => {
  let calls = 0; const client = createAdminStockClient({ token: async () => null, fetch: async () => { calls++; return Response.json({}); } });
  await rejects(client.adjust(input), /Session admin/); equal(calls, 0);
});
await test("journal corrompu bloque une nouvelle correction", async () => {
  values.set("verdanza:admin-stock-pending:v1:admin", "{}"); await rejects(async () => rememberStockOperation("admin", input, "Fixture"), /Journal stock illisible/);
});
console.log(`${checks} groupes client/reprise stock validés, aucun accès distant.`);
