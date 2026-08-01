import assert from "node:assert/strict";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  commitCheckoutOrder,
} from "../api/create-order.js";
import { orderPayload } from "../api/_server/checkout.js";
import {
  sendAdminNotificationEmails,
  sendTransactionalEmail,
} from "../api/_server/email.js";
import { sendOrderCreationAlerts } from "../api/_server/orderAlerts.js";
import { omitUndefinedDeep } from "../api/_server/firestoreSerialization.js";
import {
  CheckoutRequestConflictError,
  checkoutPayloadFingerprint,
  orderSideEffectsDocument,
  resetOrderSideEffectTask,
  runEmailSideEffect,
  validateCheckoutRequestId,
} from "../api/_server/orderSideEffects.js";
import type {
  CheckoutRequestBody,
  PricedCheckout,
} from "../api/_server/checkout.js";

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

class FakeBatch extends FakeTransaction {}

class FakeFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly writes: Array<{ kind: WriteKind; path: string }> = [];
  private readonly counters = new Map<string, number>();
  private transactionLock: Promise<void> = Promise.resolve();

  collection(name: string) {
    return new FakeCollectionReference(this, name);
  }

  batch() {
    return new FakeBatch(this);
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

  nextId(collection: string) {
    const next = Number(this.counters.get(collection) || 0) + 1;
    this.counters.set(collection, next);
    return `auto-${next}`;
  }

  snapshot(ref: FakeDocumentReference) {
    return new FakeSnapshot(ref.id, this.documents.get(ref.path));
  }

  apply(
    kind: WriteKind,
    ref: FakeDocumentReference,
    value: StoredDocument,
    options?: { merge?: boolean },
  ) {
    this.writes.push({ kind, path: ref.path });
    const current = this.documents.get(ref.path) || {};
    const target = kind === "set" && !options?.merge ? {} : { ...current };
    for (const [path, entry] of Object.entries(value)) {
      setNestedValue(target, path, entry);
    }
    this.documents.set(ref.path, target);
  }

  writeCount(path: string) {
    return this.writes.filter((write) => write.path === path).length;
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

function assertNoUndefined(value: unknown, path = "$") {
  assert.notEqual(value, undefined, `undefined détecté dans ${path}`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoUndefined(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  for (const [key, entry] of Object.entries(value)) {
    assertNoUndefined(entry, `${path}.${key}`);
  }
}

const checkoutRequestId = "017f22e2-79b0-4d29-aad7-2f6f3f012345";
const body: CheckoutRequestBody = {
  checkoutRequestId,
  items: [{ productId: "flower-1", quantity: 2 }],
  deliveryMethod: "local_express",
  deliveryZone: "local-1",
  couponCode: "SAVE",
  complianceAccepted: true,
  preferredPaymentMethod: "cash_on_delivery",
  customer: {
    email: "client@example.test",
    phone: "+33000000000",
    firstName: "Client",
    lastName: "Test",
    address: {
      firstName: "Client",
      lastName: "Test",
      line1: "1 rue du Test",
      postalCode: "13000",
      city: "Aix-en-Provence",
      country: "France",
    },
  },
};

const priced: PricedCheckout = {
  orderItems: [
    {
      productId: "flower-1",
      name: "Fleur test",
      quantity: 2,
      unitPrice: 10,
      lineTotal: 20,
      purchaseMode: "gram",
    },
  ],
  subtotal: 20,
  subtotalBeforeDiscount: 20,
  deliveryFee: 0,
  discountAmount: 2,
  couponCode: "SAVE",
  couponId: "coupon-save",
  discountType: "fixed",
  discountValue: 2,
  promoApplied: true,
  promotionDiscountTotal: 2,
  appliedPromotions: [],
  promotionProgressMessages: [],
  subtotalBeforePromotion: 20,
  subtotalAfterPromotion: 18,
  totalAfterDiscount: 18,
  total: 18,
  deliveryZoneName: "Aix-en-Provence centre",
  deliveryMinimumApplied: 20,
  postalFreeShippingApplied: false,
  deliveryFeeStatus: "free",
  deliveryNote: "Livraison locale",
};

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];
function test(name: string, run: () => void | Promise<void>) {
  tests.push({ name, run });
}

test("checkoutRequestId valide uniquement un UUID sûr", () => {
  assert.equal(validateCheckoutRequestId(checkoutRequestId), checkoutRequestId);
  assert.throws(() => validateCheckoutRequestId("client@example.test"));
  assert.throws(() => validateCheckoutRequestId("x".repeat(200)));
});

test("la sérialisation Firestore omet récursivement undefined sans altérer les instances", () => {
  const date = new Date("2026-08-01T16:27:00.000Z");
  const timestamp = Timestamp.fromDate(date);
  const sentinel = FieldValue.serverTimestamp();
  const customInstance = new (class FirebaseLikeInstance {
    readonly value = "preserved";
  })();
  const sanitized = omitUndefinedDeep({
    absent: undefined,
    nullValue: null,
    falseValue: false,
    zeroValue: 0,
    emptyValue: "",
    array: [1, undefined, { absent: undefined, kept: "yes" }],
    nested: { absent: undefined, kept: "yes" },
    date,
    timestamp,
    sentinel,
    customInstance,
  });

  assert.equal("absent" in sanitized, false);
  assert.deepEqual(sanitized.array, [1, { kept: "yes" }]);
  assert.deepEqual(sanitized.nested, { kept: "yes" });
  assert.equal(sanitized.nullValue, null);
  assert.equal(sanitized.falseValue, false);
  assert.equal(sanitized.zeroValue, 0);
  assert.equal(sanitized.emptyValue, "");
  assert.equal(sanitized.date, date);
  assert.equal(sanitized.timestamp, timestamp);
  assert.equal(sanitized.sentinel, sentinel);
  assert.equal(sanitized.customInstance, customInstance);
  assertNoUndefined(sanitized);
});

test("WELCOME10, prix fixe et livraison locale produisent un document sans undefined", () => {
  const localFixedBody: CheckoutRequestBody = {
    ...body,
    couponCode: "WELCOME10",
    analyticsContext: {
      consentGranted: true,
      consentCapturedAt: "2026-08-01T16:27:00.000Z",
      clientId: "123456789.1234567890",
    },
  };
  const localFixedPriced: PricedCheckout = {
    ...priced,
    couponCode: "WELCOME10",
    couponId: "welcome10",
    discountType: "percent",
    discountValue: 10,
    orderItems: [
      {
        productId: "flower-1",
        name: "Fleur format fixe",
        quantity: 8,
        unitPrice: 3.75,
        lineTotal: 30,
        purchaseMode: "fixed_price",
        fixedPriceOptionId: "format-8g-30",
        fixedPriceQuantity: 1,
        fixedPriceTotal: 30,
        fixedPriceGrams: 8,
        slug: undefined,
        category: undefined,
        cultureType: undefined,
      },
    ],
    appliedPromotions: [
      {
        id: "welcome10",
        label: "WELCOME10",
        type: "percentage_cart_discount",
        applicationMode: "code",
        discountAmount: 3,
        eligibleCategory: undefined,
        eligibleCategories: undefined,
        productIds: undefined,
        couponId: "welcome10",
        couponCode: "WELCOME10",
      },
    ],
  };

  const payload = orderPayload(localFixedBody, localFixedPriced);
  const promotion = (payload.appliedPromotions as Array<Record<string, unknown>>)[0];
  const analytics = payload.analytics as Record<string, unknown>;
  const item = (payload.items as Array<Record<string, unknown>>)[0];

  assert.equal(payload.deliveryMethod, "local_express");
  assert.equal(item.purchaseMode, "fixed_price");
  assert.equal("eligibleCategory" in promotion, false);
  assert.equal("eligibleCategories" in promotion, false);
  assert.equal("productIds" in promotion, false);
  assert.equal("slug" in item, false);
  assert.equal("category" in item, false);
  assert.equal("cultureType" in item, false);
  assert.equal("sessionId" in analytics, false);
  assert.equal("revocationTokenHash" in analytics, false);
  assertNoUndefined(payload);
});

test("les champs promotion et Analytics présents restent inchangés", () => {
  const analyticsBody: CheckoutRequestBody = {
    ...body,
    analyticsContext: {
      consentGranted: true,
      consentCapturedAt: "2026-08-01T16:27:00.000Z",
      clientId: "123456789.1234567890",
      sessionId: "1785594456",
    },
  };
  const pricedWithCategory: PricedCheckout = {
    ...priced,
    appliedPromotions: [
      {
        id: "flowers-category",
        label: "Fleurs",
        type: "percentage_category_discount",
        discountAmount: 2,
        eligibleCategory: "flowers",
      },
    ],
  };
  const payload = orderPayload(
    analyticsBody,
    pricedWithCategory,
    undefined,
    "revocation-token-hash",
  );
  const promotion = (payload.appliedPromotions as Array<Record<string, unknown>>)[0];
  const analytics = payload.analytics as Record<string, unknown>;

  assert.equal(promotion.eligibleCategory, "flowers");
  assert.equal(analytics.sessionId, "1785594456");
  assert.equal(analytics.revocationTokenHash, "revocation-token-hash");
  assertNoUndefined(payload);
});

test("deux POST simultanés ne créent qu'une commande", async () => {
  const db = seededDatabase();
  const fingerprint = checkoutPayloadFingerprint(body);
  const firestore = db as unknown as FirebaseFirestore.Firestore;
  const [first, second] = await Promise.all([
    commitCheckoutOrder({
      db: firestore,
      body,
      priced,
      checkoutRequestId,
      payloadFingerprint: fingerprint,
      orderId: "order-a",
    }),
    commitCheckoutOrder({
      db: firestore,
      body,
      priced,
      checkoutRequestId,
      payloadFingerprint: fingerprint,
      orderId: "order-b",
    }),
  ]);

  assert.equal([first, second].filter((result) => result.created).length, 1);
  assert.equal(first.orderId, second.orderId);
  assert.equal(db.writeCount("products/flower-1"), 1, "stock décrémenté une fois");
  assert.equal(db.writeCount("coupons/coupon-save"), 1, "coupon compté une fois");
  assert.equal([...db.documents.keys()].filter((key) => key.startsWith("orders/")).length, 1);
  assert.equal(
    [...db.documents.keys()].filter((key) => key.startsWith("orderSideEffects/")).length,
    1,
  );

  const repeated = await commitCheckoutOrder({
    db: firestore,
    body,
    priced,
    checkoutRequestId,
    payloadFingerprint: fingerprint,
    orderId: "order-c",
  });
  assert.equal(repeated.created, false, "retry après réponse perdue dédupliqué");
  assert.equal(repeated.orderId, first.orderId);
  assert.equal(db.writeCount("products/flower-1"), 1);

  const changedBody = {
    ...body,
    customer: { ...body.customer, email: "different@example.test" },
  };
  await assert.rejects(
    commitCheckoutOrder({
      db: firestore,
      body: changedBody,
      priced,
      checkoutRequestId,
      payloadFingerprint: checkoutPayloadFingerprint(changedBody),
      orderId: "order-d",
    }),
    CheckoutRequestConflictError,
  );
});

test("une création dédupliquée ne déclenche les notifications qu'une fois", async () => {
  const db = seededDatabase();
  const firestore = db as unknown as FirebaseFirestore.Firestore;
  const fingerprint = checkoutPayloadFingerprint(body);
  const results = await Promise.all([
    commitCheckoutOrder({
      db: firestore,
      body,
      priced,
      checkoutRequestId,
      payloadFingerprint: fingerprint,
      orderId: "order-notification-a",
    }),
    commitCheckoutOrder({
      db: firestore,
      body,
      priced,
      checkoutRequestId,
      payloadFingerprint: fingerprint,
      orderId: "order-notification-b",
    }),
  ]);
  let notificationRuns = 0;
  for (const result of results) {
    if (result.created) notificationRuns += 1;
  }
  assert.equal(notificationRuns, 1);
});

test("un timeout Resend retourne un code synthétique", async () => {
  await withEmailEnvironment(async () => {
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch;
    const result = await sendTransactionalEmail({
      kind: "order_confirmation",
      orderId: "order-timeout",
      to: "client@example.test",
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
      idempotencyKey: "order-timeout-client",
      timeoutMs: 5,
    });
    assert.deepEqual(result, { status: "failed", reason: "timeout" });
  });
});

test("les deux administrateurs sont indépendants et le résultat devient partial", async () => {
  await withEmailEnvironment(async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || "{}")) as { to?: string };
      const delivered = payload.to === "contact@verdanza.fr";
      return {
        ok: delivered,
        status: delivered ? 200 : 503,
        json: async () => (delivered ? { id: "provider-contact" } : {}),
      } as Response;
    }) as typeof fetch;
    const result = await sendAdminNotificationEmails({
      kind: "admin_new_order",
      orderId: "order-partial",
      to: ["contact@verdanza.fr", "verdanza.1@gmail.com"],
      subject: "Commande",
      html: "<p>Commande</p>",
      text: "Commande",
      idempotencyKey: "admin-order-partial",
    });
    assert.equal(result.status, "partial");
    assert.equal(result.recipients["contact@verdanza.fr"].status, "sent");
    assert.equal(result.recipients["verdanza.1@gmail.com"].status, "failed");
  });
});

