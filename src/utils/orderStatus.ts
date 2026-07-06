import type { OrderStatus, PaymentProvider, PaymentStatus } from "../types";

export const orderStatusLabels: Record<OrderStatus, string> = {
  new: "Nouvelle commande",
  contact_required: "Client à contacter",
  confirmed: "Confirmée",
  preparing: "En préparation",
  out_for_delivery: "En livraison",
  shipped: "Expédiée",
  delivered: "Livrée",
  cancelled: "Annulée",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  to_confirm: "À confirmer",
  payment_link_sent: "Lien CB envoyé",
  pending: "En attente",
  paid: "Réglé",
  cancelled: "Annulé",
};

export const paymentProviderLabels: Record<PaymentProvider, string> = {
  manual: "Règlement à confirmer directement",
  bank_transfer: "Règlement à confirmer directement",
  cash_on_delivery: "Règlement à confirmer directement",
  future_psp: "Règlement à confirmer directement",
};

export const visibleOrderSteps: OrderStatus[] = [
  "new",
  "contact_required",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "shipped",
  "delivered",
];

export function orderStatusLabel(status: OrderStatus | string) {
  return orderStatusLabels[status as OrderStatus] ?? status;
}

export function paymentStatusLabel(status: PaymentStatus | string) {
  return paymentStatusLabels[status as PaymentStatus] ?? status;
}

export function paymentProviderLabel(provider?: PaymentProvider | string) {
  if (!provider) return "À confirmer";
  return paymentProviderLabels[provider as PaymentProvider] ?? provider;
}
