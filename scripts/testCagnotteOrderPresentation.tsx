import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { calculateSeparatedAmountRow, renderInvoicePdf } from "../api/_server/invoicePdf.js";
import {
  inertEmailHtmlForPreview,
  renderAdminOrderEmailContent,
  renderInvoiceEmailContent,
  renderOrderEmailContent,
  renderPaymentLinkEmailContent,
} from "../api/_server/email.js";
import { adminAlertText } from "../api/_server/orderAlerts.js";
import { CagnotteCheckoutView } from "../src/components/cagnotte/CagnotteCheckoutPanel.js";
import { OrderFinancingSummary } from "../src/components/orders/OrderFinancingSummary.js";
import { parseCheckoutSuccessSummary } from "../src/lib/checkoutSuccessSummary.js";
import { publicDeliveryLabel } from "../src/lib/deliveryPresentation.js";
import {
  buildOrderFinancingDocumentSnapshot,
  deriveOrderFinancingAmounts,
  presentInvoiceFinancing,
  presentOrderFinancing,
} from "../src/lib/orderFinancing.js";
import type { Invoice, Order } from "../src/types/index.js";
import type { CagnotteCheckoutState } from "../src/services/cagnotteCheckoutService.js";
import type { CagnotteReadResponse } from "../src/types/cagnotteRead.js";
import type { OrderQuote } from "../src/services/quoteService.js";
import {
  billingSettingsFixture,
  invoiceFixture,
  mixedOrderFixture,
  ordinaryOrderFixture,
} from "./cagnotteOrderPresentationFixtures.js";

let externalCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  externalCalls += 1;
  throw new Error("Aucun appel externe autorisé pendant un rendu pur.");
};

