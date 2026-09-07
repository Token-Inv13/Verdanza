import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { CagnotteView } from "../src/components/cagnotte/CagnottePanel.js";
import {
  CagnotteCheckoutView,
  CheckoutAttemptNotice,
  CheckoutCreationSummary,
} from "../src/components/cagnotte/CagnotteCheckoutPanel.js";
import type { CagnotteCheckoutState } from "../src/services/cagnotteCheckoutService.js";
import type { CagnottePanelState } from "../src/services/cagnotteService.js";
import type { CheckoutOrderResult } from "../src/services/ordersService.js";
import type { OrderQuote } from "../src/services/quoteService.js";
import type { CagnotteReadResponse } from "../src/types/cagnotteRead.js";
import { CagnotteAdminToolsView, type CagnotteAdminViewModel } from "../src/components/cagnotte/CagnotteAdminTools.js";
import type { CagnotteAdminInspection, CorrectionPreview, RefundPreview } from "../src/types/cagnotteAdmin.js";
import {
  inertEmailHtmlForPreview,
  renderAdminOrderEmailContent,
  renderOrderEmailContent,
} from "../api/_server/email.js";
import { adminAlertText } from "../api/_server/orderAlerts.js";
import { renderInvoicePdf } from "../api/_server/invoicePdf.js";
import { OrderFinancingSummary } from "../src/components/orders/OrderFinancingSummary.js";
import { presentInvoiceFinancing, presentOrderFinancing } from "../src/lib/orderFinancing.js";
import {
  billingSettingsFixture,
  invoiceFixture,
  mixedOrderFixture,
} from "./cagnotteOrderPresentationFixtures.js";

const outputDirectory = resolve("node_modules/.cache/verdanza-cagnotte-preview");
const advantagesOutputPath = resolve(outputDirectory, "mes-avantages.html");
const checkoutOutputPath = resolve(outputDirectory, "panier-cagnotte.html");
const recapsOutputPath = resolve(outputDirectory, "recapitulatifs-cagnotte.html");
const invoiceOutputPath = resolve(outputDirectory, "facture-cagnotte-fictive.pdf");
const administrationOutputPath = resolve(outputDirectory, "administration-cagnotte.html");
const advantagesStyles = await readFile(resolve("src/styles/cagnotte.css"), "utf8");
const checkoutStyles = await readFile(resolve("src/styles/cagnotte-checkout.css"), "utf8");
const recapsStyles = `
  .preview-surface,[data-order-financing]{border:1px solid rgba(14,55,38,.14);border-radius:.65rem;background:#fff;padding:1.1rem;box-shadow:0 8px 24px rgba(14,55,38,.05)}
  .preview-surface>div{max-width:100%}.preview-surface pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f1e6;border-radius:.45rem;padding:.9rem;color:#0e3726}
  [data-order-financing] strong{color:#0e3726}[data-order-financing] dl{display:grid;gap:.3rem;margin:.7rem 0 0}[data-order-financing] dl>div{display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:start;gap:1rem;border-bottom:1px solid rgba(14,55,38,.08);padding:.2rem 0}[data-order-financing] dt,[data-order-financing] dd{min-width:0;margin:0}[data-order-financing] dd{font-weight:700;color:#0e3726;text-align:right;white-space:nowrap}[data-order-financing] p{color:#555;line-height:1.55}
`;
const administrationStyles = await readFile(resolve("src/styles/cagnotte-admin.css"), "utf8");

const normal = response({ availableCents: 1275, pendingCents: 480, reservedCents: 800, regularizationCents: 0 }, [
  movement("Cagnotte réservée", 800, "2026-09-04T09:00:00.000Z", [
    { compartment: "available", deltaCents: -800 }, { compartment: "reserved", deltaCents: 800 },
  ]),
  movement("Gain en attente", 480, "2026-09-03T14:12:00.000Z", [{ compartment: "pending", deltaCents: 480 }]),
  movement("Gain devenu disponible", 650, "2026-08-28T09:30:00.000Z", [
    { compartment: "pending", deltaCents: -650 }, { compartment: "available", deltaCents: 650 },
  ]),
]);
const regularization = response({ availableCents: 0, pendingCents: 210, reservedCents: 0, regularizationCents: 325 }, [
  movement("Régularisation des avantages", -325, "2026-09-02T11:05:00.000Z", [{ compartment: "regularization", deltaCents: 325 }]),
  movement("Gain affecté à une régularisation", 175, "2026-09-01T16:40:00.000Z", [
    { compartment: "pending", deltaCents: -175 }, { compartment: "regularization", deltaCents: -175 },
  ]),
]);
const empty = response({ availableCents: 0, pendingCents: 0, reservedCents: 0, regularizationCents: 0 }, []);
const admin = response({ availableCents: 2340, pendingCents: 620, reservedCents: 0, regularizationCents: 0 }, [
  movement("Ajustement de fidélité après retour", -150, "2026-08-30T08:15:00.000Z", [{ compartment: "available", deltaCents: -150 }]),
]);

