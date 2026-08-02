import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyOrderCancellationInTransaction,
  nextRestoredCouponUsedCount,
  promotionIdsForRestoration,
} from "../api/_server/orderCancellation.js";
import {
  executeGuardedInvoiceSend,
  finalizeAcceptedInvoiceSend,
} from "../api/_server/invoiceEmailSend.js";
import {
  invoiceSendBlock,
  InvoiceSendConflictError,
} from "../src/lib/invoiceSendPolicy.js";
import type { Invoice, Order } from "../src/types/index.js";

type StoredDocument = Record<string, unknown>;
type Operation = {
  kind: "set" | "update";
  ref: FakeDocumentReference;
  value: StoredDocument;
  options?: { merge?: boolean };
};

class FakeSnapshot {
  constructor(
    readonly id: string,
    private readonly value?: StoredDocument,
  ) {}

  get exists() {
    return this.value !== undefined;
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
  readonly operations: Operation[] = [];

  constructor(private readonly database: FakeFirestore) {}

  get(reference: FakeDocumentReference) {
    return Promise.resolve(this.database.snapshot(reference));
  }

  set(
    reference: FakeDocumentReference,
    value: StoredDocument,
    options?: { merge?: boolean },
  ) {
    this.operations.push({ kind: "set", ref: reference, value, options });
  }

  update(reference: FakeDocumentReference, value: StoredDocument) {
    this.operations.push({ kind: "update", ref: reference, value });
  }
}

class FakeFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly writes: Operation[] = [];
  private readonly counters = new Map<string, number>();

  collection(name: string) {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    for (const operation of transaction.operations) this.apply(operation);
    return result;
  }

  snapshot(reference: FakeDocumentReference) {
    return new FakeSnapshot(reference.id, this.documents.get(reference.path));
  }

  seed(path: string, value: StoredDocument) {
    this.documents.set(path, { ...value });
  }

  nextId(collection: string) {
    const value = Number(this.counters.get(collection) || 0) + 1;
    this.counters.set(collection, value);
    return `auto-${value}`;
  }

  writeCount(path: string) {
    return this.writes.filter((operation) => operation.ref.path === path).length;
  }

  private apply(operation: Operation) {
    const current = this.documents.get(operation.ref.path);
    if (operation.kind === "update" && !current) {
      throw new Error(`Document absent: ${operation.ref.path}`);
    }
    const target = operation.kind === "set" && !operation.options?.merge
      ? {}
      : { ...(current || {}) };
    Object.assign(target, operation.value);
    this.documents.set(operation.ref.path, target);
    this.writes.push(operation);
  }
}

type TestCase = { name: string; run: () => void | Promise<void> };
const tests: TestCase[] = [];
const test = (name: string, run: TestCase["run"]) => tests.push({ name, run });

test("facture brouillon valide envoyable", () => {
  assert.equal(invoiceSendBlock(invoiceFixture(), orderFixture()), null);
});

test("facture envoyee valide renvoyable", () => {
  assert.equal(invoiceSendBlock(invoiceFixture({ status: "sent" }), orderFixture()), null);
});

test("facture annulee non envoyable", () => {
  assert.equal(invoiceSendBlock(invoiceFixture({ status: "cancelled" }), orderFixture())?.code, "invoice_cancelled");
});

test("commande annulee avec facture active non envoyable", () => {
  assert.equal(invoiceSendBlock(invoiceFixture(), orderFixture({ orderStatus: "cancelled" }))?.code, "invoice_order_cancelled");
});

test("commande supprimee non envoyable", () => {
  assert.equal(invoiceSendBlock(invoiceFixture(), orderFixture({ deletedAt: "2026-08-02T10:00:00.000Z" }))?.code, "invoice_order_deleted");
});

test("annulation concurrente pendant Resend bloque la finalisation", async () => {
  const db = invoiceDatabase();
  let sendCount = 0;
  await assert.rejects(
    executeGuardedInvoiceSend({
      invoice: invoiceFixture(),
      linkedOrder: orderFixture(),
      send: async () => {
        sendCount += 1;
        db.documents.set("invoices/invoice-1", invoiceFixture({ status: "cancelled" }) as unknown as StoredDocument);
        return { status: "sent" as const };
      },
      finalize: () => finalizeAcceptedInvoiceSend({
        db: db as unknown as FirebaseFirestore.Firestore,
        invoiceId: "invoice-1",
        sentTo: "client@example.test",
      }),
    }),
    (error) => error instanceof InvoiceSendConflictError && error.code === "invoice_cancelled",
  );
  assert.equal(sendCount, 1);
});

test("reponse Resend apres annulation ne remet pas la facture a sent", async () => {
  const db = invoiceDatabase();
  db.documents.set("invoices/invoice-1", invoiceFixture({ status: "cancelled" }) as unknown as StoredDocument);
  await assert.rejects(finalizeAcceptedInvoiceSend({
    db: db as unknown as FirebaseFirestore.Firestore,
    invoiceId: "invoice-1",
    sentTo: "client@example.test",
  }));
  assert.equal(db.documents.get("invoices/invoice-1")?.status, "cancelled");
  assert.equal(db.writeCount("invoices/invoice-1"), 0);
});

