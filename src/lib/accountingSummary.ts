import type { AdminOrderRow } from "../services/ordersService.js";
import type { Product, ProductCost, SupplierPurchase } from "../types/index.js";
import {
  estimateStockValue,
  resolveOrderItemPurchaseCost,
  type WeightedSupplierCost,
} from "./accountingCosts.js";
import {
  accountingDateInPeriod,
  formatAccountingPeriodLabel,
  orderCreatedDate,
  orderPaymentDate,
  orderReceivableDate,
  supplierPurchaseAccountingDate,
  type AccountingDateQuality,
  type AccountingPeriodRange,
} from "./accountingPeriods.js";
import { orderItemLineTotal } from "./orderLineDisplay.js";

export type AccountingMetricKey =
  | "collectedRevenue"
  | "createdOrdersCount"
  | "paidOrdersCount"
  | "estimatedProductCost"
  | "grossMargin"
  | "supplierPurchasesTotal";

export type AccountingProductRow = {
  productId: string;
  productName: string;
  quantitySold: number;
  productNetRevenue: number;
  purchaseCost: number;
  grossMargin: number;
  grossMarkupRate: number | null;
  grossMarginRate: number | null;
  hasEstimatedCost: boolean;
  hasMissingCost: boolean;
  costSources: Set<string>;
};

export type HistoricalPaymentDateIssue = {
  orderId: string;
  quality: "legacy_estimated" | "missing";
  source: "updatedAt" | "createdAt" | "missing";
};

const receivablePaymentStatuses = new Set([
  "to_confirm",
  "payment_link_sent",
  "pending",
]);

