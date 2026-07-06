import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { collections } from "./collections";
import type { BillingSettings, Invoice, InvoiceLine, InvoiceStatus, PaymentStatus } from "../types";

export type ManualInvoiceInput = {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  lines: InvoiceLine[];
  deliveryFee: number;
  discountAmount: number;
  paymentMethod?: string;
  paymentStatus: PaymentStatus;
  internalNote?: string;
};

export const defaultBillingSettings: BillingSettings = {
  id: "billing",
  tradeName: "Verdanza",
  displayName: "Token APP",
  legalName: "",
  legalForm: "",
  siren: "843 072 968",
  siret: "843 072 968 00012",
  vatMode: "not_configured",
  vatNumber: "",
  vatMention: "",
  address: "",
  phone: "07 80 81 41 37",
  email: "contact@verdanza.fr",
  paymentTerms: "Règlement à confirmer directement avec le client.",
  legalMentions: "",
  logoUrl: "/verdanza-logo.png",
  isManuallyValidated: false,
  validationWarning:
    "Les informations légales de facturation ne sont pas encore validées. Vérifiez la raison sociale, le SIRET, l'adresse, le régime TVA et les mentions obligatoires avant émission officielle.",
};

export async function getInvoicesWithFallback() {
  if (!db) return { invoices: [], source: "empty" as const };
  try {
    const snapshot = await getDocs(
      query(collection(db, collections.invoices), orderBy("createdAt", "desc")),
    );
    return {
      invoices: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Invoice),
      source: snapshot.empty ? ("empty" as const) : ("firestore" as const),
    };
  } catch (error) {
    console.warn("Unable to load invoices", error);
    return { invoices: [], source: "empty" as const };
  }
}

export async function getBillingSettings() {
  if (!db) return { settings: defaultBillingSettings, source: "local" as const };
  try {
    const snapshot = await getDoc(doc(db, collections.settings, "billing"));
    if (!snapshot.exists()) {
      return { settings: defaultBillingSettings, source: "local" as const };
    }
    return {
      settings: { ...defaultBillingSettings, ...snapshot.data(), id: "billing" } as BillingSettings,
      source: "firestore" as const,
    };
  } catch (error) {
    console.warn("Unable to load billing settings", error);
    return { settings: defaultBillingSettings, source: "local" as const };
  }
}

export async function saveBillingSettings(settings: BillingSettings) {
  if (!db) throw new Error("Base en ligne indisponible.");
  await setDoc(doc(db, collections.settings, "billing"), {
    ...settings,
    id: "billing",
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function createInvoiceFromOrder(orderId: string) {
  return callInvoiceApi<{ invoiceId: string; invoiceNumber: string }>({
    action: "createFromOrder",
    orderId,
  });
}

export async function createManualInvoice(input: ManualInvoiceInput) {
  return callInvoiceApi<{ invoiceId: string; invoiceNumber: string }>({
    action: "createManual",
    manualInvoice: input,
  });
}

export async function updateInvoiceStatus(invoiceId: string, status: InvoiceStatus) {
  return callInvoiceApi<{ ok: true }>({
    action: "updateStatus",
    invoiceId,
    status,
  });
}

export async function sendInvoiceEmail(invoiceId: string) {
  return callInvoiceApi<{ ok: true }>({
    action: "sendEmail",
    invoiceId,
  });
}

export async function downloadInvoicePdf(invoiceId: string, invoiceNumber: string) {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch(`/api/invoices?action=pdf&invoiceId=${encodeURIComponent(invoiceId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Telechargement facture impossible.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${invoiceNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function callInvoiceApi<T>(payload: Record<string, unknown>): Promise<T> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  const response = await fetch("/api/invoices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "Operation facture impossible.");
  }
  return data;
}
