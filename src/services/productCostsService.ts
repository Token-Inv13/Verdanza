import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { ProductCost } from "../types";

export async function getProductCostsAdmin() {
  const token = await getFirebaseIdToken();
  if (!token) return { costs: [], source: "empty" as const };
  const response = await fetch("/api/invoices?action=productCosts", {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    costs?: ProductCost[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Couts produits indisponibles.");
  }
  return {
    costs: payload.costs || [],
    source: payload.costs?.length ? ("firestore" as const) : ("empty" as const),
  };
}

export async function saveProductCostAdmin(
  productId: string,
  purchasePricePerGram: number | null,
) {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/invoices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "saveProductCost", productId, purchasePricePerGram }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Enregistrement du cout impossible.");
  }
}
