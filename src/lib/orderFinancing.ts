import type { OrderFinancingDocumentSnapshot } from "../types/index.js";
import type {
  CagnotteOrderEnrollment,
  CagnotteOrderReservationIntent,
  CagnottePaymentEvidence,
} from "../types/cagnotte.js";

export type OrderFinancingSource = {
  id?: string;
  customerId?: string;
  total: number;
  deliveryFee?: number;
  paymentAmount?: number;
  paymentStatus?: string;
  orderStatus?: string;
  paidAt?: string;
  paymentConfirmedAt?: string;
  cancelledAt?: string;
  cagnotte?: CagnotteOrderEnrollment;
  cagnotteReservationIntent?: CagnotteOrderReservationIntent;
  cagnottePaymentEvidence?: CagnottePaymentEvidence;
};

export type OrderFinancingAmounts = {
  kind: "ordinary" | "cagnotte";
  totalCents: number;
  cagnotteCents: number;
  paymentCents: number;
};

export type OrderFinancingPresentation = OrderFinancingAmounts & {
  verification: "verified" | "required";
  reason?: string;
  cagnotteState: "not_applicable" | "planned" | "consumed";
  externalPaymentState: "planned" | "confirmed";
  orderCancelled: boolean;
};

export type FinancingDisplayItem = {
  label: string;
  cents: number;
};

/** Exact euro conversion shared by order payment and its presentation consumers. */
export function exactEuroCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Montant serveur invalide.");
  }
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!match) throw new Error("Montant serveur invalide.");
  const digits = BigInt(match[1] + (match[2] || ""));
  const scale = (match[2]?.length || 0) - Number(match[3] || 0) - 2;
  const divisor = scale > 0 ? 10n ** BigInt(scale) : 1n;
  const cents = scale > 0
    ? (digits + divisor / 2n) / divisor
    : digits * 10n ** BigInt(-scale);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Centimes serveur non sûrs.");
  }
  const result = Number(cents);
  if (Math.abs(value - result / 100) > Number.EPSILON * Math.max(1, value) * 2) {
    throw new Error("Fraction de centime serveur non résolue.");
  }
  return result;
}

/** E + F and E + F - R from the persisted order snapshot only. */
export function deriveOrderFinancingAmounts(
  order: OrderFinancingSource,
): OrderFinancingAmounts {
  const totalCents = exactEuroCents(order.total);
  if (!order.cagnotte) {
    return { kind: "ordinary", totalCents, cagnotteCents: 0, paymentCents: totalCents };
  }
  const snapshot = order.cagnotte.snapshot;
  if (!snapshot || !nonNegativeCents(snapshot.eligibleCents) ||
    !nonNegativeCents(snapshot.appliedCagnotteCents) ||
    !nonNegativeCents(snapshot.productsPaidCents)) {
    throw new Error("Instantané de financement incomplet.");
  }
  const deliveryCents = exactEuroCents(order.deliveryFee);
  if (snapshot.eligibleCents + deliveryCents !== totalCents ||
    snapshot.productsPaidCents + snapshot.appliedCagnotteCents !== snapshot.eligibleCents) {
    throw new Error("Montants de commande cagnotte incohérents.");
  }
  const paymentCents = snapshot.productsPaidCents + deliveryCents;
  if (order.paymentAmount !== undefined && exactEuroCents(order.paymentAmount) !== paymentCents) {
    throw new Error("Montant à régler incohérent.");
  }
  return {
    kind: "cagnotte",
    totalCents,
    cagnotteCents: snapshot.appliedCagnotteCents,
    paymentCents,
  };
}

