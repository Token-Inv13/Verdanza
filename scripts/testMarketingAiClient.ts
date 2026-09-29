import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMarketingAiClient, forgetMarketingAi, marketingAiHistory, MarketingAiApiError, pendingMarketingAi, rememberMarketingAi, rememberMarketingAiHistory } from "../src/services/marketingAiService.js";
import type { MarketingAiGeneration, MarketingAiRequest } from "../src/types/marketingAi.js";
import { aiBrief } from "./fixtures/marketingAiData.js";
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
let checks = 0;
const test = async (name: string, run: () => unknown | Promise<unknown>) => { await run(); checks++; console.log(`PASS ${name}`); };
const request: MarketingAiRequest = { generationId: randomUUID(), brief: aiBrief };
const result: MarketingAiGeneration = { id: request.generationId, proposals: [{ id: "proposal-1", kind: "banner", title: "Fixture", concept: "Concept", rationale: "Justification", parameters: {}, referencedProductIds: [] }], provider: "fixture", model: "fixture", promptVersion: "v1", createdAt: "2026-09-28T12:00:00Z", requestedBy: "admin", replayed: false };
const uncertain = (e: unknown) => e instanceof MarketingAiApiError && e.uncertain;
await test("journal par UID et double demande bloquée avant tout envoi", () => {
  rememberMarketingAi("admin", request); deepEqual(pendingMarketingAi("admin"), request); equal(pendingMarketingAi("other"), null);
  throws(() => rememberMarketingAi("admin", { ...request, generationId: randomUUID() }), /vérifiée/); throws(() => rememberMarketingAi("", request), /Session/);
});
await test("réponse perdue puis reprise après rechargement : même demande et même UUID", async () => {
  let once = true; const requests: unknown[] = [];
  const client = createMarketingAiClient({ token: async () => "fixture", fetch: async (url, init) => {
    equal(url, "/api/admin-contests?action=marketing-ai"); equal((init?.headers as Record<string, string>).authorization, "Bearer fixture"); equal(init?.cache, "no-store"); requests.push(JSON.parse(String(init?.body)));
    if (once) { once = false; throw new Error("response lost"); } return Response.json(result);
  } });
  await rejects(client.generate(request), uncertain); deepEqual(await client.generate(pendingMarketingAi("admin")!), result); deepEqual(requests, [request, request]);
  rememberMarketingAiHistory("admin", result.id); forgetMarketingAi("admin", result.id); equal(pendingMarketingAi("admin"), null); deepEqual(marketingAiHistory("admin"), [result.id]);
});
await test("régénération ajoute un ID à l'historique sans remplacer les anciens ni doubler un résultat", () => {
  const next = randomUUID(); rememberMarketingAiHistory("admin", next); rememberMarketingAiHistory("admin", result.id); deepEqual(marketingAiHistory("admin"), [result.id, next]); deepEqual(marketingAiHistory("other"), []);
});
await test("timeout/refus/quota/config connus sont terminaux, résultat pending et erreurs inconnues restent incertains", async () => {
  for (const code of ["ai_timeout", "ai_refused", "ai_quota", "ai_configuration", "ai_not_configured", "ai_invalid_proposal"]) {
    const client = createMarketingAiClient({ token: async () => "fixture", fetch: async () => Response.json({ code, error: "Fixture" }, { status: 503 }) }); await rejects(client.generate(request), (e: unknown) => e instanceof MarketingAiApiError && !e.uncertain && e.code === code);
  }
  for (const response of [Response.json({ code: "ai_generation_pending" }, { status: 503 }), Response.json({ code: "unknown" }, { status: 409 }), new Response("not json"), Response.json({ ...result, id: randomUUID() })]) {
    await rejects(createMarketingAiClient({ token: async () => "fixture", fetch: async () => response }).generate(request), uncertain);
  }
});
await test("absence de session : aucun appel, status malformé n'autorise pas la génération", async () => {
  let calls = 0; const client = createMarketingAiClient({ token: async () => undefined, fetch: async () => { calls++; return Response.json(result); } }); await rejects(client.generate(request)); equal(calls, 0);
  const status = createMarketingAiClient({ token: async () => "fixture", fetch: async () => Response.json({ contours: [] }) }); await rejects(status.status(), /indisponible/);
});
await test("journaux corrompus ou stockage interdit bloquent, aucun secret enregistré", () => {
  equal([...values.values()].some((v) => v.includes("Bearer") || v.includes("API_KEY")), false);
  values.set("verdanza:marketing-ai-pending:v1:admin", "broken"); throws(() => pendingMarketingAi("admin"), /illisible/); throws(() => rememberMarketingAi("admin", request), /illisible/);
  values.set("verdanza:marketing-ai-history:v1:other", "broken"); throws(() => marketingAiHistory("other"), /illisible/);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => { throw new Error("denied"); } } }); throws(() => rememberMarketingAi("admin", request), /denied/);
});
console.log(`${checks} groupes client IA / journal / historique validés sans réseau.`);
