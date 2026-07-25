import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { renderInvoicePdf } from "../api/_server/invoicePdf";
import { buildCustomerInvoiceLines } from "../src/lib/customerInvoiceLines";
import type { BillingSettings, Invoice, Order } from "../src/types";

const order = {
  items: [
    {
      productId: "flower-amnesia",
      name: "Amnesia",
      quantity: 10,
      unitPrice: 8,
    },
    {
      productId: "gift-blue-dream",
      name: "Blue Dream",
      quantity: 2,
      unitPrice: 0,
    },
  ],
  appliedPromotions: [
    {
      id: "gift",
      label: "Produit offert",
      type: "threshold_extra_discount",
      discountAmount: 0,
    },
  ],
} satisfies Pick<Order, "items" | "appliedPromotions">;

const lines = buildCustomerInvoiceLines(order);
assert.equal(lines.length, 2);
assert.equal(lines[0].total, 80);
assert.equal(lines[0].isGift, undefined);
assert.equal(lines[1].total, 0);
assert.equal(lines[1].isGift, true);
assert.equal(lines[1].note, "Offert");
assert.equal(lines[1].promotionLabel, "Produit offert");

const pdfBytes = await renderInvoicePdf(invoiceFixture(), billingSettingsFixture());
const pdf = await PDFDocument.load(pdfBytes);
assert.equal(pdf.getPageCount(), 1);
assert.match(Buffer.from(pdfBytes).toString("latin1"), /\/Subtype\s*\/Image/);

const longPdfBytes = await renderInvoicePdf(longInvoiceFixture(), billingSettingsFixture());
const longPdf = await PDFDocument.load(longPdfBytes);
assert.ok(longPdf.getPageCount() > 1);

console.log("Customer invoice tests passed.");

function billingSettingsFixture(): BillingSettings {
  return {
    id: "billing",
    tradeName: "Verdanza CBD",
    displayName: "Verdanza",
    legalName: "Verdanza Distribution Aix-en-Provence",
    legalForm: "Entreprise individuelle",
    siren: "123456789",
    siret: "12345678900010",
    vatMode: "vat_exempt",
    vatMention: "TVA non applicable, article 293 B du CGI.",
    address:
      "1550 Chemin de Saint-Hilaire Provence 3\n13290 Aix-en-Provence\nFrance",
    phone: "07 80 81 41 37",
    email: "contact@verdanza.fr",
    paymentTerms: "Paiement après confirmation de la commande.",
    legalMentions:
      "Facture émise pour des produits conformes aux exigences applicables.",
    isManuallyValidated: true,
    validationWarning: "",
  };
}

function invoiceFixture(): Invoice {
  return {
    id: "invoice-test",
    invoiceNumber: "VER-2026-0009",
    orderId: "order-with-a-long-reference-for-layout-check",
    origin: "order",
    status: "validated",
    customerName: "Client Verdanza",
    customerEmail: "client.long.email@example.com",
    customerPhone: "06 00 00 00 00",
    customerAddress: {
      line1: "26 Lotissement Rhin et Danube Centre Commercial La Mounine",
      line2: "Bâtiment principal, dépôt presse",
      postalCode: "13320",
      city: "Bouc-Bel-Air",
      country: "France",
    },
    lines: [
      {
        id: "line-1",
        label:
          "Amnesia CBD hydroponique premium avec libellé volontairement très long pour vérifier le retour à la ligne",
        quantity: 10,
        unitPrice: 8,
        total: 80,
      },
      {
        id: "line-2",
        label: "Blue Dream CBD offerte dans le cadre de la promotion client",
        quantity: 2,
        unitPrice: 0,
        total: 0,
        isGift: true,
        note: "Offert",
        promotionLabel: "Produit offert",
      },
    ],
    subtotal: 80,
    deliveryFee: 0,
    discountAmount: 10,
    appliedPromotions: [
      {
        id: "promo-test",
        code: "TEST10",
        label: "Remise de test",
        type: "fixed",
        discountAmount: 10,
        applicationMode: "manual",
      },
    ],
    total: 70,
    paymentMethod: "Carte bancaire via lien",
    paymentStatus: "paid",
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:00:00.000Z",
    issuedAt: "2026-07-25T10:00:00.000Z",
  };
}

function longInvoiceFixture(): Invoice {
  return {
    ...invoiceFixture(),
    id: "invoice-long-test",
    invoiceNumber: "VER-2026-0099",
    lines: Array.from({ length: 68 }, (_, index) => ({
      id: `line-${index + 1}`,
      label: `Produit Verdanza ${index + 1} avec une désignation longue et descriptive pour tester la pagination du tableau`,
      quantity: index + 1,
      unitPrice: 3.5,
      total: (index + 1) * 3.5,
    })),
    subtotal: 820,
    discountAmount: 20,
    total: 800,
  };
}
