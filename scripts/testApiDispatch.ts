import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import contestApiHandler, { resolveContestApiRoute } from "../api/contest-api";
import orderAnalyticsHandler, {
  resolveOrderAnalyticsRoute,
} from "../api/order-analytics";
import paymentLinksHandler, {
  resolvePaymentLinksRoute,
} from "../api/payment-links";

const expectedRewrites = new Map([
  ["/api/contests", "/api/contest-api?__verdanzaRoute=public"],
  ["/api/admin-contests", "/api/contest-api?__verdanzaRoute=admin"],
  ["/api/contest-prize", "/api/contest-api?__verdanzaRoute=prize"],
  [
    "/api/retry-order-purchase-analytics",
    "/api/order-analytics?__verdanzaRoute=retry-purchase",
  ],
  ["/api/revoke-order-analytics", "/api/order-analytics?__verdanzaRoute=revoke"],
  ["/api/admin-payment-links", "/api/payment-links?__verdanzaRoute=list"],
  ["/api/send-payment-link", "/api/payment-links?__verdanzaRoute=send"],
]);

function testRouteResolution() {
  assert.equal(resolveContestApiRoute("/api/contests"), "public");
  assert.equal(resolveContestApiRoute("/api/admin-contests?action=list"), "admin");
  assert.equal(resolveContestApiRoute("/api/contest-prize"), "prize");
  assert.equal(
    resolveContestApiRoute("/api/contest-api?__verdanzaRoute=admin&action=list"),
    "admin",
  );
  assert.equal(
    resolveContestApiRoute("/api/contests?__verdanzaRoute=admin"),
    "public",
    "the historical public URL must not be repurposed by a caller-provided marker",
  );
  assert.equal(resolveContestApiRoute("/api/contest-api"), null);

  assert.equal(
    resolveOrderAnalyticsRoute("/api/retry-order-purchase-analytics"),
    "retry-purchase",
  );
  assert.equal(resolveOrderAnalyticsRoute("/api/revoke-order-analytics"), "revoke");
  assert.equal(
    resolveOrderAnalyticsRoute("/api/order-analytics?__verdanzaRoute=revoke"),
    "revoke",
  );
  assert.equal(resolveOrderAnalyticsRoute("/api/order-analytics"), null);

  assert.equal(resolvePaymentLinksRoute("/api/admin-payment-links"), "list");
  assert.equal(resolvePaymentLinksRoute("/api/send-payment-link"), "send");
  assert.equal(
    resolvePaymentLinksRoute("/api/payment-links?__verdanzaRoute=send"),
    "send",
  );
  assert.equal(resolvePaymentLinksRoute("/api/payment-links"), null);
}

async function testDispatchBoundaries() {
  const publicMethodResponse = new FakeResponse();
  await contestApiHandler(
    request("PUT", "/api/contests"),
    publicMethodResponse as never,
  );
  assert.equal(publicMethodResponse.statusCode, 405);

  const adminResponse = new FakeResponse();
  await contestApiHandler(
    request("GET", "/api/contest-api?__verdanzaRoute=admin&action=list"),
    adminResponse as never,
  );
  assert.equal(adminResponse.statusCode, 401);
  assert.deepEqual(adminResponse.body, { error: "Token admin requis." });

  const prizeMethodResponse = new FakeResponse();
  await contestApiHandler(
    request("GET", "/api/contest-prize"),
    prizeMethodResponse as never,
  );
  assert.equal(prizeMethodResponse.statusCode, 405);

  const analyticsAdminResponse = new FakeResponse();
  await orderAnalyticsHandler(
    request("POST", "/api/order-analytics?__verdanzaRoute=retry-purchase", {}),
    analyticsAdminResponse as never,
  );
  assert.equal(analyticsAdminResponse.statusCode, 401);

  const analyticsRevocationResponse = new FakeResponse();
  await orderAnalyticsHandler(
    request("POST", "/api/revoke-order-analytics", {}),
    analyticsRevocationResponse as never,
  );
  assert.equal(analyticsRevocationResponse.statusCode, 200);
  assert.deepEqual(analyticsRevocationResponse.body, { ok: true });

  const paymentListResponse = new FakeResponse();
  await paymentLinksHandler(
    request("GET", "/api/payment-links?__verdanzaRoute=list"),
    paymentListResponse as never,
  );
  assert.equal(paymentListResponse.statusCode, 401);

  const paymentSendMethodResponse = new FakeResponse();
  await paymentLinksHandler(
    request("GET", "/api/send-payment-link"),
    paymentSendMethodResponse as never,
  );
  assert.equal(paymentSendMethodResponse.statusCode, 405);

  for (const handler of [contestApiHandler, orderAnalyticsHandler, paymentLinksHandler]) {
    const response = new FakeResponse();
    await handler(request("GET", "/api/unknown"), response as never);
    assert.equal(response.statusCode, 404);
  }
}

function testRewriteConfiguration() {
  const configuration = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
    rewrites?: Array<{ source?: string; destination?: string }>;
  };
  const rewrites = new Map(
    (configuration.rewrites || []).map((rewrite) => [rewrite.source, rewrite.destination]),
  );
  for (const [source, destination] of expectedRewrites) {
    assert.equal(rewrites.get(source), destination, `rewrite missing for ${source}`);
  }
}

function testFunctionBudgetAndSecuritySources() {
  const functions = readdirSync(resolve("api"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(functions, [
    "analyze-supplier-invoice.ts",
    "contact.ts",
    "contest-api.ts",
    "create-order.ts",
    "create-review.ts",
    "invoices.ts",
    "order-analytics.ts",
    "payment-links.ts",
    "quote-order.ts",
    "retry-order-emails.ts",
    "update-order-status.ts",
  ]);
  assert.equal(functions.length, 11);

  for (const file of [
    "api/_server/contestAdminRoute.ts",
    "api/_server/retryPurchaseAnalyticsRoute.ts",
    "api/_server/adminPaymentLinksRoute.ts",
    "api/_server/sendPaymentLinkRoute.ts",
  ]) {
    assert.match(
      readFileSync(resolve(file), "utf8"),
      /assertAdminUser/,
      `${file} must retain its admin authorization boundary`,
    );
  }
}

function request(method: string, url: string, body?: unknown) {
  return { method, url, body, headers: {} } as never;
}

class FakeResponse {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, unknown>();

  setHeader(name: string, value: unknown) {
    this.headers.set(name, value);
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
  }
}

testRouteResolution();
await testDispatchBoundaries();
testRewriteConfiguration();
testFunctionBudgetAndSecuritySources();

console.log("API dispatch and Vercel rewrite tests passed (11 functions)");
