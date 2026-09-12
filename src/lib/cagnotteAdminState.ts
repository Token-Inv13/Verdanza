import { CagnotteAdminRequestError } from "../services/cagnotteAdminService";
import type { CagnotteAdminInspection, CorrectionPreview, RefundPreview } from "../types/cagnotteAdmin";
import { CAGNOTTE_ADMIN_FROZEN_NOTICE, isCagnotteAdminFrozenOperationRecorded, type CagnotteAdminFrozenOperation } from "./cagnotteAdminController";

export type CagnotteAdminViewModel = {
  phase: "loading" | "ready" | "error";
  inspection: CagnotteAdminInspection | null;
  mode: "refund" | "correction" | "unpaid";
  refundPreview: RefundPreview | null;
  correctionPreview: CorrectionPreview | null;
  notice: string;
  uncertain: boolean;
  pendingOperation: CagnotteAdminFrozenOperation | null;
  recoveryBlocked: boolean;
  busy: boolean;
};

export function createCagnotteAdminInitialState(): CagnotteAdminViewModel {
  return { phase: "loading", inspection: null, mode: "refund", refundPreview: null, correctionPreview: null, notice: "", uncertain: false, pendingOperation: null, recoveryBlocked: false, busy: false };
}

export function cagnotteAdminLoadingState(value: CagnotteAdminViewModel): CagnotteAdminViewModel {
  return { ...value, phase: "loading", notice: value.recoveryBlocked || value.pendingOperation ? value.notice : "" };
}

export function cagnotteAdminFailureState(
  value: CagnotteAdminViewModel,
  error: unknown,
  phase: CagnotteAdminViewModel["phase"] = value.phase,
): CagnotteAdminViewModel {
  const newlyUncertain = error instanceof CagnotteAdminRequestError && error.uncertain;
  return { ...value, phase, notice: message(error), uncertain: value.recoveryBlocked || value.uncertain || value.pendingOperation !== null || newlyUncertain };
}

export function cagnotteAdminInspectionSuccessState(
  value: CagnotteAdminViewModel,
  inspection: CagnotteAdminInspection,
  notice = "",
): CagnotteAdminViewModel {
  if (value.recoveryBlocked) {
    return { ...value, phase: "ready", inspection, uncertain: true };
  }
  if (value.pendingOperation && !isCagnotteAdminFrozenOperationRecorded(value.pendingOperation, inspection)) {
    return { ...value, phase: "ready", inspection, notice: CAGNOTTE_ADMIN_FROZEN_NOTICE, uncertain: true };
  }
  return { ...value, phase: "ready", inspection, refundPreview: null, correctionPreview: null, notice, uncertain: false, pendingOperation: null, recoveryBlocked: false };
}

export function cagnotteAdminFrozenOperationState(
  value: CagnotteAdminViewModel,
  operation: CagnotteAdminFrozenOperation,
  error?: unknown,
): CagnotteAdminViewModel {
  return { ...value, notice: error === undefined ? CAGNOTTE_ADMIN_FROZEN_NOTICE : message(error), uncertain: true, pendingOperation: operation, recoveryBlocked: false };
}

export function cagnotteAdminRestoredOperationState(
  value: CagnotteAdminViewModel,
  operation: CagnotteAdminFrozenOperation,
): CagnotteAdminViewModel {
  return { ...value, notice: "Une opération précédente reste à confirmer.", uncertain: true, pendingOperation: operation, recoveryBlocked: false };
}

export function cagnotteAdminStorageBlockedState(
  value: CagnotteAdminViewModel,
  notice: string,
  operation: CagnotteAdminFrozenOperation | null = value.pendingOperation,
): CagnotteAdminViewModel {
  return { ...value, notice, uncertain: true, pendingOperation: operation, recoveryBlocked: true };
}

export function cagnotteAdminDefinitiveRejectionState(
  value: CagnotteAdminViewModel,
  error: CagnotteAdminRequestError,
): CagnotteAdminViewModel {
  return {
    ...value,
    phase: "ready",
    refundPreview: null,
    correctionPreview: null,
    notice: message(error),
    uncertain: false,
    pendingOperation: null,
    recoveryBlocked: false,
  };
}

export function cagnotteAdminTerminalReinspectionState(
  value: CagnotteAdminViewModel,
  notice: string,
): CagnotteAdminViewModel {
  return {
    ...value,
    phase: "loading",
    refundPreview: null,
    correctionPreview: null,
    notice,
    uncertain: true,
    pendingOperation: null,
    recoveryBlocked: false,
  };
}

export function cagnotteAdminFormUpdatedState(value: CagnotteAdminViewModel): CagnotteAdminViewModel {
  if (value.pendingOperation || value.recoveryBlocked) return value;
  return { ...value, refundPreview: null, correctionPreview: null, notice: "" };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Opération impossible.";
}