export function presentOrderFinancing(
  order: OrderFinancingSource,
): OrderFinancingPresentation {
  const appliedCagnotteCents = order.cagnotte?.snapshot?.appliedCagnotteCents;
  const identifiedAsCagnotte = Boolean(
    order.cagnotteReservationIntent || order.cagnottePaymentEvidence ||
    (order.cagnotte && appliedCagnotteCents !== 0),
  );
  if (!identifiedAsCagnotte) {
    const amounts = deriveOrderFinancingAmounts(order);
    return {
      kind: "ordinary",
      totalCents: amounts.totalCents,
      cagnotteCents: 0,
      paymentCents: amounts.totalCents,
      verification: "verified",
      cagnotteState: "not_applicable",
      externalPaymentState: order.paymentStatus === "paid" ? "confirmed" : "planned",
      orderCancelled: isCancelled(order),
    };
  }
  try {
    if (!order.cagnotte) throw new Error("Inscription cagnotte absente.");
    const amounts = deriveOrderFinancingAmounts(order);
    if (!Object.prototype.hasOwnProperty.call(order, "paymentAmount") || order.paymentAmount === undefined) {
      throw new Error("Montant hors cagnotte persistant absent.");
    }
    validatePresentationEnrollment(order);
    const consumed = validatePaymentHistory(order);
    return {
      ...amounts,
      verification: "verified",
      cagnotteState: consumed ? "consumed" : "planned",
      externalPaymentState: consumed ? "confirmed" : "planned",
      orderCancelled: isCancelled(order),
    };
  } catch (error) {
    let totalCents = 0;
    try { totalCents = exactEuroCents(order.total); } catch { /* reported below */ }
    return {
      kind: "cagnotte",
      verification: "required",
      reason: error instanceof Error ? error.message : "Financement incomplet.",
      totalCents,
      cagnotteCents: 0,
      paymentCents: 0,
      cagnotteState: "planned",
      externalPaymentState: "planned",
      orderCancelled: isCancelled(order),
    };
  }
}

export function buildOrderFinancingDocumentSnapshot(
  order: OrderFinancingSource,
): OrderFinancingDocumentSnapshot | undefined {
  const presentation = presentOrderFinancing(order);
  if (presentation.kind === "ordinary") return undefined;
  if (presentation.verification === "required") {
    return {
      schemaVersion: 1,
      version: "order-financing-document-v1",
      currency: "EUR",
      verification: "required",
      totalCents: presentation.totalCents,
      source: "persisted_order",
      reason: presentation.reason || "Financement de commande à vérifier.",
    };
  }
  return {
    schemaVersion: 1,
    version: "order-financing-document-v1",
    currency: "EUR",
    verification: "verified",
    totalCents: presentation.totalCents,
    source: "persisted_order",
    cagnotteCents: presentation.cagnotteCents,
    paymentCents: presentation.paymentCents,
    cagnotteState: presentation.cagnotteState === "consumed" ? "consumed" : "planned",
    externalPaymentState: presentation.externalPaymentState,
    orderCancelled: presentation.orderCancelled,
  };
}

export function presentInvoiceFinancing(source: {
  total: number;
  financing?: OrderFinancingDocumentSnapshot;
}): OrderFinancingPresentation | undefined {
  const snapshot = source.financing;
  if (!snapshot) return undefined;
  const totalCents = exactEuroCents(source.total);
  if (snapshot.schemaVersion !== 1 || snapshot.version !== "order-financing-document-v1" ||
    snapshot.currency !== "EUR" || snapshot.source !== "persisted_order" ||
    !nonNegativeCents(snapshot.totalCents) || snapshot.totalCents !== totalCents) {
    return requiredInvoiceFinancing(totalCents, "Snapshot documentaire incohérent.");
  }
  if (snapshot.verification !== "verified") {
    return requiredInvoiceFinancing(totalCents, snapshot.reason || "Financement à vérifier.");
  }
  if (!nonNegativeCents(snapshot.cagnotteCents) || !nonNegativeCents(snapshot.paymentCents) ||
    snapshot.cagnotteCents + snapshot.paymentCents !== totalCents ||
    (snapshot.cagnotteState !== "planned" && snapshot.cagnotteState !== "consumed") ||
    (snapshot.externalPaymentState !== "planned" && snapshot.externalPaymentState !== "confirmed")) {
    return requiredInvoiceFinancing(totalCents, "Montants documentaires incohérents.");
  }
  return {
    kind: "cagnotte",
    verification: "verified",
    totalCents,
    cagnotteCents: snapshot.cagnotteCents,
    paymentCents: snapshot.paymentCents,
    cagnotteState: snapshot.cagnotteState,
    externalPaymentState: snapshot.externalPaymentState,
    orderCancelled: snapshot.orderCancelled === true,
  };
}

