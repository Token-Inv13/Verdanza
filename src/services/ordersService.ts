import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { getFirebaseIdToken } from "../lib/firebaseAuth";
import { collections } from "./collections";
import type {
  Order,
  OrderItem,
  OrderAnalytics,
  OrderStatus,
  OrderType,
  PaymentLinkChannel,
  PaymentLinkDeliverySummary,
  PaymentProvider,
  FinalPaymentMethod,
  PreferredPaymentMethod,
  PaymentStatus,
  StatusHistoryEntry,
} from "../types";

export type AdminOrderRow = {
  id: string;
  customerId?: string;
  orderType?: OrderType;
  customer: string;
  customerEmail?: string;
  customerPhone?: string;
  deliveryAddress?: Order["deliveryAddress"];
  paymentProvider?: PaymentProvider;
  paymentStatus: PaymentStatus;
  preferredPaymentMethod?: PreferredPaymentMethod;
  finalPaymentMethod?: FinalPaymentMethod;
  paymentConfirmedAt?: string;
  paidAt?: string;
  paymentConfirmedBy?: string;
  orderStatus: OrderStatus | string;
  deliveryMethod?: Order["deliveryMethod"];
  delivery: string;
  deliveryFee?: number;
  deliveryMinimumApplied?: number;
  postalFreeShippingApplied?: boolean;
  deliveryFeeStatus?: Order["deliveryFeeStatus"];
  deliveryNote?: string;
  trackingNumber?: string;
  paymentReference?: string;
  paymentLinkUrl?: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: Order["paymentLinkCurrency"];
  paymentLinkSent?: boolean;
  paymentLinkSentAt?: string;
  paymentLinkSentBy?: string;
  paymentLinkChannel?: PaymentLinkChannel;
  paymentLinkDelivery?: PaymentLinkDeliverySummary;
  paymentLinkDeliveryHistory?: PaymentLinkDeliverySummary[];
  customerMessage?: string;
  items: OrderItem[];
  subtotal?: number;
  subtotalBeforeDiscount?: number;
  discountAmount?: number;
  couponCode?: string;
  promoApplied?: boolean;
  promotionDiscountTotal?: number;
  appliedPromotions?: Order["appliedPromotions"];
  subtotalBeforePromotion?: number;
  subtotalAfterPromotion?: number;
  discountType?: Order["discountType"];
  discountValue?: number;
  total: string;
  internalNote?: string;
  statusHistory?: StatusHistoryEntry[];
  archived?: boolean;
  hidden?: boolean;
  deletedAt?: string;
  archivedAt?: string;
  hiddenAt?: string;
  emails?: Order["emails"];
  analytics?: OrderAnalytics;
  createdAt?: string;
  updatedAt?: string;
};

export type CustomerOrderRow = {
  id: string;
  createdAt?: string;
  items: OrderItem[];
  total: number;
  paymentProvider?: PaymentProvider;
  paymentStatus: PaymentStatus;
  preferredPaymentMethod?: PreferredPaymentMethod;
  orderStatus: OrderStatus;
  deliveryMethod: string;
  trackingNumber?: string;
  statusHistory?: StatusHistoryEntry[];
};

