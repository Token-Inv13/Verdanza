import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Order } from "../src/types/index.js";
import {
  buildGa4PurchasePayload,
  isPurchaseEligible,
  netProductValue,
  sendGa4Payload,
} from "../api/_server/ga4MeasurementProtocol.js";

const repoRoot = process.cwd();

async function main() {
  const order = mockPaidOrder();
  assert(isPurchaseEligible(order), "paid consented order should be eligible");

  const payload = buildGa4PurchasePayload(order);
  assert(payload?.events[0].name === "purchase", "payload should contain one purchase event");
  assert(payload.events[0].params.transaction_id === order.id, "transaction_id should match order id");
  assert(payload.events[0].params.value === 13, "purchase value should exclude shipping and discount products only");
  assert(payload.events[0].params.shipping === 4, "shipping should be separated");
  assert(payload.events[0].params.payment_method === "cash_on_delivery", "purchase should use final payment method");
  assert(payload.events[0].params.items.length === 2, "items should be included");
  assert(payload.events[0].params.items[0].discount === 0.67, "line discount should be allocated per unit");
  assert(payload.events[0].params.items[1].discount === 0.67, "discount remainder should stay on last line");
  assert(netProductValue(order) === 13, "net product value should be stable");
  assert(!JSON.stringify(payload).includes(order.customerEmail), "payload should not contain email");
  assert(!JSON.stringify(payload).includes(order.customerPhone), "payload should not contain phone");
  assert(!JSON.stringify(payload).includes(order.customerName || ""), "payload should not contain customer name");

  assert(!isPurchaseEligible({ ...order, paymentStatus: "to_confirm" }), "unpaid order should not be eligible");
  assert(
    !isPurchaseEligible({ ...order, finalPaymentMethod: undefined }),
    "order without final payment method should not be eligible",
  );
  assert(
    !isPurchaseEligible({
      ...order,
      analytics: { ...order.analytics!, consentRevokedAt: new Date().toISOString() },
    }),
    "revoked order should not be eligible",
  );
  assert(
    !isPurchaseEligible({
      ...order,
      analytics: { ...order.analytics!, purchaseStatus: "sent" },
    }),
    "already sent order should not be eligible",
  );
  assert(
    !isPurchaseEligible({
      ...order,
      analytics: { consentGrantedAtSubmission: false, purchaseStatus: "not_eligible" },
    }),
    "legacy order without client_id should not be eligible",
  );

  await auditMockMeasurementProtocol(payload);
  auditNoClientPurchase();
  console.log("audit:analytics-purchase OK");
}

async function auditMockMeasurementProtocol(payload: NonNullable<ReturnType<typeof buildGa4PurchasePayload>>) {
  const secret = "test_secret_123456";
  let requestCount = 0;
  let receivedUrl = "";
  let receivedBody = "";
  const server = createServer((request, response) => {
    requestCount += 1;
    receivedUrl = request.url || "";
    request.on("data", (chunk) => {
      receivedBody += chunk.toString("utf8");
    });
    request.on("end", () => {
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "mock server should expose a port");
  const host = `http://127.0.0.1:${address.port}`;
  try {
    const result = await sendGa4Payload(
      {
        measurementId: "G-E9XNP7BJ2Y",
        apiSecret: secret,
        host,
      },
      payload,
    );
    assert(result.status === "sent", "mock GA4 request should be sent");
    assert(requestCount === 1, "mock GA4 request should be sent once");
    assert(receivedUrl.includes("/mp/collect"), "request should target mp/collect");
    assert(receivedUrl.includes("measurement_id=G-E9XNP7BJ2Y"), "measurement id should be present");
    assert(receivedUrl.includes("api_secret="), "api secret should be used only in request URL");
    assert(JSON.parse(receivedBody).events[0].name === "purchase", "network payload should be purchase");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function auditNoClientPurchase() {
  const clientFiles = [
    join(repoRoot, "src", "lib", "analytics.ts"),
    ...safeListAssets(join(repoRoot, "dist", "assets")).filter((file) => file.endsWith(".js")),
  ];
  for (const file of clientFiles) {
    const content = readFileSync(file, "utf8");
    assert(!content.includes('"purchase"'), `client bundle should not contain purchase event: ${file}`);
    assert(!content.includes("'purchase'"), `client bundle should not contain purchase event: ${file}`);
  }
}

function safeListAssets(directory: string) {
  try {
    return readdirSync(directory).map((file) => join(directory, file));
  } catch {
    return [];
  }
}

function mockPaidOrder(): Order {
  return {
    id: "order_test_analytics",
    customerEmail: "client@example.test",
    customerPhone: "+33123456789",
    customerName: "Client Test",
    items: [
      {
        productId: "flower-1",
        slug: "fleur-test",
        name: "Fleur test",
        category: "flowers",
        cultureType: "Indoor",
        quantity: 2,
        unitPrice: 5,
      },
      {
        productId: "resin-1",
        slug: "resine-test",
        name: "Résine test",
        category: "resins",
        cultureType: "Autre",
        quantity: 1,
        unitPrice: 5,
      },
    ],
    subtotal: 15,
    subtotalBeforeDiscount: 19,
    deliveryFee: 4,
    discountAmount: 2,
    couponCode: "TEST",
    total: 17,
    paymentStatus: "paid",
    preferredPaymentMethod: "card_payment_link",
    finalPaymentMethod: "cash_on_delivery",
    orderStatus: "confirmed",
    deliveryMethod: "local_express",
    deliveryAddress: {
      firstName: "Client",
      lastName: "Test",
      line1: "1 rue test",
      postalCode: "13090",
      city: "Aix-en-Provence",
      country: "FR",
    },
    analytics: {
      consentGrantedAtSubmission: true,
      consentCapturedAt: "2026-07-12T10:00:00.000Z",
      clientId: "123456789.987654321",
      sessionId: "1234567890",
      purchaseStatus: "pending",
    },
    paidAt: "2026-07-12T10:30:00.000Z",
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:30:00.000Z",
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
