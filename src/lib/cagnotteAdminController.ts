import type { CagnotteAdminInspection } from "../types/cagnotteAdmin";
import type { RecordOrderRefundInput, RecordRefundCorrectionInput } from "../services/cagnotteAdminService";
import type { CagnotteAdminFrozenOperationStore } from "./cagnotteAdminFrozenOperationStorage";

export type CagnotteAdminFrozenOperation =
  | { kind: "refund"; orderId: string; payload: RecordOrderRefundInput }
  | { kind: "correction"; orderId: string; payload: RecordRefundCorrectionInput };

export const CAGNOTTE_ADMIN_FROZEN_NOTICE = "L’opération initiale n’est pas encore confirmée. Vous pouvez réinspecter ou rejouer exactement la même opération. Aucune nouvelle déclaration ne peut être créée pour le moment.";

export function freezeCagnotteAdminRefund(input: RecordOrderRefundInput): CagnotteAdminFrozenOperation {
  return { kind: "refund", orderId: input.orderId, payload: { ...input, additionalReturns: input.additionalReturns.map((line) => ({ ...line })) } };
}

export function freezeCagnotteAdminCorrection(input: RecordRefundCorrectionInput): CagnotteAdminFrozenOperation {
  return { kind: "correction", orderId: input.orderId, payload: { ...input, replacementReturns: input.replacementReturns.map((line) => ({ ...line })) } };
}

export function isCagnotteAdminFrozenOperationRecorded(operation: CagnotteAdminFrozenOperation, inspection: CagnotteAdminInspection) {
  if (inspection.order.id !== operation.orderId) return false;
  if (operation.kind === "refund") {
    const reference = normalizedReference(operation.payload.reference);
    return inspection.history.some((entry) => entry.type === "initial_declaration" && entry.source === operation.payload.source &&
      normalizedReference(entry.reference) === reference);
  }
  const reference = normalizedReference(operation.payload.correctionReference);
  return inspection.history.some((entry) => entry.type === "correction" && entry.targetEventId === operation.payload.targetEventId &&
    entry.revision === operation.payload.expectedRevision + 1 && normalizedReference(entry.reference) === reference);
}

export async function retryCagnotteAdminFrozenOperation<TRefund, TCorrection>(
  operation: CagnotteAdminFrozenOperation,
  currentOrderId: string,
  handlers: {
    refund: (payload: RecordOrderRefundInput) => Promise<TRefund>;
    correction: (payload: RecordRefundCorrectionInput) => Promise<TCorrection>;
  },
) {
  if (operation.orderId !== currentOrderId) throw new Error("L’opération gelée appartient à une autre commande.");
  return operation.kind === "refund" ? handlers.refund(operation.payload) : handlers.correction(operation.payload);
}

export async function sendCagnotteAdminOperationWithDurableRecovery<T>(
  store: CagnotteAdminFrozenOperationStore,
  operation: CagnotteAdminFrozenOperation,
  send: (operation: CagnotteAdminFrozenOperation) => Promise<T>,
  onPersisted: (operation: CagnotteAdminFrozenOperation) => void = () => undefined,
) {
  store.persistBeforeSend(operation);
  onPersisted(operation);
  try {
    const result = await send(operation);
    try { store.updateState(operation, "awaiting_confirmation"); } catch { /* The confirmed in_flight record remains fail-closed. */ }
    return result;
  } catch (error) {
    try { store.updateState(operation, "uncertain"); } catch { /* The confirmed in_flight record remains fail-closed. */ }
    throw error;
  }
}

export async function retryCagnotteAdminFrozenOperationDurably<TRefund, TCorrection>(
  store: CagnotteAdminFrozenOperationStore,
  operation: CagnotteAdminFrozenOperation,
  currentOrderId: string,
  handlers: {
    refund: (payload: RecordOrderRefundInput) => Promise<TRefund>;
    correction: (payload: RecordRefundCorrectionInput) => Promise<TCorrection>;
  },
) {
  if (operation.orderId !== currentOrderId) throw new Error("L’opération gelée appartient à une autre commande.");
  store.updateState(operation, "in_flight");
  try {
    const result = await retryCagnotteAdminFrozenOperation(operation, currentOrderId, handlers);
    try { store.updateState(operation, "awaiting_confirmation"); } catch { /* The prior durable record remains fail-closed. */ }
    return result;
  } catch (error) {
    try { store.updateState(operation, "uncertain"); } catch { /* A prior durable record still protects the operation. */ }
    throw error;
  }
}

export function resolveCagnotteAdminFrozenOperationFromInspection(
  store: CagnotteAdminFrozenOperationStore,
  operation: CagnotteAdminFrozenOperation,
  inspection: CagnotteAdminInspection,
) {
  if (!isCagnotteAdminFrozenOperationRecorded(operation, inspection)) return false;
  store.clearAfterResolution(operation);
  return true;
}

function normalizedReference(value: string) {
  return value.trim().toLowerCase();
}

export function eurosInputToCents(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return 0;
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Montant en euros invalide.");
  const [euros, decimals = ""] = normalized.split(".");
  const result = Number(euros) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Montant en euros invalide.");
  return result;
}

export async function runCagnotteAdminLocked(
  lock: { current: boolean },
  run: () => Promise<void>,
  fail: (error: unknown) => void,
) {
  if (lock.current) return;
  lock.current = true;
  try { await run(); } catch (error) { fail(error); } finally { lock.current = false; }
}

export async function refreshCagnotteAdminAfterWrite(
  reloadInspection: () => Promise<void>,
  reloadOrder?: () => Promise<void> | void,
) {
  await Promise.all([
    reloadInspection(),
    Promise.resolve(reloadOrder?.()),
  ]);
}

export function createCagnotteAdminRefreshChannel() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    subscribe(orderId: string, listener: () => void) {
      const orderListeners = listeners.get(orderId) ?? new Set<() => void>();
      orderListeners.add(listener);
      listeners.set(orderId, orderListeners);
      return () => {
        orderListeners.delete(listener);
        if (!orderListeners.size) listeners.delete(orderId);
      };
    },
    publish(orderId: string, source?: () => void) {
      for (const listener of listeners.get(orderId) ?? []) {
        if (listener !== source) listener();
      }
    },
  };
}

export function createCagnotteAdminResponseIdentity() {
  let current = 0;
  return {
    next() { current += 1; return current; },
    isCurrent(value: number) { return value === current; },
    invalidate() { current += 1; },
  };
}

export function clearCagnotteAdminPendingOperation<T>(pending: { current: T | null }) {
  pending.current = null;
}