test("aucun email apres refus", async () => {
  let sendCount = 0;
  await assert.rejects(executeGuardedInvoiceSend({
    invoice: invoiceFixture({ status: "cancelled" }),
    linkedOrder: orderFixture(),
    send: async () => {
      sendCount += 1;
      return { status: "sent" as const };
    },
    finalize: async () => undefined,
  }));
  assert.equal(sendCount, 0);
});

test("conflit facture expose HTTP 409 et code synthetique", () => {
  try {
    const block = invoiceSendBlock(invoiceFixture({ status: "cancelled" }), orderFixture());
    if (block) throw new InvoiceSendConflictError(block.code, block.message);
    assert.fail("conflit attendu");
  } catch (error) {
    assert.ok(error instanceof InvoiceSendConflictError);
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, "invoice_cancelled");
    assert.match(error.message, /Facture annulee/);
  }
});

test("bouton Admin desactive et indication affichee", () => {
  const source = readFileSync(resolve(process.cwd(), "src/pages/admin/AdminPage.tsx"), "utf8");
  assert.match(source, /disabled=\{Boolean\(sendBlock\)\}/);
  assert.match(source, /Facture annulée — envoi indisponible/);
});

test("coupon principal restaure", async () => {
  const db = cancellationDatabase(orderFixture({ promoId: "welcome10" }), { welcome10: 3 });
  await cancel(db);
  assert.equal(db.documents.get("coupons/welcome10")?.usedCount, 2);
});

test("promoId canonique prevaut sur le libelle couponCode", () => {
  assert.deepEqual(
    promotionIdsForRestoration(orderFixture({ promoId: "coupon-save", couponCode: "SAVE" })),
    ["coupon-save"],
  );
});

test("promotion automatique restauree", async () => {
  const order = orderFixture({ promoId: undefined, couponCode: undefined, promoCode: undefined, appliedPromotions: [promotion("auto-1")] });
  const db = cancellationDatabase(order, { "auto-1": 2 });
  await cancel(db);
  assert.equal(db.documents.get("coupons/auto-1")?.usedCount, 1);
});

test("FLEURS20 dans appliedPromotions restaure", async () => {
  const db = cancellationDatabase(orderFixture({ promoId: undefined, appliedPromotions: [promotion("fleurs20")] }), { fleurs20: 1 });
  await cancel(db);
  assert.equal(db.documents.get("coupons/fleurs20")?.usedCount, 0);
});

test("coupon principal duplique dans appliedPromotions restaure une fois", async () => {
  const order = orderFixture({ promoId: "same", couponCode: "SAME", appliedPromotions: [promotion("same"), promotion("SAME")] });
  assert.deepEqual(promotionIdsForRestoration(order), ["same"]);
  const db = cancellationDatabase(order, { same: 4 });
  await cancel(db);
  assert.equal(db.documents.get("coupons/same")?.usedCount, 3);
  assert.equal(db.writeCount("coupons/same"), 1);
});

test("plusieurs promotions uniques restaurees", async () => {
  const order = orderFixture({ promoId: "main", appliedPromotions: [promotion("auto-a"), promotion("auto-b")] });
  const db = cancellationDatabase(order, { main: 2, "auto-a": 2, "auto-b": 2 });
  await cancel(db);
  assert.deepEqual((db.documents.get("orders/order-1")?.restoredPromotionIds as string[]).sort(), ["auto-a", "auto-b", "main"]);
});

test("annulation repetee sans second decrement", async () => {
  const db = cancellationDatabase(orderFixture({ promoId: "once" }), { once: 2 });
  await cancel(db);
  await cancel(db);
  assert.equal(db.documents.get("coupons/once")?.usedCount, 1);
  assert.equal(db.writeCount("coupons/once"), 1);
});

test("compteur ne passe jamais sous zero", () => {
  assert.equal(nextRestoredCouponUsedCount(0), 0);
  assert.equal(nextRestoredCouponUsedCount(-4), 0);
});

test("coupon introuvable non recree et trace", async () => {
  const db = cancellationDatabase(orderFixture({ promoId: "missing" }), {});
  await cancel(db);
  assert.equal(db.documents.has("coupons/missing"), false);
  assert.deepEqual(db.documents.get("orders/order-1")?.missingPromotionIds, ["missing"]);
});

test("coupon archive restaure sans modifier son contenu", async () => {
  const db = cancellationDatabase(orderFixture({ promoId: "archived" }), {});
  db.seed("coupons/archived", { usedCount: 2, isActive: false, isArchived: true, maxUses: 10, label: "Archivee" });
  await cancel(db);
  assert.deepEqual(db.documents.get("coupons/archived"), { usedCount: 1, isActive: false, isArchived: true, maxUses: 10, label: "Archivee" });
});

