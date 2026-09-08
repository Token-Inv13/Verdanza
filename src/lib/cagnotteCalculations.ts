import type {
  AllocationBase,
  CagnotteAdvantage,
  CagnotteCalculationInput,
  CagnotteCalculationVersion,
  CagnotteCompatibility,
  CagnotteLimitationReason,
  CagnotteLine,
  CagnotteLineSnapshot,
  CagnotteRefundSimulation,
  CagnotteSnapshot,
  CentAllocation,
  CumulativeLineReturn,
  ProductDiscount,
  RefundCumulativeTotals,
} from "../types/cagnotte.js";
import {
  CAGNOTTE_OPENING_COMMERCIAL_POLICY,
  cagnotteUsePolicyForAdvantage,
} from "./cagnotteCommercialPolicy.js";

export const CAGNOTTE_CALCULATION_VERSION: CagnotteCalculationVersion = "cagnotte-math-v1";

/** Reference amounts only; this module never attributes a referral reward. */
export const REFERRAL_REFERENCE_CENTS = Object.freeze({
  sponsorReward: 1_000,
  refereeDiscount: 500,
  minimumProducts: 5_000,
});

const maxSafeCents = BigInt(Number.MAX_SAFE_INTEGER);
const advantageOrder: readonly CagnotteAdvantage[] =
  CAGNOTTE_OPENING_COMMERCIAL_POLICY.advantageOrder;

/** 5% rounded once on the order's products paid outside cagnotte, half up. */
export function calculateLoyaltyCents(productsPaidCents: number): number {
  const percentage = BigInt(CAGNOTTE_OPENING_COMMERCIAL_POLICY.acquisition.percentage);
  return safeNumber((money(productsPaidCents, "productsPaidCents") * percentage + 50n) / 100n);
}

/** 20% of net products BEFORE cagnotte, rounded down. Shipping is never an input. */
export function calculateCagnotteCapCents(eligibleCents: number): number {
  const percentage = BigInt(CAGNOTTE_OPENING_COMMERCIAL_POLICY.redemption.maximumEligibleProductsPercentage);
  return safeNumber(money(eligibleCents, "eligibleCents") * percentage / 100n);
}

export function checkReferralAmountThreshold(productsBeforeReferralCents: number) {
  money(productsBeforeReferralCents, "productsBeforeReferralCents");
  return {
    productsBeforeReferralCents,
    thresholdCents: REFERRAL_REFERENCE_CENTS.minimumProducts,
    amountEligible: productsBeforeReferralCents >= REFERRAL_REFERENCE_CENTS.minimumProducts,
    customerEligibility: "not_evaluated" as const,
  };
}

/** Compatibility follows the approved opening policy and remains separate from arithmetic. */
export function assessCagnotteCompatibility(
  advantages: readonly CagnotteAdvantage[],
): CagnotteCompatibility {
  array(advantages, "advantages");
  for (const advantage of advantages) {
    if (!advantageOrder.includes(advantage)) fail("Avantage inconnu.");
  }
  const present = advantageOrder.filter((advantage) => advantages.includes(advantage));
  const blockingAdvantages = present.filter(
    (advantage) => cagnotteUsePolicyForAdvantage(advantage) === "blocked",
  );
  const pendingAdvantages = present.filter(
    (advantage) => cagnotteUsePolicyForAdvantage(advantage) === "needs_validation",
  );
  return {
    status: blockingAdvantages.length ? "blocked" : pendingAdvantages.length ? "needs_validation" : "allowed",
    blockingAdvantages,
    pendingAdvantages,
  };
}

/** Largest remainder allocation. Results/ties use code-unit line ID order, not locale/display order. */
export function allocateCents(
  amountCents: number,
  bases: readonly AllocationBase[],
): readonly CentAllocation[] {
  const amount = money(amountCents, "amountCents");
  array(bases, "bases");
  const ids = new Set<string>();
  const rows = bases.map((base) => {
    record(base, "base");
    uniqueId(base.lineId, ids, "lineId");
    return { lineId: base.lineId, base: money(base.baseCents, "baseCents") };
  }).sort((left, right) => compareIds(left.lineId, right.lineId));
  const total = rows.reduce((sum, row) => sum + row.base, 0n);
  safeNumber(total);
  if (amount > total) fail("Montant à répartir supérieur à sa base.");
  if (total === 0n) return rows.map((row) => ({ lineId: row.lineId, amountCents: 0 }));

  // Products can exceed Number.MAX_SAFE_INTEGER: BigInt keeps them exact before division.
  const shares = rows.map((row) => ({
    lineId: row.lineId,
    allocated: amount * row.base / total,
    remainder: amount * row.base % total,
  }));
  let residual = amount - shares.reduce((sum, row) => sum + row.allocated, 0n);
  const ranked = [...shares].sort((left, right) =>
    left.remainder === right.remainder
      ? compareIds(left.lineId, right.lineId)
      : left.remainder > right.remainder ? -1 : 1,
  );
  for (const row of ranked) {
    if (residual === 0n) break;
    row.allocated += 1n;
    residual -= 1n;
  }
  return shares.map((row) => ({ lineId: row.lineId, amountCents: safeNumber(row.allocated) }));
}