export function buildAccountingSummary(
  orders: AdminOrderRow[],
  products: Product[],
  productCostMap: Map<string, ProductCost>,
  supplierPurchases: SupplierPurchase[],
  weightedSupplierCosts: Map<string, WeightedSupplierCost>,
  range: AccountingPeriodRange,
) {
  const eligibleOrders = orders.filter((order) => !isCancelledOrDeletedOrder(order));
  const createdOrdersInPeriod = eligibleOrders.filter((order) =>
    accountingDateInPeriod(orderCreatedDate(order), range),
  );
  const paidOrderDateEntries = eligibleOrders
    .filter((order) => order.paymentStatus === "paid")
    .map((order) => ({ order, paymentDate: orderPaymentDate(order) }));
  const paidOrdersInPeriod = paidOrderDateEntries
    .filter((entry) => accountingDateInPeriod(entry.paymentDate.date, range))
    .map((entry) => entry.order);
  const receivableOrdersCreatedInPeriod = eligibleOrders.filter(
    (order) =>
      receivablePaymentStatuses.has(order.paymentStatus) &&
      accountingDateInPeriod(orderReceivableDate(order), range),
  );
  const currentReceivableOrders = eligibleOrders.filter((order) =>
    receivablePaymentStatuses.has(order.paymentStatus),
  );
  const supplierPurchaseDateEntries = supplierPurchases
    .filter((purchase) => purchase.status === "validated")
    .map((purchase) => ({
      purchase,
      accountingDate: supplierPurchaseAccountingDate(purchase),
    }));
  const supplierPurchasesInPeriod = supplierPurchaseDateEntries
    .filter((entry) => accountingDateInPeriod(entry.accountingDate.date, range))
    .map((entry) => entry.purchase);

  const supplierPurchasesTotal = supplierPurchasesInPeriod.reduce(
    (sum, purchase) => sum + Number(purchase.totalExVat || 0),
    0,
  );
  const supplierPurchaseFallbackCount = supplierPurchaseDateEntries.filter(
    (entry) =>
      entry.accountingDate.quality === "legacy_estimated" &&
      accountingDateInPeriod(entry.accountingDate.date, range),
  ).length;
  const supplierPurchaseMissingDateCount = supplierPurchaseDateEntries.filter(
    (entry) => entry.accountingDate.quality === "missing",
  ).length;
  const estimatedStockValue = estimateStockValue(products, weightedSupplierCosts);
  const collectedRevenue = paidOrdersInPeriod.reduce(
    (sum, order) => sum + orderTotalAmount(order),
    0,
  );
  const receivableAmount = receivableOrdersCreatedInPeriod.reduce(
    (sum, order) => sum + orderTotalAmount(order),
    0,
  );
  const currentReceivableAmount = currentReceivableOrders.reduce(
    (sum, order) => sum + orderTotalAmount(order),
    0,
  );
  const discounts = paidOrdersInPeriod.reduce(
    (sum, order) => sum + orderDiscountAmount(order),
    0,
  );
  const productNetRevenue = paidOrdersInPeriod.reduce(
    (sum, order) => sum + orderProductNetRevenue(order),
    0,
  );
  const deliveryRevenue = paidOrdersInPeriod.reduce(
    (sum, order) => sum + Number(order.deliveryFee || 0),
    0,
  );
  const missingCostIds = new Set<string>();
  const productRowsById = new Map<string, AccountingProductRow>();
  const productNameById = new Map(products.map((product) => [product.id, product.name]));
  let hasUnfrozenHistoricalCosts = false;
  let estimatedProductCost = 0;

  paidOrdersInPeriod.forEach((order) => {
    const orderProductRevenue = orderProductNetRevenue(order);
    const grossLinesTotal = order.items.reduce(
      (sum, item) => sum + orderItemLineTotal(item),
      0,
    );

    order.items.forEach((item) => {
      const quantity = Number(item.quantity || 0);
      const grossLineRevenue = orderItemLineTotal(item);
      const lineProductNetRevenue =
        grossLinesTotal > 0
          ? orderProductRevenue * (grossLineRevenue / grossLinesTotal)
          : 0;
      const costResult = resolveOrderItemPurchaseCost(
        item,
        weightedSupplierCosts,
        productCostMap,
      );

      if (costResult.status === "missing") missingCostIds.add(item.productId);
      if (costResult.status === "estimated") hasUnfrozenHistoricalCosts = true;
      estimatedProductCost += costResult.cost;

      const existing = productRowsById.get(item.productId) ?? {
        productId: item.productId,
        productName: productNameById.get(item.productId) || item.name || item.productId,
        quantitySold: 0,
        productNetRevenue: 0,
        purchaseCost: 0,
        grossMargin: 0,
        grossMarkupRate: null,
        grossMarginRate: null,
        hasEstimatedCost: false,
        hasMissingCost: false,
        costSources: new Set<string>(),
      };
      existing.quantitySold += quantity;
      existing.productNetRevenue += lineProductNetRevenue;
      existing.purchaseCost += costResult.cost;
      existing.hasEstimatedCost ||= costResult.status === "estimated";
      existing.hasMissingCost ||= costResult.status === "missing";
      if (costResult.source) existing.costSources.add(costResult.source);
      productRowsById.set(item.productId, existing);
    });
  });

  const grossMargin = productNetRevenue - estimatedProductCost;
  const grossMarkupRate = productNetRevenue > 0 ? grossMargin / productNetRevenue : null;
  const grossMarginRate = estimatedProductCost > 0 ? grossMargin / estimatedProductCost : null;
  const localOrders = createdOrdersInPeriod.filter(
    (order) => order.deliveryMethod === "local_express",
  ).length;
  const postalOrders = createdOrdersInPeriod.filter(
    (order) => order.deliveryMethod === "postal",
  ).length;
  const missingCostProducts = [...missingCostIds].map(
    (productId) => productNameById.get(productId) || productId,
  );
  const productRows = [...productRowsById.values()]
    .map((row) => {
      const productGrossMargin = row.productNetRevenue - row.purchaseCost;
      return {
        ...row,
        quantitySold: roundAccounting(row.quantitySold),
        productNetRevenue: roundAccounting(row.productNetRevenue),
        purchaseCost: roundAccounting(row.purchaseCost),
        grossMargin: roundAccounting(productGrossMargin),
        grossMarkupRate:
          row.hasMissingCost || row.productNetRevenue <= 0
            ? null
            : productGrossMargin / row.productNetRevenue,
        grossMarginRate:
          row.hasMissingCost || row.purchaseCost <= 0
            ? null
            : productGrossMargin / row.purchaseCost,
      };
    })
    .sort((left, right) => right.productNetRevenue - left.productNetRevenue);
  const paymentDateQualityCounts = paymentDateQualitySummary(paidOrderDateEntries);
  const historicalPaymentDateIssues = paidOrderDateEntries
    .filter(
      (entry): entry is typeof entry & {
        paymentDate: typeof entry.paymentDate & {
          quality: "legacy_estimated" | "missing";
          source: "updatedAt" | "createdAt" | "missing";
        };
      } =>
        entry.paymentDate.quality === "legacy_estimated" ||
        entry.paymentDate.quality === "missing",
    )
    .map((entry) => ({
      orderId: abbreviateAccountingOrderId(entry.order.id),
      quality: entry.paymentDate.quality,
      source: entry.paymentDate.source,
    }));
  const comparisonValues: Record<AccountingMetricKey, number> = {
    collectedRevenue: roundAccounting(collectedRevenue),
    createdOrdersCount: createdOrdersInPeriod.length,
    paidOrdersCount: paidOrdersInPeriod.length,
    estimatedProductCost: roundAccounting(estimatedProductCost),
    grossMargin: roundAccounting(grossMargin),
    supplierPurchasesTotal: roundAccounting(supplierPurchasesTotal),
  };

  return {
    periodLabel: formatAccountingPeriodLabel(range),
    createdOrdersInPeriod,
    paidOrdersInPeriod,
    receivableOrdersCreatedInPeriod,
    currentReceivableOrders,
    supplierPurchasesInPeriod,
    createdOrdersCount: createdOrdersInPeriod.length,
    paidOrdersCount: paidOrdersInPeriod.length,
    receivableOrdersCreatedInPeriodCount: receivableOrdersCreatedInPeriod.length,
    currentReceivableOrdersCount: currentReceivableOrders.length,
    collectedRevenue: roundAccounting(collectedRevenue),
    receivableAmount: roundAccounting(receivableAmount),
    currentReceivableAmount: roundAccounting(currentReceivableAmount),
    discounts: roundAccounting(discounts),
    productNetRevenue: roundAccounting(productNetRevenue),
    deliveryRevenue: roundAccounting(deliveryRevenue),
    supplierPurchasesTotal: roundAccounting(supplierPurchasesTotal),
    supplierPurchaseFallbackCount,
    supplierPurchaseMissingDateCount,
    estimatedProductCost: roundAccounting(estimatedProductCost),
    estimatedStockValue,
    grossMargin: roundAccounting(grossMargin),
    grossMarkupRate,
    grossMarginRate,
    averagePaidOrder: roundAccounting(
      paidOrdersInPeriod.length ? collectedRevenue / paidOrdersInPeriod.length : 0,
    ),
    localOrders,
    postalOrders,
    missingCostProducts,
    hasUnfrozenHistoricalCosts,
    productRows,
    paymentDateQualityCounts,
    historicalPaymentDateIssues,
    comparisonValues,
  };
}