test("les relances sauvegardent succès et échec dans Firestore", async () => {
  const db = seededDatabase();
  const firestore = db as unknown as FirebaseFirestore.Firestore;
  db.documents.set("orders/order-retry", orderDocument("order-retry"));
  db.documents.set("orderSideEffects/order-retry", plainOutbox("order-retry"));

  await resetOrderSideEffectTask(firestore, "order-retry", "customer_confirmation_email");
  const sent = await runEmailSideEffect({
    db: firestore,
    orderId: "order-retry",
    task: "customer_confirmation_email",
    prefix: "orderConfirmation",
    send: async () => ({ status: "sent", id: "provider-client" }),
  });
  assert.equal(sent.status, "sent");
  assert.equal(
    nested(db.documents.get("orders/order-retry"), "emails.orderConfirmationStatus"),
    "sent",
  );
  assert.equal(
    nested(
      db.documents.get("orderSideEffects/order-retry"),
      "tasks.customer_confirmation_email.status",
    ),
    "sent",
  );

  await resetOrderSideEffectTask(firestore, "order-retry", "customer_confirmation_email");
  const failed = await runEmailSideEffect({
    db: firestore,
    orderId: "order-retry",
    task: "customer_confirmation_email",
    prefix: "orderConfirmation",
    send: async () => ({ status: "failed", reason: "network_error" }),
  });
  assert.equal(failed.status, "failed");
  assert.equal(
    nested(db.documents.get("orders/order-retry"), "emails.orderConfirmationStatus"),
    "failed",
  );
});

