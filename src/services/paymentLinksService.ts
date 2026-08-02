import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type {
  PaymentLinkDeliveryIntent,
  PaymentLinkDeliveryStatus,
} from "../types";

export type AdminPaymentLink = {
  id: string;
  label: string;
  amount: number;
  currency: "EUR";
  url: string;
  active: boolean;
  note?: string;
  sortOrder: number;
};

export async function getAdminPaymentLinks() {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/admin-payment-links", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    links?: AdminPaymentLink[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Liens de paiement indisponibles.");
  }
  return payload.links || [];
}

export async function sendOrderPaymentLinkEmail(input: {
  orderId: string;
  paymentLinkRequestId: string;
  intent: PaymentLinkDeliveryIntent;
  paymentLinkUrl: string;
  paymentLinkLabel: string;
  paymentLinkAmount: number;
  paymentLinkCurrency: "EUR";
}) {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/send-payment-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    delivery?: PaymentLinkDeliveryResponse;
  };
  if (!response.ok) {
    throw new PaymentLinkDeliveryError(
      payload.error || "Envoi du lien de paiement impossible.",
      payload.delivery,
      payload.code,
    );
  }
  if (!payload.delivery) {
    throw new Error("Statut d’envoi indisponible.");
  }
  return payload.delivery;
}

export type PaymentLinkDeliveryResponse = {
  status: PaymentLinkDeliveryStatus;
  requestId: string;
  attempts: number;
  providerId?: string;
  errorCode?: string;
  existing: boolean;
};

export class PaymentLinkDeliveryError extends Error {
  constructor(
    message: string,
    readonly delivery?: PaymentLinkDeliveryResponse,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PaymentLinkDeliveryError";
  }
}

export function createPaymentLinkRequestId() {
  return crypto.randomUUID();
}
