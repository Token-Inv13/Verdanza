import { FieldValue } from "firebase-admin/firestore";
import type { Order } from "../../src/types/index.js";
import {
  sendAdminNewOrderEmail,
  sendOrderConfirmationEmail,
  type EmailResult,
} from "./email.js";

type EmailTarget = "all" | "client" | "admin";

export async function sendPostPaymentEmails(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  target: EmailTarget = "all",
) {
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) {
    console.warn("Emails post-paiement ignores: commande introuvable", { orderId });
    return;
  }

  const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
  const updates: Record<string, unknown> = {};

  if (target === "all" || target === "client") {
    if (!order.emails?.orderConfirmationSentAt) {
      const result = await sendOrderConfirmationEmail(order);
      Object.assign(updates, emailResultUpdate("orderConfirmation", result));
    } else {
      console.info("Email client deja marque envoye", { orderId });
    }
  }

  if (target === "all" || target === "admin") {
    if (!order.emails?.adminNotificationSentAt) {
      const result = await sendAdminNewOrderEmail(order);
      Object.assign(updates, emailResultUpdate("adminNotification", result));
    } else {
      console.info("Email admin deja marque envoye", { orderId });
    }
  }

  if (Object.keys(updates).length) {
    await orderRef.update({
      ...updates,
      "emails.lastAttemptedAt": FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

function emailResultUpdate(prefix: string, result: EmailResult) {
  const update: Record<string, unknown> = {
    [`emails.${prefix}Status`]: result.status,
  };

  if (result.status === "sent") {
    update[`emails.${prefix}SentAt`] = FieldValue.serverTimestamp();
    if (result.id) update[`emails.${prefix}ProviderId`] = result.id;
    update[`emails.${prefix}Error`] = FieldValue.delete();
    update[`emails.${prefix}FailedAt`] = FieldValue.delete();
    update[`emails.${prefix}SkippedAt`] = FieldValue.delete();
    return update;
  }

  if (result.status === "failed") {
    update[`emails.${prefix}FailedAt`] = FieldValue.serverTimestamp();
    update[`emails.${prefix}Error`] = result.reason;
    if (result.statusCode) update[`emails.${prefix}StatusCode`] = result.statusCode;
    return update;
  }

  update[`emails.${prefix}SkippedAt`] = FieldValue.serverTimestamp();
  update[`emails.${prefix}Error`] = result.reason;
  return update;
}