test("la commande reste créée si les deux e-mails échouent", async () => {
  const db = seededDatabase();
  const firestore = db as unknown as FirebaseFirestore.Firestore;
  const fingerprint = checkoutPayloadFingerprint(body);
  const creation = await commitCheckoutOrder({
    db: firestore,
    body,
    priced,
    checkoutRequestId,
    payloadFingerprint: fingerprint,
    orderId: "order-email-failure",
  });
  assert.equal(creation.created, true);
  await Promise.all([
    runEmailSideEffect({
      db: firestore,
      orderId: creation.orderId,
      task: "customer_confirmation_email",
      prefix: "orderConfirmation",
      send: async () => ({ status: "failed", reason: "network_error" }),
    }),
    runEmailSideEffect({
      db: firestore,
      orderId: creation.orderId,
      task: "admin_notification_email",
      prefix: "adminNotification",
      send: async () => ({ status: "failed", reason: "network_error" }),
    }),
  ]);
  assert.ok(db.documents.has(`orders/${creation.orderId}`));
  assert.equal(
    nested(db.documents.get(`orders/${creation.orderId}`), "emails.adminNotificationStatus"),
    "failed",
  );
});

test("un échec SMS et WhatsApp ne supprime pas la commande", async () => {
  const db = seededDatabase();
  const firestore = db as unknown as FirebaseFirestore.Firestore;
  db.documents.set("orders/order-alerts", orderDocument("order-alerts"));
  db.documents.set("orderSideEffects/order-alerts", plainOutbox("order-alerts"));
  await withTwilioEnvironment(async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as Response) as typeof fetch;
    const result = await sendOrderCreationAlerts(firestore, "order-alerts");
    assert.equal(result.sms?.status, "failed");
    assert.equal(result.whatsapp?.status, "failed");
  });
  assert.ok(db.documents.has("orders/order-alerts"));
});

