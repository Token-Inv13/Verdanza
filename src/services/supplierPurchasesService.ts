import { auth } from "../lib/firebase";
import type { SupplierPurchase } from "../types";

export async function getSupplierPurchasesAdmin() {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) return { purchases: [], source: "empty" as const };
  const response = await fetch("/api/invoices?action=supplierPurchases", {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    purchases?: SupplierPurchase[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Achats fournisseurs indisponibles.");
  }
  return {
    purchases: payload.purchases || [],
    source: payload.purchases?.length ? ("firestore" as const) : ("empty" as const),
  };
}

export async function saveSupplierPurchaseAdmin(purchase: Partial<SupplierPurchase>) {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/invoices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "saveSupplierPurchase", purchase }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    purchaseId?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Enregistrement de l'achat fournisseur impossible.");
  }
  return payload.purchaseId || "";
}

export async function deleteSupplierPurchaseAdmin(purchaseId: string) {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/invoices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "deleteSupplierPurchase", purchaseId }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Suppression de l'achat fournisseur impossible.");
  }
}

export async function cancelSupplierPurchaseAdmin(purchaseId: string) {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/invoices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "cancelSupplierPurchase", purchaseId }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Annulation de l'achat fournisseur impossible.");
  }
}