function paymentDateQualitySummary(
  entries: Array<{ paymentDate: { quality: AccountingDateQuality } }>,
) {
  const counts: Record<AccountingDateQuality, number> = {
    exact: 0,
    legacy_explicit: 0,
    legacy_estimated: 0,
    missing: 0,
  };
  entries.forEach((entry) => {
    counts[entry.paymentDate.quality] += 1;
  });
  return counts;
}

function isCancelledOrDeletedOrder(order: AdminOrderRow) {
  return (
    order.orderStatus === "cancelled" ||
    order.paymentStatus === "cancelled" ||
    Boolean(order.deletedAt)
  );
}

function orderTotalAmount(order: AdminOrderRow) {
  if (typeof order.total === "number") return Number(order.total || 0);
  const normalized = String(order.total || "")
    .replace(/\s/g, "")
    .replace("EUR", "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderDiscountAmount(order: AdminOrderRow) {
  return Number(order.discountAmount ?? order.promotionDiscountTotal ?? 0);
}

function orderProductNetRevenue(order: AdminOrderRow) {
  const subtotalAfterPromotion = Number(order.subtotalAfterPromotion);
  if (Number.isFinite(subtotalAfterPromotion) && subtotalAfterPromotion > 0) {
    return subtotalAfterPromotion;
  }
  const subtotal = Number(
    order.subtotalBeforePromotion ??
      order.subtotalBeforeDiscount ??
      order.subtotal ??
      0,
  );
  if (Number.isFinite(subtotal) && subtotal > 0) {
    return Math.max(0, subtotal - orderDiscountAmount(order));
  }
  return Math.max(0, orderTotalAmount(order) - Number(order.deliveryFee || 0));
}

function abbreviateAccountingOrderId(value: string) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, 8).toUpperCase() : "INCONNUE";
}

function roundAccounting(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
