import { FieldValue } from "firebase-admin/firestore";
import type { Order } from "../../src/types/index.js";
import { orderItemSummaryLabel } from "../../src/lib/orderLineDisplay.js";

export type AlertResult =
  | { status: "sent"; id?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; statusCode?: number };

type AlertChannel = "sms" | "whatsapp";

export async function sendPostPaymentOrderAlerts(
  db: FirebaseFirestore.Firestore,
  orderId: string,
) {
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) {
    console.warn("Alertes commande ignorees: commande introuvable", { orderId });
    return;
  }

  const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
  const updates: Record<string, unknown> = {};

  if (!order.alerts?.adminSmsSentAt) {
    const smsResult = await sendAdminOrderSms(order);
    Object.assign(updates, alertResultUpdate("adminSms", smsResult));
  } else {
    console.info("Alerte SMS admin deja marquee envoyee", { orderId });
  }

  if (!order.alerts?.adminWhatsappSentAt) {
    const whatsappResult = await sendAdminOrderWhatsapp(order);
    Object.assign(updates, alertResultUpdate("adminWhatsapp", whatsappResult));
  } else {
    console.info("Alerte WhatsApp admin deja marquee envoyee", { orderId });
  }

  if (Object.keys(updates).length) {
    await orderRef.update({
      ...updates,
      "alerts.lastAttemptedAt": FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

async function sendAdminOrderSms(order: Order): Promise<AlertResult> {
  const from = process.env.TWILIO_SMS_FROM;
  const to = process.env.ADMIN_ALERT_PHONE;
  if (!from || !to) {
    console.info("Alerte SMS admin ignoree", {
      orderId: order.id,
      reason: "sms_not_configured",
    });
    return { status: "skipped", reason: "sms_not_configured" };
  }

  return sendTwilioMessage({
    channel: "sms",
    orderId: order.id,
    from,
    to,
    body: adminAlertText(order),
  });
}

async function sendAdminOrderWhatsapp(order: Order): Promise<AlertResult> {
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const to = process.env.ADMIN_ALERT_WHATSAPP;
  if (!from || !to) {
    console.info("Alerte WhatsApp admin ignoree", {
      orderId: order.id,
      reason: "whatsapp_not_configured",
    });
    return { status: "skipped", reason: "whatsapp_not_configured" };
  }

  return sendTwilioMessage({
    channel: "whatsapp",
    orderId: order.id,
    from,
    to,
    body: adminAlertText(order),
  });
}

async function sendTwilioMessage(input: {
  channel: AlertChannel;
  orderId: string;
  from: string;
  to: string;
  body: string;
}): Promise<AlertResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    console.info("Alerte telephone admin ignoree", {
      channel: input.channel,
      orderId: input.orderId,
      reason: "twilio_not_configured",
    });
    return { status: "skipped", reason: "twilio_not_configured" };
  }

  try {
    const body = new URLSearchParams({
      From: input.from,
      To: input.to,
      Body: input.body,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
    };

    if (!response.ok) {
      console.warn("Alerte telephone admin non envoyee", {
        channel: input.channel,
        orderId: input.orderId,
        status: response.status,
        reason: payload.message || `HTTP ${response.status}`,
      });
      return {
        status: "failed",
        reason: payload.message || `HTTP ${response.status}`,
        statusCode: response.status,
      };
    }

    console.info("Alerte telephone admin envoyee", {
      channel: input.channel,
      orderId: input.orderId,
      providerId: payload.sid,
    });
    return { status: "sent", id: payload.sid };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "phone_alert_failed";
    console.warn("Alerte telephone admin en erreur", {
      channel: input.channel,
      orderId: input.orderId,
      reason,
    });
    return { status: "failed", reason };
  }
}

function adminAlertText(order: Order) {
  const adminUrl = process.env.VITE_APP_URL
    ? `${process.env.VITE_APP_URL}/admin/commandes`
    : "https://verdanza.fr/admin/commandes";
  return [
    "Nouvelle commande Verdanza",
    `ID: ${shortOrderId(order.id)}`,
    `Client: ${order.customerName || order.customerEmail || "Non renseigne"}`,
    order.customerPhone ? `Tel: ${order.customerPhone}` : "",
    `Total: ${formatMoney(Number(order.total || 0))}`,
    `Livraison: ${deliveryLabel(order)}`,
    `Produits: ${itemsSummary(order)}`,
    adminUrl,
  ]
    .filter(Boolean)
    .join("\n");
}

function alertResultUpdate(prefix: string, result: AlertResult) {
  const update: Record<string, unknown> = {
    [`alerts.${prefix}Status`]: result.status,
  };

  if (result.status === "sent") {
    update[`alerts.${prefix}SentAt`] = FieldValue.serverTimestamp();
    if (result.id) update[`alerts.${prefix}ProviderId`] = result.id;
    update[`alerts.${prefix}Error`] = FieldValue.delete();
    update[`alerts.${prefix}FailedAt`] = FieldValue.delete();
    update[`alerts.${prefix}SkippedAt`] = FieldValue.delete();
    return update;
  }

  if (result.status === "failed") {
    update[`alerts.${prefix}FailedAt`] = FieldValue.serverTimestamp();
    update[`alerts.${prefix}Error`] = result.reason;
    if (result.statusCode) update[`alerts.${prefix}StatusCode`] = result.statusCode;
    return update;
  }

  update[`alerts.${prefix}SkippedAt`] = FieldValue.serverTimestamp();
  update[`alerts.${prefix}Error`] = result.reason;
  return update;
}

function deliveryLabel(order: Order) {
  if (order.deliveryMethod === "local_express") {
    return order.deliveryZone ? `Express local - ${order.deliveryZone}` : "Express local";
  }
  return "Livraison postale";
}

function itemsSummary(order: Order) {
  return order.items
    .map((item) => orderItemSummaryLabel(item))
    .join(", ")
    .slice(0, 240);
}

function shortOrderId(orderId: string) {
  return orderId.slice(0, 8).toUpperCase();
}

function formatMoney(value: number) {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}
