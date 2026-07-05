import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import {
  orderPayload,
  parseCheckoutBody,
  priceCheckout,
} from "./_server/checkout.js";
import { verifyFirebaseIdToken } from "./_server/adminAuth.js";
import {
  sendAdminManualOrderEmail,
  sendManualOrderConfirmationEmail,
  type EmailResult,
} from "./_server/email.js";
import { sendPostPaymentOrderAlerts } from "./_server/orderAlerts.js";
import type { Order } from "../src/types/index.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const requestBody =
      typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const body = parseCheckoutBody(requestBody);
    const db = getAdminDb();
    const priced = await priceCheckout(db, body);
    const verifiedCustomer = body.authToken
      ? await verifyFirebaseIdToken(body.authToken)
      : null;
    const orderRef = db.collection("orders").doc();

    await db.runTransaction(async (transaction) => {
      for (const item of priced.orderItems) {
        const productRef = db.collection("products").doc(item.productId);
        const productSnapshot = await transaction.get(productRef);
        if (!productSnapshot.exists) {
          throw new Error(`Produit indisponible : ${item.name}.`);
        }

        const data = productSnapshot.data();
        const stock = Number(data?.stock ?? 0);
        if (data?.isActive !== true) {
          throw new Error(`Produit indisponible : ${item.name}.`);
        }
        if (stock < item.quantity) {
          throw new Error(`Stock insuffisant pour ${item.name}.`);
        }

        transaction.update(productRef, {
          stock: stock - item.quantity,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(db.collection("stockMovements").doc(), {
          productId: item.productId,
          productName: item.name,
          type: "sale",
          quantity: -item.quantity,
          note: `Commande manuelle ${orderRef.id}`,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: "manual-checkout",
          orderId: orderRef.id,
        });
      }

      if (priced.couponCode) {
        transaction.set(
          db.collection("coupons").doc(priced.couponCode.toLowerCase()),
          {
            usedCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      transaction.set(orderRef, orderPayload(body, priced, verifiedCustomer?.uid));
    });

    const orderSnapshot = await orderRef.get();
    const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
    const clientEmailResult = await sendManualOrderConfirmationEmail(order);
    const adminEmailResult = await sendAdminManualOrderEmail(order);
    await orderRef.update({
      ...emailResultUpdate("orderConfirmation", clientEmailResult),
      ...emailResultUpdate("adminNotification", adminEmailResult),
      "emails.lastAttemptedAt": FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await sendPostPaymentOrderAlerts(db, orderRef.id);

    sendJson(response, {
      orderId: orderRef.id,
      total: priced.total,
      paymentProvider: body.paymentProvider ?? "manual",
      paymentInstructions: order.paymentInstructions,
    });
  } catch (error) {
    console.error("create-order failed", error);
    sendJson(
      response,
      { error: error instanceof Error ? error.message : "Commande impossible." },
      400,
    );
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
