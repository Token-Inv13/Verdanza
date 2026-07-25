import type { InvoiceLine, Order } from "../types/index.js";
import {
  orderItemDisplayName,
  orderItemLineTotal,
} from "./orderLineDisplay.js";

export function buildCustomerInvoiceLines(
  order: Pick<Order, "items"> & Partial<Pick<Order, "appliedPromotions">>,
) {
  const promotionLabel = order.appliedPromotions?.[0]?.label || "Offert";
  return (order.items || []).map((item): InvoiceLine => {
    const unitPrice = Number(item.unitPrice || 0);
    const quantity = Number(item.quantity || 0);
    const isGift = unitPrice === 0;
    if (item.purchaseMode === "fixed_price") {
      const fixedQuantity = Math.max(1, Math.floor(Number(item.fixedPriceQuantity || 1)));
      const fixedUnitPrice = Number(item.fixedPriceTotal || 0);
      return {
        id: `${item.productId}-${item.fixedPriceOptionId || "fixed-price"}`,
        label: orderItemDisplayName(item),
        quantity: fixedQuantity,
        unitPrice: fixedUnitPrice,
        total: orderItemLineTotal(item),
        note: `${quantity} g au total`,
      };
    }
    return {
      id: item.productId,
      label: item.name,
      quantity,
      unitPrice,
      total: orderItemLineTotal(item),
      ...(isGift
        ? {
            isGift: true,
            note: "Offert",
            promotionLabel,
          }
        : {}),
    };
  });
}
