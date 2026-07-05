import type { OrderStatus, PaymentProvider, PaymentStatus } from "../types";

export const orderStatusLabels: Record<OrderStatus, string> = {
  new: "Nouvelle commande",
  contact_required: "Client a contacter",
  confirmed: "Confirmee",
  preparing: "En preparation",
  out_for_delivery: "En livraison",
  shipped: "Expediee",
  delivered: "Livree",
  cancelled: "Annulee",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  to_confirm: "A confirmer",
  pending: "En attente",
  paid: "Regle",
  cancelled: "Annule",
};

export const paymentProviderLabels: Record<PaymentProvider, string> = {
  manual: "Reglement a confirmer directement",
  bank_transfer: "Reglement a confirmer directement",
  cash_on_delivery: "Reglement a confirmer directement",
  future_psp: "Reglement a confirmer directement",
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
  if (!provider) return "A confirmer";
  return paymentProviderLabels[provider as PaymentProvider] ?? provider;
}
