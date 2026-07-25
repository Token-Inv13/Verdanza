import { auth } from "../lib/firebase";
import type { SupplierInvoiceParseResult } from "../lib/supplierInvoiceParsers";
import type { SupplierProductAlias, SupplierPurchase } from "../types";

export type SupplierInvoiceAnalysisResult = SupplierInvoiceParseResult & {
  fileSha256: string;
  duplicate?: { found: boolean; reason?: string; purchaseId?: string };
};

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

export async function analyzeSupplierInvoicePdfAdmin(file: File) {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  if (file.type !== "application/pdf") throw new Error("PDF uniquement.");
  if (file.size > 5 * 1024 * 1024) throw new Error("PDF trop volumineux (5 Mo max).");
  const response = await fetch("/api/analyze-supplier-invoice", {
    method: "POST",
    headers: {
      "content-type": "application/pdf",
      authorization: `Bearer ${token}`,
    },
    body: file,
  });
  const payload = (await response.json().catch(() => ({}))) as SupplierInvoiceAnalysisResult & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Analyse PDF fournisseur impossible.");
  }
  return payload;
}

export async function saveSupplierProductAliasAdmin(
  alias: Pick<SupplierProductAlias, "supplierName" | "originalLabel" | "productId">,
) {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/invoices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "saveSupplierProductAlias", alias }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    aliasId?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Memorisation de la correspondance impossible.");
  }
  return payload.aliasId || "";
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
