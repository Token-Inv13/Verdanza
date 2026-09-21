import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import ts from "typescript";
import { build, createServer } from "vite";
import { createCheckoutStorage } from "../src/checkout/checkoutStorage.js";
import { manualQuoteOrder, submitManualOrder } from "../src/checkout/manualCheckoutServices.js";
import type { CheckoutSubmission } from "../src/checkout/checkoutDependencies.js";
import { testCheckoutCart } from "../src/stripe-test/testCart.js";
import type { Product } from "../src/types/index.js";

// No real HTTP, Firebase, Stripe, browser or credentials. Vite only compiles local modules.
const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const local = memoryStore();
const session = memoryStore();
const location = { origin: "http://127.0.0.1:5195" };
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  location, localStorage: local, sessionStorage: session, crypto: webcrypto,
} });
const vite = await createServer({
  configFile: false, envFile: false, logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  esbuild: { jsx: "automatic" },
});
try {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const manualResult = { orderId: "manual-order", analyticsRevocationToken: "fixture-revocation",
    total: 21.99, paymentAmount: 21.99, paymentStatus: "unpaid", orderStatus: "pending",
    summary: { items: [], subtotal: 16.5, deliveryFee: 5.49, deliveryMethod: "postal", discountAmount: 0, appliedPromotions: [] } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(String(url) === "/api/create-order"
      ? manualResult
      : { total: 21.99, deliveryFee: 5.49, promoApplied: false }), { status: 200 });
  };
  const submission: CheckoutSubmission = {
    checkoutRequestId: "fixture-request-id", items: [{ productId: "fixture", quantity: 3 }],
    deliveryMethod: "postal", deliveryZone: "postal-france", complianceAccepted: true,
    preferredPaymentMethod: "card_payment_link", customerMessage: "Message conservé",
    analyticsContext: null,
    submissionSecurity: { formStartedAt: 123, anonymousId: "fixture-anonymous" },
    customer: { email: "client@example.invalid", phone: "0600000000", firstName: "Client", lastName: "Test",
      address: { firstName: "Client", lastName: "Test", line1: "Rue Test", postalCode: "75001", city: "Paris", country: "France" } },
  };
  assert.deepEqual(await submitManualOrder(submission, { getToken: async () => undefined }), manualResult);
  assert.equal(calls[0].url, "/api/create-order");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), submission);
  await manualQuoteOrder({ items: submission.items, deliveryMethod: "postal", couponCode: " CODE ", email: " client@example.invalid ", promotionSelections: [] });
  assert.equal(calls[1].url, "/api/quote-order");
  assert.equal(JSON.parse(String(calls[1].init?.body)).couponCode, "CODE");
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Stock insuffisant" }), { status: 400 });
  await assert.rejects(submitManualOrder(submission, { getToken: async () => undefined }), /Stock insuffisant/);
  globalThis.fetch = async () => new Response("not json", { status: 502 });
  await assert.rejects(submitManualOrder(submission, { getToken: async () => undefined }), { code: "checkout_result_uncertain", outcome: "uncertain" });
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  await assert.rejects(submitManualOrder(submission, { getToken: async () => undefined }), { code: "checkout_result_uncertain", outcome: "uncertain" });
  assert.equal(JSON.parse(String(calls[1].init?.body)).email, "client@example.invalid");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)).promotionSelections, []);
  console.log("PASS manual adapter: endpoints, payload, quote normalization, business/invalid responses");

  const publicStorage = createCheckoutStorage({ local: () => local, session: () => session,
    randomUUID: () => "fixture-request-id",
    keys: { coupon: "verdanza-coupon-code", request: "verdanza:checkout-request-id", summary: "verdanza:lastOrderSummary" } });
  local.setItem("verdanza-cart", '[{"productId":"public","quantity":1}]');
  publicStorage.saveCoupon("PUBLIC");
  assert.equal(publicStorage.readCoupon(), "PUBLIC");
  assert.equal(publicStorage.requestId(), publicStorage.requestId());
  const summary = { orderId: "manual-order", total: 21.99 };
  publicStorage.saveOrderSummary(summary);
  assert.deepEqual(JSON.parse(session.getItem("verdanza:lastOrderSummary")!), summary);

  const testCalls: Array<{ url: string; body?: Record<string, unknown>; token: string | null }> = [];
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:5195\/api\/stripe-test\//);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    testCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined, token: new Headers(init?.headers).get("x-test-order-token") });
    return new Response(JSON.stringify(String(url).endsWith("catalog") ? { products: [] } : String(url).endsWith("delivery-zones") ? { zones: [] } : String(url).endsWith("checkout") ? { url: "https://checkout.stripe.com/c/pay/cs_test_fixture" } : { total: 21.99 }), { status: 200 });
  };
  const module = await vite.ssrLoadModule("/src/stripe-test/checkoutConfiguration.ts") as typeof import("../src/stripe-test/checkoutConfiguration.js");
  const config = module.createLocalTestCheckoutConfiguration();
  assert.equal(config.identity.user, null);
  assert.equal(config.identity.customerProfile, null);
  assert.equal(config.dependencies.showAccountLinks, false);
  assert.equal(config.dependencies.initialCustomer?.email, "checkout-test@example.invalid");
  assert.deepEqual(await config.loadCatalog(), []);
  assert.deepEqual(await config.dependencies.loadDeliveryZones(), { zones: [] });
  config.cartStorage.write([{ productId: "local", quantity: 2 }]);
  assert.match(config.cartStorage.read()!, /local/);
  config.dependencies.storage.saveCoupon("TEST");
  config.dependencies.storage.saveOrderSummary({ orderId: "test-order" });
  config.dependencies.storage.clearRequestId();
  assert.equal(publicStorage.readCoupon(), "PUBLIC");
  assert.equal(session.getItem("verdanza:checkout-request-id"), "fixture-request-id");
  assert.deepEqual(JSON.parse(session.getItem("verdanza:lastOrderSummary")!), summary);
  assert.match(local.getItem("verdanza-cart")!, /public/);
  config.cartStorage.clear();
  assert.equal(config.cartStorage.read(), null);
  assert.match(local.getItem("verdanza-cart")!, /public/);
  await config.dependencies.quoteOrder({ items: submission.items, deliveryMethod: "postal" });
  assert.deepEqual(await config.dependencies.submitOrder(submission), { redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_fixture" });
  await config.dependencies.submitOrder(submission);
  const last = testCalls.slice(-2);
  assert.equal(last[0].body?.checkoutRequestId, last[1].body?.checkoutRequestId);
  assert.equal(last[0].token, last[1].token);
  assert.equal(last[0].body?.authToken, undefined);
  assert.equal(last[0].body?.analyticsContext, undefined);
  await config.dependencies.submitOrder({ ...submission, items: [{ productId: "fixture", quantity: 4 }] });
  assert.notEqual(testCalls.at(-1)?.body?.checkoutRequestId, last[0].body?.checkoutRequestId);
  const promotionSelections = [{ promotionId: "gift-fixture", giftProductId: "gift-product" }];
  await config.dependencies.submitOrder({ ...submission, promotionSelections });
  assert.deepEqual(testCalls.at(-1)?.body?.promotionSelections, promotionSelections);
  assert.notEqual(testCalls.at(-1)?.body?.checkoutRequestId, last[0].body?.checkoutRequestId);
  await assert.rejects(config.dependencies.submitOrder({ ...submission, cagnotteUse: { requestedCents: 100 } }), /test_cagnotte_unavailable/);
  assert.throws(() => config.dependencies.navigateSuccess("test-order"), /test_webhook_return_required/);
  for (const url of ["https://checkout.stripe.com.evil.invalid/c/pay/cs_test_fake", "https://checkout.stripe.com/c/pay/cs_live_fake", "/api/create-order"]) {
    assert.throws(() => config.dependencies.redirectToPayment?.(url));
  }
  assert.equal(await config.dependencies.analytics.getGa4MeasurementContext(), null);
  config.dependencies.analytics.trackContactClick("email", "checkout");
  config.dependencies.rememberOrderAnalytics("test-order", "fixture");
  assert.equal((await config.dependencies.createAddressSearch().search("Adresse fictive")).suggestions[0].id, "synthetic-local-address");
  console.log("PASS local adapter: fixed loopback API, isolated stores, fake guest/address, no Auth/analytics, stable retry and new attempt after edits, redirect guards");

  for (const origin of ["https://verdanza.fr", "http://localhost:5173", "http://127.0.0.1:5173", "https://preview.example.invalid"]) {
    location.origin = origin;
    assert.throws(() => module.createLocalTestCheckoutConfiguration(), /checkout_test_local_only/);
    await assert.rejects(config.dependencies.submitOrder(submission), /checkout_test_local_only/);
    assert.throws(() => config.cartStorage.write([]), /checkout_test_local_only/);
  }
  location.origin = "http://127.0.0.1:5195";
  // createServer selects development for this process; compile the negative case as production.
  process.env.NODE_ENV = "production";
  const built = await build({ configFile: false, envFile: false, logLevel: "silent", build: {
    write: false, minify: false,
    lib: { entry: resolve("src/stripe-test/checkoutConfiguration.ts"), formats: ["es"] },
  } });
  const result = Array.isArray(built) ? built[0] : built;
  assert.ok("output" in result);
  const chunk = result.output.find((entry) => entry.type === "chunk");
  assert.ok(chunk && chunk.type === "chunk");
  const productionModule = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
  assert.throws(() => productionModule.createLocalTestCheckoutConfiguration(), /checkout_test_local_only/);
  console.log("PASS test configuration rejects foreign origins, reused adapters on wrong origin, and production compilation");

  // Follow runtime imports, ignoring erased types. Catch accidental Firebase/provider dependencies.
  const sharedGraph = runtimeImports("src/pages/CheckoutPage.tsx");
  const localGraph = runtimeImports("src/stripe-test/main.tsx");
  for (const path of [...sharedGraph, ...localGraph]) {
    assert.doesNotMatch(path, /firebase|AuthContext|CartContext|analytics|googleTagManager|manualCheckout|quoteService|productsService|deliveryZonesService|promoBannersService/i);
  }
  const appGraph = runtimeImports("src/App.tsx");
  assert.ok(appGraph.some((path) => path.endsWith("ManualCheckoutPage.tsx")));
  assert.ok(!appGraph.some((path) => /stripe-test|stripeTest/.test(path)));
  const wrapper = readFileSync("src/checkout/ManualCheckoutPage.tsx", "utf8");
  for (const dependency of ["useCart()", "useAuth()", "manualQuoteOrder", "submitManualOrder", "publicSubmissionSecurityContext", "rememberPendingOrderAnalyticsRevocation", "/checkout/success?order_id="]) assert.ok(wrapper.includes(dependency));
  assert.doesNotMatch(wrapper, /URLSearchParams|location\.search|STRIPE_TEST|checkoutConfiguration/);
  console.log("PASS runtime import isolation and fixed public manual composition");
  for (const path of runtimeImports("scripts/stripeTestServer.ts")) {
    assert.doesNotMatch(path, /firebaseAdmin\.ts|create-order\.ts|quote-order\.ts|orderSideEffects|invoicePdf|email\.ts|orderAlerts|purchaseAnalytics/i);
  }
  const fixture = { id: "cart-fixture", name: "Fixture CBD", price: 4.5, stock: 15, isActive: true,
    category: "flowers", fixedPriceMode: "manual", fixedPriceOptions: [
      { id: "fixed-30-7g", quantityGrams: 7, totalPrice: 30, isActive: true, sortOrder: 1, source: "manual" },
    ] } as Product;
  const cart = testCheckoutCart([{ productId: fixture.id, quantity: 3 },
    { productId: fixture.id, quantity: 1, purchaseMode: "fixed_price", fixedPriceOptionId: "fixed-30-7g" }], [fixture]);
  assert.equal(cart.itemCount, 10); assert.equal(cart.subtotal, 43.5); assert.equal(cart.hasBlockingCartIssues, false);
  assert.equal(testCheckoutCart([{ productId: fixture.id, quantity: 3, purchaseMode: "fixed_price", fixedPriceOptionId: "fixed-30-7g" }], [fixture]).hasBlockingCartIssues, true);
  assert.equal(testCheckoutCart([{ productId: "missing", quantity: 1 }], [fixture]).hasBlockingCartIssues, true);
  assert.equal(testCheckoutCart([{ productId: fixture.id, quantity: 1, purchaseMode: "fixed_price", fixedPriceOptionId: "missing" }], [fixture]).hasBlockingCartIssues, true);
  console.log("PASS isolated cart: grams/fixed totals, stock limits, missing catalog/format blocked; local server excludes production side-effect imports");
} finally {
  await vite.close();
  globalThis.fetch = originalFetch;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
}

function memoryStore() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); } };
}

function runtimeImports(entry: string, seen = new Set<string>()): string[] {
  const absolute = resolve(entry);
  if (seen.has(absolute)) return [];
  seen.add(absolute);
  const source = ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every((e) => e.isTypeOnly));
      if (!onlyTypes) imports.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const result = [relative(process.cwd(), absolute).replaceAll("\\", "/")];
  for (const name of imports) {
    if (!name.startsWith(".")) { result.push(name); continue; }
    const base = resolve(dirname(absolute), name).replace(/\.js$/, "");
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(existsSync);
    if (target && /\.tsx?$/.test(target)) result.push(...runtimeImports(target, seen));
  }
  return result;
}
