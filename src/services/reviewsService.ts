import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { getCurrentFirebaseUser } from "../lib/firebaseAuth";
import type { OrderItem, ProductReview, ReviewStatus } from "../types";
import { collections } from "./collections";

export function reviewDocumentId(
  userId: string,
  orderId: string,
  productId: string,
) {
  return `${userId}_${orderId}_${productId}`;
}

export async function getUserReviews(userId: string) {
  if (!db) return [];
  const snapshot = await getDocs(
    query(collection(db, collections.productReviews), where("userId", "==", userId)),
  );
  return snapshot.docs.map(
    (entry) => ({ id: entry.id, ...entry.data() }) as ProductReview,
  );
}

export async function createProductReview(input: {
  userId: string;
  customerEmail?: string;
  orderId: string;
  item: OrderItem;
  rating: number;
  comment: string;
}) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new Error("Choisissez une note entre 1 et 5.");
  }
  const comment = input.comment.trim();
  if (comment.length < 3 || comment.length > 1000) {
    throw new Error("Votre commentaire doit contenir entre 3 et 1000 caractères.");
  }
  const currentUser = await getCurrentFirebaseUser();
  const token = await currentUser?.getIdToken();
  if (!token || currentUser?.uid !== input.userId) {
    throw new Error("Connexion requise.");
  }
  const response = await fetch("/api/create-review", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      orderId: input.orderId,
      productId: input.item.productId,
      rating: input.rating,
      comment,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Impossible d’enregistrer cet avis. Réessayez.");
  }
}

export async function getAdminProductReviews() {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, collections.productReviews));
  return snapshot.docs.map(
    (entry) => ({ id: entry.id, ...entry.data() }) as ProductReview,
  );
}

export async function updateReviewStatus(id: string, status: ReviewStatus) {
  if (!db) throw new Error("Service temporairement indisponible.");
  await updateDoc(doc(db, collections.productReviews, id), { status });
}
