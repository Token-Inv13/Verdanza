import { effectiveLocalDeliveryEstimateMinutes } from "../config/deliveryRules.js";
import type { DeliveryZone } from "../types/index.js";

type DeliveryEstimateSource =
  | Pick<DeliveryZone, "estimatedDelayMinMinutes" | "estimatedDelayMaxMinutes">
  | null
  | undefined;

export function formatLocalDeliveryEstimate(zone?: DeliveryEstimateSource) {
  const { minMinutes, maxMinutes } = effectiveLocalDeliveryEstimateMinutes(
    zone?.estimatedDelayMinMinutes,
    zone?.estimatedDelayMaxMinutes,
  );
  const delayLabel = formatLocalDeliveryDelay(minMinutes, maxMinutes);

  return `Livraison locale généralement en ${delayLabel} après confirmation, selon la disponibilité.`;
}

export const DEFAULT_LOCAL_DELIVERY_ESTIMATE_LABEL = formatLocalDeliveryEstimate();

function formatMinuteRange(minMinutes: number, maxMinutes: number) {
  if (minMinutes === maxMinutes) return formatMinutes(minMinutes);
  if (minMinutes >= 60 && maxMinutes >= 60 && minMinutes % 60 === 0 && maxMinutes % 60 === 0) {
    return `${minMinutes / 60} à ${maxMinutes / 60} h`;
  }
  return `${formatMinutes(minMinutes)} à ${formatMinutes(maxMinutes)}`;
}

function formatLocalDeliveryDelay(minMinutes: number, maxMinutes: number) {
  if (minMinutes === 60 && maxMinutes === 120) return "environ 1 h";
  return formatMinuteRange(minMinutes, maxMinutes);
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!remainingMinutes) return `${hours} h`;
  return `${hours} h ${String(remainingMinutes).padStart(2, "0")}`;
}
