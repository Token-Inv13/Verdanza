export type PurchaseCostSource = "supplier_weighted" | "manual_fallback";

export type AccountingSupplierPurchaseStatus = "draft" | "validated" | "cancelled";
export type AccountingSupplierPurchaseCostBase = "HT" | "TTC";

export type AccountingSupplierPurchaseLineLike = {
  id?: string;
  productId?: string;
  productName?: string;
  quantityGrams?: number;
  grossAmountExVat?: number;
  vatRate?: number;
  lineDiscountAmount?: number;
  allocatedGlobalDiscount?: number;
  allocatedShipping?: number;
  netCostAmount?: number;
  effectiveCostPerGram?: number;
};

export type AccountingSupplierPurchaseLike = {
  id?: string;
  supplierName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  internalReference?: string;
  paidLinesGrossAmountExVat?: number;
  globalDiscountExVat?: number;
  shippingExVat?: number;
  vatRate?: number;
  vatAmount?: number;
  totalExVat?: number;
  totalIncVat?: number;
  costBase?: AccountingSupplierPurchaseCostBase;
  status?: AccountingSupplierPurchaseStatus;
  lines?: AccountingSupplierPurchaseLineLike[];
  createdAt?: string;
  updatedAt?: string;
  validatedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  createdBy?: string;
  updatedBy?: string;
};

export type WeightedSupplierCost = {
  productId: string;
  totalQuantityGrams: number;
  totalCost: number;
  weightedCostPerGram: number;
};

export type OrderItemCostLike = {
  productId: string;
  quantity: number;
  purchasePricePerGramSnapshot?: number | null;
  purchaseCostTotalSnapshot?: number | null;
  purchaseCostCapturedAt?: string;
  purchaseCostSource?: PurchaseCostSource;
};

export function normalizeSupplierPurchaseInput(
  input: AccountingSupplierPurchaseLike,
): AccountingSupplierPurchaseLike {
  const status = normalizeSupplierStatus(input.status);
  const costBase = input.costBase === "TTC" ? "TTC" : "HT";
  const globalDiscountExVat = nonNegativeNumber(input.globalDiscountExVat);
  const shippingExVat = nonNegativeNumber(input.shippingExVat);
  const defaultVatRate = nonNegativeNumber(input.vatRate);
  const rawLines = input.lines || [];
  const lines = rawLines.map((line, index) => {
    const productId = String(line.productId || "").trim();
    if (!productId) throw new Error("Chaque ligne fournisseur doit etre liee a un produit.");
    const quantityGrams = positiveNumber(line.quantityGrams, "Quantite fournisseur invalide.");
    const grossAmountExVat = nonNegativeNumber(line.grossAmountExVat);
    const vatRate = nonNegativeNumber(line.vatRate ?? defaultVatRate);
    const lineDiscountAmount = nonNegativeNumber(line.lineDiscountAmount);
    if (lineDiscountAmount > grossAmountExVat) {
      throw new Error("Une remise ligne ne peut pas depasser le montant HT de la ligne.");
    }
    return {
      id: String(line.id || `line-${index + 1}`),
      productId,
      productName: line.productName ? String(line.productName) : "",
      quantityGrams,
      grossAmountExVat,
      vatRate,
      lineDiscountAmount,
    };
  });

  if (!lines.length) throw new Error("Au moins une ligne fournisseur est requise.");
  const grossWeights = lines.map((line) => line.grossAmountExVat);
  const allocatedGlobalDiscounts = allocateProportionally(globalDiscountExVat, grossWeights);
  const allocatedShippings = allocateProportionally(shippingExVat, grossWeights);
  const computedLines = lines.map((line, index) => {
    const allocatedGlobalDiscount = allocatedGlobalDiscounts[index] || 0;
    const allocatedShipping = allocatedShippings[index] || 0;
    const netExVat = roundMoney(
      line.grossAmountExVat - line.lineDiscountAmount - allocatedGlobalDiscount + allocatedShipping,
    );
    const netCostAmount = roundMoney(
      costBase === "TTC" ? netExVat * (1 + line.vatRate / 100) : netExVat,
    );
    return {
      ...line,
      allocatedGlobalDiscount,
      allocatedShipping,
      netCostAmount,
      effectiveCostPerGram: roundUnitCost(netCostAmount / line.quantityGrams),
    };
  });
  const paidLinesGrossAmountExVat = roundMoney(
    lines.reduce((sum, line) => sum + line.grossAmountExVat, 0),
  );
  if (globalDiscountExVat > paidLinesGrossAmountExVat) {
    throw new Error("La remise globale ne peut pas depasser le total HT fournisseur.");
  }
  const totalExVat = roundMoney(paidLinesGrossAmountExVat - globalDiscountExVat + shippingExVat);
  const vatAmount = roundMoney(
    computedLines.reduce((sum, line) => {
      const taxableBase = costBase === "TTC" ? line.netCostAmount / (1 + line.vatRate / 100) : line.netCostAmount;
      return sum + taxableBase * (line.vatRate / 100);
    }, 0),
  );

  return {
    id: input.id ? String(input.id) : undefined,
    supplierName: String(input.supplierName || "").trim(),
    invoiceNumber: String(input.invoiceNumber || "").trim(),
    invoiceDate: String(input.invoiceDate || "").trim(),
    internalReference: String(input.internalReference || "").trim(),
    paidLinesGrossAmountExVat,
    globalDiscountExVat,
    shippingExVat,
    vatRate: defaultVatRate,
    vatAmount,
    totalExVat,
    totalIncVat: roundMoney(totalExVat + vatAmount),
    costBase,
    status,
    lines: computedLines,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    validatedAt: input.validatedAt,
    cancelledAt: input.cancelledAt,
    cancelledBy: input.cancelledBy,
    createdBy: input.createdBy,
    updatedBy: input.updatedBy,
  };
}

