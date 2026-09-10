import { CagnotteAdminRequestError } from "../services/cagnotteAdminService";
import type { CagnotteAdminInspection, CorrectionPreview, RefundPreview } from "../types/cagnotteAdmin";

export type CagnotteAdminViewModel = {
  phase: "loading" | "ready" | "error";
  inspection: CagnotteAdminInspection | null;
  mode: "refund" | "correction" | "unpaid";
  refundPreview: RefundPreview | null;
  correctionPreview: CorrectionPreview | null;
  notice: string;
  uncertain: boolean;
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
  return { ...value, phase, notice: message(error), uncertain: value.uncertain || newlyUncertain };
}

export function cagnotteAdminInspectionSuccessState(
  value: CagnotteAdminViewModel,
  inspection: CagnotteAdminInspection,
  notice = "",
): CagnotteAdminViewModel {
  return { ...value, phase: "ready", inspection, refundPreview: null, correctionPreview: null, notice, uncertain: false };
}

export function cagnotteAdminFormUpdatedState(value: CagnotteAdminViewModel): CagnotteAdminViewModel {
  return { ...value, refundPreview: null, correctionPreview: null, notice: "" };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Opération impossible.";
}
