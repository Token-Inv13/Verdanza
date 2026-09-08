import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { CagnotteAdminInspection, CorrectionPreview, RefundPreview } from "../types/cagnotteAdmin";

export class CagnotteAdminRequestError extends Error {
  constructor(message: string, readonly code: string, readonly uncertain: boolean) {
    super(message);
    this.name = "CagnotteAdminRequestError";
  }
}

export async function inspectCagnotteOrder(orderId: string, signal?: AbortSignal) {
  return postRefund<CagnotteAdminInspection>({ action: "inspect", orderId }, signal);
}

export async function previewOrderRefund(input: {
  orderId: string;
  additionalReturns: Array<{ lineId: string; additionalNetCents: number }>;
  deliveryRefundCents: number;
}) {
  return postRefund<RefundPreview>({ action: "preview", currency: "EUR", ...input });
}

export async function recordOrderRefund(input: {
  orderId: string;
  additionalReturns: Array<{ lineId: string; additionalNetCents: number }>;
  deliveryRefundCents: number;
  source: "admin" | "provider_reference";
  reference: string;
  declaredFinancialCents: number;
  reason: "product_return" | "order_cancellation" | "delivery_refund";
  confirmedAt: string;
  expectedPreviewVersion: string;
}) {
  return postRefund<RefundPreview>({ action: "record_confirmed", currency: "EUR", ...input });
}

export async function previewRefundCorrection(input: {
  orderId: string;
  targetEventId: string;
  expectedRevision: number;
  replacementReturns: Array<{ lineId: string; additionalNetCents: number }>;
  deliveryRefundCents: number;
  declaredFinancialCents: number;
  correctionReason: string;
}) {
  return postRefund<CorrectionPreview>({ action: "preview_correction", currency: "EUR", externalVerificationConfirmed: true, ...input });
}

export async function recordRefundCorrection(input: {
  orderId: string;
  targetEventId: string;
  expectedRevision: number;
  replacementReturns: Array<{ lineId: string; additionalNetCents: number }>;
  deliveryRefundCents: number;
  declaredFinancialCents: number;
  correctionReason: string;
  correctionReference: string;
  expectedPreviewVersion: string;
}) {
  return postRefund<CorrectionPreview>({ action: "record_correction", currency: "EUR", externalVerificationConfirmed: true, ...input });
}

export async function recordUnpaidReview(input: {
  orderId: string;
  outcome: "unpaid_confirmed" | "payment_uncertain";
  source: string;
  reason: string;
  expectedStateVersion: string;
}) {
  const token = await getFirebaseIdToken();
  if (!token) throw new CagnotteAdminRequestError("Connexion admin requise.", "admin_token_required", false);
  const response = await fetch("/api/update-order-status", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ orderId: input.orderId, unpaidReview: { action: "record", outcome: input.outcome, source: input.source,
      reason: input.reason, expectedStateVersion: input.expectedStateVersion } }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string; unpaidReview?: unknown };
  if (!response.ok) throw new CagnotteAdminRequestError(payload.error || "Revue impossible.", payload.code || "unpaid_review_failed", response.status >= 500);
  return payload.unpaidReview;
}

async function postRefund<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const token = await getFirebaseIdToken();
  if (!token) throw new CagnotteAdminRequestError("Connexion admin requise.", "admin_token_required", false);
  let response: Response;
  try {
    response = await fetch("/api/order-refunds", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CagnotteAdminRequestError("Réponse absente : reprenez exactement la même opération.", "response_unknown", true);
  }
  const payload = await response.json().catch(() => ({})) as { result?: T; code?: string; error?: string };
  if (!response.ok || !payload.result) {
    throw new CagnotteAdminRequestError(payload.error || "Opération refusée.", payload.code || "request_failed", response.status >= 500);
  }
  return payload.result;
}
