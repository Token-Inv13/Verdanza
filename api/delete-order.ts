import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import type { Order } from "../src/types/index.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const rawBody = parseJsonObject(request.body);
    const idToken =
      typeof rawBody.authToken === "string" ? rawBody.authToken : bearerToken(request);
    if (!idToken) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }

    const orderId = typeof rawBody.orderId === "string" ? rawBody.orderId.trim() : "";
    if (!orderId) {
      sendJson(response, { error: "Commande requise." }, 400);
      return;
    }

    const db = getAdminDb();
    await assertAdminUser(db, idToken);

    const orderRef = db.collection("orders").doc(orderId);
    const snapshot = await orderRef.get();
    if (!snapshot.exists) {
      sendJson(response, { error: "Commande introuvable." }, 404);
      return;
    }

    const order = { id: snapshot.id, ...snapshot.data() } as Order;
    if (order.orderStatus !== "cancelled" || order.paymentStatus !== "cancelled") {
      sendJson(
        response,
        { error: "Seules les commandes annulees peuvent etre supprimees definitivement." },
        400,
      );
      return;
    }

    if (!order.stockRestoredAt) {
      sendJson(
        response,
        {
          error:
            "Suppression refusee: le stock de cette commande n'est pas marque comme restaure.",
        },
        400,
      );
      return;
    }

    if (order.invoiceId || order.invoiceNumber) {
      sendJson(
        response,
        {
          error:
            "Suppression refusee: une facture est liee a cette commande. Archivez-la plutot.",
        },
        400,
      );
      return;
    }

    const invoiceSnapshot = await db
      .collection("invoices")
      .where("orderId", "==", order.id)
      .limit(1)
      .get();
    if (!invoiceSnapshot.empty) {
      sendJson(
        response,
        {
          error:
            "Suppression refusee: une facture est liee a cette commande. Archivez-la plutot.",
        },
        400,
      );
      return;
    }

    await orderRef.delete();
    sendJson(response, { ok: true });
  } catch (error) {
    console.error("[delete-order]", error);
    sendJson(
      response,
      { error: error instanceof Error ? error.message : "Suppression commande impossible." },
      500,
    );
  }
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization || request.headers.Authorization;
  if (!header || Array.isArray(header)) return "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
