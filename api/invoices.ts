import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { renderInvoicePdf } from "./_server/invoicePdf.js";
import { sendInvoiceToCustomerEmail } from "./_server/email.js";
import { BRAND_LOGO } from "../src/lib/brandAssets.js";
import type {
  BillingSettings,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  Order,
  PaymentStatus,
} from "../src/types/index.js";

const invoiceStatuses: InvoiceStatus[] = [
  "draft",
  "validated",
  "sent",
  "paid",
  "cancelled",
  "credit_note_issued",
];
const paymentStatuses: PaymentStatus[] = ["to_confirm", "pending", "paid", "cancelled"];

const fallbackBillingSettings: BillingSettings = {
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
  logoUrl: BRAND_LOGO,
  isManuallyValidated: false,
  validationWarning:
    "Les informations légales de facturation ne sont pas encore validées. Vérifiez la raison sociale, le SIRET, l'adresse, le régime TVA et les mentions obligatoires avant émission officielle.",
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
    const idToken = bearerToken(request) || parseAuthToken(request.body);
    if (!idToken) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }
    await assertAdminUser(db, idToken);

    if (method === "GET") {
      const query = new URL(request.url || "/", "https://verdanza.local").searchParams;
      const action = query.get("action") || "";
      if (action !== "pdf") {
        sendJson(response, { error: "Action invalide." }, 400);
        return;
      }
      const invoiceId = query.get("invoiceId") || "";
      const invoice = await getInvoice(db, invoiceId);
      const settings = await getBillingSettings(db);
      const pdf = await renderInvoicePdf(invoice, settings);
      response.statusCode = 200;
      response.setHeader("content-type", "application/pdf");
      response.setHeader(
        "content-disposition",
        `attachment; filename="${invoice.invoiceNumber}.pdf"`,
      );
      response.end(Buffer.from(pdf));
      return;
    }

    if (assertMethod(request, response, "POST")) return;
    const body = parseJsonObject(request.body);

    if (body.action === "createFromOrder") {
      const result = await createInvoiceFromOrder(db, String(body.orderId || ""));
      sendJson(response, result);
      return;
    }

    if (body.action === "createManual") {
      const result = await createManualInvoice(db, body.manualInvoice);
      sendJson(response, result);
      return;
    }

    if (body.action === "updateStatus") {
      const status = body.status as InvoiceStatus;
      if (!invoiceStatuses.includes(status)) throw new Error("Statut facture invalide.");
      const now = new Date().toISOString();
      const update: Record<string, unknown> = {
        status,
        updatedAt: now,
      };
      if (status === "validated") update.validatedAt = now;
      if (status === "paid") update.paymentStatus = "paid";
      await db.collection("invoices").doc(String(body.invoiceId || "")).update(update);
      sendJson(response, { ok: true });
      return;
    }

    if (body.action === "sendEmail") {
      const invoice = await getInvoice(db, String(body.invoiceId || ""));
      if (!invoice.customerEmail) throw new Error("Email client absent.");
      const settings = await getBillingSettings(db);
      const pdf = await renderInvoicePdf(invoice, settings);
      const result = await sendInvoiceToCustomerEmail(invoice, settings, Buffer.from(pdf));
      if (result.status !== "sent") {
        throw new Error(result.reason || "Envoi facture impossible.");
      }
      const now = new Date().toISOString();
      await db.collection("invoices").doc(invoice.id).update({
        status: invoice.status === "draft" ? "sent" : "sent",
        sentAt: now,
        sentTo: invoice.customerEmail,
        updatedAt: now,
      });
      sendJson(response, { ok: true });
      return;
    }

    sendJson(response, { error: "Action facture inconnue." }, 400);
  } catch (error) {
    console.error("invoices failed", error);
    sendJson(
      response,
      { error: error instanceof Error ? error.message : "Operation facture impossible." },
      400,
    );
  }
}

