import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";

type ProductCostPayload = {
  productId?: unknown;
  purchasePricePerGram?: unknown;
};

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  const method = request.method || "GET";
  if (!["GET", "POST"].includes(method)) {
    sendJson(response, { error: "Methode non autorisee." }, 405);
    return;
  }

  try {
    const db = getAdminDb();
    const token = bearerToken(request) || parseAuthToken(request.body);
    if (!token) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }
    const adminUser = await assertAdminUser(db, token);

    if (method === "GET") {
      const snapshot = await db.collection("productCosts").get();
      sendJson(response, {
        costs: snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            productId: entry.id,
            purchasePricePerGram: optionalNonNegativeNumber(data.purchasePricePerGram),
            updatedAt: data.updatedAt,
            updatedBy: data.updatedBy,
          };
        }),
      });
      return;
    }

    const body = parseJsonObject(request.body) as ProductCostPayload;
    const productId = String(body.productId || "").trim();
    if (!productId) throw new Error("Produit requis.");
    const purchasePricePerGram = optionalNonNegativeNumber(body.purchasePricePerGram);

    await db.collection("productCosts").doc(productId).set(
      {
        productId,
        purchasePricePerGram: purchasePricePerGram ?? null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.email || adminUser.uid,
      },
      { merge: true },
    );

    sendJson(response, { ok: true, productId, purchasePricePerGram });
  } catch (error) {
    console.error("product-costs failed", error);
    const message = error instanceof Error ? error.message : "Couts produits indisponibles.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

function parseAuthToken(body: unknown) {
  const parsed = parseJsonObject(body);
  return typeof parsed.idToken === "string" ? parsed.idToken : "";
}

function parseJsonObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function optionalNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Prix d'achat invalide.");
  }
  return parsed;
}