export async function getAdminOrdersWithFallback() {
  if (!db) return { orders: [], source: "empty" as const };
  try {
    const snapshot = await getDocs(
      query(collection(db, collections.orders), orderBy("createdAt", "desc")),
    );
    const orders: AdminOrderRow[] = snapshot.docs.map((entry) => {
      const order = { id: entry.id, ...entry.data() } as Order;
      return {
        id: order.id,
        customerId: order.customerId,
        orderType: order.orderType || "order",
        customer: order.customerName || order.customerEmail || "Client",
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        deliveryAddress: order.deliveryAddress,
        paymentProvider: order.paymentProvider,
        paymentStatus: order.paymentStatus,
        preferredPaymentMethod: order.preferredPaymentMethod,
        finalPaymentMethod: order.finalPaymentMethod,
        paymentConfirmedAt: order.paymentConfirmedAt,
        paidAt: order.paidAt,
        paymentConfirmedBy: order.paymentConfirmedBy,
        orderStatus: order.orderStatus,
        deliveryMethod: order.deliveryMethod,
        delivery: order.deliveryZone || order.deliveryMethod,
        deliveryFee: order.deliveryFee,
        deliveryMinimumApplied: order.deliveryMinimumApplied,
        postalFreeShippingApplied: order.postalFreeShippingApplied,
        deliveryFeeStatus: order.deliveryFeeStatus,
        deliveryNote: order.deliveryNote,
        trackingNumber: order.trackingNumber,
        paymentReference: order.paymentReference,
        paymentLinkUrl: order.paymentLinkUrl,
        paymentLinkLabel: order.paymentLinkLabel,
        paymentLinkAmount: order.paymentLinkAmount,
        paymentLinkCurrency: order.paymentLinkCurrency,
        paymentLinkSent: order.paymentLinkSent === true,
        paymentLinkSentAt: order.paymentLinkSentAt,
        paymentLinkSentBy: order.paymentLinkSentBy,
        paymentLinkChannel: order.paymentLinkChannel,
        paymentLinkDelivery: order.paymentLinkDelivery,
        paymentLinkDeliveryHistory: order.paymentLinkDeliveryHistory || [],
        customerMessage: order.customerMessage,
        items: order.items || [],
        subtotal: order.subtotal,
        subtotalBeforeDiscount: order.subtotalBeforeDiscount,
        discountAmount: order.discountAmount,
        couponCode: order.couponCode || order.promoCode,
        promoApplied: order.promoApplied,
        promotionDiscountTotal: order.promotionDiscountTotal,
        appliedPromotions: order.appliedPromotions || [],
        subtotalBeforePromotion: order.subtotalBeforePromotion,
        subtotalAfterPromotion: order.subtotalAfterPromotion,
        discountType: order.discountType,
        discountValue: order.discountValue,
        total: `${Number(order.total || 0).toFixed(2).replace(".", ",")} EUR`,
        internalNote: order.internalNote,
        statusHistory: order.statusHistory || [],
        archived: order.archived === true,
        hidden: order.hidden === true,
        deletedAt: order.deletedAt,
        archivedAt: order.archivedAt,
        hiddenAt: order.hiddenAt,
        emails: order.emails,
        analytics: order.analytics,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      };
    });
    return {
      orders,
      source: orders.length ? ("firestore" as const) : ("empty" as const),
    };
  } catch (error) {
    console.warn("Unable to load Firestore orders", error);
    return { orders: [], source: "empty" as const };
  }
}

export async function retryOrderPurchaseAnalytics(orderId: string) {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/retry-order-purchase-analytics", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    analyticsPurchase?: { status?: string; code?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error || "Relance analytics purchase impossible.");
  }
  return payload.analyticsPurchase;
}

export type RetryOrderEmailTarget = "client" | "admin" | "all";

export type RetryOrderEmailsResult = {
  ok: boolean;
  client?: "sent" | "partial" | "failed" | "skipped";
  admin?: "sent" | "partial" | "failed" | "skipped";
  error?: string;
};

export async function retryOrderEmails(
  orderId: string,
  target: RetryOrderEmailTarget,
) {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/retry-order-emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, target }),
  });
  const payload = (await response.json().catch(() => ({}))) as RetryOrderEmailsResult;
  if (response.status === 502 && payload.ok === false) return payload;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Relance e-mail impossible.");
  }
  return payload;
}

export async function updateOrderAdminFields(
  orderId: string,
  data: {
    orderStatus?: OrderStatus;
    paymentStatus?: PaymentStatus;
    internalNote?: string;
    historyNote?: string;
    paymentReference?: string;
    finalPaymentMethod?: FinalPaymentMethod | "";
    paymentLinkUrl?: string;
    paymentLinkLabel?: string;
    paymentLinkAmount?: number;
    paymentLinkCurrency?: Order["paymentLinkCurrency"];
    paymentLinkSent?: boolean;
    paymentLinkChannel?: PaymentLinkChannel | "";
    trackingNumber?: string;
    archived?: boolean;
    hidden?: boolean;
    restore?: boolean;
  },
) {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/update-order-status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, ...data }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Mise a jour commande impossible.");
  }
}

export async function deleteCancelledOrder(orderId: string) {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/update-order-status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, deleteCancelled: true }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Suppression commande impossible.");
  }
}

export async function getCustomerOrders(customerId: string) {
  if (!db) return [];
  const snapshot = await getDocs(
    query(collection(db, collections.orders), where("customerId", "==", customerId)),
  );

  return snapshot.docs
    .map((entry) => {
      const order = { id: entry.id, ...entry.data() } as Order;
      return {
        id: order.id,
        createdAt: order.createdAt,
        items: order.items || [],
        total: Number(order.total || 0),
        paymentProvider: order.paymentProvider,
        paymentStatus: order.paymentStatus,
        preferredPaymentMethod: order.preferredPaymentMethod,
        orderStatus: order.orderStatus,
        deliveryMethod: order.deliveryZone || order.deliveryMethod,
        trackingNumber: order.trackingNumber,
        statusHistory: order.statusHistory || [],
      } satisfies CustomerOrderRow;
    })
    .sort((left, right) => timestampMs(right.createdAt) - timestampMs(left.createdAt));
}

function timestampMs(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().getTime();
  }
  return value ? new Date(String(value)).getTime() || 0 : 0;
}
