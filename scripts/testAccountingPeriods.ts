import assert from "node:assert/strict";
import {
  accountingDateInPeriod,
  currentAccountingPeriodRange,
  customAccountingPeriodRange,
  formatAccountingPeriodLabel,
  orderCreatedDate,
  orderPaymentDate,
  orderReceivableDate,
  parseAccountingDateInput,
  previousAccountingPeriodRange,
  supplierPurchaseAccountingDate,
} from "../src/lib/accountingPeriods.js";
import { buildAccountingSummary } from "../src/lib/accountingSummary.js";
import type { WeightedSupplierCost } from "../src/lib/accountingCosts.js";
import type { AdminOrderRow } from "../src/services/ordersService.js";
import type { Product, ProductCost, SupplierPurchase } from "../src/types/index.js";

let assertions = 0;

function check(actual: unknown, expected: unknown, message: string) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function checkThrows(callback: () => unknown, message: string) {
  assert.throws(callback, undefined, message);
  assertions += 1;
}

const augustNow = new Date("2026-08-01T12:00:00.000Z");
const augustMonth = currentAccountingPeriodRange("month", undefined, undefined, augustNow);
check(augustMonth.start.toISOString(), "2026-07-31T22:00:00.000Z", "August starts at Paris midnight");
check(augustMonth.end.toISOString(), "2026-08-31T22:00:00.000Z", "August has an exclusive Paris end");
check(formatAccountingPeriodLabel(augustMonth), "01/08/2026 – 31/08/2026 · Europe/Paris", "The visible period names the timezone");

const augustWeek = currentAccountingPeriodRange("week", undefined, undefined, augustNow);
check(augustWeek.civilStart, { year: 2026, month: 7, day: 27 }, "A week can cross a month boundary");
check(augustWeek.civilEndExclusive, { year: 2026, month: 8, day: 3 }, "Week end remains exclusive");

const newYearWeek = currentAccountingPeriodRange(
  "week",
  undefined,
  undefined,
  new Date("2027-01-01T12:00:00.000Z"),
);
check(newYearWeek.civilStart, { year: 2026, month: 12, day: 28 }, "A week can cross a year boundary");
check(newYearWeek.civilEndExclusive, { year: 2027, month: 1, day: 4 }, "Cross-year week has seven civil days");

const julyMonth = previousAccountingPeriodRange(augustMonth);
check(julyMonth.civilStart, { year: 2026, month: 7, day: 1 }, "Previous month is a calendar month");
check(julyMonth.civilEndExclusive, { year: 2026, month: 8, day: 1 }, "Previous month ends at current month start");

const year2026 = currentAccountingPeriodRange("year", undefined, undefined, augustNow);
const year2025 = previousAccountingPeriodRange(year2026);
check(year2025.civilStart, { year: 2025, month: 1, day: 1 }, "Previous year is a calendar year");
check(year2025.civilEndExclusive, { year: 2026, month: 1, day: 1 }, "Previous year has an exclusive end");

const springDstWeek = currentAccountingPeriodRange(
  "week",
  undefined,
  undefined,
  new Date("2026-03-25T12:00:00.000Z"),
);
check((springDstWeek.end.getTime() - springDstWeek.start.getTime()) / 3_600_000, 167, "Spring DST week has 167 elapsed hours");
const autumnDstWeek = currentAccountingPeriodRange(
  "week",
  undefined,
  undefined,
  new Date("2026-10-21T12:00:00.000Z"),
);
check((autumnDstWeek.end.getTime() - autumnDstWeek.start.getTime()) / 3_600_000, 169, "Autumn DST week has 169 elapsed hours");

check(accountingDateInPeriod(augustMonth.start, augustMonth), true, "Period start is included");
check(accountingDateInPeriod(augustMonth.end, augustMonth), false, "Period end is excluded");
check(accountingDateInPeriod(new Date(augustMonth.end.getTime() - 1), augustMonth), true, "Last millisecond is included");

const oneDay = customAccountingPeriodRange("2026-08-15", "2026-08-15");
check((oneDay.end.getTime() - oneDay.start.getTime()) / 3_600_000, 24, "One custom summer day has 24 hours");
checkThrows(() => customAccountingPeriodRange("2026-08-20", "2026-08-19"), "Inverted custom dates are rejected");
checkThrows(() => customAccountingPeriodRange("", "2026-08-19"), "Missing custom dates are rejected");
check(parseAccountingDateInput("2026-02-30"), null, "Invalid civil dates are rejected");
const leapFebruary = currentAccountingPeriodRange(
  "month",
  undefined,
  undefined,
  new Date("2028-02-10T12:00:00.000Z"),
);
check(leapFebruary.civilEndExclusive, { year: 2028, month: 3, day: 1 }, "Leap February is handled as a calendar month");

