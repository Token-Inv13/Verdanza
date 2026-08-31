import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import adminContestsHandler from "../api/admin-contests";
import adminPaymentLinksHandler from "../api/admin-payment-links";
import blogInteractionsHandler from "../api/blog-interactions";
import contestPrizeHandler from "../api/contest-prize";
import contestsHandler from "../api/contests";
import retryPurchaseAnalyticsHandler from "../api/retry-order-purchase-analytics";
import revokeOrderAnalyticsHandler from "../api/revoke-order-analytics";
import sendPaymentLinkHandler from "../api/send-payment-link";
import { handleAdminContests } from "../api/_server/contestAdminRoute";
import { handleAdminPaymentLinks } from "../api/_server/adminPaymentLinksRoute";
import { handleBlogInteractions } from "../api/_server/blogInteractions";
import { handleContestPrize } from "../api/_server/contestPrizeRoute";
import { handlePublicContests } from "../api/_server/contestPublicRoute";
import { handleRetryPurchaseAnalytics } from "../api/_server/retryPurchaseAnalyticsRoute";
import { handleRevokeOrderAnalytics } from "../api/_server/revokeOrderAnalyticsRoute";
import { handleSendPaymentLink } from "../api/_server/sendPaymentLinkRoute";

const removedRewriteSources = [
  "/api/contests",
  "/api/admin-contests",
  "/api/contest-prize",
  "/api/retry-order-purchase-analytics",
  "/api/revoke-order-analytics",
  "/api/admin-payment-links",
  "/api/send-payment-link",
];

function testDirectEntrypoints() {
  assert.equal(contestsHandler, handlePublicContests);
  assert.equal(adminContestsHandler, handleAdminContests);
  assert.equal(blogInteractionsHandler, handleBlogInteractions);
  assert.equal(contestPrizeHandler, handleContestPrize);
  assert.equal(retryPurchaseAnalyticsHandler, handleRetryPurchaseAnalytics);
  assert.equal(revokeOrderAnalyticsHandler, handleRevokeOrderAnalytics);
  assert.equal(adminPaymentLinksHandler, handleAdminPaymentLinks);
  assert.equal(sendPaymentLinkHandler, handleSendPaymentLink);
}

async function testEndpointContracts() {
  const publicMethodResponse = new FakeResponse();
  await contestsHandler(request("PUT", "/api/contests"), publicMethodResponse as never);
  assert.equal(publicMethodResponse.statusCode, 405);

  const blogMethodResponse = new FakeResponse();
  await blogInteractionsHandler(
    request("PATCH", "/api/blog-interactions"),
    blogMethodResponse as never,
  );
  assert.equal(blogMethodResponse.statusCode, 405);
  assert.deepEqual(blogMethodResponse.body, { error: "Methode non autorisee." });

  const adminResponse = new FakeResponse();
  await adminContestsHandler(
    request("GET", "/api/admin-contests?action=list"),
    adminResponse as never,
  );
  assert.equal(adminResponse.statusCode, 401);
  assert.deepEqual(adminResponse.body, { error: "Token admin requis." });

  const prizeMethodResponse = new FakeResponse();
  await contestPrizeHandler(
    request("GET", "/api/contest-prize"),
    prizeMethodResponse as never,
  );
  assert.equal(prizeMethodResponse.statusCode, 405);

  const analyticsAdminResponse = new FakeResponse();
  await retryPurchaseAnalyticsHandler(
    request("POST", "/api/retry-order-purchase-analytics", {}),
    analyticsAdminResponse as never,
  );
  assert.equal(analyticsAdminResponse.statusCode, 401);

  const analyticsRevocationResponse = new FakeResponse();
  await revokeOrderAnalyticsHandler(
    request("POST", "/api/revoke-order-analytics", {}),
    analyticsRevocationResponse as never,
  );
  assert.equal(analyticsRevocationResponse.statusCode, 200);
  assert.deepEqual(analyticsRevocationResponse.body, { ok: true });

  const paymentListResponse = new FakeResponse();
  await adminPaymentLinksHandler(
    request("GET", "/api/admin-payment-links"),
    paymentListResponse as never,
  );
  assert.equal(paymentListResponse.statusCode, 401);

  const paymentSendMethodResponse = new FakeResponse();
  await sendPaymentLinkHandler(
    request("GET", "/api/send-payment-link"),
    paymentSendMethodResponse as never,
  );
  assert.equal(paymentSendMethodResponse.statusCode, 405);
}

function testRewriteConfiguration() {
  const configuration = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
    rewrites?: Array<{ source?: string; destination?: string }>;
  };
  const rewrites = new Map(
    (configuration.rewrites || []).map((rewrite) => [rewrite.source, rewrite.destination]),
  );
  for (const source of removedRewriteSources) {
    assert.equal(rewrites.has(source), false, `obsolete rewrite remains for ${source}`);
  }
  assert.equal(
    rewrites.get("/api/public-promo-banners"),
    "/api/quote-order?publicPromoBanners=1",
  );
}

function testFunctionInventoryAndSecuritySources() {
  const functions = readdirSync(resolve("api"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(functions, [
    "admin-contests.ts",
    "admin-payment-links.ts",
    "analyze-supplier-invoice.ts",
    "blog-interactions.ts",
    "contact.ts",
    "contest-prize.ts",
    "contests.ts",
    "create-order.ts",
    "create-review.ts",
    "invoices.ts",
    "quote-order.ts",
    "retry-order-emails.ts",
    "retry-order-purchase-analytics.ts",
    "revoke-order-analytics.ts",
    "send-payment-link.ts",
    "update-order-status.ts",
  ]);
  assert.equal(functions.length, 16);

  for (const file of [
    "api/_server/contestAdminRoute.ts",
    "api/_server/blogInteractions.ts",
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

testDirectEntrypoints();
await testEndpointContracts();
testRewriteConfiguration();
testFunctionInventoryAndSecuritySources();

console.log("Direct API endpoint contract tests passed (16 functions)");