const advantageCards = [
  ["Disponible et attente", ready(normal), undefined, "advantages-normal"],
  ["Régularisation", ready(regularization), undefined, "advantages-regularization"],
  ["Portefeuille vide", ready(empty), undefined, "advantages-empty"],
  ["Panneau administrateur", ready(admin), "Camille Martin", "advantages-admin"],
] as const;

const advantagesContent = advantageCards.map(([label, state, customerLabel, instanceId]) => `<article class="preview-card"><p class="preview-label">${label}</p>${renderToStaticMarkup(
  <CagnotteView state={state} customerLabel={customerLabel} instanceId={instanceId} demonstration />,
)}</article>`).join("\n");

const advantagesHtml = page(
  "Aperçu fictif — Mes avantages Verdanza",
  "Mes avantages",
  "Aperçu statique des états préparés localement. Règles commerciales définies — programme non activé.",
  advantagesContent,
  advantagesStyles,
);

const usableWallet = response(
  { availableCents: 2000, pendingCents: 350, reservedCents: 500, regularizationCents: 0 },
  [],
);
const changedWallet = response(
  { availableCents: 400, pendingCents: 350, reservedCents: 500, regularizationCents: 0 },
  [],
);
const acceptedEightEuro = quote(800, 800, 9200, "quote-eight", "estimated");
const changedFourEuro = quote(800, 400, 9600, "quote-four", "suspended", ["available_balance"]);
const blockedPromotion = quote(800, 0, 10000, "quote-blocked", "estimated", ["compatibility_blocked"], "blocked", 500);
const changedAmountState = checkoutState({
  wallet: changedWallet,
  walletPhase: "ready",
  selectionEnabled: true,
  amountInput: "8,00",
  proposalPhase: "changed",
  proposal: changedFourEuro,
  announcement: "Le montant proposé a changé. Validez le nouveau récapitulatif avant la commande.",
});
validateChangedAmountFixture(changedAmountState);

const checkoutCards = [
  previewCard("Choix désactivé", <CagnotteCheckoutView {...viewProps(checkoutState({
    wallet: usableWallet,
    walletPhase: "ready",
  }))} mode="cart" instanceId="checkout-disabled" demonstration />),
  previewCard("20 € disponibles · 8 € proposés", <CagnotteCheckoutView {...viewProps(checkoutState({
    wallet: usableWallet,
    walletPhase: "ready",
    selectionEnabled: true,
    amountInput: "8,00",
    proposalPhase: "ready",
    proposal: acceptedEightEuro,
    acceptance: {
      quoteVersion: "cagnotte-checkout-quote-v1",
      quoteFingerprint: "quote-eight",
      acceptedCagnotteCents: 800,
      acceptedPayableCents: 9200,
    },
  }))} mode="checkout" instanceId="checkout-accepted" demonstration />),
  previewCard("4 € disponibles · montant modifié · nouvelle validation", <CagnotteCheckoutView
    {...viewProps(changedAmountState)} mode="checkout" instanceId="checkout-changed" demonstration />),
  previewCard("Incompatibilité promotionnelle", <CagnotteCheckoutView {...viewProps(checkoutState({
    wallet: usableWallet,
    walletPhase: "ready",
    selectionEnabled: true,
    amountInput: "8,00",
    proposalPhase: "ready",
    proposal: blockedPromotion,
  }))} mode="checkout" instanceId="checkout-blocked" demonstration />),
  previewCard("Réponse de création perdue", <CheckoutAttemptNotice
    phase="uncertain"
    error="La réponse n’est pas arrivée. La commande peut avoir été enregistrée : reprenez cette même tentative."
    onRetry={() => undefined}
    demonstration
  />),
  previewCard("Commande enregistrée · paiement attendu", <CheckoutCreationSummary result={successfulOrder()} demonstration />),
];

