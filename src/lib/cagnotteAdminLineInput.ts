import type { CagnotteAdminInspection } from "../types/cagnotteAdmin";

export function cagnotteAdminCorrectionMaximumNetCents(inspection: CagnotteAdminInspection, lineId: string) {
  return inspection.correctionTarget?.lines.find((line) => line.lineId === lineId)?.maxReplacementNetCents ?? 0;
}

export function cagnotteAdminMaximumLineInput(lines: Record<string, string>, lineId: string, maximumNetCents: number) {
  return { ...lines, [lineId]: (maximumNetCents / 100).toFixed(2).replace(".", ",") };
}
