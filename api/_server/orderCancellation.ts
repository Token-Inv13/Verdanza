import { FieldValue } from "firebase-admin/firestore";
import type { Invoice, Order } from "../../src/types/index.js";

export type PromotionRestorationAudit = {
  requestedPromotionIds: string[];
  restoredPromotionIds: string[];
  missingPromotionIds: string[];
  alreadyRestoredPromotionIds: string[];
  restoredAt: string;
  restoredByUid: string;
};

export type LinkedInvoiceCancellationAudit = {
  invoiceId: string;
  status: "cancelled" | "already_cancelled" | "missing";
  checkedAt: string;
  changedAt?: string;
  changedByUid: string;
};

export type OrderCancellationResult = {
  orderUpdate: Record<string, unknown>;
  missingPromotionIds: string[];
};

export function promotionIdsForRestoration(order: Order) {
  const primaryId = normalizePromotionId(
    order.promoId || order.couponCode || order.promoCode,
  );
  const automaticIds = (order.appliedPromotions || [])
    .map((promotion) => normalizePromotionId(promotion.couponId))
    .filter(Boolean);
  return [...new Set([primaryId, ...automaticIds].filter(Boolean))];
}

export function nextRestoredCouponUsedCount(value: unknown) {
  const usedCount = Number(value || 0);
  return Math.max(0, Number.isFinite(usedCount) ? usedCount - 1 : 0);
}

export async function applyOrderCancellationInTransaction({
  db,
  transaction,
  order,
  adminUid,
  now,
}: {
  db: FirebaseFirestore.Firestore;
  transaction: FirebaseFirestore.Transaction;
  order: Order;
  adminUid: string;
  now: string;
}): Promise<OrderCancellationResult> {
  const orderUpdate: Record<string, unknown> = {
    cancelledAt: order.cancelledAt || now,
    paymentStatus: "cancelled",
  };
  const shouldRestoreStock = !order.stockRestoredAt;
  const shouldRestorePromotions = !order.promotionsRestoredAt;
  const requestedPromotionIds = shouldRestorePromotions
    ? promotionIdsForRestoration(order)
    : [];
  const legacyPrimaryIds = order.couponRestoredAt
    ? new Set(
        [normalizePromotionId(order.promoId || order.couponCode || order.promoCode)]
          .filter(Boolean),
      )
    : new Set<string>();
  const promotionIdsToRead = requestedPromotionIds.filter(
    (promotionId) => !legacyPrimaryIds.has(promotionId),
  );
  const couponEntries = await Promise.all(
    promotionIdsToRead.map(async (promotionId) => {
      const reference = db.collection("coupons").doc(promotionId);
      const snapshot = await transaction.get(reference);
      return { promotionId, reference, snapshot };
    }),
  );

  const invoiceReference = order.invoiceId
    ? db.collection("invoices").doc(order.invoiceId)
    : null;
  const invoiceSnapshot = invoiceReference
    ? await transaction.get(invoiceReference)
    : null;

  if (shouldRestoreStock) {
    for (const item of order.items || []) {
      const quantity = Number(item.quantity || 0);
      if (!item.productId || quantity <= 0) continue;
      transaction.update(db.collection("products").doc(item.productId), {
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
        createdBy: adminUid,
        orderId: order.id,
      });
    }
    orderUpdate.stockRestoredAt = now;
  }

  const restoredPromotionIds: string[] = [];
  const missingPromotionIds: string[] = [];
  if (shouldRestorePromotions) {
    for (const { promotionId, reference, snapshot } of couponEntries) {
      if (!snapshot.exists) {
        missingPromotionIds.push(promotionId);
        continue;
      }
      transaction.update(reference, {
        usedCount: nextRestoredCouponUsedCount(snapshot.data()?.usedCount),
      });
      restoredPromotionIds.push(promotionId);
    }
    const audit: PromotionRestorationAudit = {
      requestedPromotionIds,
      restoredPromotionIds,
      missingPromotionIds,
      alreadyRestoredPromotionIds: [...legacyPrimaryIds].filter((promotionId) =>
        requestedPromotionIds.includes(promotionId),
      ),
      restoredAt: now,
      restoredByUid: adminUid,
    };
    orderUpdate.promotionsRestoredAt = now;
    orderUpdate.restoredPromotionIds = restoredPromotionIds;
    orderUpdate.missingPromotionIds = missingPromotionIds;
    orderUpdate.promotionRestoration = audit;
    if (requestedPromotionIds.length && !order.couponRestoredAt) {
      orderUpdate.couponRestoredAt = now;
    }
  }

  if (invoiceReference && invoiceSnapshot) {
    let status: LinkedInvoiceCancellationAudit["status"] = "missing";
    let changedAt: string | undefined;
    if (invoiceSnapshot.exists) {
      const invoice = { id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as Invoice;
      if (invoice.status === "cancelled") {
        status = "already_cancelled";
      } else {
        status = "cancelled";
        changedAt = now;
        transaction.update(invoiceReference, {
          status: "cancelled",
          updatedAt: now,
        });
      }
    }
    orderUpdate.linkedInvoiceCancellation = {
      invoiceId: order.invoiceId || "",
      status,
      checkedAt: now,
      ...(changedAt ? { changedAt } : {}),
      changedByUid: adminUid,
    } satisfies LinkedInvoiceCancellationAudit;
  }

  return { orderUpdate, missingPromotionIds };
}

function normalizePromotionId(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
