export const LOCAL_DELIVERY_MINIMUM = 20;
export const POSTAL_DELIVERY_ZONE_ID = "postal-france";
export const POSTAL_DELIVERY_NAME = "Colissimo France";
export const POSTAL_DELIVERY_FEE = 5.49;
export const POSTAL_DELIVERY_MINIMUM = 15;
export const POSTAL_FREE_SHIPPING_THRESHOLD = 50;
export const POSTAL_DELIVERY_ESTIMATE =
  "Livraison estimée sous 2 à 3 jours ouvrés. Suivi Colissimo inclus.";
export const POSTAL_DELIVERY_PREPARATION =
  "Préparation sous 24 h ouvrées, généralement le jour même pour les commandes passées avant 14 h.";
export const POSTAL_DELIVERY_SIGNATURE = "Sans signature par défaut.";
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
  void value;
  return POSTAL_DELIVERY_MINIMUM;
}

export function isPostalShippingFree(subtotal: number) {
  return subtotal >= POSTAL_FREE_SHIPPING_THRESHOLD;
}

export function postalDeliveryFee(subtotal: number) {
  return isPostalShippingFree(subtotal) ? 0 : POSTAL_DELIVERY_FEE;
}

export function postalDeliveryNote(subtotal: number) {
  const feeText = isPostalShippingFree(subtotal)
    ? `Livraison Colissimo offerte dès ${POSTAL_FREE_SHIPPING_THRESHOLD} € de sous-total éligible.`
    : `Livraison Colissimo à domicile : ${POSTAL_DELIVERY_FEE.toFixed(2).replace(".", ",")} €.`;
  return `${feeText} ${POSTAL_DELIVERY_ESTIMATE} ${POSTAL_DELIVERY_PREPARATION} ${POSTAL_DELIVERY_SIGNATURE}`;
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