const checkoutHtml = page(
  "Aperçu fictif — Panier et checkout cagnotte Verdanza",
  "Panier et checkout",
  "Aperçu statique des véritables composants d’interface. Aucun clic ne lance de devis, de réservation ou de commande.",
  checkoutCards.join("\n"),
  checkoutStyles,
);

const beforePaymentOrder = mixedOrderFixture();
const paidOrder = mixedOrderFixture({ paid: true });
const partialRefundOrder = mixedOrderFixture({ paid: true, refund: "partial" });
const documentInvoice = invoiceFixture(beforePaymentOrder);
const documentPresentation = presentInvoiceFinancing(documentInvoice);
if (!documentPresentation) throw new Error("Snapshot documentaire fictif absent.");
const beforePaymentEmail = renderOrderEmailContent(
  beforePaymentOrder,
  "Votre commande fictive a bien été enregistrée.",
);
const paidEmail = renderOrderEmailContent(
  paidOrder,
  "Le règlement de votre commande fictive a été confirmé.",
);
const adminEmail = renderAdminOrderEmailContent(beforePaymentOrder);
const recapsContent = [
  emailPreviewCard("Confirmation avant paiement", beforePaymentEmail.html),
  emailPreviewCard("Confirmation après paiement", paidEmail.html),
  `<article class="preview-card preview-surface"><p class="preview-label">Récapitulatif administrateur</p>${inertEmailHtmlForPreview(adminEmail.html)}<pre>${escapePreview(adminAlertText(beforePaymentOrder, { includeAdminUrl: false }))}</pre></article>`,
  previewCard("Présentation du financement sur le document", <OrderFinancingSummary presentation={documentPresentation} title="Bloc du document fictif" showOrdinary context="document" />),
  previewCard("Retour partiel enregistré", <OrderFinancingSummary presentation={presentOrderFinancing(partialRefundOrder)} title="Commande et retour fictifs" />),
].join("\n");
const recapsHtml = page(
  "Aperçu fictif — Récapitulatifs cagnotte Verdanza",
  "Récapitulatifs, messages et document",
  "Rendus statiques produits par les véritables templates et composants. Le PDF fictif est généré séparément dans le même dossier.",
  recapsContent,
  `${checkoutStyles}\n${recapsStyles}`,
);

const adminInspection = administrationInspectionFixture();
const recordedRefund = administrationRefundFixture();
const correctedRefund = administrationCorrectionFixture(false);
const reviewCorrection = administrationCorrectionFixture(true);
const administrationCards = [
  previewCard("Saisie d’un retour", <CagnotteAdminToolsView model={adminModel("refund", adminInspection)} form={administrationFormFixture()} />),
  previewCard("Résultat enregistré · scénario 100 / 8 / 92 €", <CagnotteAdminToolsView model={{ ...adminModel("refund", adminInspection), refundPreview: recordedRefund, notice: "Déclaration enregistrée. Aucun remboursement bancaire n’a été exécuté." }} form={administrationFormFixture()} />),
  previewCard("Correction d’une déclaration", <CagnotteAdminToolsView model={{ ...adminModel("correction", adminInspection), correctionPreview: correctedRefund, notice: "Correction prévisualisée par le serveur." }} form={administrationFormFixture()} />),
  previewCard("Correction nécessitant vérification", <CagnotteAdminToolsView model={{ ...adminModel("correction", adminInspection), correctionPreview: reviewCorrection, notice: reviewCorrection.reviewReason || "Correction à vérifier." }} form={administrationFormFixture()} />),
  previewCard("Revue d’un impayé · transport incertain", <CagnotteAdminToolsView model={adminModel("unpaid", adminInspection)} form={administrationFormFixture()} />),
].join("\n");
const administrationHtml = page(
  "Aperçu fictif — Administration de la cagnotte Verdanza",
  "Outils administratifs de cagnotte",
  "Aperçu statique des véritables composants. Les boutons sont inertes et aucune opération bancaire, API ou ressource distante n’est appelée.",
  administrationCards,
  administrationStyles,
);