try {
  const ordinary = ordinaryOrderFixture();
  const ordinaryBefore = JSON.stringify(ordinary);
  const ordinaryEmail = renderOrderEmailContent(ordinary, "Commande ordinaire reçue.");
  assert.match(ordinaryEmail.text, /Total de la commande: 100,00 EUR/);
  assert.doesNotMatch(ordinaryEmail.text, /cagnotte/i);
  assert.deepEqual(deriveOrderFinancingAmounts(ordinary), {
    kind: "ordinary", totalCents: 10_000, cagnotteCents: 0, paymentCents: 10_000,
  }, "A — la commande ordinaire conserve son total historique");
  assert.equal(JSON.stringify(ordinary), ordinaryBefore);

  const beforePayment = mixedOrderFixture();
  assert.deepEqual(coreAmounts(beforePayment), [10_000, 800, 9_200], "B — 100/8/92");
  const beforeEmail = renderOrderEmailContent(beforePayment, "Commande reçue.");
  assert.match(beforeEmail.text, /Financement prévu par cagnotte: 8,00\sEUR/);
  assert.match(beforeEmail.text, /À régler hors cagnotte: 92,00\sEUR/);
  assert.equal(publicDeliveryLabel(beforePayment), "Express local");
  assert.doesNotMatch(`${beforeEmail.html}\n${beforeEmail.text}`, /local_express/);
  const financingHtml = renderToStaticMarkup(
    <OrderFinancingSummary presentation={presentOrderFinancing(beforePayment)} />,
  );
  assert.match(financingHtml, /92,00(?:\u00a0|&#xA0;)EUR/);
  assert.match(financingHtml, /whitespace-nowrap/);

  const changedCheckoutState = checkoutStateFixture({
    walletPhase: "ready",
    wallet: checkoutWalletFixture(400),
    selectionEnabled: true,
    amountInput: "8,00",
    proposalPhase: "changed",
    proposal: checkoutQuoteFixture(800, 400, 9600, ["available_balance"]),
  });
  const changedCheckoutHtml = renderCheckoutInstances([changedCheckoutState]);
  assert.match(changedCheckoutHtml, /Disponible<\/dt><dd>4,00(?:\u00a0|&#xA0;)€/);
  assert.match(changedCheckoutHtml, /À régler hors cagnotte<\/dt><dd>96,00(?:\u00a0|&#xA0;)€/);
  assert.match(changedCheckoutHtml, /solde disponible vérifié permet d’utiliser/);
  assert.match(changedCheckoutHtml, /Appliquer ce montant/);
  assert.match(changedCheckoutHtml, /Utiliser le maximum/);
  assert.doesNotMatch(changedCheckoutHtml, /Le serveur a limité|Montant accepté/);

  const staleCheckoutState = {
    ...changedCheckoutState,
    wallet: checkoutWalletFixture(2000),
  };
  assert.match(renderCheckoutInstances([staleCheckoutState]), /solde affiché est antérieur à la dernière vérification/);
  const repeatedCheckoutHtml = renderCheckoutInstances([changedCheckoutState, staleCheckoutState]);
  assertUniqueIdsAndAssociations(repeatedCheckoutHtml);
  assert.doesNotMatch(beforeEmail.text, /Réglé avec la cagnotte/);
  const linkSent = { ...beforePayment, paymentStatus: "payment_link_sent" as const };
  assert.equal(presentOrderFinancing(linkSent).externalPaymentState, "planned", "un lien envoyé ne prouve pas le paiement");

  const withDelivery = mixedOrderFixture({ deliveryFee: 4.9 });
  assert.deepEqual(coreAmounts(withDelivery), [10_490, 800, 9_690], "C — 104,90/8/96,90");

  const paid = mixedOrderFixture({ paid: true });
  const paidEmail = renderOrderEmailContent(paid, "Paiement confirmé.");
  assert.match(paidEmail.text, /Réglé avec la cagnotte: 8,00\sEUR/);
  assert.match(paidEmail.text, /Règlement hors cagnotte confirmé: 92,00\sEUR/);
  assert.match(paidEmail.text, /Aucune nouvelle somme ne vous est demandée/);
  assert.doesNotMatch(paidEmail.text, /un lien de paiement vous sera envoyé/i);

  const cancelledBefore = mixedOrderFixture({ cancelled: true });
  const cancelledBeforeText = renderOrderEmailContent(cancelledBefore, "Commande annulée.").text;
  assert.match(cancelledBeforeText, /Règlement hors cagnotte initialement prévu: 92,00\sEUR/);
  assert.match(cancelledBeforeText, /ne prouve ni encaissement ni remboursement financier/);
  assert.doesNotMatch(cancelledBeforeText, /Remboursement financier enregistré/);

  const cancelledAfter = mixedOrderFixture({ paid: true, cancelled: true });
  const cancelledAfterText = renderOrderEmailContent(cancelledAfter, "Commande annulée.").text;
  assert.match(cancelledAfterText, /Règlement hors cagnotte confirmé: 92,00\sEUR/);
  assert.match(cancelledAfterText, /L’annulation seule ne prouve aucun remboursement financier/);
  assert.doesNotMatch(cancelledAfterText, /Remboursement financier enregistré/);

  const partial = mixedOrderFixture({ paid: true, refund: "partial" });
  const partialPresentation = presentOrderFinancing(partial);
  assert.deepEqual(coreAmounts(partial), [10_000, 800, 9_200]);
  assert.deepEqual(refundAmounts(partialPresentation), [2_300, 200], "G — retour net 25 EUR réparti 23/2");
  const partialText = renderOrderEmailContent(partial, "Retour enregistré.").text;
  assert.match(partialText, /Total de la commande: 100,00 EUR/);
  assert.match(partialText, /Remboursement financier enregistré: 23,00\sEUR/);
  assert.match(partialText, /Cagnotte brute restituée: 2,00\sEUR/);
  assert.match(partialText, /compensation de régularisation reste distincte/i);

  const neutralized = {
    ...partial,
    refundSummary: {
      ...partial.refundSummary!,
      version: "order-refund-correction-v1" as const,
      kind: "administrative_correction" as const,
      returnedProductNetCents: 0,
      productFinancialCents: 0,
      cagnotteRestitutionCents: 0,
      totalFinancialCents: 0,
      productsFullyRefunded: false,
      entirePaymentRefunded: false,
      targetEventId: "a".repeat(64),
      revision: 1,
    },
  };
  const neutralizedPresentation = presentOrderFinancing(neutralized);
  assert.equal(neutralizedPresentation.verification, "verified", "une projection de correction valide reste cohérente");
  assert.deepEqual(refundAmounts(neutralizedPresentation), [0, 0]);
  const invalidCorrection = presentOrderFinancing({
    ...neutralized,
    refundSummary: { ...neutralized.refundSummary, targetEventId: "invalide" },
  });
  assert.equal(invalidCorrection.verification, "verified");
  assert.equal(invalidCorrection.refundVerificationRequired, true, "une vraie projection de correction incohérente reste signalée");

  const full = mixedOrderFixture({ paid: true, refund: "full" });
  assert.deepEqual(refundAmounts(presentOrderFinancing(full)), [9_200, 800], "H — retour total 92/8");

  const missingPaymentAmount = { ...beforePayment } as Order;
  delete missingPaymentAmount.paymentAmount;
  const invalid = presentOrderFinancing(missingPaymentAmount);
  assert.equal(invalid.verification, "required");
  const invalidText = renderOrderEmailContent(missingPaymentAmount, "Commande reçue.").text;
  assert.match(invalidText, /vérification nécessaire/i);
  assert.doesNotMatch(invalidText, /À régler hors cagnotte: 100,00 EUR/);

  const zeroOrder = zeroFinancingOrder();
  const zero = presentOrderFinancing(zeroOrder);
  assert.equal(zero.verification, "verified");
  assert.equal(zero.paymentCents, 0);
  assert.match(renderToStaticMarkup(<OrderFinancingSummary presentation={zero} showOrdinary />), /0,00(?:\u00a0|&#xA0;)EUR/);
  const enrolledWithoutUsePaid = presentOrderFinancing({ ...zeroOrder, paymentStatus: "paid" });
  assert.equal(enrolledWithoutUsePaid.kind, "ordinary");
  assert.equal(enrolledWithoutUsePaid.verification, "verified");

  const escaped = mixedOrderFixture({ customerName: "<script>alert('x')</script>" });
  escaped.customerMessage = "<img src=x onerror=alert(1)>";
  const escapedAdmin = renderAdminOrderEmailContent(escaped);
  assert.doesNotMatch(escapedAdmin.html, /<script>|<img src=x/i);
  assert.match(escapedAdmin.html, /&lt;script&gt;/);
  assert.match(adminAlertText(beforePayment, { includeAdminUrl: false }), /À régler hors cagnotte: 92,00\sEUR/);
  assert.doesNotMatch(adminAlertText(beforePayment, { includeAdminUrl: false }), /local_express/);

  const paymentLink = renderPaymentLinkEmailContent(beforePayment, {
    paymentLinkUrl: "https://payment.example.test/fictif",
    paymentLinkLabel: "Lien fictif",
    paymentLinkAmount: 92,
    paymentLinkCurrency: "EUR",
  });
  assert.match(paymentLink.text, /Financement prévu par cagnotte: 8,00\sEUR/);
  const inert = inertEmailHtmlForPreview(paymentLink.html);
  assert.doesNotMatch(inert, /href=|<img\b/i);

  const invoice = invoiceFixture(beforePayment);
  const invoiceBefore = JSON.stringify(invoice);
  const invoicePresentation = presentInvoiceFinancing(invoice);
  assert.equal(invoice.financing?.version, "order-financing-document-v1");
  assert.deepEqual(invoicePresentation && corePresentation(invoicePresentation), [10_000, 800, 9_200]);
  assert.equal(invoice.lines.some((line) => line.total < 0), false, "aucune ligne produit négative");
  const invoiceMail = renderInvoiceEmailContent(invoice, billingSettingsFixture());
  assert.match(invoiceMail.text, /Financement prévu par cagnotte: 8,00\sEUR/);
  assert.match(invoiceMail.text, /Montant prévu hors cagnotte: 92,00\sEUR/);
  assert.equal(presentInvoiceFinancing({ ...invoice, paymentStatus: "paid" })?.externalPaymentState, "planned", "le statut de la facture ne confirme pas la commande");
  const pdfBytes = await renderInvoicePdf(invoice, billingSettingsFixture());
  assert.equal((await PDFDocument.load(pdfBytes)).getPageCount(), 1);
  const pdfText = await extractPdfText(pdfBytes);
  assert.match(pdfText, /Financement de la commande/);
  assert.match(pdfText, /Financement prévu par cagnotte/);
  assert.match(pdfText, /92,00 EUR/);
  assert.match(pdfText, /Statut du règlement : En attente/);
  assert.doesNotMatch(pdfText, /DOCUMENT NON ÉMIS/);
  const pdfItems = await extractPdfTextItems(pdfBytes);
  assertSeparatedPdfRow(pdfItems, "Total du document", "100,00 EUR");

  const demonstrationPdf = await renderInvoicePdf(invoice, billingSettingsFixture(), {
    demonstrationDocument: true,
  });
  assert.match(await extractPdfText(demonstrationPdf), /DÉMONSTRATION — DOCUMENT NON ÉMIS/);

  const wideInvoice: Invoice = {
    ...invoice,
    subtotal: 1_234_567.89,
    total: 1_234_567.89,
    financing: undefined,
    lines: invoice.lines.map((line, index) => index === 0
      ? { ...line, quantity: 1, unitPrice: 1_234_567.89, total: 1_234_567.89 }
      : line),
  };
  const widePdfItems = await extractPdfTextItems(await renderInvoicePdf(wideInvoice, billingSettingsFixture()));
  assertSeparatedPdfRow(widePdfItems, "Total du document", "1234567,89 EUR");

  const longLabelInvoice = invoiceFixture(mixedOrderFixture({ cancelled: true }));
  const longLabelItems = await extractPdfTextItems(await renderInvoicePdf(longLabelInvoice, billingSettingsFixture()));
  assertSeparatedPdfRow(longLabelItems, "Règlement hors cagnotte", "92,00 EUR");
  const numericLayout = calculateSeparatedAmountRow({ labelX: 330, amountRightX: 555, amountWidth: 120 });
  assert.equal(numericLayout.amountX - (numericLayout.labelMaxWidth + 330), 12);
  assert.equal(JSON.stringify(invoice), invoiceBefore, "le rendu ne réécrit pas le document historique");

  const brokenInvoice = { ...invoice, total: 101 };
  assert.equal(presentInvoiceFinancing(brokenInvoice)?.verification, "required");
  assert.equal(buildOrderFinancingDocumentSnapshot(ordinary), undefined, "document ordinaire inchangé");

  const success = parseCheckoutSuccessSummary(JSON.stringify({
    orderId: "success-demo", items: [], total: 100, paymentAmount: 92,
    paymentStatus: "pending", cagnotteUse: { amountCents: 800, state: "reserved" },
  }), "success-demo");
  assert.equal(success?.paymentAmount, 92);
  assert.equal(success?.financingVerificationRequired, false);
  const incompleteSuccess = parseCheckoutSuccessSummary(JSON.stringify({
    orderId: "success-demo", items: [], total: 100,
    paymentStatus: "pending", cagnotteUse: { amountCents: 800, state: "reserved" },
  }), "success-demo");
  assert.equal(incompleteSuccess?.financingVerificationRequired, true);
  assert.equal(incompleteSuccess?.paymentAmount, 0, "aucun repli silencieux vers 100 EUR");

  assert.equal(externalCalls, 0);
  console.log("Cagnotte order presentation tests passed: cases A-H, messages, admin, document snapshot, PDF and pure rendering");
} finally {
  globalThis.fetch = originalFetch;
}

function coreAmounts(order: Order) {
  return corePresentation(presentOrderFinancing(order));
}

function corePresentation(value: { totalCents: number; cagnotteCents: number; paymentCents: number }) {
  return [value.totalCents, value.cagnotteCents, value.paymentCents];
}

function refundAmounts(value: ReturnType<typeof presentOrderFinancing>) {
  return [value.refund?.totalFinancialCents, value.refund?.cagnotteRestitutionCents];
}

function zeroFinancingOrder(): Order {
  const base = mixedOrderFixture();
  return {
    ...base,
    items: [],
    subtotal: 0,
    total: 0,
    paymentAmount: 0,
    deliveryFee: 0,
    cagnotte: {
      ...base.cagnotte!,
      snapshot: {
        ...base.cagnotte!.snapshot,
        lines: [], subtotalCents: 0, discountCents: 0, eligibleCents: 0,
        requestedCagnotteCents: 0, availableCagnotteCents: 0, cagnotteCapCents: 0,
        appliedCagnotteCents: 0, productsPaidCents: 0, loyaltyCents: 0,
      },
    },
    cagnotteReservationIntent: undefined,
  };
}

function renderCheckoutInstances(states: CagnotteCheckoutState[]) {
  return renderToStaticMarkup(<>
    {states.map((state, index) => (
      <CagnotteCheckoutView
        key={index}
        mode="checkout"
        state={state}
        authenticated
        onToggle={() => undefined}
        onAmountChange={() => undefined}
        onRequest={() => undefined}
        onMaximum={() => undefined}
        onAccept={() => undefined}
        onContinueWithout={() => undefined}
        onAcceptWithout={() => undefined}
        onRefreshWallet={() => undefined}
      />
    ))}
  </>);
}

function checkoutStateFixture(overrides: Partial<CagnotteCheckoutState>): CagnotteCheckoutState {
  return {
    identityKey: "demo-customer",
    contextKey: "demo-cart",
    walletPhase: "idle",
    wallet: null,
    walletErrorCode: null,
    selectionEnabled: false,
    amountInput: "",
    amountError: null,
    proposalPhase: "idle",
    proposal: null,
    acceptance: null,
    proposalErrorCode: null,
    fallbackPhase: "idle",
    fallbackQuote: null,
    fallbackAccepted: false,
    announcement: "",
    ...overrides,
  };
}

function checkoutWalletFixture(availableCents: number): CagnotteReadResponse {
  return {
    currency: "EUR",
    capabilities: { canReadWallet: true, canRequestReservation: true, canAccrueLoyalty: false },
    wallet: { status: "active", availableCents, pendingCents: 350, reservedCents: 500, regularizationCents: 0 },
    history: {
      items: [],
      nextCursor: null,
      completeness: "timestamped_movements_only",
      limitation: "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet.",
    },
    freshness: { readAt: "2026-09-06T10:00:00.000Z", consistency: "wallet_and_page", refreshStartsAtFirstPage: true },
  };
}

function checkoutQuoteFixture(
  requestedCents: number,
  proposedCents: number,
  payableCents: number,
  limitationReasons: NonNullable<OrderQuote["cagnotteUse"]>["limitationReasons"],
): OrderQuote {
  return {
    subtotal: 100,
    subtotalBeforeDiscount: 100,
    deliveryFee: 0,
    deliveryFeeStatus: "configured",
    deliveryNote: "Livraison fictive",
    discountAmount: 0,
    promoApplied: false,
    postalFreeShippingApplied: false,
    total: 100,
    cagnotteUse: {
      quoteVersion: "cagnotte-checkout-quote-v1",
      quoteFingerprint: "presentation-changed",
      currency: "EUR",
      productsAfterDiscountsCents: 10_000,
      deliveryCents: 0,
      requestedCagnotteCents: requestedCents,
      proposedCagnotteCents: proposedCents,
      cagnotteCapCents: 2000,
      payableCents,
      estimatedLoyaltyCents: 0,
      loyaltyAccrualStatus: "suspended",
      limitationReasons,
      compatibility: { status: "allowed", blockingAdvantages: [], pendingAdvantages: [] },
    },
  };
}

function assertUniqueIdsAndAssociations(html: string) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "chaque instance doit avoir ses propres identifiants");
  const knownIds = new Set(ids);
  for (const match of html.matchAll(/\s(?:for|aria-labelledby)="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) assert.ok(knownIds.has(id), `association HTML absente : ${id}`);
  }
}

async function extractPdfText(bytes: Uint8Array) {
  return (await extractPdfTextItems(bytes)).map((item) => item.str).join(" ");
}

type PdfTextItem = {
  str: string;
  width: number;
  transform: number[];
};

async function extractPdfTextItems(bytes: Uint8Array): Promise<PdfTextItem[]> {
  const moduleName = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs = await import(moduleName) as {
    getDocument(input: { data: Uint8Array; disableWorker: boolean }): {
      promise: Promise<{
        numPages: number;
        getPage(pageNumber: number): Promise<{
          getTextContent(): Promise<{ items: Array<{ str?: string; width?: number; transform?: number[] }> }>;
        }>;
        destroy(): Promise<void>;
      }>;
    };
  };
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise;
  try {
    const values: PdfTextItem[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      values.push(...content.items
        .filter((item) => item.str && item.transform)
        .map((item) => ({ str: item.str || "", width: item.width || 0, transform: item.transform || [] })));
    }
    return values;
  } finally {
    await document.destroy();
  }
}

function assertSeparatedPdfRow(
  items: PdfTextItem[],
  labelFragment: string,
  amount: string,
) {
  const label = items.find((item) => item.str.includes(labelFragment));
  assert.ok(label, `libellé PDF absent : ${labelFragment}`);
  const amountItem = items.find((item) =>
    item.str === amount && Math.abs(item.transform[5] - label.transform[5]) < 0.5,
  );
  assert.ok(amountItem, `montant PDF absent sur la ligne : ${amount}`);
  assert.ok(
    label.transform[4] + label.width + 11.9 <= amountItem.transform[4],
    `${labelFragment} doit conserver au moins 12 points avant ${amount}`,
  );
}
