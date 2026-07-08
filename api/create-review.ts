import { FieldValue } from "firebase-admin/firestore";
import { verifyFirebaseIdToken } from "./_server/adminAuth.js";
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
    const user = await verifyFirebaseIdToken(readBearerToken(request));
    const body =
      typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const orderId = String(body?.orderId || "");
    const productId = String(body?.productId || "");
    const rating = Number(body?.rating);
    const comment = String(body?.comment || "").trim();

    if (!orderId || !productId) throw new Error("Commande ou produit invalide.");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error("Choisissez une note entre 1 et 5.");
    }
    if (comment.length < 3 || comment.length > 1000) {
      throw new Error("Votre commentaire doit contenir entre 3 et 1000 caractères.");
    }

    const db = getAdminDb();
    const orderSnapshot = await db.collection("orders").doc(orderId).get();
    if (!orderSnapshot.exists) throw new Error("Commande introuvable.");
    const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
    if (order.customerId !== user.uid) throw new Error("Commande non autorisée.");
    if (order.orderStatus !== "delivered") {
      throw new Error("Un avis peut être laissé après livraison.");
    }
    const item = order.items.find((entry) => entry.productId === productId);
    if (!item) throw new Error("Ce produit ne fait pas partie de la commande.");

    const reviewId = `${user.uid}_${orderId}_${productId}`;
    const reviewRef = db.collection("productReviews").doc(reviewId);
    if ((await reviewRef.get()).exists) {
      throw new Error("Un avis existe déjà pour ce produit et cette commande.");
    }

    await reviewRef.set({
      rating,
      comment,
      productId,
      productName: item.name,
      orderId,
      userId: user.uid,
      customerEmail: user.email || "",
      createdAt: FieldValue.serverTimestamp(),
      status: "pending",
      publicVisible: false,
    });

    sendJson(response, { reviewId }, 201);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible d’enregistrer cet avis.";
    sendJson(response, { error: safeMessage(message) }, 400);
  }
}

function readBearerToken(request: VercelRequestLike) {
  const authorization = request.headers?.authorization;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!value?.startsWith("Bearer ")) throw new Error("Connexion requise.");
  return value.slice(7);
}

function safeMessage(message: string) {
  const allowed = [
    "Commande ou produit invalide.",
    "Choisissez une note entre 1 et 5.",
    "Votre commentaire doit contenir entre 3 et 1000 caractères.",
    "Commande introuvable.",
    "Commande non autorisée.",
    "Un avis peut être laissé après livraison.",
    "Ce produit ne fait pas partie de la commande.",
    "Un avis existe déjà pour ce produit et cette commande.",
    "Connexion requise.",
  ];
  return allowed.includes(message)
    ? message
    : "Impossible d’enregistrer cet avis. Réessayez.";
}