const movingOrder = orderFixture({
  id: "MOVING-ORDER",
  createdAt: "2026-07-07T18:20:24.819Z",
  updatedAt: "2026-08-01T16:22:45.873Z",
});
check(orderCreatedDate(movingOrder)?.toISOString(), "2026-07-07T18:20:24.819Z", "createdAt is not replaced by updatedAt");
check(orderReceivableDate(movingOrder)?.toISOString(), "2026-07-07T18:20:24.819Z", "Receivable attribution uses createdAt");

check(orderPaymentDate({ paymentConfirmedAt: "2026-08-02T10:00:00.000Z" }).quality, "exact", "paymentConfirmedAt is exact");
check(orderPaymentDate({ paidAt: "2026-08-03T10:00:00.000Z" }).quality, "legacy_explicit", "paidAt is an explicit legacy date");
check(orderPaymentDate({ updatedAt: "2026-08-04T10:00:00.000Z" }).quality, "legacy_estimated", "updatedAt is visibly estimated");
check(orderPaymentDate({ createdAt: "2026-08-05T10:00:00.000Z" }).source, "createdAt", "createdAt is the final historical fallback");
check(orderPaymentDate({}).quality, "missing", "Missing payment dates remain missing");

check(supplierPurchaseAccountingDate({ validatedAt: "2026-08-05T10:00:00.000Z", invoiceDate: "2026-07-01" }).source, "validatedAt", "Supplier validation date has priority");
check(supplierPurchaseAccountingDate({ invoiceDate: "2026-07-01" }).source, "invoiceDate", "Supplier invoice date is the signaled fallback");

const product = productFixture();
const weightedCosts = new Map<string, WeightedSupplierCost>([
  [product.id, { productId: product.id, totalQuantityGrams: 100, totalCost: 225, weightedCostPerGram: 2.25 }],
]);
const productCosts = new Map<string, ProductCost>();
const exactPaid = orderFixture({
  id: "EXACT-PAID",
  paymentStatus: "paid",
  createdAt: "2026-07-28T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  paymentConfirmedAt: "2026-08-02T10:00:00.000Z",
});
const futurePaid = orderFixture({
  id: "FUTURE-PAID",
  paymentStatus: "paid",
  createdAt: "2026-08-03T10:00:00.000Z",
  paymentConfirmedAt: "2026-09-03T10:00:00.000Z",
});
const periodReceivable = orderFixture({
  id: "PERIOD-RECEIVABLE",
  paymentStatus: "pending",
  createdAt: "2026-08-04T10:00:00.000Z",
  updatedAt: "2026-10-04T10:00:00.000Z",
  total: "40,00 EUR",
});
const oldReceivable = orderFixture({
  id: "OLD-RECEIVABLE",
  paymentStatus: "payment_link_sent",
  createdAt: "2026-07-04T10:00:00.000Z",
  total: "30,00 EUR",
});
const cancelled = orderFixture({
  id: "CANCELLED",
  paymentStatus: "cancelled",
  orderStatus: "cancelled",
  createdAt: "2026-08-05T10:00:00.000Z",
  total: "999,00 EUR",
});
const deleted = orderFixture({
  id: "DELETED",
  paymentStatus: "paid",
  paymentConfirmedAt: "2026-08-06T10:00:00.000Z",
  createdAt: "2026-08-06T09:00:00.000Z",
  deletedAt: "2026-08-07T10:00:00.000Z",
  total: "999,00 EUR",
});
const supplierValidated = supplierFixture({
  id: "SUPPLIER-VALIDATED",
  invoiceDate: "2026-07-15",
  validatedAt: "2026-08-05T10:00:00.000Z",
  totalExVat: 100,
});
const supplierFallback = supplierFixture({
  id: "SUPPLIER-FALLBACK",
  invoiceDate: "2026-08-06",
  validatedAt: undefined,
  totalExVat: 50,
});
const supplierMissing = supplierFixture({
  id: "SUPPLIER-MISSING",
  invoiceDate: "",
  validatedAt: undefined,
  totalExVat: 500,
});

