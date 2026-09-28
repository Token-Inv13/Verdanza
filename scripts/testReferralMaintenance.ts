import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { getApps, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { FirebaseIdTokenVerificationError } from "../api/_server/adminAuth.js";
import { createReferralMaintenanceHandler } from "../api/_server/referralMaintenanceRoute.js";
import { REFERRAL_MAINTENANCE_COUNTERS } from "../api/_server/referralMaintenanceDryRun.js";
import { referralReadOnlyFirestore } from "../api/_server/referralReadOnlyFirestore.js";
import { reconcileReferralPaymentIdentities } from "../api/_server/referralPaymentIdentityReconciliation.js";
import { lookupReferralMaintenanceIdentity } from "../api/_server/referralMaintenanceAuth.js";
import { REFERRAL_CLOSED_RUNTIME } from "../api/_server/referralRuntimeConfig.js";
import { REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION } from "../src/types/referral.js";
import { CAGNOTTE_DEMO, assertCagnotteEmulatorAvailable } from "./cagnotteEmulator.js";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http.js";

type Dependencies = Parameters<typeof createReferralMaintenanceHandler>[0];
const secret = "maintenance-local-synthetic-secret-at-least-32-bytes";
const keyringJson = JSON.stringify({ activeVersion: "v1", keys: { v1: secret } });
const privateUid = "fixture-admin", privateEmail = "fixture-admin@example.test";
const token = (overrides: Record<string, unknown> = {}) => `fixture.${Buffer.from(JSON.stringify({
  aud: "verdanza-1f621", iss: "https://securetoken.google.com/verdanza-1f621", sub: privateUid, ...overrides,
})).toString("base64url")}.fixture-signature`;
const zeroReport = () => ({ version: "referral-payment-identity-reconciliation-v1", mode: "dry-run",
  ...Object.fromEntries(REFERRAL_MAINTENANCE_COUNTERS.map(key => [key, 0])) }) as Awaited<ReturnType<Dependencies["runDryRun"]>>;
class Response {
  statusCode = 200; body: unknown; headers = new Map<string, unknown>();
  setHeader(key: string, value: unknown) { this.headers.set(key, value); }
  status(code: number) { this.statusCode = code; return this; }
  json(body: unknown) { this.body = body; }
}
function fixture(overrides: Partial<Dependencies> = {}, membership = { uid: true, email: false }) {
  const calls: string[] = [];
  const db = { projectId: "verdanza-1f621", collection: (name: string) => {
    equal(name, "adminUsers"); return { doc: (id: string) => ({ get: async () => {
      calls.push("admin-read"); const active = id === privateUid ? membership.uid : membership.email;
      return { exists: active, data: () => ({ isActive: active }) };
    } }) };
  } } as unknown as Firestore;
  const dependencies: Dependencies = {
    enabled: () => { calls.push("gate"); return "true"; }, deploymentEnvironment: () => "production", vercelRuntime: () => "1",
    emulatorConfigured: () => false, getProjectId: () => { calls.push("project"); return "verdanza-1f621"; },
    getDb: () => { calls.push("db"); return db; }, verifyToken: async () => { calls.push("auth"); return { uid: privateUid, email: privateEmail, emailVerified: true }; },
    getRuntime: () => { calls.push("off"); return REFERRAL_CLOSED_RUNTIME; },
    getKeyringJson: () => { calls.push("keyring"); return keyringJson; },
    runDryRun: async (input) => { calls.push("engine"); deepStrictEqual(Object.keys(input).sort(), ["db", "keyringJson"]); equal(input.keyringJson, keyringJson); return zeroReport(); },
    ...overrides,
  };
  const handler = createReferralMaintenanceHandler(dependencies);
  return { calls, dependencies, invoke: async (body: unknown = { action: "dry_run" }, method: string | undefined = "POST", authorization: string | undefined = `Bearer ${token()}`) => {
    const response = new Response();
    await handler({ method, body, headers: { authorization } } as VercelRequestLike, response as unknown as VercelResponseLike);
    equal(response.headers.get("Cache-Control"), "private, no-store"); equal(response.headers.get("Vary"), "Authorization");
    return response;
  } };
}
let passed = 0;
async function test(name: string, run: () => Promise<void> | void) { await run(); passed++; console.log(`PASS maintenance ${passed}: ${name}`); }
for (const gate of [undefined, "", "false", "TRUE", "1", " true", "true ", "yes"]) await test(`gate fermé ${gate ?? "absent"}: aucun Auth/secret/Firestore`, async () => {
  const h = fixture({ enabled: () => gate, getProjectId: () => { throw new Error("unexpected-project"); },
    getDb: () => { throw new Error("unexpected-db"); }, getKeyringJson: () => { throw new Error("unexpected-keyring"); } });
  equal((await h.invoke()).statusCode, 503); deepStrictEqual(h.calls, []);
});
for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "DELETE", "PATCH"]) await test(`méthode ${method} refusée avant gate`, async () => {
  const h = fixture({ enabled: () => { throw new Error("unexpected-gate"); } });
  const result = await h.invoke({ action: "apply" }, method); equal(result.statusCode, 405); equal(result.headers.get("Allow"), "POST"); deepStrictEqual(h.calls, []);
});
await test("gate getter en panne: erreur neutre sans dépendance", async () => { const h = fixture({ enabled: () => { throw new Error(secret); } });
  const result = await h.invoke(); deepStrictEqual(result.body, { code: "referral_maintenance_disabled" }); deepStrictEqual(h.calls, []); });
