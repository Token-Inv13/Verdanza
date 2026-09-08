import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CagnotteCheckoutPanel,
  CagnotteCheckoutView,
  CheckoutAttemptNotice,
  CheckoutCreationSummary,
} from "../src/components/cagnotte/CagnotteCheckoutPanel.js";
import { CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED } from "../src/config/cagnotteFeatures.js";
import {
  CagnotteCheckoutController,
  CheckoutAttemptController,
  parseFrenchEuroCents,
  type CagnotteCheckoutState,
  type CheckoutAttemptMarker,
} from "../src/services/cagnotteCheckoutService.js";
import { createCheckoutOrder, CreateOrderHttpError, type CheckoutOrderResult, type CreateCheckoutOrderInput } from "../src/services/ordersService.js";
import { quoteOrder, type OrderQuote } from "../src/services/quoteService.js";
import type { CagnotteReadResponse } from "../src/types/cagnotteRead.js";

assert.equal(CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED, false);
let guardedCalls = 0;
assert.equal(renderToStaticMarkup(<CagnotteCheckoutPanel
  enabled={false}
  mode="cart"
  state={state()}
  authenticated
  onToggle={() => { guardedCalls += 1; }}
  onAmountChange={() => { guardedCalls += 1; }}
  onRequest={() => { guardedCalls += 1; }}
  onMaximum={() => { guardedCalls += 1; }}
/>), "");
assert.equal(guardedCalls, 0);

assert.equal(parseFrenchEuroCents("8,50"), 850);
assert.equal(parseFrenchEuroCents("8.5"), 850);
for (const invalid of ["-1", "1e2", "Infinity", "8,501", "1 000", "12x", "0", ""]) {
  assert.throws(() => parseFrenchEuroCents(invalid), /montant|Saisissez/i, invalid);
}

let guestTokenCalls = 0;
let guestBody: Record<string, unknown> = {};
await quoteOrder({ items: [], deliveryMethod: "postal" }, {
  getToken: async () => { guestTokenCalls += 1; return "unused"; },
  fetch: async (_input, init) => {
    guestBody = JSON.parse(String(init?.body));
    return Response.json(ordinaryQuote());
  },
});
assert.equal(guestTokenCalls, 0, "le devis invité ordinaire ne réclame pas de jeton");
assert.equal("authToken" in guestBody, false);
assert.equal("cagnotteUse" in guestBody, false);

const controllerStates: CagnotteCheckoutState[] = [];
const controller = new CagnotteCheckoutController((next) => controllerStates.push(next));
controller.setIdentity("customer-a");
controller.setContext("cart-a");
await controller.loadWallet(async () => wallet());
assert.equal(controller.snapshot().wallet?.wallet.availableCents, 2000);
assert.equal(controller.snapshot().wallet?.wallet.pendingCents, 350);
assert.equal(controller.snapshot().wallet?.wallet.reservedCents, 500);
assert.equal(controller.snapshot().wallet?.capabilities.canRequestReservation, true);
assert.equal(controller.snapshot().wallet?.capabilities.canAccrueLoyalty, false, "les gains suspendus n’interdisent pas l’utilisation");

let maximumRequested = 0;
await controller.requestMaximum(async (requested) => {
  maximumRequested = requested;
  return cagnotteQuote(requested, 800, 9200, "maximum-quote", ["twenty_percent_cap"]);
});
assert.equal(maximumRequested, 2000, "le maximum envoyé reste une demande que le serveur peut limiter");
assert.equal(controller.snapshot().proposal?.cagnotteUse?.proposedCagnotteCents, 800);

const suspendedUse = new CagnotteCheckoutController(() => undefined);
suspendedUse.setIdentity("customer-suspended-use");
await suspendedUse.loadWallet(async () => ({ ...wallet(), capabilities: { canReadWallet: true, canRequestReservation: false, canAccrueLoyalty: true } }));
let suspendedUseCalls = 0;
await suspendedUse.requestMaximum(async () => { suspendedUseCalls += 1; return cagnotteQuote(800, 800, 9200, "unexpected"); });
assert.equal(suspendedUseCalls, 0);
assert.equal(suspendedUse.snapshot().proposalErrorCode, "RESERVATIONS_DISABLED");

