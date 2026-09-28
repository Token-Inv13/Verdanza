import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { ReferralCheckoutController } from "../src/services/referralCheckoutController";
import { CheckoutAttemptController } from "../src/services/cagnotteCheckoutService";
import type { OrderQuote } from "../src/services/quoteService";
import type { CreateCheckoutOrderInput } from "../src/services/ordersService";
import { getAdvantagesEntries } from "../src/lib/advantages";
import { resolveReferralDisplayConfiguration } from "../src/config/referralFeatures";
import { sitemapUrls } from "./seoRoutes";

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) { await run(); console.log(`PASS ${++passed} ${name}`); }
const ordinary: OrderQuote = { subtotal: 50, subtotalBeforeDiscount: 50, deliveryFee: 0, deliveryFeeStatus: "configured", deliveryNote: "Fixture",
  discountAmount: 0, promoApplied: false, postalFreeShippingApplied: true, total: 50 };
const offered = (fingerprint = "a".repeat(64)): OrderQuote => ({ ...ordinary, total: 45, referralUse: {
  applied: true, quoteVersion: "referral-checkout-quote-v1", quoteFingerprint: fingerprint, referralDiscountCents: 500,
  productsBeforeReferralCents: 5000, productsAfterReferralCents: 4500, deliveryCents: 0, payableCents: 4500, loyaltyEstimateCents: 225 } });
function controller() { const result = new ReferralCheckoutController(() => {}); result.setIdentity("synthetic-client"); result.setContext("cart-a"); return result; }
await test("flags stricts et hub historiquement fermé", () => {
  for (const value of [undefined, false, true, "TRUE", "false", "true"]) {
    const config = resolveReferralDisplayConfiguration({ VITE_REFERRAL_DISPLAY_ENABLED: value, VITE_REFERRAL_CHECKOUT_DISPLAY_ENABLED: value });
    assert.equal(config.displayEnabled, value === "true"); assert.equal(config.checkoutDisplayEnabled, value === "true");
    assert.equal(getAdvantagesEntries(false, config.displayEnabled)[2].status, value === "true" ? "active" : "soon");
  }
  assert.deepEqual(getAdvantagesEntries(false), getAdvantagesEntries(false, false));
  assert.equal(getAdvantagesEntries(false, true)[2].to, "/compte/avantages");
  assert.equal(sitemapUrls().some((url) => url.includes("parrainage")), false);
  assert.match(readFileSync("src/pages/ReferralLinkPage.tsx", "utf8"), /noindex/);
  assert.match(readFileSync("src/components/AccountAuthGate.tsx", "utf8"), /location.pathname \+ location.search \+ location.hash/);
});
await test("devis explicitement demandé, acceptation 500/4500, aucune création implicite", async () => {
  const c = controller(); assert.equal(c.snapshot().requested, false);
  await c.requestQuote(async () => offered()); assert.equal(c.snapshot().acceptance, null); c.accept();
  assert.deepEqual(c.snapshot().acceptance, { quoteVersion: "referral-checkout-quote-v1", quoteFingerprint: "a".repeat(64), acceptedReferralDiscountCents: 500, acceptedPayableCents: 4500 });
  const referral = c.snapshot().quote?.referralUse; assert.equal(referral?.applied && referral.loyaltyEstimateCents, 225);
  assert.ok(await c.revalidate(async () => offered()));
});
await test("fingerprint changé impose une nouvelle acceptation", async () => {
  const c = controller(); await c.requestQuote(async () => offered()); c.accept();
  assert.equal(await c.revalidate(async () => offered("b".repeat(64))), null); assert.equal(c.snapshot().phase, "changed");
  assert.equal(c.snapshot().acceptance, null); c.accept(); assert.equal(c.snapshot().acceptance?.quoteFingerprint, "b".repeat(64));
});
for (const reason of ["below_threshold", "priority_advantage", "no_relation", "right_consumed", "right_reserved"] as const) {
  await test(`devis ${reason} sans fallback implicite après acceptation`, async () => {
    const c = controller(); await c.requestQuote(async () => offered()); c.accept();
    assert.equal(await c.revalidate(async () => ({ ...ordinary, referralUse: { applied: false, quoteVersion: "referral-checkout-quote-v1", reason } })), null);
    assert.equal(c.snapshot().requested, true); assert.equal(c.snapshot().acceptance, null);
    c.continueWithout(); assert.equal(c.snapshot().requested, false);
  });
}
for (const context of ["quantity", "format", "delivery", "address", "coupon", "gift"]) {
  await test(`${context} invalide le consentement sans basculer silencieusement au plein tarif`, async () => {
    const c = controller(); await c.requestQuote(async () => offered()); c.accept(); c.setContext(context);
    assert.equal(c.snapshot().acceptance, null); assert.equal(c.snapshot().quote, null); assert.equal(c.snapshot().requested, true);
  });
}
await test("conflit wallet conservé jusqu'au choix explicite", async () => {
  const c = controller(); await c.requestQuote(async () => { throw { code: "REFERRAL_CAGNOTTE_CONFLICT" }; });
  assert.equal(c.snapshot().phase, "conflict"); assert.equal(c.snapshot().acceptance, null);
  await c.requestQuote(async () => offered()); assert.equal(c.snapshot().acceptance, null); c.accept(); assert.ok(c.snapshot().acceptance);
});
await test("réponses tardives après contexte/identité ignorées", async () => {
  for (const changeIdentity of [false, true]) {
    const c = controller(); let release!: (quote: OrderQuote) => void;
    const request = c.requestQuote(() => new Promise(resolve => { release = resolve; }));
    if (changeIdentity) c.setIdentity("new-client"); else c.setContext("cart-b");
    release(offered()); assert.equal(await request, null); assert.equal(c.snapshot().quote, null);
  }
});
await test("panne ou réponse invalide supprime tout consentement", async () => {
  const c = controller(); await c.requestQuote(async () => offered()); c.accept();
  assert.equal(await c.revalidate(async () => ordinary), null); assert.equal(c.snapshot().acceptance, null); assert.equal(c.snapshot().phase, "error");
});