/** Already resolved prices/discounts only. Discount order is supplied by the caller, never selected here. */
export function calculateCagnotte(input: CagnotteCalculationInput): CagnotteSnapshot {
  record(input, "input");
  array(input.lines, "lines");
  array(input.discounts, "discounts");
  money(input.requestedCagnotteCents, "requestedCagnotteCents");
  money(input.availableCagnotteCents, "availableCagnotteCents");
  const lineIds = new Set<string>();
  const lines = input.lines.map((line) => {
    validateLine(line, lineIds);
    return {
      lineId: line.lineId,
      initialCents: line.initialCents,
      ...(line.isGift === undefined ? {} : { isGift: line.isGift }),
      ...(line.giftCommercialValueCents === undefined ? {} : {
        giftCommercialValueCents: line.giftCommercialValueCents,
      }),
      discounts: [] as { discountId: string; amountCents: number }[],
      discountCents: 0,
      netCents: line.initialCents,
      cagnotteCents: 0,
      productsPaidCents: 0,
    };
  }).sort((left, right) => compareIds(left.lineId, right.lineId));
  const subtotalCents = sumMoney(lines.map((line) => line.initialCents));
  const discountIds = new Set<string>();
  const inferredAdvantages: CagnotteAdvantage[] = [];
  for (const discount of input.discounts) {
    validateDiscount(discount, discountIds, lineIds);
    if (discount.kind !== "product_discount") inferredAdvantages.push(discount.kind);
    const affected = lines.filter((line) => discount.lineIds.includes(line.lineId));
    const allocations = allocateCents(discount.amountCents, affected.map((line) => ({
      lineId: line.lineId,
      baseCents: line.netCents,
    })));
    for (const allocation of allocations) {
      const line = affected.find((entry) => entry.lineId === allocation.lineId)!;
      line.discounts.push({ discountId: discount.discountId, amountCents: allocation.amountCents });
      line.discountCents = sumMoney([line.discountCents, allocation.amountCents]);
      line.netCents -= allocation.amountCents;
    }
  }
  const discountCents = sumMoney(lines.map((line) => line.discountCents));
  const eligibleCents = subtotalCents - discountCents;
  if (lines.some((line) => line.isGift)) inferredAdvantages.push("promotional_gift");
  const declaredAdvantages = input.advantages === undefined ? [] : input.advantages;
  array(declaredAdvantages, "advantages");
  const compatibility = assessCagnotteCompatibility([...declaredAdvantages, ...inferredAdvantages]);
  const cagnotteCapCents = calculateCagnotteCapCents(eligibleCents);
  const appliedCagnotteCents = compatibility.status === "allowed"
    ? Math.min(input.requestedCagnotteCents, input.availableCagnotteCents, cagnotteCapCents)
    : 0;
  const limitationReasons = redemptionLimitations(
    input.requestedCagnotteCents, input.availableCagnotteCents, cagnotteCapCents, compatibility,
  );
  const allocations = allocateCents(appliedCagnotteCents, lines.map((line) => ({
    lineId: line.lineId,
    baseCents: line.netCents,
  })));
  const snapshots: CagnotteLineSnapshot[] = lines.map((line, index) => ({
    ...line,
    cagnotteCents: allocations[index].amountCents,
    productsPaidCents: line.netCents - allocations[index].amountCents,
  }));
  const productsPaidCents = eligibleCents - appliedCagnotteCents;
  return {
    kind: "estimate",
    calculationVersion: CAGNOTTE_CALCULATION_VERSION,
    lines: snapshots,
    subtotalCents,
    discountCents,
    eligibleCents,
    requestedCagnotteCents: input.requestedCagnotteCents,
    availableCagnotteCents: input.availableCagnotteCents,
    cagnotteCapCents,
    appliedCagnotteCents,
    productsPaidCents,
    loyaltyCents: calculateLoyaltyCents(productsPaidCents),
    compatibility,
    limitationReasons,
  };
}

/**
 * Differential simulation on original allocations. Each array is a COMPLETE cumulative
 * state (omitted lines mean zero). No quantities, prices, promotions or thresholds are reevaluated.
 * Snapshot validation checks arithmetic consistency, not authenticity or server idempotence.
 */