controller.setSelectionEnabled(true);
controller.setAmountInput("8,50");
assert.equal(await controller.requestProposal(async (requested) => cagnotteQuote(requested, 800, 9200, "quote-1")), controller.snapshot().proposal);
assert.equal(controller.snapshot().proposal?.cagnotteUse?.requestedCagnotteCents, 850);
assert.equal(controller.acceptProposal()?.acceptedCagnotteCents, 800);

const pendingChanged = deferred<OrderQuote>();
const revalidation = controller.revalidate(() => pendingChanged.promise);
controller.setContext("cart-b-address-changed");
pendingChanged.resolve(cagnotteQuote(850, 800, 9200, "late-old-context"));
await revalidation;
assert.equal(controller.snapshot().proposal, null, "une réponse tardive d’un ancien contexte est ignorée");
assert.equal(controller.snapshot().proposalPhase, "invalidated");

controller.setAmountInput("8,00");
await controller.requestProposal(async (requested) => cagnotteQuote(requested, 800, 9200, "quote-2"));
controller.acceptProposal();
const changed = await controller.revalidate(async (requested) => cagnotteQuote(requested, 400, 9600, "quote-3", ["available_balance"]));
assert.equal(changed.accepted, false);
assert.equal(controller.snapshot().proposalPhase, "changed");
assert.equal(controller.snapshot().acceptance, null);
assert.equal(controller.snapshot().proposal?.cagnotteUse?.payableCents, 9600);

await controller.continueWithout(async () => ordinaryQuote());
assert.equal(controller.snapshot().fallbackPhase, "ready");
assert.equal(controller.snapshot().fallbackAccepted, false, "le plein tarif exige une nouvelle validation");
assert.equal(controller.acceptWithoutCagnotte(), true);

const oldWallet = deferred<CagnotteReadResponse>();
const identityController = new CagnotteCheckoutController(() => undefined);
identityController.setIdentity("customer-a");
const oldWalletLoad = identityController.loadWallet(() => oldWallet.promise);
identityController.setIdentity("customer-b");
oldWallet.resolve(wallet({ availableCents: 9999 }));
await oldWalletLoad;
assert.equal(identityController.snapshot().wallet, null, "un compte ne voit pas la réponse tardive de l’autre");

const errorController = new CagnotteCheckoutController(() => undefined);
errorController.setIdentity("customer-error");
await errorController.loadWallet(async () => { throw Object.assign(new Error("indisponible"), { code: "cagnotte_read_unavailable" }); });
const errorHtml = renderCheckout(errorController.snapshot());
assert.match(errorHtml, /Aucun solde nul n’est supposé/);
assert.doesNotMatch(errorHtml, /Disponible<\/dt><dd>0,00/);
const zeroHtml = renderCheckout(state({ walletPhase: "ready", wallet: wallet({ availableCents: 0 }) }));
assert.match(zeroHtml, /Aucun crédit disponible/);