function seededDatabase() {
  const db = new FakeFirestore();
  db.documents.set("products/flower-1", {
    id: "flower-1",
    name: "Fleur test",
    isActive: true,
    stock: 10,
    price: 10,
  });
  db.documents.set("coupons/coupon-save", {
    id: "coupon-save",
    isActive: true,
    isArchived: false,
    usedCount: 0,
    maxUses: 100,
  });
  return db;
}

function orderDocument(id: string): StoredDocument {
  return {
    id,
    customerEmail: "client@example.test",
    customerPhone: "+33000000000",
    customerName: "Client Test",
    items: priced.orderItems,
    subtotal: 20,
    deliveryFee: 0,
    total: 20,
    paymentStatus: "to_confirm",
    orderStatus: "contact_required",
    deliveryMethod: "local_express",
    deliveryAddress: body.customer.address,
    emails: {},
    alerts: {},
  };
}

function plainOutbox(orderId: string) {
  const document = orderSideEffectsDocument(orderId) as StoredDocument;
  const tasks = document.tasks as Record<string, StoredDocument>;
  for (const task of Object.values(tasks)) {
    task.status = "pending";
    task.attempts = 0;
    task.leaseUntil = null;
  }
  return document;
}

function nested(document: StoredDocument | undefined, path: string) {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as StoredDocument)[segment];
  }, document);
}

async function withEmailEnvironment(run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;
  process.env.RESEND_API_KEY = "mock-resend-key";
  process.env.EMAIL_FROM = "Verdanza <contact@verdanza.fr>";
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment("RESEND_API_KEY", originalApiKey);
    restoreEnvironment("EMAIL_FROM", originalFrom);
  }
}

async function withTwilioEnvironment(run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const keys = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_SMS_FROM",
    "ADMIN_ALERT_PHONE",
    "TWILIO_WHATSAPP_FROM",
    "ADMIN_ALERT_WHATSAPP",
  ] as const;
  const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = `mock-${key.toLowerCase()}`;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) restoreEnvironment(key, originals[key]);
  }
}

function restoreEnvironment(key: string, value?: string) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

let passed = 0;
for (const entry of tests) {
  try {
    await entry.run();
    passed += 1;
    console.info(`PASS ${entry.name}`);
  } catch (error) {
    console.error(`FAIL ${entry.name}`);
    throw error;
  }
}
console.info(`Order reliability: ${passed}/${tests.length} tests passed.`);
