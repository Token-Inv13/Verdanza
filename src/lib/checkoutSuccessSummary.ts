import { exactEuroCents } from "./orderFinancing.js";

export function parseCheckoutSuccessSummary(raw: string, orderId: string) {
  try {
    const parsed = JSON.parse(raw) as {
      orderId?: string;
      items?: { name: string; quantity: number; displayQuantity?: string; total: number }[];
      delivery?: string;
      deliveryMethod?: "postal" | "local_express";
      deliveryNote?: string;
      subtotal?: number;
      deliveryFee?: number;
      preferredPaymentMethod?: string;
      total?: number;
      paymentAmount?: number;
      paymentStatus?: "to_confirm" | "payment_link_sent" | "pending" | "paid" | "cancelled";
      orderStatus?: string;
      cagnotteUse?: { amountCents: number; state: "reserved" };
    };
    if (parsed.orderId !== orderId || !Array.isArray(parsed.items)) return null;
    const total = Number(parsed.total ?? 0);
    const paymentAmount = parsed.paymentAmount === undefined
      ? undefined
      : Number(parsed.paymentAmount);
    let financingVerificationRequired = false;
    if (parsed.cagnotteUse) {
      try {
        if (!Number.isSafeInteger(parsed.cagnotteUse.amountCents) || parsed.cagnotteUse.amountCents < 0 ||
          paymentAmount === undefined ||
          exactEuroCents(total) !== parsed.cagnotteUse.amountCents + exactEuroCents(paymentAmount)) {
          throw new Error("financement incomplet");
        }
      } catch {
        financingVerificationRequired = true;
      }
    }
    return {
      items: parsed.items,
      delivery: parsed.delivery || "Livraison sélectionnée",
      deliveryMethod: parsed.deliveryMethod,
      deliveryNote: parsed.deliveryNote || "",
      subtotal: Number(parsed.subtotal || 0),
      deliveryFee: Number(parsed.deliveryFee || 0),
      preferredPaymentMethod:
        parsed.preferredPaymentMethod ||
        "Carte bancaire via lien de paiement après confirmation",
      total,
      paymentAmount: financingVerificationRequired
        ? 0
        : paymentAmount ?? total,
      paymentStatus: parsed.paymentStatus || "to_confirm",
      orderStatus: parsed.orderStatus,
      cagnotteUse: parsed.cagnotteUse && Number.isSafeInteger(parsed.cagnotteUse.amountCents)
        ? parsed.cagnotteUse
        : undefined,
      financingVerificationRequired,
    };
  } catch {
    return null;
  }
}
