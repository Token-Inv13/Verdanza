import { auth } from "../lib/firebase";

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
  const token = await auth?.currentUser?.getIdToken();
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
  paymentLinkUrl: string;
  paymentLinkLabel: string;
  paymentLinkAmount: number;
  paymentLinkCurrency: "EUR";
}) {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/send-payment-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Envoi du lien de paiement impossible.");
  }
}