const summary = buildAccountingSummary(
  [exactPaid, futurePaid, periodReceivable, oldReceivable, cancelled, deleted],
  [product],
  productCosts,
  [supplierValidated, supplierFallback, supplierMissing],
  weightedCosts,
  augustMonth,
);
check(summary.createdOrdersCount, 2, "Creation metrics use createdAt and exclude cancelled/deleted orders");
check(summary.paidOrdersCount, 1, "Paid metrics use the payment date");
check(summary.collectedRevenue, 71.55, "Paid revenue is attributed once to the payment period");
check(summary.productNetRevenue, 71.55, "Product revenue remains exact");
check(summary.estimatedProductCost, 22.5, "Frozen product cost remains exact");
check(summary.grossMargin, 49.05, "Gross margin is rounded to cents");
check(summary.receivableAmount, 40, "Period receivable uses order creation date");
check(summary.currentReceivableAmount, 70, "Current receivable is global and period-independent");
check(summary.localOrders, 2, "Delivery mix follows orders created in the period");
check(summary.supplierPurchasesTotal, 150, "Supplier purchases follow validation date then invoice fallback");
check(summary.supplierPurchaseFallbackCount, 1, "Supplier fallback dates are counted");
check(summary.supplierPurchaseMissingDateCount, 1, "Missing supplier dates are counted");
check(summary.estimatedStockValue, 22.5, "Current stock remains a current snapshot");
check(Object.hasOwn(summary.comparisonValues, "estimatedStockValue"), false, "Current stock is not a historical comparison metric");

const legacySummary = buildAccountingSummary(
  [
    orderFixture({ id: "EXACT", paymentStatus: "paid", paymentConfirmedAt: "2026-08-01T10:00:00.000Z" }),
    orderFixture({ id: "EXPLICIT", paymentStatus: "paid", paidAt: "2026-08-02T10:00:00.000Z" }),
    orderFixture({ id: "ESTIMATE", paymentStatus: "paid", updatedAt: "2026-08-03T10:00:00.000Z" }),
    orderFixture({ id: "FALLBACK", paymentStatus: "paid", updatedAt: undefined, createdAt: "2026-08-04T10:00:00.000Z" }),
    orderFixture({ id: "MISSING", paymentStatus: "paid", updatedAt: undefined, createdAt: undefined }),
  ],
  [product],
  productCosts,
  [],
  weightedCosts,
  augustMonth,
);
check(legacySummary.paymentDateQualityCounts, { exact: 1, legacy_explicit: 1, legacy_estimated: 2, missing: 1 }, "Payment date quality is explicit and auditable");
check(legacySummary.historicalPaymentDateIssues.map((issue) => issue.orderId), ["ESTIMATE", "FALLBACK", "MISSING"], "Historical warnings expose only abbreviated identifiers");
check(legacySummary.paidOrdersCount, 4, "A missing date cannot be silently assigned to a period");

console.log(`Accounting period and date tests passed (${assertions} assertions).`);

function orderFixture(overrides: Partial<AdminOrderRow> = {}): AdminOrderRow {
  return {
    id: "ORDER-1",
    customer: "Client test",
    paymentStatus: "to_confirm",
    orderStatus: "confirmed",
    deliveryMethod: "local_express",
    delivery: "Local",
    items: [
      {
        productId: "product-1",
        name: "Produit",
        quantity: 10,
        unitPrice: 7.95,
        lineTotal: 79.5,
        purchasePricePerGramSnapshot: 2.25,
        purchaseCostTotalSnapshot: 22.5,
        purchaseCostCapturedAt: "2026-07-25T10:00:00.000Z",
        purchaseCostSource: "supplier_weighted",
      },
    ],
    subtotalBeforePromotion: 79.5,
    subtotalAfterPromotion: 71.55,
    promotionDiscountTotal: 7.95,
    deliveryFee: 0,
    total: "71,55 EUR",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function productFixture(): Product {
  return {
    id: "product-1",
    slug: "produit",
    name: "Produit",
    category: "Fleur CBD",
    price: 7.95,
    shortDescription: "Produit de test comptable",
    longDescription: "Produit de test comptable",
    image: "/product.webp",
    cbdRate: "10%",
    cbgRate: "0%",
    thcRate: "<0,3%",
    origin: "France",
    cultureType: "Indoor",
    aromas: [],
    tags: [],
    stock: 10,
    lowStockThreshold: 2,
    isActive: true,
    isFeatured: false,
    seoTitle: "Produit",
    seoDescription: "Produit",
  };
}

function supplierFixture(overrides: Partial<SupplierPurchase> = {}): SupplierPurchase {
  return {
    id: "SUPPLIER-1",
    supplierName: "Fournisseur",
    invoiceNumber: "FAC-1",
    invoiceDate: "2026-08-01",
    paidLinesGrossAmountExVat: 100,
    globalDiscountExVat: 0,
    shippingExVat: 0,
    vatRate: 20,
    vatAmount: 20,
    totalExVat: 100,
    totalIncVat: 120,
    costBase: "HT",
    status: "validated",
    lines: [],
    ...overrides,
  };
}
