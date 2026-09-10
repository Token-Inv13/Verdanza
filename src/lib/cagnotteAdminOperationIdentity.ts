import { cagnotteAdminSha256, stableCagnotteAdminHashValue } from "./cagnotteAdminHash.js";

type ReturnLine = { lineId: string; additionalNetCents: number };

export type CagnotteAdminRefundBusinessInput = {
  orderId: string;
  additionalReturns: readonly ReturnLine[];
  deliveryRefundCents: number;
  source: "admin" | "provider_reference";
  reference: string;
  declaredFinancialCents: number;
  reason: "product_return" | "order_cancellation" | "delivery_refund";
  confirmedAt: string;
};

export type CagnotteAdminCorrectionBusinessInput = {
  orderId: string;
  targetEventId: string;
  expectedRevision: number;
  replacementReturns: readonly ReturnLine[];
  deliveryRefundCents: number;
  declaredFinancialCents: number;
  correctionReason: string;
  correctionReference: string;
};

export function cagnotteAdminRefundBusinessContent(input: CagnotteAdminRefundBusinessInput) {
  return {
    orderId: input.orderId,
    currency: "EUR" as const,
    additionalReturns: copiedReturns(input.additionalReturns),
    deliveryRefundCents: input.deliveryRefundCents,
    source: input.source,
    reference: input.reference.trim().toLowerCase(),
    declaredFinancialCents: input.declaredFinancialCents,
    reason: input.reason,
    confirmedAt: new Date(input.confirmedAt).toISOString(),
  };
}

export function cagnotteAdminCorrectionBusinessContent(input: CagnotteAdminCorrectionBusinessInput) {
  return {
    orderId: input.orderId,
    currency: "EUR" as const,
    targetEventId: input.targetEventId,
    expectedRevision: input.expectedRevision,
    replacementReturns: copiedReturns(input.replacementReturns),
    deliveryRefundCents: input.deliveryRefundCents,
    declaredFinancialCents: input.declaredFinancialCents,
    correctionReason: input.correctionReason.trim(),
    externalVerificationConfirmed: true as const,
    correctionReference: input.correctionReference.trim().toLowerCase(),
  };
}

export function cagnotteAdminRefundBusinessFingerprint(input: CagnotteAdminRefundBusinessInput) {
  return fingerprint(cagnotteAdminRefundBusinessContent(input));
}

export function cagnotteAdminCorrectionBusinessFingerprint(input: CagnotteAdminCorrectionBusinessInput) {
  return fingerprint(cagnotteAdminCorrectionBusinessContent(input));
}

function copiedReturns(lines: readonly ReturnLine[]) {
  return lines.map((line) => ({ lineId: line.lineId, additionalNetCents: line.additionalNetCents }));
}

function fingerprint(value: unknown) {
  return cagnotteAdminSha256(stableCagnotteAdminHashValue(value));
}
