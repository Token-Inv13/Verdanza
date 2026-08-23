import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./http.js";
import type { Order } from "../../src/types/index.js";

export async function handleRevokeOrderAnalytics(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const body = parseBody(request.body);
    if (!body) {
      sendJson(response, { ok: true });
      return;
    }

    const db = getAdminDb();
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection("orders").doc(body.orderId);
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) return;
      const order = { id: snapshot.id, ...snapshot.data() } as Order;
      const tokenHash = order.analytics?.revocationTokenHash;
      if (!tokenHash || !safeEqual(tokenHash, hashToken(body.token))) return;
      if (order.analytics?.purchaseStatus === "sent") return;
      transaction.update(orderRef, {
        "analytics.consentRevokedAt": new Date().toISOString(),
        "analytics.clientId": FieldValue.delete(),
        "analytics.sessionId": FieldValue.delete(),
        "analytics.revocationTokenHash": FieldValue.delete(),
        "analytics.purchaseStatus": "not_eligible",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    sendJson(response, { ok: true });
  } catch {
    sendJson(response, { ok: true });
  }
}

function parseBody(value: unknown): { orderId: string; token: string } | null {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") return null;
  const payload = body as { orderId?: unknown; token?: unknown };
  if (typeof payload.orderId !== "string" || typeof payload.token !== "string") return null;
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(payload.token)) return null;
  return { orderId: payload.orderId, token: payload.token };
}

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