const server = await createServer({ configFile: false, envFile: false, cacheDir: "node_modules/.cache/referral-client-ssr",
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
try {
  const api = await server.ssrLoadModule("/src/services/referralService.ts");
  const quote = await server.ssrLoadModule("/src/services/quoteService.ts");
  const orders = await server.ssrLoadModule("/src/services/ordersService.ts");
  const analyticsGuard = await server.ssrLoadModule("/src/lib/googleTagManager.ts");
  const analytics = await server.ssrLoadModule("/src/lib/analytics.ts");
  await test("route d'invitation exclue de l'analytics, code jamais envoyé en page view", () => {
    assert.equal(analyticsGuard.isAnalyticsSuppressedPath(`/parrainage/${"A".repeat(26)}`), true);
    assert.equal(analyticsGuard.isAnalyticsSuppressedPath("/parrainage"), true);
    assert.equal(analyticsGuard.isAnalyticsSuppressedPath("/parrainages"), false);
    assert.equal(analyticsGuard.isAnalyticsSuppressedPath("/boutique"), false);
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window"); let events = 0;
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/boutique", hostname: "verdanza.fr" }, gtag: () => { events++; } } });
    try {
      analytics.setAnalyticsConsentAllowed(true);
      analytics.trackPageView(`/parrainage/${"A".repeat(26)}`, "Invitation"); assert.equal(events, 0);
      analytics.trackPageView("/boutique", "Boutique"); assert.equal(events, 1);
    } finally {
      analytics.setAnalyticsConsentAllowed(false);
      if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
    }
  });
  const baseOrder = { checkoutRequestId: "f977096f-f7b5-4de5-8215-3c50f3457ecd", items: [{ productId: "fixture", quantity: 1 }], deliveryMethod: "postal",
    preferredPaymentMethod: "card_payment_link", complianceAccepted: true, submissionSecurity: { formStartedAt: 1 },
    customer: { email: "checkout@example.invalid", phone: "0600000000", firstName: "Test", lastName: "Client", address: { line1: "1 rue fictive", postalCode: "75001", city: "Paris", country: "France" } } } as CreateCheckoutOrderInput;
  await test("services Referral et devis/création refusent avant HTTP sans token", async () => {
    let calls = 0; const deps = { getToken: async () => null, fetch: async () => { calls++; throw new Error("unexpected_http"); } };
    for (const action of [() => api.getReferralSelf(deps), () => api.ensureReferralCode(deps), () => api.linkReferralCode("A".repeat(26), deps),
      () => quote.quoteOrder({ items: [], deliveryMethod: "postal", referralUse: { requested: true } }, deps),
      () => orders.createCheckoutOrder({ ...baseOrder, referralUse: { requested: true } }, deps)])
      await assert.rejects(action, (e: { code?: string; status?: number }) => e.code === "AUTH_REQUIRED" && e.status === 401);
    assert.equal(calls, 0);
  });
  await test("devis ordinaire n'appelle pas Auth et conserve son payload", async () => {
    let body: unknown;
    await quote.quoteOrder({ items: [], deliveryMethod: "postal" }, { getToken: async () => { throw new Error("unexpected_token"); },
      fetch: async (_url: string, options: RequestInit) => { body = JSON.parse(String(options.body)); return new Response(JSON.stringify(ordinary)); } });
    assert.deepEqual(body, { items: [], deliveryMethod: "postal" });
  });
  await test("GET/POST Referral utilisent le token courant, GET cache no-store et aucun email", async () => {
    const sent: { method?: string; headers?: HeadersInit; body?: string; cache?: RequestCache }[] = []; let tokens = 0;
    const self = { version: "referral-self-v1", code: null, relation: null, sponsorSummary: { referralsTotal: 0, linkedCount: 0, pendingCount: 0, rewardedCount: 0, cancelledCount: 0, reversedCount: 0, pendingRewardCents: 0, validatedRewardCents: 0 } };
    const deps = { getToken: async () => `current-token-${++tokens}`, fetch: async (_url: string, options: RequestInit) => {
      sent.push(options as typeof sent[number]); const action = options.body ? JSON.parse(String(options.body)).action : "self";
      return new Response(JSON.stringify(action === "self" ? self : action === "ensure_code" ? { code: "A".repeat(26) } : { state: "linked", changed: false }));
    } };
    await api.getReferralSelf(deps); await api.ensureReferralCode(deps); await api.linkReferralCode("A".repeat(26), deps);
    assert.equal(tokens, 3); assert.equal(sent[0].method, "GET"); assert.equal(sent[0].body, undefined); assert.equal(sent[0].cache, "no-store");
    assert.deepEqual(JSON.parse(sent[1].body!), { action: "ensure_code" }); assert.deepEqual(JSON.parse(sent[2].body!), { action: "link", code: "A".repeat(26) });
    assert.equal(new Headers(sent[2].headers).get("authorization"), "Bearer current-token-3");
  });
  await test("devis et création transmettent l'acceptation exacte et la demande wallet zéro", async () => {
    const c = controller(); await c.requestQuote(async () => offered()); c.accept(); const acceptance = c.snapshot().acceptance!;
    const sent: Record<string, unknown>[] = []; const deps = { getToken: async () => "current-token", fetch: async (url: string, options: RequestInit) => {
      sent.push(JSON.parse(String(options.body))); return new Response(JSON.stringify(url.includes("quote") ? offered() : {
        orderId: "fixture", total: 45, paymentAmount: 45, paymentStatus: "to_confirm", orderStatus: "contact_required", referralUse: { discountCents: 500 }, summary: { items: [] } }));
    } };
    await quote.quoteOrder({ items: [], deliveryMethod: "postal", referralUse: { requested: true }, cagnotteUse: { requestedCents: 0 } }, deps);
    const result = await orders.createCheckoutOrder({ ...baseOrder, referralUse: { requested: true, acceptance } }, deps);
    assert.deepEqual(sent[0].referralUse, { requested: true }); assert.deepEqual(sent[0].cagnotteUse, { requestedCents: 0 });
    assert.deepEqual(sent[1].referralUse, { requested: true, acceptance }); assert.equal(sent[1].authToken, "current-token");
    assert.deepEqual(result.referralUse, { discountCents: 500 });
  });
  await test("retry incertain reprend la même requête et la même acceptation", async () => {
    const c = controller(); await c.requestQuote(async () => offered()); c.accept();
    const request = { ...baseOrder, referralUse: { requested: true as const, acceptance: c.snapshot().acceptance! } };
    const attempt = new CheckoutAttemptController(() => {}, { mark: () => {}, complete: () => {}, refused: () => {} }); attempt.setIdentity("synthetic-client");
    const sent: CreateCheckoutOrderInput[] = []; const send = async (input: CreateCheckoutOrderInput) => { sent.push(input); throw new Error("lost_response"); };
    await attempt.submit(baseOrder.checkoutRequestId, request, send);
    request.referralUse.acceptance.quoteFingerprint = "b".repeat(64); await attempt.retry(send);
    assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]); assert.equal(sent[1].referralUse?.acceptance?.quoteFingerprint, "a".repeat(64));
  });
} finally { await server.close(); }
console.log(`Referral client: ${passed} checks.`);
