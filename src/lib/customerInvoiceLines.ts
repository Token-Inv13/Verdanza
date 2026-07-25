import type { InvoiceLine, Order } from "../types/index.js";

export function buildCustomerInvoiceLines(
  order: Pick<Order, "items"> & Partial<Pick<Order, "appliedPromotions">>,
) {
  const promotionLabel = order.appliedPromotions?.[0]?.label || "Offert";
  return (order.items || []).map((item): InvoiceLine => {
    const unitPrice = Number(item.unitPrice || 0);
    const quantity = Number(item.quantity || 0);
    const isGift = unitPrice === 0;
    return {
      id: item.productId,
      label: item.name,
      quantity,
      unitPrice,
      total: roundMoney(unitPrice * quantity),
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

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
