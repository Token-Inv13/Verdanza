import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import { mockOrders } from "../data/adminMock";
import type { Order, OrderItem, OrderStatus, PaymentStatus } from "../types";

export type AdminOrderRow = {
  id: string;
  customer: string;
  customerEmail?: string;
  customerPhone?: string;
  paymentStatus: PaymentStatus | "mock";
  orderStatus: OrderStatus | string;
  delivery: string;
  items: OrderItem[];
  total: string;
  internalNote?: string;
};

export async function getAdminOrdersWithFallback() {
  const fallbackOrders = mockOrders as AdminOrderRow[];
  if (!db) return { orders: fallbackOrders, source: "mock" as const };
  try {
    const snapshot = await getDocs(
      query(collection(db, collections.orders), orderBy("createdAt", "desc")),
    );
    const orders: AdminOrderRow[] = snapshot.docs.map((entry) => {
      const order = { id: entry.id, ...entry.data() } as Order;
      return {
        id: order.id,
        customer: order.customerName || order.customerEmail || "Client",
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        delivery: order.deliveryZone || order.deliveryMethod,
        items: order.items || [],
        total: `${Number(order.total || 0).toFixed(2).replace(".", ",")} EUR`,
        internalNote: order.internalNote,
      };
    });
    return {
      orders: orders.length ? orders : fallbackOrders,
      source: orders.length ? ("firestore" as const) : ("mock" as const),
    };
  } catch (error) {
    console.warn("Falling back to mock orders", error);
    return { orders: fallbackOrders, source: "mock" as const };
  }
}

export async function updateOrderAdminFields(
  orderId: string,
  data: { orderStatus?: OrderStatus; internalNote?: string },
) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.orders, orderId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}
