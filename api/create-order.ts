import { FieldValue } from "firebase-admin/firestore";
import crypto from "node:crypto";
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
import type { Invoice, Order } from "../src/types/index.js";

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
    const analyticsRevocationToken = body.analyticsContext?.clientId
      ? crypto.randomBytes(32).toString("base64url")
      : undefined;
    const analyticsRevocationTokenHash = analyticsRevocationToken
      ? hashToken(analyticsRevocationToken)
      : undefined;

    await db.runTransaction(async (transaction) => {
      const couponRef = priced.couponId
        ? db.collection("coupons").doc(priced.couponId)
        : null;
      const couponSnapshot = couponRef ? await transaction.get(couponRef) : null;
      const automaticCouponReads = await Promise.all(
        priced.appliedPromotions
          .filter((promotion) => promotion.couponId && promotion.couponId !== priced.couponId)
          .map(async (promotion) => {
            const couponRef = db.collection("coupons").doc(promotion.couponId as string);
            const couponSnapshot = await transaction.get(couponRef);
            return { couponSnapshot };
          }),
      );
      const productReads = await Promise.all(
        priced.orderItems.map(async (item) => {
          const productRef = db.collection("products").doc(item.productId);
          const productSnapshot = await transaction.get(productRef);
          return { item, productRef, productSnapshot };
        }),
      );

      if (couponRef && couponSnapshot) {
        const coupon = couponSnapshot.data();
        if (!couponSnapshot.exists || coupon?.isActive === false || coupon?.isArchived === true) {
          throw new Error("Code promo invalide.");
        }
        if (coupon?.maxUses && Number(coupon.usedCount || 0) >= Number(coupon.maxUses)) {
          throw new Error("Code promo deja utilise au maximum.");
        }
      }
      for (const { couponSnapshot } of automaticCouponReads) {
        const coupon = couponSnapshot.data();
        if (!couponSnapshot.exists || coupon?.isActive === false || coupon?.isArchived === true) {
          throw new Error("Promotion automatique invalide.");
        }
        if (coupon?.maxUses && Number(coupon.usedCount || 0) >= Number(coupon.maxUses)) {
          throw new Error("Promotion automatique utilisee au maximum.");
        }
      }

      for (const { item, productRef, productSnapshot } of productReads) {
        if (!productSnapshot.exists) {
          throw new Error(`Produit indisponible : ${item.name}.`);
        }

        const data = productSnapshot.data();
        const stock = Number(data?.stock ?? 0);
        if (
          data?.isActive !== true ||
          data?.comingSoon === true ||
          data?.stockStatus === "coming_soon"
        ) {
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
          db.collection("coupons").doc(priced.couponId || priced.couponCode.toLowerCase()),
          {
            usedCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      for (const promotion of priced.appliedPromotions) {
        if (!promotion.couponId || promotion.couponId === priced.couponId) continue;
        transaction.set(
          db.collection("coupons").doc(promotion.couponId),
          {
            usedCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      transaction.set(
        orderRef,
        orderPayload(body, priced, verifiedCustomer?.uid, analyticsRevocationTokenHash),
      );
    });

    const orderSnapshot = await orderRef.get();
    const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
    await createDraftInvoiceForOrder(db, order).catch((error) => {
      console.warn("Draft invoice creation skipped", {
        orderId: order.id,
        reason: error instanceof Error ? error.message : "invoice_failed",
      });
    });
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
      paymentInstructions: order.paymentInstructions,
      analyticsRevocationToken,
    });
  } catch (error) {
    console.error("create-order failed", error);
    const message = error instanceof Error ? error.message : "";
    const stockOrProductError =
      message.includes("Stock insuffisant") ||
      message.includes("Produit indisponible") ||
      message.includes("Produit inactif") ||
      message.includes("produit n'est plus disponible") ||
      message.includes("Quantite produit invalide");
    const safeBusinessError = stockOrProductError
      ? "Stock insuffisant ou produit indisponible. Veuillez ajuster votre panier avant de valider."
      : message.includes("minimum de commande") ||
      message.includes("Code promo") ||
      message.includes("code promo") ||
      message.includes("Promotion automatique") ||
      message.includes("livraison postale")
      ? message
      : "Impossible de valider la commande pour le moment. Veuillez réessayer ou contacter Verdanza par email à contact@verdanza.fr.";
    sendJson(
      response,
      {
        error: safeBusinessError,
      },
      400,
    );
  }
}

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function createDraftInvoiceForOrder(
  db: FirebaseFirestore.Firestore,
  order: Order,
) {
  const existing = await db.collection("invoices").where("orderId", "==", order.id).limit(1).get();
  if (!existing.empty) return;
  const invoiceNumber = await nextInvoiceNumber(db);
  const now = new Date().toISOString();
  const invoiceRef = db.collection("invoices").doc();
  const invoice: Invoice = {
    id: invoiceRef.id,
    invoiceNumber,
    orderId: order.id,
    origin: "order",
    status: "draft",
    customerName: order.customerName || order.customerEmail || "Client",
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    customerAddress: order.deliveryAddress,
    lines: order.items.map((item) => ({
      id: item.productId,
      label: item.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice || 0),
      total: roundMoney(Number(item.unitPrice || 0) * Number(item.quantity || 0)),
    })),
    subtotal: Number(order.subtotal || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    discountAmount: Number(order.discountAmount || 0),
    total: Number(order.total || 0),
    paymentMethod: preferredPaymentMethodLabel(order.preferredPaymentMethod),
    paymentStatus: order.paymentStatus || "to_confirm",
    internalNote: "",
    createdAt: now,
    updatedAt: now,
  };
  await invoiceRef.set(invoice);
  await db.collection("orders").doc(order.id).update({
    invoiceId: invoiceRef.id,
    invoiceNumber,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function nextInvoiceNumber(db: FirebaseFirestore.Firestore) {
  const year = new Date().getFullYear();
  const counterRef = db.collection("counters").doc(`invoices-${year}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const current = Number(snapshot.data()?.value || 0);
    const next = current + 1;
    transaction.set(
      counterRef,
      {
        value: next,
        year,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return `VER-${year}-${String(next).padStart(4, "0")}`;
  });
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function preferredPaymentMethodLabel(method?: Order["preferredPaymentMethod"]) {
  if (method === "card_payment_link") {
    return "Carte bancaire via lien de paiement après confirmation";
  }
  if (method === "cash_on_delivery") return "Espèces à la livraison locale";
  if (method === "bank_transfer") return "Virement bancaire";
  if (method === "local_delivery_payment") return "Paiement à la livraison locale";
  return "À confirmer avec Verdanza";
}

function emailResultUpdate(prefix: string, result: EmailResult) {
  const update: Record<string, unknown> = {
    [`emails.${prefix}Status`]: result.status,
  };
  if (result.recipients) {
    update[`emails.${prefix}Recipients`] = result.recipients;
  }

  if (result.status === "sent") {
    update[`emails.${prefix}SentAt`] = FieldValue.serverTimestamp();
    if (result.id) update[`emails.${prefix}ProviderId`] = result.id;
    update[`emails.${prefix}Error`] = FieldValue.delete();
    update[`emails.${prefix}FailedAt`] = FieldValue.delete();
    update[`emails.${prefix}SkippedAt`] = FieldValue.delete();
    return update;
  }

  if (result.status === "partial") {
    update[`emails.${prefix}FailedAt`] = FieldValue.serverTimestamp();
    update[`emails.${prefix}Error`] = result.reason;
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