for (const environment of [undefined, "preview", "development", "Production"]) await test(`contexte ${environment ?? "absent"} refusé avant Auth`, async () => {
  const h = fixture({ deploymentEnvironment: () => environment }); equal((await h.invoke()).statusCode, 503); deepStrictEqual(h.calls, ["gate"]);
});
await test("hors runtime Vercel refusé", async () => { const h = fixture({ vercelRuntime: () => undefined }); equal((await h.invoke()).statusCode, 503); deepStrictEqual(h.calls, ["gate"]); });
await test("émulateur interdit dans le contexte serveur Production", async () => { const h = fixture({ emulatorConfigured: () => true }); equal((await h.invoke()).statusCode, 503); deepStrictEqual(h.calls, ["gate"]); });
await test("projet incorrect refusé avant Auth/Firestore métier", async () => { const h = fixture({ getProjectId: () => "other-project" }); equal((await h.invoke()).statusCode, 503); deepStrictEqual(h.calls, ["gate"]); });
await test("DB réelle différente du projet configuré refusée", async () => { const h = fixture({ getDb: () => ({ projectId: "other-project" }) as unknown as Firestore }); equal((await h.invoke()).statusCode, 503); ok(!h.calls.includes("auth")); });
await test("token absent et token dans body ignoré", async () => { const h = fixture(); equal((await h.invoke({ action: "dry_run", authToken: token() }, "POST", "")).statusCode, 401); ok(!h.calls.includes("db")); });
for (const category of ["authentication", "configuration", "unavailable"] as const) await test(`échec Auth ${category} neutre`, async () => {
  const h = fixture({ verifyToken: async () => { throw new FirebaseIdTokenVerificationError(category); } });
  const result = await h.invoke(); equal(result.statusCode, category === "authentication" ? 401 : 503); ok(!h.calls.includes("keyring"));
});
await test("membre authentifié non admin refusé", async () => { const h = fixture({}, { uid: false, email: false }); equal((await h.invoke()).statusCode, 403); ok(!h.calls.includes("off")); });
await test("admin UID avec email non vérifié refusé avant lookup admin", async () => { const h = fixture({ verifyToken: async () => ({ uid: privateUid, email: privateEmail, emailVerified: false }) }); equal((await h.invoke()).statusCode, 403); ok(!h.calls.includes("admin-read")); });
await test("admin sans email refusé", async () => { const h = fixture({ verifyToken: async () => ({ uid: privateUid, email: null, emailVerified: true }) }); equal((await h.invoke()).statusCode, 403); ok(!h.calls.includes("keyring")); });
await test("membership admin par email vérifié réutilise le contrat existant", async () => { const h = fixture({}, { uid: false, email: true }); equal((await h.invoke()).statusCode, 200); });
for (const claims of [{ aud: "other-project" }, { iss: "https://securetoken.google.com/other-project" }, { sub: "other-subject" }, { firebase: { tenant: "tenant" } }]) await test("token signé vérifié lié au projet/UID/tenant exact", async () => {
  const h = fixture(); equal((await h.invoke({ action: "dry_run" }, "POST", `Bearer ${token(claims)}`)).statusCode, 401); ok(!h.calls.includes("admin-read"));
});
await test("token opaque refusé sans détail", async () => { const h = fixture(); equal((await h.invoke({ action: "dry_run" }, "POST", "Bearer opaque-fixture")).statusCode, 401); });
for (const body of [null, [], {}, "{", { action: "unknown" }, { action: "dry_run", apply: false }, { action: "dry_run", keyringJson }, { action: "dry_run", orderId: "private-order" }]) await test("payload strict refuse toute option inconnue", async () => {
  const h = fixture(); equal((await h.invoke(body)).statusCode, 400); ok(!h.calls.includes("off"));
});
for (const body of [{ action: "apply" }, { action: "apply", confirm: true }, JSON.stringify({ action: "apply" })]) await test("apply refusé absolument avant runtime/secret", async () => {
  const h = fixture(); const result = await h.invoke(body); equal(result.statusCode, 403); deepStrictEqual(result.body, { code: "referral_maintenance_action_forbidden" }); ok(!h.calls.includes("off"));
});
for (const runtime of [{ mode: "active" as const, startsAtEpochMs: 1, operational: true }, { mode: "drain" as const, startsAtEpochMs: 1, operational: true },
  { mode: "off" as const, startsAtEpochMs: null, operational: true }, { mode: "off" as const, startsAtEpochMs: 1, operational: false }]) await test("Referral non strictement OFF refusé avant keyring", async () => {
  const h = fixture({ getRuntime: () => runtime }); equal((await h.invoke()).statusCode, 503); ok(!h.calls.includes("keyring"));
});
await test("configuration Referral malformée refusée", async () => { const h = fixture({ getRuntime: () => { throw new Error(secret); } }); deepStrictEqual((await h.invoke()).body, { code: "referral_maintenance_requires_off" }); });
for (const raw of [undefined, "", "bad-json", "[]", JSON.stringify({ activeVersion: "v1", keys: { v1: "short" } })]) await test("keyring absent/invalide: erreur neutre, aucun moteur", async () => {
  const h = fixture({ getKeyringJson: () => raw }); const result = await h.invoke(); equal(result.statusCode, 503); deepStrictEqual(result.body, { code: "referral_maintenance_keyring_unavailable" }); ok(!h.calls.includes("engine"));
});
await test("ordre exact des gates et compteur-only", async () => {
  const h = fixture(); const result = await h.invoke(JSON.stringify({ action: "dry_run" })); equal(result.statusCode, 200);
  deepStrictEqual(h.calls, ["gate", "project", "db", "auth", "admin-read", "admin-read", "off", "keyring", "engine"]);
  deepStrictEqual(Object.keys(result.body as object).sort(), [...REFERRAL_MAINTENANCE_COUNTERS].sort());
});
await test("projection rejette toute PII ajoutée par le moteur", async () => {
  const h = fixture({ runDryRun: async () => ({ ...zeroReport(), uid: privateUid, email: privateEmail, HMAC: secret, blockId: "private-block", claimId: "private-claim", orderId: "private-order" }) });
  const result = await h.invoke(); equal(result.statusCode, 200); deepStrictEqual(result.body, Object.fromEntries(REFERRAL_MAINTENANCE_COUNTERS.map(key => [key, 0])));
});
for (const report of [{ ...zeroReport(), changed: 1 }, { ...zeroReport(), mode: "apply" }, { ...zeroReport(), unresolved: -1 }, { ...zeroReport(), corrupt: NaN }]) await test("rapport incohérent jamais retourné", async () => {
  const h = fixture({ runDryRun: async () => report }); equal((await h.invoke()).statusCode, 503);
});
for (const dependency of ["getProjectId", "getDb", "getKeyringJson", "runDryRun"] as const) await test("exceptions privées restent neutres et silencieuses", async () => {
  const h = fixture({ [dependency]: () => { throw new Error(`${secret} ${privateEmail} ${privateUid}`); } } as Partial<Dependencies>);
  const result = await h.invoke(); equal(result.statusCode, 503); ok(!JSON.stringify(result.body).includes(secret)); ok(!JSON.stringify(result.body).includes(privateEmail));
});
await test("import/default POST fermé n'initialise ni Firebase ni keyring", async () => {
  const apps = getApps().map(app => app.name), env = process.env;
  process.env = new Proxy(env, { get(target, key) { if (key === "REFERRAL_MAINTENANCE_DRY_RUN_ENABLED") return undefined;
    if (key === "REFERRAL_EMAIL_HMAC_KEYRING_JSON" || key === "FIREBASE_SERVICE_ACCOUNT_BASE64") throw new Error("unexpected-sensitive-env-read"); return Reflect.get(target, key); } });
  try { const handler = (await import("../api/referral-maintenance.js")).default; const response = new Response();
    await handler({ method: "POST", headers: {}, body: { action: "dry_run" } } as VercelRequestLike, response as unknown as VercelResponseLike);
    equal(response.statusCode, 503); deepStrictEqual(response.body, { code: "referral_maintenance_disabled" }); deepStrictEqual(getApps().map(app => app.name), apps);
  } finally { process.env = env; }
});
await test("façade impose apply false, politique fixe et DB sans écritures", () => {
  const source = readFileSync("api/_server/referralMaintenanceDryRun.ts", "utf8");
  ok(source.includes("apply: false")); ok(source.includes("legacyEmailBlockPolicyVersion: REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION"));
  ok(source.includes("db: referralReadOnlyFirestore(input.db)")); ok(!source.includes("...input"));
});
await test("Auth maintenance utilise uniquement accounts:lookup sans mutation", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    equal(init?.method, "POST");
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return { ok: true, json: async () => ({ users: [{ localId: privateUid, email: privateEmail, disabled: false, emailVerified: true, createdAt: "1000" }] }) } as globalThis.Response;
  }) as typeof fetch;
  for (const criteria of [{ uid: privateUid }, { email: privateEmail }]) {
    await lookupReferralMaintenanceIdentity({ ...criteria, projectId: "verdanza-1f621", accessToken: "fixture-access-token", fetchImpl });
  }
  deepStrictEqual(calls, [
    { url: "https://identitytoolkit.googleapis.com/v1/projects/verdanza-1f621/accounts:lookup", body: { localId: [privateUid] } },
    { url: "https://identitytoolkit.googleapis.com/v1/projects/verdanza-1f621/accounts:lookup", body: { email: [privateEmail] } },
  ]);
});
await test("échec Auth maintenance ne retourne aucun détail fournisseur", async () => {
  try {
    await lookupReferralMaintenanceIdentity({ uid: privateUid, projectId: "verdanza-1f621", accessToken: "fixture-access-token",
      fetchImpl: (async () => ({ ok: false, json: async () => ({ error: `${privateUid} ${privateEmail} ${secret}` }) })) as unknown as typeof fetch });
    throw new Error("expected-refusal");
  } catch (error) { equal((error as Error).message, "referral_maintenance_auth_unavailable"); }
});