const blockedHtml = renderCheckout(state({
  walletPhase: "ready",
  wallet: wallet(),
  selectionEnabled: true,
  amountInput: "8,00",
  proposalPhase: "ready",
  proposal: cagnotteQuote(800, 0, 10000, "blocked", ["compatibility_blocked"], "blocked", 500, "estimated"),
}));
assert.match(blockedHtml, /Une offre promotionnelle s’applique/);
assert.match(blockedHtml, /la cagnotte ne peut pas être utilisée/);
assert.match(blockedHtml, /L’offre reste conservée/);
assert.match(blockedHtml, /Vous continuez à cumuler de la fidélité sur les produits payés/);
assert.match(blockedHtml, /Gain estimé après paiement et livraison : 5,00(?:\u00a0|&#xA0;)€/);
assert.doesNotMatch(blockedHtml, /Aucun nouveau gain n’est annoncé/);

const changedHtml = renderCheckout(state({
  walletPhase: "ready",
  wallet: wallet(),
  selectionEnabled: true,
  amountInput: "8,00",
  proposalPhase: "changed",
  proposal: cagnotteQuote(800, 400, 9600, "changed"),
}));
assert.match(changedHtml, /Le montant a changé/);
assert.match(changedHtml, /96,00(?:\u00a0|&#xA0;)€ à régler/);

const successResult = orderResult();
const successHtml = renderToStaticMarkup(<CheckoutCreationSummary result={successResult} />);
assert.match(successHtml, /Commande enregistrée/);
assert.match(successHtml, /Cagnotte réservée/);
assert.match(successHtml, /Paiement encore attendu/);
assert.doesNotMatch(successHtml, /livraison confirmée|crédités|paiement effectué/i);
const paidHtml = renderToStaticMarkup(<CheckoutCreationSummary result={{ ...successResult, paymentStatus: "paid", paymentAmount: 0 }} />);
assert.match(paidHtml, /Règlement confirmé/);
assert.doesNotMatch(paidHtml, /Paiement encore attendu/);
assert.match(renderToStaticMarkup(<CheckoutAttemptNotice phase="uncertain" error="" onRetry={() => undefined} />), /commande peut avoir été enregistrée/i);
assert.match(renderToStaticMarkup(<CheckoutAttemptNotice phase="refused" error="Le stock a changé." />), /Commande non enregistrée/);

const persisted: Array<{ identity: string; marker: CheckoutAttemptMarker }> = [];
let completed = 0;
let refused = 0;
const attempt = new CheckoutAttemptController(() => undefined, {
  mark: (identity, marker) => persisted.push({ identity, marker }),
  complete: () => { completed += 1; },
  refused: () => { refused += 1; },
});
attempt.setIdentity("customer-a");
const request = checkoutRequest();
const originalRequestJson = JSON.stringify(request);
const creation = deferred<CheckoutOrderResult>();
let sendCalls = 0;
const first = attempt.submit(request.checkoutRequestId, request, async () => { sendCalls += 1; return creation.promise; });
const double = attempt.submit(request.checkoutRequestId, request, async () => { sendCalls += 1; return orderResult(); });
assert.equal(first, double);
assert.equal(sendCalls, 1, "double clic et Entrée partagent le même envoi");
creation.reject(new CreateOrderHttpError("checkout_result_uncertain", 0, "uncertain", "réponse perdue"));
await first;
assert.equal(attempt.snapshot().phase, "uncertain");
assert.equal(persisted.at(-1)?.marker.requestId, request.checkoutRequestId);
assert.equal(persisted.at(-1)?.marker.state, "uncertain");

(request.customer.address as { city: string }).city = "Ville modifiée après envoi";
let retriedRequest = "";
await attempt.retry(async (frozen) => {
  retriedRequest = JSON.stringify(frozen);
  return orderResult();
});
assert.equal(retriedRequest, originalRequestJson, "la reprise conserve l’identifiant et le contenu acceptés");
assert.equal(attempt.snapshot().phase, "success");
assert.equal(completed, 1);
assert.equal(refused, 0);

const uncertainNoFallback = new CheckoutAttemptController(() => undefined, { mark: () => undefined, complete: () => undefined, refused: () => undefined });
uncertainNoFallback.setIdentity("customer-a");
await uncertainNoFallback.submit(request.checkoutRequestId, request, async () => { throw new Error("réseau interrompu"); });
assert.equal(uncertainNoFallback.snapshot().phase, "uncertain");
const otherRequest = { ...request, checkoutRequestId: "22222222-2222-4222-8222-222222222222", cagnotteUse: undefined };
let replacementSent = false;
await uncertainNoFallback.submit(otherRequest.checkoutRequestId, otherRequest, async () => { replacementSent = true; return orderResult(); });
assert.equal(replacementSent, false, "aucune bascule automatique au plein tarif pendant l’incertitude");

const accountIsolation = new CheckoutAttemptController(() => undefined, { mark: () => undefined, complete: () => undefined, refused: () => undefined });
accountIsolation.setIdentity("customer-a");
const lateCreation = deferred<CheckoutOrderResult>();
const oldCreation = accountIsolation.submit(request.checkoutRequestId, request, () => lateCreation.promise);
accountIsolation.setIdentity("customer-b");
lateCreation.resolve(orderResult());
await oldCreation;
assert.equal(accountIsolation.snapshot().identityKey, "customer-b");
assert.equal(accountIsolation.snapshot().result, null);
accountIsolation.setIdentity("customer-b", { requestId: "33333333-3333-4333-8333-333333333333", state: "uncertain" });
assert.equal(accountIsolation.snapshot().phase, "reload_check");

let createTokenCalls = 0;
let createBody: Record<string, unknown> = {};
await createCheckoutOrder(request, {
  getToken: async () => { createTokenCalls += 1; return "fresh-token"; },
  fetch: async (_input, init) => {
    createBody = JSON.parse(String(init?.body));
    return Response.json(orderResult());
  },
});
assert.equal(createTokenCalls, 1);
assert.equal(createBody.authToken, "fresh-token");
assert.equal(createBody.checkoutRequestId, request.checkoutRequestId);

await exerciseRealDomInteractions();
assert.ok(controllerStates.length > 5);
console.log("Cagnotte checkout interface tests passed: controller, static rendering and real DOM interactions");

async function exerciseRealDomInteractions() {
  const entry = `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { CagnotteCheckoutPanel, CagnotteCheckoutView } from "./src/components/cagnotte/CagnotteCheckoutPanel.tsx";
    import { useCagnotteCheckout } from "./src/hooks/useCagnotteCheckout.ts";
    const wallet = ${JSON.stringify(wallet())};
    const quoted = ${JSON.stringify(cagnotteQuote(850, 800, 9200, "dom-quote"))};
    window.__events = [];
    window.__guardCalls = 0;
    const guardedRead = async () => { window.__guardCalls += 1; return wallet; };
    function Harness() {
      const [current, setCurrent] = useState(${JSON.stringify(state({ walletPhase: "ready", wallet: wallet() }))});
      return React.createElement(CagnotteCheckoutView, {
        mode: "checkout", state: current, authenticated: true,
        onToggle: (enabled) => { window.__events.push(["toggle", enabled]); setCurrent((old) => ({ ...old, selectionEnabled: enabled })); },
        onAmountChange: (value) => { window.__events.push(["amount", value]); setCurrent((old) => ({ ...old, amountInput: value, amountError: null })); },
        onRequest: () => { window.__events.push(["request"]); setCurrent((old) => ({ ...old, proposalPhase: "ready", proposal: quoted })); },
        onMaximum: () => window.__events.push(["maximum"]),
        onAccept: () => { window.__events.push(["accept"]); setCurrent((old) => ({ ...old, acceptance: { quoteVersion: "cagnotte-checkout-quote-v1", quoteFingerprint: "dom-quote", acceptedCagnotteCents: 800, acceptedPayableCents: 9200 } })); },
        onContinueWithout: () => window.__events.push(["without"]),
        onAcceptWithout: () => window.__events.push(["accept-without"]),
      });
    }
    function GuardHarness() {
      const cagnotte = useCagnotteCheckout({ enabled: false, identityKey: "guarded-customer", contextKey: "guarded-cart", read: guardedRead });
      return React.createElement(CagnotteCheckoutPanel, {
        enabled: false, mode: "cart", state: cagnotte.state, authenticated: true,
        onToggle: cagnotte.setSelectionEnabled, onAmountChange: cagnotte.setAmountInput,
        onRequest: () => cagnotte.requestProposal(async () => quoted),
        onMaximum: () => cagnotte.requestMaximum(async () => quoted),
      });
    }
    createRoot(document.getElementById("root")).render(React.createElement(React.Fragment, null, React.createElement(Harness), React.createElement(GuardHarness)));
  `;
  const bundle = await build({
    stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd(), sourcefile: "cagnotte-dom-harness.tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    define: { "import.meta.env": "{}" },
    logLevel: "silent",
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    let networkRequests = 0;
    await context.route("**/*", (route) => {
      networkRequests += 1;
      return route.abort();
    });
    const page = await context.newPage();
    await page.setContent("<!doctype html><html lang=\"fr\"><body><div id=\"root\"></div></body></html>");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForTimeout(25);
    assert.equal(await page.evaluate(() => (window as unknown as { __guardCalls: number }).__guardCalls), 0);
    await page.getByRole("checkbox").click();
    await page.getByLabel("Montant souhaité en euros").fill("8,50");
    await page.getByRole("button", { name: "Appliquer ce montant" }).click();
    await page.getByRole("button", { name: /Accepter — 92,00/ }).click();
    await assert.doesNotReject(() => page.getByRole("button", { name: /Montant accepté — 92,00/ }).waitFor());
    const events = await page.evaluate(() => (window as unknown as { __events: unknown[] }).__events);
    assert.deepEqual(events, [["toggle", true], ["amount", "8,50"], ["request"], ["accept"]]);
    assert.equal(networkRequests, 0, "le test DOM autonome ne contacte aucune ressource externe");
    await context.close();
  } finally {
    await browser.close();
  }
}

function renderCheckout(value: CagnotteCheckoutState) {
  return renderToStaticMarkup(<CagnotteCheckoutView
    mode="checkout"
    state={value}
    authenticated
    onToggle={() => undefined}
    onAmountChange={() => undefined}
    onRequest={() => undefined}
    onMaximum={() => undefined}
    onAccept={() => undefined}
    onContinueWithout={() => undefined}
    onAcceptWithout={() => undefined}
  />);
}

function state(overrides: Partial<CagnotteCheckoutState> = {}): CagnotteCheckoutState {
  return {
    identityKey: "customer-a", contextKey: "cart-a", walletPhase: "idle", wallet: null,
    walletErrorCode: null, selectionEnabled: false, amountInput: "", amountError: null,
    proposalPhase: "idle", proposal: null, acceptance: null, proposalErrorCode: null,
    fallbackPhase: "idle", fallbackQuote: null, fallbackAccepted: false, announcement: "", ...overrides,
  };
}

function wallet(overrides: Partial<CagnotteReadResponse["wallet"]> = {}): CagnotteReadResponse {
  return {
    currency: "EUR",
    capabilities: { canReadWallet: true, canRequestReservation: true, canAccrueLoyalty: false },
    wallet: { status: "active", availableCents: 2000, pendingCents: 350, reservedCents: 500, regularizationCents: 0, ...overrides },
    history: { items: [], nextCursor: null, completeness: "timestamped_movements_only", limitation: "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet." },
    freshness: { readAt: "2026-09-06T10:00:00.000Z", consistency: "wallet_and_page", refreshStartsAtFirstPage: true },
  };
}

function ordinaryQuote(): OrderQuote {
  return { subtotal: 100, subtotalBeforeDiscount: 100, deliveryFee: 0, deliveryFeeStatus: "configured", deliveryNote: "Livraison fictive", discountAmount: 0, promoApplied: false, postalFreeShippingApplied: false, total: 100 };
}

function cagnotteQuote(
  requestedCents: number,
  proposedCents: number,
  payableCents: number,
  fingerprint: string,
  limitations: NonNullable<OrderQuote["cagnotteUse"]>["limitationReasons"] = [],
  compatibility: NonNullable<OrderQuote["cagnotteUse"]>["compatibility"]["status"] = "allowed",
  estimatedLoyaltyCents = 0,
  loyaltyAccrualStatus: NonNullable<OrderQuote["cagnotteUse"]>["loyaltyAccrualStatus"] = "suspended",
): OrderQuote {
  return {
    ...ordinaryQuote(),
    cagnotteUse: {
      quoteVersion: "cagnotte-checkout-quote-v1", quoteFingerprint: fingerprint, currency: "EUR",
      productsAfterDiscountsCents: 10000, deliveryCents: 0, requestedCagnotteCents: requestedCents,
      proposedCagnotteCents: proposedCents, cagnotteCapCents: 2000, payableCents,
      estimatedLoyaltyCents, loyaltyAccrualStatus, limitationReasons: limitations,
      compatibility: { status: compatibility, blockingAdvantages: compatibility === "blocked" ? ["promotion_code"] : [], pendingAdvantages: [] },
    },
  };
}

function checkoutRequest(): CreateCheckoutOrderInput {
  return {
    checkoutRequestId: "11111111-1111-4111-8111-111111111111",
    items: [], deliveryMethod: "postal", preferredPaymentMethod: "bank_transfer", complianceAccepted: true,
    submissionSecurity: { formStartedAt: Date.now() - 1000 },
    customer: { email: "camille@example.test", phone: "0600000000", firstName: "Camille", lastName: "Test", address: { firstName: "Camille", lastName: "Test", line1: "1 rue Fictive", postalCode: "13100", city: "Aix-en-Provence", country: "France" } },
    cagnotteUse: { requestedCents: 800, acceptance: { quoteVersion: "cagnotte-checkout-quote-v1", quoteFingerprint: "quote-2", acceptedCagnotteCents: 800, acceptedPayableCents: 9200 } },
  };
}

function orderResult(): CheckoutOrderResult {
  return { orderId: "order-test", total: 100, paymentAmount: 92, paymentStatus: "pending", orderStatus: "new", cagnotteUse: { amountCents: 800, state: "reserved" }, summary: { items: [], subtotal: 100, deliveryFee: 0, deliveryMethod: "postal", discountAmount: 0, appliedPromotions: [] } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
