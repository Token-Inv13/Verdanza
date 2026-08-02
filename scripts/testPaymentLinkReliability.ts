import assert from "node:assert/strict";
import type { EmailResult } from "../api/_server/email.js";
import { sendPaymentLinkEmail } from "../api/_server/email.js";
import {
  executePaymentLinkDelivery,
  PaymentLinkConflictError,
  PaymentLinkOrderStateError,
  paymentLinkIdempotencyKey,
  paymentLinkPayloadFingerprint,
  type PaymentLinkDeliveryRequest,
} from "../api/_server/paymentLinkDelivery.js";
import type { Order } from "../src/types/index.js";

type StoredDocument = Record<string, unknown>;
type WriteKind = "set" | "update";

class FakeSnapshot {
  constructor(
    readonly id: string,
    private readonly value?: StoredDocument,
  ) {}

  get exists() {
    return Boolean(this.value);
  }

  data() {
    return this.value;
  }
}

class FakeDocumentReference {
  constructor(
    private readonly database: FakeFirestore,
    readonly path: string,
  ) {}

  get id() {
    return this.path.split("/").at(-1) || "";
  }

  get() {
    return Promise.resolve(this.database.snapshot(this));
  }

  set(value: StoredDocument, options?: { merge?: boolean }) {
    this.database.apply("set", this, value, options);
    return Promise.resolve();
  }

  update(value: StoredDocument) {
    this.database.apply("update", this, value);
    return Promise.resolve();
  }
}

class FakeCollectionReference {
  constructor(
    private readonly database: FakeFirestore,
    private readonly name: string,
  ) {}

  doc(id?: string) {
    return new FakeDocumentReference(
      this.database,
      `${this.name}/${id || this.database.nextId(this.name)}`,
    );
  }
}

class FakeTransaction {
  private readonly operations: Array<{
    kind: WriteKind;
    ref: FakeDocumentReference;
    value: StoredDocument;
    options?: { merge?: boolean };
  }> = [];

  constructor(private readonly database: FakeFirestore) {}

  get(ref: FakeDocumentReference) {
    return Promise.resolve(this.database.snapshot(ref));
  }

  set(
    ref: FakeDocumentReference,
    value: StoredDocument,
    options?: { merge?: boolean },
  ) {
    this.operations.push({ kind: "set", ref, value, options });
  }

  update(ref: FakeDocumentReference, value: StoredDocument) {
    this.operations.push({ kind: "update", ref, value });
  }

  commit() {
    for (const operation of this.operations) {
      this.database.apply(
        operation.kind,
        operation.ref,
        operation.value,
        operation.options,
      );
    }
  }
}

class FakeFirestore {
  readonly documents = new Map<string, StoredDocument>();
  private transactionLock: Promise<void> = Promise.resolve();
  private readonly counters = new Map<string, number>();

  collection(name: string) {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>) {
    const previous = this.transactionLock;
    let release = () => {};
    this.transactionLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const transaction = new FakeTransaction(this);
    try {
      const result = await callback(transaction);
      transaction.commit();
      return result;
    } finally {
      release();
    }
  }

  snapshot(ref: FakeDocumentReference) {
    return new FakeSnapshot(ref.id, this.documents.get(ref.path));
  }

  nextId(collection: string) {
    const next = Number(this.counters.get(collection) || 0) + 1;
    this.counters.set(collection, next);
    return `auto-${next}`;
  }

  apply(
    kind: WriteKind,
    ref: FakeDocumentReference,
    value: StoredDocument,
    options?: { merge?: boolean },
  ) {
    const current = this.documents.get(ref.path) || {};
    const target = kind === "set" && !options?.merge ? {} : { ...current };
    for (const [path, entry] of Object.entries(value)) {
      setNestedValue(target, path, entry);
    }
    this.documents.set(ref.path, target);
  }
}

function setNestedValue(target: StoredDocument, path: string, value: unknown) {
  const segments = path.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as StoredDocument;
  }
  cursor[segments.at(-1) || path] = value;
}

const admin = { uid: "admin-1", email: "admin@example.test" };
const firstRequestId = "017f22e2-79b0-4d29-aad7-2f6f3f012345";
const secondRequestId = "117f22e2-79b0-4d29-aad7-2f6f3f067890";
const paymentUrl = "https://buy.stripe.com/test_secret_payment_link";

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-123",
    customerEmail: "client@example.test",
    customerPhone: "+33000000000",
    customerName: "Client Test",
    items: [],
    subtotal: 20,
    deliveryFee: 0,
    total: 20,
    paymentStatus: "to_confirm",
    orderStatus: "confirmed",
    deliveryMethod: "postal",
    deliveryAddress: {
      firstName: "Client",
      lastName: "Test",
      line1: "1 rue du Test",
      postalCode: "13000",
      city: "Aix-en-Provence",
      country: "France",
    },
    ...overrides,
  };
}

