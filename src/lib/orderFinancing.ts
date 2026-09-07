import type {
  CagnotteOrderEnrollment,
  CagnotteOrderReservationIntent,
} from "../types/cagnotte.js";

export type OrderFinancingSource = {
  total: number;
  deliveryFee?: number;
  paymentAmount?: number;
  cagnotte?: CagnotteOrderEnrollment;
  cagnotteReservationIntent?: CagnotteOrderReservationIntent;
};

export type OrderFinancingAmounts = {
  kind: "ordinary" | "cagnotte";
  totalCents: number;
  cagnotteCents: number;
  paymentCents: number;
};

/** Exact euro conversion shared by order payment consumers. */
export function exactEuroCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Montant serveur invalide.");
  }
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!match) throw new Error("Montant serveur invalide.");
  const digits = BigInt(match[1] + (match[2] || ""));
  const scale = (match[2]?.length || 0) - Number(match[3] || 0) - 2;
  const divisor = scale > 0 ? 10n ** BigInt(scale) : 1n;
  const cents = scale > 0
    ? (digits + divisor / 2n) / divisor
    : digits * 10n ** BigInt(-scale);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Centimes serveur non sûrs.");
  }
  const result = Number(cents);
  if (Math.abs(value - result / 100) > Number.EPSILON * Math.max(1, value) * 2) {
    throw new Error("Fraction de centime serveur non résolue.");
  }
  return result;
}

/** E + F and E + F - R from the persisted order snapshot only. */
export function deriveOrderFinancingAmounts(
  order: OrderFinancingSource,
): OrderFinancingAmounts {
  const totalCents = exactEuroCents(order.total);
  if (!order.cagnotte) {
    return { kind: "ordinary", totalCents, cagnotteCents: 0, paymentCents: totalCents };
  }
  const snapshot = order.cagnotte.snapshot;
  if (!snapshot || !nonNegativeCents(snapshot.eligibleCents) ||
    !nonNegativeCents(snapshot.appliedCagnotteCents) ||
    !nonNegativeCents(snapshot.productsPaidCents)) {
    throw new Error("Instantané de financement incomplet.");
  }
  const deliveryCents = exactEuroCents(order.deliveryFee);
  if (snapshot.eligibleCents + deliveryCents !== totalCents ||
    snapshot.productsPaidCents + snapshot.appliedCagnotteCents !== snapshot.eligibleCents) {
    throw new Error("Montants de commande cagnotte incohérents.");
  }
  const paymentCents = snapshot.productsPaidCents + deliveryCents;
  if (order.paymentAmount !== undefined && exactEuroCents(order.paymentAmount) !== paymentCents) {
    throw new Error("Montant à régler incohérent.");
  }
  return {
    kind: "cagnotte",
    totalCents,
    cagnotteCents: snapshot.appliedCagnotteCents,
    paymentCents,
  };
}

function nonNegativeCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
