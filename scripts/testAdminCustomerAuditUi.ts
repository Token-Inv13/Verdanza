import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";
import type { AuditFixtureState } from "./fixtures/adminCustomerAuditFixture";
import type { CustomerAudit, CustomerIdentity, CustomerMutation } from "../src/types/adminCustomers";

const mocks = fileURLToPath(new URL("./fixtures/adminV3Mocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" },
  define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" },
  plugins: [{ name: "audit-fixture-auth", enforce: "pre", resolveId(source) { if (/\/(firebaseAuth|firebase)(\.[jt]sx?)?$/.test(source)) return mocks; } }],
  build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/adminCustomerAuditFixture.tsx", import.meta.url)), name: "AuditFixture", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } } } });
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput;
const script = output.output.find((item) => item.type === "chunk"); assert.ok(script?.type === "chunk");
const css = output.output.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => item.type === "asset" ? String(item.source) : "").join("\n");
const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
  for (const width of [1100, 380]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => route.abort());
    await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: "window.__name = (value) => value;" });
    await page.evaluate(() => {
      const identity = (id: string): CustomerIdentity => ({ id, uid: id, name: id, email: `${id}@example.test`, phone: "", status: "active", archived: false, hidden: false, createdAt: null, points: 0, historicalOrderCount: 0, historicalOrderedCents: 0, historicalNote: "", hasNote: true, hasPromo: false, tags: [] });
      const entries = (id: string, count: number): CustomerAudit[] => Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, action: `${id} action ${index}`, adminUid: "fixture-admin", date: null, reason: "", before: {}, after: {} }));
      const api: AuditFixtureState = { customers: [identity("alice"), identity("bob")], metadata: {
        alice: { revision: 0, note: "Note Alice", tags: ["alice"], updatedAt: null, updatedBy: null, audit: { items: [], nextCursor: null } },
        bob: { revision: 0, note: "Note Bob", tags: ["bob"], updatedAt: null, updatedBy: null, audit: { items: [], nextCursor: null } },
      }, entries: { alice: entries("alice", 45), bob: entries("bob", 2) }, requests: [], mutations: [], failNextPage: false, holdNextPage: false, release: () => {}, settled: 0, aborted: 0 };
      window.customerAuditFixture = api;
      let operationId = 0;
      Object.defineProperty(crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${String(++operationId).padStart(12, "0")}` });
      window.fetch = async (url, options) => {
        if (!String(url).startsWith("/api/invoices")) throw new Error("External request forbidden");
        if ((options?.headers as Record<string, string>)?.authorization !== "Bearer fixture-admin-token") throw new Error("Fixture token required");
        if (options?.method === "POST") {
          const mutation = JSON.parse(String(options.body)).operation as CustomerMutation;
          api.mutations.push(mutation);
          const metadata = api.metadata[mutation.customerId];
          if (mutation.kind !== "metadata" || mutation.expectedRevision !== metadata.revision) return Response.json({ error: "Unexpected revision or operation" }, { status: 409 });
          metadata.note = mutation.note; metadata.tags = mutation.tags; metadata.revision++;
          api.entries[mutation.customerId].unshift({ id: `saved-${metadata.revision}`, action: `saved action ${metadata.revision}`, adminUid: "fixture-admin", date: null, reason: "", before: {}, after: {} });
          return Response.json({ revision: metadata.revision, replayed: false });
        }
        const query = new URL(String(url), "http://fixture.test").searchParams;
        if (query.get("action") !== "adminCustomerMetadata") throw new Error("Unexpected resource");
        const customerId = query.get("customerId")!;
        const cursor = query.get("cursor");
        api.requests.push({ customerId, cursor });
        const offset = cursor ? Number(cursor) : 0;
        const snapshot = structuredClone({ ...api.metadata[customerId], audit: { items: api.entries[customerId].slice(Math.max(0, offset - (cursor ? 1 : 0)), offset + 20), nextCursor: api.entries[customerId].length > offset + 20 ? String(offset + 20) : null } });
        if (cursor) { snapshot.note = "Unrelated paged note"; snapshot.tags = ["paged"]; snapshot.revision = 999; }
        if (cursor && api.failNextPage) { api.failNextPage = false; return Response.json({ error: "Erreur page suivante simulée" }, { status: 503 }); }
        if (cursor && api.holdNextPage) {
          api.holdNextPage = false;
          options?.signal?.addEventListener("abort", () => { api.aborted++; }, { once: true });
          // Deliberately deliver even after abort to exercise stale-response protection.
          await new Promise<void>((resolve) => { api.release = resolve; });
        }
        api.settled++;
        return Response.json(snapshot);
      };
    });
    await page.addScriptTag({ content: script.code });
    const journal = page.getByRole("heading", { name: "Journal des nouvelles actions V2" }).locator("..");
    const more = () => journal.getByRole("button", { name: "Charger la suite" });
    const count = async (expected: number) => { await page.waitForFunction((value) => document.querySelectorAll("main section:last-of-type li").length === value, expected); assert.equal(await journal.locator("li").count(), expected); };
    const pass = (name: string) => { checks++; console.log(`PASS audit ${width}px ${name}`); };
    const settle = async () => { await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); };
    await count(20); await page.waitForFunction(() => (document.querySelector("textarea") as HTMLTextAreaElement)?.value === "Note Alice");
    await journal.getByText("alice action 0 ·", { exact: false }).waitFor(); pass("A première page de 20 entrées");
    await page.getByLabel("Note interne privée").fill("Brouillon conservé");
    await page.getByLabel("Tags, séparés par une virgule").fill("brouillon");
    await page.evaluate(() => { window.customerAuditFixture.failNextPage = true; });
    await more().click(); await journal.getByRole("alert").waitFor(); await count(20);
    assert.equal(await page.getByLabel("Note interne privée").inputValue(), "Brouillon conservé"); pass("F erreur page 2 : page 1 et saisie conservées");
    await journal.getByRole("button", { name: "Réessayer" }).click(); await count(40);
    await journal.getByText("alice action 0 ·", { exact: false }).waitFor();
    assert.equal(await journal.getByRole("alert").count(), 0);
    assert.equal(await page.getByLabel("Tags, séparés par une virgule").inputValue(), "brouillon");
    assert.equal(await page.getByLabel("Note interne privée").inputValue(), "Brouillon conservé");
    assert.match(await page.getByText(/Réservés à l’administration/).innerText(), /Révision 0/);
    pass("B/G page 2 ajoutée une fois après retry, métadonnées non paginées");
    await more().click(); await count(45);
    const actions = await journal.locator("li p:first-child").allTextContents();
    assert.equal(new Set(actions).size, 45); assert.equal(await more().count(), 0); pass("C/D/E troisième page, IDs uniques, curseur final null");
    await page.getByRole("button", { name: "Sauvegarder la note et les tags" }).click();
    await journal.getByText("saved action 1 ·", { exact: false }).waitFor(); await count(20);
    assert.match(await page.getByText(/Réservés à l’administration/).innerText(), /Révision 1/);
    assert.equal(await page.evaluate(() => window.customerAuditFixture.requests.at(-1)?.cursor), null);
    pass("I mutation : relecture initiale et journal resynchronisé");
    const beforeDouble = await page.evaluate(() => window.customerAuditFixture.requests.filter((request) => request.cursor !== null).length);
    await page.evaluate(() => { window.customerAuditFixture.holdNextPage = true; });
    await more().evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await page.waitForFunction((before) => window.customerAuditFixture.requests.filter((request) => request.cursor !== null).length > before, beforeDouble);
    assert.equal(await page.evaluate(() => window.customerAuditFixture.requests.filter((request) => request.cursor !== null).length), beforeDouble + 1);
    assert.ok(await more().isDisabled()); await page.evaluate(() => window.customerAuditFixture.release()); await count(40); pass("J double déclenchement : une seule requête effective");
    await page.evaluate(() => { window.customerAuditFixture.holdNextPage = true; });
    await more().click(); await page.waitForFunction(() => window.customerAuditFixture.requests.at(-1)?.cursor === "40");
    await page.getByLabel("Note interne privée").fill("Nouvelle note après pagination");
    await page.getByRole("button", { name: "Sauvegarder la note et les tags" }).click();
    await journal.getByText("saved action 2 ·", { exact: false }).waitFor(); await count(20);
    await page.evaluate(() => window.customerAuditFixture.release()); await settle(); await count(20);
    pass("reload pendant page suivante : ancienne réponse ignorée");
    await page.evaluate(() => { window.customerAuditFixture.holdNextPage = true; });
    await more().click(); await page.waitForFunction(() => window.customerAuditFixture.requests.at(-1)?.cursor === "20");
    await page.getByRole("button", { name: "Client Bob", exact: true }).click(); await count(2);
    await journal.getByText("bob action 0 ·", { exact: false }).waitFor();
    await page.evaluate(() => window.customerAuditFixture.release()); await settle(); await count(2);
    assert.doesNotMatch(await journal.innerText(), /alice action|saved action/);
    assert.equal(await page.getByLabel("Note interne privée").inputValue(), "Note Bob"); pass("H changement de client : ancien journal et réponse tardive exclus");
    await page.getByRole("button", { name: "Client Alice", exact: true }).click(); await count(20);
    await page.evaluate(() => { window.customerAuditFixture.holdNextPage = true; }); await more().click();
    await page.waitForFunction(() => window.customerAuditFixture.requests.at(-1)?.cursor === "20");
    await page.getByRole("button", { name: "Démonter", exact: true }).click();
    await journal.waitFor({ state: "detached" }); await page.evaluate(() => window.customerAuditFixture.release()); await settle();
    await page.getByRole("button", { name: "Remonter", exact: true }).click(); await count(20);
    assert.ok(await page.evaluate(() => window.customerAuditFixture.aborted) >= 3);
    assert.deepEqual(errors, []); pass("démontage : requête annulée et remontage sans réponse résiduelle");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await more().isVisible()); pass("layout et actions accessibles, aucun débordement horizontal");
    await page.close();
  }
  console.log(`${checks} contrôles de pagination du journal Clients V2 validés sans accès distant.`);
} finally { await browser.close(); }