async function createInvoiceFromOrder(db: FirebaseFirestore.Firestore, orderId: string) {
  if (!orderId) throw new Error("orderId requis.");
  const existing = await db.collection("invoices").where("orderId", "==", orderId).limit(1).get();
  if (!existing.empty) {
    const invoice = existing.docs[0];
    return { invoiceId: invoice.id, invoiceNumber: invoice.data().invoiceNumber as string };
  }
  const orderSnapshot = await db.collection("orders").doc(orderId).get();
  if (!orderSnapshot.exists) throw new Error("Commande introuvable.");
  const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
  const invoiceNumber = await nextInvoiceNumber(db);
  const now = new Date().toISOString();
  const lines = order.items.map((item) => ({
    id: item.productId,
    label: item.name,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice || 0),
    total: roundMoney(Number(item.unitPrice || 0) * Number(item.quantity || 0)),
  }));
  const invoiceRef = db.collection("invoices").doc();
  const invoice: Invoice = {
    id: invoiceRef.id,
    invoiceNumber,
    orderId: order.id,
    origin: "order",
    status: "draft",
    customerName: order.customerName || order.customerEmail || "Client",
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    customerAddress: order.deliveryAddress,
    lines,
    subtotal: Number(order.subtotal || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    discountAmount: Number(order.discountAmount || 0),
    total: Number(order.total || 0),
    paymentMethod: order.paymentInstructions || "Règlement à confirmer",
    paymentStatus: order.paymentStatus || "to_confirm",
    internalNote: "",
    createdAt: now,
    updatedAt: now,
  };
  await invoiceRef.set(invoice);
  await db.collection("orders").doc(order.id).update({
    invoiceId: invoice.id,
    invoiceNumber,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { invoiceId: invoice.id, invoiceNumber };
}

async function createManualInvoice(db: FirebaseFirestore.Firestore, raw: unknown) {
  const input = parseManualInvoice(raw);
  const invoiceNumber = await nextInvoiceNumber(db);
  const now = new Date().toISOString();
  const subtotal = roundMoney(input.lines.reduce((sum, line) => sum + line.total, 0));
  const total = roundMoney(subtotal + input.deliveryFee - input.discountAmount);
  const invoiceRef = db.collection("invoices").doc();
  const invoice: Invoice = {
    id: invoiceRef.id,
    invoiceNumber,
    origin: "manual",
    status: "draft",
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    lines: input.lines,
    subtotal,
    deliveryFee: input.deliveryFee,
    discountAmount: input.discountAmount,
    total,
    paymentMethod: input.paymentMethod,
    paymentStatus: input.paymentStatus,
    internalNote: input.internalNote,
    createdAt: now,
    updatedAt: now,
  };
  await invoiceRef.set(invoice);
  return { invoiceId: invoice.id, invoiceNumber };
}

async function nextInvoiceNumber(db: FirebaseFirestore.Firestore) {
  const year = new Date().getFullYear();
  const counterRef = db.collection("counters").doc(`invoices-${year}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const current = Number(snapshot.data()?.value || 0);
    const next = current + 1;
    transaction.set(counterRef, {
      value: next,
      year,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return `VER-${year}-${String(next).padStart(4, "0")}`;
  });
}

async function getInvoice(db: FirebaseFirestore.Firestore, invoiceId: string) {
  if (!invoiceId) throw new Error("invoiceId requis.");
  const snapshot = await db.collection("invoices").doc(invoiceId).get();
  if (!snapshot.exists) throw new Error("Facture introuvable.");
  return { id: snapshot.id, ...snapshot.data() } as Invoice;
}

async function getBillingSettings(db: FirebaseFirestore.Firestore) {
  const snapshot = await db.collection("settings").doc("billing").get();
  return {
    ...fallbackBillingSettings,
    ...(snapshot.exists ? snapshot.data() : {}),
    id: "billing",
  } as BillingSettings;
}

function parseManualInvoice(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Facture manuelle invalide.");
  const input = value as {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    lines?: InvoiceLine[];
    deliveryFee?: number;
    discountAmount?: number;
    paymentMethod?: string;
    paymentStatus?: PaymentStatus;
    internalNote?: string;
  };
  if (!input.customerName) throw new Error("Client requis.");
  const lines = (input.lines || []).filter((line) => line.label && line.quantity > 0);
  if (!lines.length) throw new Error("Au moins une ligne facture est requise.");
  const normalizedLines = lines.map((line, index) => ({
    id: line.id || `line-${index + 1}`,
    label: line.label,
    quantity: Number(line.quantity || 0),
    unitPrice: Number(line.unitPrice || 0),
    total: roundMoney(Number(line.quantity || 0) * Number(line.unitPrice || 0)),
  }));
  const paymentStatus = input.paymentStatus || "to_confirm";
  if (!paymentStatuses.includes(paymentStatus)) throw new Error("Statut règlement invalide.");
  return {
    customerName: input.customerName,
    customerEmail: input.customerEmail || "",
    customerPhone: input.customerPhone || "",
    lines: normalizedLines,
    deliveryFee: Number(input.deliveryFee || 0),
    discountAmount: Number(input.discountAmount || 0),
    paymentMethod: input.paymentMethod || "Règlement à confirmer",
    paymentStatus,
    internalNote: input.internalNote || "",
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  return body as Record<string, unknown>;
}

function parseAuthToken(value: unknown) {
  try {
    const body = parseJsonObject(value);
    return typeof body.authToken === "string" ? body.authToken : "";
  } catch {
    return "";
  }
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