export function simulateCagnotteRefund(
  snapshot: CagnotteSnapshot,
  previousReturns: readonly CumulativeLineReturn[],
  nextReturns: readonly CumulativeLineReturn[],
): CagnotteRefundSimulation {
  validateSnapshot(snapshot);
  const previousById = validateReturns(previousReturns, snapshot.lines);
  const nextById = validateReturns(nextReturns, snapshot.lines);
  const lines = [...snapshot.lines]
    .sort((left, right) => compareIds(left.lineId, right.lineId))
    .map((line) => {
      const previousReturnedNetCents = previousById.get(line.lineId) ?? 0;
      const returnedNetCents = nextById.get(line.lineId) ?? 0;
      if (returnedNetCents < previousReturnedNetCents) fail("Recul du cumul retourné.");
      const previousWallet = returnedWallet(line, previousReturnedNetCents);
      const nextWallet = returnedWallet(line, returnedNetCents);
      return {
        lineId: line.lineId,
        previousReturnedNetCents,
        returnedNetCents,
        cumulativeCagnotteRestitutionCents: nextWallet,
        cumulativeFinancialRefundCents: returnedNetCents - nextWallet,
        cagnotteRestitutionDeltaCents: nextWallet - previousWallet,
        financialRefundDeltaCents: (returnedNetCents - nextWallet) - (previousReturnedNetCents - previousWallet),
      };
    });
  const next = refundTotals(
    snapshot.productsPaidCents,
    sumMoney(lines.map((line) => line.returnedNetCents)),
    sumMoney(lines.map((line) => line.cumulativeCagnotteRestitutionCents)),
  );
  const previous = refundTotals(
    snapshot.productsPaidCents,
    sumMoney(lines.map((line) => line.previousReturnedNetCents)),
    next.cagnotteRestitutionCents - sumMoney(lines.map((line) => line.cagnotteRestitutionDeltaCents)),
  );
  return {
    kind: "refund_simulation",
    calculationVersion: CAGNOTTE_CALCULATION_VERSION,
    lines,
    previous,
    next,
    delta: {
      returnedNetCents: next.returnedNetCents - previous.returnedNetCents,
      cagnotteRestitutionCents: next.cagnotteRestitutionCents - previous.cagnotteRestitutionCents,
      financialRefundCents: next.financialRefundCents - previous.financialRefundCents,
      loyaltyCorrectionCents: previous.theoreticalLoyaltyCents - next.theoreticalLoyaltyCents,
    },
  };
}

function validateLine(line: CagnotteLine, ids: Set<string>) {
  record(line, "line");
  uniqueId(line.lineId, ids, "lineId");
  money(line.initialCents, "initialCents");
  if (line.isGift !== undefined && typeof line.isGift !== "boolean") fail("isGift doit être booléen.");
  if (line.giftCommercialValueCents !== undefined) money(line.giftCommercialValueCents, "giftCommercialValueCents");
  if (line.isGift && line.initialCents !== 0) fail("Cadeau gratuit avec montant payable non nul.");
}

function validateDiscount(discount: ProductDiscount, ids: Set<string>, lineIds: Set<string>) {
  record(discount, "discount");
  uniqueId(discount.discountId, ids, "discountId");
  money(discount.amountCents, "discount.amountCents");
  if (discount.kind !== "product_discount" &&
    (!advantageOrder.includes(discount.kind) || String(discount.kind) === "promotional_gift")) {
    fail("Type de réduction inconnu.");
  }
  array(discount.lineIds, "discount.lineIds");
  if (!discount.lineIds.length) fail("Périmètre de réduction vide.");
  const scopedIds = new Set<string>();
  for (const lineId of discount.lineIds) {
    uniqueId(lineId, scopedIds, "discount.lineId");
    if (!lineIds.has(lineId)) fail("Ligne de réduction inconnue.");
  }
}

function redemptionLimitations(
  requested: number, available: number, cap: number, compatibility: CagnotteCompatibility,
): CagnotteLimitationReason[] {
  const reasons: CagnotteLimitationReason[] = [];
  if (requested > available) reasons.push("available_balance");
  if (requested > cap) reasons.push("twenty_percent_cap");
  if (requested > 0 && compatibility.blockingAdvantages.length) reasons.push("compatibility_blocked");
  if (requested > 0 && compatibility.pendingAdvantages.length) reasons.push("compatibility_to_validate");
  return reasons;
}