function request(
  paymentLinkRequestId = firstRequestId,
  overrides: Partial<PaymentLinkDeliveryRequest> = {},
): PaymentLinkDeliveryRequest {
  return {
    orderId: "order-123",
    paymentLinkRequestId,
    intent: "initial",
    paymentLinkUrl: paymentUrl,
    paymentLinkLabel: "Paiement CB 20 EUR",
    paymentLinkAmount: 20,
    paymentLinkCurrency: "EUR",
    channel: "email",
    ...overrides,
  };
}

function database(initialOrder = order()) {
  const db = new FakeFirestore();
  db.documents.set(`orders/${initialOrder.id}`, initialOrder as unknown as StoredDocument);
  return db;
}

async function delivery(
  db: FakeFirestore,
  deliveryRequest: PaymentLinkDeliveryRequest,
  send: (request: PaymentLinkDeliveryRequest) => Promise<EmailResult>,
) {
  return executePaymentLinkDelivery({
    db: db as unknown as FirebaseFirestore.Firestore,
    request: deliveryRequest,
    admin,
    send: (_order, currentRequest) => send(currentRequest),
    now: () => Date.parse("2026-08-02T12:00:00.000Z"),
  });
}

async function testDoubleSimultaneousPost() {
  const db = database();
  let releaseProvider = () => {};
  let announceProvider = () => {};
  const providerStarted = new Promise<void>((resolve) => {
    announceProvider = resolve;
  });
  const providerRelease = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  let sendCalls = 0;
  const send = async () => {
    sendCalls += 1;
    announceProvider();
    await providerRelease;
    return { status: "sent", id: "provider-1" } satisfies EmailResult;
  };

  const first = delivery(db, request(), send);
  await providerStarted;
  const second = await delivery(db, request(), send);
  assert.equal(second.status, "sending");
  assert.equal(second.existing, true);
  assert.equal(sendCalls, 1);
  releaseProvider();
  assert.equal((await first).status, "sent");
  assert.equal(sendCalls, 1);
}

async function testLostHttpResponseAndProviderSuccessOnce() {
  const db = database();
  let deliveries = 0;
  const providerIds = new Map<string, string>();
  const send = async (current: PaymentLinkDeliveryRequest) => {
    const key = paymentLinkIdempotencyKey(current.orderId, current.paymentLinkRequestId);
    if (!providerIds.has(key)) {
      deliveries += 1;
      providerIds.set(key, `provider-${deliveries}`);
    }
    return { status: "sent", id: providerIds.get(key) } satisfies EmailResult;
  };

  const first = await delivery(db, request(), send);
  assert.equal(first.status, "sent");
  const retryAfterLostResponse = await delivery(db, request(), send);
  assert.equal(retryAfterLostResponse.status, "sent");
  assert.equal(retryAfterLostResponse.existing, true);
  assert.equal(deliveries, 1);
  assert.equal(
    (db.documents.get("orders/order-123") as { paymentLinkSent?: boolean })
      .paymentLinkSent,
    true,
  );
}

async function testTimeoutRetryUsesSameProviderKey() {
  const db = database();
  let providerCalls = 0;
  let actualDeliveries = 0;
  const providerIds = new Map<string, string>();
  const send = async (current: PaymentLinkDeliveryRequest) => {
    providerCalls += 1;
    const key = paymentLinkIdempotencyKey(current.orderId, current.paymentLinkRequestId);
    if (!providerIds.has(key)) {
      actualDeliveries += 1;
      providerIds.set(key, "provider-timeout");
    }
    if (providerCalls === 1) {
      return { status: "failed", reason: "timeout" } satisfies EmailResult;
    }
    return { status: "sent", id: providerIds.get(key) } satisfies EmailResult;
  };

  const first = await delivery(db, request(), send);
  assert.equal(first.status, "unknown");
  assert.equal(
    (db.documents.get("orders/order-123") as { paymentLinkSent?: boolean })
      .paymentLinkSent,
    undefined,
  );
  const retry = await delivery(db, request(), send);
  assert.equal(retry.status, "sent");
  assert.equal(retry.attempts, 2);
  assert.equal(providerCalls, 2);
  assert.equal(actualDeliveries, 1);
}

async function testSameIdDifferentPayloadConflict() {
  const db = database();
  await delivery(db, request(), async () => ({
    status: "failed",
    reason: "timeout",
  }));
  await assert.rejects(
    () =>
      delivery(
        db,
        request(firstRequestId, { paymentLinkAmount: 25 }),
        async () => ({ status: "sent", id: "must-not-send" }),
      ),
    PaymentLinkConflictError,
  );
}

