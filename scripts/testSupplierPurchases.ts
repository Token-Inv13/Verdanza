import assert from "node:assert/strict";
import {
  allocateProportionally,
  computeWeightedSupplierCosts,
  computeWeightedSupplierCostsAsOf,
  estimateStockValue,
  normalizeSupplierPurchaseInput,
  resolveOrderItemPurchaseCost,
} from "../src/lib/accountingCosts";

const allocations = allocateProportionally(10, [30, 70]);
assert.deepEqual(allocations, [3, 7]);
assert.equal(allocations.reduce((sum, value) => sum + value, 0), 10);

const purchase = normalizeSupplierPurchaseInput({
  supplierName: "Grossiste",
  invoiceNumber: "FAC-1",
  invoiceDate: "2026-07-25",
  globalDiscountExVat: 10,
  shippingExVat: 5,
  vatRate: 20,
  costBase: "HT",
  status: "validated",
  lines: [
    {
      id: "line-1",
      productId: "amnesia",
      quantityGrams: 100,
      grossAmountExVat: 100,
      vatRate: 20,
      lineDiscountAmount: 5,
    },
    {
      id: "line-2",
      productId: "blue-dream",
      quantityGrams: 50,
      grossAmountExVat: 50,
      vatRate: 20,
      lineDiscountAmount: 0,
    },
  ],
});

assert.equal(purchase.lines?.[0].allocatedGlobalDiscount, 6.67);
assert.equal(purchase.lines?.[1].allocatedGlobalDiscount, 3.33);
assert.equal(purchase.lines?.[0].allocatedShipping, 3.33);
assert.equal(purchase.lines?.[1].allocatedShipping, 1.67);
assert.equal(purchase.lines?.[0].netCostAmount, 91.66);
assert.equal(purchase.lines?.[1].netCostAmount, 48.34);

const weighted = computeWeightedSupplierCosts([
  purchase,
  {
    ...purchase,
    id: "draft",
    status: "draft",
    lines: [{ id: "draft", productId: "amnesia", quantityGrams: 999, netCostAmount: 999 }],
  },
  {
    ...purchase,
    id: "cancelled",
    status: "cancelled",
    lines: [{ id: "cancelled", productId: "amnesia", quantityGrams: 999, netCostAmount: 999 }],
  },
]);

assert.equal(weighted.costByProductId.get("amnesia")?.weightedCostPerGram, 0.9166);
assert.equal(weighted.costByProductId.get("blue-dream")?.weightedCostPerGram, 0.9668);
assert.equal(weighted.costByProductId.get("draft"), undefined);

const laterPurchase = normalizeSupplierPurchaseInput({
  ...purchase,
  invoiceNumber: "FAC-2",
  invoiceDate: "2026-08-01",
  lines: [
    {
      id: "line-later",
      productId: "amnesia",
      quantityGrams: 100,
      grossAmountExVat: 300,
      vatRate: 20,
      lineDiscountAmount: 0,
    },
  ],
});
const weightedAsOfPayment = computeWeightedSupplierCostsAsOf(
  [purchase, laterPurchase],
  "2026-07-26T10:00:00.000Z",
);
assert.equal(weightedAsOfPayment.costByProductId.get("amnesia")?.weightedCostPerGram, 0.9166);
const weightedAfterLaterPurchase = computeWeightedSupplierCostsAsOf(
  [purchase, laterPurchase],
  "2026-08-02T10:00:00.000Z",
);
assert.notEqual(
  weightedAfterLaterPurchase.costByProductId.get("amnesia")?.weightedCostPerGram,
  weightedAsOfPayment.costByProductId.get("amnesia")?.weightedCostPerGram,
);

const manualCosts = new Map([
  ["amnesia", { purchasePricePerGram: 0.2 }],
  ["resine", { purchasePricePerGram: 1.5 }],
]);
const supplierCost = resolveOrderItemPurchaseCost(
  { productId: "amnesia", quantity: 10 },
  weighted.costByProductId,
  manualCosts,
);
assert.equal(supplierCost.source, "supplier_weighted");
assert.equal(supplierCost.cost, 9.17);

const manualCost = resolveOrderItemPurchaseCost(
  { productId: "resine", quantity: 4 },
  weighted.costByProductId,
  manualCosts,
);
assert.equal(manualCost.source, "manual_fallback");
assert.equal(manualCost.cost, 6);

const fixedCost = resolveOrderItemPurchaseCost(
  {
    productId: "amnesia",
    quantity: 10,
    purchasePricePerGramSnapshot: 0.5,
    purchaseCostTotalSnapshot: 5,
    purchaseCostCapturedAt: "2026-07-25T10:00:00.000Z",
    purchaseCostSource: "manual_fallback",
  },
  weighted.costByProductId,
  manualCosts,
);
assert.equal(fixedCost.status, "fixed");
assert.equal(fixedCost.source, "manual_fallback");
assert.equal(fixedCost.cost, 5);

assert.equal(
  estimateStockValue(
    [
      { id: "amnesia", stock: 22 },
      { id: "blue-dream", stock: 10 },
      { id: "resine", stock: 10 },
    ],
    weighted.costByProductId,
  ),
  29.83,
);

console.log("Supplier purchase accounting tests passed.");