for (const [name, content] of [["Mes avantages", advantagesHtml], ["Panier cagnotte", checkoutHtml], ["Récapitulatifs cagnotte", recapsHtml], ["Administration cagnotte", administrationHtml]] as const) {
  if (/<script\b|https?:\/\/|firebase|analytics|href\s*=/i.test(content)) {
    throw new Error(`${name} : l’aperçu doit rester autonome et inerte.`);
  }
  validateStandalonePreview(name, content);
}
await mkdir(outputDirectory, { recursive: true });
await writeFile(advantagesOutputPath, advantagesHtml, "utf8");
await writeFile(checkoutOutputPath, checkoutHtml, "utf8");
await writeFile(recapsOutputPath, recapsHtml, "utf8");
await writeFile(administrationOutputPath, administrationHtml, "utf8");
const invoicePdf = await PDFDocument.load(await renderInvoicePdf(
  documentInvoice,
  billingSettingsFixture(),
  { demonstrationDocument: true },
));
const previewDocumentDate = new Date("2026-09-06T10:00:00.000Z");
invoicePdf.setCreationDate(previewDocumentDate);
invoicePdf.setModificationDate(previewDocumentDate);
await writeFile(invoiceOutputPath, await invoicePdf.save());
console.log(advantagesOutputPath);
console.log(checkoutOutputPath);
console.log(recapsOutputPath);
console.log(administrationOutputPath);
console.log(invoiceOutputPath);

