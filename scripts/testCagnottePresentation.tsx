import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { CagnottePanel, CagnotteView } from "../src/components/cagnotte/CagnottePanel.js";
import { formatCagnotteCents } from "../src/lib/cagnottePresentation.js";
import { CagnotteHttpError, CagnotteReadController, fetchCagnotte, type CagnottePanelState } from "../src/services/cagnotteService.js";
import type { CagnotteReadResponse } from "../src/types/cagnotteRead.js";
import { CAGNOTTE_READ_DISPLAY_ENABLED } from "../src/config/cagnotteFeatures.js";

assert.equal(CAGNOTTE_READ_DISPLAY_ENABLED, false);

const basic = response("active", 1234, 567, 0, 0, [{ occurredAt: "2026-09-05T10:00:00.000Z", label: "Gain en attente", amountCents: 567, details: [{ compartment: "pending", deltaCents: 567 }] }]);
const basicHtml = render(ready(basic));
assert.match(basicHtml, /Mes avantages/);
assert.match(basicHtml, /n’expirent pas automatiquement/);
assert.match(basicHtml, /12,34(?:\u00a0|&#xA0;)€/);
assert.match(render(ready(basic)), /5,67(?:\u00a0|&#xA0;)€/);
assert.equal(formatCagnotteCents(1234), "12,34\u00a0€");

const regularized = response("active", 0, 0, 0, 325, [{ occurredAt: "2026-09-04T10:00:00.000Z", label: "Régularisation des avantages", amountCents: -325, details: [{ compartment: "regularization", deltaCents: 325 }] }]);
const regularizedHtml = render(ready(regularized));
assert.match(regularizedHtml, /Aucun paiement ne vous est demandé/);
assert.match(regularizedHtml, /Régularisation des avantages/);

const transfer = response("active", 500, 0, 0, 0, [{ occurredAt: "2026-09-03T10:00:00.000Z", label: "Gain devenu disponible", amountCents: 500, details: [{ compartment: "pending", deltaCents: -500 }, { compartment: "available", deltaCents: 500 }] }]);
const transferHtml = render(ready(transfer));
assert.match(transferHtml, /5,00(?:\u00a0|&#xA0;)€ transférés/);
assert.doesNotMatch(transferHtml, /\+5,00(?:\u00a0|&#xA0;)€<\/span>/);

const reserved = response("active", 1200, 0, 800, 0, [{ occurredAt: "2026-09-05T11:00:00.000Z", label: "Cagnotte réservée", amountCents: 800, details: [{ compartment: "available", deltaCents: -800 }, { compartment: "reserved", deltaCents: 800 }] }]);
const reservedHtml = render(ready(reserved));
assert.match(reservedHtml, /Réservé pour vos commandes/);
assert.match(reservedHtml, /8,00(?:\u00a0|&#xA0;)€ réservés/);
assert.match(reservedHtml, /Certains mouvements anciens peuvent ne pas apparaître/);
assert.match(reservedHtml, /<details class="cagnotte-details">/);
assert.match(reservedHtml, /Détail des variations/);
assert.match(render(ready(response("not_created", 0, 0, 0, 0, []))), /Portefeuille non créé/);
assert.match(render(ready(response("active", 0, 0, 0, 0, []))), /Aucun mouvement horodaté/);
assert.match(render({ phase: "loading", data: null, errorCode: null }), /Chargement des avantages/);
assert.match(render({ phase: "error", data: null, errorCode: "session_expired" }), /session a expiré/);
const errorHtml = render({ phase: "error", data: null, errorCode: "cagnotte_read_unavailable" });
assert.match(errorHtml, /Historique indisponible/);
assert.doesNotMatch(errorHtml, /0,00/);
assert.match(render({ phase: "idle", data: null, errorCode: null }), /Fonctionnalité indisponible/);
assert.match(render(ready({ ...basic, history: { ...basic.history, items: [], nextCursor: "next" } })), /charger la suite/i);
const demonstrationHtml = renderToStaticMarkup(<CagnotteView state={ready(basic)} customerLabel="Camille" demonstration />);
assert.match(demonstrationHtml, /Camille/);
assert.match(demonstrationHtml, /Règles commerciales définies — programme non activé/);
const repeatedPanels = renderToStaticMarkup(<>
  <CagnotteView state={ready(basic)} />
  <CagnotteView state={ready(basic)} />
</>);
assertUniqueIdsAndAssociations(repeatedPanels);

let guardedCalls = 0;
assert.equal(renderToStaticMarkup(<CagnottePanel enabled={false} identityKey="u" scope="self" request={async () => { guardedCalls += 1; return basic; }} />), "");
assert.equal(guardedCalls, 0);

let fetchedUrl = "";
let fetchedAuthorization = "";
const fetched = await fetchCagnotte({ scope: "admin", targetUid: "customer-1", limit: 10 }, {
  getToken: async () => "client-token",
  fetch: async (input, init) => {
    fetchedUrl = String(input);
    fetchedAuthorization = String((init?.headers as Record<string, string>).authorization);
    assert.equal(init?.cache, "no-store");
    return new Response(JSON.stringify(basic), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(fetched.wallet.availableCents, 1234);
assert.equal(fetchedUrl, "/api/cagnotte?scope=admin&targetUid=customer-1&limit=10");
assert.equal(fetchedAuthorization, "Bearer client-token");
let unauthenticatedFetch = false;
await assert.rejects(() => fetchCagnotte({ scope: "self" }, { getToken: async () => undefined, fetch: async () => { unauthenticatedFetch = true; return new Response(); } }), (error: unknown) => error instanceof CagnotteHttpError && error.code === "session_expired");
assert.equal(unauthenticatedFetch, false);
await assert.rejects(() => fetchCagnotte({ scope: "self" }, { getToken: async () => "token", fetch: async () => new Response(JSON.stringify({ code: "cagnotte_read_disabled", error: "indisponible" }), { status: 503 }) }), (error: unknown) => error instanceof CagnotteHttpError && error.code === "cagnotte_read_disabled");

const pending = new Map<string, Deferred<CagnotteReadResponse>>();
const published: CagnottePanelState[] = [];
const controller = new CagnotteReadController((request) => {
  const key = request.targetUid || "self";
  const deferred = createDeferred<CagnotteReadResponse>();
  pending.set(key, deferred);
  return deferred.promise;
}, (state) => published.push(state));
controller.setIdentity({ identityKey: "A", scope: "admin", targetUid: "A" });
controller.setIdentity({ identityKey: "B", scope: "admin", targetUid: "B" });
pending.get("A")!.resolve(response("active", 9900, 0, 0, 0, []));
await flush();
assert.equal(controller.snapshot().phase, "loading");
pending.get("B")!.resolve(basic);
await flush();
assert.equal(controller.snapshot().data?.wallet.availableCents, 1234);
controller.setIdentity(null);
assert.deepEqual(controller.snapshot(), { phase: "idle", data: null, errorCode: null });

let page = 0;
const paginated = new CagnotteReadController(async () => {
  page += 1;
  return page === 1 ? { ...basic, history: { ...basic.history, items: basic.history.items, nextCursor: "page-2" } }
    : { ...basic, history: { ...basic.history, items: [{ ...basic.history.items[0], occurredAt: "2026-09-04T10:00:00.000Z", amountCents: 200 }], nextCursor: null } };
}, () => {});
paginated.setIdentity({ identityKey: "self", scope: "self" });
await flush();
paginated.loadMore();
paginated.loadMore();
await flush();
assert.equal(page, 2);
assert.deepEqual(paginated.snapshot().data?.history.items.map((item) => item.amountCents), [567, 200]);

const failing = new CagnotteReadController(async () => { throw new CagnotteHttpError("session_expired", 401, "Session expirée."); }, () => {});
failing.setIdentity({ identityKey: "self", scope: "self" });
await flush();
assert.equal(failing.snapshot().errorCode, "session_expired");
assert.ok(published.length >= 4);
console.log("Cagnotte presentation and interaction-state tests passed");

function render(state: CagnottePanelState) { return renderToStaticMarkup(<CagnotteView state={state} />); }
function ready(data: CagnotteReadResponse): CagnottePanelState { return { phase: "ready", data, errorCode: null }; }
function response(status: "active" | "not_created", availableCents: number, pendingCents: number, reservedCents: number, regularizationCents: number, items: CagnotteReadResponse["history"]["items"]): CagnotteReadResponse {
  return { currency: "EUR", capabilities: { canReadWallet: true, canRequestReservation: true, canAccrueLoyalty: true }, wallet: { status, availableCents, pendingCents, reservedCents, regularizationCents }, history: { items, nextCursor: null, completeness: "timestamped_movements_only", limitation: "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet." }, freshness: { readAt: "2026-09-05T10:00:00.000Z", consistency: "wallet_and_page", refreshStartsAtFirstPage: true } };
}
function createDeferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type Deferred<T> = ReturnType<typeof createDeferred<T>>;
function flush() { return new Promise<void>((resolve) => setImmediate(resolve)); }
function assertUniqueIdsAndAssociations(html: string) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const knownIds = new Set(ids);
  for (const match of html.matchAll(/\saria-labelledby="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) assert.ok(knownIds.has(id));
  }
}
