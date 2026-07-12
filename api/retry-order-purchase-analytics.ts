import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { isPurchaseEligible } from "./_server/ga4MeasurementProtocol.js";
import {
  ensurePurchaseAnalyticsRetryQueued,
  processPurchaseAnalyticsOutbox,
} from "./_server/purchaseAnalytics.js";
import type { Order } from "../src/types/index.js";

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
    if (!rawBody.orderId) throw new Error("orderId requis.");

    const db = getAdminDb();
    await assertAdminUser(db, idToken);
    const orderSnapshot = await db.collection("orders").doc(rawBody.orderId).get();
    if (!orderSnapshot.exists) throw new Error("Commande introuvable.");
    const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
    if (order.paymentStatus !== "paid") throw new Error("Commande non payee.");
    if (!isPurchaseEligible(order)) throw new Error("Commande non eligible au purchase GA4.");

    await ensurePurchaseAnalyticsRetryQueued(db, order);
    const analyticsPurchase = await processPurchaseAnalyticsOutbox(db, order.id);
    sendJson(response, { ok: true, analyticsPurchase });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Relance analytics purchase impossible.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
}

function parseJsonObject(value: unknown): { orderId?: string; authToken?: string } {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  return body as { orderId?: string; authToken?: string };
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}
