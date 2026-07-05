import type { OrderStatus, PaymentProvider, PaymentStatus } from "../types";

export const orderStatusLabels: Record<OrderStatus, string> = {
  new: "Nouvelle commande",
  pending: "En attente",
  waiting_payment: "En attente de paiement",
  payment_on_delivery: "Paiement a recuperer a la livraison",
  bank_transfer_pending: "Virement en attente",
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

export const paymentProviderLabels: Record<PaymentProvider, string> = {
  manual: "Paiement manuel apres confirmation",
  bank_transfer: "Virement bancaire",
  cash_on_delivery: "Paiement a la livraison",
  future_psp: "Prestataire de paiement a venir",
};

export const visibleOrderSteps: OrderStatus[] = [
  "new",
  "waiting_payment",
  "bank_transfer_pending",
  "payment_on_delivery",
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

export function paymentProviderLabel(provider?: PaymentProvider | string) {
  if (!provider) return "A confirmer";
  return paymentProviderLabels[provider as PaymentProvider] ?? provider;
}
