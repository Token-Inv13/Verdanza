import { addDoc, collection, getDocs, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import type { StockMovement, StockMovementType } from "../types";

export async function getStockMovements(productId?: string) {
  if (!db) return [];
  const base = collection(db, collections.stockMovements);
  const stockQuery = productId
    ? query(base, where("productId", "==", productId), orderBy("createdAt", "desc"))
    : query(base, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(stockQuery);
  return snapshot.docs.map(
    (entry) => ({ id: entry.id, ...entry.data() }) as StockMovement,
  );
}

export async function createStockMovement(data: {
  productId: string;
  productName: string;
  type: StockMovementType;
  quantity: number;
  note?: string;
  createdBy?: string;
}) {
  if (!db) throw new Error("Firebase is not configured.");
  await addDoc(collection(db, collections.stockMovements), {
    ...data,
    createdAt: serverTimestamp(),
  });
}