export function allocateProportionally(total: number, weights: number[]) {
  const amount = roundMoney(nonNegativeNumber(total));
  if (!weights.length || amount === 0) return weights.map(() => 0);
  const positiveTotal = weights.reduce((sum, weight) => sum + Math.max(0, Number(weight || 0)), 0);
  if (positiveTotal <= 0) return weights.map(() => 0);
  let allocated = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return roundMoney(amount - allocated);
    const share = roundMoney(amount * (Math.max(0, Number(weight || 0)) / positiveTotal));
    allocated += share;
    return share;
  });
}

export function computeWeightedSupplierCosts(purchases: AccountingSupplierPurchaseLike[]) {
  const totals = new Map<string, { quantity: number; cost: number }>();
  let validatedPurchaseTotal = 0;

  purchases
    .filter((purchase) => purchase.status === "validated")
    .forEach((purchase) => {
      validatedPurchaseTotal += nonNegativeNumber(purchase.totalExVat);
      (purchase.lines || []).forEach((line) => {
        const productId = String(line.productId || "").trim();
        const quantity = nonNegativeNumber(line.quantityGrams);
        const cost = nonNegativeNumber(line.netCostAmount);
        if (!productId || quantity <= 0 || cost < 0) return;
        const current = totals.get(productId) || { quantity: 0, cost: 0 };
        current.quantity += quantity;
        current.cost += cost;
        totals.set(productId, current);
      });
    });

  const costByProductId = new Map<string, WeightedSupplierCost>();
  totals.forEach((value, productId) => {
    if (value.quantity <= 0) return;
    costByProductId.set(productId, {
      productId,
      totalQuantityGrams: roundQuantity(value.quantity),
      totalCost: roundMoney(value.cost),
      weightedCostPerGram: roundUnitCost(value.cost / value.quantity),
    });
  });

  return {
    costByProductId,
    validatedPurchaseTotal: roundMoney(validatedPurchaseTotal),
  };
}

export function resolveOrderItemPurchaseCost(
  item: OrderItemCostLike,
  supplierCostMap: Map<string, WeightedSupplierCost>,
  manualCostMap: Map<string, { purchasePricePerGram?: number | null }>,
): {
  cost: number;
  pricePerGram: number | null;
  status: "fixed" | "estimated" | "missing";
  source: PurchaseCostSource | null;
} {
  if (item.purchaseCostCapturedAt !== undefined) {
    const snapshotCost = optionalAccountingNumber(item.purchaseCostTotalSnapshot);
    const snapshotPrice = optionalAccountingNumber(item.purchasePricePerGramSnapshot);
    return snapshotCost == null
      ? { cost: 0, pricePerGram: snapshotPrice, status: "missing", source: item.purchaseCostSource || null }
      : {
          cost: snapshotCost,
          pricePerGram: snapshotPrice,
          status: "fixed",
          source: item.purchaseCostSource || "manual_fallback",
        };
  }

  const supplierCost = supplierCostMap.get(item.productId);
  if (supplierCost) {
    return {
      cost: roundMoney(nonNegativeNumber(item.quantity) * supplierCost.weightedCostPerGram),
      pricePerGram: supplierCost.weightedCostPerGram,
      status: "estimated",
      source: "supplier_weighted",
    };
  }

  const manualPrice = optionalAccountingNumber(manualCostMap.get(item.productId)?.purchasePricePerGram);
  if (manualPrice == null) return { cost: 0, pricePerGram: null, status: "missing", source: null };
  return {
    cost: roundMoney(nonNegativeNumber(item.quantity) * manualPrice),
    pricePerGram: manualPrice,
    status: "estimated",
    source: "manual_fallback",
  };
}

export function estimateStockValue(
  products: Array<{ id: string; stock?: number }>,
  supplierCostMap: Map<string, WeightedSupplierCost>,
) {
  return roundMoney(
    products.reduce((sum, product) => {
      const cost = supplierCostMap.get(product.id);
      if (!cost) return sum;
      return sum + nonNegativeNumber(product.stock) * cost.weightedCostPerGram;
    }, 0),
  );
}

export function optionalAccountingNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundUnitCost(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function nonNegativeNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function positiveNumber(value: unknown, errorMessage: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(errorMessage);
  return parsed;
}

function normalizeSupplierStatus(value: unknown): AccountingSupplierPurchaseStatus {
  return value === "validated" || value === "cancelled" ? value : "draft";
}
