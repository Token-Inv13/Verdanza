import {
  cagnotteRefundDateTimeLocalToIso,
  cagnotteRefundDateTimeLocalValue,
} from "../../src/lib/cagnotteAdminDate.js";

export function refundConfirmationDateTimeLocal(input: {
  paidAt: string;
}) {
  const paidAtEpochMs = Date.parse(input.paidAt);
  if (!Number.isFinite(paidAtEpochMs) || new Date(paidAtEpochMs).toISOString() !== input.paidAt) {
    throw new Error("Date de paiement persistée invalide pour la recette.");
  }
  let confirmedAtEpochMs = Math.ceil(paidAtEpochMs / 1_000) * 1_000;
  if (new Date(confirmedAtEpochMs).getSeconds() === 0) confirmedAtEpochMs += 1_000;
  const localValue = cagnotteRefundDateTimeLocalValue(new Date(confirmedAtEpochMs));
  const roundTripEpochMs = Date.parse(cagnotteRefundDateTimeLocalToIso(localValue));
  if (roundTripEpochMs !== confirmedAtEpochMs || roundTripEpochMs < paidAtEpochMs) {
    throw new Error("Date de confirmation non représentable après le paiement persisté.");
  }
  return { localValue, confirmedAtEpochMs };
}
