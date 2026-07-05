import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import {
  sendAdminManualOrderEmail,
  sendManualOrderConfirmationEmail,
} from "./_server/email.js";
import type { Order } from "../src/types/index.js";

type RetryTarget = "all" | "client" | "admin";

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
    await assertAdminUser(db, idToken);

    const orderSnapshot = await db.collection("orders").doc(body.orderId).get();
    if (!orderSnapshot.exists) throw new Error("Commande introuvable.");
    const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;

    if (body.target === "all" || body.target === "client") {
      await sendManualOrderConfirmationEmail(order);
    }
    if (body.target === "all" || body.target === "admin") {
      await sendAdminManualOrderEmail(order);
    }
    sendJson(response, { ok: true });
  } catch (error) {
    console.error("retry-order-emails failed", error);
    const message =
      error instanceof Error ? error.message : "Relance email impossible.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
}

function parseBody(value: unknown): {
  orderId: string;
  target: RetryTarget;
  authToken?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  const payload = body as {
    orderId?: string;
    target?: RetryTarget;
    authToken?: string;
  };
  if (!payload.orderId) throw new Error("orderId requis.");
  const target = payload.target ?? "client";
  if (!["all", "client", "admin"].includes(target)) {
    throw new Error("Cible email invalide.");
  }
  return { orderId: payload.orderId, target, authToken: payload.authToken };
}

function parseJsonObject(value: unknown): {
  orderId?: string;
  target?: RetryTarget;
  authToken?: string;
} {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  return body as {
    orderId?: string;
    target?: RetryTarget;
    authToken?: string;
  };
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}
