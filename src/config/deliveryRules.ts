export const LOCAL_DELIVERY_MINIMUM = 20;
export const POSTAL_DELIVERY_MINIMUM = 15;
export const POSTAL_FREE_SHIPPING_THRESHOLD = 60;

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
