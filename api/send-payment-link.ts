import { assertAdminUser } from "./_server/adminAuth.js";
import { findActiveAdminPaymentLink } from "./_server/adminPaymentLinks.js";
import { sendPaymentLinkEmail } from "./_server/email.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import {
  executePaymentLinkDelivery,
  PaymentLinkConflictError,
  PaymentLinkOrderStateError,
  validatePaymentLinkRequestId,
  type PaymentLinkDeliveryRequest,
} from "./_server/paymentLinkDelivery.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  let orderId = "unknown";
  try {
    const rawBody = parseJsonObject(request.body);
    const token = rawBody.authToken || bearerToken(request);
    if (!token) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }

    const body = parseBody(rawBody);
    orderId = body.orderId;
    const paymentLink = resolvePaymentLink(body);
    const deliveryRequest: PaymentLinkDeliveryRequest = {
      orderId: body.orderId,
      paymentLinkRequestId: body.paymentLinkRequestId,
      intent: body.intent,
      paymentLinkUrl: paymentLink.url,
      paymentLinkLabel: paymentLink.label,
      paymentLinkAmount: paymentLink.amount,
      paymentLinkCurrency: paymentLink.currency,
      channel: "email",
    };

    const db = getAdminDb();
    const admin = await assertAdminUser(db, token);
    const result = await executePaymentLinkDelivery({
      db,
      request: deliveryRequest,
      admin,
      send: (order, delivery) =>
        sendPaymentLinkEmail(order, {
          paymentLinkRequestId: delivery.paymentLinkRequestId,
          paymentLinkUrl: delivery.paymentLinkUrl,
          paymentLinkLabel: delivery.paymentLinkLabel,
          paymentLinkAmount: delivery.paymentLinkAmount,
          paymentLinkCurrency: delivery.paymentLinkCurrency,
        }),
    });

    const statusCode =
      result.status === "failed"
        ? 502
        : result.status === "sending" || result.status === "unknown"
          ? 202
          : 200;
    sendJson(
      response,
      {
        ok: result.status === "sent",
        delivery: result,
        ...(result.status === "failed"
          ? { error: "L’envoi a été refusé ou n’est pas configuré." }
          : {}),
      },
      statusCode,
    );
  } catch (error) {
    const { status, code, message } = publicError(error);
    console.warn("send-payment-link rejected", { orderId, code });
    sendJson(response, { error: message, code }, status);
  }
}

type RawBody = {
  orderId?: string;
  paymentLinkRequestId?: string;
  intent?: "initial" | "resend";
  paymentLinkUrl?: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
  authToken?: string;
};

function parseJsonObject(value: unknown): RawBody {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("payload_invalid");
  return body as RawBody;
}

function parseBody(value: RawBody) {
  if (!value.orderId) throw new Error("order_id_required");
  if (!value.paymentLinkUrl) throw new Error("payment_link_required");
  if (value.intent !== "initial" && value.intent !== "resend") {
    throw new Error("payment_link_intent_invalid");
  }
  return {
    orderId: value.orderId,
    paymentLinkRequestId: validatePaymentLinkRequestId(
      value.paymentLinkRequestId,
    ),
    intent: value.intent,
    paymentLinkUrl: value.paymentLinkUrl,
    paymentLinkLabel: value.paymentLinkLabel,
    paymentLinkAmount: value.paymentLinkAmount,
    paymentLinkCurrency: value.paymentLinkCurrency,
  };
}

function resolvePaymentLink(body: {
  paymentLinkUrl: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
}) {
  const configured = findActiveAdminPaymentLink(body.paymentLinkUrl);
  if (configured) return configured;

  if (!body.paymentLinkUrl.startsWith("https://buy.stripe.com/")) {
    throw new Error("payment_link_not_allowed");
  }
  const amount = Number(body.paymentLinkAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("payment_link_amount_required");
  }
  return {
    id: "custom",
    label: body.paymentLinkLabel || `Paiement CB ${amount} EUR`,
    amount,
    currency: body.paymentLinkCurrency || ("EUR" as const),
    url: body.paymentLinkUrl,
    active: true,
    sortOrder: amount,
  };
}

function publicError(error: unknown) {
  if (error instanceof PaymentLinkConflictError) {
    return {
      status: 409,
      code: error.message,
      message: "Cette tentative existe avec un contenu différent.",
    };
  }
  if (error instanceof PaymentLinkOrderStateError) {
    return {
      status: 409,
      code: error.code,
      message: orderStateMessage(error.code),
    };
  }
  const code = error instanceof Error ? error.message : "payment_link_send_failed";
  if (code === "Acces admin requis.") {
    return { status: 403, code: "admin_required", message: "Accès admin requis." };
  }
  const inputErrors = new Set([
    "payload_invalid",
    "order_id_required",
    "payment_link_required",
    "payment_link_intent_invalid",
    "payment_link_request_id_invalid",
    "payment_link_not_allowed",
    "payment_link_amount_required",
  ]);
  const authenticationErrors = new Set([
    "Token Firebase invalide.",
    "INVALID_ID_TOKEN",
    "TOKEN_EXPIRED",
    "USER_NOT_FOUND",
  ]);
  if (authenticationErrors.has(code)) {
    return {
      status: 401,
      code: "admin_token_invalid",
      message: "Authentification admin invalide.",
    };
  }
  if (!inputErrors.has(code)) {
    return {
      status: 500,
      code: "payment_link_send_failed",
      message: "Envoi du lien de paiement indisponible.",
    };
  }
  return {
    status: 400,
    code,
    message: "Demande de lien de paiement invalide.",
  };
}

function orderStateMessage(code: string) {
  if (code === "order_cancelled") return "La commande est annulée.";
  if (code === "order_deleted") return "La commande est supprimée.";
  if (code === "order_already_paid") return "La commande est déjà réglée.";
  if (code === "order_missing") return "Commande introuvable.";
  if (code === "resend_confirmation_required") {
    return "Confirmez explicitement le renvoi du lien.";
  }
  if (code === "initial_send_required") return "Utilisez l’envoi initial.";
  return "État de commande incompatible avec cet envoi.";
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}