async function testVoluntaryResendUsesNewIntent() {
  const db = database();
  const keys = new Set<string>();
  const send = async (current: PaymentLinkDeliveryRequest) => {
    keys.add(paymentLinkIdempotencyKey(current.orderId, current.paymentLinkRequestId));
    return { status: "sent", id: `provider-${keys.size}` } satisfies EmailResult;
  };
  assert.equal((await delivery(db, request(), send)).status, "sent");
  assert.equal(
    (
      await delivery(
        db,
        request(secondRequestId, { intent: "resend" }),
        send,
      )
    ).status,
    "sent",
  );
  assert.equal(keys.size, 2);
  const history = (
    db.documents.get("orders/order-123") as {
      paymentLinkDeliveryHistory?: Array<{ intent: string }>;
    }
  ).paymentLinkDeliveryHistory;
  assert.deepEqual(history?.map((entry) => entry.intent), ["resend", "initial"]);
}

async function testCancellationRaceDoesNotRecordSent() {
  const db = database();
  const result = await delivery(db, request(), async () => {
    db.documents.set(
      "orders/order-123",
      order({ orderStatus: "cancelled", paymentStatus: "cancelled" }) as unknown as StoredDocument,
    );
    return { status: "sent", id: "provider-race" };
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.providerId, "provider-race");
  assert.equal(result.errorCode, "order_cancelled_after_provider_call");
  assert.equal(
    (db.documents.get("orders/order-123") as { paymentLinkSent?: boolean })
      .paymentLinkSent,
    undefined,
  );
}

async function testPaidAndCancelledOrdersAreRejected() {
  let sendCalls = 0;
  const send = async () => {
    sendCalls += 1;
    return { status: "sent", id: "must-not-send" } satisfies EmailResult;
  };
  await assert.rejects(
    () => delivery(database(order({ paymentStatus: "paid" })), request(), send),
    (error: unknown) =>
      error instanceof PaymentLinkOrderStateError &&
      error.code === "order_already_paid",
  );
  await assert.rejects(
    () =>
      delivery(
        database(order({ orderStatus: "cancelled" })),
        request(),
        send,
      ),
    (error: unknown) =>
      error instanceof PaymentLinkOrderStateError && error.code === "order_cancelled",
  );
  await assert.rejects(
    () => delivery(database(order({ deletedAt: "2026-08-01" })), request(), send),
    (error: unknown) =>
      error instanceof PaymentLinkOrderStateError && error.code === "order_deleted",
  );
  assert.equal(sendCalls, 0);
}

async function testStableResendKeyAndSafeLogs() {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;
  const logs: string[] = [];
  let idempotencyHeader = "";
  process.env.RESEND_API_KEY = "test-key-not-real";
  process.env.EMAIL_FROM = "Verdanza <contact@example.test>";
  console.info = (...values: unknown[]) => {
    logs.push(JSON.stringify(values));
  };
  globalThis.fetch = async (_url, init) => {
    idempotencyHeader = String(
      (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"] ||
        "",
    );
    return new Response(JSON.stringify({ id: "provider-mocked" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await sendPaymentLinkEmail(order(), {
      paymentLinkRequestId: firstRequestId,
      paymentLinkUrl: paymentUrl,
      paymentLinkLabel: "Paiement CB 20 EUR",
      paymentLinkAmount: 20,
      paymentLinkCurrency: "EUR",
    });
    assert.equal(result.status, "sent");
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    restoreEnvironment("RESEND_API_KEY", originalApiKey);
    restoreEnvironment("EMAIL_FROM", originalFrom);
  }
  assert.equal(
    idempotencyHeader,
    paymentLinkIdempotencyKey("order-123", firstRequestId),
  );
  const renderedLogs = logs.join("\n");
  assert.equal(renderedLogs.includes(paymentUrl), false);
  assert.equal(renderedLogs.includes("client@example.test"), false);
  assert.equal(renderedLogs.includes("test-key-not-real"), false);
}

function testFingerprintCoverage() {
  const baseline = paymentLinkPayloadFingerprint(request());
  assert.notEqual(
    baseline,
    paymentLinkPayloadFingerprint(request(firstRequestId, { paymentLinkUrl: `${paymentUrl}-2` })),
  );
  assert.notEqual(
    baseline,
    paymentLinkPayloadFingerprint(request(firstRequestId, { paymentLinkAmount: 21 })),
  );
  assert.equal(baseline.length, 64);
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

await testDoubleSimultaneousPost();
await testLostHttpResponseAndProviderSuccessOnce();
await testTimeoutRetryUsesSameProviderKey();
await testSameIdDifferentPayloadConflict();
await testVoluntaryResendUsesNewIntent();
await testCancellationRaceDoesNotRecordSent();
await testPaidAndCancelledOrdersAreRejected();
await testStableResendKeyAndSafeLogs();
testFingerprintCoverage();

console.log("Payment link reliability tests: OK");
