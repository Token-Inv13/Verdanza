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
  busy: boolean;
};

export function cagnotteAdminLoadingState(value: CagnotteAdminViewModel): CagnotteAdminViewModel {
  return { ...value, phase: "loading", notice: "" };
}

export function cagnotteAdminFailureState(
  value: CagnotteAdminViewModel,
  error: unknown,
  phase: CagnotteAdminViewModel["phase"] = value.phase,
): CagnotteAdminViewModel {
  const newlyUncertain = error instanceof CagnotteAdminRequestError && error.uncertain;
  return { ...value, phase, notice: message(error), uncertain: value.uncertain || value.pendingOperation !== null || newlyUncertain };
}

export function cagnotteAdminInspectionSuccessState(
  value: CagnotteAdminViewModel,
  inspection: CagnotteAdminInspection,
  notice = "",
): CagnotteAdminViewModel {
  if (value.pendingOperation && !isCagnotteAdminFrozenOperationRecorded(value.pendingOperation, inspection)) {
    return { ...value, phase: "ready", inspection, notice: CAGNOTTE_ADMIN_FROZEN_NOTICE, uncertain: true };
  }
  return { ...value, phase: "ready", inspection, refundPreview: null, correctionPreview: null, notice, uncertain: false, pendingOperation: null };
}

export function cagnotteAdminFrozenOperationState(
  value: CagnotteAdminViewModel,
  operation: CagnotteAdminFrozenOperation,
  error?: unknown,
): CagnotteAdminViewModel {
  return { ...value, notice: error === undefined ? CAGNOTTE_ADMIN_FROZEN_NOTICE : message(error), uncertain: true, pendingOperation: operation };
}

export function cagnotteAdminFormUpdatedState(value: CagnotteAdminViewModel): CagnotteAdminViewModel {
  if (value.pendingOperation) return value;
  return { ...value, refundPreview: null, correctionPreview: null, notice: "" };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Opération impossible.";
}
