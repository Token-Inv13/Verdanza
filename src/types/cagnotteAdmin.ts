export type AdminRefundLine = {
  lineId: string;
  label: string;
  initialNetCents: number;
  returnedNetCents: number;
  remainingNetCents: number;
};

export type RefundCumuls = {
  lines: Array<{ lineId: string; returnedNetCents: number }>;
  returnedProductNetCents: number;
  productFinancialCents: number;
  cagnotteRestitutionCents: number;
  deliveryFinancialCents: number;
  totalFinancialCents: number;
};

export type CagnotteAdminOperationalState = {
  code:
    | "enrolled_payment_pending"
    | "accrual_not_enrolled"
    | "payment_confirmed_pending"
    | "delivered_available"
    | "cancelled"
    | "regularization_pending"
    | "refund_recorded";
  label: string;
  detail: string;
};

export type CagnotteAdminMovement = {
  id: string;
  event: string;
  pendingDeltaCents: number;
  availableDeltaCents: number;
  reservedDeltaCents: number;
  regularizationDeltaCents: number;
  recordedAtEpochMs: number;
};

export type CagnotteAdminInspection = {
  kind: "administrative_refund_inspection";
  order: {
    id: string;
    customer: { id: string; name: string; email: string };
    orderStatus: string;
    paymentStatus: string;
    totalCents: number;
    paymentAmountCents: number;
    deliveryCents: number;
  };
  financing: {
    productsNetCents: number;
    cagnotteCents: number;
    externalProductsCents: number;
    externalTotalCents: number;
    deliveryCents: number;
  };
  operationalState: CagnotteAdminOperationalState;
  enrollment: {
    enrolled: boolean;
    accrualEnrollment: "enrolled" | "not_enrolled";
    beneficiaryId: string;
    programVersion: string;
    calculationVersion: string;
    createdAtEpochMs: number;
  };
  accrual: {
    present: boolean;
    initialGainCents: number;
    remainingGainCents: number;
    paymentConfirmed: boolean;
    deliveryConfirmed: boolean;
    credited: boolean;
    compartment: "none" | "pending" | "available";
    cancelled: boolean;
  };
  wallet: { pendingCents: number; availableCents: number; reservedCents: number; regularizationCents: number } | null;
  reservation: {
    applicable: boolean;
    amountCents: number;
    state: "reserved" | "consumed" | "released" | null;
    requiresReview: boolean;
    cumulativeRestitutedCents: number;
  };
  refund: {
    history: Array<{ id: string; type: "initial_declaration" | "correction"; revision: number; recordedAt: string; effective: boolean }>;
    latest: { id: string; type: "initial_declaration" | "correction"; revision: number; recordedAt: string } | null;
    latestRevision: number;
    requiresReview: boolean;
  };
  movements: CagnotteAdminMovement[];
  movementHistory: {
    complete: boolean;
    omittedLegacyUndatedCount: number;
  };
  lines: AdminRefundLine[];
  effective: RefundCumuls;
  history: Array<{
    id: string;
    type: "initial_declaration" | "correction";
    revision: number;
    recordedAt: string;
    reference: string;
    declaredFinancialCents: number;
    returnedProductNetCents: number;
    financialCents: number;
    cagnotteRestitutionCents: number;
    resultingAvailableCents: number;
    effective: boolean;
    targetEventId?: string;
    targetReference?: string;
  }>;
  correctionTarget: { eventId: string; revision: number; effective: RefundCumuls } | null;
  unpaid: {
    reservedAmountCents: number;
    reservationState: string | null;
    reservedAt: string | null;
    ageHours: number | null;
    reviewRequired: boolean;
    payment: { status: string; uncertain: boolean; confirmedAt: string | null };
    linkTransmission: { requestId: string | null; status: string; transportStatus: string; sendingActive: boolean; uncertain: boolean };
    stateVersion: string;
    review: { outcome: "unpaid_confirmed" | "payment_uncertain"; source: string; reason: string; reviewedAt: string; reviewedByEmail: string | null; current: boolean } | null;
  };
};

export type RefundPreview = {
  kind: "refund_preview" | "administrative_refund_recorded";
  orderId: string;
  currency: "EUR";
  additionalReturns: Array<{ lineId: string; additionalNetCents: number }>;
  productFinancialCents: number;
  cagnotteRestitutionCents: number;
  deliveryFinancialCents: number;
  totalFinancialCents: number;
  correction: { theoreticalCents: number; appliedCents: number; pendingDeltaCents: number; availableDeltaCents: number; regularizationDeltaCents: number; remainingGainCents: number };
  restitution: { grossCents: number; compensationCents: number; availableIncreaseCents: number; availableAfterCents: number; cumulativeCents: number; reservationState: string };
  before: RefundCumuls;
  after: RefundCumuls;
  previewVersion: string;
  recordedAt?: string;
  alreadyRecorded?: boolean;
};

export type CorrectionPreview = {
  kind: "refund_correction_preview" | "administrative_refund_correction_recorded" | "correction_requires_review";
  orderId: string;
  currency: "EUR";
  targetEventId: string;
  previousRevision: number;
  revision: number;
  replacementReturns: Array<{ lineId: string; additionalNetCents: number }>;
  deliveryRefundCents: number;
  declaredFinancialCents: number;
  previousEffective: RefundCumuls;
  effective: RefundCumuls;
  differential: {
    returnedProductNetCents: number;
    productFinancialCents: number;
    cagnotteRestitutionCents: number;
    deliveryFinancialCents: number;
    totalFinancialCents: number;
    loyaltyCents: number;
    pendingDeltaCents: number;
    availableDeltaCents: number;
    regularizationDeltaCents: number;
  };
  walletAfter: { pendingCents: number; availableCents: number; reservedCents: number; regularizationCents: number };
  remainingGainCents: number;
  reservationState: string;
  previewVersion: string;
  recordedAt?: string;
  alreadyRecorded?: boolean;
  reviewReason?: string;
};
