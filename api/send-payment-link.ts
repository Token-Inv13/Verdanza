import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser } from "./_server/adminAuth.js";
import { findActiveAdminPaymentLink } from "./_server/adminPaymentLinks.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { sendPaymentLinkEmail } from "./_server/email.js";
import type { Order } from "../src/types/index.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const rawBody = parseJsonObject(request.body);
    const token = rawBody.authToken || bearerToken(request);
    if (!token) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }

    const body = parseBody(rawBody);
    const paymentLink = resolvePaymentLink(body);

    const db = getAdminDb();
    const admin = await assertAdminUser(db, token);
    const orderRef = db.collection("orders").doc(body.orderId);
    const snapshot = await orderRef.get();
    if (!snapshot.exists) throw new Error("Commande introuvable.");

    const order = { id: snapshot.id, ...snapshot.data() } as Order;
    const result = await sendPaymentLinkEmail(order, {
      paymentLinkUrl: paymentLink.url,
      paymentLinkLabel: paymentLink.label,
      paymentLinkAmount: paymentLink.amount,
      paymentLinkCurrency: paymentLink.currency,
    });

    if (result.status !== "sent") {
      throw new Error("Envoi email impossible. Copiez le message manuellement.");
    }

    await orderRef.update({
      paymentLinkUrl: paymentLink.url,
      paymentLinkLabel: paymentLink.label,
      paymentLinkAmount: paymentLink.amount,
      paymentLinkCurrency: paymentLink.currency,
      paymentLinkSent: true,
      paymentLinkSentAt: FieldValue.serverTimestamp(),
      paymentLinkSentBy: admin.email,
      paymentLinkChannel: "email",
      paymentStatus: "payment_link_sent",
      "emails.paymentLinkSentAt": FieldValue.serverTimestamp(),
      "emails.paymentLinkProviderId": result.id ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    sendJson(response, { ok: true });
  } catch (error) {
    console.error("send-payment-link failed", error);
    const message =
      error instanceof Error ? error.message : "Envoi du lien de paiement impossible.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
}

function parseJsonObject(value: unknown): {
  orderId?: string;
  paymentLinkUrl?: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
  authToken?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  return body as {
    orderId?: string;
    paymentLinkUrl?: string;
    paymentLinkLabel?: string;
    paymentLinkAmount?: number;
    paymentLinkCurrency?: "EUR";
    authToken?: string;
  };
}

function parseBody(value: unknown): {
  orderId: string;
  paymentLinkUrl: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
  authToken?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  const payload = body as {
    orderId?: string;
    paymentLinkUrl?: string;
    paymentLinkLabel?: string;
    paymentLinkAmount?: number;
    paymentLinkCurrency?: "EUR";
    authToken?: string;
  };
  if (!payload.orderId) throw new Error("orderId requis.");
  if (!payload.paymentLinkUrl) throw new Error("Lien de paiement requis.");
  return {
    orderId: payload.orderId,
    paymentLinkUrl: payload.paymentLinkUrl,
    paymentLinkLabel: payload.paymentLinkLabel,
    paymentLinkAmount: payload.paymentLinkAmount,
    paymentLinkCurrency: payload.paymentLinkCurrency,
    authToken: payload.authToken,
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
    throw new Error("Lien de paiement non autorise.");
  }
  const amount = Number(body.paymentLinkAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Montant du lien de paiement requis.");
  }
  return {
    id: "custom",
    label: body.paymentLinkLabel || `Paiement CB ${amount} €`,
    amount,
    currency: body.paymentLinkCurrency || ("EUR" as const),
    url: body.paymentLinkUrl,
    active: true,
    sortOrder: amount,
  };
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}
