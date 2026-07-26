import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { getAdminAnalyticsReport } from "../api/_server/ga4DataApi";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = {
  GA4_PROPERTY_ID: "542470164",
  GOOGLE_CLIENT_EMAIL: "verdanza-analytics@example.iam.gserviceaccount.com",
  GOOGLE_PRIVATE_KEY: privateKeyPem,
} as NodeJS.ProcessEnv;

const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://oauth2.googleapis.com/token") {
    return jsonResponse({ access_token: "mock-access-token", expires_in: 3600 });
  }
  assert.match(url, /properties\/542470164:/);
  const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
  requests.push({ url, body });
  const bodyText = JSON.stringify(body);
  assert.ok(bodyText.includes("/admin"), "reports must exclude /admin");
  if (!url.includes("runRealtimeReport")) {
    assert.ok(bodyText.includes("pagePath"), "standard reports must exclude admin paths");
    assert.ok(bodyText.includes("hostName"), "standard reports must exclude Vercel hostnames");
    assert.ok(bodyText.includes("vercel\\\\.app"), "standard reports must exclude vercel.app");
  } else {
    assert.ok(bodyText.includes("unifiedScreenName"), "realtime reports must exclude admin screens");
  }
  return jsonResponse(mockGa4Report(body));
};

const report = await getAdminAnalyticsReport(
  { preset: "7d", compare: true },
  {
    env,
    fetch: mockFetch as typeof fetch,
    now: new Date("2026-07-26T10:00:00.000Z"),
  },
);

assert.equal(report.configured, true);
assert.equal(report.propertyId, "542470164");
assert.equal(report.range.startDate, "2026-07-20");
assert.equal(report.range.endDate, "2026-07-26");
assert.equal(report.comparisonRange?.startDate, "2026-07-13");
assert.equal(report.summary.activeUsers, 42);
assert.equal(report.summary.sessions, 60);
assert.equal(report.summary.orderSubmittedCount, 3);
assert.equal(report.summary.purchaseRevenue, 120);
assert.ok(report.acquisition.channels.length >= 1);
assert.ok(report.pages.length >= 1);
assert.ok(report.funnel.some((step) => step.eventName === "order_submitted"));
assert.ok(report.products.some((product) => product.name === "Golden Static"));
assert.ok(requests.some((request) => request.url.includes(":runRealtimeReport")));

const cachedRequestCount = requests.length;
await getAdminAnalyticsReport(
  { preset: "7d", compare: true },
  {
    env,
    fetch: mockFetch as typeof fetch,
    now: new Date("2026-07-26T10:00:30.000Z"),
  },
);
assert.equal(requests.length, cachedRequestCount, "standard and realtime reports should be cached briefly");

await assert.rejects(
  () =>
    getAdminAnalyticsReport(
      { preset: "30d" },
      {
        env: { ...env, GA4_PROPERTY_ID: "G-E9XNP7BJ2Y" } as NodeJS.ProcessEnv,
        fetch: mockFetch as typeof fetch,
      },
    ),
  /pas le Measurement ID/,
);

console.log("Admin analytics GA4 mocked test passed.");

function mockGa4Report(body: Record<string, unknown>) {
  const dimensions = ((body.dimensions as { name: string }[] | undefined) || []).map((dimension) => dimension.name);
  const metrics = ((body.metrics as { name: string }[] | undefined) || []).map((metric) => metric.name);
  if (!dimensions.length && metrics.includes("activeUsers")) {
    return row([], metrics.map((name) => metricFixture(name)));
  }
  if (dimensions.includes("eventName") && dimensions.includes("itemName")) {
    return rows(
      ["Golden Static", "view_item"],
      ["Golden Static", "add_to_cart"],
      ["Golden Static", "order_submitted"],
    );
  }
  if (dimensions.includes("eventName")) {
    return rows(
      ["order_submitted"],
      ["purchase"],
      ["view_item_list"],
      ["view_item"],
      ["add_to_cart"],
      ["view_cart"],
      ["begin_checkout"],
      ["add_shipping_info"],
      ["add_payment_info"],
    );
  }
  if (dimensions.includes("pagePath") && dimensions.includes("pageTitle")) {
    return rows(["/", "Accueil Verdanza"], ["/blog/cbd-conduite-france", "CBD et conduite"]);
  }
  if (dimensions.includes("sessionDefaultChannelGroup")) return rows(["Organic Search"]);
  if (dimensions.includes("sessionSourceMedium")) return rows(["google / organic"]);
  if (dimensions.includes("sessionCampaignName")) return rows(["Non renseigne"]);
  if (dimensions.includes("deviceCategory")) return rows(["mobile"], ["desktop"]);
  if (dimensions.includes("unifiedScreenName")) return rows(["/"]);
  if (dimensions.includes("source")) return rows(["google"]);
  return rows(["local_express"], ["postal"]);

  function rows(...dimensionRows: string[][]) {
    return {
      rows: dimensionRows.map((dimensionValues) => ({
        dimensionValues: dimensionValues.map((value) => ({ value })),
        metricValues: metrics.map((name) => ({ value: String(metricFixture(name)) })),
      })),
    };
  }
}

function row(dimensionValues: string[], metricValues: number[]) {
  return {
    rows: [
      {
        dimensionValues: dimensionValues.map((value) => ({ value })),
        metricValues: metricValues.map((value) => ({ value: String(value) })),
      },
    ],
  };
}

function metricFixture(name: string) {
  const values: Record<string, number> = {
    activeUsers: 42,
    newUsers: 18,
    sessions: 60,
    screenPageViews: 140,
    engagementRate: 0.72,
    userEngagementDuration: 900,
    eventCount: 3,
    eventValue: 180,
    totalRevenue: 120,
  };
  return values[name] ?? 1;
}

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}