function page(title: string, heading: string, intro: string, content: string, componentStyles: string) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
*{box-sizing:border-box}body{margin:0;background:#faf8f2;color:#111;font-family:Inter,Arial,sans-serif}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.preview-shell{width:min(1180px,calc(100% - 2rem));margin:0 auto;padding:2.2rem 0 4rem}.preview-title{font-family:Georgia,serif;color:#0e3726;font-size:clamp(2rem,6vw,4rem);margin:0}.preview-intro{max-width:780px;color:rgba(17,17,17,.65);line-height:1.65}.preview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.25rem;margin-top:2rem}.preview-card{min-width:0}.preview-label{font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#8c6a2f}.preview-card button,.preview-card input{pointer-events:none}@media(max-width:850px){.preview-grid{grid-template-columns:1fr}}
${componentStyles}
</style></head><body><main class="preview-shell"><h1 class="preview-title">${heading}</h1><p class="preview-intro"><strong>Démonstration — données fictives.</strong> ${intro}</p><div class="preview-grid">${content}</div></main></body></html>`;
}

function response(
  wallet: { availableCents: number; pendingCents: number; reservedCents: number; regularizationCents: number },
  items: CagnotteReadResponse["history"]["items"],
): CagnotteReadResponse {
  return {
    currency: "EUR",
    capabilities: { canReadWallet: true, canRequestReservation: true, canAccrueLoyalty: true },
    wallet: { status: "active", ...wallet },
    history: { items, nextCursor: null, completeness: "timestamped_movements_only", limitation: "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet." },
    freshness: { readAt: "2026-09-05T10:00:00.000Z", consistency: "wallet_and_page", refreshStartsAtFirstPage: true },
  };
}

function movement(label: CagnotteReadResponse["history"]["items"][number]["label"], amountCents: number, occurredAt: string, details: CagnotteReadResponse["history"]["items"][number]["details"]) {
  return { label, amountCents, occurredAt, details };
}

function ready(data: CagnotteReadResponse): CagnottePanelState {
  return { phase: "ready", data, errorCode: null };
}

function adminModel(mode: "refund" | "correction" | "unpaid", inspection: CagnotteAdminInspection): CagnotteAdminViewModel {
  return { phase: "ready", inspection, mode, refundPreview: null, correctionPreview: null, notice: "", uncertain: false };
}

function administrationFormFixture(): Parameters<typeof CagnotteAdminToolsView>[0]["form"] {
  return {
    lines: { fleurs: "" }, delivery: "", source: "admin", reference: "", confirmedAt: "2026-09-06T13:00:00",
    reason: "product_return", declaredFinancial: "", correctionReason: "", correctionReference: "",
    reviewOutcome: "payment_uncertain", reviewSource: "", reviewReason: "", externalVerificationConfirmed: false,
  };
}

function administrationInspectionFixture(): CagnotteAdminInspection {
  const effective = {
    lines: [{ lineId: "fleurs", returnedNetCents: 2500 }], returnedProductNetCents: 2500,
    productFinancialCents: 2300, cagnotteRestitutionCents: 200, deliveryFinancialCents: 0, totalFinancialCents: 2300,
  };
  return {
    kind: "administrative_refund_inspection",
    order: { id: "CMD-DEMO-100", customer: { id: "client-demo", name: "Camille Démo", email: "camille@example.test" },
      orderStatus: "delivered", paymentStatus: "paid", totalCents: 10000, paymentAmountCents: 9200, deliveryCents: 0 },
    financing: { productsNetCents: 10000, cagnotteCents: 800, externalProductsCents: 9200, externalTotalCents: 9200, deliveryCents: 0 },
    wallet: { pendingCents: 0, availableCents: 1745, reservedCents: 0, regularizationCents: 0 },
    lines: [{ lineId: "fleurs", label: "Fleurs CBD fictives", initialNetCents: 10000, returnedNetCents: 2500, remainingNetCents: 7500 }],
    effective,
    history: [{ id: "a".repeat(64), type: "initial_declaration", revision: 0, recordedAt: "2026-09-06T11:00:00.000Z", reference: "retour-demo-25", declaredFinancialCents: 2300,
      returnedProductNetCents: 2500, financialCents: 2300, cagnotteRestitutionCents: 200, resultingAvailableCents: 1745, effective: true }],
    correctionTarget: { eventId: "a".repeat(64), revision: 0, effective },
    unpaid: { reservedAmountCents: 800, reservationState: "reserved", reservedAt: "2026-09-02T08:00:00.000Z", ageHours: 99, reviewRequired: true,
      payment: { status: "payment_link_sent", uncertain: true, confirmedAt: null },
      linkTransmission: { requestId: "demo-request", status: "unknown", transportStatus: "unknown", sendingActive: false, uncertain: true },
      stateVersion: "b".repeat(64), review: { outcome: "payment_uncertain", source: "Tableau prestataire fictif", reason: "Encaissement non déterminé", reviewedAt: "2026-09-06T10:00:00.000Z", reviewedByEmail: "admin@example.test", current: true } },
  };
}

function administrationRefundFixture(): RefundPreview {
  const before = { lines: [{ lineId: "fleurs", returnedNetCents: 0 }], returnedProductNetCents: 0, productFinancialCents: 0, cagnotteRestitutionCents: 0, deliveryFinancialCents: 0, totalFinancialCents: 0 };
  const after = { lines: [{ lineId: "fleurs", returnedNetCents: 2500 }], returnedProductNetCents: 2500, productFinancialCents: 2300, cagnotteRestitutionCents: 200, deliveryFinancialCents: 0, totalFinancialCents: 2300 };
  return { kind: "administrative_refund_recorded", orderId: "CMD-DEMO-100", currency: "EUR", additionalReturns: [{ lineId: "fleurs", additionalNetCents: 2500 }],
    productFinancialCents: 2300, cagnotteRestitutionCents: 200, deliveryFinancialCents: 0, totalFinancialCents: 2300,
    correction: { theoreticalCents: 115, appliedCents: 115, pendingDeltaCents: 0, availableDeltaCents: -115, regularizationDeltaCents: 0, remainingGainCents: 345 },
    restitution: { grossCents: 200, compensationCents: 0, availableIncreaseCents: 200, availableAfterCents: 1745, cumulativeCents: 200, reservationState: "consumed" },
    before, after, previewVersion: "c".repeat(64), recordedAt: "2026-09-06T11:00:00.000Z" };
}

function administrationCorrectionFixture(requiresReview: boolean): CorrectionPreview {
  const previousEffective = administrationInspectionFixture().effective;
  const effective = { lines: [{ lineId: "fleurs", returnedNetCents: 0 }], returnedProductNetCents: 0, productFinancialCents: 0, cagnotteRestitutionCents: 0, deliveryFinancialCents: 0, totalFinancialCents: 0 };
  return { kind: requiresReview ? "correction_requires_review" : "refund_correction_preview", orderId: "CMD-DEMO-100", currency: "EUR", targetEventId: "a".repeat(64), previousRevision: 0, revision: 1,
    replacementReturns: [], deliveryRefundCents: 0, declaredFinancialCents: 0, previousEffective, effective,
    differential: { returnedProductNetCents: -2500, productFinancialCents: -2300, cagnotteRestitutionCents: -200, deliveryFinancialCents: 0, totalFinancialCents: -2300,
      loyaltyCents: 115, pendingDeltaCents: 0, availableDeltaCents: -85, regularizationDeltaCents: 0 },
    walletAfter: { pendingCents: 0, availableCents: requiresReview ? 40 : 1660, reservedCents: requiresReview ? 800 : 0, regularizationCents: 0 },
    remainingGainCents: 460, reservationState: "consumed", previewVersion: "d".repeat(64),
    ...(requiresReview ? { reviewReason: "Le crédit restitué a été réservé ou utilisé après la déclaration." } : {}) };
}

function checkoutState(overrides: Partial<CagnotteCheckoutState> = {}): CagnotteCheckoutState {
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

function viewProps(state: CagnotteCheckoutState) {
  return {
    state,
    authenticated: true,
    onToggle: () => undefined,
    onAmountChange: () => undefined,
    onRequest: () => undefined,
    onMaximum: () => undefined,
    onAccept: () => undefined,
    onContinueWithout: () => undefined,
    onAcceptWithout: () => undefined,
  };
}

function quote(
  requestedCents: number,
  proposedCents: number,
  payableCents: number,
  fingerprint: string,
  loyaltyAccrualStatus: "estimated" | "suspended",
  limitationReasons: NonNullable<OrderQuote["cagnotteUse"]>["limitationReasons"] = [],
  compatibilityStatus: NonNullable<OrderQuote["cagnotteUse"]>["compatibility"]["status"] = "allowed",
  estimatedLoyaltyCents = loyaltyAccrualStatus === "estimated" ? 460 : 0,
): OrderQuote {
  return {
    subtotal: 100,
    subtotalBeforeDiscount: 100,
    deliveryFee: 0,
    deliveryFeeStatus: "configured",
    deliveryNote: "Retrait local fictif",
    discountAmount: 0,
    promoApplied: compatibilityStatus === "blocked",
    postalFreeShippingApplied: false,
    total: 100,
    cagnotteUse: {
      quoteVersion: "cagnotte-checkout-quote-v1",
      quoteFingerprint: fingerprint,
      currency: "EUR",
      productsAfterDiscountsCents: 10000,
      deliveryCents: 0,
      requestedCagnotteCents: requestedCents,
      proposedCagnotteCents: proposedCents,
      cagnotteCapCents: 2000,
      payableCents,
      estimatedLoyaltyCents,
      loyaltyAccrualStatus,
      limitationReasons,
      compatibility: {
        status: compatibilityStatus,
        blockingAdvantages: compatibilityStatus === "blocked" ? ["promotion_code"] : [],
        pendingAdvantages: [],
      },
    },
  };
}

function previewCard(label: string, child: React.ReactNode) {
  return `<article class="preview-card"><p class="preview-label">${label}</p>${renderToStaticMarkup(child)}</article>`;
}

function emailPreviewCard(label: string, html: string) {
  return `<article class="preview-card preview-surface"><p class="preview-label">${label}</p>${inertEmailHtmlForPreview(html)}</article>`;
}

function escapePreview(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function validateChangedAmountFixture(state: CagnotteCheckoutState) {
  const availableCents = state.wallet?.wallet.availableCents;
  const use = state.proposal?.cagnotteUse;
  if (!use || availableCents !== 400 || use.requestedCagnotteCents !== 800 ||
    use.proposedCagnotteCents !== availableCents || use.payableCents !== 9600 ||
    !use.limitationReasons.includes("available_balance") || state.acceptance !== null) {
    throw new Error("Fixture montant modifié incohérente ou déjà acceptée.");
  }
}

function validateStandalonePreview(name: string, content: string) {
  const ids = [...content.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  if (new Set(ids).size !== ids.length) throw new Error(`${name} : identifiants HTML dupliqués.`);
  const knownIds = new Set(ids);
  for (const match of content.matchAll(/\s(?:for|aria-labelledby)="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) {
      if (!knownIds.has(id)) throw new Error(`${name} : association vers l’identifiant absent ${id}.`);
    }
  }
  if (content.includes('class="sr-only"') && !content.includes(".sr-only{position:absolute;width:1px")) {
    throw new Error(`${name} : style accessible sr-only absent.`);
  }
}


function successfulOrder(): CheckoutOrderResult {
  return {
    orderId: "CMD-DEMO-4D",
    total: 100,
    paymentAmount: 92,
    paymentStatus: "pending",
    orderStatus: "new",
    cagnotteUse: { amountCents: 800, state: "reserved" },
    summary: {
      items: [],
      subtotal: 100,
      deliveryFee: 0,
      deliveryMethod: "postal",
      discountAmount: 0,
      appliedPromotions: [],
    },
  };
}
