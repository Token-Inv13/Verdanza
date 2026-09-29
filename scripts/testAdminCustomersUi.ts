import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium } from "playwright";
import type { CustomerAudit, CustomerIdentity, CustomerMetadata, CustomerMutation, CustomerOrder, CustomerReferralRelation, CustomerSummary } from "../src/types/adminCustomers.js";
declare global { interface Window { clientsFixture: { customers: CustomerIdentity[]; metadata: CustomerMetadata; requests: string[]; mutations: (CustomerMutation & { operationId: string })[]; summaryFail: boolean; conflict: boolean; referralActive: boolean; blocked: boolean; release: () => void } } }
const mocks = fileURLToPath(new URL("./fixtures/adminV3Mocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({ configFile: false, envFile: false, publicDir: false, logLevel: "error", esbuild: { jsx: "automatic" }, define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" },
  plugins: [{ name: "clients-fixture-auth", enforce: "pre", resolveId(source) { if (/\/(firebaseAuth|firebase)(\.[jt]sx?)?$/.test(source)) return mocks; } }],
  build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/adminCustomersFixture.tsx", import.meta.url)), name: "ClientsFixture", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } } } });
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput;
const script = output.output.find((item) => item.type === "chunk"); assert.ok(script?.type === "chunk");
const css = output.output.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => item.type === "asset" ? String(item.source) : "").join("\n");
const browser = await chromium.launch({ headless: true }); let checks = 0; const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }); page.setDefaultTimeout(10000); const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));
  await page.setContent('<html><head><base href="http://clients-fixture.test/"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: "window.__name = (value) => value;" });
  await page.evaluate(() => {
    let sequence = 0; Object.defineProperty(crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
    const alice: CustomerIdentity = { id: "alice", uid: "alice", name: "Alice témoin", email: "alice@example.test", phone: "0601020304", status: "active", archived: false, hidden: false, createdAt: "2026-09-01T00:00:00Z", points: 7, historicalOrderCount: 99, historicalOrderedCents: 99000, historicalNote: "Note ancienne", hasNote: false, hasPromo: false, tags: [] };
    window.clientsFixture = { customers: [alice, { ...alice, id: "bob", uid: "bob", name: "Bob archivé", email: "bob@example.test", status: "archived", archived: true, points: null, historicalOrderCount: null, historicalOrderedCents: null }], metadata: { revision: 0, note: "", tags: [], updatedAt: null, updatedBy: null, audit: { items: [], nextCursor: null } }, requests: [], mutations: [], summaryFail: false, conflict: false, referralActive: false, blocked: false, release: () => {} };
    window.fetch = async (url, options) => {
      if (!String(url).startsWith("/api/invoices")) throw new Error("Requête externe interdite dans la fixture");
      assertToken((options?.headers as Record<string, string>)?.authorization);
      const api = window.clientsFixture; const query = new URL(String(url), "http://fixture.test").searchParams; const action = query.get("action") || "mutation"; api.requests.push(action);
      if (options?.method === "POST") {
        const mutation = JSON.parse(String(options.body)).operation as CustomerMutation & { operationId: string }; api.mutations.push(mutation);
        if (api.blocked) await new Promise<void>((resolve) => { api.release = resolve; });
        if (api.conflict || mutation.expectedRevision !== api.metadata.revision) return Response.json({ code: "customer_conflict", error: "La fiche a changé. Rechargez-la avant de sauvegarder." }, { status: 409 });
        if (mutation.kind === "metadata") { api.metadata.note = mutation.note; api.metadata.tags = mutation.tags; api.customers[0].tags = mutation.tags; api.customers[0].hasNote = !!mutation.note; }
        if (mutation.kind === "status") { api.customers[0].status = mutation.status; api.customers[0].archived = mutation.archived; }
        if (mutation.kind === "points") api.customers[0].points = mutation.targetPoints;
        if (mutation.kind === "promo") api.customers[0].hasPromo = true;
        api.metadata.revision++; api.metadata.audit.items.unshift({ id: mutation.operationId, action: mutation.kind, adminUid: "fixture-admin", date: "2026-09-01T00:00:00Z", reason: mutation.kind === "metadata" ? "" : mutation.reason, before: {}, after: {} });
        return Response.json({ revision: api.metadata.revision, replayed: false });
      }
      if (action === "adminCustomersList") return Response.json({ items: api.customers, nextCursor: null });
      if (action === "adminCustomerSummary") {
        if (api.summaryFail) return Response.json({ error: "Résumé indisponible", code: "customers_unavailable" }, { status: 503 });
        const summary: CustomerSummary = { customer: api.customers.find((customer) => customer.id === query.get("customerId"))!, metrics: { count: 1, orderedCents: 1250, paidCents: 1250, refundedCents: null, netCents: null, averageCents: 1250, complete: true, lastOrderAt: "2026-09-01T00:00:00Z" }, lastActivityAt: "2026-09-01T00:00:00Z", activityScope: "Activité connue : commandes UID consultées" }; return Response.json(summary);
      }
      if (action === "adminCustomerOrders") { const order: CustomerOrder = { id: query.get("cursor") ? "second" : "first", reference: query.get("cursor") ? "COMMANDE-2" : "COMMANDE-1", date: null, status: "paid", paymentStatus: "paid", totalCents: 1250, paidCents: 1250, cagnotteCents: 0, refundedCents: null, refundUnknown: true, confidence: query.get("cursor") ? "probable" : "confirmed", match: query.get("cursor") ? "email" : "uid" }; return Response.json({ items: [order], nextCursor: query.get("cursor") ? null : "page-2" }); }
      if (action === "adminCustomerLoyalty") return Response.json({ points: 7, items: [{ id: "legacy", points: 2, reason: "admin_adjustment", date: null }], nextCursor: null });
      if (action === "adminCustomerMetadata") return Response.json(api.metadata);
      if (action === "adminCustomerReferral") { const relation: CustomerReferralRelation = { id: query.get("cursor") ? "child-2" : "child-1", sponsorUid: "alice", refereeUid: query.get("cursor") ? "Filleul 2" : "Filleul 1", state: "pending", orderId: "qualifier", rewardCents: 1000, compartment: "pending", date: null, reason: "attente" }; return Response.json(api.referralActive ? { mode: "active", code: "EXISTANT", sponsor: { ...relation, sponsorUid: "Parrain témoin", refereeUid: "alice" }, items: [relation], nextCursor: query.get("cursor") ? null : "next" } : { mode: "off", code: null, sponsor: null, items: [], nextCursor: null }); }
      if (action === "adminCustomerActivity") return Response.json({ items: [{ id: "event", kind: query.get("kind"), date: null, summary: `${query.get("kind")} événement réel`, href: null }], nextCursor: null });
      throw new Error(`Action fixture inattendue : ${action}`);
    };
    function assertToken(value: string) { if (value !== "Bearer fixture-admin-token") throw new Error("Authentification absente"); }
    XMLHttpRequest.prototype.open = () => { throw new Error("XHR externe interdit"); };
  });
  await page.addScriptTag({ content: script.code });
  const dialog = () => page.getByRole("dialog", { name: "Alice témoin", exact: true });
  const open = async () => { await page.getByRole("button").filter({ hasText: "Alice témoin" }).click(); await dialog().getByText("Nombre de commandes confirmées").waitFor(); };
  await page.getByRole("button").filter({ hasText: "Alice témoin" }).waitFor();
  assert.equal(await page.getByRole("button").filter({ hasText: "Bob archivé" }).count(), 0); await page.getByLabel("Rechercher").fill("absent"); await page.getByText("Aucun historique disponible.").waitFor(); await page.getByLabel("Rechercher").fill(""); await page.getByLabel("Filtrer").selectOption("archived"); await page.getByRole("button").filter({ hasText: "Bob archivé" }).waitFor(); assert.match(await page.getByRole("button").filter({ hasText: "Bob archivé" }).innerText(), /Non disponible/); await page.getByLabel("Filtrer").selectOption("active"); pass("liste, recherche, filtres, statut et valeurs inconnues");
  await open(); assert.equal(await page.evaluate(() => window.clientsFixture.requests.some((action) => ["adminCustomerOrders", "adminCustomerReferral", "adminCustomerLoyalty", "adminCustomerActivity", "adminCustomerMetadata"].includes(action))), false); assert.match(await dialog().innerText(), /12,50/); pass("grande fiche, résumé fiable et aucun onglet lourd chargé à l’ouverture");
  await dialog().getByRole("button", { name: "Commandes", exact: true }).click(); await dialog().getByText("COMMANDE-1").waitFor(); await dialog().getByRole("button", { name: "Charger la suite" }).click(); await dialog().getByText("COMMANDE-2").waitFor(); assert.match(await dialog().innerText(), /Rapprochement probable/); assert.equal(await dialog().getByRole("link", { name: "Consulter le détail dans Commandes" }).first().getAttribute("href"), "/admin/commandes?search=first"); pass("commandes progressives, confiance et détail existant");
  await dialog().getByRole("button", { name: "Fidélité", exact: true }).click(); await dialog().getByText(/7 points/).waitFor(); assert.match(await dialog().innerText(), /distincts des euros/); assert.match(await dialog().innerText(), /consultation de la cagnotte est désactivée/); await dialog().getByText(/\+2 points/).waitFor(); pass("points séparés de la cagnotte, historique et capacité désactivée");
  await dialog().getByRole("button", { name: "Parrainage", exact: true }).click(); await dialog().getByText("Le programme de parrainage est désactivé.").waitFor(); pass("parrainage désactivé explicite");
  await dialog().getByRole("button", { name: "Activité", exact: true }).click(); for (const kind of ["favorites", "reviews", "comments"]) { await dialog().getByLabel("Type d’activité").selectOption(kind); await dialog().getByText(`${kind} événement réel`).waitFor(); assert.match(await dialog().innerText(), /Non disponible/); } pass("favoris, avis et commentaires réels, dates absentes honnêtes");
  await dialog().getByRole("button", { name: "Administration", exact: true }).click(); await dialog().getByLabel("Note interne privée").fill("Note privée V2"); await dialog().getByLabel("Tags, séparés par une virgule").fill("suivi, important"); await dialog().getByRole("button", { name: "Sauvegarder la note et les tags" }).click(); await dialog().getByRole("status").filter({ hasText: "Modification enregistrée" }).waitFor(); assert.equal(await page.evaluate(() => window.clientsFixture.metadata.note), "Note privée V2"); assert.match(await dialog().innerText(), /Note historique/); pass("sauvegarde explicite note/tags privés et audit, historique préservé");
  await page.evaluate(() => {
    const api = window.clientsFixture;
    const entries: CustomerAudit[] = Array.from({ length: 23 }, (_, index) => ({ id: `audit-${index}`, action: `Action pagination ${index}`, adminUid: "fixture-admin", date: null, reason: "", before: {}, after: {} }));
    const previousFetch = window.fetch;
    window.fetch = async (url, options) => {
      const query = new URL(String(url), "http://fixture.test").searchParams;
      if (query.get("action") === "adminCustomerMetadata") {
        api.requests.push("adminCustomerMetadata");
        return Response.json({ ...api.metadata, audit: { items: query.get("cursor") ? entries.slice(20) : entries.slice(0, 20), nextCursor: query.get("cursor") ? null : "audit-page-2" } });
      }
      return previousFetch(url, options);
    };
  });
  await dialog().getByLabel("Note interne privée").fill("Note avec journal paginé");
  await dialog().getByRole("button", { name: "Sauvegarder la note et les tags" }).click();
  const journal = dialog().getByRole("heading", { name: "Journal des nouvelles actions V2" }).locator("..");
  await journal.getByText("Action pagination 19", { exact: false }).waitFor();
  assert.equal(await journal.locator("li").count(), 20);
  await journal.getByRole("button", { name: "Charger la suite" }).click();
  await journal.getByText("Action pagination 22", { exact: false }).waitFor();
  assert.equal(await journal.locator("li").count(), 23);
  await journal.getByText("Action pagination 0 ·", { exact: false }).waitFor();
  pass("journal paginé : les 20 premières entrées restent lors de l’ajout de la page 2");
  await dialog().getByLabel("Note interne privée").fill("Saisie conservée"); await page.evaluate(() => { window.clientsFixture.conflict = true; }); await dialog().getByRole("button", { name: "Sauvegarder la note et les tags" }).click(); await dialog().getByRole("alert").filter({ hasText: "La fiche a changé" }).waitFor(); assert.equal(await dialog().getByLabel("Note interne privée").inputValue(), "Saisie conservée"); await page.evaluate(() => { window.clientsFixture.conflict = false; }); pass("conflit visible, aucune perte de saisie");
  await dialog().getByLabel("Motif de l’action").fill("Archivage local"); const before = await page.evaluate(() => window.clientsFixture.mutations.length); await dialog().getByRole("button", { name: "Archiver", exact: true }).click(); const confirm = page.getByRole("dialog", { name: "Archiver ce client", exact: true }); await confirm.waitFor(); assert.equal(await page.evaluate(() => window.clientsFixture.mutations.length), before); await page.evaluate(() => { window.clientsFixture.blocked = true; }); await confirm.getByRole("button", { name: "Confirmer et continuer" }).click(); await page.waitForFunction((count) => window.clientsFixture.mutations.length > count, before); await page.keyboard.press("Escape"); assert.ok(await confirm.isVisible()); await page.evaluate(() => { window.clientsFixture.blocked = false; window.clientsFixture.release(); }); await confirm.waitFor({ state: "detached" }); await dialog().getByRole("button", { name: "Restaurer", exact: true }).waitFor(); pass("confirmation archivage, blocage durant mutation et restauration disponible");
  await dialog().getByRole("button", { name: "Restaurer", exact: true }).click(); await page.getByRole("dialog", { name: "Restaurer ce client" }).getByRole("button", { name: "Confirmer et continuer" }).click(); await page.getByRole("dialog", { name: "Restaurer ce client" }).waitFor({ state: "detached" });
  await dialog().getByLabel("Statut").selectOption("watch"); await dialog().getByRole("button", { name: "Préparer le changement" }).click(); const statusConfirm = page.getByRole("dialog", { name: "Confirmer le changement de statut" }); await statusConfirm.waitFor(); await statusConfirm.getByRole("button", { name: "Confirmer et continuer" }).click(); await statusConfirm.waitFor({ state: "detached" }); assert.equal(await page.evaluate(() => window.clientsFixture.customers[0].status), "watch"); pass("changement de statut confirmé et audité");
  await dialog().getByLabel("Nouveau solde de points").fill("9"); await dialog().getByRole("button", { name: "Préparer la correction des points" }).click(); const pointsConfirm = page.getByRole("dialog", { name: "Confirmer le solde de points historiques" }); await pointsConfirm.getByRole("button", { name: "Confirmer et continuer" }).click(); await pointsConfirm.waitFor({ state: "detached" }); assert.equal(await page.evaluate(() => window.clientsFixture.customers[0].points), 9); pass("points historiques corrigés par confirmation distincte de la cagnotte");
  await dialog().getByLabel("Code promo").selectOption("coupon-local"); await dialog().getByRole("button", { name: "Préparer l’attribution" }).click(); const promoConfirm = page.getByRole("dialog", { name: "Confirmer l’attribution du code promo" }); await promoConfirm.getByRole("button", { name: "Confirmer et continuer" }).click(); await promoConfirm.waitFor({ state: "detached" }); assert.equal(await page.evaluate(() => window.clientsFixture.customers[0].hasPromo), true); pass("attribution commerciale existante confirmée, sans action financière libre");
  await dialog().getByRole("button", { name: "Fermer la fenêtre", exact: true }).click(); await dialog().waitFor({ state: "detached" }); await page.evaluate(() => { window.clientsFixture.referralActive = true; }); await open(); await dialog().getByRole("button", { name: "Parrainage", exact: true }).click(); await dialog().getByText(/Parrain témoin/).waitFor(); await dialog().getByText(/Filleul 1/).waitFor(); const referralMutations = await page.evaluate(() => window.clientsFixture.mutations.length); await dialog().getByRole("button", { name: "Charger la suite" }).click(); await dialog().getByText(/Filleul 2/).waitFor(); assert.equal(await page.evaluate(() => window.clientsFixture.mutations.length), referralMutations); pass("parrainage actif, code/parrain/filleuls paginés, aucune mutation");
  await dialog().getByRole("button", { name: "Fermer la fenêtre", exact: true }).click(); await dialog().waitFor({ state: "detached" }); await page.evaluate(() => { window.clientsFixture.summaryFail = true; }); await page.getByRole("button").filter({ hasText: "Alice témoin" }).click(); await dialog().getByRole("alert").waitFor(); await page.evaluate(() => { window.clientsFixture.summaryFail = false; }); await dialog().getByRole("button", { name: "Réessayer" }).click(); await dialog().getByText("Nombre de commandes confirmées").waitFor(); await page.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" }); assert.deepEqual(errors, []); pass("erreur résumé, réessai, fermeture clavier, aucun appel live ni erreur runtime");
  console.log(`${checks} scénarios Clients V2 validés sur une fixture locale à viewport unique.`);
} finally { await browser.close(); }
