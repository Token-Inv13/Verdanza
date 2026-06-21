import type { OrderStatus, PaymentStatus } from "../types";

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "En attente",
  paid: "Payee",
  preparing: "En preparation",
  ready: "Prete",
  shipped: "Expediee",
  out_for_delivery: "En livraison",
  delivered: "Livree",
  cancelled: "Annulee",
  refunded: "Remboursee",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: "En attente",
  paid: "Paye",
  failed: "Echec",
  refunded: "Rembourse",
};

export const visibleOrderSteps: OrderStatus[] = [
  "pending",
  "preparing",
  "ready",
  "shipped",
  "delivered",
];

export function orderStatusLabel(status: OrderStatus | string) {
  return orderStatusLabels[status as OrderStatus] ?? status;
}

export function paymentStatusLabel(status: PaymentStatus | string) {
  return paymentStatusLabels[status as PaymentStatus] ?? status;
}
