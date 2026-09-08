import { createCagnotteReservationIntent } from "../api/_server/cagnotteReservations.js";
import type { CagnotteReservationTestProgram } from "../api/_server/cagnotteReservationTypes.js";
import { buildCustomerInvoiceLines } from "../src/lib/customerInvoiceLines.js";
import { buildOrderFinancingDocumentSnapshot } from "../src/lib/orderFinancing.js";
import type { BillingSettings, Invoice, Order, OrderRefundSummary } from "../src/types/index.js";

const program: CagnotteReservationTestProgram = Object.freeze({
  mode: "local_test",
  programVersion: "presentation-fixture-v1",
  calculationVersion: "cagnotte-math-v1",
  startsAtEpochMs: 1_000,
  reservationVersion: "cagnotte-reservation-v1",
  reservationsEnabled: true,
});

export function mixedOrderFixture(options: {
  deliveryFee?: number;
  paid?: boolean;
  cancelled?: boolean;
  refund?: "partial" | "full";
  customerName?: string;
} = {}): Order {
  const deliveryFee = options.deliveryFee ?? 0;
  const orderId = "order-presentation-demo";
  const beneficiaryId = "customer-presentation-demo";
  const createdAtEpochMs = 10_000;
  const intent = createCagnotteReservationIntent({
    orderId,
    beneficiaryId,
    createdAtEpochMs,
    calculation: {
      lines: [{ lineId: "line-demo", initialCents: 10_000 }],
      discounts: [],
      requestedCagnotteCents: 800,
      availableCagnotteCents: 800,
    },
  }, program);
  if (!intent) throw new Error("Fixture de réservation indisponible.");
  const paidAt = "2026-09-06T11:00:00.000Z";
  const refundSummary = options.refund ? refundFixture(options.refund) : undefined;
  return {
    id: orderId,
    checkoutRequestId: "11111111-1111-4111-8111-111111111111",
    customerId: beneficiaryId,
    customerEmail: "camille@example.test",
    customerPhone: "0600000000",
    customerName: options.customerName || "Camille Exemple",
    items: [{
      lineId: "line-demo",
      productId: "product-demo",
      name: "Fleur fictive",
      quantity: 10,
      unitPrice: 10,
      lineTotal: 100,
    }],
    subtotal: 100,
    deliveryFee,
    discountAmount: 0,
    promotionDiscountTotal: 0,
    appliedPromotions: [],
    total: 100 + deliveryFee,
    paymentAmount: 92 + deliveryFee,
    paymentStatus: options.cancelled ? "cancelled" : options.paid ? "paid" : "pending",
    preferredPaymentMethod: "card_payment_link",
    finalPaymentMethod: options.paid ? "card_payment_link" : undefined,
    orderStatus: options.cancelled ? "cancelled" : "confirmed",
    deliveryMethod: deliveryFee ? "postal" : "local_express",
    deliveryAddress: {
      firstName: "Camille",
      lastName: "Exemple",
      line1: "1 rue des Données Fictives",
      postalCode: "13100",
      city: "Aix-en-Provence",
      country: "France",
    },
    deliveryFeeStatus: "configured",
    cagnotte: {
      schemaVersion: 1,
      beneficiaryId,
      programVersion: program.programVersion,
      calculationVersion: "cagnotte-math-v1",
      createdAtEpochMs,
      snapshot: intent.order.snapshot,
    },
    cagnotteReservationIntent: intent,
    ...(options.paid ? {
      paidAt,
      paymentConfirmedAt: paidAt,
      cagnottePaymentEvidence: {
        schemaVersion: 1,
        version: "cagnotte-payment-evidence-v1",
        reservationState: "consumed",
        loyaltyAccrualDecision: "attributed",
        recordedAt: paidAt,
      } as const,
    } : {}),
    ...(options.cancelled ? { cancelledAt: "2026-09-06T12:00:00.000Z" } : {}),
    ...(refundSummary ? { refundSummary } : {}),
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
  };
}

export function ordinaryOrderFixture(): Order {
  const ordinary = { ...mixedOrderFixture() };
  delete ordinary.cagnotte;
  delete ordinary.cagnotteReservationIntent;
  delete ordinary.paymentAmount;
  return ordinary;
}

export function invoiceFixture(order: Order): Invoice {
  const financing = buildOrderFinancingDocumentSnapshot(order);
  return {
    id: "invoice-presentation-demo",
    invoiceNumber: "VER-DEMO-4E",
    orderId: order.id,
    origin: "order",
    status: "draft",
    customerName: order.customerName || "Client fictif",
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    customerAddress: order.deliveryAddress,
    lines: buildCustomerInvoiceLines(order),
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discountAmount: order.discountAmount || 0,
    appliedPromotions: order.appliedPromotions || [],
    total: order.total,
    ...(financing ? { financing } : {}),
    paymentMethod: "Carte bancaire via lien",
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function billingSettingsFixture(): BillingSettings {
  return {
    id: "billing",
    tradeName: "Verdanza",
    displayName: "Verdanza",
    legalName: "Démonstration locale",
    legalForm: "Données fictives",
    siren: "000000000",
    siret: "00000000000000",
    vatMode: "not_configured",
    address: "Adresse fictive",
    phone: "00 00 00 00 00",
    email: "contact@example.test",
    paymentTerms: "Démonstration locale sans valeur commerciale.",
    legalMentions: "Données fictives.",
    isManuallyValidated: false,
    validationWarning: "Démonstration locale.",
  };
}

function refundFixture(kind: "partial" | "full"): OrderRefundSummary {
  const full = kind === "full";
  return {
    version: "order-mixed-refund-record-v1",
    returnedProductNetCents: full ? 10_000 : 2_500,
    productFinancialCents: full ? 9_200 : 2_300,
    cagnotteRestitutionCents: full ? 800 : 200,
    deliveryFinancialCents: 0,
    totalFinancialCents: full ? 9_200 : 2_300,
    productsFullyRefunded: full,
    entirePaymentRefunded: full,
    kind: "administrative_confirmation",
    recordedAt: "2026-09-06T13:00:00.000Z",
  };
}