function validateSnapshot(snapshot: CagnotteSnapshot) {
  record(snapshot, "snapshot");
  if (snapshot.kind !== "estimate" || snapshot.calculationVersion !== CAGNOTTE_CALCULATION_VERSION) {
    fail("Version ou nature d'instantané non prise en charge.");
  }
  array(snapshot.lines, "snapshot.lines");
  const ids = new Set<string>();
  for (const line of snapshot.lines) {
    validateLine(line, ids);
    array(line.discounts, "line.discounts");
    const discountIds = new Set<string>();
    for (const discount of line.discounts) {
      record(discount, "line.discount");
      uniqueId(discount.discountId, discountIds, "discountId");
      money(discount.amountCents, "discount.amountCents");
    }
    money(line.discountCents, "line.discountCents");
    money(line.netCents, "line.netCents");
    money(line.cagnotteCents, "line.cagnotteCents");
    money(line.productsPaidCents, "line.productsPaidCents");
    if (line.discountCents !== sumMoney(line.discounts.map((discount) => discount.amountCents)) ||
      line.discountCents > line.initialCents || line.netCents !== line.initialCents - line.discountCents ||
      line.cagnotteCents > line.netCents || line.productsPaidCents !== line.netCents - line.cagnotteCents) {
      fail("Instantané de ligne incohérent.");
    }
  }
  for (const key of [
    "subtotalCents", "discountCents", "eligibleCents", "requestedCagnotteCents",
    "availableCagnotteCents", "cagnotteCapCents", "appliedCagnotteCents", "productsPaidCents", "loyaltyCents",
  ] as const) money(snapshot[key], key);
  const matchingTotals = snapshot.subtotalCents === sumMoney(snapshot.lines.map((line) => line.initialCents)) &&
    snapshot.discountCents === sumMoney(snapshot.lines.map((line) => line.discountCents)) &&
    snapshot.eligibleCents === sumMoney(snapshot.lines.map((line) => line.netCents)) &&
    snapshot.appliedCagnotteCents === sumMoney(snapshot.lines.map((line) => line.cagnotteCents)) &&
    snapshot.productsPaidCents === sumMoney(snapshot.lines.map((line) => line.productsPaidCents));
  if (!matchingTotals || snapshot.cagnotteCapCents !== calculateCagnotteCapCents(snapshot.eligibleCents) ||
    snapshot.appliedCagnotteCents > Math.min(snapshot.requestedCagnotteCents, snapshot.availableCagnotteCents, snapshot.cagnotteCapCents) ||
    snapshot.loyaltyCents !== calculateLoyaltyCents(snapshot.productsPaidCents)) {
    fail("Totaux d'instantané incohérents.");
  }
}

function validateReturns(returns: readonly CumulativeLineReturn[], lines: readonly CagnotteLineSnapshot[]) {
  array(returns, "returns");
  const ids = new Set<string>();
  const result = new Map<string, number>();
  for (const entry of returns) {
    record(entry, "return");
    uniqueId(entry.lineId, ids, "return.lineId");
    money(entry.returnedNetCents, "returnedNetCents");
    const line = lines.find((candidate) => candidate.lineId === entry.lineId);
    if (!line) fail("Ligne retournée inconnue.");
    if (entry.returnedNetCents > line.netCents) fail("Retour supérieur au montant net d'origine.");
    result.set(entry.lineId, entry.returnedNetCents);
  }
  return result;
}

function returnedWallet(line: CagnotteLineSnapshot, returned: number) {
  return line.netCents === 0 ? 0 : safeNumber(BigInt(line.cagnotteCents) * BigInt(returned) / BigInt(line.netCents));
}

function refundTotals(originalPaid: number, returned: number, wallet: number): RefundCumulativeTotals {
  const financialRefundCents = returned - wallet;
  const retainedProductsPaidCents = originalPaid - financialRefundCents;
  return {
    returnedNetCents: returned,
    cagnotteRestitutionCents: wallet,
    financialRefundCents,
    retainedProductsPaidCents,
    theoreticalLoyaltyCents: calculateLoyaltyCents(retainedProductsPaidCents),
  };
}

function money(value: unknown, name: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${name} doit être un entier sûr positif ou nul en centimes.`);
  }
  return BigInt(value);
}

function safeNumber(value: bigint): number {
  if (value < 0n || value > maxSafeCents) fail("Dépassement de la plage des centimes sûrs.");
  return Number(value);
}

function sumMoney(values: readonly number[]) {
  return safeNumber(values.reduce((sum, value) => sum + money(value, "montant"), 0n));
}

function uniqueId(value: unknown, ids: Set<string>, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) fail(`${name} invalide.`);
  if (ids.has(value)) fail(`${name} dupliqué.`);
  ids.add(value);
}

function array(value: unknown, name: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) fail(`${name} doit être un tableau.`);
}

function record(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${name} doit être un objet.`);
}

function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message: string): never {
  throw new RangeError(message);
}