await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const app = initializeApp({ projectId: CAGNOTTE_DEMO.projectId }, "referral-maintenance-tests"), db = getFirestore(app);
const collections = ["orders", "referralPaymentIdentities", "referralEmailBlocks", "referralEmailClaims", "referrals", "cagnotteWallets", "cagnotteMovements", "referralMigrations"];
const capture = () => Promise.all(collections.map(async name => [name, (await db.collection(name).get()).docs.map(doc => ({ id: doc.id, data: doc.data(), updated: doc.updateTime.toMillis() }))]));
try {
  for (const name of collections) await db.recursiveDelete(db.collection(name));
  const order = (uid: string, email: string) => ({ customerId: uid, customerEmail: email, paymentStatus: "paid", orderType: "order", total: 60,
    paidAt: "2000-01-09T00:00:00.000Z", items: [{ productId: "fixture-product", quantity: 1, unitPrice: 60, lineTotal: 60 }] });
  await db.collection("orders").doc("b3-fixture").set(order("legacy-disabled", "legacy-block@example.test"));
  await db.collection("orders").doc("unresolved-fixture").set(order("unresolved-customer", "unresolved@example.test"));
  const before = await capture();
  const readonly = referralReadOnlyFirestore(db);
  const runDryRun: Dependencies["runDryRun"] = async ({ keyringJson: raw }) => reconcileReferralPaymentIdentities({
    db: readonly, projectId: CAGNOTTE_DEMO.projectId, keyringJson: raw, apply: false, legacyEmailBlockPolicyVersion: REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION,
    pageSize: 1, getIdentity: async uid => { if (uid !== "legacy-disabled") throw new Error("fixture-account-unavailable"); return { uid, email: "legacy-block@example.test", disabled: true, emailVerified: false, createdAtEpochMs: 1000 }; },
    getIdentityByEmail: async () => ({ uid: "legacy-disabled", email: "legacy-block@example.test", disabled: true, emailVerified: false, createdAtEpochMs: 1000 }),
  });
  await test("B3 réel émulateur par la route: legacyBlocked=1 changed=0 unresolved compteur", async () => {
    const h = fixture({ runDryRun }); const result = await h.invoke(); equal(result.statusCode, 200);
    equal(Reflect.get(result.body as object, "legacyBlocked"), 1); equal(Reflect.get(result.body as object, "unresolved"), 1); equal(Reflect.get(result.body as object, "changed"), 0);
    deepStrictEqual(await capture(), before);
  });
  await test("retry dry-run laisse timestamps et données inchangés", async () => {
    const h = fixture({ runDryRun }); deepStrictEqual((await h.invoke()).body, (await h.invoke()).body); deepStrictEqual(await capture(), before);
  });
  await test("capacités SDK write interdites sur db/document/query/snapshot/transaction", async () => {
    for (const method of ["batch", "bulkWriter", "recursiveDelete"]) throws(() => Reflect.get(readonly, method), /read_only/);
    const ref = readonly.collection("orders").doc("b3-fixture");
    for (const method of ["set", "create", "update", "delete"]) throws(() => Reflect.get(ref, method), /read_only/);
    const snapshot = await ref.get(); throws(() => snapshot.ref.set({ forbidden: true }), /read_only/);
    const query = await readonly.collection("orders").limit(1).get(); throws(() => query.docs[0].ref.delete(), /read_only/);
    await readonly.runTransaction(async tx => { const snap = await tx.get(ref); equal(snap.exists, true);
      for (const method of ["set", "create", "update", "delete"]) throws(() => Reflect.get(tx, method), /read_only/);
    });
    deepStrictEqual(await capture(), before);
  });
  await test("aucune écriture Auth ni fuite stdout/stderr/logs pendant dry-run", async () => {
    const stdout = process.stdout.write, stderr = process.stderr.write; const output: string[] = [];
    const intercept = ((chunk: string | Uint8Array) => { output.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)); return true; }) as typeof stdout;
    process.stdout.write = intercept; process.stderr.write = intercept;
    try { equal((await fixture({ runDryRun }).invoke()).statusCode, 200);
      const h = fixture({ runDryRun: async () => { throw new Error(`${secret} ${privateUid} ${privateEmail}`); } }); equal((await h.invoke()).statusCode, 503);
    } finally { process.stdout.write = stdout; process.stderr.write = stderr; }
    deepStrictEqual(output, []); deepStrictEqual(await capture(), before);
  });
  await test("programme OFF et aucune relation/reward/wallet/marker/block/claim créé", async () => {
    deepStrictEqual(REFERRAL_CLOSED_RUNTIME, { mode: "off", startsAtEpochMs: null, operational: false });
    for (const name of collections.filter(name => name !== "orders")) equal((await db.collection(name).get()).size, 0);
  });
} finally { await deleteApp(app); }
console.log(`Referral maintenance: ${passed} PASS`);
