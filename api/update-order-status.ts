import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { sendOrderStatusUpdateEmail } from "./_server/email.js";
import {
  enqueuePurchaseAnalyticsForPaidTransition,
  processPurchaseAnalyticsOutbox,
  type PurchaseAnalyticsProcessResult,
} from "./_server/purchaseAnalytics.js";
import {
  computeWeightedSupplierCosts,
  resolveOrderItemPurchaseCost,
} from "../src/lib/accountingCosts.js";
import type {
  Order,
  OrderStatus,
  FinalPaymentMethod,
  PaymentLinkChannel,
  PaymentStatus,
  ProductCost,
  SupplierPurchase,
} from "../src/types/index.js";

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

export default async function handler(
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
    const db = getAdminDb();
    const admin = await assertAdminUser(db, idToken);
    let updatedOrder: Order | null = null;
    let previousStatus: OrderStatus | null = null;
    let purchaseAnalyticsQueued = false;
    let purchaseAnalyticsResult: PurchaseAnalyticsProcessResult | null = null;

    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection("orders").doc(body.orderId);
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) throw new Error("Commande introuvable.");

      const order = { id: snapshot.id, ...snapshot.data() } as Order;
      previousStatus = order.orderStatus;
      if (body.deleteCancelled) {
        if (order.orderStatus !== "cancelled" || order.paymentStatus !== "cancelled") {
          throw new Error(
            "Seules les commandes annulees peuvent etre supprimees definitivement.",
          );
        }
        if (!order.stockRestoredAt) {
          throw new Error(
            "Suppression refusee: le stock de cette commande n'est pas marque comme restaure.",
          );
        }
        if (order.invoiceId || order.invoiceNumber) {
          throw new Error(
            "Suppression refusee: une facture est liee a cette commande. Archivez-la plutot.",
          );
        }
        const invoiceSnapshot = await transaction.get(
          db.collection("invoices").where("orderId", "==", order.id).limit(1),
        );
        if (!invoiceSnapshot.empty) {
          throw new Error(
            "Suppression refusee: une facture est liee a cette commande. Archivez-la plutot.",
          );
        }
        transaction.delete(orderRef);
        return;
      }

      const nextStatus = body.orderStatus ?? order.orderStatus;
      const nextFinalPaymentMethod =
        body.finalPaymentMethod || order.finalPaymentMethod || undefined;
      const update: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (body.internalNote !== undefined) {
        update.internalNote = body.internalNote;
      }
      if (body.paymentStatus) {
        if (body.paymentStatus === "paid" && !nextFinalPaymentMethod) {
          throw new Error("Methode de paiement finale requise avant paiement confirme.");
        }
        update.paymentStatus = body.paymentStatus;
        if (body.paymentStatus === "paid" && order.paymentStatus !== "paid") {
          const paidAt = new Date().toISOString();
          update.paidAt = paidAt;
          update.paymentConfirmedAt = paidAt;
          update.paymentConfirmedBy = admin.email;
          update.items = await capturePurchaseCostSnapshots({
            db,
            transaction,
            order,
            capturedAt: paidAt,
          });
        }
      }
      if (body.finalPaymentMethod !== undefined) {
        if (
          body.finalPaymentMethod === "cash_on_delivery" &&
          order.deliveryMethod !== "local_express"
        ) {
          throw new Error("Paiement en especes reserve a la livraison locale.");
        }
        update.finalPaymentMethod = body.finalPaymentMethod || FieldValue.delete();
      }
      if (body.paymentReference !== undefined) {
        update.paymentReference = body.paymentReference;
      }
      if (body.paymentLinkUrl !== undefined) {
        update.paymentLinkUrl = body.paymentLinkUrl.trim();
      }
      if (body.paymentLinkLabel !== undefined) {
        update.paymentLinkLabel = body.paymentLinkLabel.trim() || FieldValue.delete();
      }
      if (body.paymentLinkAmount !== undefined) {
        update.paymentLinkAmount = Number(body.paymentLinkAmount) || FieldValue.delete();
      }
      if (body.paymentLinkCurrency !== undefined) {
        update.paymentLinkCurrency = body.paymentLinkCurrency || FieldValue.delete();
      }
      if (body.paymentLinkChannel !== undefined) {
        update.paymentLinkChannel = body.paymentLinkChannel || FieldValue.delete();
      }
      if (body.paymentLinkSent !== undefined) {
        update.paymentLinkSent = body.paymentLinkSent;
        update.paymentLinkSentAt = body.paymentLinkSent
          ? new Date().toISOString()
          : FieldValue.delete();
        update.paymentLinkSentBy = body.paymentLinkSent ? admin.email : FieldValue.delete();
        if (body.paymentLinkSent && !body.paymentStatus) update.paymentStatus = "payment_link_sent";
        if (body.paymentLinkSent) {
          transaction.set(db.collection("analyticsOperationalEvents").doc(), {
            event: "payment_link_sent",
            orderId: order.id,
            transaction_id: order.id,
            payment_method: "card_payment_link",
            delivery_method: order.deliveryMethod,
            value: Number(order.total || 0),
            currency: "EUR",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: admin.uid,
          });
        }
      }
      if (body.trackingNumber !== undefined) {
        update.trackingNumber = body.trackingNumber;
      }
      if (body.archived !== undefined) {
        update.archived = body.archived;
        update.archivedAt = body.archived ? new Date().toISOString() : FieldValue.delete();
        update.archivedBy = body.archived ? admin.email : FieldValue.delete();
      }
      if (body.hidden !== undefined) {
        update.hidden = body.hidden;
        update.hiddenAt = body.hidden ? new Date().toISOString() : FieldValue.delete();
        update.hiddenBy = body.hidden ? admin.email : FieldValue.delete();
      }
      if (body.restore) {
        update.archived = false;
        update.hidden = false;
        update.archivedAt = FieldValue.delete();
        update.archivedBy = FieldValue.delete();
        update.hiddenAt = FieldValue.delete();
        update.hiddenBy = FieldValue.delete();
      }

      if (body.orderStatus && body.orderStatus !== order.orderStatus) {
        update.orderStatus = body.orderStatus;
        update.statusHistory = FieldValue.arrayUnion({
          status: body.orderStatus,
          previousStatus: order.orderStatus,
          changedAt: new Date().toISOString(),
          changedBy: "admin",
          changedByUid: admin.uid,
          note: body.historyNote || "",
        });
      }

      if (
        body.orderStatus === "cancelled" &&
        order.orderStatus !== "cancelled" &&
        !order.stockRestoredAt
      ) {
        const now = new Date().toISOString();
        for (const item of order.items || []) {
          const quantity = Number(item.quantity || 0);
          if (!item.productId || quantity <= 0) continue;
          const productRef = db.collection("products").doc(item.productId);
          transaction.update(productRef, {
            stock: FieldValue.increment(quantity),
            updatedAt: FieldValue.serverTimestamp(),
          });
          transaction.set(db.collection("stockMovements").doc(), {
            productId: item.productId,
            productName: item.name,
            type: "order_cancelled",
            quantity,
            note: `Annulation commande ${order.id}`,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: admin.uid,
            orderId: order.id,
          });
        }
        update.stockRestoredAt = now;
        update.cancelledAt = now;
        if (!body.paymentStatus) update.paymentStatus = "cancelled";
        const couponRestoreId = order.promoId || (order.couponCode ? order.couponCode.toLowerCase() : "");
        if (couponRestoreId && !order.couponRestoredAt) {
          transaction.set(
            db.collection("coupons").doc(couponRestoreId),
            {
              usedCount: FieldValue.increment(-1),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          update.couponRestoredAt = now;
        }
        if (order.invoiceId) {
          transaction.set(
            db.collection("invoices").doc(order.invoiceId),
            {
              status: "cancelled",
              updatedAt: now,
            },
            { merge: true },
          );
        }
      }

      if (body.paymentStatus === "paid") {
        purchaseAnalyticsQueued = await enqueuePurchaseAnalyticsForPaidTransition({
          db,
          transaction,
          order,
          update,
        });
      }

      transaction.update(
        orderRef,
        update as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
      );
      updatedOrder = {
        ...order,
        orderStatus: nextStatus,
        paymentStatus:
          (update.paymentStatus as PaymentStatus | undefined) ??
          body.paymentStatus ??
          order.paymentStatus,
        internalNote: body.internalNote ?? order.internalNote,
      };
    });

    if (updatedOrder && body.orderStatus && previousStatus && body.orderStatus !== previousStatus) {
      const result = await sendOrderStatusUpdateEmail(
        updatedOrder,
        previousStatus,
        body.orderStatus,
      );
      if (result.status === "sent") {
        await db.collection("orders").doc(body.orderId).update({
          [`emails.statusUpdateSentAt.${body.orderStatus}`]: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    if (purchaseAnalyticsQueued) {
      purchaseAnalyticsResult = await processPurchaseAnalyticsOutbox(db, body.orderId);
    }

    sendJson(response, { ok: true, analyticsPurchase: purchaseAnalyticsResult });
  } catch (error) {
    console.error("update-order-status failed", error);
    const message =
      error instanceof Error ? error.message : "Mise a jour commande impossible.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
}

async function capturePurchaseCostSnapshots({
  db,
  transaction,
  order,
  capturedAt,
}: {
  db: FirebaseFirestore.Firestore;
  transaction: FirebaseFirestore.Transaction;
  order: Order;
  capturedAt: string;
}) {
  const items = order.items || [];
  const productIds = [
    ...new Set(
      items
        .filter((item) => item.purchaseCostCapturedAt === undefined)
        .map((item) => item.productId)
        .filter(Boolean),
    ),
  ];
  const supplierSnapshot = await transaction.get(
    db.collection("supplierPurchases").where("status", "==", "validated"),
  );
  const weightedSupplierCosts = computeWeightedSupplierCosts(
    supplierSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as SupplierPurchase),
  ).costByProductId;
  const missingSupplierCostIds = productIds.filter((productId) => !weightedSupplierCosts.has(productId));
  const manualCostEntries = await Promise.all(
    missingSupplierCostIds.map(async (productId) => {
      const snapshot = await transaction.get(db.collection("productCosts").doc(productId));
      const rawCost = snapshot.data()?.purchasePricePerGram;
      return [
        productId,
        { productId, purchasePricePerGram: optionalNonNegativeNumber(rawCost) },
      ] as const;
    }),
  );
  const manualCostByProductId = new Map<string, ProductCost>(manualCostEntries);

  return items.map((item) => {
    if (item.purchaseCostCapturedAt !== undefined) return item;
    const purchaseCost = resolveOrderItemPurchaseCost(
      item,
      weightedSupplierCosts,
      manualCostByProductId,
    );
    const snapshot = {
      purchasePricePerGramSnapshot: purchaseCost.pricePerGram,
      purchaseCostTotalSnapshot: purchaseCost.status === "missing" ? null : purchaseCost.cost,
      purchaseCostCapturedAt: capturedAt,
    };
    return {
      ...item,
      ...snapshot,
      ...(purchaseCost.source ? { purchaseCostSource: purchaseCost.source } : {}),
    };
  });
}

function optionalNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
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
    ...payload,
    orderId: payload.orderId,
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
