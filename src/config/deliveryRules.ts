export const LOCAL_DELIVERY_MINIMUM = 20;
export const POSTAL_DELIVERY_MINIMUM = 15;
export const POSTAL_FREE_SHIPPING_THRESHOLD = 60;
export const DEFAULT_LOCAL_DELIVERY_ESTIMATE_MIN_MINUTES = 60;
export const DEFAULT_LOCAL_DELIVERY_ESTIMATE_MAX_MINUTES = 120;

export function effectiveLocalDeliveryMinimum(value?: number | null) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed === 30) {
    return LOCAL_DELIVERY_MINIMUM;
  }
  return parsed;
}

export function effectivePostalDeliveryMinimum(value?: number | null) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return POSTAL_DELIVERY_MINIMUM;
  }
  return parsed;
}

export function isPostalShippingFree(subtotal: number) {
  return subtotal >= POSTAL_FREE_SHIPPING_THRESHOLD;
}

export function effectiveLocalDeliveryEstimateMinutes(
  minMinutes?: number | null,
  maxMinutes?: number | null,
) {
  const min = Number(minMinutes ?? 0);
  const max = Number(maxMinutes ?? 0);
  const hasValidMin = Number.isFinite(min) && min > 0;
  const hasValidMax = Number.isFinite(max) && max > 0;

  if (!hasValidMin && !hasValidMax) {
    return {
      minMinutes: DEFAULT_LOCAL_DELIVERY_ESTIMATE_MIN_MINUTES,
      maxMinutes: DEFAULT_LOCAL_DELIVERY_ESTIMATE_MAX_MINUTES,
    };
  }

  const effectiveMin = hasValidMin
    ? min
    : DEFAULT_LOCAL_DELIVERY_ESTIMATE_MIN_MINUTES;
  const effectiveMax = hasValidMax
    ? max
    : Math.max(effectiveMin, DEFAULT_LOCAL_DELIVERY_ESTIMATE_MAX_MINUTES);

  return {
    minMinutes: effectiveMin,
    maxMinutes: Math.max(effectiveMin, effectiveMax),
  };
}