test("ancienne commande sans appliedPromotions restauree", async () => {
  const order = orderFixture({ promoId: undefined, couponCode: "LEGACY", appliedPromotions: undefined });
  const db = cancellationDatabase(order, { legacy: 1 });
  await cancel(db);
  assert.equal(db.documents.get("coupons/legacy")?.usedCount, 0);
});

test("stock et facture sont annules dans la meme transaction", async () => {
  const db = cancellationDatabase(orderFixture({ promoId: undefined, invoiceId: "invoice-1" }), {});
  db.seed("invoices/invoice-1", invoiceFixture({ status: "sent" }) as unknown as StoredDocument);
  await cancel(db);
  assert.equal(db.documents.get("invoices/invoice-1")?.status, "cancelled");
  assert.ok(db.documents.get("orders/order-1")?.stockRestoredAt);
  assert.equal((db.documents.get("orders/order-1")?.linkedInvoiceCancellation as StoredDocument).status, "cancelled");
});

test("transaction echouee sans etat partiel", async () => {
  const db = cancellationDatabase(orderFixture({ promoId: "atomic" }), { atomic: 2 });
  await assert.rejects(db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(db.collection("orders").doc("order-1"));
    const order = { id: snapshot.id, ...snapshot.data() } as Order;
    const result = await applyOrderCancellationInTransaction({
      db: db as unknown as FirebaseFirestore.Firestore,
      transaction: transaction as unknown as FirebaseFirestore.Transaction,
      order,
      adminUid: "admin-uid",
      now: "2026-08-02T10:00:00.000Z",
    });
    transaction.update(db.collection("orders").doc(order.id), result.orderUpdate);
    throw new Error("injected transaction failure");
  }));
  assert.equal(db.documents.get("coupons/atomic")?.usedCount, 2);
  assert.equal(db.documents.get("orders/order-1")?.stockRestoredAt, undefined);
  assert.equal(db.writes.length, 0);
});

test("facture deja annulee ne subit pas une seconde ecriture", async () => {
  const db = cancellationDatabase(orderFixture({ promoId: undefined, invoiceId: "invoice-1" }), {});
  db.seed("invoices/invoice-1", invoiceFixture({ status: "cancelled" }) as unknown as StoredDocument);
  await cancel(db);
  assert.equal(db.writeCount("invoices/invoice-1"), 0);
});

for (const entry of tests) {
  await entry.run();
  console.log(`ok - ${entry.name}`);
}
console.log(`${tests.length} order cancellation and invoice guard tests passed.`);

async function cancel(db: FakeFirestore) {
  return db.runTransaction(async (transaction) => {
    const orderReference = db.collection("orders").doc("order-1");
    const snapshot = await transaction.get(orderReference);
    const order = { id: snapshot.id, ...snapshot.data() } as Order;
    const result = await applyOrderCancellationInTransaction({
      db: db as unknown as FirebaseFirestore.Firestore,
      transaction: transaction as unknown as FirebaseFirestore.Transaction,
      order,
      adminUid: "admin-uid",
      now: "2026-08-02T10:00:00.000Z",
    });
    transaction.update(orderReference, {
      ...result.orderUpdate,
      orderStatus: "cancelled",
    });
    return result;
  });
}

function cancellationDatabase(order: Order, coupons: Record<string, number>) {
  const db = new FakeFirestore();
  db.seed("orders/order-1", order as unknown as StoredDocument);
  db.seed("products/product-1", { stock: 5 });
  for (const [id, usedCount] of Object.entries(coupons)) {
    db.seed(`coupons/${id}`, { usedCount });
  }
  return db;
}

function invoiceDatabase() {
  const db = new FakeFirestore();
  db.seed("invoices/invoice-1", invoiceFixture() as unknown as StoredDocument);
  db.seed("orders/order-1", orderFixture() as unknown as StoredDocument);
  return db;
}

function promotion(couponId: string) {
  return {
    id: `promotion-${couponId}`,
    couponId,
    label: couponId,
    type: "fixed_cart_discount" as const,
    applicationMode: "automatic" as const,
    discountAmount: 5,
  };
}

function invoiceFixture(patch: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    invoiceNumber: "VER-2026-TEST",
    orderId: "order-1",
    origin: "order",
    status: "draft",
    customerName: "Client test",
    customerEmail: "client@example.test",
    lines: [],
    subtotal: 20,
    deliveryFee: 0,
    discountAmount: 0,
    total: 20,
    paymentStatus: "to_confirm",
    createdAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
    ...patch,
  };
}

function orderFixture(patch: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    customerEmail: "client@example.test",
    customerPhone: "0000000000",
    items: [{ productId: "product-1", name: "Produit", quantity: 1, unitPrice: 20 }],
    subtotal: 20,
    deliveryFee: 0,
    total: 20,
    paymentStatus: "to_confirm",
    orderStatus: "confirmed",
    deliveryMethod: "local_express",
    deliveryAddress: {
      firstName: "Client",
      lastName: "Test",
      line1: "Adresse test",
      postalCode: "13000",
      city: "Aix-en-Provence",
      country: "France",
    },
    createdAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
    ...patch,
  };
}