export function financingDisplayItems(
  presentation: OrderFinancingPresentation,
  context: "order" | "document" = "order",
): FinancingDisplayItem[] {
  if (presentation.verification === "required") return [];
  const items: FinancingDisplayItem[] = [
    { label: "Total de la commande", cents: presentation.totalCents },
  ];
  if (presentation.kind === "ordinary") return items;
  items.push({
    label: presentation.cagnotteState === "consumed"
      ? "Réglé avec la cagnotte"
      : "Financement prévu par cagnotte",
    cents: presentation.cagnotteCents,
  });
  items.push({
    label: presentation.externalPaymentState === "confirmed"
      ? "Règlement hors cagnotte confirmé"
      : presentation.orderCancelled
        ? "Règlement hors cagnotte initialement prévu"
        : context === "document"
          ? "Montant prévu hors cagnotte"
          : "À régler hors cagnotte",
    cents: presentation.paymentCents,
  });
  return items;
}

export function financingNotices(presentation: OrderFinancingPresentation): string[] {
  if (presentation.verification === "required") {
    return ["Vérification nécessaire : le financement cagnotte persistant est incomplet ou incohérent."];
  }
  if (presentation.kind === "ordinary") return [];
  const notices: string[] = [];
  if (presentation.orderCancelled) {
    notices.push(presentation.externalPaymentState === "confirmed"
      ? "Commande annulée après un paiement confirmé. L’annulation seule ne prouve aucun remboursement financier."
      : "Commande annulée avant paiement confirmé. L’annulation seule ne prouve ni encaissement ni remboursement financier.");
    if (presentation.cagnotteState !== "consumed") {
      notices.push("L’état final de libération de la réservation doit être vérifié dans son parcours dédié.");
    }
  }
  return notices;
}

export function formatFinancingCents(cents: number): string {
  if (!nonNegativeCents(cents)) throw new Error("Montant de présentation invalide.");
  return `${(cents / 100).toFixed(2).replace(".", ",")}\u00A0EUR`;
}

function validatePresentationEnrollment(order: OrderFinancingSource) {
  const registration = order.cagnotte!;
  if (registration.schemaVersion !== 1 || !registration.snapshot ||
    registration.beneficiaryId !== order.customerId ||
    registration.calculationVersion !== "cagnotte-math-v1" ||
    registration.snapshot.calculationVersion !== registration.calculationVersion) {
    throw new Error("Inscription cagnotte incohérente.");
  }
  if (registration.snapshot.appliedCagnotteCents > 0) {
    const intent = order.cagnotteReservationIntent;
    if (!intent || intent.schemaVersion !== 1 || intent.reservationVersion !== "cagnotte-reservation-v1" ||
      intent.amountCents !== registration.snapshot.appliedCagnotteCents ||
      intent.order.orderId !== order.id || intent.order.beneficiaryId !== registration.beneficiaryId ||
      intent.order.programVersion !== registration.programVersion ||
      intent.order.createdAtEpochMs !== registration.createdAtEpochMs ||
      intent.order.snapshot.appliedCagnotteCents !== registration.snapshot.appliedCagnotteCents ||
      intent.order.snapshot.productsPaidCents !== registration.snapshot.productsPaidCents ||
      intent.order.snapshot.eligibleCents !== registration.snapshot.eligibleCents) {
      throw new Error("Métadonnées de réservation incohérentes.");
    }
  } else if (order.cagnotteReservationIntent !== undefined) {
    throw new Error("Métadonnées de réservation inattendues.");
  }
}

function validatePaymentHistory(order: OrderFinancingSource) {
  const evidence = order.cagnottePaymentEvidence;
  if (!evidence) {
    if (order.paymentStatus === "paid" || order.paidAt || order.paymentConfirmedAt) {
      throw new Error("Preuve de consommation absente.");
    }
    return false;
  }
  if (evidence.schemaVersion !== 1 || evidence.version !== "cagnotte-payment-evidence-v1" ||
    evidence.reservationState !== "consumed" ||
    !["attributed", "not_attributed"].includes(evidence.loyaltyAccrualDecision) ||
    !validInstant(evidence.recordedAt)) {
    throw new Error("Preuve de consommation incohérente.");
  }
  return true;
}

function requiredInvoiceFinancing(
  totalCents: number,
  reason: string,
): OrderFinancingPresentation {
  return {
    kind: "cagnotte",
    verification: "required",
    reason,
    totalCents,
    cagnotteCents: 0,
    paymentCents: 0,
    cagnotteState: "planned",
    externalPaymentState: "planned",
    orderCancelled: false,
  };
}

function isCancelled(order: OrderFinancingSource) {
  return order.orderStatus === "cancelled" || order.paymentStatus === "cancelled" || Boolean(order.cancelledAt);
}

function nonNegativeCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}
