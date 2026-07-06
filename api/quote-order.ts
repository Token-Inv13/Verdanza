import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import {
  priceCheckout,
  type CheckoutRequestBody,
  type CheckoutRequestItem,
} from "./_server/checkout.js";
import type { DeliveryMethod } from "../src/types/index.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const requestBody =
      typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const body = parseQuoteBody(requestBody);
    const priced = await priceCheckout(getAdminDb(), body);

    sendJson(response, {
      subtotal: priced.subtotal,
      subtotalBeforeDiscount: priced.subtotalBeforeDiscount,
      deliveryFee: priced.deliveryFee,
      deliveryFeeStatus: priced.deliveryFeeStatus,
      deliveryNote: priced.deliveryNote,
      discountAmount: priced.discountAmount,
      couponCode: priced.couponCode,
      promoApplied: priced.promoApplied,
      discountType: priced.discountType,
      discountValue: priced.discountValue,
      postalFreeShippingApplied: priced.postalFreeShippingApplied,
      total: priced.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    sendJson(
      response,
      {
        error: safeQuoteError(message),
      },
      400,
    );
  }
}

function parseQuoteBody(value: unknown): CheckoutRequestBody {
  if (!value || typeof value !== "object") {
    throw new Error("Payload devis invalide.");
  }
  const body = value as {
    items?: CheckoutRequestItem[];
    deliveryMethod?: DeliveryMethod;
    deliveryZone?: string;
    couponCode?: string;
  };

  if (!Array.isArray(body.items) || !body.items.length) {
    throw new Error("Le panier est vide.");
  }
  if (body.deliveryMethod !== "postal" && body.deliveryMethod !== "local_express") {
    throw new Error("Mode de livraison invalide.");
  }

  return {
    items: body.items,
    deliveryMethod: body.deliveryMethod,
    deliveryZone: body.deliveryZone,
    couponCode: body.couponCode,
    complianceAccepted: true,
    preferredPaymentMethod: "confirm_with_verdanza",
    customer: {
      email: "quote@verdanza.fr",
      phone: "0000000000",
      firstName: "Devis",
      lastName: "Verdanza",
      address: {
        firstName: "Devis",
        lastName: "Verdanza",
        line1: "Adresse devis",
        postalCode: "13090",
        city: "Aix-en-Provence",
        country: "France",
      },
    },
  };
}

function safeQuoteError(message: string) {
  if (message.includes("invalide")) return "Ce code promo n'est pas valide.";
  if (message.includes("expire")) return "Ce code promo a expire.";
  if (message.includes("pas encore actif")) return "Ce code promo n'est pas encore actif.";
  if (message.includes("maximum")) return "Ce code promo n'est plus disponible.";
  if (message.includes("minimum de commande")) return message;
  if (message.includes("partir de")) {
    return "Le minimum de commande pour ce code promo n'est pas atteint.";
  }
  if (message.includes("livraison postale")) return message;
  if (message.includes("non applicable")) return "Ce code promo n'est pas applicable a ce panier.";
  return "Impossible de verifier ce code promo pour le moment.";
}
