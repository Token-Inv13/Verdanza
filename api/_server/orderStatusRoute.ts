import { commitOrderStatusTransition, processOrderStatusTransitionEffects } from "./orderStatusTransition.js";
import { assertAdminUser, type verifyFirebaseIdToken } from "./adminAuth.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./http.js";
import type {
  OrderStatus,
  FinalPaymentMethod,
  PaymentLinkChannel,
  PaymentStatus,
} from "../../src/types/index.js";
import { CagnotteLedgerError } from "./cagnotteLedger.js";
import { CagnotteReservationError } from "./cagnotteReservations.js";

const orderStatuses: OrderStatus[] = [
  "new",
  "contact_required",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "shipped",
  "delivered",
  "cancelled",
];
const paymentStatuses: PaymentStatus[] = [
  "to_confirm",
  "payment_link_sent",
  "pending",
  "paid",
  "cancelled",
];
const paymentLinkChannels: PaymentLinkChannel[] = ["email", "whatsapp", "sms", "other"];
const finalPaymentMethods: FinalPaymentMethod[] = [
  "card_payment_link",
  "cash_on_delivery",
  "bank_transfer",
  "other",
];

type Effects = Parameters<typeof processOrderStatusTransitionEffects>[0];
export function createOrderStatusHandler(dependencies: {
  getDb: () => Effects["db"];
  verifyToken: typeof verifyFirebaseIdToken;
  sendStatusEmail: Effects["sendStatusEmail"];
  processAnalytics: Effects["processAnalytics"];
  program?: Parameters<typeof commitOrderStatusTransition>[0]["program"];
  now?: Parameters<typeof commitOrderStatusTransition>[0]["now"];
}) {
return async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const rawBody = parseJsonObject(request.body);
    const idToken = rawBody.authToken || bearerToken(request);
    if (!idToken) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }

    const body = parseBody(rawBody);
    const db = dependencies.getDb();
    const admin = await assertAdminUser(db, idToken, dependencies.verifyToken);

    const committed =
      await commitOrderStatusTransition({ db, body, admin, program: dependencies.program, now: dependencies.now });

    if (committed.missingPromotionIds.length) {
      console.warn("order cancellation promotion documents missing", {
        orderId: body.orderId,
        promotionIds: committed.missingPromotionIds,
      });
    }

    const purchaseAnalyticsResult = await processOrderStatusTransitionEffects({
      db, body, committed, sendStatusEmail: dependencies.sendStatusEmail,
      processAnalytics: dependencies.processAnalytics,
    });

    sendJson(response, { ok: true, analyticsPurchase: purchaseAnalyticsResult });
  } catch (error) {
    console.error("update-order-status failed", error);
    const message =
      error instanceof Error ? error.message : "Mise a jour commande impossible.";
    const conflict = error instanceof CagnotteReservationError ||
      (error instanceof CagnotteLedgerError && error.code === "CONFLICT");
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : conflict ? 409 : 400);
  }
}

}

function parseBody(value: unknown): {
  orderId: string;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  finalPaymentMethod?: FinalPaymentMethod | "";
  internalNote?: string;
  paymentReference?: string;
  paymentLinkUrl?: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
  paymentLinkSent?: boolean;
  paymentLinkChannel?: PaymentLinkChannel | "";
  trackingNumber?: string;
  archived?: boolean;
  hidden?: boolean;
  restore?: boolean;
  deleteCancelled?: boolean;
  historyNote?: string;
  authToken?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  const payload = body as {
    orderId?: string;
    orderStatus?: OrderStatus;
    paymentStatus?: PaymentStatus;
    finalPaymentMethod?: FinalPaymentMethod | "";
    internalNote?: string;
    paymentReference?: string;
    paymentLinkUrl?: string;
    paymentLinkLabel?: string;
    paymentLinkAmount?: number;
    paymentLinkCurrency?: "EUR";
    paymentLinkSent?: boolean;
    paymentLinkChannel?: PaymentLinkChannel | "";
    trackingNumber?: string;
    archived?: boolean;
    hidden?: boolean;
    restore?: boolean;
    deleteCancelled?: boolean;
    historyNote?: string;
    authToken?: string;
  };
  if (!payload.orderId) throw new Error("orderId requis.");
  if (payload.orderStatus && !orderStatuses.includes(payload.orderStatus)) {
    throw new Error("Statut commande invalide.");
  }
  if (payload.paymentStatus && !paymentStatuses.includes(payload.paymentStatus)) {
    throw new Error("Statut reglement invalide.");
  }
  if (
    payload.finalPaymentMethod &&
    !finalPaymentMethods.includes(payload.finalPaymentMethod)
  ) {
    throw new Error("Methode de paiement finale invalide.");
  }
  if (
    payload.paymentLinkChannel &&
    !paymentLinkChannels.includes(payload.paymentLinkChannel)
  ) {
    throw new Error("Canal lien paiement invalide.");
  }
  return {
    orderId: payload.orderId,
    orderStatus: payload.orderStatus, paymentStatus: payload.paymentStatus,
    finalPaymentMethod: payload.finalPaymentMethod, internalNote: payload.internalNote,
    paymentReference: payload.paymentReference, paymentLinkUrl: payload.paymentLinkUrl,
    paymentLinkLabel: payload.paymentLinkLabel, paymentLinkAmount: payload.paymentLinkAmount,
    paymentLinkCurrency: payload.paymentLinkCurrency, paymentLinkSent: payload.paymentLinkSent,
    paymentLinkChannel: payload.paymentLinkChannel, trackingNumber: payload.trackingNumber,
    archived: payload.archived, hidden: payload.hidden, restore: payload.restore,
    deleteCancelled: payload.deleteCancelled, historyNote: payload.historyNote,
  };
}

function parseJsonObject(value: unknown): {
  orderId?: string;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  finalPaymentMethod?: FinalPaymentMethod | "";
  internalNote?: string;
  paymentReference?: string;
  paymentLinkUrl?: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
  paymentLinkSent?: boolean;
  paymentLinkChannel?: PaymentLinkChannel | "";
  trackingNumber?: string;
  archived?: boolean;
  hidden?: boolean;
  restore?: boolean;
  deleteCancelled?: boolean;
  historyNote?: string;
  authToken?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  return body as {
    orderId?: string;
    orderStatus?: OrderStatus;
    paymentStatus?: PaymentStatus;
    finalPaymentMethod?: FinalPaymentMethod | "";
    internalNote?: string;
    paymentReference?: string;
    paymentLinkUrl?: string;
    paymentLinkLabel?: string;
    paymentLinkAmount?: number;
    paymentLinkCurrency?: "EUR";
    paymentLinkSent?: boolean;
    paymentLinkChannel?: PaymentLinkChannel | "";
    trackingNumber?: string;
    archived?: boolean;
    hidden?: boolean;
    restore?: boolean;
    deleteCancelled?: boolean;
    historyNote?: string;
    authToken?: string;
  };
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}
