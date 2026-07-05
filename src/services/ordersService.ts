import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { collections } from "./collections";
import type {
  Order,
  OrderItem,
  OrderStatus,
  OrderType,
  PaymentProvider,
  PaymentStatus,
  StatusHistoryEntry,
} from "../types";

export type AdminOrderRow = {
  id: string;
  orderType?: OrderType;
  customer: string;
  customerEmail?: string;
  customerPhone?: string;
  deliveryAddress?: Order["deliveryAddress"];
  paymentProvider?: PaymentProvider;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus | string;
  deliveryMethod?: Order["deliveryMethod"];
  delivery: string;
  trackingNumber?: string;
  paymentReference?: string;
  customerMessage?: string;
  items: OrderItem[];
  total: string;
  internalNote?: string;
  statusHistory?: StatusHistoryEntry[];
};

export type CustomerOrderRow = {
  id: string;
  createdAt?: string;
  items: OrderItem[];
  total: number;
  paymentProvider?: PaymentProvider;
  paymentStatus: PaymentStatus;
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
        orderType: order.orderType || "order",
        customer: order.customerName || order.customerEmail || "Client",
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        deliveryAddress: order.deliveryAddress,
        paymentProvider: order.paymentProvider,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        deliveryMethod: order.deliveryMethod,
        delivery: order.deliveryZone || order.deliveryMethod,
        trackingNumber: order.trackingNumber,
        paymentReference: order.paymentReference,
        customerMessage: order.customerMessage,
        items: order.items || [],
        total: `${Number(order.total || 0).toFixed(2).replace(".", ",")} EUR`,
        internalNote: order.internalNote,
        statusHistory: order.statusHistory || [],
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

export async function updateOrderAdminFields(
  orderId: string,
  data: {
    orderStatus?: OrderStatus;
    paymentStatus?: PaymentStatus;
    internalNote?: string;
    historyNote?: string;
    paymentReference?: string;
    trackingNumber?: string;
  },
) {
  const token = await auth?.currentUser?.getIdToken();
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
