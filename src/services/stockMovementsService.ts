import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import type { StockMovement } from "../types";

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
