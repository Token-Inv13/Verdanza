import type { Invoice, Order } from "../../src/types/index.js";
import {
  assertInvoiceSendable,
  InvoiceSendConflictError,
  type LinkedOrderInvoiceState,
} from "../../src/lib/invoiceSendPolicy.js";

type InvoiceEmailResult = {
  status: "sent" | "partial" | "skipped" | "failed";
  reason?: string;
};

export async function executeGuardedInvoiceSend<T extends InvoiceEmailResult>({
  invoice,
  linkedOrder,
  send,
  finalize,
}: {
  invoice: Invoice;
  linkedOrder: LinkedOrderInvoiceState | null | undefined;
  send: () => Promise<T>;
  finalize: () => Promise<void>;
}) {
  assertInvoiceSendable(invoice, linkedOrder);
  const result = await send();
  if (result.status !== "sent") {
    throw new Error(result.reason || "Envoi facture impossible.");
  }
  await finalize();
  return result;
}

export async function finalizeAcceptedInvoiceSend({
  db,
  invoiceId,
  sentTo,
  now = new Date().toISOString(),
}: {
  db: FirebaseFirestore.Firestore;
  invoiceId: string;
  sentTo: string;
  now?: string;
}) {
  await db.runTransaction(async (transaction) => {
    const invoiceReference = db.collection("invoices").doc(invoiceId);
    const currentInvoiceSnapshot = await transaction.get(invoiceReference);
    if (!currentInvoiceSnapshot.exists) {
      throw new InvoiceSendConflictError(
        "invoice_invalidated",
        "Facture supprimee pendant l'envoi - statut non modifie.",
      );
    }
    const currentInvoice = {
      id: currentInvoiceSnapshot.id,
      ...currentInvoiceSnapshot.data(),
    } as Invoice;
    const currentLinkedOrder = await linkedOrderInTransaction(
      db,
      transaction,
      currentInvoice,
    );
    assertInvoiceSendable(currentInvoice, currentLinkedOrder);
    transaction.update(invoiceReference, {
      status: "sent",
      sentAt: now,
      sentTo,
      updatedAt: now,
    });
  });
}

async function linkedOrderInTransaction(
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  invoice: Invoice,
) {
  if (!invoice.orderId) return undefined;
  const snapshot = await transaction.get(
    db.collection("orders").doc(invoice.orderId),
  );
  return snapshot.exists
    ? ({ id: snapshot.id, ...snapshot.data() } as Order)
    : null;
}
