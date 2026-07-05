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
import type { Order, OrderStatus, PaymentStatus } from "../src/types/index.js";

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
const paymentStatuses: PaymentStatus[] = ["to_confirm", "pending", "paid", "cancelled"];

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

    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection("orders").doc(body.orderId);
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) throw new Error("Commande introuvable.");

      const order = { id: snapshot.id, ...snapshot.data() } as Order;
      previousStatus = order.orderStatus;
      const nextStatus = body.orderStatus ?? order.orderStatus;
      const update: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (body.internalNote !== undefined) {
        update.internalNote = body.internalNote;
      }
      if (body.paymentStatus) {
        update.paymentStatus = body.paymentStatus;
      }
      if (body.paymentReference !== undefined) {
        update.paymentReference = body.paymentReference;
      }
      if (body.trackingNumber !== undefined) {
        update.trackingNumber = body.trackingNumber;
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

      transaction.update(
        orderRef,
        update as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
      );
      updatedOrder = {
        ...order,
        orderStatus: nextStatus,
        paymentStatus: body.paymentStatus ?? order.paymentStatus,
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

    sendJson(response, { ok: true });
  } catch (error) {
    console.error("update-order-status failed", error);
    const message =
      error instanceof Error ? error.message : "Mise a jour commande impossible.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
}

function parseBody(value: unknown): {
  orderId: string;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  internalNote?: string;
  paymentReference?: string;
  trackingNumber?: string;
  historyNote?: string;
  authToken?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  const payload = body as {
    orderId?: string;
    orderStatus?: OrderStatus;
    paymentStatus?: PaymentStatus;
    internalNote?: string;
    paymentReference?: string;
    trackingNumber?: string;
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
  return {
    ...payload,
    orderId: payload.orderId,
  };
}

function parseJsonObject(value: unknown): {
  orderId?: string;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  internalNote?: string;
  paymentReference?: string;
  trackingNumber?: string;
  historyNote?: string;
  authToken?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  return body as {
    orderId?: string;
    orderStatus?: OrderStatus;
    paymentStatus?: PaymentStatus;
    internalNote?: string;
    paymentReference?: string;
    trackingNumber?: string;
    historyNote?: string;
    authToken?: string;
  };
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}
