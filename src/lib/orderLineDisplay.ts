import type { OrderItem } from "../types/index.js";
import { roundMoney } from "./fixedPriceOptions.js";

export function orderItemLineTotal(item: Pick<OrderItem, "lineTotal" | "unitPrice" | "quantity">) {
  const configured = Number(item.lineTotal);
  if (Number.isFinite(configured) && configured >= 0) return roundMoney(configured);
  return roundMoney(Number(item.unitPrice || 0) * Number(item.quantity || 0));
}

export function orderItemQuantityLabel(item: Pick<
  OrderItem,
  "quantity" | "purchaseMode" | "fixedPriceQuantity" | "fixedPriceGrams"
>) {
  if (item.purchaseMode === "fixed_price") {
    const count = Math.max(1, Math.floor(Number(item.fixedPriceQuantity || 1)));
    const grams = Math.max(0, Math.floor(Number(item.fixedPriceGrams || item.quantity || 0)));
    const unit = count > 1 ? "formats" : "format";
    return `${count} ${unit}${grams > 0 ? ` de ${grams} g` : ""}`;
  }
  return `${Math.max(0, Math.floor(Number(item.quantity || 0)))} g`;
}

export function orderItemDisplayName(item: Pick<
  OrderItem,
  "name" | "purchaseMode" | "fixedPriceTotal" | "fixedPriceGrams"
>) {
  if (item.purchaseMode !== "fixed_price") return item.name;
  const total = Number(item.fixedPriceTotal || 0);
  const grams = Number(item.fixedPriceGrams || 0);
  const format = [
    total > 0 ? `format ${formatMoney(total)}` : "format prix fixe",
    grams > 0 ? `${grams} g` : "",
  ].filter(Boolean).join(" - ");
  return `${item.name} - ${format}`;
}

export function orderItemSummaryLabel(item: OrderItem) {
  return `${orderItemDisplayName(item)} x ${orderItemQuantityLabel(item)}`;
}

export function formatMoney(value: number) {
  return `${roundMoney(value).toFixed(2).replace(".", ",")} EUR`;
}
