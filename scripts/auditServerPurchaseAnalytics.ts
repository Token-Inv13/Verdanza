import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Order } from "../src/types/index.js";
import { createReferralOrderSnapshot } from "../api/_server/referralSnapshot.js";
import {
  buildGa4PurchasePayload,
  isPurchaseEligible,
  netProductValue,
  sendGa4Payload,
  sendGa4Purchase,
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
  await auditReferralPurchase();
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
    assert(JSON.stringify(JSON.parse(receivedBody)) === JSON.stringify(payload), "network body must preserve every item price and discount");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function auditReferralPurchase() {
  const order = mockReferralOrder();
  const expected = { "fleur-test": [28.87, 3.13], "resine-test": [17.33, 1.87] } as const;
  for (const [itemsReversed, linesReversed] of [[false, false], [true, false], [false, true], [true, true]]) {
    const variant: Order = {
      ...order,
      items: itemsReversed ? [...order.items].reverse() : order.items,
      referral: linesReversed ? { ...order.referral!, lines: [...order.referral!.lines].reverse() } : order.referral,
    };
    const payload = buildGa4PurchasePayload(variant);
    assert(payload, "valid frozen referral purchase must produce a payload regardless of order");
    const { value, shipping, items } = payload.events[0].params;
    assert(value === 46.2 && shipping === 5.49, "referral event value and shipping must remain separate");
    assert(items.length === 2, "every frozen referral line must remain a separate GA4 item");
    for (const item of items) {
      const cents = expected[item.item_id as keyof typeof expected];
      assert(cents && item.price === cents[0] && item.discount === cents[1], "GA4 must preserve the frozen allocation by lineId");
    }
    assert(Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) === 4620, "item net cents must equal event value");
    assert(Math.round(items.reduce((sum, item) => sum + (item.discount ?? 0) * item.quantity, 0) * 100) === 500, "item discount cents must equal frozen discount");
  }

  const quantityThree: Order = { ...order, items: [{ ...order.items[0], quantity: 3, purchaseMode: "fixed_price" }, order.items[1]] };
  const split = buildGa4PurchasePayload(quantityThree);
  assert(split, "non-divisible fixed-price quantity must remain valid");
  const first = split.events[0].params.items[0];
  assert(Math.round(first.price * first.quantity * 100) === 2887, "fixed-price quantity must reconstruct frozen net cents");
  assert(Math.round((first.discount ?? 0) * first.quantity * 100) === 313, "unit discount must retain the third cent");
  assert(Math.round((first.price + (first.discount ?? 0)) * first.quantity * 100) === 3200, "fixed-price gross cents must reconstruct");
  assert(first.discount !== 1.04, "referral unit discount must not be rounded before GA4 transport");

  const repeatedProduct: Order = { ...order, items: order.items.map((item) => ({ ...item, productId: "same-product", slug: "same-product" })) };
  const repeated = buildGa4PurchasePayload(repeatedProduct);
  assert(repeated?.events[0].params.items.length === 2, "same product on distinct lines must stay separate");
  assert(repeated.events[0].params.items[0].discount === 3.13 && repeated.events[0].params.items[1].discount === 1.87,
    "same-product lines must retain their distinct frozen discounts");

  const lines = order.referral!.lines;
  const corrupt: Order[] = [
    { ...order, items: [{ ...order.items[0], lineId: "missing" }, order.items[1]] },
    { ...order, items: [{ ...order.items[0], lineId: "line-b" }, order.items[1]] },
    { ...order, referral: { ...order.referral!, lines: [lines[0], { ...lines[1], lineId: "line-a" }] } },
    { ...order, items: [{ ...order.items[0], lineTotal: 31.99 }, order.items[1]] },
    { ...order, referral: { ...order.referral!, lines: [{ ...lines[0], referralDiscountCents: 3200 }, lines[1]] } },
    { ...order, referral: { ...order.referral!, lines: [{ ...lines[0], referralDiscountCents: 312 }, lines[1]] } },
    { ...order, items: [...order.items, { ...order.items[0], lineId: "extra", lineTotal: 1 }] },
    { ...order, referral: null } as unknown as Order,
  ];
  const localConfig = { measurementId: "G-E9XNP7BJ2Y", apiSecret: "test_secret_123456", host: "http://127.0.0.1:1" };
  for (const variant of corrupt) {
    assert(buildGa4PurchasePayload(variant) === null, "corrupt referral snapshot must fail closed without reallocation");
    const result = await sendGa4Purchase(variant, localConfig, async () => { throw new Error("must not send corrupt referral payload"); });
    assert(result.status === "failed" && result.code === "purchase_not_eligible", "corrupt referral purchase must not reach Measurement Protocol");
  }

  const payload = buildGa4PurchasePayload(order);
  assert(payload, "canonical referral payload must exist");
  const json = JSON.stringify(payload);
  assert(!json.includes(order.customerEmail) && !json.includes(order.customerPhone) && !json.includes(order.customerName || ""), "referral payload must exclude customer PII");
  assert(!json.includes(order.referral!.referralId), "referral payload must exclude referral identity");
  await auditMockMeasurementProtocol(payload);
}

function mockReferralOrder(): Order {
  const base = mockPaidOrder();
  const lines = [
    { lineId: "line-a", eligibleBeforeReferralCents: 3200, referralDiscountCents: 313 },
    { lineId: "line-b", eligibleBeforeReferralCents: 1920, referralDiscountCents: 187 },
  ];
  return {
    ...base,
    id: "order_referral_analytics",
    items: [
      { ...base.items[0], lineId: "line-a", quantity: 1, unitPrice: 32, lineTotal: 32 },
      { ...base.items[1], lineId: "line-b", quantity: 1, unitPrice: 19.2, lineTotal: 19.2 },
    ],
    subtotal: 51.2,
    subtotalAfterPromotion: 51.2,
    subtotalBeforeDiscount: 51.2,
    discountAmount: 5,
    deliveryFee: 5.49,
    total: 51.69,
    referral: createReferralOrderSnapshot({ refereeUid: "referral-audit-only", createdAtEpochMs: 1000, lines }),
  };
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
