import type { Invoice } from "../types/index.js";

export type LinkedOrderInvoiceState = {
  id: string;
  orderStatus: string;
  paymentStatus: string;
  deletedAt?: string;
};

export type InvoiceSendConflictCode =
  | "invoice_cancelled"
  | "invoice_invalidated"
  | "invoice_payment_cancelled"
  | "invoice_order_missing"
  | "invoice_order_deleted"
  | "invoice_order_cancelled";

export type InvoiceSendBlock = {
  code: InvoiceSendConflictCode;
  message: string;
};

export class InvoiceSendConflictError extends Error {
  readonly statusCode = 409;

  constructor(
    readonly code: InvoiceSendConflictCode,
    message: string,
  ) {
    super(message);
    this.name = "InvoiceSendConflictError";
  }
}

export function invoiceDocumentSendBlock(invoice: Invoice): InvoiceSendBlock | null {
  if (invoice.status === "cancelled") {
    return {
      code: "invoice_cancelled",
      message: "Facture annulee - envoi indisponible.",
    };
  }
  if (invoice.status === "credit_note_issued") {
    return {
      code: "invoice_invalidated",
      message: "Facture invalidee par un avoir - envoi indisponible.",
    };
  }
  if (invoice.paymentStatus === "cancelled") {
    return {
      code: "invoice_payment_cancelled",
      message: "Reglement annule - envoi de la facture indisponible.",
    };
  }
  return null;
}

export function invoiceSendBlock(
  invoice: Invoice,
  linkedOrder: LinkedOrderInvoiceState | null | undefined,
): InvoiceSendBlock | null {
  const documentBlock = invoiceDocumentSendBlock(invoice);
  if (documentBlock) return documentBlock;
  if (!invoice.orderId) return null;
  if (!linkedOrder) {
    return {
      code: "invoice_order_missing",
      message: "Commande liee introuvable - envoi de la facture indisponible.",
    };
  }
  if (linkedOrder.deletedAt) {
    return {
      code: "invoice_order_deleted",
      message: "Commande liee supprimee - envoi de la facture indisponible.",
    };
  }
  if (
    linkedOrder.orderStatus === "cancelled" ||
    linkedOrder.paymentStatus === "cancelled"
  ) {
    return {
      code: "invoice_order_cancelled",
      message: "Commande liee annulee - envoi de la facture indisponible.",
    };
  }
  return null;
}

export function assertInvoiceSendable(
  invoice: Invoice,
  linkedOrder: LinkedOrderInvoiceState | null | undefined,
) {
  const block = invoiceSendBlock(invoice, linkedOrder);
  if (block) throw new InvoiceSendConflictError(block.code, block.message);
}
